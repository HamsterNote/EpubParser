import { DocumentParser, type ParserInput } from '@hamster-note/document-parser'
import {
  type IntermediateContent,
  IntermediateDocument,
  IntermediateImage,
  IntermediateOutline,
  type IntermediateOutlineDest,
  IntermediateOutlineDestType,
  IntermediatePage,
  IntermediatePageMap,
  type IntermediateParagraph,
  IntermediateText,
  TextDir
} from '@hamster-note/types'
import { EpubArchive } from './EpubArchive.js'
import type { EpubManifestItem, EpubTocElement } from './EpubArchiveTypes.js'
import { parseChapterText } from './EpubContentParser.js'
import { EpubDocument } from './EpubDocument.js'
import {
  type EpubContentItem,
  type EpubGeneratorOptions,
  generateEpub
} from './EpubGenerator.js'
import { readImageDimensions } from './EpubImageDimensions.js'

export { EpubDocument } from './EpubDocument.js'
export { EpubPage, type RenderOptions, RenderViews } from './EpubPage.js'

type BrowserBinaryInput = ArrayBuffer | Uint8Array | File | Blob
type NodeBinaryInput = string
export type EpubParserInput = ParserInput | BrowserBinaryInput | NodeBinaryInput
type NormalizedEpubInput = Uint8Array
type EpubImageKind = 'image' | 'cover'
type ImageDataUrl = {
  bytes: Uint8Array
  extension: string
  mimeType: string
}
type NodeProcessWithBuiltins = typeof process & {
  getBuiltinModule?: (moduleName: 'fs/promises') => {
    readFile(path: string): Promise<Uint8Array>
  }
}

export interface EpubDocumentMetadata {
  title: string
  identifier?: string
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
  data?: Uint8Array
  error?: string
}

export interface EpubDocumentExtensions {
  metadata: EpubDocumentMetadata
  epubMetadata: EpubDocumentMetadata
  epubImages: EpubAssetReference[]
  epubCover?: EpubAssetReference
  epubTocItems: EpubTocElement[]
  epubTocMappingLimitation?: string
}

type EpubMetadataSource = Record<string, unknown>
type EpubDocumentWithExtensions = IntermediateDocument & EpubDocumentExtensions
type QuadPolygon = [[number, number], [number, number], [number, number], [number, number]]

const unsupportedInputError = () => new Error('Unsupported EPUB input')
const invalidIntermediateError = (message: string) =>
  new Error(`Invalid intermediate document: ${message}`)
const PAGE_WIDTH = 800
const PAGE_MARGIN_X = 40
const PAGE_MARGIN_Y = 40
const MIN_IMAGE_WIDTH = (PAGE_WIDTH - PAGE_MARGIN_X * 2) * 7 / 10
const FONT_SIZE = 16
const LINE_HEIGHT = 24
const FONT_FAMILY = 'sans-serif'
const TEXT_COLOR = '#000000'
const CANONICAL_DOCUMENT_ID = /^epub-[0-9a-f]{16}$/

const isBlobLike = (input: unknown): input is Blob => {
  return typeof Blob !== 'undefined' && input instanceof Blob
}

const isArrayBuffer = (input: unknown): input is ArrayBuffer => {
  return input instanceof ArrayBuffer
}

const isNodeBuffer = (input: unknown): input is Buffer => {
  return typeof Buffer !== 'undefined' && Buffer.isBuffer(input)
}

const bytesToBase64 = (bytes: Uint8Array): string => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0
    const second = bytes[index + 1] ?? 0
    const third = bytes[index + 2] ?? 0
    const combined = (first << 16) | (second << 8) | third
    output += alphabet[(combined >> 18) & 63]
    output += alphabet[(combined >> 12) & 63]
    output += index + 1 < bytes.length ? alphabet[(combined >> 6) & 63] : '='
    output += index + 2 < bytes.length ? alphabet[combined & 63] : '='
  }
  return output
}

const base64ToBytes = (base64: string): Uint8Array => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const clean = base64.replace(/\s/g, '').replace(/=+$/, '')
  const output = new Uint8Array(Math.floor((clean.length * 6) / 8))
  let buffer = 0
  let bits = 0
  let outputIndex = 0
  for (const character of clean) {
    const value = alphabet.indexOf(character)
    if (value < 0) throw new Error('Invalid base64 image data')
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      output[outputIndex] = (buffer >> bits) & 0xff
      outputIndex += 1
    }
  }
  return output
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

const parseImageDataUrl = (src: string): ImageDataUrl | undefined => {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(src)
  if (!match) return undefined

  const [, mimeType, base64] = match
  const extension = mimeType.split('/')[1]?.replace(/[^a-z0-9]+/gi, '') || 'png'
  const bytes = base64ToBytes(base64)
  return { bytes, extension, mimeType }
}

const mimeTypeFromPath = (path: string): string => {
  const extension = path.split(/[?#]/)[0]?.split('.').pop()?.toLowerCase()
  const mediaTypes: Record<string, string> = {
    gif: 'image/gif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    svg: 'image/svg+xml',
    webp: 'image/webp'
  }
  return extension ? mediaTypes[extension] ?? 'application/octet-stream' : 'application/octet-stream'
}

const toImageDataUrl = (bytes: Uint8Array, mimeType: string): string => {
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`
}

const resolveEmbeddedImageSource = async (src: string): Promise<string | undefined> => {
  if (parseImageDataUrl(src)) return src

  if (/^https?:\/\//i.test(src)) {
    const response = await fetch(src)
    if (!response.ok) throw new Error(`Failed to load EPUB image: HTTP ${response.status}`)
    const responseMimeType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
    const mimeType = responseMimeType?.startsWith('image/') ? responseMimeType : mimeTypeFromPath(src)
    return toImageDataUrl(new Uint8Array(await response.arrayBuffer()), mimeType)
  }

  if (!/^file:\/\//i.test(src)) return undefined
  const fsPromises = typeof process === 'undefined'
    ? undefined
    : (process as NodeProcessWithBuiltins).getBuiltinModule?.('fs/promises')
  if (!fsPromises) return undefined

  const path = decodeURIComponent(new URL(src).pathname)
  return toImageDataUrl(await fsPromises.readFile(path), mimeTypeFromPath(path))
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

const renderImageParagraphs = async (images: IntermediateImage[]): Promise<string> => {
  const sources = await Promise.all(
    images.map(async (image) => {
      const src = await resolveEmbeddedImageSource(image.src)

      return src
        ? `<p style="text-align: center;"><img src="${escapeHtml(src)}" alt="${escapeHtml(image.id)}" style="display: block; width: auto; min-width: 70%; margin: 0 auto; max-width: 100%; height: auto; object-fit: contain;" /></p>`
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
): Promise<Uint8Array> => {
  if (isNodeBuffer(output)) {
    return new Uint8Array(output.buffer, output.byteOffset, output.byteLength).slice()
  }
  if (output instanceof Uint8Array) return output

  return new Uint8Array(await output.arrayBuffer())
}

const resolveDecodeCover = async (
  intermediateDocument: IntermediateDocument
): Promise<EpubGeneratorOptions['cover'] | undefined> => {
  const documentRecord = intermediateDocument as unknown as EpubDocumentWithExtensions
  const src = documentRecord.epubCover?.src ?? (await intermediateDocument.getCover(1))?.src

  if (!src) return undefined
  return resolveEmbeddedImageSource(src)
}

const readPathInput = async (path: string): Promise<Uint8Array> => {
  const nodeProcess: NodeProcessWithBuiltins | undefined =
    typeof process === 'undefined' ? undefined : process
  const fsPromises = nodeProcess?.getBuiltinModule?.('fs/promises')

  if (!nodeProcess?.versions?.node || !fsPromises) {
    throw unsupportedInputError()
  }

  return fsPromises.readFile(path)
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

/**
 * 生成跨运行时一致的 64 位内容指纹。这里使用两个独立的 32 位 FNV-1a
 * 累加器，避免依赖 Node.js crypto，同时保持浏览器和 Node.js 结果一致。
 */
const stableFingerprint = (bytes: Uint8Array): string => {
  let first = 0x811c9dc5
  let second = 0x9e3779b9

  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 0x01000193)
    second = Math.imul(second ^ byte, 0x85ebca6b)
  }

  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0)
    .toString(16)
    .padStart(8, '0')}`
}

const makeStableDocumentId = (
  metadata: EpubMetadataSource,
  input: Uint8Array
): string => {
  const identifier = getMetadataString(metadata, 'identifier', 'UUID')
  if (identifier && CANONICAL_DOCUMENT_ID.test(identifier)) return identifier

  const fingerprintSource = identifier ? new TextEncoder().encode(identifier) : input
  return `epub-${stableFingerprint(fingerprintSource)}`
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
  const identifier = getMetadataString(metadata, 'identifier', 'UUID')
  const author = getMetadataString(metadata, 'creator', 'author', 'creatorFileAs')
  const language = getMetadataString(metadata, 'language')
  const publisher = getMetadataString(metadata, 'publisher')
  const date = getMetadataString(metadata, 'date')

  return { title, identifier, author, language, publisher, date }
}

const textPolygon = (x: number, y: number, width: number, height: number): QuadPolygon => [
  [x, y],
  [x + width, y],
  [x + width, y + height],
  [x, y + height]
]

const dataUrlFromAsset = (asset: EpubAssetReference): string | undefined => {
  if (!asset.data || !asset.mimeType) {
    return asset.src
  }

  return `data:${asset.mimeType};base64,${bytesToBase64(asset.data)}`
}

type ChapterImagePlacement = {
  imageId: string
  textIndex: number
  width?: number
  height?: number
}

type ChapterImageContent = {
  image: IntermediateImage
  textIndex: number
}

type ChapterContentSource = {
  html: string
  imagePlacements: ChapterImagePlacement[]
}

const extractChapterContentSource = (html: string): ChapterContentSource => {
  const placements: ChapterImagePlacement[] = []
  const imagePattern = /<img\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi
  const srcPattern = /(?:^|\s)src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
  const dimension = (tag: string, name: 'width' | 'height'): number | undefined => {
    const attribute = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
    const style = /(?:^|\s)style\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)
    const styleValue = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([0-9.]+)px`, 'i').exec(style?.[1] ?? style?.[2] ?? '')?.[1]
    const value = attribute?.[1] ?? attribute?.[2] ?? attribute?.[3] ?? styleValue
    const parsed = value ? Number.parseFloat(value) : Number.NaN
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }
  let htmlWithoutImages = ''
  let precedingEnd = 0

  for (let match = imagePattern.exec(html); match !== null; match = imagePattern.exec(html)) {
    htmlWithoutImages += html.slice(precedingEnd, match.index)
    const srcMatch = srcPattern.exec(match[0])
    const src = srcMatch?.[1] ?? srcMatch?.[2] ?? srcMatch?.[3] ?? ''
    const rewrittenId = src.match(/\/images\/([^/]+)\//)?.[1]

    if (rewrittenId) {
      placements.push({
        imageId: rewrittenId,
        textIndex: parseChapterText(htmlWithoutImages, 'placement').texts.length,
        ...(dimension(match[0], 'width') ? { width: dimension(match[0], 'width') } : {}),
        ...(dimension(match[0], 'height') ? { height: dimension(match[0], 'height') } : {})
      })
      htmlWithoutImages += '\n'
    } else {
      htmlWithoutImages += match[0]
    }
    precedingEnd = imagePattern.lastIndex
  }

  return {
    html: htmlWithoutImages + html.slice(precedingEnd),
    imagePlacements: placements
  }
}

const createPageImages = (
  placements: ChapterImagePlacement[],
  assetById: Map<string, EpubAssetReference>,
  pageId: string
): ChapterImageContent[] => {
  return placements.flatMap((placement, index) => {
    const asset = assetById.get(placement.imageId)
    const src = asset ? dataUrlFromAsset(asset) : undefined

    if (!src) {
      return []
    }

    const intrinsic = readImageDimensions(asset?.data, asset?.mimeType ?? '')
    const sourceWidth = placement.width ?? intrinsic?.width ?? 240
    const sourceHeight = placement.height
      ?? (placement.width && intrinsic ? placement.width * intrinsic.height / intrinsic.width : intrinsic?.height)
      ?? 180
    const scale = Math.min(
      (PAGE_WIDTH - PAGE_MARGIN_X * 2) / sourceWidth,
      Math.max(1, MIN_IMAGE_WIDTH / sourceWidth)
    )
    const width = sourceWidth * scale
    const height = sourceHeight * scale
    const x = (PAGE_WIDTH - width) / 2

    return [
      {
        image: new IntermediateImage({
          id: `${pageId}-image-${index + 1}`,
          src,
          polygon: textPolygon(x, PAGE_MARGIN_Y, width, height),
          opacity: 1
        }),
        textIndex: placement.textIndex
      }
    ]
  })
}

const orderChapterContent = (
  texts: IntermediateText[],
  images: ChapterImageContent[]
): IntermediateContent[] => {
  const imagesByTextIndex = new Map<number, IntermediateImage[]>()

  images.forEach(({ image, textIndex: placementTextIndex }) => {
    const textIndex = Math.min(placementTextIndex, texts.length)
    const imagesAtIndex = imagesByTextIndex.get(textIndex) ?? []
    imagesAtIndex.push(image)
    imagesByTextIndex.set(textIndex, imagesAtIndex)
  })

  const content: IntermediateContent[] = []
  texts.forEach((text, index) => {
    content.push(...(imagesByTextIndex.get(index) ?? []), text)
  })
  content.push(...(imagesByTextIndex.get(texts.length) ?? []))
  return content
}

const layoutChapterContent = (
  content: IntermediateContent[],
  paragraphs: IntermediateParagraph[]
): number => {
  let y = PAGE_MARGIN_Y

  content.forEach((item) => {
    const x = item.polygon[0][0]
    const width = item.polygon[1][0] - item.polygon[0][0]
    const height = item instanceof IntermediateImage
      ? item.polygon[2][1] - item.polygon[1][1]
      : item.lineHeight
    item.polygon = textPolygon(x, y, width, height)
    if (item instanceof IntermediateText) {
      const paragraph = paragraphs.find((candidate) => candidate.textIds.includes(item.id))
      if (paragraph) {
        paragraph.y = y
        paragraph.height = height
      }
    }
    y += height + (item instanceof IntermediateImage ? 40 : 0)
  })

  return Math.max(1000, y + PAGE_MARGIN_Y)
}

const isImageManifestItem = (item: EpubManifestItem): boolean => {
  return String(item['media-type'] ?? '').toLowerCase().startsWith('image/')
}

const getManifestItemProperties = (item: EpubManifestItem): string => {
  return String(item.properties ?? item['@_properties'] ?? '').toLowerCase()
}

const isNavigationManifestItem = (item: EpubManifestItem): boolean => {
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
  manifest: Record<string, EpubManifestItem>,
  href: string | undefined
): EpubManifestItem | undefined => {
  if (!href) {
    return undefined
  }

  const hrefWithoutAnchor = href.split('#')[0]
  return Object.values(manifest).find((item) => item.href.split('#')[0] === hrefWithoutAnchor)
}

const findCoverId = (epub: EpubArchive): string | undefined => {
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

const collectImageAssets = async (epub: EpubArchive): Promise<EpubAssetReference[]> => {
  const coverId = findCoverId(epub)
  const imageItems = Object.values(epub.manifest).filter(isImageManifestItem)
  const assets: EpubAssetReference[] = []

  // Inflate images sequentially so several compressed assets cannot peak in memory together.
  for (const item of imageItems) {
    const kind: EpubImageKind = item.id === coverId ? 'cover' : 'image'
    const baseReference: EpubAssetReference = {
      id: item.id,
      href: item.href,
      mimeType: item['media-type'],
      kind
    }

    try {
      const image = await epub.getImage(item.id)
      assets.push({
        ...baseReference,
        data: image.data,
        mimeType: image.mimeType,
        src: `data:${image.mimeType};base64,${bytesToBase64(image.data)}`
      })
    } catch (error) {
      assets.push({
        ...baseReference,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return assets
}

const findPageIdForTocItem = (
  tocItem: EpubTocElement,
  pageIdByManifestId: Map<string, string>,
  manifest: Record<string, EpubManifestItem>
): string | undefined => {
  const targetItem = findManifestItemByHref(manifest, tocItem.href)
  return targetItem ? pageIdByManifestId.get(targetItem.id) : undefined
}

type OutlineResolutionContext = {
  readonly pageIdByManifestId: Map<string, string>
  readonly manifest: Record<string, EpubManifestItem>
  readonly textIdByPageIdAndSourceId: ReadonlyMap<string, ReadonlyMap<string, string>>
}

const getTocFragment = (href: string): string | undefined => {
  const fragmentIndex = href.indexOf('#')
  if (fragmentIndex < 0 || fragmentIndex === href.length - 1) return undefined
  const fragment = href.slice(fragmentIndex + 1)
  try {
    return decodeURIComponent(fragment)
  } catch (error) {
    if (!(error instanceof URIError)) throw error
    return fragment
  }
}

const buildOutline = (
  toc: EpubTocElement[],
  context: OutlineResolutionContext
): IntermediateOutline[] | undefined => {
  const outline = toc
    .filter((item) => item.title?.trim())
    .map((item, index) => {
      const pageId = findPageIdForTocItem(
        item,
        context.pageIdByManifestId,
        context.manifest
      )
      const fragment = getTocFragment(item.href)
      const textId = pageId && fragment
        ? context.textIdByPageIdAndSourceId.get(pageId)?.get(fragment)
        : undefined
      const dest: IntermediateOutlineDest = textId
        ? {
            targetType: IntermediateOutlineDestType.TEXT,
            textId
          }
        : pageId
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

const readChapterHtml = async (epub: EpubArchive, chapterId: string): Promise<string> => {
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

  async encode(input: EpubParserInput): Promise<IntermediateDocument> {
    const doc = await EpubParser.encode(input)
    return doc.getIntermediateDocument()
  }

  async decode(
    intermediateDocument: IntermediateDocument
  ): Promise<Uint8Array> {
    return EpubParser.decode(intermediateDocument)
  }

  static async encode(fileOrBuffer: EpubParserInput): Promise<EpubDocument> {
    const normalizedInput = await normalizeInput(fileOrBuffer)
    const epub = new EpubArchive(normalizedInput)

    try {
      await epub.parse()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to parse EPUB: ${message}`)
    }

    const id = makeStableDocumentId(epub.metadata as EpubMetadataSource, normalizedInput)
    const metadata = extractEpubMetadata(epub.metadata as EpubMetadataSource)
    const imageAssets = await collectImageAssets(epub)
    const assetById = new Map(imageAssets.map((asset) => [asset.id, asset]))
    const pageIdByManifestId = new Map<string, string>()
    const textIdByPageIdAndSourceId = new Map<string, ReadonlyMap<string, string>>()

    const contentFlow = epub.flow.filter((flowItem) => !isNavigationManifestItem(flowItem))
    const firstFlowItem = contentFlow[0]
    const firstChapterHtml = firstFlowItem
      ? await readChapterHtml(epub, firstFlowItem.id)
      : undefined
    const coverAsset = imageAssets.find((asset) => asset.kind === 'cover')
    const coverSrc = coverAsset ? dataUrlFromAsset(coverAsset) : undefined
    const firstChapterImageIds = firstChapterHtml
      ? extractChapterContentSource(firstChapterHtml).imagePlacements.map(({ imageId }) => imageId)
      : []
    const coverIsFirstSpinePage = coverSrc
      ? firstChapterImageIds.some((imageId) => {
          const chapterAsset = assetById.get(imageId)
          return chapterAsset ? dataUrlFromAsset(chapterAsset) === coverSrc : false
        })
      : false
    const infoList = []
    if (coverSrc && !coverIsFirstSpinePage) {
      const pageId = `${id}-page-1`
      const coverImage = new IntermediateImage({
        id: `${pageId}-image-1`,
        src: coverSrc,
        polygon: textPolygon(PAGE_MARGIN_X, PAGE_MARGIN_Y, 720, 920),
        opacity: 1
      })

      infoList.push({
        id: pageId,
        pageNumber: 1,
        size: { x: PAGE_WIDTH, y: 1000 },
        getData: async () =>
          new IntermediatePage({
            id: pageId,
            number: 1,
            width: PAGE_WIDTH,
            height: 1000,
            content: [coverImage],
            thumbnail: undefined,
            useFlowLayout: true
          })
      })
    }

    const pageNumberOffset = infoList.length
    for (const [index, flowItem] of contentFlow.entries()) {
      const pageNumber = index + pageNumberOffset + 1
      const pageId = `${id}-page-${pageNumber}`
      pageIdByManifestId.set(flowItem.id, pageId)

      const html = index === 0 && firstChapterHtml !== undefined
        ? firstChapterHtml
        : await readChapterHtml(epub, flowItem.id)
      const chapterSource = extractChapterContentSource(html)
      const { texts, paragraphs, textIdBySourceId } = parseChapterText(chapterSource.html, pageId)
      textIdByPageIdAndSourceId.set(pageId, textIdBySourceId)
      const images = createPageImages(
        chapterSource.imagePlacements,
        assetById,
        pageId
      )
      const content = orderChapterContent(texts, images)
      const pageHeight = layoutChapterContent(content, paragraphs)

      infoList.push({
        id: pageId,
        pageNumber,
        size: { x: PAGE_WIDTH, y: pageHeight },
        getData: async () =>
          new IntermediatePage({
            id: pageId,
            number: pageNumber,
            width: PAGE_WIDTH,
            height: pageHeight,
            content,
            paragraphs,
            thumbnail: undefined,
            useFlowLayout: true
          })
      })
    }

    const outline = buildOutline(epub.toc, {
      pageIdByManifestId,
      manifest: epub.manifest,
      textIdByPageIdAndSourceId
    })

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
    documentWithEpubData.epubCover = coverAsset
    documentWithEpubData.epubTocItems = epub.toc

    if (!outline && epub.toc.length === 0) {
      documentWithEpubData.epubTocMappingLimitation =
        'The EPUB did not expose NCX or EPUB 3 navigation TOC items.'
    }

    return new EpubDocument(intermediateDocument)
  }

  static async decode(
    intermediateDocument: IntermediateDocument
  ): Promise<Uint8Array> {
    if (!(intermediateDocument instanceof IntermediateDocument)) {
      throw invalidIntermediateError('document must be an IntermediateDocument')
    }

    const title = stringFromUnknown(intermediateDocument.title)
    if (!title) throw invalidIntermediateError('title is required')

    const pages = await intermediateDocument.pages
    if (!pages.length) throw invalidIntermediateError('at least one page is required')

    const documentRecord = intermediateDocument as unknown as Record<string, unknown>
    const author = getMetadataStringOrArrayFromDocument(documentRecord, [
      'author',
      'creator',
      'creators',
      'creatorFileAs'
    ])
    const publisher = getMetadataStringFromDocument(documentRecord, ['publisher'])
    const date = getMetadataStringFromDocument(documentRecord, ['date', 'published', 'modified'])
    const lang = getMetadataStringFromDocument(documentRecord, ['language', 'lang'])
    const cover = await resolveDecodeCover(intermediateDocument)
    const options: EpubGeneratorOptions = {
      title,
      identifier: intermediateDocument.id,
      ...(author ? { author } : {}),
      ...(publisher ? { publisher } : {}),
      ...(date ? { date } : {}),
      ...(lang ? { lang } : {}),
      ...(cover ? { cover } : {})
    }

    const content: EpubContentItem[] = await Promise.all(
        [...pages]
          .sort((a, b) => a.number - b.number)
          .map(async (page, index) => {
            const pageContent = await page.getContent()
            const texts = pageContent.filter(isIntermediateTextContent)
            const images = pageContent.filter(isIntermediateImageContent)
            const html = `${renderTextParagraphs(texts)}${await renderImageParagraphs(images)}`

            return {
              title: makePageTitle(page, index),
              content: html || '<p></p>',
              excludeFromToc: false
            }
          })
    )

    const output = await normalizeGeneratedOutput(await generateEpub(options, content))
    assertZipMagic(output)

    return output
  }
}

export async function normalizeInput(
  input: EpubParserInput
): Promise<NormalizedEpubInput> {
  if (isNodeBuffer(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength).slice()
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
