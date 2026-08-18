export type ImageDimensions = {
  readonly width: number
  readonly height: number
}

const positiveDimensions = (width: number, height: number): ImageDimensions | undefined =>
  width > 0 && height > 0 ? { width, height } : undefined

const readPngDimensions = (data: Uint8Array): ImageDimensions | undefined => {
  if (data.length < 24 || data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4e || data[3] !== 0x47) {
    return undefined
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return positiveDimensions(view.getUint32(16), view.getUint32(20))
}

const readGifDimensions = (data: Uint8Array): ImageDimensions | undefined => {
  if (data.length < 10 || data[0] !== 0x47 || data[1] !== 0x49 || data[2] !== 0x46) {
    return undefined
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return positiveDimensions(view.getUint16(6, true), view.getUint16(8, true))
}

const readJpegDimensions = (data: Uint8Array): ImageDimensions | undefined => {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return undefined
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 2
  while (offset + 8 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = data[offset + 1] ?? 0
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2
      continue
    }
    const segmentLength = view.getUint16(offset + 2)
    if (segmentLength < 2 || offset + segmentLength + 2 > data.length) return undefined
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return positiveDimensions(view.getUint16(offset + 7), view.getUint16(offset + 5))
    }
    offset += segmentLength + 2
  }
  return undefined
}

export const readImageDimensions = (
  data: Uint8Array | undefined,
  mimeType: string
): ImageDimensions | undefined => {
  if (!data) return undefined
  const normalizedMimeType = mimeType.toLowerCase()
  if (normalizedMimeType === 'image/png') return readPngDimensions(data)
  if (normalizedMimeType === 'image/gif') return readGifDimensions(data)
  if (normalizedMimeType === 'image/jpeg' || normalizedMimeType === 'image/jpg') {
    return readJpegDimensions(data)
  }
  return undefined
}
