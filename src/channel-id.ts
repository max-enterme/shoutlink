/**
 * チャンネルページから `UC…`(チャンネル ID)を解決する (004 / AC17)。
 *
 * **なぜ要るか**: コメントから取れる投稿者の ID は `UC…` 形だが、辞書の鍵は `@handle` 形で
 * 文字列比較が一致しない。**照合専用のフィールド `DirectoryEntry.channelId` を埋めるため**に、
 * 登録されている URL のページを 1 回だけ取得して `UC…` を取り出す。
 *
 * ⚠️ **呼ぶのは設定画面だけ。**ライブチャットの画面(content script)からは呼ばない。
 *    配信中にネットワークを走らせない (AC17)。
 *
 * ⚠️ **間違った ID を返すと、別人のコメントに反応して別人のリンクを貼る。**
 *    `findEntryByChannelId` は文字列一致なので、ここが 1 文字違えば「誰にも当たらない」で済むが、
 *    **別の実在チャンネルの ID を返すと当たってしまう。**チャンネルページには
 *    関連チャンネル・動画の投稿者など**他人の `UC…` が大量に載っている**ので、
 *    「最初に見つかった `UC…`」を採ってはいけない。
 *    → **ページ全体を表す metadata だけを見て、複数の出所が食い違ったら失敗にする**(下記)。
 */
import { CHANNEL_ID_PATTERN } from './directory'

/**
 * 取得のタイムアウト (AC17)。
 *
 * ⚠️ **無いと「失敗しても理由を画面に出す」が満たせない。**応答が返らないと
 *    `resolved` にも `failed` にもならず、設定画面が待ち続ける。
 */
export const CHANNEL_PAGE_TIMEOUT_MS = 15_000

/**
 * **YouTube のチャンネル URL であることを確かめてから解析する。**
 *
 * ⚠️ **これが無いと、辞書の 1 行が任意のホストの任意の `UC…` に結びつく。**
 *    `normalizeChannelUrl` は `https://www.youtube.com/...` しか作らないが、
 *    `normalizeDirectory` は `url` を「空でない文字列」としか検査していないので、
 *    **壊れた / 手で編集された保存内容は素通りする。**
 *    成立すると **その ID の人のコメントに反応して辞書の URL を貼る** —
 *    このモジュールが唯一防ごうとしている事故そのものになる。
 *    `host_permissions` は歯止めにならない(CORS を許すサーバは拡張ページから読める)。
 *
 * `normalizeChannelUrl` ([detector.ts](./detector.ts))が**ホストを `youtube.com` に限り、
 * パスを先頭に固定している**のと同じ強さにそろえる。
 */
function parseYouTubeUrl(url: string): URL | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  // `normalizeChannelUrl` が作るのは常に `www.youtube.com`
  if (parsed.hostname !== 'www.youtube.com') return null
  return parsed
}

export type ChannelIdResult =
  | { status: 'resolved'; channelId: string }
  /** URL 自体が `/channel/UC…` 形だった。取得していない */
  | { status: 'already'; channelId: string }
  | { status: 'failed'; reason: string }

/**
 * **ページを表す metadata** から `UC…` を拾う候補。
 *
 * ここに置いてよいのは「**そのページのチャンネル自身**を指すと分かっているもの」だけ。
 * `"channelId":"UC…"` のような汎用のキーは、関連チャンネルや動画の投稿者にも付くので**入れない。**
 */
const ID_SOURCES: readonly { name: string; pattern: RegExp }[] = [
  {
    name: 'canonical',
    pattern: /<link[^>]+rel=["']canonical["'][^>]+href=["'][^"']*\/channel\/(UC[\w-]{20,})["']/i,
  },
  {
    name: 'og:url',
    pattern: /<meta[^>]+property=["']og:url["'][^>]+content=["'][^"']*\/channel\/(UC[\w-]{20,})["']/i,
  },
  {
    name: 'itemprop:identifier',
    pattern: /<meta[^>]+itemprop=["']identifier["'][^>]+content=["'](UC[\w-]{20,})["']/i,
  },
  {
    name: 'externalId',
    pattern: /"externalId"\s*:\s*"(UC[\w-]{20,})"/,
  },
]

export type ExtractResult =
  | { ok: true; channelId: string; sources: string[] }
  | { ok: false; reason: string; sources: string[] }

/**
 * チャンネルページの HTML から `UC…` を取り出す**純関数**。
 *
 * - 見つかった出所が**すべて同じ ID**なら、それを返す
 * - **食い違ったら失敗**(`候補が複数`)。どちらが正しいか決められないので、
 *   推測で選ばず空のままにする(AC17: 空なら照合の対象外になるだけ)
 * - 1 つも見つからなければ失敗
 */
export function extractChannelId(html: string): ExtractResult {
  const sources: string[] = []
  const ids = new Set<string>()
  for (const source of ID_SOURCES) {
    // **最初の 1 件だけ見ない。**同じキーが 2 回出て値が違うなら、それも「食い違い」として
    // 失敗させる(安全側にしか動かない)
    const matches = [...html.matchAll(new RegExp(source.pattern, 'g'))]
    if (matches.length === 0) continue
    sources.push(matches.length > 1 ? `${source.name}×${matches.length}` : source.name)
    for (const match of matches) ids.add(match[1])
  }

  if (ids.size === 0) return { ok: false, reason: 'ページにチャンネル ID が見つからない', sources }
  if (ids.size > 1) {
    return { ok: false, reason: `候補が複数あって決められない (${sources.join(', ')})`, sources }
  }
  return { ok: true, channelId: [...ids][0], sources }
}

/**
 * URL が `https://www.youtube.com/channel/UC…` 形なら、取得せずにその場で ID が決まる (AC17)。
 *
 * **パスの先頭に固定する。**`?r=/channel/UC…` のようにクエリへ紛れ込んだものを拾わない。
 */
export function channelIdFromUrl(url: string): string | null {
  const parsed = parseYouTubeUrl(url)
  if (!parsed) return null
  const match = parsed.pathname.match(/^\/channel\/(UC[\w-]{20,})(?:\/|$)/)
  return match && CHANNEL_ID_PATTERN.test(match[1]) ? match[1] : null
}

export type ResolveOptions = {
  /** 差し替え可能にしてテストでネットワークに触らない */
  fetchImpl?: typeof fetch
  /** 既定は `CHANNEL_PAGE_TIMEOUT_MS` */
  timeoutMs?: number
}

/** `AbortSignal.timeout` が無い環境では諦める(タイムアウト無しで動かす) */
function makeTimeoutSignal(ms: number): AbortSignal | undefined {
  try {
    return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(ms)
      : undefined
  } catch {
    return undefined
  }
}

/**
 * 辞書エントリの URL から `channelId` を解決する。
 *
 * **例外を投げない。**失敗は `{ status: 'failed', reason }` で返す — 呼び出し側(設定画面)が
 * 理由をそのまま画面に出せるようにするため。**握って空配列を返すと「なぜ空なのか」が消える。**
 */
export async function resolveChannelId(
  url: string,
  options: ResolveOptions = {},
): Promise<ChannelIdResult> {
  // **YouTube のチャンネル URL でなければ、取りに行きもしない**(上記 `parseYouTubeUrl`)
  if (!parseYouTubeUrl(url)) {
    return { status: 'failed', reason: 'YouTube のチャンネル URL ではない' }
  }

  const direct = channelIdFromUrl(url)
  if (direct) return { status: 'already', channelId: direct }

  const doFetch = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : null)
  if (!doFetch) return { status: 'failed', reason: 'fetch が使えない環境' }

  let html: string
  try {
    const response = await doFetch(url, {
      credentials: 'omit',
      redirect: 'follow',
      signal: makeTimeoutSignal(options.timeoutMs ?? CHANNEL_PAGE_TIMEOUT_MS),
    })
    if (!response.ok) {
      return { status: 'failed', reason: `取得に失敗した (HTTP ${response.status})` }
    }
    // ⚠️ **途中で切らない。**実測(2026-08-15)でチャンネルページは 1.3〜1.9 MB あり、
    //    `<head>` の metadata は先頭ではなく **約 733 KB 地点**、`externalId` に至っては
    //    **1.89 MB 地点**に出た。上限で切ると**出所が黙って減り、相互照合が弱る。**
    html = await response.text()
  } catch (err) {
    return { status: 'failed', reason: `取得に失敗した (${String(err)})` }
  }

  const extracted = extractChannelId(html)
  if (!extracted.ok) return { status: 'failed', reason: extracted.reason }
  return { status: 'resolved', channelId: extracted.channelId }
}
