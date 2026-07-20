const fileInput = document.querySelector('#fileInput')
const runUploadButton = document.querySelector('#runUploadButton')
const runSampleButton = document.querySelector('#runSampleButton')
const statusNode = document.querySelector('#status')
const encodeResult = document.querySelector('#encodeResult')
const decodeResult = document.querySelector('#decodeResult')
const reEncodeResult = document.querySelector('#reEncodeResult')
const downloadDecoded = document.querySelector('#downloadDecoded')
const pageNumberInput = document.querySelector('#pageNumberInput')
const showPageButton = document.querySelector('#showPageButton')

let selectedFile
let decodedObjectUrl

const setStatus = (message, isError = false) => {
  statusNode.textContent = message
  statusNode.classList.toggle('error', isError)
}

const escapeHtml = (value) => {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const formatValue = (value) => {
  if (Array.isArray(value)) return value.join(', ')
  if (value === undefined || value === null || value === '') return '无'
  return String(value)
}

const renderDocumentSummary = (summary) => {
  const pages = summary.pages
    .map(
      (page) => `
        <div class="page-preview">
          <strong>Page ${escapeHtml(page.number)}</strong>
          <div>${escapeHtml(page.textPreview || '无文本预览')}</div>
          <small>texts: ${escapeHtml(page.textCount)} · images: ${escapeHtml(page.imageCount)}</small>
        </div>`
    )
    .join('')

  return `
    <dl class="metric-list">
      <div><dt>标题</dt><dd>${escapeHtml(summary.title)}</dd></div>
      <div><dt>作者</dt><dd>${escapeHtml(formatValue(summary.metadata.author))}</dd></div>
      <div><dt>页数</dt><dd>${escapeHtml(summary.pageCount)}</dd></div>
      <div><dt>目录项</dt><dd>${escapeHtml(summary.outlineCount)}</dd></div>
      <div><dt>图片资源</dt><dd>${escapeHtml(summary.assetCount)}</dd></div>
    </dl>
    <div class="pages">${pages}</div>`
}

const base64ToBlob = (base64, mimeType) => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new Blob([bytes], { type: mimeType })
}

const renderResults = (result) => {
  encodeResult.classList.remove('empty')
  decodeResult.classList.remove('empty')
  reEncodeResult.classList.remove('empty')

  encodeResult.innerHTML = renderDocumentSummary(result.encode)
  decodeResult.innerHTML = `
    <dl class="metric-list">
      <div><dt>输出大小</dt><dd>${escapeHtml(result.decode.byteLength)} bytes</dd></div>
      <div><dt>ZIP 签名</dt><dd>${escapeHtml(result.decode.zipSignature)}</dd></div>
      <div><dt>MIME</dt><dd>${escapeHtml(result.decode.mimeType)}</dd></div>
    </dl>`
  reEncodeResult.innerHTML = renderDocumentSummary(result.reEncode)

  if (decodedObjectUrl) URL.revokeObjectURL(decodedObjectUrl)
  decodedObjectUrl = URL.createObjectURL(
    base64ToBlob(result.decode.base64, result.decode.mimeType)
  )
  downloadDecoded.href = decodedObjectUrl
  downloadDecoded.download = result.decode.fileName
  downloadDecoded.classList.remove('hidden')
}

const runRoundtrip = async (input) => {
  runSampleButton.disabled = true
  runUploadButton.disabled = true
  setStatus('正在运行 encode -> decode -> re-encode，请稍候…')

  try {
    const response = input
      ? await fetch('/api/roundtrip', {
          method: 'POST',
          headers: { 'content-type': 'application/epub+zip' },
          body: input
        })
      : await fetch('/api/roundtrip')

    const payload = await response.json()

    if (!response.ok) {
      throw new Error(payload.error || 'Demo request failed')
    }

    renderResults(payload)
    setStatus('完成：encode/decode 都已通过真实 EPUB 回路展示。')
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true)
  } finally {
    runSampleButton.disabled = false
    runUploadButton.disabled = !selectedFile
  }
}

fileInput.addEventListener('change', () => {
  selectedFile = fileInput.files?.[0]
  runUploadButton.disabled = !selectedFile
  setStatus(selectedFile ? `已选择：${selectedFile.name}` : '等待运行 Demo。')
})

runSampleButton.addEventListener('click', () => runRoundtrip())
runUploadButton.addEventListener('click', async () => {
  if (!selectedFile) return
  await runRoundtrip(await selectedFile.arrayBuffer())
})

// 按页码查询页面数据并输出到 Console。
// 数据源与运行按钮保持一致：当前选择了文件就查询上传文件，否则查询内置样例。
const showPageData = async () => {
  const pageNumber = Number(pageNumberInput.value)

  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    setStatus('请输入大于等于 1 的整数页码。', true)
    return
  }

  showPageButton.disabled = true
  setStatus(`正在获取第 ${pageNumber} 页的 IntermediateDocument 数据…`)

  try {
    const query = `?number=${pageNumber}`
    const response = selectedFile
      ? await fetch(`/api/page${query}`, {
          method: 'POST',
          headers: { 'content-type': 'application/epub+zip' },
          body: await selectedFile.arrayBuffer()
        })
      : await fetch(`/api/page${query}`)

    const payload = await response.json()

    if (!response.ok) {
      throw new Error(payload.error || 'Page query failed')
    }

    // 核心输出：文档上下文 + 该页的 IntermediatePageSerialized 完整数据
    console.log(
      `[EpubParser Demo] 第 ${pageNumber} 页 IntermediateDocument 数据：`,
      payload
    )
    setStatus(
      `已输出第 ${pageNumber} 页数据到 Console（全文共 ${payload.document.pageCount} 页），请打开开发者工具查看。`
    )
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true)
  } finally {
    showPageButton.disabled = false
  }
}

showPageButton.addEventListener('click', showPageData)
