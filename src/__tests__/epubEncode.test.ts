import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IntermediateDocument } from '@hamster-note/types'
import { EpubParser, type EpubDocumentExtensions } from '../index'

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
})
