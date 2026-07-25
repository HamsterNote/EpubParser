# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-07-25

### Changed
- First formal stable release after beta series
- Regenerate EPUB test fixtures to align with updated parser behavior

### Added
- Cross-platform EPUB archive reader and generator using `jszip`
- EPUB XML parsing with `@likecoin/epub-ts` for metadata, spine, and navigation
- Render independent cover image as first `IntermediatePage`
- Support `IntermediatePage.useFlowLayout` field
- Security preflight check in `EpubResourceReader` for forged ZIP metadata

### Dependencies
- `@likecoin/epub-ts@0.6.9` for EPUB structure parsing
- `linkedom@0.18.13` for Node.js DOM implementation
- `jszip@3.10.1` for cross-platform ZIP I/O
- `@hamster-note/types@0.11.0-beta.1` (adds `useFlowLayout` support)

## [0.4.0-beta] - 2026-07-25

### Changed
- Regenerate EPUB test fixtures to align with updated parser behavior

## [0.3.0-beta.4] - 2026-07-25

### Changed
- Reconcile prerelease package, Git tag, and changelog metadata without additional runtime changes

## [0.3.0-beta.3] - 2026-07-25

### Added
- Render an independent cover image as the first `IntermediatePage`

### Fixed
- Decode percent-encoded EPUB manifest paths before ZIP entry lookup
- Infer remote image MIME types from URL extensions when servers return generic non-image content types

## [0.3.0-beta.2] - 2026-07-23

### Added
- Support `IntermediatePage.useFlowLayout` field — all parsed EPUB pages now carry `useFlowLayout: true`
- Regression tests asserting every parsed page has `useFlowLayout: true`
- QA evidence under `.omo/evidence/use-flow-layout.md`

### Dependencies
- `@hamster-note/types` from `0.10.0` to `0.11.0-beta.1` (adds `useFlowLayout` support to `IntermediatePage`)

## [0.3.0-beta.1] - 2026-07-23

### Security
- Add `validateExpandedSizes()` preflight check in `EpubResourceReader` before `@likecoin/epub-ts` initialization, preventing forged ZIP metadata from bypassing expanded-size limits

### Changed
- Refactor oversized-entry test to use an oversized OPF instead of a separate oversized image entry, covering the preflight code path directly

## [0.3.0-beta] - 2026-07-22

### Changed
- Replace the hand-written EPUB XML parsing layer with `@likecoin/epub-ts@0.6.9` for metadata, spine, and navigation parsing
- Keep archive resource reads behind the existing per-entry and total expanded-size limits

### Removed
- Remove the internal `EpubXml` module and `fast-xml-parser` dependency

### Dependencies
- Add `@likecoin/epub-ts@0.6.9` for EPUB structure parsing
- Add `linkedom@0.18.13` for the Node.js DOM implementation used by `@likecoin/epub-ts`

## [0.2.0-beta] - 2026-07-22

### Added
- Cross-platform EPUB archive reader (`EpubArchive`) using `jszip`, removing Node-only `epub` dependency
- Cross-platform EPUB archive generator (`EpubGenerator`) using `jszip`, removing Node-only `epub-gen-memory` dependency
- EPUB XML parsing module (`EpubXml`) with OPF, NCX, and EPUB 3 navigation document support
- Browser runtime test suite verifying Blob/ArrayBuffer input and Blob/`Uint8Array` output compatibility
- Semantic styled text parsing with heading levels (h1-h6), footnotes, bold, and italic mapping to `IntermediateText`
- Custom base64 encode/decode to replace `Buffer.toString('base64')` for cross-runtime portability
- Stable EPUB document ID generation via FNV-1a content fingerprinting
- Evidence documentation for browser support verification and page ID stability

### Changed
- Replace the Node-only `epub` reader and `epub-gen-memory` generator with cross-platform `jszip` 3.10.1 and `fast-xml-parser` 5.8.0 implementations
- Expose embedded image bytes as `Uint8Array` instead of `Buffer` for portable runtime support
- Use actual line-height-based Y positioning instead of fixed `LINE_HEIGHT` spacing
- Update demo server to load and display EPUB content via the cross-platform API
- Improve test fixture generation to use `jszip` directly instead of `epub-gen-memory`
- Update Node runtime tests to verify dependency removal and Rolldown external configuration

### Removed
- `epub@2.1.1` and `epub-gen-memory@1.1.2` dependencies
- Temporary directory-based image bridge in `decode` flow
- `getBuiltinModule('fs/promises')` write/rm operations from the decode path

### Dependencies
- `jszip@3.10.1` for cross-platform ZIP I/O
- `fast-xml-parser@5.8.0` for cross-platform XML parsing

## [0.1.1] - 2026-06-12

### Changed
- Improve CI workflows for PR checks, publishing, and branch sync
- Simplify `getCover()` implementation

### Fixed
- Track `.omo/evidence` files in `.gitignore`

## [0.1.0] - 2025-06-08

### Added
- Initialize `@hamster-note/epub-parser` project
- Scaffold package structure aligned with `@hamster-note/html-parser`
- Add `encode()` and `decode()` API contract for EPUB to `IntermediateDocument` conversion
- Add `EpubDocument` and `EpubPage` wrappers mirroring HtmlParser conventions
- Add `typecheck` script for TypeScript validation

### Dependencies
- `epub@2.1.1` for EPUB reading and parsing
- `epub-gen-memory@1.1.2` for EPUB generation
- `@hamster-note/document-parser@0.3.1` and `@hamster-note/types@0.8.0` for intermediate types

### Scope
- Supported: EPUB2/EPUB3 reflowable, UTF-8, metadata, spine, TOC, cover/images
- Excluded: DRM, fixed-layout fidelity, media overlays, non-UTF-8 transcoding, streaming, validation, CLI
