// Fixture generation script for EpubParser tests
// Uses epub-gen-memory to create deterministic EPUB fixtures
//
// Usage: node src/__tests__/fixtures/generate.js

import epubModule from 'epub-gen-memory';
const epub = epubModule.default || epubModule;
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

  console.log('Done! All fixtures generated.');
}

main().catch((err) => {
  console.error('Failed to generate fixtures:', err);
  process.exit(1);
});
