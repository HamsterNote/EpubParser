import type { IntermediateText } from '@hamster-note/types'

/**
 * 中间文本形状 - 用于类型守卫的鸭子类型检查
 * 不依赖 class identity，支持纯对象
 */
type IntermediateTextShape = {
  content?: unknown
  polygon?: unknown
  fontSize?: unknown
}

/**
 * 检查值是否为 IntermediateText 兼容对象
 * 使用鸭子类型检查，支持 IntermediateText 实例和纯对象
 */
export function isIntermediateTextLike(
  value: unknown
): value is IntermediateText {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const text = value as IntermediateTextShape
  return (
    typeof text.content === 'string' &&
    Array.isArray(text.polygon) &&
    typeof text.fontSize === 'number'
  )
}
