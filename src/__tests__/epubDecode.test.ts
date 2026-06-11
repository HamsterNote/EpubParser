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
    thumbnail: image
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
  it('returns a ZIP-backed EPUB Buffer or Uint8Array', async () => {
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
})
