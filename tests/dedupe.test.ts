import { describe, expect, it } from 'vitest'
import { createDedupe } from '../src/dedupe'
import type { RedirectEvent } from '../src/types'
import { FAKE_CHANNEL, FAKE_OTHER_CHANNEL } from './fixtures/live-chat'

function ev(url: string, detectedAt = 0): RedirectEvent {
  return { sourceChannelName: 'x', sourceChannelUrl: url, detectedAt }
}

describe('createDedupe (AC4)', () => {
  it('同一送信元の連続発火を抑止する', () => {
    const dedupe = createDedupe(60)
    expect(dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 0)).toBe(true)
    expect(dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 1_000)).toBe(false)
    expect(dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 59_999)).toBe(false)
  })

  it('クールダウン明けは再び通す', () => {
    const dedupe = createDedupe(60)
    dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 0)
    expect(dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 60_000)).toBe(true)
  })

  it('送信元が違えば独立して通す', () => {
    const dedupe = createDedupe(60)
    expect(dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 0)).toBe(true)
    expect(dedupe.tryAcquire(ev(FAKE_OTHER_CHANNEL.url), 0)).toBe(true)
  })

  it('URL の大小文字・前後の空白の違いは同一送信元として扱う', () => {
    const dedupe = createDedupe(60)
    expect(dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 0)).toBe(true)
    expect(dedupe.tryAcquire(ev(`  ${FAKE_CHANNEL.url.toUpperCase()} `), 0)).toBe(false)
  })

  it('配信をまたいだら (reset) 再び通す', () => {
    const dedupe = createDedupe(3600)
    dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 0)
    dedupe.reset()
    expect(dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 1_000)).toBe(true)
  })

  it('クールダウン 0 なら抑止しない', () => {
    const dedupe = createDedupe(0)
    expect(dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 0)).toBe(true)
    expect(dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 0)).toBe(true)
  })

  it('設定変更でクールダウンを差し替えられる', () => {
    const dedupe = createDedupe(0)
    dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 0)
    dedupe.setCooldownSec(60)
    expect(dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 1_000)).toBe(false)
  })
})
