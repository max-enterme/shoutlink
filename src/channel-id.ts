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
import { CHANNEL_ID_PATTERN, MAX_CHANNEL_NAME_LENGTH, MAX_ICON_DATA_URL_LENGTH } from './directory'

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

/** アイコンを取りに行ってよいホスト。**og:image が指す先を無検査で fetch しない** —
 *  壊れた / 手で編集された HTML が任意のホストを指しうる(`parseYouTubeUrl` と同じ考え方)。
 *  **実測(2026-09-10)で確認できたのは `yt3.googleusercontent.com` の 1 つだけなので、
 *  ここに推測でホストを足さない。** 別のホストが返るようになったら `ok: false` になって
 *  アイコンが出なくなるだけで機能は壊れない(→ plan.md リスク / 降りる箇所) */
const ICON_HOSTS = ['yt3.googleusercontent.com'] as const

function isAllowedIconUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return (
    parsed.protocol === 'https:' &&
    (ICON_HOSTS as readonly string[]).includes(parsed.hostname)
  )
}

/** `extractChannelName` が拾う実体参照。表記名に頻出するものだけに絞る */
const HTML_ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&lt;': '<',
  '&gt;': '>',
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&amp;|&quot;|&#39;|&lt;|&gt;/g, (entity) => HTML_ENTITIES[entity])
}

/**
 * チャンネルページの HTML から `og:title`(= チャンネルの表記名)を取り出す純関数。
 * **例外は投げない。**取れなければ空文字。
 *
 * `extractChannelId` の「複数の出所を突き合わせて食い違ったら失敗」はやらない —
 * **誤った表示名が出ても「違う名前が出る」だけで、誤った `UC…` のような実害が無い**
 * (`extractChannelIconUrl` と同じ理由)。`og:title` の 1 本で決める。
 */
export function extractChannelName(html: string): string {
  const match = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
  if (!match) return ''
  const decoded = decodeHtmlEntities(match[1])
  return Array.from(decoded).length > MAX_CHANNEL_NAME_LENGTH ? '' : decoded
}

export type IconExtractResult = { ok: true; url: string } | { ok: false; reason: string }

/**
 * チャンネルページの HTML から `og:image` の URL を取り出す純関数。
 * **`extractChannelId` の「複数の出所を突き合わせて食い違ったら失敗」はやらない** —
 * 誤ったアイコンが出ても「違う画像が出る」だけで、誤った `UC…` のような実害が無い。
 * ホストが `ICON_HOSTS` に無ければ `ok: false`。
 */
export function extractChannelIconUrl(html: string): IconExtractResult {
  const match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
  if (!match) return { ok: false, reason: 'ページに og:image が見つからない' }
  const url = match[1]
  if (!isAllowedIconUrl(url)) return { ok: false, reason: '許可していないホストの画像' }
  return { ok: true, url }
}

/**
 * googleusercontent の URL のサイズ指定を差し替える純関数。
 * `…=s900-c-k-c0x00ffffff-no-rj` → `…=s88-c-k-c0x00ffffff-no-rj`。
 * **パターンに合わなければ元の URL をそのまま返す**(取得を諦めない。大きすぎれば
 * `fetchIconAsDataUrl` の上限で弾かれる)。
 */
export function iconUrlAtSize(url: string, size: number): string {
  return /=s\d+-/.test(url) ? url.replace(/=s\d+-/, `=s${size}-`) : url
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
 *
 * ⚠️ **`resolveChannelPage` の薄いラッパ (F12)。**取得部(`parseYouTubeUrl` → fetch →
 *    `!response.ok` → `text()`)と結果組み立てが `resolveChannelPage` と丸ごと重複していたため、
 *    `resolveChannelId(url, o)` は `(await resolveChannelPage(url, { channelId: true, icon: false }, o)).channelId`
 *    と等価な形に寄せてある。`want.channelId` が true のとき `resolveChannelPage` は必ず
 *    `channelId` を返す(null にならない)ので、`??` の右側は理論上通らない安全弁。
 */
export async function resolveChannelId(
  url: string,
  options: ResolveOptions = {},
): Promise<ChannelIdResult> {
  const { channelId } = await resolveChannelPage(url, { channelId: true, icon: false }, options)
  return channelId ?? { status: 'failed', reason: 'YouTube のチャンネル URL ではない' }
}

/**
 * `fetchIconAsDataUrl` が上限を指定しなかったときの既定値。
 *
 * ⚠️ **`directory.ts` の `MAX_ICON_DATA_URL_LENGTH`(保存できる data URL の上限 = 64KB)から逆算する。**
 *    以前は画像の実測(5,219 バイト)に余裕を見ただけの 1MB を既定にしていたが、それだと
 *    49,135〜1,048,576 バイトの画像が「取得は成功 (`ok: true`)」を返しつつ、保存直前の
 *    `normalizeDirectory` に 64KB 超として黙って空文字へ落とされていた(F8)。
 *    ここで保存できる上限に合わせておけば、収まらない画像は**取得の時点で**理由付きの失敗になる。
 */
const DEFAULT_ICON_MAX_BYTES = Math.floor((MAX_ICON_DATA_URL_LENGTH - 64) / 4) * 3

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export type IconDataUrlResult = { ok: true; dataUrl: string } | { ok: false; reason: string }

/**
 * 画像 URL を取得して data URL にする。**例外を投げない**(`resolveChannelId` と同じ規約)。
 * `Content-Length` か実バイト数が `maxBytes` を超えたら失敗として返す —
 * **切り詰めて壊れた画像を保存しない**(`validateEntryMessage` と同じ思想)。
 */
export async function fetchIconAsDataUrl(
  imageUrl: string,
  options: ResolveOptions & { maxBytes?: number } = {},
): Promise<IconDataUrlResult> {
  const doFetch = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : null)
  if (!doFetch) return { ok: false, reason: 'fetch が使えない環境' }
  const maxBytes = options.maxBytes ?? DEFAULT_ICON_MAX_BYTES

  let response: Response
  try {
    response = await doFetch(imageUrl, {
      credentials: 'omit',
      redirect: 'follow',
      signal: makeTimeoutSignal(options.timeoutMs ?? CHANNEL_PAGE_TIMEOUT_MS),
    })
  } catch (err) {
    return { ok: false, reason: `取得に失敗した (${String(err)})` }
  }
  if (!response.ok) return { ok: false, reason: `取得に失敗した (HTTP ${response.status})` }

  const contentLength = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { ok: false, reason: `画像が大きすぎる (${contentLength} バイト)` }
  }

  let buffer: ArrayBuffer
  try {
    buffer = await response.arrayBuffer()
  } catch (err) {
    return { ok: false, reason: `取得に失敗した (${String(err)})` }
  }
  if (buffer.byteLength > maxBytes) {
    return { ok: false, reason: `画像が大きすぎる (${buffer.byteLength} バイト)` }
  }
  // **0 バイト応答も成功にしない (F13)。** `btoa('') = ''` なので、無検査だと
  // `data:image/jpeg;base64,` という壊れた画像が `ok: true` のまま保存され、
  // 空でないので再取得の対象にもならず居座り続ける
  if (buffer.byteLength === 0) {
    return { ok: false, reason: '画像が 0 バイトだった' }
  }

  // **content-type を検査する (F13)。** 無検査で埋めると、200 で返る HTML のエラーページまで
  // `ok: true` として保存し、読み戻しの `startsWith('data:image/')` で落ちて無言で消える(F8 と同じ穴)
  const contentType = response.headers?.get?.('content-type') ?? ''
  if (!contentType.startsWith('image/')) {
    return { ok: false, reason: `画像ではないレスポンス (${contentType || '不明'})` }
  }

  const dataUrl = `data:${contentType};base64,${arrayBufferToBase64(buffer)}`
  // **生成した data URL の長さも、保存できる上限と突き合わせる (F8)。**
  // `maxBytes` の既定値は `MAX_ICON_DATA_URL_LENGTH` から逆算してあるので通常はここに来ないが、
  // 呼び出し側が `maxBytes` を明示的に大きく指定した場合や、content-type が長い場合の保険にする
  if (dataUrl.length > MAX_ICON_DATA_URL_LENGTH) {
    return { ok: false, reason: `保存できる大きさを超えている (${dataUrl.length} 文字)` }
  }
  return { ok: true, dataUrl }
}

export type ChannelIconResult =
  | { status: 'resolved'; dataUrl: string }
  | { status: 'failed'; reason: string }

function toChannelIdResult(extracted: ExtractResult): ChannelIdResult {
  return extracted.ok
    ? { status: 'resolved', channelId: extracted.channelId }
    : { status: 'failed', reason: extracted.reason }
}

async function resolveIconFromHtml(
  html: string,
  options: ResolveOptions & { maxBytes?: number },
): Promise<ChannelIconResult> {
  const extracted = extractChannelIconUrl(html)
  if (!extracted.ok) return { status: 'failed', reason: extracted.reason }
  const sized = iconUrlAtSize(extracted.url, 88)
  const result = await fetchIconAsDataUrl(sized, options)
  return result.ok ? { status: 'resolved', dataUrl: result.dataUrl } : { status: 'failed', reason: result.reason }
}

/**
 * **チャンネルページを 1 回だけ取って、要求されたものを両方返す。**
 * 片方が失敗しても、もう片方は成功のまま返す(AC19)。
 *
 * HTML を取りに行くかどうかは plan.md「新規インターフェース」の擬似コードのとおり:
 * `idFromUrl` は `want.channelId` のときだけ `channelIdFromUrl(url)` で決め、
 * `(want.channelId && idFromUrl === null) || want.icon` が true のときだけ 1 回 fetch する。
 * **`want.icon` が true なら、URL が `/channel/UC…` 形でも必ず fetch する**(アイコンは
 * URL からは分からない / AC20)。
 *
 * ⚠️ **表記名(`name`)は `want` に無い。**アイコンと**同じ HTML から追加コスト 0 で取れる**ので、
 *    「取りに行くかどうか」の判断対象にしない — **HTML を取ったなら常に返す。**
 *    HTML を取らなかった経路(URL から即決/取得しない判断)では空文字のまま (007)。
 */
export async function resolveChannelPage(
  url: string,
  want: { channelId: boolean; icon: boolean },
  options: ResolveOptions & { maxBytes?: number } = {},
): Promise<{ channelId: ChannelIdResult | null; icon: ChannelIconResult | null; name: string }> {
  if (!parseYouTubeUrl(url)) {
    const reason = 'YouTube のチャンネル URL ではない'
    return {
      channelId: want.channelId ? { status: 'failed', reason } : null,
      icon: want.icon ? { status: 'failed', reason } : null,
      name: '',
    }
  }

  const idFromUrl = want.channelId ? channelIdFromUrl(url) : null
  const needsFetch = (want.channelId && idFromUrl === null) || want.icon
  if (!needsFetch) {
    return {
      channelId: idFromUrl ? { status: 'already', channelId: idFromUrl } : null,
      icon: null,
      name: '',
    }
  }

  const doFetch = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : null)
  if (!doFetch) {
    const reason = 'fetch が使えない環境'
    return {
      channelId: want.channelId
        ? idFromUrl
          ? { status: 'already', channelId: idFromUrl }
          : { status: 'failed', reason }
        : null,
      icon: want.icon ? { status: 'failed', reason } : null,
      name: '',
    }
  }

  let html: string
  try {
    const response = await doFetch(url, {
      credentials: 'omit',
      redirect: 'follow',
      signal: makeTimeoutSignal(options.timeoutMs ?? CHANNEL_PAGE_TIMEOUT_MS),
    })
    if (!response.ok) {
      const reason = `取得に失敗した (HTTP ${response.status})`
      return {
        channelId: want.channelId
          ? idFromUrl
            ? { status: 'already', channelId: idFromUrl }
            : { status: 'failed', reason }
          : null,
        icon: want.icon ? { status: 'failed', reason } : null,
        name: '',
      }
    }
    // resolveChannelId と同じく途中で切らない(上記コメント参照)
    html = await response.text()
  } catch (err) {
    const reason = `取得に失敗した (${String(err)})`
    return {
      channelId: want.channelId
        ? idFromUrl
          ? { status: 'already', channelId: idFromUrl }
          : { status: 'failed', reason }
        : null,
      icon: want.icon ? { status: 'failed', reason } : null,
      name: '',
    }
  }

  const channelId = want.channelId
    ? idFromUrl
      ? ({ status: 'already', channelId: idFromUrl } as ChannelIdResult)
      : toChannelIdResult(extractChannelId(html))
    : null
  const icon = want.icon ? await resolveIconFromHtml(html, options) : null
  // HTML を取ったので、want に関わらず常に表記名も返す(上のコメント参照)
  const name = extractChannelName(html)

  return { channelId, icon, name }
}
