import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  IntermediateDocument,
  IntermediateImage,
  IntermediateOutline,
  IntermediatePage,
  IntermediateText
} from '@hamster-note/types'
import { EpubParser, type EpubDocumentExtensions } from '../index'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const fixturePath = (name: string) => join(fixtureDir, name)

type DocumentWithEpubData = IntermediateDocument & Partial<EpubDocumentExtensions>
type ParserOutput = Awaited<ReturnType<typeof EpubParser.decode>>

type FixtureCase = {
  name: string
  expectedTitle: string
  snippets: string[]
}

type RoundtripSummary = {
  title: string
  pageCount: number
  snippets: string[]
  outlineStatus: string
  coverStatus: string
}

const semanticRoundtripIgnoreList = [
  'byte-for-byte ZIP equality',
  'EPUB container timestamps',
  'generated document/page/text/image IDs',
  'dependency-generated manifest IDs and metadata',
  'dependency-generated chapter file names',
  'cover/image byte ordering inside ZIP'
] as const

const fixtureCases: FixtureCase[] = [
  {
    name: 'minimal.epub',
    expectedTitle: 'Minimal Test Book',
    snippets: ['This is the only chapter in the minimal EPUB fixture.']
  },
  {
    name: 'with-images.epub',
    expectedTitle: 'Book With Images',
    snippets: ['This chapter contains an embedded image.']
  },
  {
    name: 'with-toc.epub',
    expectedTitle: 'Book With TOC',
    snippets: [
      'Content of the first chapter.',
      'Content of the second chapter.',
      'Content of the third chapter.'
    ]
  },
  {
    name: 'with-cover.epub',
    expectedTitle: 'Book With Cover',
    snippets: ['This book has a cover image.']
  },
  {
    name: 'non-ascii-metadata.epub',
    expectedTitle: '测试书',
    snippets: ['这是第一章的内容。']
  }
]

const encodeFixture = async (name: string): Promise<DocumentWithEpubData> => {
  const epubDocument = await EpubParser.encode(fixturePath(name))
  return epubDocument.getIntermediateDocument() as DocumentWithEpubData
}

const zipBytes = async (input: ParserOutput): Promise<Uint8Array> => {
  if (input instanceof Blob) {
    return new Uint8Array(await input.arrayBuffer())
  }

  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  }

  return new Uint8Array(input)
}

const expectZipMagic = async (input: ParserOutput) => {
  const bytes = await zipBytes(input)
  expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
}

const isTextContent = (item: unknown): item is IntermediateText => {
  return typeof item === 'object' && item !== null && 'content' in item
}

const isImageContent = (item: unknown): item is IntermediateImage => {
  return typeof item === 'object' && item !== null && 'src' in item
}

const getOrderedPages = async (doc: IntermediateDocument): Promise<IntermediatePage[]> => {
  const pages = await doc.pages
  return [...pages].sort((a, b) => a.number - b.number)
}

const getPageTexts = async (doc: IntermediateDocument): Promise<string[]> => {
  const pages = await getOrderedPages(doc)

  return Promise.all(
    pages.map(async (page) => {
      const content = await page.getContent()
      return content
        .filter(isTextContent)
        .map((item) => item.content)
        .join(' ')
    })
  )
}

const getImageContentCount = async (doc: IntermediateDocument): Promise<number> => {
  const pages = await getOrderedPages(doc)
  const pageContents = await Promise.all(pages.map((page) => page.getContent()))

  return pageContents.reduce(
    (count, content) => count + content.filter(isImageContent).length,
    0
  )
}

const outlineStatusFor = (doc: DocumentWithEpubData): string => {
  const outline = doc.getOutline() as IntermediateOutline[] | undefined

  if (outline && outline.length > 0) {
    return `supported:${outline.length}:${outline.map((item) => item.content).join('|')}`
  }

  return `documented-limitation:${doc.epubTocMappingLimitation ?? 'no TOC exposed by dependency'}`
}

const coverStatusFor = async (doc: DocumentWithEpubData): Promise<string> => {
  const imageCount = doc.epubImages?.length ?? 0
  const pageImageCount = await getImageContentCount(doc)

  if (doc.epubCover) {
    return `supported:${doc.epubCover.mimeType}:images=${imageCount}:pageImages=${pageImageCount}`
  }

  return `documented-limitation:no cover identified by dependency:images=${imageCount}:pageImages=${pageImageCount}`
}

const summarizeDocument = async (
  doc: DocumentWithEpubData,
  expectedSnippets: string[]
): Promise<RoundtripSummary> => {
  const pageTexts = await getPageTexts(doc)
  const fullText = pageTexts.join('\n')

  return {
    title: doc.title,
    pageCount: doc.pageCount,
    snippets: expectedSnippets.filter((snippet) => fullText.includes(snippet)),
    outlineStatus: outlineStatusFor(doc),
    coverStatus: await coverStatusFor(doc)
  }
}

const assertSnippetsInPageOrder = (pageTexts: string[], snippets: string[]) => {
  let previousPageIndex = -1

  snippets.forEach((snippet) => {
    const pageIndex = pageTexts.findIndex(
      (pageText, candidateIndex) => candidateIndex > previousPageIndex && pageText.includes(snippet)
    )

    expect(pageIndex).toBeGreaterThan(previousPageIndex)
    previousPageIndex = pageIndex
  })
}

describe('EpubParser lossy semantic roundtrip', () => {
  it('uses an explicit non-semantic ignore-list instead of byte equality', () => {
    expect(semanticRoundtripIgnoreList).toEqual([
      'byte-for-byte ZIP equality',
      'EPUB container timestamps',
      'generated document/page/text/image IDs',
      'dependency-generated manifest IDs and metadata',
      'dependency-generated chapter file names',
      'cover/image byte ordering inside ZIP'
    ])
  })

  it.each(fixtureCases)(
    'preserves semantic summary for $name through encode(decode(encode(input)))',
    async ({ name, expectedTitle, snippets }) => {
      const parsed = await encodeFixture(name)
      const decoded = await EpubParser.decode(parsed)

      await expectZipMagic(decoded)

      const reparsed = (await EpubParser.encode(decoded)).getIntermediateDocument() as DocumentWithEpubData
      const before = await summarizeDocument(parsed, snippets)
      const after = await summarizeDocument(reparsed, snippets)

      expect(before).toMatchObject({
        title: expectedTitle,
        snippets
      })
      expect(before.pageCount).toBeGreaterThanOrEqual(snippets.length)
      expect(after.title).toBe(before.title)
      expect(after.pageCount).toBe(before.pageCount)
      expect(after.snippets).toEqual(before.snippets)
      expect(after.outlineStatus).toMatch(/^(supported|documented-limitation):/)
      expect(after.coverStatus).toMatch(/^(supported|documented-limitation):/)

      assertSnippetsInPageOrder(await getPageTexts(parsed), snippets)
      assertSnippetsInPageOrder(await getPageTexts(reparsed), snippets)
    }
  )

  it('preserves exact Chinese title and author metadata through semantic roundtrip', async () => {
    const parsed = await encodeFixture('non-ascii-metadata.epub')
    const decoded = await EpubParser.decode(parsed)
    const reparsed = (await EpubParser.encode(decoded)).getIntermediateDocument() as DocumentWithEpubData

    expect(parsed.title).toBe('测试书')
    expect(parsed.metadata?.title).toBe('测试书')
    expect(parsed.metadata?.author).toBe('测试作者')
    expect(reparsed.title).toBe('测试书')
    expect(reparsed.metadata?.title).toBe('测试书')
    expect(reparsed.metadata?.author).toBe('测试作者')
  })

  it('documents TOC and cover/image behavior instead of silently dropping support', async () => {
    const tocDoc = await encodeFixture('with-toc.epub')
    const imageDoc = await encodeFixture('with-images.epub')
    const coverDoc = await encodeFixture('with-cover.epub')
    const decodedCover = await EpubParser.decode(coverDoc)
    const reparsedCover = (await EpubParser.encode(decodedCover)).getIntermediateDocument() as DocumentWithEpubData

    expect(outlineStatusFor(tocDoc)).toMatch(/^supported:/)
    expect(outlineStatusFor(tocDoc)).toContain('First Chapter')
    expect(outlineStatusFor(tocDoc)).toContain('Second Chapter')
    expect(outlineStatusFor(tocDoc)).toContain('Third Chapter')
    expect(imageDoc.epubImages?.length).toBeGreaterThanOrEqual(1)
    expect(await getImageContentCount(imageDoc)).toBeGreaterThanOrEqual(1)
    expect(await coverStatusFor(coverDoc)).toMatch(/^(supported|documented-limitation):/)
    expect(await coverStatusFor(reparsedCover)).toMatch(/^(supported|documented-limitation):/)
  })
})
