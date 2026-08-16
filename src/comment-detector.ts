/**
 * コメントの検知 (004 / AC3 / AC4 / AC9 / AC10)。
 *
 * [detector.ts](./detector.ts) と同じ作りで、**「DOM ノード → CommentAuthor」の抽出**を
 * 純関数として切り出し、ノードの監視 (`startCommentDetector`) と分けてある。
 * 単体テストの対象は前者。
 *
 * ⚠️ **リダイレクト側と違い、`scanExisting` を持たない** (AC9)。
 *    起動時・スイッチを ON にした時点で既にあるコメントには反応しない。
 *
 * ⚠️ **取れなかったら捨てる。**投稿者が特定できない / 配信の持ち主を切り分けられない /
 *    タイムスタンプの要素が無い、のいずれも**何もしない**側へ倒す。
 *    **ただし黙って捨てない** — 理由を診断ログに出す (plan.md R10 / R12)。
 *    この repo は「無言で捨てる分岐が実機の往復を消費する」を繰り返し踏んでいる。
 */
import { log } from './log'
import {
  getCommentAuthorParams,
  getCommentAuthorType,
  getCommentTimestampText,
  isCommentTextMessage,
} from './selectors'

/** コメント 1 件から取れた、投稿者まわりの情報 */
export type CommentAuthor = {
  /** 投稿者のチャンネル ID (`UC…`)。**取れなければこの型自体を返さない** */
  channelId: string
  /** 同じ `params` から取れた「配信の持ち主」の ID。自分の投稿の判別に使う (AC10) */
  ownerChannelId: string
  /** `author-type` 属性。`'owner'` なら配信者自身の投稿 (AC10) */
  authorType: string
  /** `#timestamp` のテキスト(`5:17 PM` 形式)。要素が無ければ null (AC9) */
  timestampText: string | null
  detectedAt: number
}

/** 抽出できなかった理由。**診断ログに出すためだけ**に持つ */
export type CommentExtractFailure =
  | 'コメントではない'
  | '投稿者の属性が無い'
  | '属性が JSON でない'
  | 'params が無い'
  | 'デコードできない'
  | 'チャンネル ID が無い'
  | '配信の持ち主を切り分けられない'
  | '投稿者を 1 つに絞れない'

export type CommentExtractResult =
  | { ok: true; author: CommentAuthor }
  | { ok: false; reason: CommentExtractFailure }

// --- 投稿者の取り出し -------------------------------------------------------

/** protobuf の中の `UC…`。1 つ 24 文字 */
const CHANNEL_ID_IN_BLOB = /UC[A-Za-z0-9_-]{22}/g
/** 動画 ID の形(`v=` に出るもの)。長さは 11 が通例だが幅を持たせる */
const VIDEO_ID_SHAPE = /^[\w-]{8,20}$/

function decodeBase64(value: string): string {
  try {
    const normalized = decodeURIComponent(value).replace(/-/g, '+').replace(/_/g, '/')
    return atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4))
  } catch {
    return ''
  }
}

/**
 * `params` を base64 で 2 回解いた中身から `UC…` を集める。
 *
 * ✅ 確認済み (2026-08-15 / 実配信): 中身は
 * 「メッセージ ID / {チャンネル ID, 動画 ID} / {チャンネル ID}」で、**`UC…` はちょうど 2 個**。
 * ページ内部の `authorExternalChannelId`(正解)と全メッセージで一致した。
 */
function collectChannelIds(blob: string): { id: string; at: number }[] {
  const out: { id: string; at: number }[] = []
  CHANNEL_ID_IN_BLOB.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CHANNEL_ID_IN_BLOB.exec(blob)) != null) {
    out.push({ id: match[0], at: match.index })
  }
  return out
}

/**
 * **「動画 ID とペアになっている ID」= 配信の持ち主**を特定する (AC4)。
 *
 * ⚠️ **順序で決めない。**`params` は公開された仕様ではなく、フィールド番号・順序が変われば
 *    「2 つ目が投稿者」は成り立たなくなる。**構造(その ID の直後に動画 ID が続くか)**で見る。
 *
 * ⚠️ **`streamId` が空でも判定を成立させる。**`currentStreamId()` は空を返しうる
 *    (管制室の埋め込みチャット)。一致を必須にすると、その画面で**機能が無言で 1 度も動かない**。
 *    空でないときだけ、余分な確かめとして一致も要求する。
 */
function findOwnerId(blob: string, ids: { id: string; at: number }[], streamId: string): string | null {
  for (const hit of ids) {
    // protobuf: `0a 18 <24 バイトの UC>` の直後に `12 <len> <動画 ID>` が続く
    const tagAt = hit.at + hit.id.length
    if (blob.charCodeAt(tagAt) !== 0x12) continue
    const length = blob.charCodeAt(tagAt + 1)
    if (!Number.isFinite(length) || length <= 0 || length > 32) continue
    const candidate = blob.slice(tagAt + 2, tagAt + 2 + length)
    if (candidate.length !== length || !VIDEO_ID_SHAPE.test(candidate)) continue
    // 配信 ID が取れているなら、それと一致することも確かめる
    if (streamId && candidate !== streamId) continue
    return hit.id
  }
  return null
}

export type ExtractOptions = {
  /** 今見ているチャットの配信 ID。空でもよい(上記 `findOwnerId`) */
  streamId?: string
  now?: number
}

/**
 * コメント要素 1 件から投稿者を取り出す**純関数** (AC3 / AC4)。
 *
 * 失敗は理由つきで返す。**呼び出し側が診断ログに出せるようにするため**で、
 * 握って `null` にすると「なぜ反応しないのか」が消える。
 */
export function extractCommentAuthor(
  el: Element,
  options: ExtractOptions = {},
): CommentExtractResult {
  if (!isCommentTextMessage(el)) return { ok: false, reason: 'コメントではない' }

  const raw = getCommentAuthorParams(el)
  if (!raw) return { ok: false, reason: '投稿者の属性が無い' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: '属性が JSON でない' }
  }
  const params = (parsed as { liveChatItemContextMenuEndpoint?: { params?: unknown } })
    ?.liveChatItemContextMenuEndpoint?.params
  if (typeof params !== 'string' || !params) return { ok: false, reason: 'params が無い' }

  const blob = decodeBase64(decodeBase64(params))
  if (!blob) return { ok: false, reason: 'デコードできない' }

  const ids = collectChannelIds(blob)
  if (ids.length === 0) return { ok: false, reason: 'チャンネル ID が無い' }

  const streamId = options.streamId ?? ''
  const ownerChannelId = findOwnerId(blob, ids, streamId)
  // **持ち主を切り分けられないまま「残り」を採らない** (AC4)。
  // 採ると**持ち主(= 配信者自身)の ID を投稿者として採りうる**。配信者自身は辞書に載りうるので、
  // その行が ON だと**視聴者の全コメントが「自分への返し」を撃つ**
  if (!ownerChannelId) return { ok: false, reason: '配信の持ち主を切り分けられない' }

  const others = new Set(ids.filter((hit) => hit.id !== ownerChannelId).map((hit) => hit.id))
  // 配信者自身の投稿では、投稿者の ID も持ち主と同じになる(`others` が空)
  const channelId = others.size === 0 ? ownerChannelId : others.size === 1 ? [...others][0] : null
  if (!channelId) return { ok: false, reason: '投稿者を 1 つに絞れない' }

  return {
    ok: true,
    author: {
      channelId,
      ownerChannelId,
      authorType: getCommentAuthorType(el),
      timestampText: getCommentTimestampText(el),
      detectedAt: options.now ?? Date.now(),
    },
  }
}

// --- 新旧の切り分け (AC9) ---------------------------------------------------

/** 1 日の分数 */
const MINUTES_PER_DAY = 24 * 60
/** 日付が無いので、これ以上離れて見える値は「読めなかった」に倒す */
const MAX_MINUTE_DISTANCE = 12 * 60

/**
 * `5:17 PM` / `17:17` を**その日の 0 時からの分**に直す。読めなければ null (AC9)。
 *
 * ✅ 確認済み (2026-08-15 / 実配信 / 日本語 UI): `3:46 PM` の形だった。
 * 24 時間表記のロケールもありうるので両方受ける。**それ以外の形は「読めなかった」**にする。
 */
export function parseClockText(text: string): number | null {
  const trimmed = text.trim()
  const ampm = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (ampm) {
    const hour12 = Number(ampm[1])
    const minute = Number(ampm[2])
    if (hour12 < 1 || hour12 > 12 || minute > 59) return null
    const isPm = ampm[3].toUpperCase() === 'PM'
    const hour = (hour12 % 12) + (isPm ? 12 : 0)
    return hour * 60 + minute
  }
  const h24 = trimmed.match(/^(\d{1,2}):(\d{2})$/)
  if (h24) {
    const hour = Number(h24[1])
    const minute = Number(h24[2])
    if (hour > 23 || minute > 59) return null
    return hour * 60 + minute
  }
  return null
}

export type Freshness =
  /** 監視を張った分より前 = 既にあったコメント。**投稿しない** */
  | 'before'
  /** 監視開始以降。猶予を抜けていれば投稿してよい */
  | 'after'
  /** 時刻として読めなかった。**猶予だけで判定する** */
  | 'unreadable'
  /** タイムスタンプの要素そのものが無い。**構造が変わった = 投稿しない** */
  | 'missing'

/**
 * コメントが監視開始より前のものか (AC9)。
 *
 * ⚠️ **分単位なので秒では切れない。****監視開始と同じ分**のコメントは `after` になり、
 *    猶予明けに再挿入されると素通りする。その範囲で残る歯止めは AC7(1 人 1 回)と AC11(20 件)。
 *
 * ⚠️ **日付が無い。**`11:59 PM` と `12:00 AM` を取り違えないよう、
 *    **12 時間以上離れて見える値は `unreadable`** に倒す。
 */
export function judgeFreshness(
  timestampText: string | null,
  startedAt: number,
  nowDate: Date = new Date(startedAt),
): Freshness {
  if (timestampText == null) return 'missing'
  const minutes = parseClockText(timestampText)
  if (minutes == null) return 'unreadable'

  const startMinutes = nowDate.getHours() * 60 + nowDate.getMinutes()
  let diff = minutes - startMinutes
  // 日付をまたいだ側へ回り込ませてから距離を見る
  if (diff > MINUTES_PER_DAY / 2) diff -= MINUTES_PER_DAY
  if (diff < -MINUTES_PER_DAY / 2) diff += MINUTES_PER_DAY
  if (Math.abs(diff) >= MAX_MINUTE_DISTANCE) return 'unreadable'
  return diff < 0 ? 'before' : 'after'
}

/** 監視を張った直後の猶予 (AC9)。この間に現れたコメントには投稿しない */
export const OBSERVE_GRACE_MS = 10_000

/**
 * そのコメントに反応してよいか (AC9)。**タイムスタンプと猶予の併用**。
 *
 * - `missing`(要素ごと無い)→ **反応しない**(`channelId` 側と同じく安全側)
 * - `unreadable` → **猶予だけで判定する**(生きているコメントを取りこぼさない)
 */
export function isFreshComment(
  author: Pick<CommentAuthor, 'timestampText' | 'detectedAt'>,
  observeStartedAt: number,
  startedAtDate?: Date,
): { fresh: boolean; freshness: Freshness } {
  const freshness = judgeFreshness(
    author.timestampText,
    observeStartedAt,
    startedAtDate ?? new Date(observeStartedAt),
  )
  if (freshness === 'missing') return { fresh: false, freshness }
  if (freshness === 'before') return { fresh: false, freshness }
  const withinGrace = author.detectedAt - observeStartedAt < OBSERVE_GRACE_MS
  return { fresh: !withinGrace, freshness }
}

// --- 監視 -------------------------------------------------------------------

export type CommentDetectorHandle = {
  stop(): void
  /** 監視を張った時刻。猶予の起点 (AC9) */
  readonly startedAt: number
}

export type CommentDetectorOptions = {
  root?: ParentNode & Node
  /** **新しく現れたコメント**だけが渡る */
  onComment: (author: CommentAuthor) => void
  streamId?: string
  now?: () => number
  /** 抽出できなかった理由を出すか(設定の診断ログ) */
  debug?: () => boolean
}

/**
 * 追加ノードだけを見る MutationObserver (AC9)。
 *
 * ⚠️ **`scanExisting` を作らない。**リダイレクト側は初期走査が唯一の検知経路だが、
 *    コメント側は「起動時に既にあるものには反応しない」が要件 (AC9)。
 *
 * ⚠️ **監視する範囲はチャット項目リストではなく `body` 全体にしない。**
 *    コメントは項目リストの中にしか出ない。広げると自分の投稿・バナー・
 *    メニューの出現まで拾って無駄が増える(リダイレクト通知はリストの外に出るので
 *    あちらは `body` を見ている / detector.ts)。
 */
export function startCommentDetector(options: CommentDetectorOptions): CommentDetectorHandle {
  const root = options.root ?? document
  const now = options.now ?? (() => Date.now())
  const isDebug = options.debug ?? (() => false)
  const startedAt = now()
  const seen = new WeakSet<Element>()

  const handleNode = (node: Node): void => {
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return
    const el = node as Element
    if (!isCommentTextMessage(el)) return
    // 同じ要素が付け替えられても 2 度出さない(ノード単位の抑止。dedupe とは別)
    if (seen.has(el)) return
    seen.add(el)

    const result = extractCommentAuthor(el, { streamId: options.streamId, now: now() })
    if (!result.ok) {
      // **無言で捨てない。**「反応しない」の切り分けはここでしかできない
      if (isDebug()) log.info('[debug] コメントから投稿者を取れなかった:', result.reason)
      return
    }
    options.onComment(result.author)
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const added of Array.from(record.addedNodes)) {
        try {
          handleNode(added)
        } catch (err) {
          // AC12: どこで失敗しても配信に影響させない
          log.error('コメント検知中に例外:', err)
        }
      }
    }
  })

  const target = ((root as Document).body ?? root) as Element
  observer.observe(target, { childList: true, subtree: true })

  return {
    startedAt,
    stop: () => observer.disconnect(),
  }
}
