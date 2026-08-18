import {
  IntermediateParagraph,
  IntermediateText,
  type IntermediateTextAlign,
  TextDir
} from '@hamster-note/types'
import { DOMParser } from 'linkedom'

const PAGE_WIDTH = 800
const PAGE_MARGIN_X = 40
const PAGE_MARGIN_Y = 40
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN_X * 2
const DEFAULT_FONT_SIZE = 16
const DEFAULT_FONT_FAMILY = 'sans-serif'
const NOTE_FONT_SIZE = 13
const NOTE_COLOR = '#5f5b53'
const BLOCK_SELECTOR = 'p,div,section,article,header,footer,li,aside,h1,h2,h3,h4,h5,h6'
const COMPACT_TEXT_SELECTOR = 'aside,small'
const NOTE_SELECTOR = [
  '[role="note"]',
  '[role="doc-footnote"]',
  '[role="doc-endnote"]',
  '[epub\\:type~="note"]',
  '[epub\\:type~="footnote"]',
  '[epub\\:type~="endnote"]',
  '[class~="footnote" i]',
  '[class~="endnote" i]',
  '[class~="note" i]'
].join(',')
const TEXT_ALIGNMENTS = new Set<IntermediateTextAlign>([
  'start',
  'end',
  'left',
  'right',
  'center',
  'justify'
])

type CssDeclarations = Readonly<Record<string, string>>
type CssRule = {
  readonly selector: string
  readonly declarations: CssDeclarations
}
type CssDocument = {
  readonly querySelectorAll: (selectors: string) => NodeListOf<Element>
}
type ResolvedTextStyle = {
  readonly fontSize: number
  readonly fontFamily: string
  readonly fontWeight: number
  readonly italic: boolean
  readonly color: string
  readonly textAlign?: IntermediateTextAlign
  readonly textIndent?: number
}
export type ParsedChapterText = {
  readonly texts: IntermediateText[]
  readonly paragraphs: IntermediateParagraph[]
  readonly textIdBySourceId: ReadonlyMap<string, string>
}

const parseDeclarations = (source: string): CssDeclarations => {
  const declarations: Record<string, string> = {}
  for (const declaration of source.split(';')) {
    const separator = declaration.indexOf(':')
    if (separator < 0) continue
    const property = declaration.slice(0, separator).trim().toLowerCase()
    const value = declaration.slice(separator + 1).trim()
    if (property && value) declarations[property] = value
  }
  return declarations
}

const parseCssRules = (document: CssDocument): CssRule[] => {
  const rules: CssRule[] = []
  for (const style of document.querySelectorAll('style')) {
    const css = (style.textContent ?? '').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = (match[1] ?? '').split(',').map((selector) => selector.trim())
      const declarations = parseDeclarations(match[2] ?? '')
      for (const selector of selectors) {
        if (selector) rules.push({ selector, declarations })
      }
    }
  }
  return rules
}

const matchingDeclarations = (element: Element, rules: readonly CssRule[]): CssDeclarations => {
  const declarations: Record<string, string> = {}
  for (const rule of rules) {
    try {
      if (element.matches(rule.selector)) Object.assign(declarations, rule.declarations)
    } catch (error) {
      if (!(error instanceof Error)) throw error
    }
  }
  Object.assign(declarations, parseDeclarations(element.getAttribute('style') ?? ''))
  return declarations
}

const parseLength = (value: string | undefined, base: number, percentBase = base): number | undefined => {
  if (!value) return undefined
  const match = /^(-?[0-9]*\.?[0-9]+)\s*(px|pt|em|rem|%)?$/i.exec(value.trim())
  if (!match) return undefined
  const amount = Number(match[1])
  const unit = (match[2] ?? 'px').toLowerCase()
  if (unit === 'pt') return amount * (4 / 3)
  if (unit === 'em') return amount * base
  if (unit === 'rem') return amount * DEFAULT_FONT_SIZE
  if (unit === '%') return amount * percentBase / 100
  return amount
}

const firstFontFamily = (value: string | undefined, fallback: string): string => {
  const first = value?.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '')
  return first || fallback
}

const resolveStyle = (element: Element, rules: readonly CssRule[]): ResolvedTextStyle => {
  const ancestors: Element[] = []
  for (let current: Element | null = element; current; current = current.parentElement) {
    ancestors.unshift(current)
  }

  let fontSize = DEFAULT_FONT_SIZE
  let fontFamily = DEFAULT_FONT_FAMILY
  let fontWeight = 400
  let italic = false
  let textAlign: IntermediateTextAlign | undefined
  let textIndent: number | undefined

  for (const current of ancestors) {
    const declarations = matchingDeclarations(current, rules)
    fontSize = parseLength(declarations['font-size'], fontSize) ?? fontSize
    fontFamily = firstFontFamily(declarations['font-family'], fontFamily)
    const weight = declarations['font-weight']?.toLowerCase()
    if (weight === 'bold' || weight === 'bolder') fontWeight = 700
    else if (weight && Number.isFinite(Number(weight))) fontWeight = Number(weight)
    const fontStyle = declarations['font-style']?.toLowerCase()
    if (fontStyle) italic = fontStyle === 'italic' || fontStyle === 'oblique'
    const alignment = declarations['text-align']?.toLowerCase()
    if (alignment && TEXT_ALIGNMENTS.has(alignment as IntermediateTextAlign)) {
      textAlign = alignment as IntermediateTextAlign
    }
    if (declarations['text-indent'] !== undefined) {
      textIndent = parseLength(declarations['text-indent'], fontSize, CONTENT_WIDTH)
    }
  }

  const heading = /^H([1-6])$/.exec(element.tagName)
  if (heading) {
    const headingSizes = [28, 24, 20, 18, 16, 16]
    fontSize = headingSizes[Number(heading[1]) - 1] ?? fontSize
    fontWeight = 700
  }
  const isNote = element.closest(NOTE_SELECTOR) !== null
  if (element.closest(COMPACT_TEXT_SELECTOR) || isNote) {
    fontSize = Math.min(fontSize, NOTE_FONT_SIZE)
  }
  if (isNote) {
    italic = true
  }
  if (element.closest('b,strong') || element.querySelector('b,strong')) fontWeight = 700
  if (element.closest('i,em') || element.querySelector('i,em')) italic = true
  const alignAttribute = element.getAttribute('align')?.toLowerCase()
  if (alignAttribute && TEXT_ALIGNMENTS.has(alignAttribute as IntermediateTextAlign)) {
    textAlign = alignAttribute as IntermediateTextAlign
  }

  return {
    fontSize,
    fontFamily,
    fontWeight,
    italic,
    color: isNote ? NOTE_COLOR : '#000000',
    textAlign,
    textIndent
  }
}

const leadingWhitespaceIndent = (source: string, fontSize: number): number => {
  const leadingWhitespace = /^[\t ]+/.exec(source)?.[0]
  if (!leadingWhitespace) return 0

  // EPUB 正文常用半角空格表达首行缩进；tab 按 4 个空格处理。
  const columns = [...leadingWhitespace].reduce(
    (total, character) => total + (character === '\t' ? 4 : 1),
    0
  )
  return columns >= 4 ? columns * fontSize * 0.5 : 0
}

const rectangle = (x: number, y: number, width: number, height: number) => [
  [x, y],
  [x + width, y],
  [x + width, y + height],
  [x, y + height]
] as [[number, number], [number, number], [number, number], [number, number]]

export const parseChapterText = (html: string, pageId: string): ParsedChapterText => {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const rules = parseCssRules(document)
  const body = document.body ?? document.documentElement
  const blocks = [...body.querySelectorAll(BLOCK_SELECTOR)].filter(
    (element) => !element.querySelector(BLOCK_SELECTOR)
  )
  const sources = blocks.length > 0 ? blocks : [body]
  const texts: IntermediateText[] = []
  const paragraphs: IntermediateParagraph[] = []
  const textIdBySourceId = new Map<string, string>()
  let y = PAGE_MARGIN_Y

  for (const element of sources) {
    const style = resolveStyle(element, rules)
    const sourceText = element.textContent ?? ''
    const textIndent = style.textIndent ?? leadingWhitespaceIndent(sourceText, style.fontSize)
    const lines = sourceText.split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
    const firstTextId = `${pageId}-text-${texts.length + 1}`
    for (const descendant of element.querySelectorAll('[id]')) {
      const sourceId = descendant.getAttribute('id')
      const anchorLine = (descendant.textContent ?? '')
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .find(Boolean)
      if (!sourceId || !anchorLine || textIdBySourceId.has(sourceId)) continue
      const matchingLineIndexes = lines
        .map((line, index) => line.includes(anchorLine) ? index : -1)
        .filter((index) => index >= 0)
      if (matchingLineIndexes.length === 1) {
        textIdBySourceId.set(sourceId, `${pageId}-text-${texts.length + matchingLineIndexes[0] + 1}`)
      }
    }
    for (let current: Element | null = element; current && current !== body; current = current.parentElement) {
      const sourceId = current.getAttribute('id')
      if (sourceId && !textIdBySourceId.has(sourceId)) textIdBySourceId.set(sourceId, firstTextId)
    }
    for (const [lineIndex, content] of lines.entries()) {
      const id = `${pageId}-text-${texts.length + 1}`
      const lineHeight = style.fontSize * 1.5
      const width = Math.min(CONTENT_WIDTH, Math.max(80, content.length * 8 * style.fontSize / DEFAULT_FONT_SIZE))
      const x = style.textAlign === 'right' || style.textAlign === 'end'
        ? PAGE_WIDTH - PAGE_MARGIN_X - width
        : style.textAlign === 'center'
          ? (PAGE_WIDTH - width) / 2
          : PAGE_MARGIN_X + (lineIndex === 0 ? Math.max(0, textIndent) : 0)
      texts.push(new IntermediateText({
        id,
        content,
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        italic: style.italic,
        color: style.color,
        polygon: rectangle(x, y, width, lineHeight),
        lineHeight,
        ascent: style.fontSize * 0.8,
        descent: style.fontSize * 0.2,
        dir: TextDir.LTR,
        opacity: 1,
        skew: 0,
        isEOL: true
      }))
      paragraphs.push(new IntermediateParagraph({
        id: `${pageId}-paragraph-${paragraphs.length + 1}`,
        x: PAGE_MARGIN_X,
        y,
        width: CONTENT_WIDTH,
        height: lineHeight,
        textIds: [id],
        ...(style.textAlign ? { textAlign: style.textAlign } : {})
      }))
      y += lineHeight
    }
  }

  return { texts, paragraphs, textIdBySourceId }
}
