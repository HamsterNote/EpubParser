import baseConfig from '@system-ui-js/development-base/eslint.config.js'

const ignores = [
  'node_modules/',
  'dist/',
  'build/',
  'coverage/',
  '.specify/',
  '.opencode/',
  '*.min.js'
]

const resolvedBaseConfig = Array.isArray(baseConfig) ? baseConfig : [baseConfig]

// 直接复用开发基础包的默认配置，避免重复维护规则与测试环境设置
export default [{ ignores }, ...resolvedBaseConfig]
