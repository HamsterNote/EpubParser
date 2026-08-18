import JSZip from 'jszip'
import { EpubArchive } from '../EpubArchive'

const makeArchive = async (chapterSource = 'https://example.test/image.png'): Promise<Uint8Array> => {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
  )
  zip.file(
    'EPUB/package.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Fallback TOC</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="ncx" href="missing.ncx" media-type="application/x-dtbncx+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine toc="ncx"><itemref idref="chapter"/></spine></package>`
  )
  zip.file(
    'EPUB/nav.xhtml',
    '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc landmarks"><ol><li><a href="chapter.xhtml">Chapter One</a></li></ol></nav></body></html>'
  )
  zip.file(
    'EPUB/chapter.xhtml',
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>Text</p><img src="${chapterSource}"/></body></html>`
  )
  return zip.generateAsync({ type: 'uint8array' })
}

describe('EpubArchive cross-version navigation', () => {
  it('falls back to a tokenized EPUB 3 nav document when NCX is unavailable', async () => {
    // Given: an EPUB whose declared NCX is missing but whose nav has multiple epub:type tokens.
    const archive = new EpubArchive(await makeArchive())

    // When: the archive metadata and navigation are parsed.
    await archive.parse()

    // Then: the valid EPUB 3 table of contents remains available.
    expect(archive.toc).toEqual([
      expect.objectContaining({ title: 'Chapter One', href: 'EPUB/chapter.xhtml', id: 'chapter' })
    ])
  })

  it('resolves table-of-contents links relative to the navigation document', async () => {
    // Given: a nav document in a different directory from the OPF and chapter.
    const zip = new JSZip()
    zip.file('mimetype', 'application/epub+zip')
    zip.file(
      'META-INF/container.xml',
      '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
    )
    zip.file(
      'EPUB/package.opf',
      '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Nested Navigation</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="text/chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="navigation/nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="chapter"/></spine></package>'
    )
    zip.file(
      'EPUB/navigation/nav.xhtml',
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="../text/chapter.xhtml#start">Chapter One</a></li></ol></nav></body></html>'
    )
    zip.file(
      'EPUB/text/chapter.xhtml',
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1 id="start">Chapter One</h1></body></html>'
    )
    const archive = new EpubArchive(await zip.generateAsync({ type: 'uint8array' }))

    // When: navigation is parsed through epub-ts.
    await archive.parse()

    // Then: the href resolves from the nav file and still maps to the manifest item.
    expect(archive.toc).toEqual([
      expect.objectContaining({ title: 'Chapter One', href: 'EPUB/text/chapter.xhtml#start', id: 'chapter' })
    ])
  })

  it('reads archive entries referenced by percent-encoded manifest paths', async () => {
    // Given: an OPF URI encodes a space while the ZIP entry stores the decoded filename.
    const zip = new JSZip()
    zip.file('mimetype', 'application/epub+zip')
    zip.file(
      'META-INF/container.xml',
      '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
    )
    zip.file(
      'EPUB/package.opf',
      '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Encoded Path</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="text/chapter%201.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>'
    )
    zip.file(
      'EPUB/text/chapter 1.xhtml',
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>Encoded chapter path</p></body></html>'
    )
    const archive = new EpubArchive(await zip.generateAsync({ type: 'uint8array' }))
    await archive.parse()

    // When: the chapter is read through its manifest identifier.
    const chapter = await archive.getChapter('chapter')

    // Then: the URI maps to the decoded ZIP entry name.
    expect(chapter).toContain('Encoded chapter path')
  })

  it('preserves image sources that are not represented in the manifest', async () => {
    // Given: chapter markup containing an external image reference.
    const archive = new EpubArchive(await makeArchive())
    await archive.parse()

    // When: normalized chapter HTML is requested.
    const chapter = await archive.getChapter('chapter')

    // Then: normalization does not silently delete the original source attribute.
    expect(chapter).toContain('src="https://example.test/image.png"')
  })

  it('keeps chapter normalization when an optional stylesheet is missing', async () => {
    // Given: 样式表列在 manifest 中但归档条目损坏，同时章节图片仍然有效。
    const zip = new JSZip()
    zip.file('mimetype', 'application/epub+zip')
    zip.file(
      'META-INF/container.xml',
      '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
    )
    zip.file(
      'EPUB/package.opf',
      '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Missing CSS</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="styles" href="missing.css" media-type="text/css"/><item id="photo" href="photo.png" media-type="image/png"/></manifest><spine><itemref idref="chapter"/></spine></package>'
    )
    zip.file(
      'EPUB/chapter.xhtml',
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="missing.css"/></head><body><img src="photo.png"/></body></html>'
    )
    zip.file('EPUB/photo.png', new Uint8Array([1, 2, 3]))
    const archive = new EpubArchive(await zip.generateAsync({ type: 'uint8array' }))
    await archive.parse()

    // When: 请求经过资源规范化的章节 HTML。
    const chapter = await archive.getChapter('chapter')

    // Then: 缺失样式被跳过，归档图片仍重写为可解析的内部路径。
    expect(chapter).toContain('src="/images/photo/EPUB/photo.png"')
  })

  it('inlines linked stylesheets at their original cascade position', async () => {
    // Given: 外链样式位于后续内联样式之前，二者声明同一属性。
    const zip = new JSZip()
    zip.file('mimetype', 'application/epub+zip')
    zip.file(
      'META-INF/container.xml',
      '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
    )
    zip.file(
      'EPUB/package.opf',
      '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>CSS Cascade</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="styles" href="styles.css" media-type="text/css"/></manifest><spine><itemref idref="chapter"/></spine></package>'
    )
    zip.file(
      'EPUB/chapter.xhtml',
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="styles.css"/><style>p { text-indent: 0; }</style></head><body><p>Text</p></body></html>'
    )
    zip.file('EPUB/styles.css', 'p { text-indent: 32px; }')
    const archive = new EpubArchive(await zip.generateAsync({ type: 'uint8array' }))
    await archive.parse()

    // When: 外链 CSS 被转换成解析器可读取的内联样式。
    const chapter = await archive.getChapter('chapter')

    // Then: 替换后的 style 仍位于作者原本的内联 style 之前。
    expect(chapter.indexOf('text-indent: 32px')).toBeLessThan(chapter.indexOf('text-indent: 0'))
  })

  it('bounds repeated stylesheet embedding per chapter', async () => {
    // Given: 一个小型章节重复引用同一个 CSS 资源 40 次。
    const zip = new JSZip()
    zip.file('mimetype', 'application/epub+zip')
    zip.file(
      'META-INF/container.xml',
      '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
    )
    zip.file(
      'EPUB/package.opf',
      '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>CSS Budget</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="styles" href="styles.css" media-type="text/css"/></manifest><spine><itemref idref="chapter"/></spine></package>'
    )
    const links = '<link rel="stylesheet" href="styles.css"/>'.repeat(40)
    zip.file(
      'EPUB/chapter.xhtml',
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head>${links}</head><body><p>Text</p></body></html>`
    )
    zip.file('EPUB/styles.css', 'p { text-indent: 32px; }')
    const archive = new EpubArchive(await zip.generateAsync({ type: 'uint8array' }))
    await archive.parse()

    // When: 章节规范化尝试内联所有重复引用。
    const chapter = await archive.getChapter('chapter')

    // Then: 只有预算内的 32 项被内联，其余引用保留而不会复制无界 CSS。
    expect(chapter.match(/<style>/g)).toHaveLength(32)
    expect(chapter.match(/<link\b/g)).toHaveLength(8)
  })

  it('rejects an entry whose declared expanded size exceeds the safety limit', async () => {
    // Given: a ZIP central-directory entry claiming an unsafe expanded size.
    const zip = new JSZip()
    zip.file('payload', 'small')
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let offset = 0; offset <= bytes.byteLength - 46; offset += 1) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        view.setUint32(offset + 24, 16 * 1024 * 1024 + 1, true)
        break
      }
    }

    // When: the untrusted archive is parsed.
    const result = new EpubArchive(bytes).parse()

    // Then: parsing stops before the oversized entry can be inflated.
    await expect(result).rejects.toThrow('EPUB archive entry exceeds the size limit')
  })

  it('rejects actual expanded data when ZIP metadata understates its size', async () => {
    // Given: highly compressed data whose local and central size declarations are forged as safe.
    const zip = new JSZip()
    zip.file('mimetype', 'application/epub+zip')
    zip.file(
      'META-INF/container.xml',
      '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
    )
    zip.file(
      'EPUB/package.opf',
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Limit Test</dc:title></metadata><manifest/><spine/><!--${'x'.repeat(16 * 1024 * 1024 + 1)}--></package>`
    )
    const bytes = await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 }
    })
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let offset = 0; offset <= bytes.byteLength - 30; offset += 1) {
      const signature = view.getUint32(offset, true)
      if (signature === 0x04034b50 || signature === 0x02014b50) {
        const fileNameLength = view.getUint16(offset + (signature === 0x04034b50 ? 26 : 28), true)
        const fileNameOffset = offset + (signature === 0x04034b50 ? 30 : 46)
        const fileName = new TextDecoder().decode(bytes.subarray(fileNameOffset, fileNameOffset + fileNameLength))
        if (fileName === 'EPUB/package.opf') {
          view.setUint32(offset + (signature === 0x04034b50 ? 22 : 24), 1, true)
        }
      }
    }

    // When: the forged entry is preflighted before third-party EPUB parsing begins.
    const result = new EpubArchive(bytes).parse()

    // Then: actual streamed output is capped independently from attacker-controlled metadata.
    await expect(result).rejects.toThrow('EPUB archive expanded data exceeds the size limit')
  })
})
