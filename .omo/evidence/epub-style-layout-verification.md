# EPUB 样式与图片布局验证

## 依赖

- `package.json` 与 `yarn.lock` 均解析到 `@hamster-note/types@0.11.0-beta.1`。
- 未修改 sibling packages，未新增工具依赖。

## 自动化验证

- 编码定向测试：9/9 通过。
- 解码定向测试：7/7 通过。
- 完整测试：`yarn test --runInBand`，9 个 suites、63 个 tests 全部通过。
- 类型检查：`yarn typecheck` 通过。
- 构建：`yarn build:all` 通过，成功生成 `dist/index.js`、`dist/index.d.ts` 和 source map。
- LSP：所有本任务修改的 TypeScript 文件均无诊断。

## 公开入口手工 QA

通过 Node.js ESM 直接导入 `dist/index.js` 中的 `EpubParser`，实际解析测试 EPUB：

- `styled-text.epub`：标题 `Chapter Heading One` 的 `fontSize=28`、`fontWeight=700`，并生成 5 个段落结构。
- `with-images.epub`：原始 1×1 PNG 的 polygon 为 `[[399.5,64],[400.5,64],[400.5,65],[399.5,65]]`，宽高保持 1×1，水平中心为页面 x=400，且未超过 720px 可用宽度。

新增集成测试另行覆盖：

- CSS class 中的 `font-size: 22px`、`font-family: Literata`、`font-weight: 600`。
- `text-align: right` 同时写入段落属性并反映在文本 polygon。
- `text-indent: 32px` 将首行 x 从 40 调整为 72。
- HTML 1200×600 图片按最大可用宽度缩放到 720×360 并居中。
- EPUB 解码后的图片段落居中，图片保留 `max-width: 100%` 与 `height: auto`。

## 已知技术债与边界

- no-excuse scanner 仅报告 `src/index.ts` 中两处既有 `as unknown`（原行 331、887）；本任务未新增类型逃逸。
- `src/index.ts` 仍是既有超大模块，但本次已将内容样式解析和图片尺寸解析分别提取到单一职责模块，主文件减少约 198 行。
- PNG/GIF/JPEG intrinsic 尺寸读取均已实现；当前真实 fixture 只直接验证 PNG 路径，GIF/JPEG 尚无独立格式 fixture。
