import {
  IntermediateDocument,
  IntermediateImage,
  IntermediatePage,
  IntermediatePageMap,
  IntermediateText,
  TextDir
} from '@hamster-note/types'
import { jest } from '@jest/globals'
import { EpubDocument } from '../EpubDocument.js'
import { EpubPage, RenderViews } from '../EpubPage.js'
import { resetPretextAdapter, setPretextAdapter } from '../textMeasurement.js'

/**
 * 测试用文本测量适配器
 * 返回固定的测量结果，避免依赖 @chenglou/pretext
 */
const testAdapter = {
  measure: () => ({ width: 50, height: 20 })
}

/**
 * 构建测试用的 IntermediateText
 */
const buildText = (
  id: string,
  content: string,
  polygon: IntermediateText['polygon'] = [
    [10, 20],
    [110, 20],
    [110, 60],
    [10, 60]
  ]
): IntermediateText =>
  new IntermediateText({
    id,
    content,
    fontSize: 16,
    fontFamily: 'Inter',
    fontWeight: 400,
    italic: false,
    color: '#111111',
    polygon,
    lineHeight: 20,
    ascent: 12,
    descent: 4,
    vertical: false,
    dir: TextDir.LTR,
    skew: 0,
    isEOL: true
  })

/**
 * 构建测试用的 IntermediateDocument（单页）
 */
const buildSinglePageDocument = (): {
  doc: IntermediateDocument
  text: IntermediateText
} => {
  const text = buildText('text-1', 'Hello EPUB')

  const infoList = [
    {
      id: 'page-1',
      pageNumber: 1,
      size: { x: 200, y: 200 },
      getData: async () =>
        new IntermediatePage({
          id: 'page-1',
          number: 1,
          width: 200,
          height: 200,
          content: [text],
          thumbnail: undefined
        })
    }
  ]

  const doc = new IntermediateDocument({
    id: 'doc-1',
    title: 'Test EPUB',
    pagesMap: IntermediatePageMap.makeByInfoList(infoList)
  })

  return { doc, text }
}

/**
 * 构建测试用的 IntermediateDocument（多页）
 */
const buildMultiPageDocument = (): {
  doc: IntermediateDocument
  textA: IntermediateText
  textB: IntermediateText
} => {
  const textA = buildText('text-a', 'First page text')
  const textB = buildText('text-b', 'Second page text')

  const infoList = [
    {
      id: 'page-1',
      pageNumber: 1,
      size: { x: 400, y: 400 },
      getData: async () =>
        new IntermediatePage({
          id: 'page-1',
          number: 1,
          width: 400,
          height: 400,
          content: [textA],
          thumbnail: undefined
        })
    },
    {
      id: 'page-2',
      pageNumber: 2,
      size: { x: 400, y: 400 },
      getData: async () =>
        new IntermediatePage({
          id: 'page-2',
          number: 2,
          width: 400,
          height: 400,
          content: [textB],
          thumbnail: undefined
        })
    }
  ]

  const doc = new IntermediateDocument({
    id: 'doc-2',
    title: 'Multi-Page EPUB',
    pagesMap: IntermediatePageMap.makeByInfoList(infoList)
  })

  return { doc, textA, textB }
}

describe('EpubDocument wrapper', () => {
  it('returns the correct title', () => {
    const { doc } = buildSinglePageDocument()
    const epubDoc = new EpubDocument(doc)

    expect(epubDoc.getTitle()).toBe('Test EPUB')
  })

  it('returns the correct id', () => {
    const { doc } = buildSinglePageDocument()
    const epubDoc = new EpubDocument(doc)

    expect(epubDoc.getId()).toBe('doc-1')
  })

  it('returns the original IntermediateDocument', () => {
    const { doc } = buildSinglePageDocument()
    const epubDoc = new EpubDocument(doc)

    expect(epubDoc.getIntermediateDocument()).toBe(doc)
  })

  it('returns all pages via getPages()', async () => {
    const { doc } = buildMultiPageDocument()
    const epubDoc = new EpubDocument(doc)

    const pages = await epubDoc.getPages()

    expect(pages).toHaveLength(2)
    expect(pages[0]).toBeInstanceOf(EpubPage)
    expect(pages[1]).toBeInstanceOf(EpubPage)
    expect(pages[0].getNumber()).toBe(1)
    expect(pages[1].getNumber()).toBe(2)
  })

  it('returns a single page via getPage()', async () => {
    const { doc } = buildMultiPageDocument()
    const epubDoc = new EpubDocument(doc)

    const page1 = await epubDoc.getPage(1)
    const page2 = await epubDoc.getPage(2)

    expect(page1).toBeDefined()
    expect(page1?.getNumber()).toBe(1)
    expect(page2).toBeDefined()
    expect(page2?.getNumber()).toBe(2)
  })

  it('returns undefined for non-existent page number', async () => {
    const { doc } = buildSinglePageDocument()
    const epubDoc = new EpubDocument(doc)

    const page = await epubDoc.getPage(999)

    expect(page).toBeUndefined()
  })

  it('returns undefined for outline when no outline exists', async () => {
    const { doc } = buildSinglePageDocument()
    const epubDoc = new EpubDocument(doc)

    const outline = await epubDoc.getOutline()

    expect(outline).toBeUndefined()
  })

  it('returns the underlying cover image without requiring DOM globals', async () => {
    const thumbnail = new IntermediateImage({
      id: 'cover-image',
      src: 'data:image/png;base64,FAKE',
      polygon: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100]
      ],
      opacity: 1
    })
    const doc = new IntermediateDocument({
      id: 'doc-with-cover',
      title: 'Covered EPUB',
      pagesMap: IntermediatePageMap.makeByInfoList([
        {
          id: 'page-1',
          pageNumber: 1,
          size: { x: 200, y: 200 },
          getData: async () =>
            new IntermediatePage({
              id: 'page-1',
              number: 1,
              width: 200,
              height: 200,
              content: [],
              thumbnail
            })
        }
      ])
    })
    const epubDoc = new EpubDocument(doc)

    await expect(epubDoc.getCover()).resolves.toBe(thumbnail)
  })
})

describe('EpubPage wrapper', () => {
  it('returns the correct page number', () => {
    const text = buildText('text-1', 'Hello')
    const page = new EpubPage(
      new IntermediatePage({
        id: 'page-1',
        number: 1,
        width: 200,
        height: 300,
        content: [text],
        thumbnail: undefined
      })
    )

    expect(page.getNumber()).toBe(1)
  })

  it('returns scaled size', () => {
    const text = buildText('text-1', 'Hello')
    const page = new EpubPage(
      new IntermediatePage({
        id: 'page-1',
        number: 1,
        width: 200,
        height: 300,
        content: [text],
        thumbnail: undefined
      })
    )

    expect(page.getSize(1)).toEqual({ x: 200, y: 300 })
    expect(page.getSize(0.5)).toEqual({ x: 100, y: 150 })
    expect(page.getSize(2)).toEqual({ x: 400, y: 600 })
  })

  it('returns pure text content joined by newlines', () => {
    const text1 = buildText('text-1', 'First line')
    const text2 = buildText('text-2', 'Second line')
    const page = new EpubPage(
      new IntermediatePage({
        id: 'page-1',
        number: 1,
        width: 200,
        height: 300,
        content: [text1, text2],
        thumbnail: undefined
      })
    )

    expect(page.getPureText()).toBe('First line\nSecond line')
  })

  it('filters out non-text content in getPureText()', () => {
    const text = buildText('text-1', 'Text content')
    const image = new IntermediateImage({
      id: 'image-1',
      src: 'data:image/png;base64,FAKE',
      polygon: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100]
      ],
      opacity: 1
    })
    const page = new EpubPage(
      new IntermediatePage({
        id: 'page-1',
        number: 1,
        width: 200,
        height: 300,
        content: [text, image],
        thumbnail: undefined
      })
    )

    expect(page.getPureText()).toBe('Text content')
  })

  it('returns empty string for page with no text content', () => {
    const image = new IntermediateImage({
      id: 'image-1',
      src: 'data:image/png;base64,FAKE',
      polygon: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100]
      ],
      opacity: 1
    })
    const page = new EpubPage(
      new IntermediatePage({
        id: 'page-1',
        number: 1,
        width: 200,
        height: 300,
        content: [image],
        thumbnail: undefined
      })
    )

    expect(page.getPureText()).toBe('')
  })

  it('renders text content to container', async () => {
    setPretextAdapter(testAdapter)

    try {
      const text = buildText('text-1', 'Hello renderer')
      const page = new EpubPage(
        new IntermediatePage({
          id: 'page-1',
          number: 1,
          width: 200,
          height: 200,
          content: [text],
          thumbnail: undefined
        })
      )

      // 创建模拟的 DOM 容器
      const mockDocument = {
        createElement: (_tag: string) => {
          const element = {
            style: {} as Record<string, string>,
            className: '',
            id: '',
            textContent: '',
            innerHTML: '',
            setAttribute: (_name: string, value: string) => {
              // 解析样式字符串并设置到 style 对象
              const pairs = value.split(';').filter(Boolean)
              for (const pair of pairs) {
                const [key, val] = pair.split(':').map((s) => s.trim())
                if (key && val) {
                  element.style[key] = val
                }
              }
            },
            appendChild: jest.fn(),
            querySelectorAll: jest.fn().mockReturnValue([])
          }
          return element
        }
      }

      const container = {
        ownerDocument: mockDocument,
        innerHTML: '',
        style: {} as Record<string, string>,
        appendChild: jest.fn()
      } as unknown as HTMLDivElement

      await page.render(container, { scale: 1, views: [RenderViews.TEXT] })

      // 验证容器被清空
      expect(container.innerHTML).toBe('')

      // 验证容器尺寸被设置
      expect(container.style.width).toBe('200px')
      expect(container.style.height).toBe('200px')
    } finally {
      resetPretextAdapter()
    }
  })
})
