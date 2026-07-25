const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50
const ZIP64_SENTINEL_16 = 0xffff
const ZIP64_SENTINEL_32 = 0xffffffff

const MAX_INPUT_BYTES = 64 * 1024 * 1024
const MAX_ENTRY_COUNT = 2048
export const MAX_EPUB_ENTRY_BYTES = 16 * 1024 * 1024
export const MAX_EPUB_TOTAL_ENTRY_BYTES = 128 * 1024 * 1024

const findEndOfCentralDirectory = (bytes: Uint8Array, view: DataView): number => {
  // ZIP comments are limited to 65,535 bytes, so the end record must occur in this final window.
  const firstCandidate = Math.max(0, bytes.byteLength - ZIP64_SENTINEL_16 - 22)
  for (let offset = bytes.byteLength - 22; offset >= firstCandidate; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) return offset
  }
  throw new Error('Invalid ZIP central directory')
}

export const validateEpubArchiveSize = (bytes: Uint8Array): void => {
  if (bytes.byteLength > MAX_INPUT_BYTES) throw new Error('EPUB archive exceeds the input size limit')
  if (bytes.byteLength < 22) throw new Error('Invalid ZIP central directory')

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const endOffset = findEndOfCentralDirectory(bytes, view)
  const entryCount = view.getUint16(endOffset + 10, true)
  const directorySize = view.getUint32(endOffset + 12, true)
  const directoryOffset = view.getUint32(endOffset + 16, true)

  if (
    entryCount === ZIP64_SENTINEL_16 ||
    directorySize === ZIP64_SENTINEL_32 ||
    directoryOffset === ZIP64_SENTINEL_32
  ) {
    throw new Error('ZIP64 EPUB archives are not supported')
  }
  if (entryCount > MAX_ENTRY_COUNT) throw new Error('EPUB archive contains too many entries')
  if (directoryOffset + directorySize > endOffset) throw new Error('Invalid ZIP central directory')

  let offset = directoryOffset
  let totalBytes = 0
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > endOffset || view.getUint32(offset, true) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new Error('Invalid ZIP central directory entry')
    }

    const entryBytes = view.getUint32(offset + 24, true)
    if (entryBytes === ZIP64_SENTINEL_32) throw new Error('ZIP64 EPUB entries are not supported')
    if (entryBytes > MAX_EPUB_ENTRY_BYTES) throw new Error('EPUB archive entry exceeds the size limit')
    totalBytes += entryBytes
    if (totalBytes > MAX_EPUB_TOTAL_ENTRY_BYTES) {
      throw new Error('EPUB archive exceeds the expanded size limit')
    }

    const fileNameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    offset += 46 + fileNameLength + extraLength + commentLength
  }

  if (offset !== directoryOffset + directorySize) throw new Error('Invalid ZIP central directory size')
}
