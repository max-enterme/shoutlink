/**
 * 設定 UI (T7)。テンプレート編集 / ON・OFF / クールダウン / 固定モード。
 */
import { resolveChannelId } from '../channel-id'
import { compose, composeText } from '../composer'
import { DEFAULT_CONFIG, loadConfig, saveConfig } from '../config'
import { normalizeChannelUrl } from '../detector'
import {
  directoryKey,
  displayHandle,
  findEntry,
  loadDirectory,
  onDirectoryChanged,
  removeEntry,
  saveDirectory,
  sortForDisplay,
  upsertChannelId,
  upsertCommentMessage,
  upsertMessage,
  upsertNickname,
  setReplyToComment,
} from '../directory'
import type { Directory } from '../directory'
import { clearPostLog, loadPostLog } from '../post-log'
import type { PostLog } from '../post-log'
import type { Config, PinMode, RedirectEvent } from '../types'
import {
  captureRowDraft,
  entryRemainingLength,
  focusKey,
  formatRemaining,
  ineffectiveReasons,
  isRowField,
  restoreSelection,
  rowDraftValues,
  validateEntryMessage,
} from './message-field'
import type { FocusTarget, RowDraft, RowField } from './message-field'
import {
  alwaysOnNotices,
  channelIdRowStatus,
  hasDuplicateChannelId,
  needsChannelIdResolution,
  retryAllLabel,
  unresolvedChannelIdEntries,
} from './notices'

/** プレビュー用のダミー。実在するチャンネルは使わない */
const SAMPLE_EVENT: RedirectEvent = {
  sourceChannelName: 'example-channel',
  sourceChannelUrl: 'https://www.youtube.com/@example-channel',
  detectedAt: 0,
}

/**
 * プレビューの `{msg}` に入れる見本の自由文。
 * **プレビューに自由文を含める**ことで、`{msg}` を足したときの見た目がその場で分かる (AC7)。
 */
const SAMPLE_MESSAGE = 'いつも遊びに来てくれてありがとう!'

/** コメント返しのプレビュー用。**リダイレクト返礼とは別の自由文**であることが見て分かる文にする */
const SAMPLE_COMMENT_MESSAGE = '今日も来てくれてうれしい!'

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`要素が見つからない: #${id}`)
  return found as T
}

const enabled = el<HTMLInputElement>('enabled')
const template = el<HTMLTextAreaElement>('template')
const pinMode = el<HTMLSelectElement>('pinMode')
const showManualTrigger = el<HTMLInputElement>('showManualTrigger')
const debug = el<HTMLInputElement>('debug')
const commentReplyEnabled = el<HTMLInputElement>('commentReplyEnabled')
const commentTemplate = el<HTMLTextAreaElement>('commentTemplate')
const commentTemplateWarning = el<HTMLElement>('commentTemplateWarning')
const commentMismatch = el<HTMLElement>('commentMismatch')
const channelIdDuplicate = el<HTMLElement>('channelIdDuplicate')
const channelIdRetryRow = el<HTMLElement>('channelIdRetryRow')
const retryChannelIds = el<HTMLButtonElement>('retryChannelIds')
const directoryRows = el<HTMLElement>('directoryRows')
const directoryStatus = el<HTMLElement>('directoryStatus')
const newHandle = el<HTMLInputElement>('newHandle')
const newNickname = el<HTMLInputElement>('newNickname')

const addEntry = el<HTMLButtonElement>('addEntry')
const templateWarning = el<HTMLElement>('templateWarning')
const postLogRows = el<HTMLElement>('postLogRows')
const postLogStatus = el<HTMLElement>('postLogStatus')
const clearPostLogButton = el<HTMLButtonElement>('clearPostLog')

// --- 呼び名の辞書 ---------------------------------------------------------

let directory: Directory = []

/**
 * テンプレート欄の**編集(未保存)に追従して**更新するもの (AC7 / AC8)。
 * 行ごとの残り文字数は行の生成時にここへ積み、テンプレートの `input` でまとめて叩く。
 */
const templateDependents: Array<() => void> = []

/**
 * **未保存の入力を再描画で落とさないための下書き**(鍵は `directoryKey`)。
 *
 * `renderDirectory` は行を全部作り直す。作り直しは自分の保存(`persistDirectory`)だけでなく、
 * `chrome.storage.onChanged`(自分の書き込みでも発火する)からも来る。素直に作り直すと、
 * **AC6 で弾かれてまだ直していない自由文**が、別の行を保存・削除・新規登録した拍子に
 * 保存済みの値へ巻き戻って消える。「保存していません」と出した本人の入力を消してしまう。
 *
 * 行の差分更新にはしていない。並び替え(`sortForDisplay`)込みで差分を取る手間に対して、
 * **消えてはいけないのは入力欄の値だけ**なので、退避 → 書き戻しで足りる。
 *
 * 何を残すかの判定は `message-field.ts` の `captureRowDraft` / `rowDraftValues`(純関数)にあり、
 * `tests/options.test.ts` で固定してある。**この配線そのものはテストしていない** —
 * `options.ts` は import した時点で要素 id を要求する副作用モジュールで、DOM 配線は
 * テストしない建て付けのため(plan.md「options のテストを書けるようにする」)。
 * jsdom で組み上げて手で確認した経路: 未保存の 250 字 → 別の行の保存 / 別の行の削除 /
 * ＋ の欄からの再登録、および削除した行の下書きが復活しないこと。
 */
const rowDrafts = new Map<string, RowDraft>()

/**
 * いま画面に出ている行。再描画の直前に下書きを回収するために持つ。
 * `shown` は**描いたときに入力欄へ入れた値**で、「人が触ったか」の判定に要る。
 */
const liveRows: Array<{
  key: string
  url: string
  shown: { nickname: string; message: string }
  /** `shown` が保存済みの値ではなく下書きから来たか(`captureRowDraft` の条件 2 を飛ばす) */
  shownFromDraft: boolean
  read: () => RowDraft
  /** コメント返し用の自由文。**同じ仕組みを field ごとに持つ**(組を跨がない / AC16) */
  comment?: {
    shown: { nickname: string; message: string }
    shownFromDraft: boolean
    read: () => RowDraft
  }
}> = []

/**
 * 画面に出ている行の入力を下書きへ退避する。**行を消す前に呼ぶ。**
 * 触られていない行・保存に反映済みの行・辞書から消えた行の下書きは捨てる
 * (古い値が勝ち続けると、他のタブや ＋ の欄からの変更が画面に出なくなる)。
 */
/**
 * **展開している行**(T14 で確定: 左端の `▸` で開閉)。
 * AC13 は「展開状態は保存しなくてよい」だが、**再描画のたびに畳むと自由文が書けない**ので
 * セッション中はここで覚える(保存はしない)。
 */
const expandedRows = new Set<string>()

/** コメント返し用の自由文の下書き。リダイレクト側と同じ仕組みを field ごとに持つ */
const commentDrafts = new Map<string, RowDraft>()

// --- 再描画をまたいでフォーカスとキャレットを戻す (T17) ----------------------
//
// **下書きは値を守るが、フォーカスとキャレットは守らない。**T17 で「fetch が返った瞬間」
// という人の操作と無関係な再描画ができたので、入力中に作り直されると打鍵が捨てられる。
// 判定・丸めは `message-field.ts` の純関数(`restoreSelection`)にあり、ここは
// **どの欄が作り直されたかを覚えて戻すだけ。**

/** 作り直した入力欄。鍵は `focusKey(directoryKey, 欄)` */
const focusables = new Map<string, HTMLInputElement>()

/** 入力欄を `focusables` に登録し、フォーカスの持ち主を DOM 側にも書いておく */
function registerFocusable(input: HTMLInputElement, key: string, field: RowField): void {
  // `dataset` に持たせるのは、**フォーカスを覚えるとき `activeElement` から逆に引ける**ようにするため
  input.dataset.rowKey = key
  input.dataset.rowField = field
  focusables.set(focusKey(key, field), input)
}

/** 再描画の直前に、いまフォーカスがある辞書の入力欄を覚える。無ければ `null` */
function captureFocusTarget(): FocusTarget | null {
  const active = document.activeElement
  if (!(active instanceof HTMLInputElement)) return null
  const key = active.dataset.rowKey
  const field = active.dataset.rowField
  // ＋ の欄・チェックボックス・辞書の外の入力には `dataset` が付いていない
  if (!key || !isRowField(field)) return null
  return {
    key,
    field,
    selectionStart: active.selectionStart,
    selectionEnd: active.selectionEnd,
  }
}

/**
 * 作り直した行へフォーカスとキャレットを戻す。
 * **欄が消えていたら何もしない**(行を削除した / 展開を畳んだ場合)。
 */
function restoreFocusTarget(target: FocusTarget | null): void {
  const input = target ? focusables.get(focusKey(target.key, target.field)) : undefined
  const selection = restoreSelection(target, input ? input.value.length : null)
  if (!input || !selection) return
  // ⚠️ **`preventScroll` を外さない。**`focus()` は既定で対象を可視域まで**スクロールする。**
  //    この再描画は fetch の完了や `onDirectoryChanged` からも来る = **人の操作と無関係な瞬間**に
  //    走る。既定のままだと、入力欄にフォーカスを置いたまま投稿履歴まで下げた画面が、
  //    解決が返った拍子に辞書の行まで**勝手に跳ね上がる。**
  //    直そうとした事故(人が触っていないのに画面が動く)が、打鍵の代わりにスクロール位置で再発する。
  input.focus({ preventScroll: true })
  // `setSelectionRange` が動かすのは**欄の内部スクロール**だけなので、ここは既定のままでよい
  input.setSelectionRange(selection.start, selection.end)
}

function captureRowDrafts(): void {
  for (const row of liveRows) {
    const saved = findEntry(directory, row.url)
    // **辞書から消えた行の「行ごとの状態」は、ここで全部まとめて捨てる。**
    // 鍵はどれも `directoryKey(url)` なので、**同じハンドルを ＋ から再登録すると
    // 前の行の状態がそのまま新しい行に付く。**
    //
    // ⚠️ **行ごとの状態を足したら、この掃除にも足すこと。**ここは 2 度踏んでいる:
    //    ① 掃除をコメント側の `if (!row.comment) continue` の後ろに置いていたため、
    //      `row.comment` が**展開している行にしか付かない**ことで
    //      **畳んだまま削除した行のコメント側の下書きだけが残った**
    //      (再登録すると、弾かれた 200 字超が赤枠つきで復活する)
    //    ② T17 で足した `channelIdErrors` を掃除から漏らした。
    //      解決に失敗した行を削除して同じハンドルを登録し直すと、**1 度も取りに行っていないのに**
    //      「チャンネル ID を取得できませんでした: …」が出る(AC17 の「理由を画面に出す」の誤表示)
    //
    // ⚠️ **`resolvingKeys` はここで消さない。**あれは「いま fetch が飛んでいる」という
    //    実行中の事実で、持ち主は `resolveEntryChannelId` の `finally`(必ず消える)。
    //    外から消すと**多重に走らせない歯止めが外れ**、同じ URL へ 2 本目が飛びうる。
    //    行が消えている間に出る「解決中…」の表示は、その `finally` の再描画で自然に消える
    //    (`channelIdErrors` と違い、**残り続ける嘘にならない**)
    if (!saved) {
      rowDrafts.delete(row.key)
      commentDrafts.delete(row.key)
      expandedRows.delete(row.key)
      channelIdErrors.delete(row.key)
      continue
    }
    const draft = captureRowDraft(saved, row.shown, row.read(), row.shownFromDraft)
    if (draft) rowDrafts.set(row.key, draft)
    else rowDrafts.delete(row.key)

    if (!row.comment) continue
    // コメント側は `message` の位置に `commentMessage` を入れて同じ判定を通す
    const commentDraft = captureRowDraft(
      { nickname: saved.nickname, message: saved.commentMessage },
      row.comment.shown,
      row.comment.read(),
      row.comment.shownFromDraft,
    )
    if (commentDraft) commentDrafts.set(row.key, commentDraft)
    else commentDrafts.delete(row.key)
  }
  liveRows.length = 0
}

/** 保存前のテンプレート欄の値。空ならプレビューと同じく既定テンプレートで見積もる */
function currentCommentTemplate(): string {
  return commentTemplate.value || DEFAULT_CONFIG.commentTemplate
}

function currentTemplate(): string {
  return template.value || DEFAULT_CONFIG.template
}

/** 常時表示の 1 本を要素へ書く。**空なら消す**(前の内容を残さない) */
function setNotice(target: HTMLElement, message: string | null): void {
  target.textContent = message ?? ''
  target.hidden = message === null
}

/**
 * **いつ見ても正しい**必要があるものを、まとめて描き直す
 * (003 AC7 / AC13 の常時表示 / AC16 の警告 / AC17 の重複警告)。
 *
 * **判定は 1 つの純関数 `alwaysOnNotices` が 4 本まとめて返す**(`notices.ts`)。
 * ここは返ってきたものを要素へ書くだけ。
 *
 * ⚠️ **描画関数を種類ごとに分けて、この関数から個別に呼ぶ形へ戻さない。**
 *    その形は「新しく足した 1 本だけ呼び忘れる」「呼び出しが自分自身に化ける」を型検査が
 *    通してしまう。実際 2026-08-16 に**この関数が自分自身を呼ぶ**版が入り、設定画面が
 *    開いた瞬間に落ちて**辞書も常時表示も 1 つも描かれなかった。**
 *    `tests/options.test.ts` が見張れるのは純関数の側だけなので、DOM 側は薄く保つ。
 */
function renderAlwaysOnNotices(): void {
  const notices = alwaysOnNotices({
    template: currentTemplate(),
    commentTemplate: currentCommentTemplate(),
    commentReplyEnabled: commentReplyEnabled.checked,
    directory,
  })
  setNotice(templateWarning, notices.templateWarning)
  setNotice(commentTemplateWarning, notices.commentTemplateWarning)
  setNotice(commentMismatch, notices.commentMismatch)
  setNotice(channelIdDuplicate, notices.duplicateChannelId)
  renderChannelIdRetryAll()
}

function refreshTemplateDependent(): void {
  renderAlwaysOnNotices()
  for (const update of templateDependents) update()
}

function setDirectoryStatus(message: string): void {
  directoryStatus.textContent = message
}

async function persistDirectory(message: string): Promise<void> {
  await saveDirectory(directory)
  renderDirectory()
  setDirectoryStatus(message)
}

// --- チャンネル ID の解決 (AC17) --------------------------------------------
//
// **解決するのはこの画面だけ。**ライブチャット側 (`main.ts`) からは呼ばない
// (配信中にネットワークを走らせない)。引き金は 2 つだけ:
//   ① 「コメントに反応する」を **ON にしたとき**
//   ② **未解決の行に対する明示的な再試行**(展開したときの個別 / 辞書の上のまとめて)
// **辞書を開いただけでは 1 件も取りに行かない。**

/** いま解決を走らせている行(鍵は `directoryKey`)。**同じ行を多重に走らせない** */
const resolvingKeys = new Set<string>()

/**
 * 直近の失敗の理由(鍵は `directoryKey`)。**保存しない。**
 * 「取れなかった」は端末とその時のネットワークの話で、辞書に書くと次に開いたときに
 * 古い理由が事実のように残る。画面を開き直したら消えてよい(印は `channelId` が空である
 * 事実のほうから出る)。
 */
const channelIdErrors = new Map<string, string>()

/** 「まとめて再試行」が走っているか。**重ねて押させない** */
let bulkResolving = false

/** 「まとめて再試行」ボタンの表示。件数が変わるたびに描き直す */
function renderChannelIdRetryAll(): void {
  const targets = unresolvedChannelIdEntries(directory)
  channelIdRetryRow.hidden = targets.length === 0 && !bulkResolving
  retryChannelIds.disabled = bulkResolving
  retryChannelIds.textContent = bulkResolving
    ? 'チャンネル ID を解決中…'
    : retryAllLabel(targets.length)
}

/**
 * 1 行ぶんの解決 (AC17)。**例外を投げない**(`resolveChannelId` が理由を返す形で握っている)。
 *
 * - **既に `channelId` がある行は取りに行かない** — 「一度解決した ID は自動で解決し直さない」。
 *   ON にしただけで取り直す形にすると、フラグを触るたびに通信が走る
 * - **同じ行を多重に走らせない** — ON / OFF を素早く往復されても 1 本だけ
 * - **待っている間に行が消えていたら書かない** — `upsertChannelId` は登録が無ければ**行を作る**ので、
 *   削除した行がここで復活する
 */
async function resolveEntryChannelId(url: string): Promise<void> {
  const key = directoryKey(url)
  if (resolvingKeys.has(key)) return
  const before = findEntry(directory, url)
  if (!before || !needsChannelIdResolution(before)) return

  const handle = displayHandle(before)
  resolvingKeys.add(key)

  // ⚠️ **`add` の直後から `try` を開ける。**この鍵は `finally` だけが消す設計なので、
  //    **`add` と `try` の間で throw されると鍵が永久に残る。**そうなるとその行は
  //    「解決中…」のまま `canRetry: false` になり、冒頭の `has(key)` にも弾かれて
  //    **ページを開き直すまで二度と再試行できない**(戻れない状態になる)。
  //    下の `renderDirectory()` は DOM を作り直して `focus()` まで行うので、
  //    「今は throw しない」に賭けずに囲っておく。
  try {
    // 前回の失敗は消してから走る(古い理由が「解決中」の行に残らないように)
    channelIdErrors.delete(key)
    renderDirectory()
    setDirectoryStatus(`${handle} のチャンネル ID を取りに行っている…`)

    const result = await resolveChannelId(url)
    // **待っている間に消えた / 別タブで変わった行には書かない**
    if (!findEntry(directory, url)) return
    if (result.status === 'failed') {
      channelIdErrors.set(key, result.reason)
      setDirectoryStatus(`${handle}: チャンネル ID を取得できなかった (${result.reason})`)
      return
    }
    directory = upsertChannelId(directory, url, result.channelId)
    await persistDirectory(`${handle} のチャンネル ID を保存した (${result.channelId})`)
  } finally {
    resolvingKeys.delete(key)
    // 「解決中…」の表示と、失敗の理由を反映する。**成否に関わらず必ず描き直す**
    renderDirectory()
  }
}

/**
 * 未解決の行の「まとめて再試行」(T14 の決定 3 = 個別 + まとめて)。
 *
 * **1 件ずつ順に取りに行く。**同時に投げると、登録が多いときに YouTube へ一斉にリクエストが飛ぶ。
 * 対象は `unresolvedChannelIdEntries`(= ⚠ が出ている行)だけで、**辞書の全件ではない。**
 */
async function retryUnresolvedChannelIds(): Promise<void> {
  if (bulkResolving) return
  bulkResolving = true
  renderChannelIdRetryAll()
  try {
    // 走っている間に `directory` は差し替わるので、対象は**先に確定させる**
    for (const entry of [...unresolvedChannelIdEntries(directory)]) {
      await resolveEntryChannelId(entry.url)
    }
  } finally {
    bulkResolving = false
    renderChannelIdRetryAll()
  }
  const left = unresolvedChannelIdEntries(directory).length
  setDirectoryStatus(
    left === 0 ? '未解決の行はなくなった' : `再試行が終わった(まだ未解決: ${left} 件)`,
  )
}

retryChannelIds.addEventListener('click', () => {
  void retryUnresolvedChannelIds()
})

function renderDirectory(): void {
  // **行を消す前に**編集中の値を退避する。ここを飛ばすと未保存の入力がそのまま消える
  captureRowDrafts()
  // 値だけでは足りない。**打っている最中の欄とキャレットも覚える** (T17)
  const focusTarget = captureFocusTarget()
  directoryRows.textContent = ''
  // 行を作り直すので、前の行に紐づいた更新関数と入力欄の参照は捨てる
  templateDependents.length = 0
  focusables.clear()

  if (directory.length === 0) {
    const row = document.createElement('tr')
    const cell = document.createElement('td')
    cell.colSpan = 4
    cell.className = 'empty'
    cell.textContent = 'まだ登録がありません。リダイレクトを受けると自動で追加されます。'
    row.appendChild(cell)
    directoryRows.appendChild(row)
    // ⚠️ **早期 return でも常時表示を描き直す。**飛ばすと「最後の 1 件を削除した」遷移で
    //    AC13 の常時表示と AC16 の警告が**古い内容のまま残る**(次の描画でも同じ経路を通るので
    //    自己回復しない)。常時表示は「いつ見ても正しい」ことが要件
    renderAlwaysOnNotices()
    // 行が 1 つも無いので戻す先も無い。**それでも呼ぶ**(出口ごとに約束が変わらないように)
    restoreFocusTarget(focusTarget)
    return
  }

  for (const entry of sortForDisplay(directory)) {
    const key = directoryKey(entry.url)
    const expanded = expandedRows.has(key)

    // 未保存の入力があればそれを出す。無ければ保存済みの値(field ごとに持つ)
    const savedDraft = rowDrafts.get(key)
    const shown = rowDraftValues(entry, savedDraft)
    const commentSaved = { nickname: entry.nickname, message: entry.commentMessage }
    const commentSavedDraft = commentDrafts.get(key)
    const commentShown = rowDraftValues(commentSaved, commentSavedDraft)

    /** AC6 で弾かれたまま直っていない理由。再描画をまたいで持ち回る */
    let invalidReason: string | null = shown.invalid ? shown.reason : null
    let commentInvalidReason: string | null = commentShown.invalid ? commentShown.reason : null

    const row = document.createElement('tr')

    // --- 展開の操作子 (T14 で確定: 左端の ▸) ------------------------------
    const caretCell = document.createElement('td')
    caretCell.className = 'caret'
    const caret = document.createElement('button')
    caret.type = 'button'
    caret.className = 'caret'
    caret.textContent = expanded ? '▾' : '▸'
    caret.title = expanded ? '閉じる' : '自由文とフラグを開く'
    caret.setAttribute('aria-expanded', String(expanded))
    caret.addEventListener('click', () => {
      if (expandedRows.has(key)) expandedRows.delete(key)
      else expandedRows.add(key)
      renderDirectory()
    })
    caretCell.appendChild(caret)

    // --- ハンドル + 「効かない行」の印 -------------------------------------
    const handleCell = document.createElement('td')
    handleCell.className = entry.lastSeenAt ? 'handle' : 'handle unseen'
    handleCell.textContent = displayHandle(entry)
    handleCell.title = entry.lastSeenAt ? entry.url : `${entry.url}(まだリダイレクトを受けていない)`

    // 走っている間の表示 (AC17)。**畳んだ行でも分かるように**ハンドルの横に出す
    if (resolvingKeys.has(key)) {
      const busy = document.createElement('span')
      busy.className = 'resolving'
      busy.textContent = 'チャンネル ID を解決中…'
      handleCell.appendChild(busy)
    }

    const reasons = ineffectiveReasons(entry, shown.message, commentShown.message, {
      template: currentTemplate(),
      commentTemplate: currentCommentTemplate(),
      // **失敗の理由は行ごとに出す** (AC17)。畳んだままでも印の title で読める
      channelIdError: channelIdErrors.get(key) ?? null,
      duplicateChannelId: hasDuplicateChannelId(directory, entry.channelId),
    })
    if (reasons.length > 0) {
      // T14 で確定: **アイコン + 行の背景色の両方**。理由はアイコンの title に出す
      row.classList.add('ineffective')
      const mark = document.createElement('span')
      mark.className = 'mark'
      mark.textContent = '⚠'
      mark.title = reasons.join('\n')
      handleCell.appendChild(mark)
    }

    // --- 呼び名 -----------------------------------------------------------
    const nicknameCell = document.createElement('td')
    const input = document.createElement('input')
    input.type = 'text'
    input.value = shown.nickname
    input.placeholder = '(未設定 — ハンドルのまま)'
    registerFocusable(input, key, 'nickname')
    input.addEventListener('change', () => {
      directory = upsertNickname(directory, entry.url, input.value.trim())
      void persistDirectory(`${displayHandle(entry)} の呼び名を保存した`)
    })
    nicknameCell.appendChild(input)

    // --- 削除(**畳んだ状態でも押せる** / AC13) ---------------------------
    const actionCell = document.createElement('td')
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.textContent = '削除'
    remove.title = '一覧から削除する'
    remove.addEventListener('click', () => {
      directory = removeEntry(directory, entry.url)
      expandedRows.delete(key)
      void persistDirectory(`${displayHandle(entry)} を削除した`)
    })
    actionCell.appendChild(remove)

    row.append(caretCell, handleCell, nicknameCell, actionCell)
    directoryRows.appendChild(row)

    if (!expanded) {
      // 畳んだ行でも下書きは拾う(呼び名は畳んだ状態でも編集できる)
      liveRows.push({
        key,
        url: entry.url,
        shown: { nickname: shown.nickname, message: shown.message },
        shownFromDraft: savedDraft !== undefined,
        read: () => ({
          nickname: input.value,
          message: shown.message,
          invalid: invalidReason !== null,
          reason: invalidReason,
        }),
      })
      continue
    }

    // --- 展開したときだけ出すもの -----------------------------------------
    const detailRow = document.createElement('tr')
    const detailCell = document.createElement('td')
    detailCell.className = 'detail'
    detailCell.colSpan = 4

    // 「コメントに反応する」(行編集で即保存 / AC13)
    const flagRow = document.createElement('div')
    flagRow.className = 'row'
    const flag = document.createElement('input')
    flag.type = 'checkbox'
    flag.checked = entry.replyToComment
    const flagLabel = document.createElement('label')
    flagLabel.style.margin = '0'
    flagLabel.textContent = 'コメントに反応する'
    flag.addEventListener('change', () => {
      directory = setReplyToComment(directory, entry.url, flag.checked)
      void (async () => {
        await persistDirectory(
          `${displayHandle(entry)} のコメント返しを${flag.checked ? 'ON' : 'OFF'}にした`,
        )
        // **ON にしたときが解決の引き金** (AC17)。既に解決済みの行は取りに行かない
        // (判定は `resolveEntryChannelId` の中。3 経路で条件をずらさない)
        if (flag.checked) await resolveEntryChannelId(entry.url)
      })()
    })
    flagLabel.prepend(flag)
    flagRow.appendChild(flagLabel)
    detailCell.appendChild(flagRow)

    // --- チャンネル ID の状態と個別の再試行 (AC17 / T14 の決定 3) -----------
    // **畳んだ行には再試行を置かない**(ボタンが 3 つ並ぶため / T14)。ここと「まとめて」の 2 つ
    const idStatus = channelIdRowStatus({
      channelId: entry.channelId,
      replyToComment: entry.replyToComment,
      resolving: resolvingKeys.has(key),
      error: channelIdErrors.get(key) ?? null,
    })
    const idRow = document.createElement('p')
    idRow.className = idStatus.failed ? 'channel-id failed' : 'channel-id'
    idRow.textContent = idStatus.text
    if (idStatus.canRetry) {
      const retry = document.createElement('button')
      retry.type = 'button'
      retry.textContent = idStatus.retryLabel
      retry.title = 'この行のチャンネル URL を 1 回だけ見に行って、照合用の ID を控える'
      retry.addEventListener('click', () => {
        void resolveEntryChannelId(entry.url)
      })
      idRow.appendChild(retry)
    }
    detailCell.appendChild(idRow)

    /** 自由文 1 本ぶんの欄を作る。**リダイレクト用とコメント用で同じ規則を使う** (AC16) */
    const makeMessageField = (
      /** どちらの自由文か。**フォーカスを戻す先の同定に使う**(取り違えると別の欄に戻る) */
      fieldName: RowField,
      labelText: string,
      value: string,
      placeholder: string,
      initialInvalid: string | null,
      getTemplate: () => string,
      save: (text: string) => void,
      setInvalid: (reason: string | null) => void,
    ): HTMLInputElement => {
      const label = document.createElement('label')
      label.className = 'detail-field'
      label.textContent = labelText
      const field = document.createElement('input')
      field.type = 'text'
      field.value = value
      field.placeholder = placeholder
      registerFocusable(field, key, fieldName)
      if (initialInvalid !== null) {
        field.classList.add('invalid')
        field.title = initialInvalid
      }
      const remaining = document.createElement('span')
      remaining.className = 'remaining'

      // 残りは**展開後の投稿文全体**に対して出す (AC8)。テンプレートは組ごとに違う
      const updateRemaining = (): void => {
        const left = entryRemainingLength(
          getTemplate(),
          { url: entry.url, nickname: input.value },
          field.value.trim(),
        )
        remaining.textContent = formatRemaining(left)
        remaining.classList.toggle('over', left < 0)
        remaining.title =
          left < 0
            ? '投稿時に 自由文 → 表示名 → 末尾 の順で削られます(保存はできます)'
            : '投稿文全体 (200 字) に対する残り'
      }
      updateRemaining()
      field.addEventListener('input', updateRemaining)
      input.addEventListener('input', updateRemaining)
      templateDependents.push(updateRemaining)

      field.addEventListener('change', () => {
        const checked = validateEntryMessage(field.value)
        if (!checked.ok) {
          // **切り詰めて黙って保存しない** (AC6)。入力はそのまま残し、その場で直せるようにする
          setInvalid(checked.reason)
          field.classList.add('invalid')
          field.title = checked.reason
          setDirectoryStatus(`${displayHandle(entry)}: ${checked.reason}`)
          return
        }
        setInvalid(null)
        field.classList.remove('invalid')
        field.title = ''
        save(checked.value)
      })

      label.append(field, remaining)
      detailCell.appendChild(label)
      // **`read` は返さない。**下書きの読み取りは `liveRows` 側が組み立てる。
      // ここでも返すと `invalid` 固定の版が紛れ、うっかり使うと下書きが壊れる
      return field
    }

    const messageField = makeMessageField(
      'message',
      '自由文(リダイレクト返礼 / {msg})',
      shown.message,
      '(未設定 — {msg} は消える)',
      invalidReason,
      currentTemplate,
      (text) => {
        directory = upsertMessage(directory, entry.url, text)
        void persistDirectory(`${displayHandle(entry)} の自由文を保存した`)
      },
      (reason) => {
        invalidReason = reason
      },
    )

    const commentField = makeMessageField(
      'commentMessage',
      '自由文(コメント返し / {msg})',
      commentShown.message,
      '(未設定 — {msg} は消える)',
      commentInvalidReason,
      currentCommentTemplate,
      (text) => {
        directory = upsertCommentMessage(directory, entry.url, text)
        void persistDirectory(`${displayHandle(entry)} のコメント返し用の自由文を保存した`)
      },
      (reason) => {
        commentInvalidReason = reason
      },
    )

    detailRow.appendChild(detailCell)
    directoryRows.appendChild(detailRow)

    liveRows.push({
      key,
      url: entry.url,
      shown: { nickname: shown.nickname, message: shown.message },
      shownFromDraft: savedDraft !== undefined,
      read: () => ({
        nickname: input.value,
        message: messageField.value,
        invalid: invalidReason !== null,
        reason: invalidReason,
      }),
      comment: {
        shown: { nickname: shown.nickname, message: commentShown.message },
        shownFromDraft: commentSavedDraft !== undefined,
        read: () => ({
          nickname: input.value,
          message: commentField.value,
          invalid: commentInvalidReason !== null,
          reason: commentInvalidReason,
        }),
      },
    })
  }

  renderAlwaysOnNotices()
  // **作り直したあとに戻す。**打っている最中に `channelId` の解決が返っても打鍵を落とさない (T17)
  restoreFocusTarget(focusTarget)
}

addEntry.addEventListener('click', () => {
  const url = normalizeChannelUrl(newHandle.value)
  if (!url) {
    setDirectoryStatus('チャンネルの @ハンドル または URL を入れてください')
    return
  }
  // **自由文は ＋ の欄から入れない** — 行を畳む表示にしたので、登録してから ▸ で開いて書く。
  // 「空欄で保存済みの自由文を消さない」ための分岐(003 の `shouldUpsertMessage`)も、
  // 入口が無くなったので要らない
  directory = upsertNickname(directory, url, newNickname.value.trim())
  newHandle.value = ''
  newNickname.value = ''
  // 新しく登録した行はすぐ書けるように開いておく
  expandedRows.add(directoryKey(url))
  void persistDirectory('登録した')
})

for (const input of [newHandle, newNickname]) {
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') addEntry.click()
  })
}

void loadDirectory().then((loaded) => {
  directory = loaded
  renderDirectory()
})

onDirectoryChanged((next) => {
  directory = next
  renderDirectory()
})

// --- 投稿履歴 -------------------------------------------------------------
// 再投稿を止めている根拠を人が見られるようにする。消せば同じ配信でももう一度投稿できる。

function renderPostLog(log: PostLog): void {
  postLogRows.textContent = ''

  if (log.length === 0) {
    const row = document.createElement('tr')
    const cell = document.createElement('td')
    cell.colSpan = 4
    cell.className = 'empty'
    cell.textContent = 'まだ投稿していません。'
    row.appendChild(cell)
    postLogRows.appendChild(row)
    return
  }

  for (const record of [...log].sort((a, b) => b.postedAt - a.postedAt)) {
    const row = document.createElement('tr')

    const handleCell = document.createElement('td')
    handleCell.className = 'handle'
    handleCell.textContent = record.handle
    handleCell.title = record.url

    // **種別** (AC13)。どちらの引き金で出た投稿かが分からないと、抑止の効き方 (AC8) を読めない
    const kindCell = document.createElement('td')
    kindCell.textContent = record.kind === 'comment' ? 'コメント返し' : 'リダイレクト返礼'

    const textCell = document.createElement('td')
    textCell.className = 'text'
    textCell.textContent = record.text

    const timeCell = document.createElement('td')
    timeCell.textContent = new Date(record.postedAt).toLocaleString()
    timeCell.title = record.streamId ? `配信 ID: ${record.streamId}` : '配信 ID が取れなかった回'

    row.append(handleCell, kindCell, textCell, timeCell)
    postLogRows.appendChild(row)
  }
}

clearPostLogButton.addEventListener('click', () => {
  void (async () => {
    await clearPostLog()
    renderPostLog([])
    postLogStatus.textContent = '消した'
    setTimeout(() => (postLogStatus.textContent = ''), 2000)
  })()
})

void loadPostLog().then(renderPostLog)
const preview = el<HTMLElement>('preview')
const commentPreview = el<HTMLElement>('commentPreview')
const status = el<HTMLElement>('status')
const save = el<HTMLButtonElement>('save')

function renderPreview(): void {
  // サンプルの自由文を入れて出す (AC7)。`{msg}` を足したときの見た目がその場で分かる
  preview.textContent = compose(currentTemplate(), SAMPLE_EVENT, { message: SAMPLE_MESSAGE })
  // コメント返しは `RedirectEvent` を持たないので `{ name, url }` を直接渡す (AC5)
  commentPreview.textContent = composeText(
    currentCommentTemplate(),
    { name: SAMPLE_EVENT.sourceChannelName, url: SAMPLE_EVENT.sourceChannelUrl },
    { message: SAMPLE_COMMENT_MESSAGE },
  )
}

function apply(config: Config): void {
  enabled.checked = config.enabled
  template.value = config.template
  pinMode.value = config.pinMode
  showManualTrigger.checked = config.showManualTrigger
  debug.checked = config.debug
  commentReplyEnabled.checked = config.commentReplyEnabled
  commentTemplate.value = config.commentTemplate
  renderPreview()
  // `refreshTemplateDependent` が常時表示 4 本(003 AC7 / AC13 / AC16 / AC17)をまとめて描き直す
  refreshTemplateDependent()
}

// **保存を待たずに**警告と残り文字数を追従させる (AC7 / AC8)
template.addEventListener('input', () => {
  renderPreview()
  refreshTemplateDependent()
  renderDirectory()
})

commentTemplate.addEventListener('input', () => {
  renderPreview()
  refreshTemplateDependent()
  // 「効かない行」の印は**組ごと**に判定するので、こちらの変更でも描き直す (AC13 / AC16)
  renderDirectory()
})

// スイッチと辞書の食い違いは**常時表示**。保存を待たずに追従させる (AC13)
commentReplyEnabled.addEventListener('change', renderAlwaysOnNotices)

save.addEventListener('click', () => {
  void (async () => {
    const saved = await saveConfig({
      enabled: enabled.checked,
      template: template.value,
      pinMode: pinMode.value as PinMode,
      showManualTrigger: showManualTrigger.checked,
      debug: debug.checked,
      commentReplyEnabled: commentReplyEnabled.checked,
      commentTemplate: commentTemplate.value,
    })
    apply(saved)
    status.textContent = '保存した'
    setTimeout(() => (status.textContent = ''), 2000)
  })()
})

void loadConfig().then(apply)
