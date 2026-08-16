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
  /**
   * 持ち主をどちらの手段で切り分けたか。**診断ログ用。**
   * `'video-id'` は T1 で実測した形、`'structure'` は推論(上の `matchOwnerAt`)。
   */
  ownerMatchedBy: 'video-id' | 'structure'
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
  | '持ち主の候補が複数ある'
  | '投稿者が配信の持ち主と同じ'
  | '投稿者を 1 つに絞れない'

export type CommentExtractResult =
  | { ok: true; author: CommentAuthor }
  | { ok: false; reason: CommentExtractFailure }

// --- 投稿者の取り出し -------------------------------------------------------

/** protobuf の中の `UC…`。1 つ 24 文字 */
const CHANNEL_ID_IN_BLOB = /UC[A-Za-z0-9_-]{22}/g
/** 動画 ID の形(`v=` に出るもの)。長さは 11 が通例だが幅を持たせる */
const VIDEO_ID_SHAPE = /^[\w-]{8,20}$/

/**
 * パーセントエンコードを解く。**壊れた `%` があっても元の文字列を返す。**
 *
 * ⚠️ **これは保険であって、挙動の分かれ目ではない。** 投げさせても `decodeBase64` の
 *    `catch` が拾い、戻り値は同じ `''` になる(`%` は `atob` が必ず拒否するため)。
 *    2026-08-06 の事故 3(`decodeURIComponent` の `URIError` でパイプラインごと落とした)と
 *    同じ形を、握る側で閉じておくためだけに置いている。
 */
function percentDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * `params` の 1 段を解く。
 *
 * ⚠️ **段ごとにパーセントデコードが要る。**
 *    実配信 (2026-08-16) で、**1 回目を解いた結果が `…%3D` で終わっていた** —
 *    base64 のパディング `=` がパーセントエンコードされたまま入っている。
 *    2 段目を素の base64 として `atob` に渡すと `%` で例外になり、**全メッセージが
 *    「デコードできない」で落ちる**(誰に対しても一度も発火しない状態だった)。
 *
 * ⚠️ **これを「1 回目だけ」に戻さない。**T1 の採取記録の「base64 で 2 回」は
 *    **パーセントデコードの回数を数えていなかった。**合成 fixture 側も `btoa(btoa(…))` で
 *    `%3D` を含まない形にしてあったため、**テストは緑のまま実機で動かない**状態が続いた
 *    (plan.md「合成 DOM を仕様にしない」で警告していた轍そのもの)。
 */
function decodeBase64(value: string): string {
  try {
    const normalized = percentDecode(value).replace(/-/g, '+').replace(/_/g, '/')
    return atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4))
  } catch {
    return ''
  }
}

/**
 * `params` を 2 段(**各段ともパーセントデコード + base64**)解いた中身から `UC…` を集める。
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

/** ID の直後に続く「動画 ID らしき文字列」を見る窓の広さ */
const VIDEO_ID_WINDOW = 20

/**
 * ある ID の直後に**動画 ID が続いているか**。続いていればその文字列を返す。
 *
 * ⚠️ **判定は 2 通りあり、確からしさが違う。**
 *
 * - `'video-id'` … **T1 で実測した形**。`UC…` の直後 20 バイトの窓に、
 *   **今見ている配信の動画 ID がそのまま入っている**か。実配信の全メッセージで
 *   この判定が正解と一致した(`docs/004-t1-collect.md`)
 * - `'structure'` … **推論。**`UC…` の直後が protobuf の `12 <len> <文字列>` の形か。
 *   **T1 はここまで測っていない**(プローブは窓に動画 ID が入るかだけを見ていた)。
 *   **配信 ID が取れないとき**(管制室の埋め込みチャット)の唯一の手段なので置いてあるが、
 *   **外れれば全件が「切り分けられない」に落ちて機能が無言で止まる。**
 *   どちらで当たったかは診断ログに出す
 */
function matchOwnerAt(
  blob: string,
  hit: { id: string; at: number },
  streamId: string,
): 'video-id' | 'structure' | null {
  const after = hit.at + hit.id.length
  if (streamId && blob.slice(after, after + VIDEO_ID_WINDOW).includes(streamId)) return 'video-id'

  if (blob.charCodeAt(after) !== 0x12) return null
  const length = blob.charCodeAt(after + 1)
  if (!Number.isFinite(length) || length <= 0 || length > 32) return null
  const candidate = blob.slice(after + 2, after + 2 + length)
  if (candidate.length !== length || !VIDEO_ID_SHAPE.test(candidate)) return null
  // 配信 ID が取れているのに一致しないなら、それは動画 ID ではない
  if (streamId && candidate !== streamId) return null
  return 'structure'
}

/**
 * **「動画 ID とペアになっている ID」= 配信の持ち主**を特定する (AC4)。
 *
 * ⚠️ **順序で決めない。**`params` は公開された仕様ではなく、フィールド番号・順序が変われば
 *    「先に出てきたほう」は意味を持たない。**当たった候補を全部集め、1 つに絞れなければ捨てる。**
 *    先勝ちにすると、投稿者側にも同じ形のフィールドが増えた瞬間に
 *    **投稿者を持ち主と誤判定し、`channelId` に配信者自身の ID が入る。**
 *
 * ⚠️ **`streamId` が空でも判定を成立させる。**`currentStreamId()` は空を返しうる
 *    (管制室の埋め込みチャット)。一致を必須にすると、その画面で**機能が無言で 1 度も動かない**。
 */
function findOwnerId(
  blob: string,
  ids: { id: string; at: number }[],
  streamId: string,
):
  | { ok: true; id: string; by: 'video-id' | 'structure' }
  | { ok: false; reason: '配信の持ち主を切り分けられない' | '持ち主の候補が複数ある' } {
  const hits: { id: string; by: 'video-id' | 'structure' }[] = []
  for (const hit of ids) {
    const by = matchOwnerAt(blob, hit, streamId)
    if (by) hits.push({ id: hit.id, by })
  }
  if (hits.length === 0) return { ok: false, reason: '配信の持ち主を切り分けられない' }
  const distinct = new Set(hits.map((h) => h.id))
  // **2 つ以上が「持ち主に見える」なら決められない**(順序で選ばない)
  if (distinct.size > 1) return { ok: false, reason: '持ち主の候補が複数ある' }
  // 実測で当たったものがあればそちらを理由として報告する
  const picked = hits.find((h) => h.by === 'video-id') ?? hits[0]
  return { ok: true, id: picked.id, by: picked.by }
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
  const owner = findOwnerId(blob, ids, streamId)
  // **持ち主を切り分けられないまま「残り」を採らない** (AC4)。
  // 採ると**持ち主(= 配信者自身)の ID を投稿者として採りうる**。配信者自身は辞書に載りうるので、
  // その行が ON だと**視聴者の全コメントが「自分への返し」を撃つ**
  if (!owner.ok) return { ok: false, reason: owner.reason }

  const others = new Set(ids.filter((hit) => hit.id !== owner.id).map((hit) => hit.id))
  // **配信者自身の投稿(投稿者 = 持ち主)はここで捨てる。**
  // AC4 は「残りが 1 つに絞れたときだけ」なので、`others` が空のときに持ち主を返さない。
  // 弾く対象なので捨てても結果は同じで、**下流(AC10)への依存が 1 つ減る**
  if (others.size === 0) return { ok: false, reason: '投稿者が配信の持ち主と同じ' }
  if (others.size > 1) return { ok: false, reason: '投稿者を 1 つに絞れない' }

  return {
    ok: true,
    author: {
      channelId: [...others][0],
      ownerChannelId: owner.id,
      ownerMatchedBy: owner.by,
      authorType: getCommentAuthorType(el),
      timestampText: getCommentTimestampText(el),
      detectedAt: options.now ?? Date.now(),
    },
  }
}

// --- 新旧の切り分け (AC9) ---------------------------------------------------

/** 1 日の分数 */
const MINUTES_PER_DAY = 24 * 60
/**
 * 日付が無いので、これ以上離れて見える値は「読めなかった」に倒す。
 *
 * ⚠️ **先に ±12 時間へ折り返しているので、ここに当たるのは「ちょうど 12 時間差」だけ。**
 *    13 時間前のコメントは折り返して「1 時間後」に見えるため `after` になる
 *    (投稿の可否は `unreadable` と同じく猶予任せなので挙動は変わらない)。
 */
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
  /**
   * **AC9 を通ったコメントだけが渡る** — 監視開始より前のもの・猶予の中のもの・
   * タイムスタンプの要素が無いものは、ここへ来る前に捨てられる。
   *
   * **要素も渡す。**自己ループの遮断 (AC10) は「自分が投稿した要素か」「本文が一致するか」を
   * 見るので、呼び出し側に要素が要る。**検知側は投稿のことを知らないままでいる。**
   */
  onComment: (author: CommentAuthor, el: Element) => void
  /**
   * **この要素は見ない** (AC10 の 1 枚目)。自分が投稿した要素を呼び出し側が覚えておき、
   * ここで弾く。**抽出の前に呼ぶ**ので、自分の投稿で診断ログが埋まることもない。
   */
  ignoreElement?: (el: Element) => boolean
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
 * ⚠️ **監視するのは `body` 全体。**チャット項目リストに絞ると、**リストごと差し替えられたとき
 *    (ポップアウトの開き直し・フィルタ切替)に observer が外れて無言で止まる。**
 *    代償として、**項目リストの外に現れる `yt-live-chat-text-message-renderer` も拾いうる**
 *    (固定バナーの中など。固定時の DOM はまだ確認していない / selectors.ts)。
 *    そこは AC10 の自己ループ遮断(T8)と AC9 の時刻判定で受ける。
 */
export function startCommentDetector(options: CommentDetectorOptions): CommentDetectorHandle {
  const root = options.root ?? document
  const now = options.now ?? (() => Date.now())
  const isDebug = options.debug ?? (() => false)
  const startedAt = now()
  // 分単位の比較には「監視を張った時刻の時分」が要る (AC9)
  const startedAtDate = new Date(startedAt)
  const seen = new WeakSet<Element>()

  const handleNode = (node: Node): void => {
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return
    const el = node as Element
    if (!isCommentTextMessage(el)) return
    // AC10 の 1 枚目: 自分が投稿した要素は見ない
    if (options.ignoreElement?.(el)) return
    // 同じ要素が付け替えられても 2 度出さない(ノード単位の抑止。dedupe とは別)
    if (seen.has(el)) return
    seen.add(el)

    const result = extractCommentAuthor(el, { streamId: options.streamId, now: now() })
    if (!result.ok) {
      // **無言で捨てない。**「反応しない」の切り分けはここでしかできない
      if (isDebug()) log.info('[debug] コメントから投稿者を取れなかった:', result.reason)
      return
    }

    // **AC9 はここで適用する。**下流(T8)に委ねると、R3 の 1 枚目の歯止めが
    // 「渡ってきたものは新しい」という思い込みで抜ける
    const { fresh, freshness } = isFreshComment(result.author, startedAt, startedAtDate)
    if (!fresh) {
      if (isDebug()) log.info('[debug] 監視開始より前のコメントとして捨てた:', freshness)
      return
    }
    // 読めなかった場合は**通したうえで**残しておく。猶予しか効いていないことが分かるように
    if (isDebug() && freshness === 'unreadable') {
      log.info('[debug] タイムスタンプを読めなかった。猶予だけで判定した')
    }

    options.onComment(result.author, el)
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
