import { dts } from 'rolldown-plugin-dts'

export default {
  input: './src/index.ts',
  external: ['epub', 'epub-gen-memory'],
  plugins: [dts()],
  output: [{ dir: 'dist', format: 'es', sourcemap: true }]
}
