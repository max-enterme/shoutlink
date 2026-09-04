/**
 * 投稿履歴のローカル保存(再投稿の抑止)。
 *
 * ⚠️ **2026-08-06 の不具合: チャットを再読み込みすると同じ相手に何度も投稿していた。**
 *    リダイレクトの通知/バナーはチャット文書に残り続けるため、リロード後の初期走査
 *    (`detector.scanExisting`) がそれを「新しい通知」として拾い直す。
 *    抑止の記録がメモリ上にしか無く、文書のライフサイクルと一緒に消えるので、
 *    リロードのたびに抑止が白紙に戻っていた。
 *
 * → **投稿したら「誰に・何を・いつ・どの配信で」を残し、起動時に読み戻して
 *    抑止(同じ配信・同じ相手には 1 回)の初期値にする。**
 *
 * 記録するのは**実際に投稿できたとき**だけ。投稿に失敗した回は残さない
 * (残すと、投稿できていないのに抑止だけ効いてしまう)。
 *
 * 純関数と保存を分けてあり、純関数側だけが単体テストの対象(directory.ts と同じ作り)。
 */
import { getLocalStorageArea, getLocalStorageAreaName } from './config'
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
/**
 * これより古い記録は捨てる。配信は長くても数時間で終わり、配信 ID が空のときの窓も 6 時間なので 7 日あれば十分。
 * ⚠️ **配信 ID が取れている間の抑止には時間の上限が無い**ので、7 日を超えて同じ配信 ID が
 *    生き続ける常設配信では、この上限で記録が刈られて 2 回目の投稿が出る。
 */
export const POST_LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** 保存する文面の長さの上限(storage を無駄に食わないため) */
export const POST_LOG_MAX_TEXT_LENGTH = 500

/**
 * **配信 ID が取れないときだけ使う窓(6 時間)。**
 *
 * 配信を特定できないと「同じ配信か」が判断できず、履歴を捨てることも信じることもできない。
 * リダイレクトの通知は配信が終わるまで消えないので、時間で区切らないと
 * **チャットを開き直すたびに再投稿する**(2026-08-06 の不具合)。
 * 「返礼を 1 回取りこぼす」より「同じ相手に何度も投稿する」方が実害が大きいので、
 * 判定材料が無いときは長い方に倒す。
 */
export const UNKNOWN_STREAM_WINDOW_SEC = 6 * 60 * 60

/** URL の表記ゆれを吸収した鍵(directory と同じ考え方) */
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
 * 3. **取れなければ空文字** — 「同一配信」の判定を諦め、`UNKNOWN_STREAM_WINDOW_SEC` の窓だけで抑止する
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
 *    コメント返し(**2026-09-05 に件数の上限を撤廃したので、辞書でフラグを付けた人数ぶん出うる**)が
 *    **古いリダイレクト返礼の記録を押し出し**、
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
 * ⚠️ **種別を必須の引数にしてある。**種別をまたいで拾うと、コメント返しの記録を
 *    「前回のリダイレクト返礼」として扱ってしまう。
 *
 * `src` 側からは呼ばれていない(`main.ts` の切り分けログはもう投稿履歴を直接読んでいる)。
 * `tests/post-log.test.ts` が種別をまたがないことの固定として使っている。
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
 * **返礼を止める記録**を探す (001 / 004 / AC1 / AC2 / AC3 / AC7 / AC8)。
 *
 * 「同じ配信・同じ相手に 1 回」だけで判定する。**秒数は見ない** —
 * 設定値を抑止の逃げ道にする運用を持ち込まない。
 *
 * **どの種別の記録を抑止に数えるかは `blockedBy` で渡す**(004 / AC8 の非対称)。
 * リダイレクト側とコメント側で規則そのものは同じだが、数える記録が違う:
 *   - リダイレクト返礼 → `blockedBy: ['redirect']`(コメント返し済みでも投稿する。こちらが本命)
 *   - コメント返し → `blockedBy: ['redirect', 'comment']`(種別を問わず、同じ配信で 1 回)
 *
 * **配信 ID が取れないときは 6 時間の窓**(`UNKNOWN_STREAM_WINDOW_SEC` / AC2 / AC7)。
 * `findPostInStream` は `streamId` が空だと必ず `undefined` を返すため、
 * これが無いと配信 ID が取れない側の抑止が丸ごと外れる。
 */
export function findReplyBlocker(
  log: PostLog,
  params: { streamId: string; url: string; now: number; blockedBy: readonly PostKind[] },
): PostRecord | undefined {
  const key = postLogKey(params.url)
  const sameChannel = log.filter(
    (entry) => postLogKey(entry.url) === key && params.blockedBy.includes(entry.kind),
  )
  const floorMs = UNKNOWN_STREAM_WINDOW_SEC * 1000
  const withinFloor = (entry: PostRecord): boolean => params.now - entry.postedAt < floorMs

  if (params.streamId) {
    return sameChannel.find(
      (entry) =>
        entry.streamId === params.streamId ||
        // **配信 ID が空のまま残った記録も 6 時間は見る。**
        // 管制室の埋め込みチャット(ID が取れない)で投稿 → ポップアウトを開き直す
        // (ID が取れる)と、**同じ配信・同じ相手に 2 回目が出る。**
        // 取りこぼすより二重投稿を避ける(AC2)
        (entry.streamId === '' && withinFloor(entry)),
    )
  }
  return sameChannel.find(withinFloor)
}

/** リダイレクト返礼の抑止 (AC1)。数えるのはリダイレクト返礼の記録だけ(AC3: 非対称の後半) */
export function findRedirectReplyBlocker(
  log: PostLog,
  params: { streamId: string; url: string; now: number },
): PostRecord | undefined {
  return findReplyBlocker(log, { ...params, blockedBy: ['redirect'] })
}

/** コメント返しの抑止 (004 / AC7 / AC8)。種別を問わず数える(非対称の前半) */
export function findCommentReplyBlocker(
  log: PostLog,
  params: { streamId: string; url: string; now: number },
): PostRecord | undefined {
  return findReplyBlocker(log, { ...params, blockedBy: ['redirect', 'comment'] })
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

/**
 * 「履歴を消す」の書き込みか (AC14)。**空配列に変わったときだけ true**。
 *
 * `chrome.storage.onChanged` は自分の書き込みでも発火する。投稿するたびに `next.length` は
 * 増える一方なので、「空になった」ときだけを「消された」と判定すれば、自分の投稿での発火と
 * 区別できる(`main.ts` が `selfEcho.reset()` を呼ぶかどうかの判定に使う)。
 */
export function isPostLogCleared(next: PostLog): boolean {
  return next.length === 0
}

/**
 * 投稿履歴の変更の購読(`directory.ts` の `onDirectoryChanged` と同型 / AC14)。
 * 戻り値を呼ぶと解除する。
 *
 * **「履歴を消す」を再読み込みなしで届けるための土台。** 抑止の正本を `postLog` の 1 本に
 * 寄せたので(plan.md「アプローチ」)、これを購読するだけで `main.ts` 側の抑止が解ける。
 */
export function onPostLogChanged(handler: (log: PostLog) => void): () => void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {}
  // 実際に使っているエリアだけを見る(directory.ts と同じ理由)
  const areaName = getLocalStorageAreaName()

  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    changedArea: string,
  ): void => {
    if (areaName && changedArea !== areaName) return
    const change = changes[STORAGE_KEY]
    if (change) handler(normalizePostLog(change.newValue))
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}
