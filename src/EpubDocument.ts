import { IntermediateDocument, IntermediateOutline } from '@hamster-note/types'
import { EpubPage } from './EpubPage.js'

/**
 * EpubDocument 类 - 针对 IntermediateDocument 的 EPUB 包装
 * 提供懒加载页面获取能力
 */
export class EpubDocument {
  constructor(private readonly intermediateDocument: IntermediateDocument) {}

  /**
   * 获取文档的所有页面
   * 利用 IntermediatePageMap 的懒加载机制
   */
  async getPages(): Promise<EpubPage[]> {
    const pages = await this.intermediateDocument.pages
    return pages.map((page) => new EpubPage(page))
  }

  /**
   * 根据页码获取单个页面
   */
  async getPage(pageNumber: number): Promise<EpubPage | undefined> {
    const pagePromise =
      this.intermediateDocument.getPageByPageNumber(pageNumber)
    if (!pagePromise) return undefined

    const page = await pagePromise
    return page ? new EpubPage(page) : undefined
  }

  /**
   * 获取文档大纲
   * 返回第一个大纲项（如果存在）
   */
  async getOutline(): Promise<IntermediateOutline | undefined> {
    const outline = this.intermediateDocument.getOutline()
    if (!outline || outline.length === 0) return undefined

    // 返回第一个大纲项（如果存在）
    return outline[0]
  }

  /**
   * 获取文档封面
   * 返回第一页的缩略图作为封面
   */
  async getCover(): Promise<HTMLCanvasElement | HTMLImageElement> {
    const cover = await this.intermediateDocument.getCover()

    // 创建 Image 元素
    const img = new Image()

    // 返回 Promise，等待图片加载完成
    return new Promise((resolve) => {
      img.onload = () => resolve(img)
      img.onerror = () => {
        // 如果加载失败，创建一个空白 canvas 作为后备
        const canvas = document.createElement('canvas')
        const firstPageSize =
          this.intermediateDocument.getPageSizeByPageNumber(1)
        if (firstPageSize) {
          canvas.width = firstPageSize.x
          canvas.height = firstPageSize.y
        } else {
          canvas.width = 800
          canvas.height = 1000
        }
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
        }
        resolve(canvas)
      }

      if (cover?.src) {
        img.src = cover.src
      } else {
        // 触发 onerror 创建空白 canvas
        img.src = ''
      }
    })
  }

  /**
   * 获取文档标题
   */
  getTitle(): string {
    return this.intermediateDocument.title
  }

  /**
   * 获取文档 ID
   */
  getId(): string {
    return this.intermediateDocument.id
  }

  /**
   * 获取原始 IntermediateDocument（用于高级操作）
   */
  getIntermediateDocument(): IntermediateDocument {
    return this.intermediateDocument
  }
}
