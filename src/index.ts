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
import { EpubArchive } from './EpubArchive.js'
import type { EpubManifestItem, EpubTocElement } from './EpubArchiveTypes.js'
import {
  generateEpub,
  type EpubContentItem,
  type EpubGeneratorOptions
} from './EpubGenerator.js'
import { EpubDocument } from './EpubDocument.js'

export { EpubDocument } from './EpubDocument.js'
export { EpubPage, RenderViews, type RenderOptions } from './EpubPage.js'

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
const FONT_SIZE = 16
const LINE_HEIGHT = 24
const FONT_FAMILY = 'sans-serif'
const TEXT_COLOR = '#000000'
const CANONICAL_DOCUMENT_ID = /^epub-[0-9a-f]{16}$/

/**
 * 标题层级 → 字号映射（基准 16px，接近常见 EPUB 阅读器的排版比例）
 */
const HEADING_FONT_SIZES: Record<number, number> = {
  1: 28,
  2: 24,
  3: 20,
  4: 18,
  5: 16,
  6: 16
}

/** 脚注/辅助文本（sup/sub/small/aside[footnote]/epub:type=noteref）的字号 */
const FOOTNOTE_FONT_SIZE = 12

/** 行高统一取字号的 1.5 倍，与正文 16px→24px 保持一致 */
const lineHeightForFontSize = (fontSize: number): number => fontSize * 1.5

/**
 * 带语义样式的文本行 —— htmlToStyledTextLines 的输出，
 * 承载从 HTML 标签（h1-h6、sup、aside、b/i 等）推断出的排版信息。
 */
type StyledTextLine = {
  content: string
  fontSize: number
  lineHeight: number
  fontWeight: number
  italic: boolean
}

/** 行内样式标记已内联为字符串集合（'h1'..'h6' | 'fn' | 'b' | 'i'），无需独立类型 */

// 哨兵字符：EPUB 章节正文中不会出现私用区码点，用作标签边界的占位符
const SENTINEL_OPEN = '\uE000'
const SENTINEL_CLOSE = '\uE001'

/** 用哨兵包裹标签名的正则替换，保留语义供后续分段解析 */
const markTag = (html: string, tagPattern: RegExp, name: string): string =>
  html.replace(tagPattern, `${SENTINEL_OPEN}${name}${SENTINEL_CLOSE}`)

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
    const mimeType = response.headers.get('content-type')?.split(';')[0] || mimeTypeFromPath(src)
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
 * 从 EPUB 章节 HTML 中提取带语义样式的文本行。
 *
 * **注意：这不是一个完整的 HTML 解析器。** 它在原有正则文本提取的基础上，
 * 先用私用区哨兵字符（\uE000/\uE001）为语义标签打标记，再按行解释这些标记，
 * 从而在不引入 DOM 的前提下保留标题层级、脚注、粗体、斜体等排版信息。
 *
 * 处理流程：
 * 1. 移除 <script> 和 <style> 标签及其内容
 * 2. 为 h1-h6、sup/sub/small、aside[footnote]、epub:type=noteref、b/strong、i/em 打哨兵标记
 * 3. 将块级标签（p、div、h1-h6 等）和 <br> 转换为换行符
 * 4. 剥离剩余 HTML 标签并解码 HTML 实体
 * 5. 按行切分，解释每行内的哨兵标记，合成该行的样式（取"最强"语义：标题 > 脚注 > 粗斜体）
 * 6. 清理空白，过滤空行
 */
const htmlToStyledTextLines = (html: string): StyledTextLine[] => {
  // 第一步：剥离 script/style，随后给语义标签打哨兵标记（标记格式：\uE000名称\uE001）
  let marked = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')

  // 标题 h1-h6：开标签标记为 h1..h6，闭标签标记为 /h1../h6（带斜杠前缀表示关闭）。
  // 标题本身是块级元素，开闭标签都附带换行，
  // 这样原本靠 </h1> 等块级闭合产生的行边界在哨兵替换后仍然保留。
  marked = marked.replace(
    /<h([1-6])\b[^>]*>/gi,
    (_match, level) => `\n${SENTINEL_OPEN}h${level}${SENTINEL_CLOSE}\n`
  )
  marked = marked.replace(
    /<\/h([1-6])\s*>/gi,
    (_match, level) => `\n${SENTINEL_OPEN}/h${level}${SENTINEL_CLOSE}\n`
  )
  // 脚注类（行级）：aside[footnote] 整块、small 文本按小字号处理。
  // aside 是块级元素，与标题一样在哨兵两侧附带换行以保留行边界。
  // sup/sub/noteref 属于行内上标引用，行级样式保持正文（由渲染层自行处理上标），
  // 因此不参与行级标记。
  marked = marked.replace(/<aside\b[^>]*>/gi, `\n${SENTINEL_OPEN}fn${SENTINEL_CLOSE}\n`)
  marked = marked.replace(/<\/aside\s*>/gi, `\n${SENTINEL_OPEN}/fn${SENTINEL_CLOSE}\n`)
  // small/b/i 是行内元素：开闭哨兵不附带换行，通常与内容同行
  marked = markTag(marked, /<(small)\b[^>]*>/gi, 'fn')
  marked = markTag(marked, /<\/(small)\s*>/gi, '/fn')
  marked = markTag(marked, /<(?:b|strong)\b[^>]*>/gi, 'b')
  marked = markTag(marked, /<\/(?:b|strong)\s*>/gi, '/b')
  marked = markTag(marked, /<(?:i|em)\b[^>]*>/gi, 'i')
  marked = markTag(marked, /<\/(?:i|em)\s*>/gi, '/i')

  // 第二步：块级边界转换为换行（哨兵标记不受影响，会随行保留）
  const withBreaks = marked
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|footer|li|tr|table)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n')
    // 标题标签已在打标记阶段被哨兵替换，这里无需再处理
    .replace(/<[^>]+>/g, ' ')
    .replace(/&([a-zA-Z][a-zA-Z0-9]+|#[0-9]+|#x[0-9a-fA-F]+);/g, (_match, entity) =>
      decodeHtmlEntity(entity)
    )

  // 第三步：逐行解释哨兵标记，合成样式。
  // 样式来源 = 进入本行时的跨行激活状态 ∪ 本行内的开哨兵：
  // - 块级元素（h1-h6、aside）的开/闭哨兵通常独占一行，靠跨行状态把样式传给内容行；
  // - 行内元素（small/b/i）的开闭哨兵与内容同行，必须记入行级标记，
  //   否则同一行内先开後闭会把状态清零、丢失粗斜体。
  const sentinelPattern = new RegExp(`${SENTINEL_OPEN}([^\uE001]*)${SENTINEL_CLOSE}`, 'g')

  let activeHeading = 0
  let activeFootnote = false
  let activeBold = false
  let activeItalic = false

  return withBreaks
    .split(/\r?\n/)
    .map((rawLine) => {
      // 进入本行时的激活状态即为本行基础样式
      const lineMarks = new Set<string>()
      if (activeHeading) lineMarks.add(`h${activeHeading}`)
      if (activeFootnote) lineMarks.add('fn')
      if (activeBold) lineMarks.add('b')
      if (activeItalic) lineMarks.add('i')

      for (const match of rawLine.matchAll(sentinelPattern)) {
        const name = match[1]
        const isClose = name.startsWith('/')
        const base = isClose ? name.slice(1) : name
        const headingMatch = /^h([1-6])$/.exec(base)
        if (headingMatch) {
          activeHeading = isClose ? 0 : Number(headingMatch[1])
          if (!isClose) lineMarks.add(base)
        } else if (base === 'fn') {
          activeFootnote = !isClose
          if (!isClose) lineMarks.add('fn')
        } else if (base === 'b') {
          activeBold = !isClose
          if (!isClose) lineMarks.add('b')
        } else if (base === 'i') {
          activeItalic = !isClose
          if (!isClose) lineMarks.add('i')
        }
      }
      const content = rawLine
        .replace(sentinelPattern, '')
        .replace(/\s+/g, ' ')
        .trim()
      if (!content) return undefined

      const headingLevel = [1, 2, 3, 4, 5, 6].find((level) => lineMarks.has(`h${level}`))
      const isFootnote = lineMarks.has('fn')
      const isBold = lineMarks.has('b')
      const isItalic = lineMarks.has('i')

      // 样式合成：标题 > 脚注 > 正文；粗斜体可叠加在任意级别上
      const fontSize = headingLevel
        ? HEADING_FONT_SIZES[headingLevel]
        : isFootnote
          ? FOOTNOTE_FONT_SIZE
          : FONT_SIZE
      return {
        content,
        fontSize,
        lineHeight: lineHeightForFontSize(fontSize),
        fontWeight: headingLevel || isBold ? 700 : 400,
        italic: isItalic
      }
    })
    .filter((line): line is StyledTextLine => line !== undefined)
}

const textPolygon = (x: number, y: number, width: number, height: number): QuadPolygon => [
  [x, y],
  [x + width, y],
  [x + width, y + height],
  [x, y + height]
]

const makeText = (id: string, line: StyledTextLine, x: number, y: number): IntermediateText => {
  // 宽度估算按字号等比缩放：8px/字符 是基准字号 16px 时的经验值
  const width = Math.min(
    PAGE_WIDTH - PAGE_MARGIN_X * 2,
    Math.max(80, line.content.length * 8 * (line.fontSize / FONT_SIZE))
  )

  return new IntermediateText({
    id,
    content: line.content,
    fontSize: line.fontSize,
    fontFamily: FONT_FAMILY,
    fontWeight: line.fontWeight,
    italic: line.italic,
    color: TEXT_COLOR,
    polygon: textPolygon(x, y, width, line.lineHeight),
    lineHeight: line.lineHeight,
    ascent: line.fontSize * 0.8,
    descent: line.fontSize * 0.2,
    dir: TextDir.LTR,
    opacity: 1,
    skew: 0,
    isEOL: true
  })
}

/**
 * 章节 HTML → 文本内容列表。y 坐标按各行实际 lineHeight 累计，
 * 因此标题（更高行高）之后的内容会自然下移，不再按固定 24px 等距排布。
 */
const htmlToTexts = (html: string, pageId: string): IntermediateText[] => {
  const lines = htmlToStyledTextLines(html)
  const texts: IntermediateText[] = []
  let y = PAGE_MARGIN_Y

  lines.forEach((line, index) => {
    texts.push(makeText(`${pageId}-text-${index + 1}`, line, PAGE_MARGIN_X, y))
    y += line.lineHeight
  })

  return texts
}

const getPageHeight = (contentCount: number, imageCount = 0, textBlockHeight?: number): number => {
  // textBlockHeight 为各行 lineHeight 的实际总和；缺省时回退到旧的等距估算
  const textHeight =
    PAGE_MARGIN_Y * 2 + (textBlockHeight ?? Math.max(1, contentCount) * LINE_HEIGHT)
  const imageHeight = imageCount * 220
  return Math.max(1000, textHeight + imageHeight)
}

/** 文本块实际占用高度（各行 lineHeight 之和，供页面高度与图片起始位置使用） */
const sumTextBlockHeight = (texts: IntermediateText[]): number =>
  texts.reduce((sum, text) => sum + text.lineHeight, 0)

const dataUrlFromAsset = (asset: EpubAssetReference): string | undefined => {
  if (!asset.data || !asset.mimeType) {
    return asset.src
  }

  return `data:${asset.mimeType};base64,${bytesToBase64(asset.data)}`
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
  if (pageIdByManifestId.has(tocItem.id)) {
    return pageIdByManifestId.get(tocItem.id)
  }

  const targetItem = findManifestItemByHref(manifest, tocItem.href)
  return targetItem ? pageIdByManifestId.get(targetItem.id) : undefined
}

const buildOutline = (
  toc: EpubTocElement[],
  pageIdByManifestId: Map<string, string>,
  manifest: Record<string, EpubManifestItem>
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

    const contentFlow = epub.flow.filter((flowItem) => !isNavigationManifestItem(flowItem))
    const infoList = []
    for (const [index, flowItem] of contentFlow.entries()) {
        const pageNumber = index + 1
        const pageId = `${id}-page-${pageNumber}`
        pageIdByManifestId.set(flowItem.id, pageId)

        const html = await readChapterHtml(epub, flowItem.id)
        const texts = htmlToTexts(html, pageId)
        const chapterImageIds = extractChapterImageIds(html)
        // 文本块实际高度随各行行高变化（标题更高），图片与页面高度都以此为准
        const textBlockHeight = Math.max(sumTextBlockHeight(texts), LINE_HEIGHT)
        const images = createPageImages(
          chapterImageIds,
          assetById,
          pageId,
          PAGE_MARGIN_Y + textBlockHeight + LINE_HEIGHT
        )
        const pageHeight = getPageHeight(texts.length, images.length, textBlockHeight)

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
              content: [...texts, ...images],
              thumbnail: undefined
            })
        })
    }

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
