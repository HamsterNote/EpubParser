import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IntermediateDocument } from '@hamster-note/types'
import { EpubParser } from '../index'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

describe('EpubParser API shell', () => {
  it('exposes instance encode and decode methods', () => {
    expect(typeof EpubParser.prototype.encode).toBe('function')
    expect(typeof EpubParser.prototype.decode).toBe('function')
  })

  it('exposes static encode and decode methods', () => {
    expect(typeof EpubParser.encode).toBe('function')
    expect(typeof EpubParser.decode).toBe('function')
  })

  it('exposes epub extension metadata', () => {
    expect(EpubParser.ext).toBe('epub')
    expect(EpubParser.exts).toContain('epub')
  })

  it('rejects unsupported input with a plain Error', async () => {
    await expect(EpubParser.encode({} as never)).rejects.toThrow(
      /^Unsupported EPUB input$/
    )

    await expect(EpubParser.encode({} as never)).rejects.toBeInstanceOf(Error)
  })

  it('instance encode returns an IntermediateDocument from a buffer', async () => {
    const buffer = await readFile(join(fixtureDir, 'minimal.epub'))
    const parser = new EpubParser()
    const doc = await parser.encode(buffer)

    // 返回值必须是 IntermediateDocument 实例
    expect(doc).toBeInstanceOf(IntermediateDocument)
    // 必须有 title 和 pages 等核心字段
    expect(doc.title).toBeDefined()
    expect(doc.pageCount).toBeGreaterThanOrEqual(1)
  })

  it('instance decode returns binary output with ZIP magic bytes', async () => {
    const buffer = await readFile(join(fixtureDir, 'minimal.epub'))
    const parser = new EpubParser()
    const doc = await parser.encode(buffer)
    const output = await parser.decode(doc)

    // EPUB 本质是 ZIP 文件，必须以 PK\x03\x04 开头
    const bytes = Buffer.from(output as ArrayBuffer)
    expect(bytes[0]).toBe(0x50) // P
    expect(bytes[1]).toBe(0x4b) // K
    expect(bytes[2]).toBe(0x03) // \x03
    expect(bytes[3]).toBe(0x04) // \x04
  })
})
