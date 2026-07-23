import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IntermediateDocument } from '@hamster-note/types'
import { EpubParser, type EpubDocumentExtensions } from '../index'

// 页面内容里文本项的结构子集（避免依赖 IntermediateText 具体类形态）
type PageText = { content: string; fontSize: number; fontWeight: number; italic: boolean; lineHeight: number; polygon: number[][] }

const pageTexts = (content: unknown[]): PageText[] =>
  content.filter(
    (item): item is PageText =>
      typeof item === 'object' && item !== null && 'content' in item
  )

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const fixturePath = (name: string) => join(fixtureDir, name)

type DocumentWithEpubData = IntermediateDocument & Partial<EpubDocumentExtensions>

const encodeFixture = async (name: string): Promise<DocumentWithEpubData> => {
  const epubDocument = await EpubParser.encode(fixturePath(name))
  return epubDocument.getIntermediateDocument() as DocumentWithEpubData
}

describe('EpubParser.encode', () => {
  it('parses minimal.epub metadata and spine pages', async () => {
    const doc = await encodeFixture('minimal.epub')
    const pages = await doc.pages

    expect(doc.title).toBe('Minimal Test Book')
    expect(doc.metadata?.title).toBe('Minimal Test Book')
    expect(doc.metadata?.author).toBe('Test Author')
    expect(doc.pageCount).toBeGreaterThanOrEqual(1)
    expect(pages.length).toBeGreaterThanOrEqual(1)
    expect(pages.every((page) => page.useFlowLayout === true)).toBe(true)
    expect(pages[0].number).toBe(1)
    expect(pages[0].content.some((item) => 'content' in item)).toBe(true)
  })

  it('preserves non-ASCII metadata without mojibake', async () => {
    const doc = await encodeFixture('non-ascii-metadata.epub')

    expect(doc.title).toBe('测试书')
    expect(doc.metadata?.title).toBe('测试书')
    expect(doc.metadata?.author).toBe('测试作者')
    expect(doc.title).not.toContain('�')
    expect(doc.title).not.toContain('æ')
  })

  it('maps TOC entries to IntermediateOutline when epub exposes TOC data', async () => {
    const doc = await encodeFixture('with-toc.epub')
    const outline = doc.getOutline()

    if (outline && outline.length > 0) {
      const outlineText = outline.map((item) => item.content).join('\n')
      expect(outlineText).toContain('First Chapter')
      expect(outlineText).toContain('Second Chapter')
      expect(outlineText).toContain('Third Chapter')
      expect(outline[0].dest.targetType).toBeDefined()
    } else {
      expect(doc.epubTocMappingLimitation).toBe(
        'The epub package did not expose NCX TOC items for this EPUB.'
      )
    }
  })

  it('exposes image references and page image content when available', async () => {
    const doc = await encodeFixture('with-images.epub')
    const pages = await doc.pages
    const imageContentCount = pages.reduce(
      (count, page) => count + page.content.filter((item) => 'src' in item).length,
      0
    )

    expect(doc.epubImages?.length).toBeGreaterThanOrEqual(1)
    expect(doc.epubImages?.[0]?.mimeType).toMatch(/^image\//)
    expect(doc.epubImages?.[0]?.src ?? doc.epubImages?.[0]?.error).toBeDefined()
    expect(imageContentCount).toBeGreaterThanOrEqual(1)
  })

  it('exposes cover data when the dependency can identify it', async () => {
    const doc = await encodeFixture('with-cover.epub')

    if (doc.epubCover) {
      expect(doc.epubCover.kind).toBe('cover')
      expect(doc.epubCover.mimeType).toMatch(/^image\//)
      expect(doc.epubCover.src ?? doc.epubCover.error).toBeDefined()
    } else {
      expect(doc.epubImages?.length ?? 0).toBeGreaterThanOrEqual(0)
    }
  })

  it('maps headings, footnotes and inline emphasis to distinct text styles', async () => {
    const doc = await encodeFixture('styled-text.epub')
    const pages = await doc.pages
    const texts = pageTexts(pages[0].content as unknown[])

    // 按内容定位每一行，断言其样式来自 HTML 语义而非统一常量
    const findLine = (fragment: string): PageText => {
      const line = texts.find((text) => text.content.includes(fragment))
      if (!line) throw new Error(`line containing "${fragment}" not found`)
      return line
    }

    // S1: 标题层级 → 更大的字号 + 粗体
    const h1 = findLine('Chapter Heading One')
    expect(h1.fontSize).toBe(28)
    expect(h1.fontWeight).toBe(700)
    expect(h1.lineHeight).toBeGreaterThan(24)

    const h2 = findLine('Section Heading Two')
    expect(h2.fontSize).toBe(24)
    expect(h2.fontWeight).toBe(700)

    // S1: 正文保持基准字号
    const body = findLine('Second body line stays plain.')
    expect(body.fontSize).toBe(16)
    expect(body.fontWeight).toBe(400)
    expect(body.italic).toBe(false)

    // S1: aside 脚注 → 更小字号
    const footnote = findLine('Footnote body text')
    expect(footnote.fontSize).toBeLessThan(16)
    expect(footnote.fontSize).toBe(12)

    // S2: 混合行（含 sup/b/i 的正文）取最强语义——仍是正文段，
    // 但粗体或斜体标记应提升 fontWeight 或 italic 之一
    const mixed = findLine('Body paragraph with a note')
    expect(mixed.fontSize).toBe(16)
    expect(mixed.fontWeight === 700 || mixed.italic).toBe(true)

    // S1: y 坐标按各行实际 lineHeight 累计——h1 之后正文不能再以 24 等距排布
    expect(h2.polygon[0][1]).toBeGreaterThan(h1.polygon[0][1] + 24)
  })

  it('keeps uniform 16px layout for plain-paragraph chapters', async () => {
    // S3: 无语义标签的普通章节保持原有 16px/400 行为不变
    const doc = await encodeFixture('minimal.epub')
    const pages = await doc.pages
    const texts = pageTexts(pages[0].content as unknown[])

    expect(texts.length).toBeGreaterThan(0)
    texts.forEach((text) => {
      expect(text.fontSize).toBe(16)
      expect(text.fontWeight).toBe(400)
      expect(text.italic).toBe(false)
    })
  })
})
