/**
 * poster は DOM 操作の実体であり、**実際の合否は実配信での通し確認 (T8) に依存する**
 * (plan.md テスト戦略)。ここで見るのは骨組みだけ:
 * 入力欄が無いときに諦めること、送信経路を通ること、投稿したメッセージ要素を返すこと。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { postMessage } from '../src/poster'
import { makeChatMessage, mountChatShell } from './fixtures/live-chat'

const FAST = { confirmTimeoutMs: 300, confirmIntervalMs: 10 }

describe('postMessage', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('入力欄が見つからなければ諦める (AC6: 例外を投げない)', async () => {
    const result = await postMessage('やあ', FAST)
    expect(result).toEqual({ status: 'failed', reason: 'no-input' })
  })

  it('入力欄に文字を入れて送信ボタンを押し、投稿されたメッセージ要素を返す', async () => {
    const { items, input, sendButton } = mountChatShell()
    sendButton.addEventListener('click', () => {
      items.appendChild(makeChatMessage(input.textContent ?? '', 'me'))
    })

    const result = await postMessage('ありがとうございます https://www.youtube.com/@example-channel', FAST)

    expect(result.status).toBe('posted')
    expect(input.textContent).toBe('ありがとうございます https://www.youtube.com/@example-channel')
    expect(result.status === 'posted' && result.element).not.toBeNull()
  })

  it('投稿されたメッセージ要素を特定できなくても投稿は成立扱いにする (AC6)', async () => {
    mountChatShell() // 送信しても何も現れない
    const result = await postMessage('やあ', FAST)
    expect(result).toEqual({ status: 'posted', element: null })
  })

  it('送信ボタンが無ければ Enter で送る', async () => {
    const { items, input } = mountChatShell()
    document.querySelector('#send-button')!.remove()
    input.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Enter') {
        items.appendChild(makeChatMessage(input.textContent ?? '', 'me'))
      }
    })

    const result = await postMessage('やあ', FAST)
    expect(result.status === 'posted' && result.element).not.toBeNull()
  })
})
