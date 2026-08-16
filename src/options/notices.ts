/**
 * 設定画面の**常時表示**と、`channelId` の解決まわりの判定 (004 / AC13 / AC17)。
 *
 * `options.ts` は export を 1 つも持たない副作用モジュール(import した時点で要素 id を要求して
 * throw する)なので、**判定は全部こちらへ出して `tests/options.test.ts` で固定する。**
 * DOM 配線だけが `options.ts` に残る — `message-field.ts` と同じ建て付け。
 *
 * ⚠️ **ここは「いつ見ても正しい」ことを要求されている表示**(AC13 は不整合の表示に
 *    一時表示の `status` を使うなと名指ししている)。**描き直しの取りこぼしを型では防げない** —
 *    2026-08-16 には `renderAlwaysOnNotices()` が自分自身を呼ぶ形(無限再帰)が型検査を通り、
 *    **設定画面が開いた瞬間に落ちて辞書も常時表示も 1 つも描かれなかった。**
 *    そこで **4 本まとめて 1 つの純関数(`alwaysOnNotices`)が返す形**にし、
 *    `options.ts` 側は「返ってきたものを要素へ書くだけ」にしてある。値でテストできる。
 */
import { CHANNEL_ID_PATTERN, displayHandle } from '../directory'
import type { Directory, DirectoryEntry } from '../directory'
import { commentMismatchMessage, countReplyToComment, msgPlaceholderWarning } from './message-field'

// --- 同じ `channelId` の行が 2 件以上 (AC17) ---------------------------------
//
// 辞書の鍵は `url` なので `channelId` は一意ではない。同一人物が `@handle` 形と
// `/channel/UC…` 形で 2 行に載りうる(`normalizeChannelUrl` が別の鍵にするため)。
// `findEntryByChannelId` は 2 件以上ヒットしたら `undefined` を返す = **何もしない**ので、
// **画面で気づけないと直せない。**

export type DuplicateChannelIdGroup = {
  channelId: string
  /** その ID を持つ行のハンドル(表示順は辞書の並び順) */
  handles: string[]
}

/**
 * 同じ `channelId` を持つ行の組。**未解決(空文字)は数えない** —
 * 空同士を「重複」と呼ぶと、フラグを付けた直後の全行が警告になる。
 */
export function duplicateChannelIdGroups(directory: Directory): DuplicateChannelIdGroup[] {
  const byId = new Map<string, string[]>()
  for (const entry of directory) {
    // `findEntryByChannelId` と同じ強さで見る(片方が通して片方が弾く状態を作らない)
    if (!CHANNEL_ID_PATTERN.test(entry.channelId)) continue
    const handles = byId.get(entry.channelId)
    if (handles) handles.push(displayHandle(entry))
    else byId.set(entry.channelId, [displayHandle(entry)])
  }
  const groups: DuplicateChannelIdGroup[] = []
  for (const [channelId, handles] of byId) {
    if (handles.length > 1) groups.push({ channelId, handles })
  }
  return groups
}

/**
 * 同じ `channelId` の行が 2 件以上あることの警告文 (AC17)。無ければ `null`。
 *
 * **ハンドルを出す。**「重複しています」だけだと、どの行を消せばよいか分からない。
 * `channelId` も添えるのは、ハンドルが違うので**同じ人だと気づけない**ため
 * (`@handle` 形と `/channel/UC…` 形は別の鍵になる)。
 */
export function duplicateChannelIdWarning(directory: Directory): string | null {
  const groups = duplicateChannelIdGroups(directory)
  if (groups.length === 0) return null
  const detail = groups
    .map((group) => `${group.handles.join(' と ')}(${group.channelId})`)
    .join('、')
  return `同じチャンネル ID の行が 2 件以上あります: ${detail}。どちらの呼び名・自由文を使うか決められないため、この人のコメントには反応しません。いらないほうの行を削除してください。`
}

/** その行の `channelId` が他の行と重なっているか(行ごとの印に使う / AC13) */
export function hasDuplicateChannelId(directory: Directory, channelId: string): boolean {
  if (!CHANNEL_ID_PATTERN.test(channelId)) return false
  return directory.filter((entry) => entry.channelId === channelId).length > 1
}

// --- 未解決の行と「まとめて再試行」 (AC17 / T14 の決定 3 = A+C) ----------------

/**
 * 「まとめて再試行」の対象 (AC17)。
 *
 * **「コメントに反応する」が ON で `channelId` が空の行だけ**を採る。
 * OFF の行まで含めると、ボタン 1 つで**辞書の全件を取りに行く**ことになり、
 * 「辞書を開いただけで全件は取りに行かない」という AC17 の線引きを人の 1 クリックで越える。
 * 印 (⚠) が出ている行と対象をそろえる意味もある(見えている問題だけを直す)。
 */
export function unresolvedChannelIdEntries(directory: Directory): Directory {
  return directory.filter((entry) => entry.replyToComment && !entry.channelId)
}

/** 「まとめて再試行」ボタンの文言。**件数を出す**(押す前に規模が分かる) */
export function retryAllLabel(count: number): string {
  return `未解決の行をまとめて再試行 (${count} 件)`
}

// --- 行ごとの `channelId` の状態 (AC17) --------------------------------------

export type ChannelIdRowInput = {
  /** 保存されている `channelId`。空文字は未解決 */
  channelId: string
  replyToComment: boolean
  /** いま解決を走らせている最中か(**多重に走らせない**ための表示) */
  resolving: boolean
  /** 直近の失敗の理由。**保存はしない**(画面を開き直せば消える一時的な状態) */
  error: string | null
}

export type ChannelIdRowStatus = {
  /** 展開したときに出す 1 行 */
  text: string
  /** 再試行(取得)ボタンを出すか */
  canRetry: boolean
  /** ボタンの文言。1 度も取りに行っていない行に「再試行」と出さない */
  retryLabel: string
  /** 失敗として見せるか(色を変える) */
  failed: boolean
}

/**
 * 展開した行に出す `channelId` の状態 (AC17)。
 *
 * **失敗の理由は行ごとに出す。**`directoryStatus`(一時表示)だけで済ませると、
 * 何件か失敗したときに最後の 1 件しか残らず、**どの行がなぜ駄目なのか分からない。**
 *
 * 判定の順は **解決中 → 解決済み → 失敗 → 未解決**。解決済みを失敗より先に見るのは、
 * 成功した時点で理由を消すため(古い失敗が解決済みの行に残らない)。
 */
export function channelIdRowStatus(input: ChannelIdRowInput): ChannelIdRowStatus {
  if (input.resolving) {
    return {
      text: 'チャンネル ID を解決中…',
      canRetry: false,
      retryLabel: '再試行',
      failed: false,
    }
  }
  if (input.channelId) {
    return {
      text: `チャンネル ID: ${input.channelId}`,
      canRetry: false,
      retryLabel: '再試行',
      failed: false,
    }
  }
  if (input.error) {
    return {
      text: `チャンネル ID を取得できませんでした: ${input.error}`,
      canRetry: true,
      retryLabel: '再試行',
      failed: true,
    }
  }
  if (input.replyToComment) {
    return {
      text: 'チャンネル ID が未解決です。このままではコメントに反応しません',
      canRetry: true,
      retryLabel: 'チャンネル ID を取得',
      failed: true,
    }
  }
  return {
    // OFF の行は**まだ壊れていない。**「コメントに反応する」を ON にした時点で取りに行く (AC17)
    text: 'チャンネル ID は未解決です(「コメントに反応する」を ON にすると取得します)',
    canRetry: true,
    retryLabel: 'チャンネル ID を取得',
    failed: false,
  }
}

/**
 * **一度解決した `channelId` は自動で解決し直さない** (AC17)。
 *
 * 引き金(ON にした / 再試行を押した)から実際に取りに行くかの最終判定はここ 1 か所に置く。
 * 呼び出し側 3 経路(フラグ ON・個別の再試行・まとめて再試行)で条件がずれると、
 * **ON にするたびに毎回取りに行く**形に静かに戻る。
 */
export function needsChannelIdResolution(
  entry: Pick<DirectoryEntry, 'channelId'> | undefined,
): boolean {
  return entry !== undefined && !entry.channelId
}

// --- 常時表示の 4 本をまとめて作る (AC13 / AC16 / AC17) -----------------------

export type AlwaysOnNoticeInput = {
  /** 保存前の値でよい(**保存を待たずに**追従させる / AC7) */
  template: string
  commentTemplate: string
  commentReplyEnabled: boolean
  directory: Directory
}

export type AlwaysOnNotices = {
  /** 003 AC7: リダイレクト返礼の文面に `{msg}` が無い */
  templateWarning: string | null
  /** AC16: コメント返しの文面に `{msg}` が無い */
  commentTemplateWarning: string | null
  /** AC13: スイッチと辞書のフラグの食い違い */
  commentMismatch: string | null
  /** AC17: 同じ `channelId` の行が 2 件以上 */
  duplicateChannelId: string | null
}

/**
 * 「**いつ見ても正しい**必要がある表示」を 1 度に作る (AC13 / AC16 / AC17)。
 *
 * ⚠️ **4 本を別々の描画関数に散らさない。**散らすと「新しく足した 1 本だけ呼び忘れる」/
 *    「呼び出しが自分自身に化ける」が型検査を通ってしまう(実際に後者を踏んだ)。
 *    **1 つの純関数が 4 本とも返す**形なら、テストが 4 本まとめて見張れる。
 */
export function alwaysOnNotices(input: AlwaysOnNoticeInput): AlwaysOnNotices {
  return {
    templateWarning: msgPlaceholderWarning(input.template, input.directory, 'message'),
    commentTemplateWarning: msgPlaceholderWarning(
      input.commentTemplate,
      input.directory,
      'commentMessage',
    ),
    commentMismatch: commentMismatchMessage(
      input.commentReplyEnabled,
      countReplyToComment(input.directory),
    ),
    duplicateChannelId: duplicateChannelIdWarning(input.directory),
  }
}
