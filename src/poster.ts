/**
 * チャット入力欄への投稿と、投稿された自分のメッセージ要素の特定 (T5)。
 *
 * DOM に触る 3 モジュールのひとつ。セレクタは selectors.ts に集約してあり、
 * ここは「見つけた要素をどう操作するか」だけを持つ。
 *
 * ⚠️ 入力欄への値の入れ方・送信の起こし方は T1 未実施のため推測を含む。
 */
import { log } from './log'
import { getChatInput, getChatMessages, getMessageText, getSendButton } from './selectors'
import { waitFor } from './wait'

export type PostOutcome =
  | {
      status: 'posted'
      /** 投稿後に特定できた自分のメッセージ要素。特定できなければ null(固定はスキップされる) */
      element: HTMLElement | null
    }
  | { status: 'failed'; reason: 'no-input' }

export type PostOptions = {
  root?: ParentNode
  /** 自分のメッセージが DOM に現れるのを待つ上限 */
  confirmTimeoutMs?: number
  confirmIntervalMs?: number
}

/**
 * 入力欄にテキストを入れる。
 * TODO(T1): 実 DOM で要確認。YouTube の入力欄は contenteditable な div で、
 *           `input` イベントで内部状態を更新している想定。実際に送信ボタンが
 *           有効化されるかは実配信で確認するまで確証がない。
 */
function setInputValue(input: HTMLElement, text: string): void {
  if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
    input.focus()
    input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return
  }

  input.focus()
  input.textContent = text
  input.dispatchEvent(
    new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }),
  )
}

function isDisabled(el: HTMLElement): boolean {
  if (el instanceof HTMLButtonElement && el.disabled) return true
  return el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled')
}

/**
 * Enter キーによる送信。送信ボタンが見つからない / 無効なときのフォールバック。
 * TODO(T1): 実 DOM で要確認。
 */
function pressEnter(input: HTMLElement): void {
  for (const type of ['keydown', 'keypress', 'keyup'] as const) {
    input.dispatchEvent(
      new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }),
    )
  }
}

/**
 * 投稿したメッセージ要素を、本文一致で新しい方から探す。
 * TODO(T1): 実 DOM で要確認。本来は投稿者が自分であることも見るべきだが、
 *           自分のチャンネルを DOM から特定する手段が未確認のため本文一致だけで判定している。
 */
function findOwnMessage(root: ParentNode, text: string): HTMLElement | null {
  const needle = text.replace(/\s+/g, ' ').trim()
  if (!needle) return null
  for (const message of getChatMessages(root).reverse()) {
    if (getMessageText(message).includes(needle)) return message
  }
  return null
}

/**
 * テキストを投稿し、投稿された自分のメッセージ要素を返す。
 *
 * メッセージ要素が特定できなくても投稿自体は成立しているとみなす (AC6)。
 * その場合 `element: null` を返し、呼び出し側は固定をスキップする。
 */
export async function postMessage(text: string, opts: PostOptions = {}): Promise<PostOutcome> {
  const root = opts.root ?? document

  const input = getChatInput(root)
  if (!input) {
    log.warn('チャット入力欄が見つからない。投稿を諦める')
    return { status: 'failed', reason: 'no-input' }
  }

  setInputValue(input, text)

  const sendButton = getSendButton(root)
  if (sendButton && !isDisabled(sendButton)) {
    sendButton.click()
  } else if (sendButton) {
    // 無効に見えても、入力反映が非同期なだけの可能性がある。少し待って再試行し、
    // それでも駄目なら Enter で送る。
    const enabled = await waitFor(
      () => (isDisabled(sendButton) ? null : sendButton),
      { timeoutMs: 1000, intervalMs: 100 },
    )
    if (enabled) enabled.click()
    else pressEnter(input)
  } else {
    pressEnter(input)
  }

  const element = await waitFor(() => findOwnMessage(root, text), {
    timeoutMs: opts.confirmTimeoutMs ?? 5000,
    intervalMs: opts.confirmIntervalMs ?? 250,
  })

  if (!element) log.warn('投稿したメッセージ要素を特定できなかった。固定はスキップされる')
  return { status: 'posted', element }
}
