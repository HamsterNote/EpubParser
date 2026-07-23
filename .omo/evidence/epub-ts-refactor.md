# `@likecoin/epub-ts` parser refactor evidence

Date: 2026-07-22

## Automated verification

- `yarn typecheck`: passed (`tsc --noEmit -p tsconfig.json`).
- `yarn test --runInBand`: passed, 9 suites and 58 tests.
- `yarn build:all`: passed; generated `dist/index.js`, source map, and declarations.
- LSP diagnostics: no diagnostics in `src/EpubArchive.ts`, `src/EpubResourceReader.ts`, `src/__tests__/runtime.node.test.ts`, or `rolldown.config.ts`.
- `git diff --check`: passed with no whitespace errors.

## Manual package-surface QA

The checks imported `EpubParser` from the built `dist/index.js`, not from TypeScript source.

### Packed consumer path

- Ran `yarn pack` without publishing; the tarball contained package metadata and `dist` only.
- Installed the tarball into an isolated temporary consumer project with lifecycle scripts disabled.
- Imported `EpubParser` through the public `@hamster-note/epub-parser` package export.
- Parsed `minimal.epub`, generated a 2,300-byte EPUB, and re-parsed it with title `Minimal Test Book`.

### Node.js path

- Parsed `src/__tests__/fixtures/minimal.epub` through the Node entry selected when `DOMParser` is absent.
- Observed title `Minimal Test Book` and one page.
- Generated a 2,300-byte EPUB with `EpubParser.decode()`.
- Re-parsed that output and observed the same title.
- Supplied four invalid bytes and observed rejection.
- Supplied an OPF whose actual expanded size exceeded 16 MiB while both ZIP headers claimed one byte; the built package rejected it before `@likecoin/epub-ts` initialization with `EPUB archive expanded data exceeds the size limit` and produced no unhandled rejection.

### Browser-compatible DOM path

- Installed a standards-compatible `DOMParser` from `linkedom` to exercise the browser branch of the built package.
- Parsed `src/__tests__/fixtures/with-toc.epub`.
- Observed title `Book With TOC` and three pages.

## Security regression coverage

`src/__tests__/EpubArchive.test.ts` passed all five cases, including navigation links whose base directory differs from the OPF, declared oversized entries, and an oversized OPF whose real expanded size exceeds its forged declaration. `EpubResourceReader` now streams every entry through actual-size limits before `@likecoin/epub-ts` initializes, then applies the same limits to later resource reads.

## Post-write audit

- Pure LOC: `src/EpubArchive.ts` 174; `src/EpubResourceReader.ts` 98; `src/__tests__/EpubArchive.test.ts` 108; `src/__tests__/runtime.node.test.ts` 64; `rolldown.config.ts` 14.
- No `any`, `as any`, `@ts-ignore`, or `@ts-expect-error` escape hatches were introduced.
- Parsing and generation remain separate responsibilities: `@likecoin/epub-ts` owns EPUB semantic parsing, `EpubResourceReader` owns bounded ZIP resource reads, and the existing `EpubGenerator` owns output generation.
