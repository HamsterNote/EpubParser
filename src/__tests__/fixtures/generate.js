// Fixture generation script for EpubParser tests
//
// Usage: node src/__tests__/fixtures/generate.js

import JSZip from 'jszip';
import { writeFileSync, mkdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const escapeXml = (value) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const epub = async (options, chapters) => {
  const zip = new JSZip();
  const assets = [];
  const renderedChapters = [];

  for (const chapter of chapters) {
    let content = chapter.content;
    const imageMatch = /src="file:\/\/([^"]+)"/.exec(content);
    if (imageMatch) {
      const href = `images/image-${assets.length + 1}.png`;
      assets.push({ href, data: await readFile(imageMatch[1]), properties: '' });
      content = content.replace(imageMatch[0], `src="${href}"`);
    }
    renderedChapters.push({ ...chapter, content });
  }

  if (options.cover) {
    assets.push({
      href: 'images/cover.png',
      data: await readFile(new URL(options.cover)),
      properties: ' properties="cover-image"'
    });
  }

  const manifest = renderedChapters
    .map((_chapter, index) => `<item id="chapter-${index + 1}" href="chapter-${index + 1}.xhtml" media-type="application/xhtml+xml"/>`)
    .join('');
  const assetManifest = assets
    .map((asset, index) => `<item id="asset-${index + 1}" href="${asset.href}" media-type="image/png"${asset.properties}/>`)
    .join('');
  const spine = renderedChapters
    .map((_chapter, index) => `<itemref idref="chapter-${index + 1}"/>`)
    .join('');
  const navigation = renderedChapters
    .map((chapter, index) => `<li><a href="chapter-${index + 1}.xhtml">${escapeXml(chapter.title)}</a></li>`)
    .join('');

  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('EPUB/package.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">fixture-book</dc:identifier><dc:title>${escapeXml(options.title)}</dc:title><dc:creator>${escapeXml(options.author)}</dc:creator><dc:language>${escapeXml(options.lang)}</dc:language><dc:publisher>${escapeXml(options.publisher)}</dc:publisher><dc:date>${escapeXml(options.date)}</dc:date><meta property="dcterms:modified">2024-01-15T00:00:00Z</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${manifest}${assetManifest}</manifest><spine>${spine}</spine></package>`);
  zip.file('EPUB/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Table of Contents</title></head><body><nav epub:type="toc"><ol>${navigation}</ol></nav></body></html>`);
  renderedChapters.forEach((chapter, index) => {
    zip.file(`EPUB/chapter-${index + 1}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeXml(chapter.title)}</title></head><body>${chapter.content}</body></html>`);
  });
  assets.forEach((asset) => {
    zip.file(`EPUB/${asset.href}`, asset.data);
  });

  return zip.generateAsync({ type: 'uint8array' });
};

// Ensure fixtures directory exists
mkdirSync(__dirname, { recursive: true });

// Minimal 1x1 red PNG (67 bytes) — deterministic, no external dependencies
const RED_PNG = Buffer.from([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00,
  0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8, 0x0F, 0x00, 0x00,
  0x01, 0x01, 0x00, 0x05, 0x18, 0xD8, 0x4D, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
]);

// Minimal 1x1 green PNG (67 bytes)
const GREEN_PNG = Buffer.from([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00,
  0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8, 0x0F, 0x00, 0x00,
  0x01, 0x01, 0x00, 0x05, 0x18, 0xD8, 0x4D, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
]);

// Write helper image files (referenced via file:// in EPUB generation)
const redImagePath = join(__dirname, 'red.png');
const greenImagePath = join(__dirname, 'green.png');
writeFileSync(redImagePath, RED_PNG);
writeFileSync(greenImagePath, GREEN_PNG);

// Deterministic base options shared across all fixtures
const baseOptions = {
  publisher: 'Test Publisher',
  date: '2024-01-15',
  lang: 'en',
  verbose: false,
};

async function generateMinimal() {
  const buffer = await epub(
    {
      ...baseOptions,
      title: 'Minimal Test Book',
      author: 'Test Author',
    },
    [
      {
        title: 'Chapter One',
        content: '<p>This is the only chapter in the minimal EPUB fixture.</p>',
      },
    ],
    3
  );
  writeFileSync(join(__dirname, 'minimal.epub'), buffer);
}

async function generateWithImages() {
  const buffer = await epub(
    {
      ...baseOptions,
      title: 'Book With Images',
      author: 'Image Author',
    },
    [
      {
        title: 'Chapter With Image',
        content: `<p>This chapter contains an embedded image.</p><p><img src="file://${redImagePath}" alt="A red dot" /></p>`,
      },
    ],
    3
  );
  writeFileSync(join(__dirname, 'with-images.epub'), buffer);
}

async function generateWithToc() {
  const buffer = await epub(
    {
      ...baseOptions,
      title: 'Book With TOC',
      author: 'TOC Author',
      tocTitle: 'Table of Contents',
    },
    [
      {
        title: 'First Chapter',
        content: '<p>Content of the first chapter.</p>',
      },
      {
        title: 'Second Chapter',
        content: '<p>Content of the second chapter.</p>',
      },
      {
        title: 'Third Chapter',
        content: '<p>Content of the third chapter.</p>',
      },
    ],
    3
  );
  writeFileSync(join(__dirname, 'with-toc.epub'), buffer);
}

async function generateWithCover() {
  const buffer = await epub(
    {
      ...baseOptions,
      title: 'Book With Cover',
      author: 'Cover Author',
      cover: `file://${greenImagePath}`,
    },
    [
      {
        title: 'Introduction',
        content: '<p>This book has a cover image.</p>',
      },
    ],
    3
  );
  writeFileSync(join(__dirname, 'with-cover.epub'), buffer);
}

async function generateNonAsciiMetadata() {
  const buffer = await epub(
    {
      ...baseOptions,
      title: '测试书',
      author: '测试作者',
      lang: 'zh-CN',
    },
    [
      {
        title: '第一章',
        content: '<p>这是第一章的内容。</p>',
      },
    ],
    3
  );
  writeFileSync(join(__dirname, 'non-ascii-metadata.epub'), buffer);
}

// 字体样式 fixture：覆盖标题层级、上标脚注引用、aside 脚注、粗体/斜体，
// 用于验证 encode 阶段把 HTML 语义映射为 IntermediateText 的 fontSize/fontWeight/italic。
async function generateStyledText() {
  const buffer = await epub(
    {
      ...baseOptions,
      title: 'Styled Text Book',
      author: 'Style Author',
    },
    [
      {
        title: 'Styled Chapter',
        content: [
          '<h1>Chapter Heading One</h1>',
          '<h2>Section Heading Two</h2>',
          '<p>Body paragraph with a note<sup>1</sup> and <b>bold</b> and <i>italic</i> words.</p>',
          '<p>Second body line stays plain.</p>',
          '<aside epub:type="footnote"><p>1. Footnote body text in smaller size.</p></aside>',
        ].join(''),
      },
    ],
    3
  );
  writeFileSync(join(__dirname, 'styled-text.epub'), buffer);
}

async function main() {
  console.log('Generating EPUB fixtures...');

  await generateMinimal();
  console.log('✓ minimal.epub');

  await generateWithImages();
  console.log('✓ with-images.epub');

  await generateWithToc();
  console.log('✓ with-toc.epub');

  await generateWithCover();
  console.log('✓ with-cover.epub');

  await generateNonAsciiMetadata();
  console.log('✓ non-ascii-metadata.epub');

  await generateStyledText();
  console.log('✓ styled-text.epub');

  console.log('Done! All fixtures generated.');
}

main().catch((err) => {
  console.error('Failed to generate fixtures:', err);
  process.exit(1);
});
