import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IntermediateDocument, IntermediatePage, IntermediatePageMap, IntermediateText, TextDir } from '@hamster-note/types'
import JSZip from 'jszip'
import { EpubParser } from '../index'

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'minimal.epub')

describe('Browser runtime support', () => {
  it('parses an EPUB Blob using browser binary APIs', async () => {
    // Given: EPUB bytes supplied through the browser-native Blob boundary.
    const bytes = await readFile(fixturePath)
    const input = new Blob([new Uint8Array(bytes)], { type: 'application/epub+zip' })

    // When: the parser reads the Blob without a filesystem path.
    const parsed = await EpubParser.encode(input)

    // Then: metadata and spine pages are available as normal.
    expect(parsed.getIntermediateDocument().title).toBe('Minimal Test Book')
    expect(parsed.getIntermediateDocument().pageCount).toBeGreaterThanOrEqual(1)
  })

  it('generates EPUB bytes with browser DOM and Blob globals', async () => {
    // Given: a minimal intermediate document built entirely in memory.
    const page = new IntermediatePage({
      id: 'browser-page-1',
      number: 1,
      width: 800,
      height: 1000,
      content: [
        new IntermediateText({
          id: 'browser-text-1',
          content: 'Generated in a browser runtime',
          fontSize: 16,
          fontFamily: 'sans-serif',
          fontWeight: 400,
          italic: false,
          color: '#000000',
          polygon: [[40, 40], [400, 40], [400, 64], [40, 64]],
          lineHeight: 24,
          ascent: 12.8,
          descent: 3.2,
          dir: TextDir.LTR,
          opacity: 1,
          skew: 0,
          isEOL: true
        })
      ]
    })
    const document = new IntermediateDocument({
      id: 'browser-document',
      title: 'Browser Generated Book',
      pagesMap: IntermediatePageMap.makeByInfoList([
        {
          id: page.id,
          pageNumber: page.number,
          size: { x: page.width, y: page.height },
          getData: async () => page
        }
      ])
    })

    // When: generation runs with browser globals available.
    const generated = await EpubParser.decode(document)

    // Then: the binary is an EPUB ZIP and can be parsed again from a Blob.
    const bytes = generated instanceof Blob
      ? new Uint8Array(await generated.arrayBuffer())
      : ArrayBuffer.isView(generated)
        ? new Uint8Array(generated.buffer, generated.byteOffset, generated.byteLength)
        : new Uint8Array(generated)
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
    const reparsed = await EpubParser.encode(
      new Blob([bytes.slice()], { type: 'application/epub+zip' })
    )
    expect(reparsed.getIntermediateDocument().title).toBe('Browser Generated Book')
  })

  it('writes document language into generated XHTML', async () => {
    // Given: a non-English document generated through the public browser-safe API.
    const page = new IntermediatePage({
      id: 'language-page',
      number: 1,
      width: 800,
      height: 1000,
      content: []
    })
    const document = new IntermediateDocument({
      id: 'language-document',
      title: '中文书籍',
      pagesMap: IntermediatePageMap.makeByInfoList([{
        id: page.id,
        pageNumber: page.number,
        size: { x: page.width, y: page.height },
        getData: async () => page
      }])
    })
    Object.assign(document, { metadata: { language: 'zh-CN' } })

    // When: the generated archive content documents are inspected.
    const generated = await EpubParser.decode(document)
    const zip = await JSZip.loadAsync(generated)
    const chapter = await zip.file('EPUB/chapter-1.xhtml')?.async('string')
    const navigation = await zip.file('EPUB/nav.xhtml')?.async('string')

    // Then: both XHTML roots carry the requested language.
    expect(chapter).toContain('lang="zh-CN" xml:lang="zh-CN"')
    expect(navigation).toContain('lang="zh-CN" xml:lang="zh-CN"')
  })
})
