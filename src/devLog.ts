/**
 * 开发环境日志工具
 * 默认仅在非生产环境下输出日志。
 * 设置 DEBUG 环境变量可在生产环境中强制启用日志（用于排查问题）。
 */

const isProduction = (): boolean =>
  typeof process !== 'undefined' && process.env?.NODE_ENV === 'production'

const isDebugEnabled = (): boolean =>
  typeof process !== 'undefined' && Boolean(process.env?.DEBUG)

const shouldLog = (): boolean => !isProduction() || isDebugEnabled()

export function devConsoleLog(label: string, data?: unknown): void {
  if (!shouldLog()) return

  // eslint-disable-next-line no-console
  console.log(`[EpubParser] ${label}`, data !== undefined ? data : '')
}

export function devConsoleWarn(label: string, data?: unknown): void {
  if (!shouldLog()) return

  // eslint-disable-next-line no-console
  console.warn(`[EpubParser] ⚠️ ${label}`, data !== undefined ? data : '')
}

export function devConsoleError(label: string, data?: unknown): void {
  if (!shouldLog()) return

  // eslint-disable-next-line no-console
  console.error(`[EpubParser] ❌ ${label}`, data !== undefined ? data : '')
}
