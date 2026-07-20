import { dts } from 'rolldown-plugin-dts'

export default {
  input: './src/index.ts',
  external: [
    '@hamster-note/document-parser',
    '@hamster-note/types',
    'fast-xml-parser',
    'jszip'
  ],
  plugins: [dts()],
  output: [{ dir: 'dist', format: 'es', sourcemap: true }]
}
