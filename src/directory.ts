/**
 * 送信元チャンネルの呼び名辞書。
 *
 * - **同一性の鍵は正規化済みチャンネル URL。**dedupe が使っている `sourceKey` と同じ考え方。
 *   表示は URL から作った `@ハンドル`。
 * - **ニックネームが空の登録は「未設定」**とみなし、文面ではハンドルをそのまま使う。
 *   リダイレクトを受けた相手を自動で登録するが、それだけでは文面は変わらない。
 *
 * 純関数と保存を分けてあり、純関数側だけが単体テストの対象。
 */
import { getStorageArea } from './config'
import { handleFromChannelUrl } from './detector'
import type { RedirectEvent } from './types'

export type DirectoryEntry = {
  /** 正規化済みチャンネル URL。同一性の鍵 */
  url: string
  /** 置き換える呼び名。**空文字は「未設定」** */
  nickname: string
  /** 最後にリダイレクトを受けた時刻。0 は「まだ受けていない」(手動登録) */
  lastSeenAt: number
}

export type Directory = DirectoryEntry[]

const STORAGE_KEY = 'ytRedirectPin.directory'

/** URL の表記ゆれを吸収した鍵 */
export function directoryKey(url: string): string {
  return url.trim().toLowerCase()
}

/** 表示用のハンドル */
export function displayHandle(entry: DirectoryEntry): string {
  return handleFromChannelUrl(entry.url)
}

export function findEntry(directory: Directory, url: string): DirectoryEntry | undefined {
  const key = directoryKey(url)
  return directory.find((entry) => directoryKey(entry.url) === key)
}

/**
 * 文面に差し込む呼び名を決める。
 * 辞書にニックネームがあればそれを、無ければ検知した表示名をそのまま使う。
 */
export function resolveDisplayName(directory: Directory, event: RedirectEvent): string {
  const nickname = findEntry(directory, event.sourceChannelUrl)?.nickname.trim()
  return nickname ? nickname : event.sourceChannelName
}

/**
 * リダイレクトしてきた相手を辞書に載せる(既にあれば `lastSeenAt` を更新)。
 * **ニックネームは付けない。**後から人が付ける前提。
 */
export function rememberSource(directory: Directory, event: RedirectEvent): Directory {
  const key = directoryKey(event.sourceChannelUrl)
  const existing = directory.find((entry) => directoryKey(entry.url) === key)
  if (existing) {
    return directory.map((entry) =>
      entry === existing ? { ...entry, lastSeenAt: event.detectedAt } : entry,
    )
  }
  return [...directory, { url: event.sourceChannelUrl, nickname: '', lastSeenAt: event.detectedAt }]
}

/** 手動登録・呼び名の変更 */
export function upsertNickname(directory: Directory, url: string, nickname: string): Directory {
  const key = directoryKey(url)
  const existing = directory.find((entry) => directoryKey(entry.url) === key)
  if (existing) {
    return directory.map((entry) => (entry === existing ? { ...entry, nickname } : entry))
  }
  return [...directory, { url, nickname, lastSeenAt: 0 }]
}

export function removeEntry(directory: Directory, url: string): Directory {
  const key = directoryKey(url)
  return directory.filter((entry) => directoryKey(entry.url) !== key)
}

/** 表示順: 最近リダイレクトを受けた順 → ハンドル順(手動登録は末尾) */
export function sortForDisplay(directory: Directory): Directory {
  return [...directory].sort((a, b) => {
    if (a.lastSeenAt !== b.lastSeenAt) return b.lastSeenAt - a.lastSeenAt
    return displayHandle(a).localeCompare(displayHandle(b))
  })
}

/** 壊れた保存内容で拡張ごと死なせない (AC6) */
export function normalizeDirectory(raw: unknown): Directory {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Directory = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { url, nickname, lastSeenAt } = item as Partial<DirectoryEntry>
    if (typeof url !== 'string' || !url.trim()) continue
    const key = directoryKey(url)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      url: url.trim(),
      nickname: typeof nickname === 'string' ? nickname : '',
      lastSeenAt: Number.isFinite(lastSeenAt) ? Number(lastSeenAt) : 0,
    })
  }
  return out
}

// --- 保存 -----------------------------------------------------------------

export async function loadDirectory(): Promise<Directory> {
  const area = getStorageArea()
  if (!area) return []
  const stored = await area.get(STORAGE_KEY)
  return normalizeDirectory(stored?.[STORAGE_KEY])
}

export async function saveDirectory(directory: Directory): Promise<void> {
  const area = getStorageArea()
  if (area) await area.set({ [STORAGE_KEY]: normalizeDirectory(directory) })
}

/** 辞書の変更の購読。戻り値を呼ぶと解除する */
export function onDirectoryChanged(handler: (directory: Directory) => void): () => void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {}

  const listener = (changes: Record<string, chrome.storage.StorageChange>): void => {
    const change = changes[STORAGE_KEY]
    if (change) handler(normalizeDirectory(change.newValue))
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}
