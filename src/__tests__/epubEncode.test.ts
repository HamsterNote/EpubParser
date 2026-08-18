import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IntermediateDocument } from '@hamster-note/types'
import JSZip from 'jszip'
import { type EpubDocumentExtensions, EpubParser } from '../index'

// 页面内容里文本项的结构子集（避免依赖 IntermediateText 具体类形态）
type PageText = {
  id: string
  content: string
  fontSize: number
  fontFamily: string
  fontWeight: number
  italic: boolean
  color: string
  lineHeight: number
  polygon: number[][]
}

const pageTexts = (content: unknown[]): PageText[] =>
  content.filter(
    (item): item is PageText =>
      typeof item === 'object' && item !== null && 'content' in item
  )

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const fixturePath = (name: string) => join(fixtureDir, name)

type DocumentWithEpubData = IntermediateDocument & Partial<EpubDocumentExtensions>

const encodeFixture = async (name: string): Promise<DocumentWithEpubData> => {
  const epubDocument = await EpubParser.encode(fixturePath(name))
  return epubDocument.getIntermediateDocument() as DocumentWithEpubData
}

const makeInlineImageEpub = async (): Promise<Uint8Array> => {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
  )
  zip.file(
    'EPUB/package.opf',
    '<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">inline-image-order</dc:identifier><dc:title>Inline Image Order</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2024-01-15T00:00:00Z</meta></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="marker" href="marker.png" media-type="image/png"/></manifest><spine><itemref idref="chapter"/></spine></package>'
  )
  zip.file(
    'EPUB/chapter.xhtml',
    '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><p>Before inline image. <img src="marker.png" data-src="placeholder.png" alt="first > marker"/> Between inline images.</p><img src="marker.png" alt="second marker"/><p>After inline image.</p></body></html>'
  )
  zip.file('EPUB/marker.png', await readFile(fixturePath('red.png')))
  return zip.generateAsync({ type: 'uint8array' })
}

const makeStyledLayoutEpub = async (): Promise<Uint8Array> => {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
  )
  zip.file(
    'EPUB/package.opf',
    '<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">styled-layout</dc:identifier><dc:title>Styled Layout</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2024-01-15T00:00:00Z</meta></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="styles-before" href="styles-before.css" media-type="text/css"/><item id="styles-after" href="styles-after.css" media-type="text/css"/><item id="photo" href="photo.png" media-type="image/png"/></manifest><spine><itemref idref="chapter"/></spine></package>'
  )
  zip.file(
    'EPUB/chapter.xhtml',
    '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Chapter</title><link rel="stylesheet" href="styles-before.css"/><style>.styled { font-size: 22px; font-family: "Literata", serif; font-weight: 600; color: #fff; background: #000; } .right { text-align: right; } .cascade { text-indent: 0; } .reverse { text-indent: 0; }</style><link rel="stylesheet" href="styles-after.css"/></head><body><p class="styled">Styled paragraph.</p><p class="right">Right aligned.</p><p class="indent">Indented paragraph.</p><p>    Space-indented first line.\nContinuation line.</p><p>   Three spaces stay plain.</p><p class="no-indent">    Explicit zero indent.</p><p class="cascade">External before inline.</p><p class="reverse">Inline before external.</p><p class="note">Chapter-end explanatory note.</p><p role="note">Role note.</p><p epub:type="note">EPUB semantic note.</p><aside>Neutral aside.</aside><img src="photo.png" width="1200" height="600" alt="wide photo"/></body></html>'
  )
  zip.file(
    'EPUB/styles-before.css',
    '.indent, .cascade { text-indent: 32px; } .no-indent { text-indent: 0; }'
  )
  zip.file('EPUB/styles-after.css', '.reverse { text-indent: 32px; }')
  zip.file('EPUB/photo.png', await readFile(fixturePath('red.png')))
  return zip.generateAsync({ type: 'uint8array' })
}

const makeNestedTocEpub = async (): Promise<Uint8Array> => {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
  )
  zip.file(
    'EPUB/package.opf',
    '<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">nested-toc</dc:identifier><dc:title>Nested TOC</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2024-01-15T00:00:00Z</meta></metadata><manifest><item id="chapter" href="text/chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="chapter"/></spine></package>'
  )
  zip.file(
    'EPUB/nav.xhtml',
    '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="text/chapter.xhtml">Chapter</a><ol><li><a href="text/chapter.xhtml#target-section">Target section</a></li></ol></li><li id="chapter"><a href="https://example.com/reference">External reference</a></li></ol></nav></body></html>'
  )
  zip.file(
    'EPUB/text/chapter.xhtml',
    '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><h1>Chapter heading</h1><section><p>Before target.\n<span id="target-section">Target heading</span></p><p>Target body.</p></section></body></html>'
  )
  return zip.generateAsync({ type: 'uint8array' })
}

describe('EpubParser.encode', () => {
  it('parses minimal.epub metadata and spine pages', async () => {
    const doc = await encodeFixture('minimal.epub')
    const pages = await doc.pages

    expect(doc.title).toBe('Minimal Test Book')
    expect(doc.metadata?.title).toBe('Minimal Test Book')
    expect(doc.metadata?.author).toBe('Test Author')
    expect(doc.pageCount).toBeGreaterThanOrEqual(1)
    expect(pages.length).toBeGreaterThanOrEqual(1)
    expect(pages.every((page) => page.useFlowLayout === true)).toBe(true)
    expect(pages[0].number).toBe(1)
    expect(pages[0].content.some((item) => 'content' in item)).toBe(true)
  })

  it('preserves non-ASCII metadata without mojibake', async () => {
    const doc = await encodeFixture('non-ascii-metadata.epub')

    expect(doc.title).toBe('测试书')
    expect(doc.metadata?.title).toBe('测试书')
    expect(doc.metadata?.author).toBe('测试作者')
    expect(doc.title).not.toContain('�')
    expect(doc.title).not.toContain('æ')
  })

  it('maps TOC entries to IntermediateOutline when epub exposes TOC data', async () => {
    const doc = await encodeFixture('with-toc.epub')
    const outline = doc.getOutline()

    if (outline && outline.length > 0) {
      const outlineText = outline.map((item) => item.content).join('\n')
      expect(outlineText).toContain('First Chapter')
      expect(outlineText).toContain('Second Chapter')
      expect(outlineText).toContain('Third Chapter')
      expect(outline[0].dest.targetType).toBeDefined()
    } else {
      expect(doc.epubTocMappingLimitation).toBe(
        'The epub package did not expose NCX TOC items for this EPUB.'
      )
    }
  })

  it('maps nested TOC fragments to the corresponding page text', async () => {
    // Given: 二级目录项链接到章节内 section id，而不是只链接到章节页
    const epub = await makeNestedTocEpub()

    // When: parser 将 EPUB 导航与正文转换为 IntermediateDocument
    const parsed = await EpubParser.encode(epub)
    const doc = parsed.getIntermediateDocument() as DocumentWithEpubData
    const pages = await doc.pages
    const outline = doc.getOutline()

    // Then: 目录层级被保留，fragment 使用原生 TEXT 目标指向真实正文文本
    expect(doc.epubTocItems?.map((item) => item.level)).toEqual([0, 1, 0])
    expect(outline?.[0].dest).toEqual({ targetType: 'page', pageId: pages[0].id })
    expect(outline?.[1].dest.targetType).toBe('text')
    if (outline?.[1].dest.targetType !== 'text') {
      throw new Error('nested TOC entry did not resolve to a text destination')
    }
    expect(outline[1].dest.textId).toBe(
      pageTexts(pages[0].content as unknown[]).find((text) => text.content === 'Target heading')?.id
    )
    expect(outline[1].dest.textId).not.toBe(
      pageTexts(pages[0].content as unknown[]).find((text) => text.content === 'Before target.')?.id
    )
    expect(outline[2].dest).toEqual({
      targetType: 'url',
      url: 'https://example.com/reference',
      unsafeUrl: 'https://example.com/reference',
      newWindow: false
    })
  })

  it('exposes image references and page image content when available', async () => {
    const doc = await encodeFixture('with-images.epub')
    const pages = await doc.pages
    const imageContentCount = pages.reduce(
      (count, page) => count + page.content.filter((item) => 'src' in item).length,
      0
    )

    expect(doc.epubImages?.length).toBeGreaterThanOrEqual(1)
    expect(doc.epubImages?.[0]?.mimeType).toMatch(/^image\//)
    expect(doc.epubImages?.[0]?.src ?? doc.epubImages?.[0]?.error).toBeDefined()
    expect(imageContentCount).toBeGreaterThanOrEqual(1)
  })

  it('preserves every inline image occurrence and its page geometry', async () => {
    // Given: 同一图片资源在段落内部与段落之间各出现一次
    const epub = await makeInlineImageEpub()

    // When: parser 将 EPUB 转换成 IntermediatePage
    const parsed = await EpubParser.encode(epub)
    const pages = await parsed.getIntermediateDocument().pages

    // Then: 每次 DOM occurrence 都必须保留，且几何坐标与内容顺序一致
    const content = pages[0].content
    expect(content.map((item) => ('src' in item ? 'image' : item.content))).toEqual([
      'Before inline image.',
      'image',
      'Between inline images.',
      'image',
      'After inline image.'
    ])
    expect(content.map((item) => item.polygon[0][1])).toEqual(
      [...content.map((item) => item.polygon[0][1])].sort((left, right) => left - right)
    )
  })

  it('creates the first IntermediatePage from an independent cover image', async () => {
    // Given: 封面是 manifest 中的 cover-image，但不在 EPUB spine 中
    const doc = await encodeFixture('with-cover.epub')

    // When: 通过 IntermediateDocument 页面接口读取解析结果
    const pages = await doc.pages

    // Then: 封面独占第一页，原正文顺延到第二页
    expect(doc.epubCover?.kind).toBe('cover')
    expect(doc.epubCover?.mimeType).toMatch(/^image\//)
    expect(doc.pageCount).toBe(2)
    expect(pages).toHaveLength(2)
    expect(pages[0].number).toBe(1)
    expect(pages[0].content).toHaveLength(1)
    expect(pages[0].content[0]).toMatchObject({ src: doc.epubCover?.src })
    expect(pages[1].number).toBe(2)
    expect(pageTexts(pages[1].content as unknown[]).map((text) => text.content)).toContain(
      'This book has a cover image.'
    )
  })

  it('maps headings, footnotes and inline emphasis to distinct text styles', async () => {
    const doc = await encodeFixture('styled-text.epub')
    const pages = await doc.pages
    const texts = pageTexts(pages[0].content as unknown[])

    // 按内容定位每一行，断言其样式来自 HTML 语义而非统一常量
    const findLine = (fragment: string): PageText => {
      const line = texts.find((text) => text.content.includes(fragment))
      if (!line) throw new Error(`line containing "${fragment}" not found`)
      return line
    }

    // S1: 标题层级 → 更大的字号 + 粗体
    const h1 = findLine('Chapter Heading One')
    expect(h1.fontSize).toBe(28)
    expect(h1.fontWeight).toBe(700)
    expect(h1.lineHeight).toBeGreaterThan(24)

    const h2 = findLine('Section Heading Two')
    expect(h2.fontSize).toBe(24)
    expect(h2.fontWeight).toBe(700)

    // S1: 正文保持基准字号
    const body = findLine('Second body line stays plain.')
    expect(body.fontSize).toBe(16)
    expect(body.fontWeight).toBe(400)
    expect(body.italic).toBe(false)

    // S1: aside 脚注 → 更小字号
    const footnote = findLine('Footnote body text')
    expect(footnote.fontSize).toBeLessThan(16)
    expect(footnote.fontSize).toBe(13)
    expect(footnote.italic).toBe(true)
    expect(footnote.color).toBe('#5f5b53')

    // S2: 混合行（含 sup/b/i 的正文）取最强语义——仍是正文段，
    // 但粗体或斜体标记应提升 fontWeight 或 italic 之一
    const mixed = findLine('Body paragraph with a note')
    expect(mixed.fontSize).toBe(16)
    expect(mixed.fontWeight === 700 || mixed.italic).toBe(true)

    // S1: y 坐标按各行实际 lineHeight 累计——h1 之后正文不能再以 24 等距排布
    expect(h2.polygon[0][1]).toBeGreaterThan(h1.polygon[0][1] + 24)
  })

  it('keeps uniform 16px layout for plain-paragraph chapters', async () => {
    // S3: 无语义标签的普通章节保持原有 16px/400 行为不变
    const doc = await encodeFixture('minimal.epub')
    const pages = await doc.pages
    const texts = pageTexts(pages[0].content as unknown[])

    expect(texts.length).toBeGreaterThan(0)
    texts.forEach((text) => {
      expect(text.fontSize).toBe(16)
      expect(text.fontWeight).toBe(400)
      expect(text.italic).toBe(false)
    })
  })

  it('maps CSS typography, paragraph alignment, indentation and image dimensions', async () => {
    // Given: EPUB 章节通过 class CSS 描述字体、段落布局，并包含一张超出页面宽度的图片
    const epub = await makeStyledLayoutEpub()

    // When: parser 将章节转换为 IntermediatePage
    const parsed = await EpubParser.encode(epub)
    const pages = await parsed.getIntermediateDocument().pages
    const page = pages[0]
    const texts = pageTexts(page.content as unknown[])
    const findLine = (content: string): PageText => {
      const line = texts.find((text) => text.content === content)
      if (!line) throw new Error(`line "${content}" not found`)
      return line
    }

    // Then: CSS 样式映射到文本与段落，首行缩进反映为文本 x 偏移
    expect(findLine('Styled paragraph.')).toMatchObject({
      fontSize: 22,
      fontFamily: 'Literata',
      fontWeight: 600,
      color: '#000000'
    })
    const rightText = findLine('Right aligned.')
    const rightParagraph = page.paragraphs.find((paragraph) =>
      paragraph.textIds.includes(rightText.id)
    )
    expect(rightParagraph?.textAlign).toBe('right')
    expect(rightText.polygon[1][0]).toBe(760)
    expect(findLine('Indented paragraph.').polygon[0][0]).toBe(72)

    // Then: 4 个半角空格映射为 2em 首行缩进，后续行仍从段落左边界开始
    expect(findLine('Space-indented first line.').polygon[0][0]).toBe(72)
    expect(findLine('Continuation line.').polygon[0][0]).toBe(40)
    expect(findLine('Three spaces stay plain.').polygon[0][0]).toBe(40)
    expect(findLine('Explicit zero indent.').polygon[0][0]).toBe(40)
    expect(findLine('External before inline.').polygon[0][0]).toBe(40)
    expect(findLine('Inline before external.').polygon[0][0]).toBe(72)

    // Then: 常见 note class 的章末注释使用较小、斜体和弱化颜色，与正文明确区分
    expect(findLine('Chapter-end explanatory note.')).toMatchObject({
      fontSize: 13,
      italic: true,
      color: '#5f5b53'
    })
    expect(findLine('Role note.')).toMatchObject({
      fontSize: 13,
      italic: true,
      color: '#5f5b53'
    })
    expect(findLine('EPUB semantic note.')).toMatchObject({
      fontSize: 13,
      italic: true,
      color: '#5f5b53'
    })
    expect(findLine('Neutral aside.')).toMatchObject({
      fontSize: 13,
      italic: false,
      color: '#000000'
    })

    // Then: 图片保持 2:1 比例、缩小到 720px 可用宽度并水平居中
    const image = page.content.find((item) => 'src' in item)
    expect(image?.polygon).toEqual([
      [40, expect.any(Number)],
      [760, expect.any(Number)],
      [760, expect.any(Number)],
      [40, expect.any(Number)]
    ])
    expect((image?.polygon[2][1] ?? 0) - (image?.polygon[1][1] ?? 0)).toBe(360)
  })

  it('upscales tiny images to 70 percent of the readable content width', async () => {
    // Given: fixture 中图片 intrinsic size 仅为 1×1px
    const doc = await encodeFixture('with-images.epub')

    // When: 读取 encode 生成的 IntermediateImage polygon
    const pages = await doc.pages
    const image = pages[0].content.find((item) => 'src' in item)

    // Then: 图片等比放大到 720px 内容区的 70%，且保持正方形比例并居中
    expect(image?.polygon).toEqual([
      [148, expect.any(Number)],
      [652, expect.any(Number)],
      [652, expect.any(Number)],
      [148, expect.any(Number)]
    ])
    expect((image?.polygon[2][1] ?? 0) - (image?.polygon[1][1] ?? 0)).toBe(504)
  })
})
