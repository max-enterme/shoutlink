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
import { MAX_ENTRY_MESSAGE_LENGTH } from './composer'
import { getLocalStorageArea, getLocalStorageAreaName, getStorageArea } from './config'
import { handleFromChannelUrl } from './detector'
import { log } from './log'
import type { RedirectEvent } from './types'

export type DirectoryEntry = {
  /** 正規化済みチャンネル URL。同一性の鍵 */
  url: string
  /** 置き換える呼び名。**空文字は「未設定」** */
  nickname: string
  /**
   * **リダイレクト返礼用**の自由文。**空文字は「未設定」**。自動登録では付けない。
   *
   * 用途を名前で限定してあるのは、004(コメント返し)が 2 本目の自由文を足す前提のため。
   * どちらがどちらか読んで分かる形にしておく。
   */
  message: string
  /**
   * **この人のコメントに反応するか** (004 / AC2)。
   *
   * **既定は false。**リダイレクト受信による自動登録 (`rememberSource`) でも false のままで、
   * 人が設定画面で明示的に付けたときだけ true になる。辞書は「リダイレクトを受けた相手」が
   * 自動で載る名簿でもあるので、載った=反応する にすると**登録した覚えのない相手に反応する。**
   */
  replyToComment: boolean
  /**
   * **コメント返し用**の自由文 (004 / AC16 / spec.md D4)。**空文字は「未設定」**。
   *
   * 上の `message`(リダイレクト返礼用)とは**別のフィールド**。同じ自由文を両方に出すと、
   * 「リダイレクトを受けたときに宛てて書いた一文」がただのコメントに対して出る。
   * 差し込み先も別で、こちらは `Config.commentTemplate` の `{msg}` に入る。
   */
  commentMessage: string
  /** 最後にリダイレクトを受けた時刻。0 は「まだ受けていない」(手動登録) */
  lastSeenAt: number
}

export type Directory = DirectoryEntry[]

const STORAGE_KEY = 'ytRedirectPin.directory'
/**
 * `sync` → `local` の移行済みフラグ(`local` に置く / AC5)。
 * キーの有無だけで判定すると「`loadDirectory` より先に設定画面で 1 件登録 → 以後 `sync` を
 * 永久に引き継げない」経路が残るため、フラグで「1 度きり」を保証する。
 */
const MIGRATED_KEY = 'ytRedirectPin.directoryMigratedAt'

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
 * 文面に差し込む自由文を決める(`resolveDisplayName` と同じ形)。
 * 登録が無い・空白だけなら**空文字**。`{msg}` をどう畳むかは composer 側の役目。
 */
export function resolveMessage(directory: Directory, event: RedirectEvent): string {
  return findEntry(directory, event.sourceChannelUrl)?.message.trim() ?? ''
}

/**
 * **コメント返し**に差し込む自由文を決める (004 / AC16)。
 *
 * `resolveMessage` と対になる別関数で、**引数が URL なのは意図的** —
 * コメント経路には `RedirectEvent` が無い(リダイレクトを受けていないので作れない)。
 *
 * ⚠️ **`resolveMessage` にフラグ引数を足して分岐させない。**どちらの自由文を使うかは
 *    呼び出し側(経路)が知っていることで、辞書側が条件分岐で覚えることではない (plan.md 3.)。
 */
export function resolveCommentMessage(directory: Directory, url: string): string {
  return findEntry(directory, url)?.commentMessage.trim() ?? ''
}

/**
 * **コメント返し**に差し込む呼び名を決める (004 / AC5)。
 *
 * ⚠️ **`resolveDisplayName` を使い回してはいけない。**あれは呼び名が空のとき
 *    `event.sourceChannelName` に落ちる。コメント経路でそれに相当するのは
 *    **コメント側の表示名**(第三者が自由に決める文字列)で、それを配信者名義の投稿に載せると
 *    AC5 が静かに破れる。ここは**辞書に入っている値だけ**で決める:
 *    呼び名 → 無ければ**辞書の URL から作ったハンドル**。
 */
export function resolveCommentDisplayName(directory: Directory, url: string): string {
  const entry = findEntry(directory, url)
  const nickname = entry?.nickname.trim()
  if (nickname) return nickname
  return handleFromChannelUrl(entry?.url ?? url)
}

/**
 * 新しい行の**既定値**。
 *
 * 行を作る場所が 4 つ(自動登録・呼び名・自由文 2 種・フラグ)あるので 1 か所に寄せる。
 * **フィールドを足したときに一部の経路だけ古い形の行を作る**のを防ぐ
 * (`normalizeDirectory` が埋めるので実害は出にくいが、既定値が 2 種類あることになる)。
 */
function blankEntry(url: string, patch: Partial<DirectoryEntry> = {}): DirectoryEntry {
  return {
    url,
    nickname: '',
    message: '',
    // **どちらも「人が明示的に設定したときだけ入る」側**なので、行の生成時は必ず既定 (AC2 / AC16)
    replyToComment: false,
    commentMessage: '',
    lastSeenAt: 0,
    ...patch,
  }
}

/**
 * リダイレクトしてきた相手を辞書に載せる(既にあれば `lastSeenAt` を更新)。
 * **ニックネームは付けない。**後から人が付ける前提。
 *
 * ⚠️ **`replyToComment` も付けない (AC2)。**ここは「リダイレクトを受けた相手」が自動で載る経路で、
 *    載ったことと「コメントに反応してよい」は別。自動で true にすると、**登録した覚えのない相手の
 *    コメントに反応する。**
 */
export function rememberSource(directory: Directory, event: RedirectEvent): Directory {
  const key = directoryKey(event.sourceChannelUrl)
  const existing = directory.find((entry) => directoryKey(entry.url) === key)
  if (existing) {
    return directory.map((entry) =>
      entry === existing ? { ...entry, lastSeenAt: event.detectedAt } : entry,
    )
  }
  // 自由文も付けない(呼び名と同じく、後から人が書く前提)
  return [...directory, blankEntry(event.sourceChannelUrl, { lastSeenAt: event.detectedAt })]
}

/** 手動登録・呼び名の変更 */
export function upsertNickname(directory: Directory, url: string, nickname: string): Directory {
  const key = directoryKey(url)
  const existing = directory.find((entry) => directoryKey(entry.url) === key)
  if (existing) {
    return directory.map((entry) => (entry === existing ? { ...entry, nickname } : entry))
  }
  return [...directory, blankEntry(url, { nickname })]
}

/**
 * 自由文の変更(`upsertNickname` と同じ形)。登録が無ければ**呼び名は空のまま**行を作る。
 *
 * **切り詰めはここでしない。**上限超過は設定画面が保存前に弾いて理由を出す (AC6)。
 * ここで黙って詰めると、書いた本人が消えた部分に気づけない。
 */
export function upsertMessage(directory: Directory, url: string, message: string): Directory {
  const key = directoryKey(url)
  const existing = directory.find((entry) => directoryKey(entry.url) === key)
  if (existing) {
    return directory.map((entry) => (entry === existing ? { ...entry, message } : entry))
  }
  return [...directory, blankEntry(url, { message })]
}

/**
 * **コメント返し用**の自由文の変更(`upsertMessage` と同じ形 / AC16)。
 * 003 の `message` には触らない。切り詰めをここでしないのも同じ理由(設定画面が保存前に弾く)。
 */
export function upsertCommentMessage(
  directory: Directory,
  url: string,
  commentMessage: string,
): Directory {
  const key = directoryKey(url)
  const existing = directory.find((entry) => directoryKey(entry.url) === key)
  if (existing) {
    return directory.map((entry) => (entry === existing ? { ...entry, commentMessage } : entry))
  }
  return [...directory, blankEntry(url, { commentMessage })]
}

/**
 * 「コメントに反応する」フラグの切り替え (AC2 / AC13)。
 *
 * 辞書に無い URL を ON にしたときは行を作る(設定画面から直接登録できる経路)。
 * **`upsertNickname` と同じ形**にしてあるのは、行編集で即保存する UI が両方を同じに扱うため。
 */
export function setReplyToComment(directory: Directory, url: string, value: boolean): Directory {
  const key = directoryKey(url)
  const existing = directory.find((entry) => directoryKey(entry.url) === key)
  if (existing) {
    return directory.map((entry) => (entry === existing ? { ...entry, replyToComment: value } : entry))
  }
  return [...directory, blankEntry(url, { replyToComment: value })]
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

/**
 * 保存済みの自由文を上限まで切り詰める (AC6 の正規化側)。
 *
 * **数える単位はコードポイント**(`Array.from`)。`String.prototype.length` で数えると
 * 絵文字が 2 と数えられ、**設定画面が通した入力が保存時に黙って半分に切られる。**
 * composer 側の削り (AC4) も `Array.from` と定められているので、単位をそちらへそろえる。
 * 結果としてサロゲートペアも割れない(壊れた文字 U+FFFD を作らない)。
 */
function clampMessage(value: string): string {
  const chars = Array.from(value)
  if (chars.length <= MAX_ENTRY_MESSAGE_LENGTH) return value
  return chars.slice(0, MAX_ENTRY_MESSAGE_LENGTH).join('')
}

/** 壊れた保存内容で拡張ごと死なせない (AC6 / AC10) */
export function normalizeDirectory(raw: unknown): Directory {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Directory = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { url, nickname, message, replyToComment, commentMessage, lastSeenAt } =
      item as Partial<DirectoryEntry>
    if (typeof url !== 'string' || !url.trim()) continue
    const key = directoryKey(url)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      url: url.trim(),
      nickname: typeof nickname === 'string' ? nickname : '',
      // 003 より前に保存された辞書には message が無い。欠損・非文字列は空文字で埋める
      message: typeof message === 'string' ? clampMessage(message) : '',
      // **真偽値でないものは false**(AC2 / AC14)。004 より前の辞書にはこのキーが無く、
      // 「壊れていたら反応しない」側へ倒すのが安全側
      replyToComment: replyToComment === true,
      // 自由文の正規化は 003 と同じ規則を再利用する(欠損・非文字列は '' / 上限超は切り詰め / AC16)
      commentMessage: typeof commentMessage === 'string' ? clampMessage(commentMessage) : '',
      lastSeenAt: Number.isFinite(lastSeenAt) ? Number(lastSeenAt) : 0,
    })
  }
  return out
}

// --- 保存 -----------------------------------------------------------------
//
// **保存先は `chrome.storage.local`** (T1 / AC5 / security-review.md S7)。
// `sync` は 1 アイテム 8KB 上限で、辞書は配列まるごと 1 アイテムなので、自由文が加わると
// 数十件で頭打ちになる。超えると `set` が reject し、`guardAsync` が握るため
// **コンソールに 1 行出るだけで以後の登録が保存されない。**
// 代償として**端末間で同期されなくなる**(配信は 1 台で回す前提。投稿履歴と同じ判断)。

/**
 * `sync` → `local` の移行の結果。**どちらの入口から走っても必ず 1 行ログに出す** (plan.md R3)。
 * ログは `migrateDirectoryToLocal` の中で出す — 辞書はチャット (`main.ts`) と設定画面
 * (`options.ts`) の両方から読まれ、**設定画面を先に開けば移行はそちらで走る**ため。
 * 呼び出し側に任せると、その経路だけ無言になる。
 */
export type DirectoryMigration = {
  status: 'migrated' | 'skipped' | 'failed'
  /** 引き継いだ件数(`migrated` のときだけ意味を持つ) */
  count: number
  /** なぜその結果になったか。切り分け用にそのままログへ出す */
  reason: string
}

/**
 * 辞書を `sync` から `local` へ**1 度だけ**引き継ぐ (AC5)。
 *
 * - **`local` にキーが存在しないときだけ**引き継ぐ。**「空配列かどうか」で判定しない** —
 *   それだと利用者が設定画面で全件削除した(`local` に `[]` が入った)次の起動で
 *   `sync` の古い辞書が丸ごと復活し、「もう残したくない相手を消した」意図が無言で覆る。
 * - **`sync` 側のキーは消さない**(片方向コピー)。消すと、まだ移行していない別 PC の
 *   Chrome から辞書が消えて復元できない。
 * - **例外を投げない。** 呼び出し側の `guardAsync` に握らせると空配列になり、
 *   「辞書が消えた」ようにしか見えないため、失敗も結果として返す。
 * - **結果は必ずログに 1 行出す**(下の `logMigration`)。呼ぶのは `loadDirectory` で、
 *   チャットと設定ページの両方が通るため、どちらの入口から走っても同じ 1 行が出る。
 *   **`main.ts` 側で出さない**(二重に出る)。
 *   例外は `loadDirectory` が `chrome.storage` 無しで早期 return する場合 — 拡張として
 *   成立していない状態なので、`loadConfig` が黙って既定値を返すのと同じ扱いにしてある。
 */
export async function migrateDirectoryToLocal(): Promise<DirectoryMigration> {
  const result = await runMigration()
  logMigration(result)
  return result
}

async function runMigration(): Promise<DirectoryMigration> {
  const local = getLocalStorageArea()
  const legacy = getStorageArea()
  if (!local) return { status: 'skipped', count: 0, reason: 'chrome.storage が無い' }
  // `local` が無い環境では両方が `sync` に落ちる。その場合は移行するものが無い
  if (!legacy || legacy === local) {
    return { status: 'skipped', count: 0, reason: '移行元と移行先が同じエリア' }
  }

  try {
    const stored = await local.get([STORAGE_KEY, MIGRATED_KEY])
    if (stored?.[STORAGE_KEY] !== undefined) {
      return { status: 'skipped', count: 0, reason: '既に local に辞書がある' }
    }
    if (stored?.[MIGRATED_KEY] !== undefined) {
      return { status: 'skipped', count: 0, reason: '移行済み(引き継ぎは 1 度きり)' }
    }

    const source = normalizeDirectory((await legacy.get(STORAGE_KEY))?.[STORAGE_KEY])
    await local.set({ [STORAGE_KEY]: source })

    // **フラグは辞書の書き込みが成功した後にだけ立てる。** 先に立てて辞書の書き込みが失敗すると、
    // `sync` に呼び名が残っているのに二度と取り込まれず、設定画面に再移行の導線も無い。
    //
    // 逆に**フラグだけ書けなかった場合は `failed` にしない** — 辞書は既に `local` にあり、
    // 次回は「既に local に辞書がある」で skip される。再試行は起きないし要らないので、
    // 「移行できなかった / 次回再試行する」と出すと事実と食い違う。
    try {
      await local.set({ [MIGRATED_KEY]: Date.now() })
    } catch (err) {
      return {
        status: 'migrated',
        count: source.length,
        reason: `sync から引き継いだ(移行済みフラグの記録には失敗: ${String(err)})`,
      }
    }
    return { status: 'migrated', count: source.length, reason: 'sync から引き継いだ' }
  } catch (err) {
    // フラグを立てずに返す。次回の起動で再試行する
    return { status: 'failed', count: 0, reason: String(err) }
  }
}

/**
 * 移行の成否を 1 行出す。**無言で失敗すると「辞書が消えた」ようにしか見えない** (plan.md R3)。
 * この repo は「無言で捨てる分岐が実機の往復を消費する」を繰り返し踏んでいる。
 */
function logMigration(result: DirectoryMigration): void {
  if (result.status === 'failed') {
    log.warn(
      '呼び名辞書を chrome.storage.local へ移行できなかった。sync 側は消していないので、次回の起動で再試行する:',
      result.reason,
    )
  } else if (result.status === 'migrated') {
    log.info(`呼び名辞書を chrome.storage.local へ引き継いだ: ${result.count} 件 (${result.reason})`)
  } else {
    log.info('呼び名辞書の引き継ぎはしていない:', result.reason)
  }
}

export async function loadDirectory(): Promise<Directory> {
  const area = getLocalStorageArea()
  if (!area) return []
  // **設定画面から先に開かれる導線がある**(docs/install.md)ので、読み込みの度に通す。
  // 2 回目以降はフラグを見て何もしない
  await migrateDirectoryToLocal()
  const stored = await area.get(STORAGE_KEY)
  return normalizeDirectory(stored?.[STORAGE_KEY])
}

export async function saveDirectory(directory: Directory): Promise<void> {
  const area = getLocalStorageArea()
  if (area) await area.set({ [STORAGE_KEY]: normalizeDirectory(directory) })
}

/** 辞書の変更の購読。戻り値を呼ぶと解除する */
export function onDirectoryChanged(handler: (directory: Directory) => void): () => void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {}
  // 移行後も `sync` に同名のキーが残るため、**実際に使っているエリアだけ**を見る。
  // 絞らないと、別 PC の `sync` 更新でこちらの辞書が巻き戻る
  const areaName = getLocalStorageAreaName()

  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    changedArea: string,
  ): void => {
    if (areaName && changedArea !== areaName) return
    const change = changes[STORAGE_KEY]
    if (change) handler(normalizeDirectory(change.newValue))
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}
