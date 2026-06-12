import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  IntermediateDocument,
  IntermediatePage,
  IntermediatePageMap,
  IntermediateText,
  TextDir
} from '@hamster-note/types'
import * as EpubParserModule from '../index'
import { EpubDocument, EpubPage, EpubParser } from '../index'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const fixturePath = (name: string) => join(fixtureDir, name)

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

const makeText = (content: string): IntermediateText => {
  return new IntermediateText({
    id: 'integration-text-1',
    content,
    fontSize: 16,
    fontFamily: 'sans-serif',
    fontWeight: 400,
    italic: false,
    color: '#000000',
    polygon: [
      [40, 40],
      [420, 40],
      [420, 64],
      [40, 64]
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

const makeIntermediateDocument = (): IntermediateDocument => {
  const page = new IntermediatePage({
    id: 'integration-page-1',
    number: 1,
    width: 800,
    height: 1000,
    content: [makeText('Integration smoke page.')],
    thumbnail: undefined
  })

  const document = new IntermediateDocument({
    id: 'integration-document',
    title: 'Integration Smoke Book',
    pagesMap: IntermediatePageMap.makeByInfoList([
      {
        id: page.id,
        pageNumber: page.number,
        size: { x: page.width, y: page.height },
        getData: async () => page
      }
    ])
  }) as IntermediateDocument & {
    metadata: { author: string; language: string; publisher: string; date: string }
  }

  document.metadata = {
    author: 'Integration Author',
    language: 'en',
    publisher: 'Integration Publisher',
    date: '2024-01-15'
  }

  return document
}

describe('EpubParser integration', () => {
  it('matches HtmlParser-style extension metadata', () => {
    expect(EpubParser.ext).toBe('epub')
    expect(EpubParser.exts.includes('epub')).toBe(true)
  })

  it('encodes minimal.epub fixture into intermediate pages', async () => {
    const fixture = readFileSync(fixturePath('minimal.epub'))
    const epubDocument = await EpubParser.encode(fixture)
    const intermediate = epubDocument.getIntermediateDocument()
    const pages = await intermediate.pages

    expect(epubDocument).toBeInstanceOf(EpubDocument)
    expect(intermediate.title).toBe('Minimal Test Book')
    expect(pages.length).toBeGreaterThan(0)
    expect(pages[0]).toBeInstanceOf(IntermediatePage)
  })

  it('decodes a synthetic intermediate document into ZIP-backed EPUB bytes', async () => {
    const output = await EpubParser.decode(makeIntermediateDocument())

    expect(output).toBeInstanceOf(Uint8Array)
    await expectZipMagic(output)
  })

  it('exports parser and wrapper classes from the source entry point', () => {
    expect(EpubParserModule.EpubParser).toBe(EpubParser)
    expect(EpubParserModule.EpubDocument).toBe(EpubDocument)
    expect(EpubParserModule.EpubPage).toBe(EpubPage)
  })

  it('parses, generates, and re-parses without byte-equality assumptions', async () => {
    const fixture = readFileSync(fixturePath('minimal.epub'))
    const parsed = await EpubParser.encode(fixture)
    const generated = await EpubParser.decode(parsed.getIntermediateDocument())
    const reparsed = await EpubParser.encode(generated)
    const reparsedPages = await reparsed.getIntermediateDocument().pages

    await expectZipMagic(generated)
    expect(reparsed.getIntermediateDocument().title).toBe('Minimal Test Book')
    expect(reparsedPages.length).toBeGreaterThan(0)
  })
})
