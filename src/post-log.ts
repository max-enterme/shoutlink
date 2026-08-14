/**
 * 投稿履歴のローカル保存(再投稿の抑止)。
 *
 * ⚠️ **2026-08-06 の不具合: チャットを再読み込みすると同じ相手に何度も投稿していた。**
 *    リダイレクトの通知/バナーはチャット文書に残り続けるため、リロード後の初期走査
 *    (`detector.scanExisting`) がそれを「新しい通知」として拾い直す。
 *    抑止の記録 (`dedupe`) がメモリ上にしか無く、文書のライフサイクルと一緒に消えるので、
 *    リロードのたびに抑止が白紙に戻っていた。
 *
 * → **投稿したら「誰に・何を・いつ・どの配信で」を残し、起動時に読み戻して
 *    クールダウン判定の初期値にする。**
 *
 * 記録するのは**実際に投稿できたとき**だけ。投稿に失敗した回は残さない
 * (残すと、投稿できていないのに抑止だけ効いてしまう)。
 *
 * 純関数と保存を分けてあり、純関数側だけが単体テストの対象(directory.ts と同じ作り)。
 */
import { getLocalStorageArea } from './config'
import { UNKNOWN_STREAM_MIN_COOLDOWN_SEC } from './dedupe'
import { handleFromChannelUrl } from './detector'
import type { RedirectEvent } from './types'

/**
 * 投稿の種別 (004 / AC8)。
 *
 * **抑止の効き方が非対称**なので、記録が「どちらの引き金で出たか」を保持する必要がある:
 *   - リダイレクト返礼を投稿済み → コメント返しは**しない**
 *   - コメント返しを投稿済み → リダイレクト返礼は**する**(こちらが本命)
 */
export type PostKind = 'redirect' | 'comment'

export type PostRecord = {
  /** 正規化済みチャンネル URL。同一性の鍵 */
  url: string
  /** 表示用のハンドル(人がログ・設定画面で読むため) */
  handle: string
  /** 実際に投稿した文面 */
  text: string
  /** 投稿した時刻 (epoch ms) */
  postedAt: number
  /** どの配信で投稿したか(動画 ID)。**取れなければ空文字** */
  streamId: string
  /**
   * 投稿の種別 (004 / AC14)。
   *
   * ⚠️ **`'comment'` に完全一致したときだけ `comment`、それ以外はすべて `redirect`。**
   *    004 より前の記録はこのキーを持たないが、それらはすべてリダイレクト返礼である。
   *    壊れた値を `redirect` へ倒すのは、`redirect` の記録が AC8 により**両方の投稿を止める**側だから。
   *    `comment` へ倒すと `absorb` の除外に引っかかり、**リダイレクト側の抑止から記録が丸ごと外れて**
   *    リロード時の再投稿(2026-08-06 ④)が戻る。
   */
  kind: PostKind
}

export type PostLog = PostRecord[]

const STORAGE_KEY = 'ytRedirectPin.postLog'

/** 保存件数の上限。古いものから捨てる */
export const POST_LOG_MAX_ENTRIES = 200
/** これより古い記録は捨てる。クールダウンは秒〜分単位なので 7 日あれば十分 */
export const POST_LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** 保存する文面の長さの上限(storage を無駄に食わないため) */
export const POST_LOG_MAX_TEXT_LENGTH = 500

/** URL の表記ゆれを吸収した鍵(dedupe / directory と同じ考え方) */
export function postLogKey(url: string): string {
  return url.trim().toLowerCase()
}

/**
 * live_chat の `v=` パラメータ。ポップアウト
 * (`studio.youtube.com/live_chat?is_popout=1&v=...`) はこれで取れる。
 */
export function streamIdFromUrl(href: string): string {
  try {
    return new URL(href).searchParams.get('v')?.trim() ?? ''
  } catch {
    return ''
  }
}

/** Studio の管制室 URL (`studio.youtube.com/video/<id>/livestreaming`) から動画 ID を取る */
export function streamIdFromStudioPath(href: string): string {
  try {
    return new URL(href).pathname.match(/^\/video\/([\w-]+)/)?.[1] ?? ''
  } catch {
    return ''
  }
}

/**
 * 今見ているチャットがどの配信のものか。
 *
 * 1. **自分の URL の `v=`** — ポップアウトはこれで取れる
 * 2. **親フレームの URL** — 管制室の埋め込みチャットは iframe で、`v=` を持たないことがある。
 *    親は同じ `studio.youtube.com`(同一オリジン)なので読める
 * 3. **取れなければ空文字** — 「同一配信」の判定を諦め、時間のクールダウンだけで抑止する
 *    (この状態は起動ログに `streamId: '(不明)'` として出る)
 */
export function currentStreamId(win: Window = window): string {
  const own = streamIdFromUrl(win.location.href)
  if (own) return own
  try {
    if (!win.top || win.top === win) return ''
    // クロスオリジンならここで例外になる。その場合は諦める
    const parentHref = win.top.location.href
    return streamIdFromUrl(parentHref) || streamIdFromStudioPath(parentHref)
  } catch {
    return ''
  }
}

/** 投稿できた事実を 1 件の記録にする(**URL を受ける形**。コメント経路はこちらを使う) */
export function makePostRecordFor(
  url: string,
  text: string,
  options: { streamId: string; postedAt: number; kind: PostKind },
): PostRecord {
  return {
    url,
    handle: handleFromChannelUrl(url),
    text,
    postedAt: options.postedAt,
    streamId: options.streamId,
    kind: options.kind,
  }
}

/**
 * リダイレクト返礼の記録 (001)。**`makePostRecordFor` の薄いラッパ。**
 * コメント経路には `RedirectEvent` が無いので、本体は URL を受ける形にしてある。
 */
export function makePostRecord(
  event: RedirectEvent,
  text: string,
  options: { streamId: string; postedAt: number },
): PostRecord {
  return makePostRecordFor(event.sourceChannelUrl, text, { ...options, kind: 'redirect' })
}

/**
 * 記録の同一性は「どの配信で・どの種別で・どの送信元に」。同じ組み合わせは最新で上書きする。
 *
 * **種別を鍵に含める** (004 / AC8)。含めないと、同じ配信・同じ相手にコメント返しをした時点で
 * リダイレクト返礼の記録が置き換えられ、**リロード後にリダイレクト側の抑止が消える。**
 * 既存の記録は `kind='redirect'` に落ちるので、**リダイレクト側の鍵は実質変わらない。**
 */
function entryKey(streamId: string, kind: PostKind, url: string): string {
  return `${streamId} ${kind} ${postLogKey(url)}`
}

/**
 * 古い記録・多すぎる記録を捨てる。
 *
 * ⚠️ **件数の上限は種別ごとに数える** (plan.md R4)。まとめて 200 件にすると、
 *    コメント返し(1 配信 20 件まで出る)が**古いリダイレクト返礼の記録を押し出し**、
 *    001 の「リロードで再投稿しない」が戻る。枠を分ければ、コメント側がいくら増えても
 *    リダイレクト側の記録は残る。
 */
export function prunePostLog(log: PostLog, now: number): PostLog {
  const kept: PostLog = []
  const counts: Record<PostKind, number> = { redirect: 0, comment: 0 }
  for (const record of [...log]
    .filter((entry) => now - entry.postedAt < POST_LOG_MAX_AGE_MS)
    .sort((a, b) => b.postedAt - a.postedAt)) {
    if (counts[record.kind] >= POST_LOG_MAX_ENTRIES) continue
    counts[record.kind] += 1
    kept.push(record)
  }
  return kept
}

/** 投稿を記録する(同じ配信・同じ種別・同じ送信元の記録があれば置き換える) */
export function rememberPost(log: PostLog, record: PostRecord): PostLog {
  const key = entryKey(record.streamId, record.kind, record.url)
  const rest = log.filter((entry) => entryKey(entry.streamId, entry.kind, entry.url) !== key)
  return prunePostLog([record, ...rest], record.postedAt)
}

/** この配信で、この送信元に**その種別で**既に投稿しているか */
export function findPostInStream(
  log: PostLog,
  streamId: string,
  url: string,
  kind: PostKind,
): PostRecord | undefined {
  if (!streamId) return undefined
  const key = entryKey(streamId, kind, url)
  return log.find((entry) => entryKey(entry.streamId, entry.kind, entry.url) === key)
}

/**
 * 配信を問わず、この送信元への**その種別での**最後の投稿。
 *
 * ⚠️ **種別を必須の引数にしてある。**ここは「投稿されない」の切り分け専用の窓
 *    ([main.ts](./main.ts))で、種別をまたいで拾うと**コメント返しの記録を
 *    「前回のリダイレクト返礼」として**ログに出す。実害はログの文言だけだが、
 *    誤読させると実機の往復を消費する。
 */
export function findLastPost(log: PostLog, url: string, kind: PostKind): PostRecord | undefined {
  const key = postLogKey(url)
  return log
    .filter((entry) => postLogKey(entry.url) === key && entry.kind === kind)
    .reduce<PostRecord | undefined>(
      (latest, entry) => (latest == null || entry.postedAt > latest.postedAt ? entry : latest),
      undefined,
    )
}

/**
 * **コメント返しを止める記録**を探す (004 / AC7 / AC8)。
 *
 * リダイレクト側 (`dedupe.ts`) と規則が違うので別の関数にしてある:
 *   - **種別を問わない** — 同じ配信でリダイレクト返礼済みでもコメント返しはしない (AC8)
 *   - **`cooldownSec` を見ない** — 「同じ配信で 1 回」だけで判定する。
 *     `cooldownSec = 0`(テスターに指示している値)を抑止の逃げ道にする運用を持ち込まない
 *   - **配信 ID が取れないときは 6 時間の下限**(`UNKNOWN_STREAM_MIN_COOLDOWN_SEC` / AC7)。
 *     `findPostInStream` は `streamId` が空だと必ず `undefined` を返すため、
 *     これが無いとコメント側の抑止が丸ごと外れる
 */
export function findCommentReplyBlocker(
  log: PostLog,
  params: { streamId: string; url: string; now: number },
): PostRecord | undefined {
  const key = postLogKey(params.url)
  const sameChannel = log.filter((entry) => postLogKey(entry.url) === key)
  if (params.streamId) {
    return sameChannel.find((entry) => entry.streamId === params.streamId)
  }
  const floorMs = UNKNOWN_STREAM_MIN_COOLDOWN_SEC * 1000
  return sameChannel.find((entry) => params.now - entry.postedAt < floorMs)
}

/**
 * この配信で既に出したコメント返しの件数 (AC11 の 20 件上限の分母)。
 *
 * ⚠️ **メモリのカウンタで数えない。**開き直しのたびに枠がリセットされ、上限が事実上効かなくなる
 *    (2026-08-06 ④ で一度踏んだ形)。**配信 ID が取れないときは数えられない**ので
 *    `0` を返す — この状態では 1 人 1 回の抑止(上の 6 時間の下限)が主な歯止めになる。
 */
export function countCommentPostsInStream(log: PostLog, streamId: string): number {
  if (!streamId) return 0
  return log.filter((entry) => entry.kind === 'comment' && entry.streamId === streamId).length
}

/**
 * **リダイレクト側の抑止に渡してよい履歴だけ**を残す (AC8)。
 *
 * `createDedupe` の `absorb` 側でも `comment` を弾いているが、**渡す側でも絞る。**
 * ここを絞らないと、コメント返しの記録がリダイレクト側のクールダウンを起動時から埋め、
 * 「コメント返し済みでもリダイレクト返礼はする」が壊れる。
 */
export function redirectHistory(log: PostLog): PostLog {
  return log.filter((entry) => entry.kind === 'redirect')
}

/** 壊れた保存内容で拡張ごと死なせない (AC6) */
export function normalizePostLog(raw: unknown): PostLog {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: PostLog = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { url, handle, text, postedAt, streamId, kind } = item as Partial<PostRecord>
    if (typeof url !== 'string' || !url.trim()) continue
    if (!Number.isFinite(postedAt)) continue
    const stream = typeof streamId === 'string' ? streamId : ''
    // **`'comment'` に完全一致したときだけ `comment`** (AC14)。欠損・enum 外・非文字列はすべて
    // `redirect` — 004 以前の記録はリダイレクト返礼しかなく、由来の分からない記録は
    // 「両方の投稿を止める」側へ倒すのが安全側
    const postKind: PostKind = kind === 'comment' ? 'comment' : 'redirect'
    const key = entryKey(stream, postKind, url)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      url: url.trim(),
      handle: typeof handle === 'string' && handle ? handle : handleFromChannelUrl(url.trim()),
      text: typeof text === 'string' ? text.slice(0, POST_LOG_MAX_TEXT_LENGTH) : '',
      postedAt: Number(postedAt),
      streamId: stream,
      kind: postKind,
    })
  }
  return out
}

// --- 保存 -----------------------------------------------------------------

export async function loadPostLog(): Promise<PostLog> {
  const area = getLocalStorageArea()
  if (!area) return []
  const stored = await area.get(STORAGE_KEY)
  return normalizePostLog(stored?.[STORAGE_KEY])
}

export async function savePostLog(log: PostLog): Promise<void> {
  const area = getLocalStorageArea()
  if (area) await area.set({ [STORAGE_KEY]: normalizePostLog(log) })
}

export async function clearPostLog(): Promise<void> {
  const area = getLocalStorageArea()
  if (area) await area.set({ [STORAGE_KEY]: [] })
}
