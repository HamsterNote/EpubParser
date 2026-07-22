import { dts } from 'rolldown-plugin-dts'

export default {
  input: './src/index.ts',
  external: [
    '@hamster-note/document-parser',
    '@hamster-note/types',
    '@likecoin/epub-ts',
    '@likecoin/epub-ts/node',
    'jszip',
    'linkedom'
  ],
  plugins: [dts()],
  output: [{ dir: 'dist', format: 'es', sourcemap: true }]
}
