# IntermediatePage `useFlowLayout` QA Evidence

Date: 2026-07-23

## Dependency

- `@hamster-note/types`: `0.11.0-beta.1`
- Runtime constructor and `IntermediatePage.serialize()` both preserve `useFlowLayout: true`.

Observed runtime result:

```json
{"installed":true,"runtime":true,"serialized":true}
```

## Automated verification

- `yarn typecheck`: passed.
- `yarn test --runInBand`: passed, 9 suites and 58 tests.
- `yarn build:all`: passed; generated `dist/index.js`, `dist/index.js.map`, and `dist/index.d.ts`.
- `git diff --check`: passed.

## Built-package manual QA

Loaded the public `EpubParser` export from `dist/index.js`, parsed
`src/__tests__/fixtures/minimal.epub`, awaited the public intermediate document
page collection, and checked every returned page.

Observed result:

```json
{"title":"Minimal Test Book","pageCount":1,"allUseFlowLayout":true,"values":[true]}
```

This confirms the built package exposes parsed EPUB pages with
`useFlowLayout: true`.
