/**
 * 設定画面の**自由文まわりの判定ロジック**(AC6 / AC7 / AC8)。
 *
 * `options.ts` は export を 1 つも持たない副作用モジュールで、import した時点で要素 id を
 * 要求して throw する。**そのままではテストできない**ので、判定だけをこの純関数モジュールへ
 * 切り出してある(plan.md「options のテストを書けるようにする」)。DOM 配線は `options.ts` 側。
 *
 * ⚠️ **長さの計算をここで再実装しない。** 上限との比較は `composer.ts` が持っていて、
 *    単位がずれると「あと N 字」が嘘になる。残り文字数は `remainingLength` を通す。
 */
import { MAX_ENTRY_MESSAGE_LENGTH, MAX_MESSAGE_LENGTH, remainingLength } from '../composer'
import type { TemplateValues } from '../composer'
import { handleFromChannelUrl } from '../detector'
import type { Directory, DirectoryEntry } from '../directory'

// --- AC6: 1 件 200 字の検証 -----------------------------------------------

/**
 * 自由文の入力を検証する (AC6)。
 *
 * **超過は「保存せず理由を返す」。切り詰めて黙って保存しない** — 書いた本人が消えた部分に
 * 気づけないため。保存済みデータ側の切り詰め(`normalizeDirectory`)は壊れた保存内容への
 * 保険であって、入力の受け口はこちら。
 */
export type EntryMessageValidation =
  | { ok: true; value: string }
  | { ok: false; length: number; reason: string }

export function validateEntryMessage(input: string): EntryMessageValidation {
  const value = input.trim()
  // **コードポイントで数える。**`String.prototype.length` だと絵文字が 2 と数えられ、
  // 保存時の切り詰め(`clampMessage` = `Array.from`)と食い違う
  const length = Array.from(value).length
  if (length > MAX_ENTRY_MESSAGE_LENGTH) {
    return {
      ok: false,
      length,
      reason: `自由文は ${MAX_ENTRY_MESSAGE_LENGTH} 字までです(今 ${length} 字)。保存していません`,
    }
  }
  return { ok: true, value }
}

// --- AC7: テンプレートに {msg} が無いことの警告 -----------------------------

/**
 * テンプレートが `{msg}` を持っているか。
 *
 * ⚠️ **`composer.ts` の `PLACEHOLDER`(`/\{(name|url|msg)\}/g`)と同じ綴りでなければならない。**
 *    片方だけ変えると「警告は出ないのに差し込まれない」が起きるので、
 *    `tests/options.test.ts` で `compose` の実挙動と突き合わせて固定してある。
 */
export function hasMsgPlaceholder(template: string): boolean {
  return /\{msg\}/.test(template)
}

/** 自由文が入っている(空白だけではない)登録の件数 */
/**
 * どちらの自由文か (004 / AC16)。
 * **判定は `template` × `message` と `commentTemplate` × `commentMessage` の組で行い、
 * 組を跨がない** — 片方のテンプレートに `{msg}` があることで、もう片方の警告が消えてはいけない。
 */
export type MessageField = 'message' | 'commentMessage'

export function countEntriesWithMessage(
  directory: Directory,
  field: MessageField = 'message',
): number {
  return directory.filter((entry) => entry[field].trim()).length
}

/**
 * 「自由文はあるのにテンプレートに `{msg}` が無い」ときの警告文 (AC7)。無ければ `null`。
 *
 * 既定テンプレートに `{msg}` を入れても `normalizeConfig` が保存済みテンプレートを尊重するため
 * 既存利用者には届かない。**代わりにこの警告で気づかせる**(spec.md「既定テンプレートは変えない」)。
 */
export function msgPlaceholderWarning(
  template: string,
  directory: Directory,
  field: MessageField = 'message',
): string | null {
  if (hasMsgPlaceholder(template)) return null
  const count = countEntriesWithMessage(directory, field)
  if (count === 0) return null
  const what = field === 'commentMessage' ? 'コメント返し用の自由文' : '自由文'
  return `${what}を ${count} 件登録していますが、テンプレートに {msg} がありません。このままでは${what}は投稿に出ません。`
}

// --- AC8: 展開後の投稿文に対する残り文字数 ---------------------------------

/** 残り文字数を出すために使う、その行の値 */
export type EntrySource = {
  /** その行のエントリの URL(そのまま `{url}` に入る) */
  url: string
  /** 呼び名。**空なら URL から作ったハンドル**が `{name}` に入る (AC8) */
  nickname: string
}

/**
 * その行を投稿したときに `compose` が受け取る値 (AC8)。
 * **呼び名が未設定ならハンドル**が入るのは `resolveDisplayName` と同じ規則。
 */
export function entryTemplateValues(source: EntrySource, message: string): TemplateValues {
  const nickname = source.nickname.trim()
  return {
    name: nickname ? nickname : handleFromChannelUrl(source.url),
    url: source.url,
    message,
  }
}

/**
 * その行の自由文を入れて投稿したときの、**投稿文全体**の上限に対する残り (AC8)。
 *
 * 自由文の保存上限(200 字)に対する残りではない。定型部分と URL が先に場所を食うので、
 * 保存上限のほうを表示すると**「あと 0 字」まで書けたのに本番で削られる**という嘘になる。
 * **負を返してよい** — 保存は妨げず、投稿時に AC3 / AC4 の規則で削られるだけ。
 */
export function entryRemainingLength(
  template: string,
  source: EntrySource,
  message: string,
  maxLength: number = MAX_MESSAGE_LENGTH,
): number {
  return remainingLength(template, entryTemplateValues(source, message), maxLength)
}

/**
 * 残り文字数の表示文 (AC8)。**負であることが分かる形にする**
 * (「残り -12 字」だと読み飛ばされる)。
 */
export function formatRemaining(remaining: number): string {
  if (remaining < 0) return `${-remaining} 字超過`
  return `残り ${remaining} 字`
}

// --- 再描画で編集中の入力を失わせない ---------------------------------------
//
// 設定画面は行を保存する度に辞書テーブルを**作り直す**(`options.ts` の `renderDirectory`)。
// `chrome.storage.onChanged` は自分の書き込みでも発火するので、作り直しの機会はさらに多い。
// 素直に作り直すと、**AC6 で弾かれてまだ直していない自由文**が、別の行の保存・削除・新規登録の
// たびに保存済みの値へ巻き戻り、書いた本人が復元できない形で消える。
// 「保存していません、直してください」と言った直後に消すのは AC6 の趣旨と噛み合わない。
//
// そこで再描画の**直前に編集中の値を下書きとして回収し、作り直した行へ書き戻す**。
// 判定(何を残すか / 何を表示するか)はここに純関数で置き、DOM 側は入れ物を運ぶだけにする。

/** 行の入力欄がいま持っている値 */
export type RowDraft = {
  nickname: string
  message: string
  /** AC6 で弾かれた(= 保存されていない)自由文かどうか。再描画後も赤枠を残す */
  invalid: boolean
  /** 弾かれた理由。無ければ `null` */
  reason: string | null
}

/** その行の**保存済み**の値 */
export type SavedRowValues = Pick<DirectoryEntry, 'nickname' | 'message'>

/**
 * 再描画をまたいで残す下書き。**残す必要が無ければ `null`**(= 保存済みの値を出せばよい)。
 *
 * 残すのは「**人が入力欄をいじったが、まだ保存されていない値**」だけ。判定に 2 つ要る:
 *
 * - `shown` と同じ = **人は何も打っていない**(描いたときの値のまま)。残すと、＋ の欄からの
 *   再登録や他のタブの変更で保存済みの値が新しくなっても、古い表示が勝ち続ける。
 * - `saved` と同じ = **打った内容が保存に反映済み**。残す必要がない。溜めると上と同じ害が出る。
 *
 * **弾かれた入力(`invalid`)はどちらにも当てはめず、必ず残す** — 赤枠と理由まで消すと、
 * 「保存していません」と言われた本人が、直す場所も書いた内容も失う。
 *
 * ⚠️ **`shown` が下書き由来のときは「`shown` と同じ = 打っていない」が成り立たない。**
 *    下書きを入力欄へ戻して描いた行は、人が何も打たなければ当然 `current === shown` になる。
 *    そこで下書きを捨てると、**再描画 2 回目で未保存の入力が保存済みの値へ巻き戻る**
 *    (`chrome.storage.onChanged` は自分の書き込みでも発火するので、1 回の保存で描画は 2 回走る)。
 *    `shownFromDraft` が立っている行では、この条件を飛ばす。
 *
 * @param saved いま保存されている値
 * @param shown その行を描いたときに入力欄へ入れた値
 * @param current いま入力欄に入っている値
 * @param shownFromDraft `shown` が保存済みの値ではなく**下書き**から来たか
 */
export function captureRowDraft(
  saved: SavedRowValues,
  shown: SavedRowValues,
  current: RowDraft,
  shownFromDraft = false,
): RowDraft | null {
  if (current.invalid) return current
  if (
    !shownFromDraft &&
    current.nickname === shown.nickname &&
    current.message === shown.message
  ) {
    return null
  }
  // 保存側は trim してから入るので、比較も trim でそろえる
  if (current.nickname.trim() === saved.nickname && current.message.trim() === saved.message) {
    return null
  }
  return current
}

/**
 * 作り直した行の入力欄に入れる値。**下書きがあれば下書きが勝つ**
 * (保存済みの値で上書きすると、まさに未保存の入力が消える)。
 */
export function rowDraftValues(saved: SavedRowValues, draft: RowDraft | undefined): RowDraft {
  if (draft) return draft
  return { nickname: saved.nickname, message: saved.message, invalid: false, reason: null }
}

// --- 「効かない行」の印と、スイッチの食い違い (AC13) -------------------------
//
// **DOM に触らない純関数にしてある。** ここは AC13 が「間違えるな」と名指しした判定で、
// `options.ts` の描画関数の中に置くとテストが書けない。実際、2026-08-16 のレビューで出た
// 2 件のバグ(下書きのゴースト復活 / 辞書が空のときに常時表示が止まる)は、
// どちらもこの形にしていれば単体テストで落ちていた。

export type IneffectiveContext = {
  template: string
  commentTemplate: string
}

/**
 * 畳んだ状態でも分かるべき**「設定したのに効かない」理由** (AC13 / AC17)。
 *
 * 出すのは 4 つ:
 * 1. コメント返し用の自由文があるのに「コメントに反応する」が OFF(書いた一文が一生使われない)
 * 2. 自由文があるのに、**対応する**テンプレートに `{msg}` が無い(2 組ぶん / 組を跨がない)
 * 3. 「コメントに反応する」が ON なのに**チャンネル ID が未解決**(照合できないので反応しない)
 *
 * ⚠️ **「フラグ ON で自由文が空」は出さない。**AC16 の既定であり、フラグを付けた直後の
 *    全行がこれに当たる。撃つと辞書全体が印で埋まり、上の理由も AC13 の常時表示も読み飛ばされる。
 */
export function ineffectiveReasons(
  entry: Pick<DirectoryEntry, 'replyToComment' | 'channelId'>,
  message: string,
  commentMessage: string,
  context: IneffectiveContext,
): string[] {
  const reasons: string[] = []
  if (commentMessage.trim() && !entry.replyToComment) {
    reasons.push(
      'コメント返し用の自由文がありますが、「コメントに反応する」が OFF です。この一文は使われません。',
    )
  }
  if (message.trim() && !hasMsgPlaceholder(context.template)) {
    reasons.push('自由文がありますが、リダイレクト返礼の文面に {msg} がありません。')
  }
  if (commentMessage.trim() && !hasMsgPlaceholder(context.commentTemplate)) {
    reasons.push('コメント返し用の自由文がありますが、コメント返しの文面に {msg} がありません。')
  }
  if (entry.replyToComment && !entry.channelId) {
    reasons.push('チャンネル ID が未解決のため、コメントには反応しません。')
  }
  return reasons
}

/**
 * スイッチと辞書のフラグの食い違い (AC13)。**一時表示ではなく常時出す**ためのもの。
 * 食い違っていなければ `null`。
 */
export function commentMismatchMessage(enabled: boolean, flaggedCount: number): string | null {
  if (enabled && flaggedCount === 0) {
    return '辞書で「コメントに反応する」を付けた人が 0 件です。このままでは何も起きません。'
  }
  if (!enabled && flaggedCount > 0) {
    return `辞書で ${flaggedCount} 人に「コメントに反応する」が付いていますが、このスイッチが OFF なので動きません。`
  }
  return null
}

/** 辞書のうち「コメントに反応する」が ON の件数 */
export function countReplyToComment(directory: Directory): number {
  return directory.filter((entry) => entry.replyToComment).length
}
