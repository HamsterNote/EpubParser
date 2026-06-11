import { devConsoleLog } from './devLog.js'

/**
 * 多边形点类型
 */
type PolygonPoint = [number, number]
type Polygon = [PolygonPoint, PolygonPoint, PolygonPoint, PolygonPoint]

type PolygonInput = ReadonlyArray<PolygonPoint>

/**
 * 计算两点之间的距离
 */
const distance = (p0: PolygonPoint, p1: PolygonPoint): number => {
  const deltaX = p1[0] - p0[0]
  const deltaY = p1[1] - p0[1]
  return Math.sqrt(deltaX * deltaX + deltaY * deltaY)
}

/**
 * 验证多边形必须有 4 个点
 */
export function validatePolygon(
  polygon: PolygonInput
): asserts polygon is Polygon {
  devConsoleLog('[validatePolygon] 验证 polygon', {
    pointCount: polygon.length
  })
  if (polygon.length !== 4) {
    throw new Error(`Polygon must have exactly 4 points, got ${polygon.length}`)
  }
  devConsoleLog('[validatePolygon] polygon 验证通过')
}

/**
 * 计算多边形的旋转角度（基于前两个点）
 */
export const computeRotationDeg = (polygon: PolygonInput): number => {
  if (polygon.length < 2) {
    throw new Error('Cannot compute rotation: polygon has fewer than 2 points')
  }

  const p0 = polygon[0]
  const p1 = polygon[1]
  if (p0 == null || p1 == null) {
    throw new Error('Cannot compute rotation: polygon has fewer than 2 points')
  }

  const result = (Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180) / Math.PI
  devConsoleLog('[computeRotationDeg] 旋转角度', { p0, p1, rotationDeg: result })
  return result
}

/**
 * 计算目标宽度（基于前两个点的距离）
 */
export const computeTargetWidth = (polygon: PolygonInput): number => {
  if (polygon.length < 2) {
    throw new Error(
      'Cannot compute target width: polygon has fewer than 2 points'
    )
  }

  const p0 = polygon[0]
  const p1 = polygon[1]
  if (p0 == null || p1 == null) {
    throw new Error(
      'Cannot compute target width: polygon has fewer than 2 points'
    )
  }

  const result = distance(p0, p1)
  devConsoleLog('[computeTargetWidth] 目标宽度', { p0, p1, width: result })
  return result
}

/**
 * 计算目标高度（基于第 2 和第 3 个点的距离）
 */
export const computeTargetHeight = (polygon: PolygonInput): number => {
  if (polygon.length < 3) {
    throw new Error(
      'Cannot compute target height: polygon has fewer than 3 points'
    )
  }

  const p1 = polygon[1]
  const p2 = polygon[2]
  if (p1 == null || p2 == null) {
    throw new Error(
      'Cannot compute target height: polygon has fewer than 3 points'
    )
  }

  const result = distance(p1, p2)
  devConsoleLog('[computeTargetHeight] 目标高度', { p1, p2, height: result })
  return result
}
