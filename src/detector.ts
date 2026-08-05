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
  containsChatTextMessage,
  getRedirectNoticeChannelLink,
  getRedirectNoticeChannelName,
  isChatTextMessage,
  isInsideChatTextMessage,
  isRedirectNoticeElement,
  textOf,
} from './selectors'
import type { RedirectEvent } from './types'

const YOUTUBE_ORIGIN = 'https://www.youtube.com'

/**
 * 通知とみなすテキストの長さの上限。
 * 実際の通知は `@ハンドル とその視聴者が参加しました。挨拶しましょう` 程度(30 文字前後)。
 */
export const MAX_NOTICE_TEXT_LENGTH = 300

/**
 * チャンネル URL を `https://www.youtube.com/@handle` /
 * `https://www.youtube.com/channel/UC...` に正規化する。
 * チャンネル URL として解釈できなければ null。
 */
export function normalizeChannelUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  const input = raw.trim()
  if (!input) return null

  // `@handle` だけ渡された場合(日本語のハンドルもある)
  if (/^@[^\s@/?#]{1,40}$/u.test(input)) return `${YOUTUBE_ORIGIN}/${input}`

  let url: URL
  try {
    url = new URL(input, YOUTUBE_ORIGIN)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!/(^|\.)youtube\.com$/.test(url.hostname)) return null

  const handle = url.pathname.match(/^\/(@[^\s/?#]{1,40})/u)
  if (handle) return `${YOUTUBE_ORIGIN}/${decodeURIComponent(handle[1])}`

  const channel = url.pathname.match(/^\/channel\/(UC[\w-]{20,})/)
  if (channel) return `${YOUTUBE_ORIGIN}/channel/${channel[1]}`

  const legacy = url.pathname.match(/^\/(c|user)\/([\w.\-]+)/)
  if (legacy) return `${YOUTUBE_ORIGIN}/${legacy[1]}/${legacy[2]}`

  return null
}

/** ハンドルとして許す文字(空白と `@` 以外)。日本語のハンドルがあるため ASCII に限定しない */
const HANDLE_PATTERN = /@[^\s@/?#]{1,40}/u
/** ハンドルの末尾に付きうる句読点・括弧。URL に含めない */
const TRAILING_PUNCTUATION = /[。、，,．.!！?？「」『』()（）[\]:：;；]+$/u

/**
 * 通知文から `@ハンドル` を拾う。
 *
 * ⚠️ **確認済み (2026-08-05): ハンドルは日本語のことがある。**
 *    以前は `[A-Za-z0-9_.-]` に限定していたため、日本語のハンドルに一文字も当たらず、
 *    通知を検知しても送信元が取れずに捨てていた。
 *
 * ⚠️ **これはあくまで逃げ道。**通知内にチャンネルへのリンクがあるならそちらを使う。
 *    表示されている `@名前` が実際のハンドルとは限らず、そうでない場合ここから
 *    組み立てた URL は**間違ったチャンネルを指す**。
 */
export function extractHandleFromText(text: string): string | null {
  const match = text.match(HANDLE_PATTERN)
  if (!match) return null
  const handle = match[0].replace(TRAILING_PUNCTUATION, '')
  return handle.length > 1 ? handle : null
}

/** 正規化済みチャンネル URL から表示用のハンドルを作る(取れなければ URL のまま) */
export function handleFromChannelUrl(url: string): string {
  const handle = url.match(/\/(@[^\s/?#]+)$/u)
  if (handle) return handle[1]
  const legacy = url.match(/\/(?:c|user)\/([^\s/?#]+)$/u)
  if (legacy) return legacy[1]
  return url
}

/** 診断用の記録 */
export type UnextractableNotice = {
  tag: string
  text: string
  hrefs: (string | null)[]
}

/**
 * 診断用: **「通知らしいのに送信元が取れなかった」要素**を集める。
 *
 * これが無かったために「検知が発火しない」の原因(ハンドルが日本語で正規表現に
 * 当たらない)を掴むのに時間がかかった。無言で捨てないための窓。
 */
export function collectUnextractableNotices(node: Node): UnextractableNotice[] {
  const out: UnextractableNotice[] = []

  const walk = (el: Element): boolean => {
    if (isChatTextMessage(el)) return false

    let childMatched = false
    for (const child of Array.from(el.children)) {
      if (walk(child)) childMatched = true
    }
    if (childMatched) return true

    if (!isRedirectNotice(el)) return false
    if (extractRedirectEvent(el, 0)) return true

    out.push({
      tag: el.tagName.toLowerCase(),
      text: textOf(el).slice(0, 120),
      hrefs: Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href')),
    })
    return true
  }

  if (node.nodeType === 1) walk(node as Element)
  return out
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
  // 通常のチャットメッセージの内側は通知ではない。
  // **自分が投稿した返礼メッセージを検知して再投稿する事故**を防ぐ (2026-08-05)。
  if (isInsideChatTextMessage(el)) return false
  // チャットメッセージを内包する要素はコンテナであって通知ではない。
  if (containsChatTextMessage(el)) return false

  const text = textOf(el)
  if (!text) return false
  // コンテナ誤検知の保険。通知は 1 行の短文で、チャット欄やリスト全体のような
  // 長いテキストの塊は通知ではない (2026-08-05 の事故を参照)。
  if (text.length > MAX_NOTICE_TEXT_LENGTH) return false
  return REDIRECT_TEXT_PATTERNS.some((pattern) => pattern.test(text))
}

/**
 * 通知ノード 1 件から RedirectEvent を抽出する純関数。
 * 通知でない / 送信元チャンネルが取れない場合は null。
 */
export function extractRedirectEvent(el: Element, detectedAt: number): RedirectEvent | null {
  if (!isRedirectNotice(el)) return null

  const text = textOf(el)
  const link = getRedirectNoticeChannelLink(el)

  // リンクがあればそれを使い、無ければ通知文の `@ハンドル` から組み立てる
  const url =
    normalizeChannelUrl(link?.getAttribute('href')) ?? normalizeChannelUrl(extractHandleFromText(text))
  // 送信元が特定できない通知は捨てる。名前だけ分かっても URL が無ければ AC2 を満たせない。
  if (!url) return null

  const name = getRedirectNoticeChannelName(el) || textOf(link) || handleFromChannelUrl(url)

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
 *
 * **子孫を先に見て、最も内側で一致した要素を通知とみなす。**
 * 2026-08-05 の実配信で、チャット項目リスト全体が 1 つの要素として渡された結果、
 * 「リスト全体のテキスト」が文言パターンに一致し、**リスト内の無関係な `@ハンドル`
 * (自分自身のもの)を送信元として拾って投稿する**事故が起きた。
 * 外側から順に見て最初の一致を採ると、必ずこの誤りが起きる。
 */
export function collectRedirectNotices(node: Node, detectedAt: number): DetectedNotice[] {
  if (node.nodeType !== 1 /* ELEMENT_NODE */) return []
  const el = node as Element

  // 通常のチャットメッセージの中には降りない。
  // 降りると、自分が投稿した返礼メッセージ(「リダイレクト」+ チャンネル URL を含む)の
  // 内側の要素が通知の条件を満たし、**自分の投稿を検知して再投稿する**。
  if (isChatTextMessage(el)) return []

  const fromChildren: DetectedNotice[] = []
  for (const child of Array.from(el.children)) {
    fromChildren.push(...collectRedirectNotices(child, detectedAt))
  }
  if (fromChildren.length > 0) return fromChildren

  const self = extractRedirectEvent(el, detectedAt)
  return self ? [{ element: el, event: self }] : []
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
  /**
   * 診断ログ。通常のチャットメッセージ以外のノードが増えたら、その構造をコンソールに出す。
   * **リダイレクト通知の正体が分からない間の唯一の手がかり**なので、
   * 「検知が動かない」ときはこれを ON にして次のリダイレクトを待つ。
   */
  debug?: () => boolean
}

/**
 * 診断ログで「通知の候補」とみなす文言のヒント。
 * REDIRECT_TEXT_PATTERNS より緩く取り、惜しい取りこぼしも見えるようにする。
 */
const NOTICE_HINT = /参加|リダイレクト|redirect|raid|joined|viewers/i

/** 診断ログ用に、要素の構造を 1 行にまとめる */
function describeNode(el: Element): Record<string, unknown> {
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || undefined,
    attrs: el.getAttributeNames(),
    hrefs: Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href')),
    innerTags: Array.from(el.querySelectorAll('*'))
      .map((c) => c.tagName.toLowerCase())
      .slice(0, 20),
    text: textOf(el).slice(0, 200),
    matchedAsNotice: isRedirectNotice(el),
  }
}

/**
 * MutationObserver で通知ノードの出現を監視する。抽出そのものは上の純関数に委譲する。
 */
export function startRedirectDetector(opts: DetectorOptions): DetectorHandle {
  const root = opts.root ?? document
  const now = opts.now ?? (() => Date.now())
  const isDebug = opts.debug ?? (() => false)
  const seen = new WeakSet<Element>()

  const emitFrom = (node: Node): void => {
    for (const notice of collectRedirectNotices(node, now())) {
      // 同じ通知ノードが付け替えられても 2 度出さない(dedupe とは別の、ノード単位の抑止)
      if (seen.has(notice.element)) continue
      seen.add(notice.element)
      opts.onEvent(notice.event)
    }
  }

  /**
   * 診断ログ。**通知の候補になりうるノードだけ**を出す。
   *
   * 以前は「通常のチャットメッセージ以外のカスタム要素」を全部出していたが、
   * `yt-invalidation-continuation` 等がひたすら流れてログが読めなくなったため、
   * 文言のヒントに引っかかるものだけに絞った。何も出ないこと自体が
   * 「候補が現れていない」という情報になる。
   */
  const traceFrom = (node: Node): void => {
    if (node.nodeType !== 1) return
    const el = node as Element
    if (el.closest?.('#yt-redirect-pin-manual-trigger')) return
    if (isChatTextMessage(el)) return
    if (!NOTICE_HINT.test(textOf(el))) return
    log.info('[debug] 通知候補:', describeNode(el))
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const added of Array.from(record.addedNodes)) {
        try {
          emitFrom(added)
          if (isDebug()) traceFrom(added)
        } catch (err) {
          log.error('検知中に例外:', err)
        }
      }
    }
  })

  // **文書全体を監視する。**
  // 2026-08-05 に実配信で確認: 通知はチャット項目リスト (`#items`) の中には無く、
  // その外(バナー相当の領域)に出る。項目リストだけに絞ると取りこぼす(plan.md C1)。
  const target = ((root as Document).body ?? root) as Element

  observer.observe(target, { childList: true, subtree: true })

  /**
   * 既に DOM にあるノードを走査する。
   *
   * ⚠️ **監視と同じ範囲(body 全体)を見ること。**
   *    ここを `#items` に絞っていたため、**ページを開き直したときに既に出ている通知を
   *    一切拾えなかった**(通知は `#items` の外にいる)。
   *    リロード後は observer の追加イベントが来ないので、この走査が唯一の経路になる。
   */
  const scanExisting = (): void => {
    try {
      emitFrom(target)
      if (isDebug()) {
        // 「通知らしいが送信元が取れなかった」ものがあるときだけ出す。
        // ここに出るなら抽出側の問題。
        const misses = collectUnextractableNotices(target)
        if (misses.length > 0) log.warn('[debug] 送信元が取れなかった通知候補:', misses)
      }
    } catch (err) {
      log.error('初期走査で例外:', err)
    }
  }

  return {
    scanExisting,
    stop: () => observer.disconnect(),
  }
}
