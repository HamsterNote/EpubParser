import JSZip, { type JSZipObject } from 'jszip'
import type {
  EpubArchiveImage,
  EpubArchiveMetadata,
  EpubManifestItem,
  EpubTocElement
} from './EpubArchiveTypes.js'
import { validateEpubArchiveSize } from './EpubArchiveLimits.js'
import {
  MAX_EPUB_ENTRY_BYTES,
  MAX_EPUB_TOTAL_ENTRY_BYTES
} from './EpubArchiveLimits.js'
import {
  asArray,
  isRecord,
  parseNavigationDocument,
  parseNcx,
  parsePackageDocument,
  parseXml,
  resolveArchivePath
} from './EpubXml.js'

const textDecoder = new TextDecoder('utf-8')

export class EpubArchive {
  readonly metadata: EpubArchiveMetadata = {}
  readonly manifest: Record<string, EpubManifestItem> = {}
  readonly guide: Record<string, string>[] = []
  readonly flow: EpubManifestItem[] = []
  readonly toc: EpubTocElement[] = []
  version = '2.0'
  private rootFile = ''
  private zip?: JSZip
  private readonly expandedBytesByEntry = new Map<string, number>()
  private expandedBytes = 0

  constructor(private readonly input: Uint8Array) {}

  async parse(): Promise<void> {
    validateEpubArchiveSize(this.input)
    try {
      this.zip = await JSZip.loadAsync(this.input)
    } catch {
      throw new Error('Invalid/missing file')
    }
    if (!Object.keys(this.zip.files).length) throw new Error('No files in archive')

    const mimeFile = this.findEntry('mimetype')
    if (!mimeFile) throw new Error('No mimetype file in archive')
    if ((await this.readText(mimeFile)).toLowerCase().trim() !== 'application/epub+zip') {
      throw new Error('Unsupported mime type')
    }

    const containerFile = this.findEntry('meta-inf/container.xml')
    if (!containerFile) throw new Error('No container file in archive')
    const container = parseXml(await this.readText(containerFile))
    const rootfiles = isRecord(container.rootfiles) ? container.rootfiles.rootfile : undefined
    const rootfile = asArray(rootfiles).find(
      (value) =>
        isRecord(value) &&
        String(value['@_media-type']).toLowerCase() === 'application/oebps-package+xml' &&
        typeof value['@_full-path'] === 'string'
    )
    if (!isRecord(rootfile) || typeof rootfile['@_full-path'] !== 'string') {
      throw new Error('Rootfile not found from archive')
    }

    this.rootFile = rootfile['@_full-path']
    const parsed = parsePackageDocument(parseXml(await this.readText(this.rootFile)), this.rootFile)
    Object.assign(this.metadata, parsed.metadata)
    Object.assign(this.manifest, parsed.manifest)
    this.guide.push(...parsed.guide)
    this.flow.push(...parsed.flow)
    this.version = parsed.version

    const ncx = parsed.tocId ? this.manifest[parsed.tocId] : undefined
    let ncxError: unknown
    if (ncx) {
      try {
        this.toc.push(...parseNcx(parseXml(await this.readText(ncx.href)), ncx.href, this.manifest))
      } catch (error) {
        ncxError = error
      }
    }

    const nav = Object.values(this.manifest).find((item) =>
      String(item.properties ?? '').split(/\s+/).includes('nav')
    )
    if (this.toc.length === 0 && nav) {
      this.toc.push(...parseNavigationDocument(await this.readText(nav.href), nav.href, this.manifest))
    } else if (ncxError) {
      throw ncxError
    }
  }

  async getChapter(id: string): Promise<string> {
    let html = (await this.getChapterRaw(id)).replace(/\r?\n/g, '\u0000')
    html.replace(/<body[^>]*?>(.*)<\/body[^>]*?>/i, (_match, body: string) => {
      html = body.trim()
      return ''
    })
    html = html
      .replace(/<script[^>]*?>(.*?)<\/script[^>]*?>/gi, '')
      .replace(/<style[^>]*?>(.*?)<\/style[^>]*?>/gi, '')
      .replace(/(\s)(on\w+)(\s*=\s*["']?[^"'\s>]*?["'\s>])/g, '$1skip-$2$3')

    html = html.replace(
      /(\ssrc\s*=\s*["']?)([^"'\s>]*?)(["'\s>])/gi,
      (_match, prefix: string, source: string, suffix: string) => {
        const item = this.findManifestByResolvedHref(id, source)
        return item ? `${prefix}/images/${item.id}/${item.href}${suffix}` : `${prefix}${source}${suffix}`
      }
    )
    html = html.replace(
      /(\shref\s*=\s*["']?)([^"'\s>]*?)(["'\s>])/gi,
      (_match, prefix: string, source: string, suffix: string) => {
        const item = this.findManifestByResolvedHref(id, source)
        return item ? `${prefix}/links/${item.id}/${item.href}${suffix}` : `${prefix}${source}${suffix}`
      }
    )
    return html.split('\u0000').join('\n').trim()
  }

  async getChapterRaw(id: string): Promise<string> {
    const item = this.manifest[id]
    if (!item) throw new Error('File not found')
    if (!['application/xhtml+xml', 'image/svg+xml'].includes(item['media-type'])) {
      throw new Error('Invalid mime type for chapter')
    }
    return this.readText(item.href)
  }

  async getImage(id: string): Promise<EpubArchiveImage> {
    const item = this.manifest[id]
    if (!item) throw new Error('File not found')
    if (!item['media-type'].toLowerCase().startsWith('image/')) {
      throw new Error('Invalid mime type for image')
    }
    return { data: await this.readBytes(item.href), mimeType: item['media-type'] }
  }

  private findEntry(target: string): string | undefined {
    return Object.keys(this.zip?.files ?? {}).find((name) => name.toLowerCase() === target)
  }

  private getEntry(name: string): JSZipObject {
    const entry = this.zip?.file(name)
    if (!entry) throw new Error(`Entry not found: ${name}`)
    return entry
  }

  private async readBytes(name: string): Promise<Uint8Array> {
    const previousBytes = this.expandedBytesByEntry.get(name) ?? 0
    const chunks: Uint8Array[] = []
    let entryBytes = 0

    await new Promise<void>((resolve, reject) => {
      const stream = this.getEntry(name).internalStream('uint8array')
      stream
        .on('data', (chunk) => {
          entryBytes += chunk.byteLength
          const projectedTotal = this.expandedBytes - previousBytes + entryBytes
          if (entryBytes > MAX_EPUB_ENTRY_BYTES || projectedTotal > MAX_EPUB_TOTAL_ENTRY_BYTES) {
            stream.pause()
            reject(new Error('EPUB archive expanded data exceeds the size limit'))
            return
          }
          chunks.push(chunk)
        })
        .on('error', reject)
        .on('end', resolve)
        .resume()
    })

    const bytes = new Uint8Array(entryBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    this.expandedBytes = this.expandedBytes - previousBytes + entryBytes
    this.expandedBytesByEntry.set(name, entryBytes)
    return bytes
  }

  private async readText(name: string): Promise<string> {
    return textDecoder.decode(await this.readBytes(name))
  }

  private findManifestByResolvedHref(chapterId: string, source: string): EpubManifestItem | undefined {
    const chapter = this.manifest[chapterId]
    if (!chapter) return undefined
    const href = resolveArchivePath(chapter.href, source).split('#')[0]
    return Object.values(this.manifest).find((item) => item.href.split('#')[0] === href)
  }
}
