/**
 * 設定 UI (T7)。テンプレート編集 / ON・OFF / クールダウン / 固定モード。
 */
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
  commentMismatchMessage,
  countReplyToComment,
  entryRemainingLength,
  formatRemaining,
  ineffectiveReasons,
  msgPlaceholderWarning,
  rowDraftValues,
  validateEntryMessage,
} from './message-field'
import type { RowDraft } from './message-field'

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
const cooldownSec = el<HTMLInputElement>('cooldownSec')
const showManualTrigger = el<HTMLInputElement>('showManualTrigger')
const debug = el<HTMLInputElement>('debug')
const commentReplyEnabled = el<HTMLInputElement>('commentReplyEnabled')
const commentTemplate = el<HTMLTextAreaElement>('commentTemplate')
const commentTemplateWarning = el<HTMLElement>('commentTemplateWarning')
const commentMismatch = el<HTMLElement>('commentMismatch')
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

function captureRowDrafts(): void {
  for (const row of liveRows) {
    const saved = findEntry(directory, row.url)
    // **辞書から消えた行の下書きは、両方まとめて捨てる。**
    // ⚠️ 掃除をコメント側の `if (!row.comment) continue` の後ろに置くと、
    //    `row.comment` は**展開している行にしか付かない**ので、
    //    **畳んだまま削除した行のコメント側の下書きだけが残る。**
    //    同じハンドルを ＋ から再登録したときに、弾かれた 200 字超が赤枠つきで復活する
    if (!saved) {
      rowDrafts.delete(row.key)
      commentDrafts.delete(row.key)
      expandedRows.delete(row.key)
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

/**
 * 「自由文はあるのにテンプレートに `{msg}` が無い」の警告 (AC7)。
 * **保存を待たずに**出す / 消すため、テンプレートの `input` と辞書の再描画の両方から呼ぶ。
 */
/**
 * `{msg}` 不在の警告 (AC7 / AC16)。
 * **`template` × `message` と `commentTemplate` × `commentMessage` の組で判定し、組を跨がない。**
 */
function renderCommentTemplateWarning(): void {
  const warning = msgPlaceholderWarning(currentCommentTemplate(), directory, 'commentMessage')
  commentTemplateWarning.textContent = warning ?? ''
  commentTemplateWarning.hidden = warning === null
}

/**
 * スイッチと辞書のフラグの食い違い (AC13)。**一時表示ではなく常時出す。**
 * 「保存した」のような消える表示にすると、次に開いたときに気づけない。
 */
function renderCommentMismatch(): void {
  const message = commentMismatchMessage(commentReplyEnabled.checked, countReplyToComment(directory))
  commentMismatch.textContent = message ?? ''
  commentMismatch.hidden = message === null
}

/** **いつ見ても正しい**必要があるもの(AC13 の常時表示と AC16 の警告)をまとめて描き直す */
function renderAlwaysOnNotices(): void {
  renderAlwaysOnNotices()
}

function renderTemplateWarning(): void {
  const warning = msgPlaceholderWarning(currentTemplate(), directory)
  templateWarning.textContent = warning ?? ''
  templateWarning.hidden = warning === null
}

function refreshTemplateDependent(): void {
  renderTemplateWarning()
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

function renderDirectory(): void {
  // **行を消す前に**編集中の値を退避する。ここを飛ばすと未保存の入力がそのまま消える
  captureRowDrafts()
  directoryRows.textContent = ''
  // 行を作り直すので、前の行に紐づいた更新関数は捨てる
  templateDependents.length = 0

  if (directory.length === 0) {
    const row = document.createElement('tr')
    const cell = document.createElement('td')
    cell.colSpan = 4
    cell.className = 'empty'
    cell.textContent = 'まだ登録がありません。リダイレクトを受けると自動で追加されます。'
    row.appendChild(cell)
    directoryRows.appendChild(row)
    // ⚠️ **早期 return でも 3 本とも呼ぶ。**片方だけにすると「最後の 1 件を削除した」遷移で
    //    AC13 の常時表示と AC16 の警告が**古い内容のまま残る**(次の描画でも同じ経路を通るので
    //    自己回復しない)。常時表示は「いつ見ても正しい」ことが要件
    renderAlwaysOnNotices()
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

    const reasons = ineffectiveReasons(entry, shown.message, commentShown.message, {
      template: currentTemplate(),
      commentTemplate: currentCommentTemplate(),
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
      void persistDirectory(
        `${displayHandle(entry)} のコメント返しを${flag.checked ? 'ON' : 'OFF'}にした`,
      )
    })
    flagLabel.prepend(flag)
    flagRow.appendChild(flagLabel)
    detailCell.appendChild(flagRow)

    /** 自由文 1 本ぶんの欄を作る。**リダイレクト用とコメント用で同じ規則を使う** (AC16) */
    const makeMessageField = (
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
  cooldownSec.value = String(config.cooldownSec)
  showManualTrigger.checked = config.showManualTrigger
  debug.checked = config.debug
  commentReplyEnabled.checked = config.commentReplyEnabled
  commentTemplate.value = config.commentTemplate
  renderPreview()
  refreshTemplateDependent()
  renderCommentTemplateWarning()
  renderCommentMismatch()
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
  renderCommentTemplateWarning()
  // 「効かない行」の印は**組ごと**に判定するので、こちらの変更でも描き直す (AC13 / AC16)
  renderDirectory()
})

// スイッチと辞書の食い違いは**常時表示**。保存を待たずに追従させる (AC13)
commentReplyEnabled.addEventListener('change', renderCommentMismatch)

save.addEventListener('click', () => {
  void (async () => {
    const saved = await saveConfig({
      enabled: enabled.checked,
      template: template.value,
      pinMode: pinMode.value as PinMode,
      cooldownSec: Number(cooldownSec.value),
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
