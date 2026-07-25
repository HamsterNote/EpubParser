# @hamster-note/epub-parser

TypeScript ESM package for bidirectional conversion between EPUB files and `IntermediateDocument`.

## API Direction

`encode(input)` parses an EPUB file into an `IntermediateDocument`.
`decode(intermediateDocument)` generates an EPUB binary from an `IntermediateDocument`.

### Instance methods

```typescript
import { EpubParser } from "@hamster-note/epub-parser";

const parser = new EpubParser();

// Parse EPUB into intermediate document
const doc = await parser.encode(input); // input: Blob | File | ArrayBuffer | Uint8Array | Buffer | string(path)

// Generate EPUB from intermediate document
const epubBytes = await parser.decode(doc); // returns Uint8Array
```

### Static methods (with EPUB-specific metadata)

```typescript
import { EpubParser } from "@hamster-note/epub-parser";

// Parse EPUB into EpubDocument (extends IntermediateDocument with EPUB metadata)
const epubDoc = await EpubParser.encode(input);
const doc = epubDoc.getIntermediateDocument();

// Access EPUB-specific metadata
console.log(doc.metadata.title);
console.log(doc.metadata.author);

// Generate EPUB from intermediate document
const epubBytes = await EpubParser.decode(doc);
```

## Dependencies

- `@likecoin/epub-ts@0.6.9` for EPUB metadata, spine, and navigation parsing
- `linkedom@0.18.13` supplies the DOM parser used by `@likecoin/epub-ts` in Node.js
- `jszip@3.10.1` for bounded archive resource reads and generating EPUB output without Node.js builtins

## Supported Scope

- EPUB2 and EPUB3 reflowable documents
- UTF-8 encoded content
- Metadata extraction (title, author, and basic fields)
- Spine and page order preservation
- Table of Contents (TOC) when representable as `IntermediateOutline`
- Embedded covers and chapter images

## Excluded Scope

The following features are explicitly out of scope and will not be supported unless a separate scope decision is made:

- DRM removal or handling
- Fixed-layout fidelity
- Media overlays
- Non-UTF-8 transcoding
- Streaming parse/generation
- Full EPUB spec validation
- CLI interface

## Commands

```bash
yarn install
yarn dev
yarn typecheck
tsc --noEmit -p tsconfig.json
yarn test
yarn build:all
```

`yarn dev` starts the encode/decode demo on port `8871`. The server binds to
`0.0.0.0` by default, so devices on the same LAN can open the printed URL, for
example `http://192.168.1.23:8871`. Use `HOST=127.0.0.1 yarn dev` to restrict it
to local-only access.

## Requirements

Browser builds require standard binary APIs (`Blob`, `ArrayBuffer`, `Uint8Array`, and `TextDecoder`). Remote image URLs additionally require `fetch`. These APIs are available in current evergreen browsers. Node.js users require Node.js >=22.6.0.

## Runtime Support

| Capability | Supported runtime | Minimum Node.js | Browser status | Notes |
| --- | --- | --- | --- | --- |
| Parse EPUB (`encode`) | Browser and Node.js | >=22.6.0 | Supported | Browsers accept `Blob`, `File`, `ArrayBuffer`, and `Uint8Array`; Node.js additionally accepts `Buffer` and filesystem paths. |
| Generate EPUB (`decode`) | Browser and Node.js | >=22.6.0 | Supported | Returns ZIP bytes as `Uint8Array` without Node.js polyfills. |

No browser polyfills or Node builtin shims are required. String path inputs and `file://` image sources remain Node.js-only because browsers cannot read arbitrary filesystem paths. Browser callers can provide images as data URLs, `File` objects, or fetchable remote URLs.

## Roundtrip Semantics

Roundtrip conversion is semantic and lossy, not byte-exact. Re-encoding a decoded EPUB will preserve page count, spine order, title, author, and text content at a semantic level, but will not produce byte-identical output. Timestamps, generated IDs, and dependency-specific metadata may differ between passes.
