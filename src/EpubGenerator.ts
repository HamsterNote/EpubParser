import JSZip from 'jszip'

export interface EpubContentItem {
  title: string
  content: string
  excludeFromToc?: boolean
}

export interface EpubGeneratorOptions {
  title: string
  identifier?: string
  author?: string | string[]
  publisher?: string
  date?: string
  lang?: string
  cover?: string | File
}

interface EpubEmbeddedAsset {
  readonly href: string
  readonly mediaType: string
  readonly data: Uint8Array
  readonly properties?: 'cover-image'
}

interface EpubPackageParts {
  readonly options: EpubGeneratorOptions
  readonly content: readonly EpubContentItem[]
  readonly identifier: string
  readonly assets: readonly EpubEmbeddedAsset[]
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const chapterDocument = (title: string, content: string, language: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${escapeXml(language)}" xml:lang="${escapeXml(language)}">
<head><meta charset="UTF-8"/><title>${escapeXml(title)}</title></head>
<body>${content}</body>
</html>`

const navigationDocument = (content: readonly EpubContentItem[], language: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(language)}" xml:lang="${escapeXml(language)}">
<head><title>Table of Contents</title></head>
<body><nav epub:type="toc"><ol>${content
  .map((chapter, index) =>
    chapter.excludeFromToc
      ? ''
      : `<li><a href="chapter-${index + 1}.xhtml">${escapeXml(chapter.title)}</a></li>`
  )
  .join('')}</ol></nav></body>
</html>`

const packageDocument = ({ options, content, identifier, assets }: EpubPackageParts): string => {
  const creators = (Array.isArray(options.author) ? options.author : [options.author])
    .filter((author): author is string => Boolean(author))
    .map((author) => `<dc:creator>${escapeXml(author)}</dc:creator>`)
    .join('')
  const manifest = content
    .map(
      (_chapter, index) =>
        `<item id="chapter-${index + 1}" href="chapter-${index + 1}.xhtml" media-type="application/xhtml+xml"/>`
    )
    .join('')
  const spine = content
    .map((_chapter, index) => `<itemref idref="chapter-${index + 1}"/>`)
    .join('')
  const assetManifest = assets
    .map(
      (asset, index) =>
        `<item id="asset-${index + 1}" href="${escapeXml(asset.href)}" media-type="${escapeXml(asset.mediaType)}"${asset.properties ? ` properties="${asset.properties}"` : ''}/>`
    )
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="book-id">${escapeXml(identifier)}</dc:identifier>
<dc:title>${escapeXml(options.title)}</dc:title>
<dc:language>${escapeXml(options.lang ?? 'en')}</dc:language>${creators}
${options.publisher ? `<dc:publisher>${escapeXml(options.publisher)}</dc:publisher>` : ''}
${options.date ? `<dc:date>${escapeXml(options.date)}</dc:date>` : ''}
<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta>
</metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${manifest}${assetManifest}</manifest>
<spine>${spine}</spine>
</package>`
}

const base64ToBytes = (base64: string): Uint8Array => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const clean = base64.replace(/\s/g, '').replace(/=+$/, '')
  const output = new Uint8Array(Math.floor((clean.length * 6) / 8))
  let buffer = 0
  let bits = 0
  let outputIndex = 0

  for (const character of clean) {
    const value = alphabet.indexOf(character)
    if (value < 0) throw new Error('Invalid base64 image data')
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      output[outputIndex] = (buffer >> bits) & 0xff
      outputIndex += 1
    }
  }

  return output
}

const extensionForMediaType = (mediaType: string): string => {
  const subtype = mediaType.split('/')[1]?.toLowerCase() ?? 'bin'
  return subtype === 'jpeg' ? 'jpg' : subtype.replace(/[^a-z0-9]+/g, '') || 'bin'
}

const createIdentifier = (): string => {
  return `urn:uuid:${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

const embedChapterImages = (
  content: readonly EpubContentItem[]
): { readonly content: EpubContentItem[]; readonly assets: EpubEmbeddedAsset[] } => {
  const assets: EpubEmbeddedAsset[] = []
  const hrefBySource = new Map<string, string>()
  const imagePattern = /(\ssrc\s*=\s*["'])(data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+))(["'])/gi
  const embeddedContent = content.map((chapter) => ({
    ...chapter,
    content: chapter.content.replace(
      imagePattern,
      (_match, prefix: string, source: string, mediaType: string, base64: string, suffix: string) => {
        let href = hrefBySource.get(source)
        if (!href) {
          href = `images/image-${assets.length + 1}.${extensionForMediaType(mediaType)}`
          hrefBySource.set(source, href)
          assets.push({ href, mediaType, data: base64ToBytes(base64) })
        }
        return `${prefix}${href}${suffix}`
      }
    )
  }))

  return { content: embeddedContent, assets }
}

const loadCover = async (cover: string | File | undefined): Promise<EpubEmbeddedAsset | undefined> => {
  if (!cover) return undefined

  if (typeof cover !== 'string') {
    const mediaType = cover.type || 'application/octet-stream'
    return {
      href: `images/cover.${extensionForMediaType(mediaType)}`,
      mediaType,
      data: new Uint8Array(await cover.arrayBuffer()),
      properties: 'cover-image'
    }
  }

  const dataMatch = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(cover)
  if (dataMatch) {
    const mediaType = dataMatch[1]
    return {
      href: `images/cover.${extensionForMediaType(mediaType)}`,
      mediaType,
      data: base64ToBytes(dataMatch[2]),
      properties: 'cover-image'
    }
  }

  const response = await fetch(cover)
  if (!response.ok) throw new Error(`Failed to load EPUB cover: HTTP ${response.status}`)
  const mediaType = response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream'
  return {
    href: `images/cover.${extensionForMediaType(mediaType)}`,
    mediaType,
    data: new Uint8Array(await response.arrayBuffer()),
    properties: 'cover-image'
  }
}

export const generateEpub = async (
  options: EpubGeneratorOptions,
  content: readonly EpubContentItem[]
): Promise<Uint8Array> => {
  const zip = new JSZip()
  const identifier = options.identifier ?? createIdentifier()
  const embedded = embedChapterImages(content)
  const cover = await loadCover(options.cover)
  const assets = cover ? [...embedded.assets, cover] : embedded.assets
  const language = options.lang ?? 'en'
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
  )
  zip.file('EPUB/package.opf', packageDocument({ options, content: embedded.content, identifier, assets }))
  zip.file('EPUB/nav.xhtml', navigationDocument(embedded.content, language))
  embedded.content.forEach((chapter, index) => {
    zip.file(`EPUB/chapter-${index + 1}.xhtml`, chapterDocument(chapter.title, chapter.content, language))
  })
  assets.forEach((asset) => {
    zip.file(`EPUB/${asset.href}`, asset.data)
  })
  return zip.generateAsync({ type: 'uint8array', mimeType: 'application/epub+zip' })
}
