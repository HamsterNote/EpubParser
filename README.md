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
const doc = await parser.encode(input); // input: Buffer | ArrayBuffer | Uint8Array | string(path)

// Generate EPUB from intermediate document
const epubBuffer = await parser.decode(doc); // returns Buffer | Uint8Array
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
const epubBuffer = await EpubParser.decode(doc);
```

## Dependencies

- `epub@2.1.1` for reading and parsing EPUB files
- `epub-gen-memory@1.1.2` for generating EPUB output

## Supported Scope

- EPUB2 and EPUB3 reflowable documents
- UTF-8 encoded content
- Metadata extraction (title, author, and basic fields)
- Spine and page order preservation
- Table of Contents (TOC) when representable as `IntermediateOutline`
- Cover and image references (where dependency APIs expose them)

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

Node.js >=22.6.0 is required due to the `epub` package engine constraint.

## Runtime Support

| Capability | Supported runtime | Minimum Node.js | Browser status | Reason |
| --- | --- | --- | --- | --- |
| Parse EPUB (`encode`) | Node.js only | >=22.6.0 | Not supported | `epub@2.1.1` imports `node:fs/promises` at the package entrypoint. |
| Generate EPUB (`decode`) | Node.js only | >=22.6.0 | Not supported through this parser | The plain `epub-gen-memory@1.1.2` import resolves Node-oriented dependencies that require `fs` and `path`. |

No browser polyfills, Node builtin shims, or dependency swaps are included. `epub-gen-memory/dist/bundle.min.js` exists for separate browser bundling experiments, but this parser currently uses the Node package entrypoints above and does not claim browser runtime support.

## Roundtrip Semantics

Roundtrip conversion is semantic and lossy, not byte-exact. Re-encoding a decoded EPUB will preserve page count, spine order, title, author, and text content at a semantic level, but will not produce byte-identical output. Timestamps, generated IDs, and dependency-specific metadata may differ between passes.
