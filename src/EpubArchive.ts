import { Book, type NavItem, Navigation } from '@likecoin/epub-ts'
import type {
  EpubArchiveImage,
  EpubArchiveMetadata,
  EpubManifestItem,
  EpubTocElement
} from './EpubArchiveTypes.js'
import { EpubResourceReader } from './EpubResourceReader.js'

const resolveArchivePath = (baseFile: string, path: string): string => {
  const pathWithoutQuery = path.split('?')[0]
  if (!pathWithoutQuery) return baseFile
  if (pathWithoutQuery.startsWith('/')) return pathWithoutQuery.slice(1)

  const parts = [...baseFile.split('/').slice(0, -1), ...pathWithoutQuery.split('/')]
  const normalized: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') normalized.pop()
    else normalized.push(part)
  }
  return normalized.join('/')
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
