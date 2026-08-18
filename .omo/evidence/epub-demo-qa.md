# Demo EPUB HTML 预览 QA

## 验证对象

- 页面：`http://127.0.0.1:8871/`
- EPUB：`src/__tests__/fixtures/with-images.epub`、`with-cover.epub`
- 浏览器：Playwright Chromium（CDP）
- 视口：1280×900、768×900、375×812

## 观察结果

- 上传 EPUB 后，预览面板可见，HTML 来自 `IntermediateDocument`。
- `with-images.epub` 显示 1 页、1 张图片；页面内容 DOM 顺序为 `P → FIGURE`，严格保持中间文档中的文字与图片位置。
- `with-cover.epub` 显示 2 页、1 张图片；图片成功加载，fixture 图片固有尺寸为 1×1 像素。
- 1×1 fixture 图片放在带边框的可见图片容器中，并显示“EPUB 插图”图注，因此图片位置可被肉眼辨认，但没有伪造或放大图片内容。
- 所有预览图片源均为 `data:image/...`，没有远程或可执行协议图片。
- 三档视口的页面 `scrollWidth` 均等于视口宽度：1280/1280、768/768、375/375，无横向溢出。
- 768px 下输入控件纵向堆叠；375px 下预览取消内部滚动，页面保持单一纵向滚动区。
- 无效文件显示错误：`Failed to parse EPUB: Invalid ZIP central directory`。
- 成功预览后再上传无效文件，旧预览节点被清空、结果卡恢复“尚未运行”、旧下载链接被隐藏并移除 `href`。
- 最终 768px 与 375px 截图均通过视觉复核；中文和中英混排无单字孤行、拆词或异常短尾行，卡片、按钮、预览页无裁切或重叠。

## 截图

- `epub-demo-1280.png`
- `epub-demo-768.png`
- `epub-demo-375.png`

## 自动验证

- `node --test demo/documentToHtml.test.mjs`：3/3 通过。
- `yarn typecheck`：通过。
- `yarn build:all`：通过。
- `yarn test --runInBand`：9 个测试套件、61 个测试全部通过。
- `npm pack --dry-run --json`：产物仅包含 `dist`、README、LICENSE、package.json，未包含 `demo/`。
