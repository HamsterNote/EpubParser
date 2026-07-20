import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { IntermediatePage } from '@hamster-note/types'

import { EpubParser } from '../dist/index.js'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const demoDir = join(rootDir, 'demo')
const sampleEpubPath = join(rootDir, 'src/__tests__/fixtures/minimal.epub')
const host = process.env.HOST ?? '0.0.0.0'
const port = Number(process.env.PORT ?? 8871)
const maxBodyBytes = 50 * 1024 * 1024

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.epub': 'application/epub+zip',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
}

const getLanUrls = () => {
  return Object.values(networkInterfaces())
    .flatMap((items) => items ?? [])
    .filter((item) => item.family === 'IPv4' && !item.internal)
    .map((item) => `http://${item.address}:${port}`)
}

const getStartupUrls = () => {
  if (host === '0.0.0.0' || host === '::') {
    return [`http://localhost:${port}`, ...getLanUrls()]
  }

  return [`http://${host}:${port}`]
}

const send = (response, statusCode, body, headers = {}) => {
  response.writeHead(statusCode, headers)
  response.end(body)
}

const sendJson = (response, statusCode, body) => {
  send(response, statusCode, JSON.stringify(body, null, 2), {
    'content-type': 'application/json; charset=utf-8'
  })
}

const readRequestBody = (request) => {
  return new Promise((resolve, reject) => {
    const chunks = []
    let totalLength = 0

    request.on('data', (chunk) => {
      totalLength += chunk.length

      if (totalLength > maxBodyBytes) {
        request.destroy(new Error('EPUB file is larger than 50 MB'))
        return
      }

      chunks.push(chunk)
    })

    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

const bytesFromParserOutput = async (output) => {
  if (output instanceof Blob) {
    return Buffer.from(await output.arrayBuffer())
  }

  if (ArrayBuffer.isView(output)) {
    return Buffer.from(output.buffer, output.byteOffset, output.byteLength)
  }

  return Buffer.from(output)
}

const isTextContent = (item) => {
  return (
    typeof item === 'object' &&
    item !== null &&
    typeof item.content === 'string'
  )
}

const isImageContent = (item) => {
  return (
    typeof item === 'object' && item !== null && typeof item.src === 'string'
  )
}

const summarizeDocument = async (document) => {
  const pages = [...(await document.pages)].sort((a, b) => a.number - b.number)
  const pageSummaries = await Promise.all(
    pages.map(async (page) => {
      const content = await page.getContent()
      const text = content
        .filter(isTextContent)
        .map((item) => item.content)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()

      return {
        id: page.id,
        number: page.number,
        textPreview: text.slice(0, 180),
        textCount: content.filter(isTextContent).length,
        imageCount: content.filter(isImageContent).length
      }
    })
  )

  const metadata = document.metadata ?? document.epubMetadata ?? {}
  const outline =
    typeof document.getOutline === 'function'
      ? document.getOutline()
      : undefined

  return {
    title: document.title,
    pageCount: document.pageCount ?? pages.length,
    metadata: {
      title: metadata.title,
      author: metadata.author,
      language: metadata.language,
      publisher: metadata.publisher,
      date: metadata.date
    },
    outlineCount: Array.isArray(outline) ? outline.length : 0,
    assetCount: Array.isArray(document.epubImages)
      ? document.epubImages.length
      : 0,
    pages: pageSummaries
  }
}

const runRoundtrip = async (inputBytes) => {
  const encodedEpubDocument = await EpubParser.encode(inputBytes)
  const encodedDocument = encodedEpubDocument.getIntermediateDocument()
  const encodedSummary = await summarizeDocument(encodedDocument)

  const decodedOutput = await EpubParser.decode(encodedDocument)
  const decodedBytes = await bytesFromParserOutput(decodedOutput)
  const reEncodedDocument = (
    await EpubParser.encode(decodedBytes)
  ).getIntermediateDocument()

  return {
    encode: encodedSummary,
    decode: {
      byteLength: decodedBytes.byteLength,
      zipSignature: [...decodedBytes.subarray(0, 4)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(' '),
      fileName: 'decoded-demo.epub',
      mimeType: 'application/epub+zip',
      base64: decodedBytes.toString('base64')
    },
    reEncode: await summarizeDocument(reEncodedDocument)
  }
}

// 按页码查询单个页面的序列化数据（IntermediatePageSerialized），供前端输出到 Console
const runPageQuery = async (inputBytes, pageNumber) => {
  const encodedEpubDocument = await EpubParser.encode(inputBytes)
  const document = encodedEpubDocument.getIntermediateDocument()
  const pageNumbers = document.pageNumbers
  const page = await document.getPageByPageNumber(pageNumber)

  if (!page) {
    return {
      error: `Page ${pageNumber} does not exist. Available page numbers: ${pageNumbers.join(', ')}`,
      pageCount: document.pageCount,
      pageNumbers
    }
  }

  return {
    document: {
      id: document.id,
      title: document.title,
      pageCount: document.pageCount,
      pageNumbers
    },
    page: IntermediatePage.serialize(page)
  }
}

// 从 query string 解析页码，非法时返回 undefined
const parsePageNumber = (requestUrl) => {
  const pageNumber = Number(requestUrl.searchParams.get('number'))

  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    return undefined
  }

  return pageNumber
}

// 处理 /api/roundtrip 路由（GET 用内置样例，POST 用上传的 EPUB）。
// 返回 true 表示该请求已被处理。
const handleRoundtripRequest = async (request, response, requestUrl) => {
  if (requestUrl.pathname !== '/api/roundtrip') {
    return false
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    return false
  }

  const inputBytes =
    request.method === 'GET'
      ? await readFile(sampleEpubPath)
      : await readRequestBody(request)

  if (!inputBytes.byteLength) {
    sendJson(response, 400, {
      error: 'Please upload a non-empty EPUB file.'
    })
    return true
  }

  sendJson(response, 200, await runRoundtrip(inputBytes))
  return true
}

// 处理 /api/page?number=N 路由（GET 用内置样例，POST 用上传的 EPUB）。
// 返回 true 表示该请求已被处理。
const handlePageRequest = async (request, response, requestUrl) => {
  if (requestUrl.pathname !== '/api/page') {
    return false
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    return false
  }

  const pageNumber = parsePageNumber(requestUrl)

  if (pageNumber === undefined) {
    sendJson(response, 400, {
      error: 'Query parameter "number" must be an integer >= 1.'
    })
    return true
  }

  const inputBytes =
    request.method === 'GET'
      ? await readFile(sampleEpubPath)
      : await readRequestBody(request)

  if (!inputBytes.byteLength) {
    sendJson(response, 400, {
      error: 'Please upload a non-empty EPUB file.'
    })
    return true
  }

  const result = await runPageQuery(inputBytes, pageNumber)
  sendJson(response, result.error ? 404 : 200, result)
  return true
}

const serveStatic = async (response, relativePath) => {
  const absolutePath = join(demoDir, relativePath)
  const extension = extname(absolutePath)
  const body = await readFile(absolutePath)

  send(response, 200, body, {
    'content-type': contentTypes[extension] ?? 'application/octet-stream'
  })
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(
      request.url ?? '/',
      `http://${request.headers.host}`
    )

    if (request.method === 'GET' && requestUrl.pathname === '/') {
      await serveStatic(response, 'index.html')
      return
    }

    if (
      request.method === 'GET' &&
      ['/demo.css', '/demo.js'].includes(requestUrl.pathname)
    ) {
      await serveStatic(response, requestUrl.pathname.slice(1))
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/sample.epub') {
      const sample = await readFile(sampleEpubPath)
      send(response, 200, sample, {
        'content-disposition': 'attachment; filename="minimal.epub"',
        'content-type': 'application/epub+zip'
      })
      return
    }

    if (await handleRoundtripRequest(request, response, requestUrl)) {
      return
    }

    if (await handlePageRequest(request, response, requestUrl)) {
      return
    }

    sendJson(response, 404, { error: 'Not found' })
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : String(error)
    })
  }
})

server.listen(port, host, () => {
  console.log(
    ['EPUB encode/decode demo running:', ...getStartupUrls()].join('\n')
  )
})
