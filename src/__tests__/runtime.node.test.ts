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

  it('loads EPUB read and generation dependencies through Node ESM dynamic import', async () => {
    await expect(import('epub')).resolves.toEqual(
      expect.objectContaining({
        EPub: expect.any(Function),
        default: expect.any(Function)
      })
    )

    await expect(import('epub-gen-memory')).resolves.toEqual(
      expect.objectContaining({
        default: expect.anything()
      })
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

  it('documents browser import limitations from Task 2 evidence instead of adding polyfills', async () => {
    const [browserCompatibility, nodeImport] = await Promise.all([
      readFile(join(repoRoot, '.omo/evidence/task-2-browser-compatibility.txt'), 'utf8'),
      readFile(join(repoRoot, '.omo/evidence/task-2-dependency-node-import.txt'), 'utf8')
    ])

    expect(browserCompatibility).toContain('Could not resolve "node:fs/promises"')
    expect(browserCompatibility).toContain('Could not resolve "fs"')
    expect(browserCompatibility).toContain('Could not resolve "path"')
    expect(browserCompatibility).toContain('No polyfills or shims were added')
    expect(nodeImport).toContain('dist/epub.js imports node:fs/promises at top level')
  })
})
