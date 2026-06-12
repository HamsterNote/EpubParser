# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
