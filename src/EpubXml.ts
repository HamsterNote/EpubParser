import { XMLParser, XMLValidator } from 'fast-xml-parser'
import type {
  EpubArchiveMetadata,
  EpubManifestItem,
  EpubTocElement
} from './EpubArchiveTypes.js'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  ignoreDeclaration: true
})

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const asArray = (value: unknown): unknown[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]

export const textOf = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim()
  return isRecord(value) ? String(value['#text'] ?? '').trim() : ''
}

export const parseXml = (xml: string): Record<string, unknown> => {
  const validation = XMLValidator.validate(xml)
  if (validation !== true) {
    throw new Error(`${validation.err.msg}\nLine: ${validation.err.line}\nColumn: ${validation.err.col}`)
  }

  const parsed: unknown = xmlParser.parse(xml)
  if (!isRecord(parsed)) throw new Error('XML root must be an object')
  const keys = Object.keys(parsed)
  const root = keys.length === 1 ? parsed[keys[0]] : parsed
  if (!isRecord(root)) throw new Error('XML root contents must be an object')
  return root
}

const attributesOf = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key.startsWith('@_'))
      .map(([key, attribute]) => [key.slice(2), String(attribute)])
  )
}

export const resolveArchivePath = (baseFile: string, relativePath: string): string => {
  const path = relativePath.split('#')[0]
  if (!path) return baseFile
  if (path.startsWith('/')) return path.slice(1)

  const parts = [...baseFile.split('/').slice(0, -1), ...path.split('/')]
  const normalized: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') normalized.pop()
    else normalized.push(part)
  }
  return normalized.join('/')
}

export const parsePackageDocument = (
  root: Record<string, unknown>,
  rootFile: string
): {
  metadata: EpubArchiveMetadata
  manifest: Record<string, EpubManifestItem>
  guide: Record<string, string>[]
  flow: EpubManifestItem[]
  tocId?: string
  version: string
} => {
  const metadata: EpubArchiveMetadata = {}
  const manifest: Record<string, EpubManifestItem> = {}
  const guide: Record<string, string>[] = []
  let flow: EpubManifestItem[] = []
  let tocId: string | undefined

  for (const [fullKey, value] of Object.entries(root)) {
    const key = fullKey.split(':').pop()?.toLowerCase()
    if (key === 'metadata' && isRecord(value)) parseMetadata(value, metadata)
    if (key === 'manifest' && isRecord(value)) {
      for (const item of asArray(value.item)) {
        const attributes = attributesOf(item)
        if (!attributes.id || !attributes.href || !attributes['media-type']) continue
        manifest[attributes.id] = {
          ...attributes,
          id: attributes.id,
          href: resolveArchivePath(rootFile, attributes.href),
          'media-type': attributes['media-type']
        }
      }
    }
    if (key === 'guide' && isRecord(value)) {
      for (const reference of asArray(value.reference)) {
        const attributes = attributesOf(reference)
        if (attributes.href) attributes.href = resolveArchivePath(rootFile, attributes.href)
        guide.push(attributes)
      }
    }
    if (key === 'spine' && isRecord(value)) {
      tocId = typeof value['@_toc'] === 'string' ? value['@_toc'] : undefined
      flow = asArray(value.itemref).flatMap((item) => {
        const idref = isRecord(item) ? item['@_idref'] : undefined
        return typeof idref === 'string' && manifest[idref] ? [manifest[idref]] : []
      })
    }
  }

  return { metadata, manifest, guide, flow, tocId, version: String(root['@_version'] ?? '2.0') }
}

const parseMetadata = (
  source: Record<string, unknown>,
  metadata: EpubArchiveMetadata
): void => {
  for (const [fullKey, value] of Object.entries(source)) {
    if (fullKey.startsWith('@_')) continue
    const key = fullKey.split(':').pop()?.toLowerCase()
    const first = asArray(value)[0]
    if (['publisher', 'title', 'description', 'date'].includes(key ?? '')) {
      if (key) metadata[key] = textOf(first)
    } else if (key === 'language') metadata.language = textOf(first).toLowerCase()
    else if (key === 'subject') {
      metadata.subjects = asArray(value).map(textOf)
      metadata.subject = metadata.subjects[0] ?? ''
    } else if (key === 'creator') {
      metadata.creator = textOf(first)
      metadata.creatorFileAs = isRecord(first)
        ? String(first['@_opf:file-as'] ?? metadata.creator).trim()
        : metadata.creator
    } else if (key === 'source') metadata.source = textOf(first)
    else if (key === 'identifier') {
      for (const identifier of asArray(value)) {
        const identifierText = textOf(identifier)
        if (!metadata.identifier && identifierText) metadata.identifier = identifierText
        if (!isRecord(identifier)) continue
        const scheme = identifier['@_opf:scheme']
        const id = identifier['@_id']
        if (typeof scheme === 'string') metadata[scheme] = textOf(identifier)
        else if (typeof id === 'string' && /uuid/i.test(id)) {
          metadata.UUID = textOf(identifier).replace('urn:uuid:', '').toUpperCase().trim()
        }
      }
    }
  }

  for (const value of asArray(source.meta)) {
    if (!isRecord(value)) continue
    if (typeof value['@_name'] === 'string') metadata[value['@_name']] = value['@_content']
    if (value['#text'] !== undefined && typeof value['@_property'] === 'string') {
      metadata[value['@_property']] = value['#text']
    }
  }
}

export const parseNcx = (
  root: Record<string, unknown>,
  tocFile: string,
  manifest: Record<string, EpubManifestItem>
): EpubTocElement[] => {
  const navMap = isRecord(root.navMap) ? root.navMap : undefined
  const hrefToId = new Map(Object.values(manifest).map((item) => [item.href, item.id]))
  return navMap ? walkNavPoints(navMap.navPoint, tocFile, hrefToId, manifest, 0) : []
}

const walkNavPoints = (
  branch: unknown,
  tocFile: string,
  hrefToId: Map<string, string>,
  manifest: Record<string, EpubManifestItem>,
  level: number
): EpubTocElement[] => {
  if (level > 7) return []
  const output: EpubTocElement[] = []
  for (const value of asArray(branch)) {
    if (!isRecord(value)) continue
    const label = isRecord(value.navLabel) ? textOf(value.navLabel.text) : ''
    const source = isRecord(value.content) ? value.content['@_src'] : undefined
    if (label && typeof source === 'string') {
      const href = resolveArchivePath(tocFile, source)
      const id = hrefToId.get(href.split('#')[0]) ?? String(value['@_id'] ?? '')
      output.push({
        ...(manifest[id] ?? {}),
        level,
        order: Number(value['@_playOrder'] ?? 0) || 0,
        title: label,
        id,
        href
      })
    }
    output.push(...walkNavPoints(value.navPoint, tocFile, hrefToId, manifest, level + 1))
  }
  return output
}

export const parseNavigationDocument = (
  xhtml: string,
  navFile: string,
  manifest: Record<string, EpubManifestItem>
): EpubTocElement[] => {
  const nav = [...xhtml.matchAll(/<nav\b([^>]*)>[\s\S]*?<\/nav>/gi)].find((match) => {
    const type = /(?:epub:type|type)\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1]
    return type?.split(/\s+/).includes('toc')
  })?.[0]
  if (!nav) return []
  const hrefToId = new Map(Object.values(manifest).map((item) => [item.href, item.id]))
  return [...nav.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match, index) => {
      const href = resolveArchivePath(navFile, match[1])
      const id = hrefToId.get(href.split('#')[0]) ?? ''
      return {
        ...(manifest[id] ?? {}),
        level: 0,
        order: index + 1,
        title: match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        id,
        href
      }
    })
    .filter((item) => item.title)
}
