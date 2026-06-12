import type { IntermediatePage, Number2 } from '@hamster-note/types'
import { isIntermediateTextLike } from './intermediateTextGuard.js'
import { cssStyleRecordToString, formatTextCssStyle } from './textCssStyle.js'
import { computeTextStyle } from './textStyle.js'

/**
 * 渲染视图枚举
 * TEXT: 渲染文本层
 * THUMBNAIL: 渲染缩略图背景
 */
export enum RenderViews {
  TEXT = 'TEXT',
  THUMBNAIL = 'THUMBNAIL'
}

/**
 * 渲染选项接口
 */
export interface RenderOptions {
  scale?: number
  views?: RenderViews[]
}

/**
 * EpubPage 类 - 针对 IntermediatePage 的 EPUB 包装
 * 包装 IntermediatePage，提供懒加载渲染能力
 */
export class EpubPage {
  constructor(private readonly intermediatePage: IntermediatePage) {}

  /**
   * 获取页码
   */
  getNumber(): number {
    return this.intermediatePage.number
  }

  /**
   * 获取缩放后的页面尺寸
   */
  getSize(scale: number): Number2 {
    return {
      x: this.intermediatePage.width * scale,
      y: this.intermediatePage.height * scale
    }
  }

  /**
   * 获取纯文本内容
   * 过滤出文本类型的内容，拼接为字符串
   */
  getPureText(): string {
    return this.intermediatePage.content
      .filter(isIntermediateTextLike)
      .map((text) => text.content)
      .join('\n')
  }

  /**
   * 渲染页面到容器元素
   * 根据 options 决定渲染缩略图和/或文本内容
   */
  async render(
    container: HTMLDivElement,
    options?: RenderOptions
  ): Promise<void> {
    const scale = options?.scale ?? 1
    const views = options?.views ?? [RenderViews.TEXT, RenderViews.THUMBNAIL]
    const ownerDocument = container.ownerDocument ?? globalThis.document

    if (!ownerDocument) {
      throw new Error('EpubPage.render requires a document context')
    }

    // 清空容器
    container.innerHTML = ''

    // 设置容器样式
    container.style.position = 'relative'
    container.style.overflow = 'hidden'
    container.style.width = `${this.intermediatePage.width * scale}px`
    container.style.height = `${this.intermediatePage.height * scale}px`

    // 渲染缩略图背景
    if (views.includes(RenderViews.THUMBNAIL)) {
      const thumbnail = await this.intermediatePage.getThumbnail(0.3)
      if (thumbnail?.src) {
        container.style.backgroundImage = `url('${thumbnail.src}')`
        container.style.backgroundRepeat = 'no-repeat'
        container.style.backgroundPosition = 'top center'
        container.style.backgroundSize = 'contain'
      }
    }

    // 渲染文本层
    if (views.includes(RenderViews.TEXT)) {
      // 获取文本（可能触发懒加载）
      const content = await this.intermediatePage.getContent()
      const texts = content.filter(isIntermediateTextLike)

      // 创建文本容器
      const textContainer = ownerDocument.createElement('div')
      textContainer.style.position = 'absolute'
      textContainer.style.top = '0'
      textContainer.style.left = '0'
      textContainer.style.width = '100%'
      textContainer.style.height = '100%'

      // 渲染所有文本元素
      texts.forEach((text) => {
        const span = ownerDocument.createElement('span')
        span.className = 'hamster-note-text'
        span.id = text.id
        span.textContent = text.content

        const styleText = cssStyleRecordToString(
          formatTextCssStyle(computeTextStyle(text), scale)
        )
        span.setAttribute('style', styleText)

        textContainer.appendChild(span)
      })

      container.appendChild(textContainer)
    }
  }
}
