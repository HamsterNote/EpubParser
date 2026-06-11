import { devConsoleLog } from './devLog.js'

/**
 * 文本基线测量结果
 */
export interface TextBaselineMeasurement {
  width: number
  height: number
}

/**
 * 文本测量适配器接口
 * 允许注入自定义测量实现（用于测试或不同运行环境）
 */
export interface PretextAdapter {
  measure(
    text: string,
    font: string,
    maxWidth: number,
    lineHeight: number
  ): TextBaselineMeasurement
}

const DEFAULT_FONT_FAMILY = 'sans-serif'

/**
 * 构建 CSS font 字符串
 */
const buildFontString = (
  fontSize: number,
  fontFamily: string,
  fontWeight: number,
  italic: boolean
): string => {
  const normalizedFontFamily = fontFamily.trim() || DEFAULT_FONT_FAMILY
  const style = italic ? 'italic ' : ''
  const weight = fontWeight || 400
  return `${style}${weight} ${fontSize}px ${normalizedFontFamily}`
}

/**
 * 默认测量适配器 - 使用简单估算
 * 当 @chenglou/pretext 不可用时的后备方案
 */
class FallbackAdapter implements PretextAdapter {
  measure(
    text: string,
    _font: string,
    maxWidth: number,
    lineHeight: number
  ): TextBaselineMeasurement {
    devConsoleLog('[FallbackAdapter] 使用回退测量', {
      text: text.slice(0, 40),
      maxWidth,
      lineHeight
    })
    // 简单估算：假设每个字符约 0.6 * fontSize 宽度
    const charWidth = lineHeight * 0.6
    const textWidth = text.length * charWidth
    const lines = Math.max(1, Math.ceil(textWidth / maxWidth))
    return {
      width: Math.min(textWidth, maxWidth),
      height: lines * lineHeight
    }
  }
}

let pretextAdapter: PretextAdapter = new FallbackAdapter()

/**
 * 设置自定义测量适配器
 */
export const setPretextAdapter = (adapter: PretextAdapter): void => {
  pretextAdapter = adapter
}

/**
 * 重置为默认测量适配器
 */
export const resetPretextAdapter = (): void => {
  pretextAdapter = new FallbackAdapter()
}

/**
 * 测量文本基线尺寸
 */
export const measureTextBaseline = (
  text: string,
  fontSize: number,
  fontFamily: string,
  fontWeight: number,
  italic: boolean,
  maxWidth: number,
  lineHeight: number
): TextBaselineMeasurement => {
  devConsoleLog('[measureTextBaseline] 调用 pretext adapter', {
    text: text.slice(0, 40),
    fontSize,
    fontFamily,
    fontWeight,
    italic,
    maxWidth,
    lineHeight
  })
  const font = buildFontString(fontSize, fontFamily, fontWeight, italic)
  const result = pretextAdapter.measure(text, font, maxWidth, lineHeight)
  devConsoleLog('[measureTextBaseline] 返回结果', result)
  return result
}

/**
 * 计算缩放比例
 */
export const computeScale = (
  baselineWidth: number,
  baselineHeight: number,
  targetWidth: number,
  targetHeight: number
): { scaleX: number; scaleY: number } => {
  devConsoleLog('[computeScale] 计算缩放', {
    baselineWidth,
    baselineHeight,
    targetWidth,
    targetHeight
  })
  if (baselineWidth === 0) {
    throw new Error('Baseline width cannot be zero')
  }
  if (baselineWidth < 0) {
    throw new Error('Baseline width must be greater than zero')
  }
  if (baselineHeight === 0) {
    throw new Error('Baseline height cannot be zero')
  }
  if (baselineHeight < 0) {
    throw new Error('Baseline height must be greater than zero')
  }

  const result = {
    scaleX: targetWidth / baselineWidth,
    scaleY: targetHeight / baselineHeight
  }
  devConsoleLog('[computeScale] 缩放结果', result)
  return result
}
