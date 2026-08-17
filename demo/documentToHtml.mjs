const escapeHtml = (value) => {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// EPUB 解析器会把归档内图片规范化为 base64 data URL。
// Demo 只展示这种自包含图片，避免预览过程发起外部请求或接受可执行协议。
const isEmbeddedImage = (src) => {
  return /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,[a-z0-9+/=\s]+$/i.test(src)
}

const finiteNumber = (value, minimum, maximum) => {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : undefined
}

const GENERIC_FONT_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong'
])

const polygonBox = (polygon) => {
  if (!Array.isArray(polygon) || polygon.length < 3) return undefined

  const xs = polygon.map((point) => finiteNumber(point?.[0], -100000, 100000))
  const ys = polygon.map((point) => finiteNumber(point?.[1], -100000, 100000))
  if (xs.some((value) => value === undefined) || ys.some((value) => value === undefined)) {
    return undefined
  }

  const left = Math.min(...xs)
  const top = Math.min(...ys)
  const width = Math.max(...xs) - left
  const height = Math.max(...ys) - top
  if (width <= 0 || height <= 0) return undefined

  return { left, top, width, height }
}

const safeFontFamily = (value) => {
  if (typeof value !== 'string') return undefined

  // 字体名进入引号包裹的 CSS 变量前，只保留普通可见字符，避免打断 style 属性。
  const unsafeCharacters = new Set(['"', "'", '\\', ';', '{', '}', '<', '>'])
  const family = [...value]
    .filter((character) => {
      const characterCode = character.charCodeAt(0)
      return characterCode >= 32 && characterCode !== 127 && !unsafeCharacters.has(character)
    })
    .join('')
    .trim()
    .slice(0, 80)
  return family || undefined
}

const serializeFontFamily = (value) => {
  const family = safeFontFamily(value)
  if (!family) return undefined
  return GENERIC_FONT_FAMILIES.has(family.toLowerCase())
    ? family.toLowerCase()
    : escapeHtml(`"${family}"`)
}

const safeColor = (value) => {
  if (typeof value !== 'string') return undefined
  const color = value.trim()
  return /^(?:#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/i.test(color)
    ? color
    : undefined
}

const paragraphByTextId = (paragraphs) => {
  const result = new Map()
  for (const paragraph of Array.isArray(paragraphs) ? paragraphs : []) {
    for (const textId of Array.isArray(paragraph?.textIds) ? paragraph.textIds : []) {
      result.set(textId, paragraph)
    }
  }
  return result
}

const textPresentation = (item, paragraph) => {
  const styles = []
  const classes = ['epub-text']
  const attributes = []
  const fontSize = finiteNumber(item.fontSize, 6, 200)
  const fontWeight = finiteNumber(item.fontWeight, 1, 1000)
  const opacity = finiteNumber(item.opacity, 0, 1)
  const lineHeight = finiteNumber(item.lineHeight, 6, 400)
  const fontFamily = serializeFontFamily(item.fontFamily)
  const color = safeColor(item.color)
  const alignment = ['start', 'end', 'left', 'right', 'center', 'justify'].includes(paragraph?.textAlign)
    ? paragraph.textAlign
    : undefined
  const box = polygonBox(item.polygon)
  const paragraphX = finiteNumber(paragraph?.x, -100000, 100000)
  const indent = alignment !== 'right' && alignment !== 'end' && alignment !== 'center' && box && paragraphX !== undefined
    ? finiteNumber(box.left - paragraphX, 0, 1000)
    : undefined

  if (alignment) classes.push(`epub-align-${alignment}`)
  if (item.italic === true) classes.push('epub-italic')
  if (fontSize !== undefined) styles.push(`--epub-font-size:${fontSize}px`)
  if (fontFamily) styles.push(`--epub-font-family:${fontFamily}`)
  if (fontWeight !== undefined) styles.push(`--epub-font-weight:${fontWeight}`)
  if (color) styles.push(`--epub-text-color:${color}`)
  if (opacity !== undefined) styles.push(`--epub-text-opacity:${opacity}`)
  if (lineHeight !== undefined) styles.push(`--epub-line-height:${lineHeight}px`)
  if (indent !== undefined && indent > 0) {
    styles.push(`--epub-text-indent:${indent}px`)
    attributes.push(`data-text-indent="${indent}"`)
  }

  return {
    className: classes.join(' '),
    attributes: attributes.join(' '),
    style: styles.join(';')
  }
}

const imagePresentation = (item, pageWidth) => {
  const box = polygonBox(item.polygon)
  if (!box) return { className: 'epub-image', attributes: '', style: '' }

  const width = finiteNumber(box.width, 1, 10000)
  const height = finiteNumber(box.height, 1, 10000)
  if (width === undefined || height === undefined) {
    return { className: 'epub-image', attributes: '', style: '' }
  }

  const midpoint = box.left + width / 2
  const centered = Math.abs(midpoint - pageWidth / 2) <= 1
  const className = centered ? 'epub-image epub-image-center' : 'epub-image'

  return {
    className,
    attributes: `data-image-width="${width}" data-image-height="${height}"`,
    style: `--epub-image-width:${width}px;--epub-image-aspect-ratio:${width / height}`
  }
}

const contentItemToHtml = (item, context) => {
  if (typeof item !== 'object' || item === null) return ''

  if (typeof item.src === 'string' && isEmbeddedImage(item.src)) {
    const alt = typeof item.alt === 'string' ? item.alt : 'EPUB 插图'
    const presentation = imagePresentation(item, context.pageWidth)
    const style = presentation.style ? ` style="${presentation.style}"` : ''
    const attributes = presentation.attributes ? ` ${presentation.attributes}` : ''
    return `<figure class="${presentation.className}"${attributes}${style}><img src="${escapeHtml(item.src)}" alt="${escapeHtml(alt)}" loading="lazy" /><figcaption>${escapeHtml(alt)}</figcaption></figure>`
  }

  if (typeof item.content !== 'string' || !item.content.trim()) return ''

  const presentation = textPresentation(item, context.paragraphs.get(item.id))
  const style = presentation.style ? ` style="${presentation.style}"` : ''
  const attributes = presentation.attributes ? ` ${presentation.attributes}` : ''

  return item.content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p class="${presentation.className}"${attributes}${style}>${escapeHtml(line)}</p>`)
    .join('')
}

export const documentToHtml = async (document) => {
  const pages = [...(await document.pages)].sort((left, right) => left.number - right.number)
  const title = document.title || '未命名 EPUB'

  if (!pages.length) {
    return '<div class="epub-empty">这个 EPUB 没有可展示的页面。</div>'
  }

  const pageHtml = await Promise.all(
    pages.map(async (page) => {
      const content = await page.getContent()
      const context = {
        pageWidth: finiteNumber(page.width, 1, 100000) ?? 800,
        paragraphs: paragraphByTextId(page.paragraphs)
      }
      const body = content.map((item) => contentItemToHtml(item, context)).join('')
      const fallback = '<p class="epub-page-empty">本页没有可展示的文字或图片。</p>'

      return `<section class="epub-page" aria-labelledby="epub-page-${page.number}"><h3 id="epub-page-${page.number}">第 ${escapeHtml(page.number)} 页</h3><div class="epub-page-content">${body || fallback}</div></section>`
    })
  )

  return `<article class="epub-book"><header class="epub-book-header"><p>IntermediateDocument HTML Preview</p><h2>${escapeHtml(title)}</h2></header>${pageHtml.join('')}</article>`
}
