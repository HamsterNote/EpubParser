# EpubParser Development Guidelines

## Active Technologies

- TypeScript 5.0.2 (cross-platform ESM for browsers and Node.js)
- `@hamster-note/document-parser`, `@hamster-note/types`
- `@likecoin/epub-ts@0.6.9` for EPUB metadata, spine, and navigation parsing
- `jszip@3.10.1` for bounded archive resource I/O and EPUB generation
- `linkedom@0.18.13` for the Node.js DOM implementation used by `@likecoin/epub-ts`

## Project Structure

```text
src/
  index.ts          - EpubParser class and encode/decode logic
  EpubArchive.ts    - Cross-platform `@likecoin/epub-ts` adapter
  EpubResourceReader.ts - Size-limited EPUB archive resource reader
  EpubGenerator.ts  - Cross-platform EPUB archive generator
  EpubDocument.ts   - Document wrapper
  EpubPage.ts       - Page wrapper
  __tests__/        - Jest tests and fixtures
```

## Conventions

Mirror `@hamster-note/html-parser` conventions for:
- Class naming (`EpubParser`, `EpubDocument`, `EpubPage`)
- API direction (`encode` parses input, `decode` generates output)
- Wrapper method names and return types where EPUB semantics match HTML
- Build config, test style, and CI workflow patterns

## Guardrails

### MUST NOT modify sibling packages

Do not edit or modify:
- `@hamster-note/types`
- `@hamster-note/document-parser`
- `@hamster-note/html-parser` (HtmlParser package)

If an intermediate type or base class contract is genuinely insufficient, raise a blocker rather than silently editing sibling packages.

### MUST NOT add unapproved tooling

Do not add any of the following without explicit approval:
- `husky`
- `commitlint`
- `changesets`
- `biome`
- Any other commit hook, changelog tool, or formatter not already present in HtmlParser

The only approved deviation from HtmlParser tooling is the `typecheck` script (`tsc --noEmit -p tsconfig.json`).

### Tests-after strategy

This project uses a tests-after approach, not TDD. Every implementation task must include tests and QA verification in the same task. Evidence files go under `.omo/evidence/`.

### No npm publish without explicit approval

Do not run `npm publish`, `yarn publish`, or any publish workflow unless explicitly requested. The `prepublishOnly` script runs `build:all` but does not trigger a registry push on its own.

## Commands

```bash
yarn install
yarn typecheck
yarn test
yarn build:all
```

## Recent Changes

- Task 3: Added README, CHANGELOG, and AGENTS documentation
- Task 13: Finalized README/CHANGELOG with API examples, runtime support table, and caveats
