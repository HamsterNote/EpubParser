import { Book, type NavItem, Navigation } from '@likecoin/epub-ts'
import type {
  EpubArchiveImage,
  EpubArchiveMetadata,
  EpubManifestItem,
  EpubTocElement
} from './EpubArchiveTypes.js'
import { EpubResourceReader } from './EpubResourceReader.js'

const MAX_CHAPTER_STYLESHEETS = 32
const MAX_CHAPTER_STYLESHEET_CHARACTERS = 2 * 1024 * 1024

const resolveArchivePath = (baseFile: string, path: string): string => {
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//')) return path
  const fragmentIndex = path.indexOf('#')
  const fragment = fragmentIndex >= 0 ? path.slice(fragmentIndex) : ''
  const pathAndQuery = fragmentIndex >= 0 ? path.slice(0, fragmentIndex) : path
  let archivePath = pathAndQuery.split('?')[0] ?? ''
  try {
    archivePath = decodeURIComponent(archivePath)
  } catch (error) {
    // Malformed URI escapes are preserved so third-party EPUB metadata cannot crash path resolution.
    if (!(error instanceof URIError)) throw error
  }

  if (!archivePath) return `${baseFile}${fragment}`
  if (archivePath.startsWith('/')) return `${archivePath.slice(1)}${fragment}`

  const parts = [...baseFile.split('/').slice(0, -1), ...archivePath.split('/')]
  const normalized: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') normalized.pop()
    else normalized.push(part)
  }
  return `${normalized.join('/')}${fragment}`
}

const toArrayBuffer = (input: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(input.byteLength)
  new Uint8Array(buffer).set(input)
  return buffer
}

export class EpubArchive {
  readonly metadata: EpubArchiveMetadata = {}
  readonly manifest: Record<string, EpubManifestItem> = {}
  readonly guide: Record<string, string>[] = []
  readonly flow: EpubManifestItem[] = []
  readonly toc: EpubTocElement[] = []
  version = '2.0'
  private resources?: EpubResourceReader

  constructor(private readonly input: Uint8Array) {}

  async parse(): Promise<void> {
    this.resources = await EpubResourceReader.open(this.input)
    const mimeFile = this.resources.findEntry('mimetype')
    if (!mimeFile) throw new Error('No mimetype file in archive')
    if ((await this.resources.readText(mimeFile)).toLowerCase().trim() !== 'application/epub+zip') {
      throw new Error('Unsupported mime type')
    }

    const containerFile = this.resources.findEntry('meta-inf/container.xml')
    if (!containerFile) throw new Error('No container file in archive')

    const BookConstructor = typeof DOMParser === 'undefined'
      ? (await import('@likecoin/epub-ts/node')).Book
      : Book
    const book = new BookConstructor(toArrayBuffer(this.input), { replacements: 'none' })

    try {
      await book.opened
      const rootFile = book.container?.packagePath
      if (!rootFile) throw new Error('Rootfile not found from archive')

      const packageDirectory = rootFile.split('/').slice(0, -1).join('/')
      const resolvePackagePath = (href: string): string =>
        resolveArchivePath(packageDirectory ? `${packageDirectory}/package.opf` : 'package.opf', href)

      Object.assign(this.metadata, {
        identifier: book.packaging.metadata.identifier,
        creator: book.packaging.metadata.creator,
        creatorFileAs: book.packaging.metadata.creator,
        title: book.packaging.metadata.title,
        language: book.packaging.metadata.language.toLowerCase(),
        date: book.packaging.metadata.pubdate,
        description: book.packaging.metadata.description,
        publisher: book.packaging.metadata.publisher
      })

      for (const [id, item] of Object.entries(book.packaging.manifest)) {
        this.manifest[id] = {
          id,
          href: resolvePackagePath(item.href),
          'media-type': item.type,
          properties: item.properties.join(' ')
        }
      }

      const cover = Object.entries(book.packaging.manifest).find(
        ([, item]) => item.href === book.packaging.coverPath
      )
      if (cover) this.metadata.cover = cover[0]

      this.flow.push(
        ...book.packaging.spine.flatMap((item) => {
          const manifestItem = this.manifest[item.idref]
          return manifestItem ? [manifestItem] : []
        })
      )
      let navigationItems = book.navigation.toc
      if (navigationItems.length === 0 && book.packaging.navPath) {
        const navPath = resolvePackagePath(book.packaging.navPath)
        const navDocument = new DOMParser().parseFromString(
          await this.resources.readText(navPath),
          'application/xhtml+xml'
        )
        for (const navElement of navDocument.querySelectorAll('nav')) {
          const types = navElement.getAttribute('epub:type')?.split(/\s+/) ?? []
          if (types.includes('toc')) navElement.setAttribute('epub:type', 'toc')
        }
        navigationItems = new Navigation(navDocument).toc
      }
      const navigationPath = book.packaging.navPath || book.packaging.ncxPath
      const navigationFile = navigationPath ? resolvePackagePath(navigationPath) : rootFile
      this.toc.push(...this.flattenToc(navigationItems, navigationFile, 0))
    } finally {
      book.destroy()
    }
  }

  async getChapter(id: string): Promise<string> {
    let chapter = await this.getChapterRaw(id)
    const stylesheetPattern = /<link\b[^>]*\brel\s*=\s*["'][^"']*\bstylesheet\b[^"']*["'][^>]*>/gi
    const hrefPattern = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i
    const stylesheetCache = new Map<string, string | undefined>()
    const replacements: Array<{ readonly start: number; readonly end: number; readonly value: string }> = []
    let embeddedCharacters = 0
    let stylesheetCount = 0
    for (const match of chapter.matchAll(stylesheetPattern)) {
      if (match.index === undefined || stylesheetCount >= MAX_CHAPTER_STYLESHEETS) continue
      const hrefMatch = hrefPattern.exec(match[0])
      const href = hrefMatch?.[1] ?? hrefMatch?.[2]
      const stylesheet = this.findManifestByResolvedHref(id, href ?? '')
      if (stylesheet?.['media-type'].toLowerCase() !== 'text/css') continue

      let css = stylesheetCache.get(stylesheet.href)
      if (!stylesheetCache.has(stylesheet.href)) {
        try {
          css = await this.getResources().readText(stylesheet.href)
        } catch {
          // 外链 CSS 是可选增强；单个资源损坏不能阻断章节和图片的核心规范化。
          css = undefined
        }
        stylesheetCache.set(stylesheet.href, css)
      }
      if (css === undefined || embeddedCharacters + css.length > MAX_CHAPTER_STYLESHEET_CHARACTERS) {
        continue
      }

      embeddedCharacters += css.length
      stylesheetCount += 1
      replacements.push({
        start: match.index,
        end: match.index + match[0].length,
        value: `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`
      })
    }
    for (const replacement of replacements.reverse()) {
      chapter = `${chapter.slice(0, replacement.start)}${replacement.value}${chapter.slice(replacement.end)}`
    }

    let html = chapter.replace(/\r?\n/g, '\u0000')
    html = html
      .replace(/<script[^>]*?>(.*?)<\/script[^>]*?>/gi, '')
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
    return this.getResources().readText(item.href)
  }

  async getImage(id: string): Promise<EpubArchiveImage> {
    const item = this.manifest[id]
    if (!item) throw new Error('File not found')
    if (!item['media-type'].toLowerCase().startsWith('image/')) {
      throw new Error('Invalid mime type for image')
    }
    return { data: await this.getResources().readBytes(item.href), mimeType: item['media-type'] }
  }

  private getResources(): EpubResourceReader {
    if (!this.resources) throw new Error('Archive has not been parsed')
    return this.resources
  }

  private findManifestByResolvedHref(chapterId: string, source: string): EpubManifestItem | undefined {
    const chapter = this.manifest[chapterId]
    if (!chapter) return undefined
    const href = resolveArchivePath(chapter.href, source).split('#')[0]
    return Object.values(this.manifest).find((item) => item.href.split('#')[0] === href)
  }

  private flattenToc(items: NavItem[], rootFile: string, level: number): EpubTocElement[] {
    if (level > 7) return []

    return items.flatMap((item, index) => {
      const href = resolveArchivePath(rootFile, item.href)
      const manifestItem = Object.values(this.manifest).find(
        (candidate) => candidate.href.split('#')[0] === href.split('#')[0]
      )
      const current: EpubTocElement = {
        ...(manifestItem ?? {}),
        level,
        order: index + 1,
        title: item.label,
        id: manifestItem?.id ?? item.id,
        href
      }
      return [current, ...this.flattenToc(item.subitems ?? [], rootFile, level + 1)]
    })
  }
}
