import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EpubParser } from '../index'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturePath = (name: string) => join(__dirname, 'fixtures', name)
const repoRoot = resolve(__dirname, '..', '..')

const expectZipMagic = (input: ArrayBuffer | ArrayBufferView) => {
  const bytes = ArrayBuffer.isView(input)
    ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    : new Uint8Array(input)

  expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
}

describe('Node runtime support', () => {
  it('runs on the documented Node.js runtime floor or newer', () => {
    const [major, minor] = process.versions.node.split('.').map(Number)

    expect(major > 22 || (major === 22 && minor >= 6)).toBe(true)
  })

  it('loads cross-platform EPUB dependencies', async () => {
    await expect(import('jszip')).resolves.toEqual(
      expect.objectContaining({
        default: expect.anything()
      })
    )
    await expect(import('fast-xml-parser')).resolves.toEqual(
      expect.objectContaining({ XMLParser: expect.any(Function) })
    )
  })

  it('parses and generates EPUB content without runtime polyfills', async () => {
    const parsed = await EpubParser.encode(fixturePath('minimal.epub'))
    const intermediateDocument = parsed.getIntermediateDocument()

    expect(intermediateDocument.title).toBe('Minimal Test Book')
    expect(intermediateDocument.pageCount).toBeGreaterThanOrEqual(1)

    const generated = await EpubParser.decode(intermediateDocument)
    expect(generated).toBeInstanceOf(Uint8Array)
    expectZipMagic(generated as ArrayBufferView)

    const reparsed = await EpubParser.encode(generated)
    expect(reparsed.getIntermediateDocument().title).toBe('Minimal Test Book')
  })

  it('keeps package metadata free of the Node-only EPUB dependencies', async () => {
    const packageJson: unknown = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))

    expect(packageJson).toEqual(
      expect.objectContaining({
        dependencies: expect.objectContaining({
          'fast-xml-parser': '5.8.0',
          jszip: '3.10.1'
        })
      })
    )
    expect(JSON.stringify(packageJson)).not.toContain('"epub":"2.1.1"')
    expect(JSON.stringify(packageJson)).not.toContain('"epub-gen-memory"')
  })

  it('keeps shared HamsterNote classes external to preserve consumer identity', async () => {
    // Given: the package build configuration used for the public distribution.
    const { default: config } = await import('../../rolldown.config')

    // When: its runtime externals are inspected.
    const external = config.external

    // Then: shared base and data-model packages resolve from the consumer dependency graph.
    expect(external).toEqual(
      expect.arrayContaining(['@hamster-note/document-parser', '@hamster-note/types'])
    )
  })
})
