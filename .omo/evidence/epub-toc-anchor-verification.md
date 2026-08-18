# EPUB 目录与正文锚点验证

## 类型契约

- `@hamster-note/types@0.11.0-beta.1` 的 `IntermediateOutlineDestType` 原生支持 `TEXT`、`PAGE`、`POSITION`、`URL`。
- `TEXT` 目标使用 `{ targetType: "text", textId }`，可直接关联页面中的 `IntermediateText.id`。
- `IntermediateOutline` 没有层级或 children 字段；EPUB 原始扁平目录的 `level`、`order`、`href` 继续保存在 `epubTocItems`，未修改任何 sibling package。

## 行为验证

- 无 fragment 的章节目录项继续输出 `PAGE` 目标。
- `chapter.xhtml#xx` 会在对应章节中解析源 HTML `id="xx"`，并输出指向实际正文文本的 `TEXT` 目标。
- 锚点既支持块元素及其祖先的 id，也支持文字内部 `<span id="xx">` 等行内元素 id。
- 同一叶块包含多行文字时，行内锚点仅在目标文字能唯一匹配到生成文本行时输出 `TEXT`；无法可靠定位时回退 `PAGE`，避免误指向第一行。
- fragment 无法命中正文文本时安全回退为对应章节的 `PAGE` 目标，不生成悬空 `textId`。
- 导航项自身的 `id` 不再被误当成 manifest id，正文页只依据权威 `href` 匹配。
- 绝对 URL 与 protocol-relative URL 在归档路径解析时保持原样，外部目录项不会误跳到碰巧同名的内部 manifest。
- 嵌套 EPUB 3 nav 目录经扁平化后保留 `level`，验证结果为 `[0, 1, 0]`。

## 自动化验证

- 回归测试先观察到失败：嵌套 fragment 项错误输出 `targetType: "page"`。
- 定向测试：`epubEncode` 与 `EpubArchive` 相关测试合计 16/16 通过。
- 完整测试：`yarn test --runInBand`，9 个 suites、64 个 tests 全部通过。
- 类型检查：`yarn typecheck` 通过。
- 构建：`yarn build:all` 通过，成功生成 `dist/index.js`、`dist/index.d.ts` 与 source map。
- LSP：`src/EpubContentParser.ts`、`src/index.ts`、`src/EpubArchive.ts`、`src/__tests__/epubEncode.test.ts` 均无诊断。

## 公开入口手工 QA

通过 Node.js ESM 直接导入 `dist/index.js`，动态生成并解析包含二级 EPUB 3 nav 的有效 EPUB。正文在同一 `<p>` 中包含“前一行”和 `<span id="xx">目标文字</span>`；目录还包含一个 `li id` 与正文 manifest id 碰撞的外部 URL 项：

```json
{
  "levels": [0, 1, 0],
  "destinations": [
    {
      "targetType": "page",
      "pageId": "<generated-page-id>"
    },
    {
      "targetType": "text",
      "textId": "<generated-target-text-id>"
    },
    {
      "targetType": "url",
      "url": "https://example.com/reference"
    }
  ],
  "targetText": "目标文字"
}
```

手工 QA 同时从页面 content 按 `textId` 反查到文字“目标文字”，且该 id 不属于“前一行”；外部 URL 保持为 `https://example.com/reference`。这证明使用方可依据目录目标执行实际跳转，同时不会因导航项 id 与 manifest id 碰撞而误跳内部页面。

## 范围说明

- `src/index.ts` 是任务开始前已存在的超大主模块，且包含并行工作改动；本次仅在既有目录构建接缝增加锚点解析，没有为满足行数规则冒险重构或覆盖并行改动。
- `src/EpubContentParser.ts` 当前 233 行，处于 200 至 250 行警戒区；后续若继续扩展内容解析能力，应按职责拆分。
