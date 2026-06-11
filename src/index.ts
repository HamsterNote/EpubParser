import { DocumentParser, type ParserInput } from '@hamster-note/document-parser'
import {
  IntermediateDocument,
  IntermediateImage,
  type IntermediateOutlineDest,
  IntermediateOutline,
  IntermediateOutlineDestType,
  IntermediatePage,
  IntermediatePageMap,
  IntermediateText,
  TextDir
} from '@hamster-note/types'
import { EPub, type ManifestItem, type TocElement } from 'epub'
import epubGenMemoryModule, { type Content, type Options } from 'epub-gen-memory'
import { EpubDocument } from './EpubDocument.js'

export { EpubDocument } from './EpubDocument.js'
export { EpubPage, RenderViews, type RenderOptions } from './EpubPage.js'

type BrowserBinaryInput = ArrayBuffer | Uint8Array | File | Blob
type NodeBinaryInput = Buffer | string
type EpubParserInput = ParserInput | BrowserBinaryInput | NodeBinaryInput
type NormalizedEpubInput = Buffer | Uint8Array
type EpubImageKind = 'image' | 'cover'
type EpubGenerator = (
  options: Options,
  content: Content,
  ...args: (boolean | number)[]
) => Promise<Blob | Buffer | Uint8Array>
type DecodeCleanupTask = () => Promise<void>
type ImageDataUrl = {
  bytes: Buffer
  extension: string
  mimeType: string
}
type NodeProcessWithBuiltins = typeof process & {
  getBuiltinModule?: (moduleName: 'fs/promises') => {
    readFile(path: string): Promise<Buffer>
    writeFile(path: string, data: Buffer): Promise<void>
    mkdtemp(prefix: string): Promise<string>
    rm(path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void>
  }
}

export interface EpubDocumentMetadata {
  title: string
  author?: string
  language?: string
  publisher?: string
  date?: string
}

export interface EpubAssetReference {
  id: string
  href: string
  mimeType: string
  kind: EpubImageKind
  src?: string
  data?: Buffer
  error?: string
}

export interface EpubDocumentExtensions {
  metadata: EpubDocumentMetadata
  epubMetadata: EpubDocumentMetadata
  epubImages: EpubAssetReference[]
  epubCover?: EpubAssetReference
  epubTocItems: TocElement[]
  epubTocMappingLimitation?: string
}

type EpubMetadataSource = Record<string, unknown>
type EpubDocumentWithExtensions = IntermediateDocument & EpubDocumentExtensions
type QuadPolygon = [[number, number], [number, number], [number, number], [number, number]]

const unsupportedInputError = () => new Error('Unsupported EPUB input')
const invalidIntermediateError = (message: string) =>
  new Error(`Invalid intermediate document: ${message}`)
const generateEpub = ((epubGenMemoryModule as { default?: unknown }).default ??
  epubGenMemoryModule) as EpubGenerator

const PAGE_WIDTH = 800
const PAGE_MARGIN_X = 40
const PAGE_MARGIN_Y = 40
const FONT_SIZE = 16
const LINE_HEIGHT = 24
const FONT_FAMILY = 'sans-serif'
const TEXT_COLOR = '#000000'

const isBlobLike = (input: unknown): input is Blob => {
  return typeof Blob !== 'undefined' && input instanceof Blob
}

const isArrayBuffer = (input: unknown): input is ArrayBuffer => {
  return input instanceof ArrayBuffer
}

const isNodeBuffer = (input: unknown): input is Buffer => {
  return typeof Buffer !== 'undefined' && Buffer.isBuffer(input)
}

const copyArrayBufferView = (input: ArrayBufferView): Uint8Array => {
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength).slice()
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const getMetadataValue = (
  documentRecord: Record<string, unknown>,
  keys: string[]
): unknown => {
  const metadata = isRecord(documentRecord.epubMetadata)
    ? documentRecord.epubMetadata
    : isRecord(documentRecord.metadata)
      ? documentRecord.metadata
      : {}

  for (const key of keys) {
    if (metadata[key] !== undefined) return metadata[key]
    if (documentRecord[key] !== undefined) return documentRecord[key]
  }

  return undefined
}

const getMetadataStringFromDocument = (
  documentRecord: Record<string, unknown>,
  keys: string[]
): string | undefined => stringFromUnknown(getMetadataValue(documentRecord, keys))

const getMetadataStringOrArrayFromDocument = (
  documentRecord: Record<string, unknown>,
  keys: string[]
): string | string[] | undefined => {
  const value = getMetadataValue(documentRecord, keys)

  if (Array.isArray(value)) {
    const values = value
      .map(stringFromUnknown)
      .filter((item): item is string => Boolean(item))
    return values.length ? values : undefined
  }

  return stringFromUnknown(value)
}

const isIntermediateTextContent = (item: unknown): item is IntermediateText => {
  return item instanceof IntermediateText || (isRecord(item) && typeof item.content === 'string')
}

const isIntermediateImageContent = (item: unknown): item is IntermediateImage => {
  return item instanceof IntermediateImage || (isRecord(item) && typeof item.src === 'string')
}

const isFetchableImageSource = (src: string): boolean => {
  return /^(https?:|file:)\/\//i.test(src)
}

const parseImageDataUrl = (src: string): ImageDataUrl | undefined => {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(src)
  if (!match) return undefined

  const [, mimeType, base64] = match
  const extension = mimeType.split('/')[1]?.replace(/[^a-z0-9]+/gi, '') || 'png'
  const bytes = Buffer.from(base64.replace(/\s/g, ''), 'base64')
  return { bytes, extension, mimeType }
}

const createTemporaryImageSource = async (
  src: string,
  fallbackName: string,
  cleanupTasks: DecodeCleanupTask[]
): Promise<string | undefined> => {
  const imageData = parseImageDataUrl(src)
  const fsPromises = typeof process === 'undefined'
    ? undefined
    : (process as NodeProcessWithBuiltins).getBuiltinModule?.('fs/promises')
  if (!imageData || !fsPromises) return undefined

  // epub-gen-memory embeds chapter images by fetching URLs, so data URLs need a
  // short-lived local file bridge in Node. The directory is removed in decode's finally block.
  const directory = await fsPromises.mkdtemp('/tmp/hamster-note-epub-decode-')
  const safeName = fallbackName.replace(/[^a-z0-9._-]+/gi, '-') || 'image'
  const filePath = `${directory}/${safeName}.${imageData.extension}`
  await fsPromises.writeFile(filePath, imageData.bytes)
  cleanupTasks.push(() => fsPromises.rm(directory, { force: true, recursive: true }))

  return `file://${filePath}`
}

const renderTextParagraphs = (texts: IntermediateText[]): string => {
  const paragraphs: string[] = []
  let current = ''

  const flush = () => {
    const value = current.trim()
    if (value) paragraphs.push(`<p>${escapeHtml(value)}</p>`)
    current = ''
  }

  texts.forEach((text) => {
    const parts = text.content.split(/\n+/)
    parts.forEach((part, index) => {
      current += part
      if (index < parts.length - 1) flush()
    })

    if (text.isEOL) flush()
  })

  flush()

  return paragraphs.join('')
}

const renderImageParagraphs = async (
  images: IntermediateImage[],
  cleanupTasks: DecodeCleanupTask[]
): Promise<string> => {
  const sources = await Promise.all(
    images.map(async (image, index) => {
      const src = isFetchableImageSource(image.src)
        ? image.src
        : await createTemporaryImageSource(image.src, image.id || `image-${index + 1}`, cleanupTasks)

      return src
        ? `<p><img src="${escapeHtml(src)}" alt="${escapeHtml(image.id)}" /></p>`
        : ''
    })
  )

  return sources.join('')
}

const makePageTitle = (page: IntermediatePage, index: number): string => {
  return `Page ${Number.isFinite(page.number) ? page.number : index + 1}`
}

const getGeneratedBytes = (output: ParserInput): Uint8Array => {
  if (ArrayBuffer.isView(output)) {
    return new Uint8Array(output.buffer, output.byteOffset, output.byteLength)
  }

  if (output instanceof ArrayBuffer) {
    return new Uint8Array(output)
  }

  if (isBlobLike(output)) {
    throw new Error('Generated EPUB output cannot be a Blob during ZIP validation')
  }

  return new Uint8Array(output)
}

const assertZipMagic = (output: ParserInput): void => {
  const bytes = getGeneratedBytes(output)

  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw new Error('Generated EPUB output is not a ZIP archive')
  }
}

const normalizeGeneratedOutput = async (
  output: Blob | Buffer | Uint8Array
): Promise<ParserInput> => {
  if (isNodeBuffer(output)) return output
  if (output instanceof Uint8Array) return output

  return new Uint8Array(await output.arrayBuffer())
}

const dataUrlToCoverFile = (src: string, fallbackName: string): File | undefined => {
  if (typeof File === 'undefined') return undefined

  const imageData = parseImageDataUrl(src)
  if (!imageData) return undefined

  return new File([Uint8Array.from(imageData.bytes)], `${fallbackName}.${imageData.extension}`, {
    type: imageData.mimeType
  })
}

const resolveDecodeCover = async (
  intermediateDocument: IntermediateDocument
): Promise<Options['cover'] | undefined> => {
  const documentRecord = intermediateDocument as unknown as EpubDocumentWithExtensions
  const src = documentRecord.epubCover?.src ?? (await intermediateDocument.getCover(1))?.src

  if (!src) return undefined
  if (isFetchableImageSource(src)) return src

  return dataUrlToCoverFile(src, `${intermediateDocument.id || 'epub'}-cover`)
}

const readPathInput = async (path: string): Promise<Buffer> => {
  const nodeProcess: NodeProcessWithBuiltins | undefined =
    typeof process === 'undefined' ? undefined : process
  const fsPromises = nodeProcess?.getBuiltinModule?.('fs/promises')

  if (!nodeProcess?.versions?.node || !fsPromises) {
    throw unsupportedInputError()
  }

  return fsPromises.readFile(path)
}

const toEpubConstructorInput = (input: NormalizedEpubInput): Buffer | ArrayBuffer => {
  if (isNodeBuffer(input)) {
    return input
  }

  return input.slice().buffer as ArrayBuffer
}

const stringFromUnknown = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return undefined
}

const getMetadataString = (
  metadata: EpubMetadataSource,
  ...keys: string[]
): string | undefined => {
  for (const key of keys) {
    const value = stringFromUnknown(metadata[key])

    if (value) {
      return value
    }
  }

  return undefined
}

const extractEpubMetadata = (metadata: EpubMetadataSource): EpubDocumentMetadata => {
  const title = getMetadataString(metadata, 'title') ?? 'Untitled EPUB'
  const author = getMetadataString(metadata, 'creator', 'author', 'creatorFileAs')
  const language = getMetadataString(metadata, 'language')
  const publisher = getMetadataString(metadata, 'publisher')
  const date = getMetadataString(metadata, 'date')

  return { title, author, language, publisher, date }
}

/**
 * 解码单个 HTML 实体（如 `&amp;`、`&#169;`、`&#x00A9;`）。
 * 这是一个轻量级的辅助函数，仅处理 EPUB 章节内容中常见的实体子集，
 * 并非完整的 HTML 实体解码器。未知实体保留原始 `&entity;` 形式。
 */
const decodeHtmlEntity = (entity: string): string => {
  const namedEntities: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"'
  }

  if (entity.startsWith('#x') || entity.startsWith('#X')) {
    const codePoint = Number.parseInt(entity.slice(2), 16)
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : `&${entity};`
  }

  if (entity.startsWith('#')) {
    const codePoint = Number.parseInt(entity.slice(1), 10)
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : `&${entity};`
  }

  return namedEntities[entity] ?? `&${entity};`
}

/**
 * 从 EPUB 章节 HTML 中提取纯文本行。
 *
 * **注意：这不是一个完整的 HTML 解析器。** 它使用正则进行最小化的文本提取，
 * 专门处理 EPUB 章节内容的典型结构（段落、标题、列表、换行等）。
 * 不支持嵌套标签的语义分析，也不保留任何格式信息。
 *
 * 处理流程：
 * 1. 移除 <script> 和 <style> 标签及其内容
 * 2. 将块级标签（p、div、h1-h6 等）和 <br> 转换为换行符
 * 3. 剥离剩余 HTML 标签
 * 4. 解码 HTML 实体
 * 5. 按行分割，清理空白，过滤空行
 */
const htmlToTextLines = (html: string): string[] => {
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|footer|h[1-6]|li|tr|table)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&([a-zA-Z][a-zA-Z0-9]+|#[0-9]+|#x[0-9a-fA-F]+);/g, (_match, entity) =>
      decodeHtmlEntity(entity)
    )

  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

const textPolygon = (x: number, y: number, width: number, height: number): QuadPolygon => [
  [x, y],
  [x + width, y],
  [x + width, y + height],
  [x, y + height]
]

const makeText = (id: string, content: string, x: number, y: number): IntermediateText => {
  const width = Math.min(PAGE_WIDTH - PAGE_MARGIN_X * 2, Math.max(80, content.length * 8))

  return new IntermediateText({
    id,
    content,
    fontSize: FONT_SIZE,
    fontFamily: FONT_FAMILY,
    fontWeight: 400,
    italic: false,
    color: TEXT_COLOR,
    polygon: textPolygon(x, y, width, LINE_HEIGHT),
    lineHeight: LINE_HEIGHT,
    ascent: FONT_SIZE * 0.8,
    descent: FONT_SIZE * 0.2,
    dir: TextDir.LTR,
    opacity: 1,
    skew: 0,
    isEOL: true
  })
}

const htmlToTexts = (html: string, pageId: string): IntermediateText[] => {
  return htmlToTextLines(html).map((line, index) =>
    makeText(
      `${pageId}-text-${index + 1}`,
      line,
      PAGE_MARGIN_X,
      PAGE_MARGIN_Y + index * LINE_HEIGHT
    )
  )
}

const getPageHeight = (contentCount: number, imageCount = 0): number => {
  const textHeight = PAGE_MARGIN_Y * 2 + Math.max(1, contentCount) * LINE_HEIGHT
  const imageHeight = imageCount * 220
  return Math.max(1000, textHeight + imageHeight)
}

const dataUrlFromAsset = (asset: EpubAssetReference): string | undefined => {
  if (!asset.data || !asset.mimeType) {
    return asset.src
  }

  return `data:${asset.mimeType};base64,${asset.data.toString('base64')}`
}

const extractChapterImageIds = (html: string): string[] => {
  const imageIds = new Set<string>()
  const srcPattern = /<img\b[^>]*\bsrc\s*=\s*(["']?)([^"'\s>]+)\1/gi

  for (let match = srcPattern.exec(html); match !== null; match = srcPattern.exec(html)) {
    const src = match[2]
    const rewrittenId = src.match(/\/images\/([^/]+)\//)?.[1]

    if (rewrittenId) {
      imageIds.add(decodeURIComponent(rewrittenId))
    }
  }

  return [...imageIds]
}

const createPageImages = (
  imageIds: string[],
  assetById: Map<string, EpubAssetReference>,
  pageId: string,
  startY: number
): IntermediateImage[] => {
  return imageIds.flatMap((imageId, index) => {
    const asset = assetById.get(imageId)
    const src = asset ? dataUrlFromAsset(asset) : undefined

    if (!src) {
      return []
    }

    const y = startY + index * 220
    return [
      new IntermediateImage({
        id: `${pageId}-image-${index + 1}`,
        src,
        polygon: textPolygon(PAGE_MARGIN_X, y, 240, 180),
        opacity: 1
      })
    ]
  })
}

const isImageManifestItem = (item: ManifestItem): boolean => {
  return String(item['media-type'] ?? '').toLowerCase().startsWith('image/')
}

const getManifestItemProperties = (item: ManifestItem): string => {
  return String(item.properties ?? item['@_properties'] ?? '').toLowerCase()
}

const isNavigationManifestItem = (item: ManifestItem): boolean => {
  const href = item.href.split('#')[0].toLowerCase()
  const fileName = href.split('/').pop()
  const mediaType = String(item['media-type'] ?? '').toLowerCase()

  return (
    getManifestItemProperties(item).split(/\s+/).includes('nav') ||
    mediaType === 'application/x-dtbncx+xml' ||
    fileName === 'toc.xhtml' ||
    fileName === 'toc.ncx'
  )
}

const findManifestItemByHref = (
  manifest: Record<string, ManifestItem>,
  href: string | undefined
): ManifestItem | undefined => {
  if (!href) {
    return undefined
  }

  const hrefWithoutAnchor = href.split('#')[0]
  return Object.values(manifest).find((item) => item.href.split('#')[0] === hrefWithoutAnchor)
}

const findCoverId = (epub: EPub): string | undefined => {
  const metadataCover = stringFromUnknown((epub.metadata as EpubMetadataSource).cover)

  if (metadataCover && epub.manifest[metadataCover] && isImageManifestItem(epub.manifest[metadataCover])) {
    return metadataCover
  }

  const guideCover = epub.guide.find((item) => {
    const guideType = getMetadataString(item, 'type')?.toLowerCase()
    return guideType === 'cover'
  })
  const guideCoverItem = findManifestItemByHref(epub.manifest, getMetadataString(guideCover ?? {}, 'href'))

  if (guideCoverItem && isImageManifestItem(guideCoverItem)) {
    return guideCoverItem.id
  }

  const propertyCover = Object.values(epub.manifest).find((item) => {
    const searchable = `${item.id} ${item.href} ${getManifestItemProperties(item)}`.toLowerCase()
    return isImageManifestItem(item) && (searchable.includes('cover-image') || searchable.includes('cover'))
  })

  return propertyCover?.id
}

const collectImageAssets = async (epub: EPub): Promise<EpubAssetReference[]> => {
  const coverId = findCoverId(epub)
  const imageItems = Object.values(epub.manifest).filter(isImageManifestItem)

  return Promise.all(
    imageItems.map(async (item) => {
      const kind: EpubImageKind = item.id === coverId ? 'cover' : 'image'
      const baseReference: EpubAssetReference = {
        id: item.id,
        href: item.href,
        mimeType: item['media-type'],
        kind
      }

      try {
        const image = await epub.getImage(item.id)
        return {
          ...baseReference,
          data: image.data,
          mimeType: image.mimeType,
          src: `data:${image.mimeType};base64,${image.data.toString('base64')}`
        }
      } catch (error) {
        return {
          ...baseReference,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    })
  )
}

const findPageIdForTocItem = (
  tocItem: TocElement,
  pageIdByManifestId: Map<string, string>,
  manifest: Record<string, ManifestItem>
): string | undefined => {
  if (pageIdByManifestId.has(tocItem.id)) {
    return pageIdByManifestId.get(tocItem.id)
  }

  const targetItem = findManifestItemByHref(manifest, tocItem.href)
  return targetItem ? pageIdByManifestId.get(targetItem.id) : undefined
}

const buildOutline = (
  toc: TocElement[],
  pageIdByManifestId: Map<string, string>,
  manifest: Record<string, ManifestItem>
): IntermediateOutline[] | undefined => {
  const outline = toc
    .filter((item) => item.title?.trim())
    .map((item, index) => {
      const pageId = findPageIdForTocItem(item, pageIdByManifestId, manifest)
      const dest: IntermediateOutlineDest = pageId
        ? {
            targetType: IntermediateOutlineDestType.PAGE,
            pageId
          }
        : {
            targetType: IntermediateOutlineDestType.URL,
            url: item.href,
            unsafeUrl: item.href,
            newWindow: false
          }

      return new IntermediateOutline({
        id: `epub-outline-${index + 1}`,
        content: item.title.trim(),
        fontSize: FONT_SIZE,
        fontFamily: FONT_FAMILY,
        fontWeight: 400,
        italic: false,
        color: TEXT_COLOR,
        polygon: textPolygon(0, index * LINE_HEIGHT, 1, LINE_HEIGHT),
        lineHeight: LINE_HEIGHT,
        ascent: FONT_SIZE * 0.8,
        descent: FONT_SIZE * 0.2,
        dir: TextDir.LTR,
        opacity: 1,
        skew: 0,
        isEOL: true,
        dest
      })
    })

  return outline.length > 0 ? outline : undefined
}

const readChapterHtml = async (epub: EPub, chapterId: string): Promise<string> => {
  try {
    return await epub.getChapter(chapterId)
  } catch (firstError) {
    try {
      return await epub.getChapterRaw(chapterId)
    } catch (secondError) {
      const reason = secondError instanceof Error ? secondError.message : String(secondError)
      const fallbackReason = firstError instanceof Error ? firstError.message : String(firstError)
      throw new Error(`Failed to read EPUB chapter ${chapterId}: ${reason || fallbackReason}`)
    }
  }
}

export class EpubParser extends DocumentParser {
  static readonly exts = ['epub'] as const
  static readonly ext = 'epub'

  async encode(input: ParserInput): Promise<IntermediateDocument> {
    const doc = await EpubParser.encode(input)
    return doc.getIntermediateDocument()
  }

  async decode(
    intermediateDocument: IntermediateDocument
  ): Promise<ParserInput> {
    return EpubParser.decode(intermediateDocument)
  }

  static async encode(fileOrBuffer: EpubParserInput): Promise<EpubDocument> {
    const normalizedInput = await normalizeInput(fileOrBuffer)
    const epub = new EPub(toEpubConstructorInput(normalizedInput))

    try {
      await epub.parse()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to parse EPUB: ${message}`)
    }

    const id = `epub-${Date.now()}`
    const metadata = extractEpubMetadata(epub.metadata as EpubMetadataSource)
    const imageAssets = await collectImageAssets(epub)
    const assetById = new Map(imageAssets.map((asset) => [asset.id, asset]))
    const pageIdByManifestId = new Map<string, string>()

    const contentFlow = epub.flow.filter((flowItem) => !isNavigationManifestItem(flowItem))
    const infoList = await Promise.all(
      contentFlow.map(async (flowItem, index) => {
        const pageNumber = index + 1
        const pageId = `${id}-page-${pageNumber}`
        pageIdByManifestId.set(flowItem.id, pageId)

        const html = await readChapterHtml(epub, flowItem.id)
        const texts = htmlToTexts(html, pageId)
        const chapterImageIds = extractChapterImageIds(html)
        const images = createPageImages(
          chapterImageIds,
          assetById,
          pageId,
          PAGE_MARGIN_Y + Math.max(1, texts.length) * LINE_HEIGHT + LINE_HEIGHT
        )
        const pageHeight = getPageHeight(texts.length, images.length)

        return {
          id: pageId,
          pageNumber,
          size: { x: PAGE_WIDTH, y: pageHeight },
          getData: async () =>
            new IntermediatePage({
              id: pageId,
              number: pageNumber,
              width: PAGE_WIDTH,
              height: pageHeight,
              content: [...texts, ...images],
              thumbnail: undefined
            })
        }
      })
    )

    const outline = buildOutline(epub.toc, pageIdByManifestId, epub.manifest)

    const intermediateDocument = new IntermediateDocument({
      id,
      title: metadata.title,
      pagesMap: IntermediatePageMap.makeByInfoList(infoList),
      outline
    })

    const documentWithEpubData = intermediateDocument as EpubDocumentWithExtensions
    documentWithEpubData.metadata = metadata
    documentWithEpubData.epubMetadata = metadata
    documentWithEpubData.epubImages = imageAssets
    documentWithEpubData.epubCover = imageAssets.find((asset) => asset.kind === 'cover')
    documentWithEpubData.epubTocItems = epub.toc

    if (!outline && epub.toc.length === 0) {
      documentWithEpubData.epubTocMappingLimitation =
        'The epub package did not expose NCX TOC items for this EPUB.'
    }

    return new EpubDocument(intermediateDocument)
  }

  static async decode(
    intermediateDocument: IntermediateDocument
  ): Promise<ParserInput> {
    if (!(intermediateDocument instanceof IntermediateDocument)) {
      throw invalidIntermediateError('document must be an IntermediateDocument')
    }

    const title = stringFromUnknown(intermediateDocument.title)
    if (!title) throw invalidIntermediateError('title is required')

    const pages = await intermediateDocument.pages
    if (!pages.length) throw invalidIntermediateError('at least one page is required')

    const documentRecord = intermediateDocument as unknown as Record<string, unknown>
    const options: Options = {
      title,
      author: getMetadataStringOrArrayFromDocument(documentRecord, [
        'author',
        'creator',
        'creators',
        'creatorFileAs'
      ]),
      publisher: getMetadataStringFromDocument(documentRecord, ['publisher']),
      date: getMetadataStringFromDocument(documentRecord, ['date', 'published', 'modified']),
      lang: getMetadataStringFromDocument(documentRecord, ['language', 'lang']),
      cover: await resolveDecodeCover(intermediateDocument),
      verbose: false,
      prependChapterTitles: false,
      ignoreFailedDownloads: true
    }

    const cleanupTasks: DecodeCleanupTask[] = []

    try {
      const content: Content = await Promise.all(
        [...pages]
          .sort((a, b) => a.number - b.number)
          .map(async (page, index) => {
            const pageContent = await page.getContent()
            const texts = pageContent.filter(isIntermediateTextContent)
            const images = pageContent.filter(isIntermediateImageContent)
            const html = `${renderTextParagraphs(texts)}${await renderImageParagraphs(
              images,
              cleanupTasks
            )}`

            return {
              title: makePageTitle(page, index),
              content: html || '<p></p>',
              excludeFromToc: false
            }
          })
      )

      const output = await normalizeGeneratedOutput(await generateEpub(options, content, 3))
      assertZipMagic(output)

      return output
    } finally {
      await Promise.all(cleanupTasks.map((cleanup) => cleanup()))
    }
  }
}

export async function normalizeInput(
  input: EpubParserInput
): Promise<NormalizedEpubInput> {
  if (isNodeBuffer(input)) {
    return input
  }

  if (isArrayBuffer(input)) {
    return new Uint8Array(input)
  }

  if (ArrayBuffer.isView(input)) {
    return copyArrayBufferView(input)
  }

  if (typeof input === 'string') {
    return readPathInput(input)
  }

  if (isBlobLike(input)) {
    return new Uint8Array(await input.arrayBuffer())
  }

  throw unsupportedInputError()
}

export default EpubParser
