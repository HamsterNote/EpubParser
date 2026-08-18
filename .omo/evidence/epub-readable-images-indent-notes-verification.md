# EPUB 图片、首行缩进与注释样式验证

验证日期：2026-08-17

## 用户可见结果

- 解析 1×1 像素图片后，图片在 720px 正文区内等比放大为 504×504，左边界为 148px，即最小宽度为正文区的 70%。
- 章节引用的外部 CSS 中 `text-indent: 32px` 会映射为首行 x=72px。
- 以 4 个半角空格开头的段落会映射为首行 x=72px，续行保持段落左边界 x=40px。
- `aside`、脚注/尾注语义以及常见 `note` class 会映射为 13px、斜体、`#5f5b53`，与 16px 正文明显区分。
- 反向生成的 EPUB 图片样式包含 `width: auto`、`min-width: 70%`、`max-width: 100%`、`height: auto` 和 `object-fit: contain`；小图有最小可读宽度，大图不会被固定缩小到 70%。
- 外链 CSS 在原 `<link>` 位置就地内联，单章最多处理 32 个引用且最多嵌入 2 MiB；缺失样式不会阻断章节图片规范化。
- 普通作者前景色不会在丢失配套背景后造成不可见正文；弱化颜色只用于已识别的注释语义。

## 自动化门禁

- `yarn typecheck`：通过。
- `yarn test --runInBand`：9 个测试套件、68 个测试全部通过。
- `yarn build:all`：通过，成功生成 `dist/index.js` 与类型声明。
- `node --test demo/documentToHtml.test.mjs`：6 个测试全部通过。
- `git diff --check`：通过。

## 构建产物手工 QA

直接导入 `dist/index.js`，通过公开的 `EpubParser.encode` / `EpubParser.decode` API 驱动真实 EPUB 字节：

```json
{
  "tinyImage": {
    "width": 504,
    "height": 504,
    "left": 148
  },
  "cssIndentX": 72,
  "spaceIndentX": 72,
  "continuationX": 40,
  "note": {
    "fontSize": 13,
    "italic": true,
    "color": "#5f5b53"
  },
  "bodyColor": "#000000",
  "decodeUsesMinimumWidth": true,
  "decodeAvoidsFixedWidth": true
}
```

该验证同时覆盖归档外链 CSS 的级联顺序与安全预算、缺失 CSS 降级、显式零缩进、4 空格缩进、章末注释语义、暗色作者样式的正文可见性、极小图片放大以及 decode 后章节 XHTML 的响应式图片样式。
