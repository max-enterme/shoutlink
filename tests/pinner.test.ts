import { beforeEach, describe, expect, it } from 'vitest'
import { pin } from '../src/pinner'
import type { PinMode } from '../src/types'
import { makeOwnMessageWithMenu, makePinnedBanner, mountChatShell } from './fixtures/live-chat'

const FAST = { menuTimeoutMs: 200, menuIntervalMs: 10 }

function mountMessage(opts: { pinLabel?: string | null } = {}): HTMLElement {
  const { items } = mountChatShell()
  const message = makeOwnMessageWithMenu('テスト投稿', opts)
  items.appendChild(message)
  return message
}

function mountPinnedBanner(): void {
  document.querySelector('#visible-banners')!.appendChild(makePinnedBanner())
}

function pinnedMenuClicked(): boolean {
  return Array.from(document.querySelectorAll('ytd-menu-service-item-renderer')).length > 0
}

describe('pin (AC3 / AC8) — PinMode × 既存固定の有無', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  describe('off', () => {
    it('既存の固定が無くても固定しない', async () => {
      const message = mountMessage()
      expect(await pin(message, 'off', FAST)).toBe('skipped')
      expect(pinnedMenuClicked()).toBe(false)
    })

    it('既存の固定があっても固定しない', async () => {
      const message = mountMessage()
      mountPinnedBanner()
      expect(await pin(message, 'off', FAST)).toBe('skipped')
    })
  })

  describe('ifEmpty', () => {
    it('既存の固定が無ければ固定する', async () => {
      const message = mountMessage()
      expect(await pin(message, 'ifEmpty', FAST)).toBe('pinned')
    })

    // 回帰テスト: 2026-08-05 に実 DOM で判明した不具合。
    // yt-live-chat-pinned-message-renderer は何も固定していなくても hidden で常駐するため、
    // 要素の有無だけで判定すると ifEmpty が一度も固定しなくなる。
    it('固定していないときの hidden な placeholder を「固定中」と誤判定しない', async () => {
      const message = mountMessage()
      expect(document.querySelector('yt-live-chat-pinned-message-renderer[hidden]')).not.toBeNull()
      expect(await pin(message, 'ifEmpty', FAST)).toBe('pinned')
    })

    it('既存の固定があれば固定しない', async () => {
      const message = mountMessage()
      mountPinnedBanner()
      expect(await pin(message, 'ifEmpty', FAST)).toBe('skipped')
      expect(pinnedMenuClicked()).toBe(false)
    })
  })

  describe('always', () => {
    it('既存の固定が無ければ固定する', async () => {
      const message = mountMessage()
      expect(await pin(message, 'always', FAST)).toBe('pinned')
    })

    it('既存の固定があっても固定する', async () => {
      const message = mountMessage()
      mountPinnedBanner()
      expect(await pin(message, 'always', FAST)).toBe('pinned')
    })
  })

  describe('固定 UI が見つからない場合 (AC6 / plan.md R3)', () => {
    it('メニューボタンが無ければ unavailable', async () => {
      const { items } = mountChatShell()
      const message = document.createElement('yt-live-chat-text-message-renderer')
      items.appendChild(message)
      for (const mode of ['ifEmpty', 'always'] as PinMode[]) {
        expect(await pin(message, mode, FAST)).toBe('unavailable')
      }
    })

    it('メニューに「固定」項目が無ければ unavailable', async () => {
      const message = mountMessage({ pinLabel: null })
      expect(await pin(message, 'always', FAST)).toBe('unavailable')
    })

    /**
     * 回帰テスト: 2026-08-07 に実配信で判明。
     * チャットの「Q&A を開始 / アンケートを開始 / 閉じる」メニューは**閉じたまま DOM に常駐**し、
     * `aria-hidden="true"` も付かない。これを「開いているメニュー」として読んでいたため、
     * メッセージのメニューが開いていないのに「固定項目が無い」と誤って報告していた。
     */
    it('閉じているドロップダウンの項目を「開いているメニュー」として読まない', async () => {
      const message = mountMessage({ pinLabel: null })
      const closed = document.createElement('tp-yt-iron-dropdown')
      closed.style.display = 'none'
      for (const label of ['Q&A を開始', 'アンケートを開始', 'メッセージを固定']) {
        const item = document.createElement('ytd-menu-service-item-renderer')
        item.textContent = label
        closed.appendChild(item)
      }
      document.body.appendChild(closed)

      // 閉じたメニューの中に「メッセージを固定」があっても、それを押してはいけない
      expect(await pin(message, 'always', FAST)).toBe('unavailable')
    })

  })

  /**
   * 回帰テスト: 2026-08-07 に実配信で判明。
   * **既に固定されているメッセージのメニューには「メッセージを固定」が無く、「固定を解除」が出る。**
   * これを見ないと、固定済みなのに `unavailable` を警告し続ける。
   */
  describe('対象が既に固定されている場合', () => {
    it('「固定を解除」しか無ければ、固定済みとみなして pinned を返す', async () => {
      const message = mountMessage({ pinLabel: '固定を解除' })
      expect(await pin(message, 'always', FAST)).toBe('pinned')
    })

    it('「固定を解除」を押さない(固定を外してしまわない)', async () => {
      const clicked: string[] = []
      const spy = (e: Event): void => {
        const el = e.target as HTMLElement
        if (el.tagName?.toLowerCase() === 'ytd-menu-service-item-renderer') {
          clicked.push(el.textContent ?? '')
        }
      }
      document.addEventListener('click', spy, true)
      try {
        const message = mountMessage({ pinLabel: '固定を解除' })
        await pin(message, 'always', FAST)
      } finally {
        document.removeEventListener('click', spy, true)
      }
      expect(clicked).toEqual([])
    })
  })

  it('英語 UI の "Pin message" でも固定できる', async () => {
    const message = mountMessage({ pinLabel: 'Pin message' })
    expect(await pin(message, 'always', FAST)).toBe('pinned')
  })
})
