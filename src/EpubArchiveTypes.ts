export interface EpubManifestItem {
  id: string
  href: string
  'media-type': string
  properties?: string
  [key: string]: unknown
}

export interface EpubTocElement {
  level: number
  order: number
  title: string
  id: string
  href: string
  'media-type'?: string
  [key: string]: unknown
}

export interface EpubArchiveMetadata {
  identifier?: string
  creator?: string
  creatorFileAs?: string
  title?: string
  language?: string
  subject?: string
  subjects?: string[]
  date?: string
  description?: string
  publisher?: string
  source?: string
  UUID?: string
  cover?: string
  [key: string]: unknown
}

export interface EpubArchiveImage {
  data: Uint8Array
  mimeType: string
}
