import JSZip, { type JSZipObject } from 'jszip'
import {
  MAX_EPUB_ENTRY_BYTES,
  MAX_EPUB_TOTAL_ENTRY_BYTES,
  validateEpubArchiveSize
} from './EpubArchiveLimits.js'

const textDecoder = new TextDecoder('utf-8')

/**
 * 受限的 EPUB ZIP 读取器。
 *
 * `@likecoin/epub-ts` 负责解释 EPUB 结构；此类只负责在读取资源时执行
 * 独立于 ZIP 元数据的实际展开大小限制，避免伪造中央目录尺寸绕过保护。
 */
export class EpubResourceReader {
  private readonly expandedBytesByEntry = new Map<string, number>()
  private expandedBytes = 0

  private constructor(private readonly zip: JSZip) {}

  static async open(input: Uint8Array): Promise<EpubResourceReader> {
    validateEpubArchiveSize(input)

    let zip: JSZip
    try {
      zip = await JSZip.loadAsync(input)
    } catch {
      throw new Error('Invalid/missing file')
    }

    if (!Object.keys(zip.files).length) throw new Error('No files in archive')
    return new EpubResourceReader(zip)
  }

  findEntry(target: string): string | undefined {
    return Object.keys(this.zip.files).find((name) => name.toLowerCase() === target.toLowerCase())
  }

  async readText(name: string): Promise<string> {
    return textDecoder.decode(await this.readBytes(name))
  }

  async readBytes(name: string): Promise<Uint8Array> {
    const previousBytes = this.expandedBytesByEntry.get(name) ?? 0
    const chunks: Uint8Array[] = []
    let entryBytes = 0

    await new Promise<void>((resolve, reject) => {
      const stream = this.getEntry(name).internalStream('uint8array')
      stream
        .on('data', (chunk) => {
          entryBytes += chunk.byteLength
          const projectedTotal = this.expandedBytes - previousBytes + entryBytes
          if (entryBytes > MAX_EPUB_ENTRY_BYTES || projectedTotal > MAX_EPUB_TOTAL_ENTRY_BYTES) {
            stream.pause()
            reject(new Error('EPUB archive expanded data exceeds the size limit'))
            return
          }
          chunks.push(chunk)
        })
        .on('error', reject)
        .on('end', resolve)
        .resume()
    })

    const bytes = new Uint8Array(entryBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }

    this.expandedBytes = this.expandedBytes - previousBytes + entryBytes
    this.expandedBytesByEntry.set(name, entryBytes)
    return bytes
  }

  private getEntry(name: string): JSZipObject {
    const entry = this.zip.file(name)
    if (!entry) throw new Error(`Entry not found: ${name}`)
    return entry
  }
}
