import assert from 'node:assert/strict'
import test from 'node:test'

import { documentToHtml } from './documentToHtml.mjs'

const createPage = (number, content, paragraphs = []) => ({
  id: `page-${number}`,
  number,
  paragraphs,
  getContent: async () => content
})

test('按页码和页面内容顺序生成可阅读 HTML', async () => {
  // Given：页面数组顺序与实际页码不同，第一页包含文字、图片、文字。
  const document = {
    title: '示例 & 书籍',
    pages: Promise.resolve([
      createPage(2, [{ content: '第二页' }]),
      createPage(1, [
        { content: '图片之前' },
        { src: 'data:image/png;base64,aGVsbG8=', alt: '插图 <一>' },
        { content: '图片之后' }
      ])
    ])
  }

  // When：把 IntermediateDocument 转换为 Demo 展示 HTML。
  const html = await documentToHtml(document)

  // Then：页码有序，内容位置不变，所有文本属性均经过转义。
  assert.ok(html.indexOf('第 1 页') < html.indexOf('第 2 页'))
  assert.ok(html.indexOf('图片之前') < html.indexOf('<img'))
  assert.ok(html.indexOf('<img') < html.indexOf('图片之后'))
  assert.match(html, /示例 &amp; 书籍/)
  assert.match(html, /alt="插图 &lt;一&gt;"/)
  assert.match(html, /<figcaption>插图 &lt;一&gt;<\/figcaption>/)
})

test('拒绝非图片 data URL 和远程图片源', async () => {
  // Given：页面内容包含可执行协议、远程地址，以及一个合法的图片 data URL。
  const document = {
    title: '安全边界',
    pages: Promise.resolve([
      createPage(1, [
        { src: 'javascript:alert(1)' },
        { src: 'https://example.com/tracker.png' },
        { src: 'data:text/html;base64,PHNjcmlwdD4=' },
        { src: 'data:image/webp;base64,UklGRg==' }
      ])
    ])
  }

  // When：生成预览 HTML。
  const html = await documentToHtml(document)

  // Then：仅保留解析器内嵌的图片 data URL，其他源不会进入 HTML。
  assert.doesNotMatch(html, /javascript:|https:\/\/|data:text\/html/)
  assert.match(html, /src="data:image\/webp;base64,UklGRg=="/)
  assert.equal((html.match(/<img/g) ?? []).length, 1)
})

test('把文字样式、段落对齐和首行缩进映射到预览 HTML', async () => {
  // Given：两段文字分别携带右对齐和首行缩进语义。
  const document = {
    title: '样式预览',
    pages: Promise.resolve([
      createPage(
        1,
        [
          {
            id: 'heading',
            content: '有样式的标题',
            fontSize: 28,
            fontFamily: 'Literata',
            fontWeight: 700,
            italic: true,
            color: '#123456',
            opacity: 0.8,
            lineHeight: 42,
            polygon: [[500, 40], [760, 40], [760, 82], [500, 82]]
          },
          {
            id: 'indented',
            content: '有首行缩进的正文',
            fontSize: 16,
            fontFamily: 'sans-serif',
            polygon: [[72, 100], [300, 100], [300, 124], [72, 124]]
          }
        ],
        [
          { x: 40, textIds: ['heading'], textAlign: 'right' },
          { x: 40, textIds: ['indented'], textAlign: 'left' }
        ]
      )
    ])
  }

  // When：把 IntermediateDocument 转换为 Demo 展示 HTML。
  const html = await documentToHtml(document)

  // Then：安全 CSS 变量、对齐类和由 polygon 推导的 32px 缩进均被保留。
  assert.match(html, /class="epub-text epub-align-right epub-italic"/)
  assert.match(html, /--epub-font-size:28px/)
  assert.match(html, /--epub-font-family:&quot;Literata&quot;/)
  assert.match(html, /--epub-font-family:sans-serif/)
  assert.doesNotMatch(html, /--epub-font-family:&quot;sans-serif&quot;/)
  assert.match(html, /--epub-font-weight:700/)
  assert.match(html, /--epub-text-color:#123456/)
  assert.match(html, /--epub-text-opacity:0\.8/)
  assert.match(html, /--epub-line-height:42px/)
  assert.match(html, /data-text-indent="32"/)
  assert.match(html, /--epub-text-indent:32px/)
})

test('按照图片 polygon 保留预览尺寸和页面内位置', async () => {
  // Given：图片在 800px 页面内居中，polygon 尺寸为 120×60。
  const document = {
    title: '图片预览',
    pages: Promise.resolve([
      createPage(1, [
        {
          src: 'data:image/png;base64,aGVsbG8=',
          alt: '居中插图',
          polygon: [[340, 64], [460, 64], [460, 124], [340, 124]]
        }
      ])
    ])
  }

  // When：生成预览 HTML。
  const html = await documentToHtml(document)

  // Then：图片宽高、宽高比和居中语义被写入受限变量，而非被统一拉伸。
  assert.match(html, /class="epub-image epub-image-center"/)
  assert.match(html, /data-image-width="120"/)
  assert.match(html, /data-image-height="60"/)
  assert.match(html, /--epub-image-width:120px/)
  assert.match(html, /--epub-image-aspect-ratio:2/)
})

test('预览图片样式为过小插图提供 70% 最小宽度', async () => {
  // Given：IntermediateDocument 中仍存在历史生成的 1×1 图片 polygon。
  const css = await import('node:fs/promises').then(({ readFile }) =>
    readFile(new URL('./preview.css', import.meta.url), 'utf8')
  )

  // When：检查 Demo 实际应用到 figure 与 img 的响应式样式。
  // Then：容器承担唯一的 70% 最小宽度，图片填满容器，避免两层百分比相乘为 49%。
  assert.match(css, /\.epub-image\s*\{[^}]*min-width:\s*70%/s)
  assert.match(css, /\.epub-image img\s*\{[^}]*width:\s*100%/s)
  assert.doesNotMatch(css, /\.epub-image img\s*\{[^}]*min-width:/s)
})

test('空文档生成明确的空状态', async () => {
  // Given：IntermediateDocument 没有页面。
  const document = { title: '', pages: Promise.resolve([]) }

  // When：生成预览 HTML。
  const html = await documentToHtml(document)

  // Then：Demo 给出可读反馈，而不是空白区域。
  assert.match(html, /这个 EPUB 没有可展示的页面/)
})
