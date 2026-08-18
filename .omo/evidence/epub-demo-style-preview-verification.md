# EPUB Demo 样式预览验证

## 根因与修复

- Demo 原先把 `IntermediateText` 统一输出为无样式段落，并把图片统一输出为未使用 polygon 的 figure；`preview.css` 又用固定字体覆盖阅读区域。
- `demo/documentToHtml.mjs` 现在通过白名单 class 与受限 CSS 变量映射字号、字体族、字重、斜体、颜色、透明度、行高、段落对齐、首行缩进和图片 polygon 几何。
- CSS 通用字体族保持关键字形式，例如 `sans-serif` 不加引号；清理后的自定义字体名仍加引号并进行 HTML 转义。
- `demo/preview.css` 消费这些变量，图片按 polygon 宽高比响应式展示且不超过预览容器。
- 内置样例改为 `styled-text.epub`，点击“运行内置样例”即可观察 28/24/16/12px 字号层级、粗体与斜体差异。

## 失败优先回归

- 修复前 `node --test demo/documentToHtml.test.mjs` 为 3 通过、2 失败，失败点分别是文字样式/段落信息丢失和图片几何丢失。
- 首轮实现后新增通用字体族回归断言，确认 `sans-serif` 被错误序列化为带引号名称，测试为 4 通过、1 失败。
- 完成字体序列化修复后，定向测试 5/5 通过。

## 自动化验证

- `node --test demo/documentToHtml.test.mjs`：5/5 通过。
- `yarn test --runInBand`：9 个 suites、64 个 tests 全部通过。
- `yarn typecheck`：通过。
- `yarn build:all`：通过。
- `demo/documentToHtml.mjs`、`demo/documentToHtml.test.mjs`、`demo/server.mjs`：LSP 无诊断。
- Demo 改动：`git diff --check` 通过。

## 真实 Chromium QA

默认 8871 端口已被另一个旧 Demo 进程占用，未触碰该进程；当前代码使用 `HOST=127.0.0.1 PORT=8872 node demo/server.mjs` 验证。

真实点击内置样例后：

- `Chapter Heading One` 的 computed style 为 `font-size: 28px`、`font-weight: 700`、`font-family: sans-serif`。
- 五段文本的字号为 28/24/16/16/12px，字重为 700/700/700/400/400。
- 1280、768、375 三档均无横向 overflow。
- Hero 的“并验证输出。”在三档均只有一个 client rect，未拆词或产生单字孤行。

真实上传 `with-images.epub` 后：

- figure class 为 `epub-image epub-image-center`。
- polygon 映射尺寸为 1×1，实际 img 仍为 1×1，宽高比为 1:1，`object-fit: contain`。
- figure 中心与预览页面中心均为 x=640。
- 浏览器 console errors、page errors、failed requests 均为空。

## 新鲜截图

- `.omo/evidence/epub-demo-style-1280.png`
- `.omo/evidence/epub-demo-style-768.png`
- `.omo/evidence/epub-demo-style-375.png`
- `.omo/evidence/epub-demo-image-1280.png`

两个独立只读视觉审查均基于以上最后一次代码编辑后的截图返回 PASS，BLOCKING 均为空：

- 功能与设计完整性：字体语义、真实 DOM、段落映射、图片几何、安全与响应式通过。
- 视觉与 CJK 精度：三档无裁切、重叠、横向溢出或中文孤字，目标短语保持完整。
