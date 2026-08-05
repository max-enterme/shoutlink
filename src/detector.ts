/**
 * リダイレクト受信の検知。
 *
 * 「DOM ノード → RedirectEvent」の抽出部 (`extractRedirectEvent` / `collectRedirectEvents`) は
 * 純関数として切り出し、ノードの探索 (`startRedirectDetector` の MutationObserver) と分離してある。
 * 前者だけが単体テストの対象。
 */
import { log } from './log'
import {
  REDIRECT_TEXT_PATTERNS,
  getChatItemList,
  getRedirectNoticeChannelLink,
  getRedirectNoticeChannelName,
  isChatTextMessage,
  isRedirectNoticeElement,
  textOf,
} from './selectors'
import type { RedirectEvent } from './types'

const YOUTUBE_ORIGIN = 'https://www.youtube.com'

/**
 * チャンネル URL を `https://www.youtube.com/@handle` /
 * `https://www.youtube.com/channel/UC...` に正規化する。
 * チャンネル URL として解釈できなければ null。
 */
export function normalizeChannelUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  const input = raw.trim()
  if (!input) return null

  // `@handle` だけ渡された場合
  if (/^@[\w.\-]+$/.test(input)) return `${YOUTUBE_ORIGIN}/${input}`

  let url: URL
  try {
    url = new URL(input, YOUTUBE_ORIGIN)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!/(^|\.)youtube\.com$/.test(url.hostname)) return null

  const handle = url.pathname.match(/^\/(@[\w.\-]+)/)
  if (handle) return `${YOUTUBE_ORIGIN}/${handle[1]}`

  const channel = url.pathname.match(/^\/channel\/(UC[\w-]{20,})/)
  if (channel) return `${YOUTUBE_ORIGIN}/channel/${channel[1]}`

  const legacy = url.pathname.match(/^\/(c|user)\/([\w.\-]+)/)
  if (legacy) return `${YOUTUBE_ORIGIN}/${legacy[1]}/${legacy[2]}`

  return null
}

/** URL から表示名の代替(ハンドル)を作る */
function fallbackNameFromUrl(url: string): string {
  const handle = url.match(/\/(@[\w.\-]+)$/)
  if (handle) return handle[1]
  const legacy = url.match(/\/(?:c|user)\/([\w.\-]+)$/)
  if (legacy) return legacy[1]
  return url
}

/**
 * ノードがリダイレクト通知らしいか。
 *
 * 判定は 2 段:
 *   (a) **リダイレクト専用の要素**に一致 → 文言を見ずに通知とみなす
 *   (b) それ以外 → **文言パターンに一致すること**を必須にし、通常のチャットメッセージは除く
 *
 * (b) を必須にしているのは、システムメッセージの汎用コンテナ
 * (`yt-live-chat-viewer-engagement-message-renderer`) が「ライブ チャットへようこそ」の
 * 常設メッセージにも使われていることを確認しているため (2026-08-05)。
 * 要素の一致だけで通すと、この常設メッセージを毎回「通知」として拾ってしまう。
 *
 * TODO(T1): 実際にリダイレクトを受けた画面は未確認。(a) の要素が存在するのか、
 *           (b) の文言が何なのかは、まだ分かっていない。
 */
export function isRedirectNotice(el: Element): boolean {
  if (isRedirectNoticeElement(el)) return true
  if (isChatTextMessage(el)) return false

  const text = textOf(el)
  if (!text) return false
  return REDIRECT_TEXT_PATTERNS.some((pattern) => pattern.test(text))
}

/**
 * 通知ノード 1 件から RedirectEvent を抽出する純関数。
 * 通知でない / 送信元チャンネルが取れない場合は null。
 */
export function extractRedirectEvent(el: Element, detectedAt: number): RedirectEvent | null {
  if (!isRedirectNotice(el)) return null

  const link = getRedirectNoticeChannelLink(el)
  const url = normalizeChannelUrl(link?.getAttribute('href'))
  // 送信元が特定できない通知は捨てる。名前だけ分かっても URL が無ければ AC2 を満たせない。
  if (!url) return null

  const name = getRedirectNoticeChannelName(el) || textOf(link) || fallbackNameFromUrl(url)

  return {
    sourceChannelName: name,
    sourceChannelUrl: url,
    detectedAt,
    origin: 'auto',
  }
}

export type DetectedNotice = { element: Element; event: RedirectEvent }

/**
 * ノードとその子孫からリダイレクト通知を集める純関数。
 * MutationObserver が受け取る追加ノードは、通知そのものとは限らず親要素のこともある。
 * 通知が見つかった要素も返す(ノード単位の多重発火抑止に使う)。
 */
export function collectRedirectNotices(node: Node, detectedAt: number): DetectedNotice[] {
  if (node.nodeType !== 1 /* ELEMENT_NODE */) return []
  const el = node as Element

  const self = extractRedirectEvent(el, detectedAt)
  if (self) return [{ element: el, event: self }]

  const found: DetectedNotice[] = []
  for (const child of Array.from(el.children)) {
    found.push(...collectRedirectNotices(child, detectedAt))
  }
  return found
}

/** `collectRedirectNotices` の RedirectEvent だけを取り出した版 */
export function collectRedirectEvents(node: Node, detectedAt: number): RedirectEvent[] {
  return collectRedirectNotices(node, detectedAt).map((n) => n.event)
}

export type DetectorHandle = {
  /** 既に DOM にあるノードを走査する(初期表示分の取りこぼし対策) */
  scanExisting(): void
  stop(): void
}

export type DetectorOptions = {
  root?: ParentNode & Node
  onEvent: (event: RedirectEvent) => void
  now?: () => number
}

/**
 * MutationObserver で通知ノードの出現を監視する。抽出そのものは上の純関数に委譲する。
 */
export function startRedirectDetector(opts: DetectorOptions): DetectorHandle {
  const root = opts.root ?? document
  const now = opts.now ?? (() => Date.now())
  const seen = new WeakSet<Element>()

  const emitFrom = (node: Node): void => {
    for (const notice of collectRedirectNotices(node, now())) {
      // 同じ通知ノードが付け替えられても 2 度出さない(dedupe とは別の、ノード単位の抑止)
      if (seen.has(notice.element)) continue
      seen.add(notice.element)
      opts.onEvent(notice.event)
    }
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const added of Array.from(record.addedNodes)) {
        try {
          emitFrom(added)
        } catch (err) {
          log.error('検知中に例外:', err)
        }
      }
    }
  })

  // チャット項目リストが見つかればそこを、見つからなければ文書全体を監視する。
  // TODO(T1): 実 DOM 未確認。通知がチャット項目リストの外(バナー領域)に出る場合、
  //           リストだけを見ていると取りこぼす。現状は保険として親も監視する。
  const list = getChatItemList(root)
  const target = (list ?? (root as Document).body ?? root) as Node
  observer.observe(target, { childList: true, subtree: true })

  const scanExisting = (): void => {
    try {
      const base = (list ?? (root as Document).body) as Element | null
      if (base) emitFrom(base)
    } catch (err) {
      log.error('初期走査で例外:', err)
    }
  }

  return {
    scanExisting,
    stop: () => observer.disconnect(),
  }
}
