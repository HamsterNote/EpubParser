import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  IntermediateDocument,
  IntermediateImage,
  IntermediatePage,
  IntermediatePageMap,
  IntermediateText,
  TextDir
} from '@hamster-note/types'
import { jest } from '@jest/globals'
import JSZip from 'jszip'
import { EpubParser } from '../index'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(__dirname, 'fixtures')

const zipBytes = async (input: ArrayBuffer | ArrayBufferView | Blob): Promise<Uint8Array> => {
  if (input instanceof Blob) {
    return new Uint8Array(await input.arrayBuffer())
  }

  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  }

  return new Uint8Array(input)
}

const expectZipMagic = async (input: ArrayBuffer | ArrayBufferView | Blob) => {
  const bytes = await zipBytes(input)
  expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
}

const makeText = (id: string, content: string, y: number): IntermediateText => {
  return new IntermediateText({
    id,
    content,
    fontSize: 16,
    fontFamily: 'sans-serif',
    fontWeight: 400,
    italic: false,
    color: '#000000',
    polygon: [
      [40, y],
      [420, y],
      [420, y + 24],
      [40, y + 24]
    ],
    lineHeight: 24,
    ascent: 12,
    descent: 4,
    dir: TextDir.LTR,
    opacity: 1,
    skew: 0,
    isEOL: true
  })
}

const makePage = (pageNumber: number, content: string): IntermediatePage => {
  const redImagePath = join(fixturesDir, 'red.png')
  const image = new IntermediateImage({
    id: `page-${pageNumber}-image`,
    src: `file://${redImagePath}`,
    polygon: [
      [40, 90],
      [120, 90],
      [120, 170],
      [40, 170]
    ],
    opacity: 1
  })

  return new IntermediatePage({
    id: `page-${pageNumber}`,
    number: pageNumber,
    width: 800,
    height: 1000,
    content: [makeText(`page-${pageNumber}-text`, content, 40), image],
    thumbnail: image,
    useFlowLayout: true
  })
}

const makeDocument = (pages: IntermediatePage[]): IntermediateDocument => {
  const document = new IntermediateDocument({
    id: 'decode-test-document',
    title: 'Decode Test Book',
    pagesMap: IntermediatePageMap.makeByInfoList(
      pages.map((page) => ({
        id: page.id,
        pageNumber: page.number,
        size: { x: page.width, y: page.height },
        getData: async () => page
      }))
    )
  }) as IntermediateDocument & {
    metadata: {
      author: string
      language: string
      publisher: string
      date: string
    }
  }

  document.metadata = {
    author: 'Decode Author',
    language: 'en',
    publisher: 'Decode Publisher',
    date: '2024-01-15'
  }

  return document
}

describe('EpubParser.decode', () => {
  it('returns a ZIP-backed EPUB Uint8Array', async () => {
    const output = await EpubParser.decode(
      makeDocument([makePage(1, 'First page text.'), makePage(2, 'Second page text.')])
    )

    expect(output).toBeInstanceOf(Uint8Array)
    await expectZipMagic(output)
  })

  it('throws a plain Error for empty intermediate documents', async () => {
    await expect(EpubParser.decode(makeDocument([]))).rejects.toThrow(
      /^Invalid intermediate document: at least one page is required$/
    )
    await expect(EpubParser.decode(makeDocument([]))).rejects.toBeInstanceOf(Error)
  })

  it('generates EPUB output that encode can parse again', async () => {
    const fixture = await readFile(join(fixturesDir, 'minimal.epub'))
    const parsedFixture = await EpubParser.encode(fixture)
    const decoded = await EpubParser.decode(parsedFixture.getIntermediateDocument())
    const reparsed = await EpubParser.encode(decoded)

    await expectZipMagic(decoded)
    expect(reparsed.getIntermediateDocument().title).toBe('Minimal Test Book')
  })

  it('keeps page IDs stable across repeated loads and EPUB roundtrips', async () => {
    // Given: the same EPUB bytes loaded independently.
    const fixture = await readFile(join(fixturesDir, 'minimal.epub'))
    const clock = jest
      .spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000)
      .mockReturnValue(3_000)
    const firstDocument = (await EpubParser.encode(fixture)).getIntermediateDocument()
    const secondDocument = (await EpubParser.encode(fixture)).getIntermediateDocument()
    const firstPageIds = (await firstDocument.pages).map((page) => page.id)
    const secondPageIds = (await secondDocument.pages).map((page) => page.id)

    // When: the parsed document is generated as EPUB and loaded again.
    const roundtripBytes = await EpubParser.decode(firstDocument)
    const roundtripDocument = (await EpubParser.encode(roundtripBytes)).getIntermediateDocument()
    const roundtripPageIds = (await roundtripDocument.pages).map((page) => page.id)

    // Then: both direct reloads and roundtrip reloads retain the original page IDs.
    expect(secondPageIds).toEqual(firstPageIds)
    expect(roundtripPageIds).toEqual(firstPageIds)
    clock.mockRestore()
  })

  it('embeds page images inside the generated EPUB archive', async () => {
    // Given: a page whose image is supplied through the Node-only file URL boundary.
    const output = await EpubParser.decode(makeDocument([makePage(1, 'Page with image.')]))

    // When: the generated EPUB ZIP is inspected as a standalone artifact.
    const zip = await JSZip.loadAsync(await zipBytes(output))
    const chapter = await zip.file('EPUB/chapter-1.xhtml')?.async('string')
    const embeddedImage = await zip.file('EPUB/images/image-1.png')?.async('uint8array')

    // Then: chapter markup references an archive-relative image with real bytes.
    expect(chapter).toContain('src="images/image-1.png"')
    expect(embeddedImage?.byteLength).toBeGreaterThan(0)
  })

  it('renders generated EPUB images centered at their intrinsic ratio with a responsive maximum width', async () => {
    // Given: IntermediatePage 包含一张具有明确 polygon 宽高比的图片
    const document = makeDocument([makePage(1, 'Responsive image.')])

    // When: document 被生成并直接检查章节 XHTML
    const output = await EpubParser.decode(document)
    const zip = await JSZip.loadAsync(await zipBytes(output))
    const chapter = await zip.file('EPUB/chapter-1.xhtml')?.async('string')

    // Then: 图片段落居中，图片本身不拉伸且不会超出内容宽度
    expect(chapter).toContain('<p style="text-align: center;">')
    expect(chapter).toContain(
      'style="display: block; margin: 0 auto; max-width: 100%; height: auto;"'
    )
  })

  it('infers a remote image type when the server returns a generic content type', async () => {
    // Given: a PNG URL whose server returns valid bytes as application/octet-stream.
    const imageBytes = await readFile(join(fixturesDir, 'red.png'))
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(imageBytes, { headers: { 'content-type': 'application/octet-stream' } })
    )
    const page = makePage(1, 'Page with remote image.')
    const remoteImage = new IntermediateImage({
      id: 'remote-image',
      src: 'https://cdn.example.test/remote.png',
      polygon: [
        [40, 90],
        [120, 90],
        [120, 170],
        [40, 170]
      ],
      opacity: 1
    })
    page.content = [makeText('remote-text', 'Page with remote image.', 40), remoteImage]

    try {
      // When: the document is generated and inspected as a standalone EPUB.
      const output = await EpubParser.decode(makeDocument([page]))
      const zip = await JSZip.loadAsync(await zipBytes(output))
      const chapter = await zip.file('EPUB/chapter-1.xhtml')?.async('string')
      const embeddedImage = await zip.file('EPUB/images/image-1.png')?.async('uint8array')

      // Then: the URL extension supplies image/png and the bytes are embedded.
      expect(chapter).toContain('src="images/image-1.png"')
      expect(embeddedImage).toEqual(new Uint8Array(imageBytes))
    } finally {
      fetchMock.mockRestore()
    }
  })
})
