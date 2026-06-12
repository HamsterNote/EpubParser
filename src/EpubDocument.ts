import type {
  IntermediateDocument,
  IntermediateImage,
  IntermediateOutline
} from '@hamster-note/types'
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
   * 返回底层 IntermediateDocument 的封面图片数据
   */
  async getCover(): Promise<IntermediateImage | undefined> {
    return this.intermediateDocument.getCover()
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
