# PR #4 review fix verification

Date: 2026-07-25

## Regression coverage

- `src/__tests__/EpubArchive.test.ts`: an OPF manifest href containing `chapter%201.xhtml` resolves to the decoded ZIP entry `chapter 1.xhtml`.
- `src/__tests__/epubDecode.test.ts`: PNG bytes served as `application/octet-stream` are inferred from the `.png` URL and embedded as `EPUB/images/image-1.png`.
- Both tests were first run against the defective implementation and failed for their intended reasons before the production fixes were applied.

## Quality gates

- `yarn typecheck`: passed.
- `yarn test --runInBand`: passed, 9 suites and 60 tests.
- `yarn build:all`: passed.
- `git diff --check`: passed.
- LSP diagnostics: clean for all four changed TypeScript files.

## Public API QA

A standalone Node.js driver imported `EpubParser` from `dist/index.js` and exercised both public directions:

1. `EpubParser.encode()` parsed an in-memory EPUB whose OPF referenced `text/chapter%201.xhtml` and whose ZIP stored `text/chapter 1.xhtml`; the resulting page contained the expected chapter text.
2. A local HTTP server returned PNG bytes with `Content-Type: application/octet-stream`; `EpubParser.decode()` generated an EPUB whose chapter referenced `images/image-1.png` and whose ZIP contained the matching image bytes.

Observed result:

```text
QA PASS: public encode decoded %20 chapter path; public decode embedded octet-stream PNG as image/png
```
