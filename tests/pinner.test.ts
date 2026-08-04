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
  document.querySelector('#banner-container')!.appendChild(makePinnedBanner())
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

    it('「固定を解除」を「固定」と取り違えない', async () => {
      const message = mountMessage({ pinLabel: '固定を解除' })
      expect(await pin(message, 'always', FAST)).toBe('unavailable')
    })
  })

  it('英語 UI の "Pin message" でも固定できる', async () => {
    const message = mountMessage({ pinLabel: 'Pin message' })
    expect(await pin(message, 'always', FAST)).toBe('pinned')
  })
})
