import 'jszip'

declare module 'jszip' {
  interface JSZipObject {
    internalStream(type: 'uint8array'): JSZipStreamHelper<Uint8Array>
  }
}
