/**
 * 設定 UI (T7)。テンプレート編集 / ON・OFF / クールダウン / 固定モード。
 */
import { compose } from '../composer'
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
  upsertMessage,
  upsertNickname,
} from '../directory'
import type { Directory } from '../directory'
import { clearPostLog, loadPostLog } from '../post-log'
import type { PostLog } from '../post-log'
import type { Config, PinMode, RedirectEvent } from '../types'
import {
  captureRowDraft,
  entryRemainingLength,
  formatRemaining,
  msgPlaceholderWarning,
  rowDraftValues,
  shouldUpsertMessage,
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
const directoryRows = el<HTMLElement>('directoryRows')
const directoryStatus = el<HTMLElement>('directoryStatus')
const newHandle = el<HTMLInputElement>('newHandle')
const newNickname = el<HTMLInputElement>('newNickname')
const newMessage = el<HTMLInputElement>('newMessage')
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
}> = []

/**
 * 画面に出ている行の入力を下書きへ退避する。**行を消す前に呼ぶ。**
 * 触られていない行・保存に反映済みの行・辞書から消えた行の下書きは捨てる
 * (古い値が勝ち続けると、他のタブや ＋ の欄からの変更が画面に出なくなる)。
 */
function captureRowDrafts(): void {
  for (const row of liveRows) {
    const saved = findEntry(directory, row.url)
    const draft = saved ? captureRowDraft(saved, row.shown, row.read(), row.shownFromDraft) : null
    if (draft) rowDrafts.set(row.key, draft)
    else rowDrafts.delete(row.key)
  }
  liveRows.length = 0
}

/** 保存前のテンプレート欄の値。空ならプレビューと同じく既定テンプレートで見積もる */
function currentTemplate(): string {
  return template.value || DEFAULT_CONFIG.template
}

/**
 * 「自由文はあるのにテンプレートに `{msg}` が無い」の警告 (AC7)。
 * **保存を待たずに**出す / 消すため、テンプレートの `input` と辞書の再描画の両方から呼ぶ。
 */
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
    renderTemplateWarning()
    return
  }

  for (const entry of sortForDisplay(directory)) {
    const row = document.createElement('tr')
    const key = directoryKey(entry.url)
    // 未保存の入力があればそれを出す。無ければ保存済みの値
    const savedDraft = rowDrafts.get(key)
    const shown = rowDraftValues(entry, savedDraft)
    /** AC6 で弾かれたまま直っていない理由。再描画をまたいで持ち回る */
    let invalidReason: string | null = shown.invalid ? shown.reason : null

    const handleCell = document.createElement('td')
    handleCell.className = entry.lastSeenAt ? 'handle' : 'handle unseen'
    handleCell.textContent = displayHandle(entry)
    handleCell.title = entry.lastSeenAt ? entry.url : `${entry.url}(まだリダイレクトを受けていない)`

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

    // --- 自由文 (`{msg}`) --------------------------------------------------
    const messageCell = document.createElement('td')
    messageCell.className = 'msg'
    const messageInput = document.createElement('input')
    messageInput.type = 'text'
    messageInput.value = shown.message
    messageInput.placeholder = '(未設定 — {msg} は消える)'
    if (invalidReason !== null) {
      // 弾かれた状態のまま作り直した行。赤枠と理由も一緒に戻す
      messageInput.classList.add('invalid')
      messageInput.title = invalidReason
    }

    const remaining = document.createElement('span')
    remaining.className = 'remaining'

    // 残りは**展開後の投稿文全体**に対して出す (AC8)。呼び名は保存前の入力値を使う
    // (保存を待って数字が動くと、書いている最中の値と食い違う)
    const updateRemaining = (): void => {
      const left = entryRemainingLength(
        currentTemplate(),
        { url: entry.url, nickname: input.value },
        messageInput.value.trim(),
      )
      remaining.textContent = formatRemaining(left)
      remaining.classList.toggle('over', left < 0)
      remaining.title =
        left < 0
          ? '投稿時に 自由文 → 表示名 → 末尾 の順で削られます(保存はできます)'
          : '投稿文全体 (200 字) に対する残り'
    }
    updateRemaining()
    messageInput.addEventListener('input', updateRemaining)
    input.addEventListener('input', updateRemaining)
    templateDependents.push(updateRemaining)

    messageInput.addEventListener('change', () => {
      const checked = validateEntryMessage(messageInput.value)
      if (!checked.ok) {
        // **切り詰めて黙って保存しない** (AC6)。入力はそのまま残し、その場で直せるようにする。
        // 他の行を触って再描画が走っても消えないよう、理由も下書きに載せる
        invalidReason = checked.reason
        messageInput.classList.add('invalid')
        messageInput.title = checked.reason
        setDirectoryStatus(`${displayHandle(entry)}: ${checked.reason}`)
        return
      }
      invalidReason = null
      messageInput.classList.remove('invalid')
      messageInput.title = ''
      directory = upsertMessage(directory, entry.url, checked.value)
      void persistDirectory(`${displayHandle(entry)} の自由文を保存した`)
    })
    messageCell.append(messageInput, remaining)

    liveRows.push({
      key,
      url: entry.url,
      shown: { nickname: shown.nickname, message: shown.message },
      // 下書きから描いた行では「shown と同じ = 打っていない」が成り立たない。
      // これを渡さないと、再描画 2 回目で下書きが自分自身を捨てる
      shownFromDraft: savedDraft !== undefined,
      read: () => ({
        nickname: input.value,
        message: messageInput.value,
        invalid: invalidReason !== null,
        reason: invalidReason,
      }),
    })

    const actionCell = document.createElement('td')
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.textContent = '削除'
    remove.title = '一覧から削除する'
    remove.addEventListener('click', () => {
      directory = removeEntry(directory, entry.url)
      void persistDirectory(`${displayHandle(entry)} を削除した`)
    })
    actionCell.appendChild(remove)

    row.append(handleCell, nicknameCell, messageCell, actionCell)
    directoryRows.appendChild(row)
  }

  renderTemplateWarning()
}

addEntry.addEventListener('click', () => {
  const url = normalizeChannelUrl(newHandle.value)
  if (!url) {
    setDirectoryStatus('チャンネルの @ハンドル または URL を入れてください')
    return
  }
  // 新規登録も**行の編集と同じ検証**を通す (AC6)。ここだけ素通しすると 200 字超が入る
  const checked = validateEntryMessage(newMessage.value)
  if (!checked.ok) {
    newMessage.classList.add('invalid')
    setDirectoryStatus(checked.reason)
    return
  }
  newMessage.classList.remove('invalid')
  // **既に登録されているハンドルを ＋ の欄から入れ直したときに、空欄で自由文を消さない。**
  // 呼び名の上書きは 003 より前からの挙動なのでそのまま(ここでは変えない)
  const existing = findEntry(directory, url)
  const withNickname = upsertNickname(directory, url, newNickname.value.trim())
  directory = shouldUpsertMessage(existing, checked.value)
    ? upsertMessage(withNickname, url, checked.value)
    : withNickname
  newHandle.value = ''
  newNickname.value = ''
  newMessage.value = ''
  void persistDirectory('登録した')
})

for (const input of [newHandle, newNickname, newMessage]) {
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
    cell.colSpan = 3
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

    const textCell = document.createElement('td')
    textCell.className = 'text'
    textCell.textContent = record.text

    const timeCell = document.createElement('td')
    timeCell.textContent = new Date(record.postedAt).toLocaleString()
    timeCell.title = record.streamId ? `配信 ID: ${record.streamId}` : '配信 ID が取れなかった回'

    row.append(handleCell, textCell, timeCell)
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
const status = el<HTMLElement>('status')
const save = el<HTMLButtonElement>('save')

function renderPreview(): void {
  // サンプルの自由文を入れて出す (AC7)。`{msg}` を足したときの見た目がその場で分かる
  preview.textContent = compose(currentTemplate(), SAMPLE_EVENT, { message: SAMPLE_MESSAGE })
}

function apply(config: Config): void {
  enabled.checked = config.enabled
  template.value = config.template
  pinMode.value = config.pinMode
  cooldownSec.value = String(config.cooldownSec)
  showManualTrigger.checked = config.showManualTrigger
  debug.checked = config.debug
  renderPreview()
  refreshTemplateDependent()
}

// **保存を待たずに**警告と残り文字数を追従させる (AC7 / AC8)
template.addEventListener('input', () => {
  renderPreview()
  refreshTemplateDependent()
})

save.addEventListener('click', () => {
  void (async () => {
    const saved = await saveConfig({
      enabled: enabled.checked,
      template: template.value,
      pinMode: pinMode.value as PinMode,
      cooldownSec: Number(cooldownSec.value),
      showManualTrigger: showManualTrigger.checked,
      debug: debug.checked,
    })
    apply(saved)
    status.textContent = '保存した'
    setTimeout(() => (status.textContent = ''), 2000)
  })()
})

void loadConfig().then(apply)
