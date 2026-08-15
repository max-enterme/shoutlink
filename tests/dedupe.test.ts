import { describe, expect, it } from 'vitest'
import { UNKNOWN_STREAM_MIN_COOLDOWN_SEC, createDedupe } from '../src/dedupe'
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

/**
 * 2026-08-06 の不具合: チャットを再読み込みすると、残っているリダイレクトの通知を
 * 初期走査が拾い直し、同じ相手へ何度も投稿していた。抑止の記録がメモリ上にしか
 * 無かったため、リロードのたびに白紙に戻っていた。
 */
describe('createDedupe — 保存済みの投稿履歴からの復元', () => {
  const history = [{ url: FAKE_CHANNEL.url, postedAt: 1_000, streamId: 'stream-1' }]

  it('同じ配信で投稿済みなら、クールダウン内は投稿しない(リロードをまたいでも)', () => {
    const dedupe = createDedupe(60, { streamId: 'stream-1', history })
    expect(dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 2_000)).toBe(false)
  })

  it('同じ配信でも、クールダウンが明ければ投稿する', () => {
    const dedupe = createDedupe(60, { streamId: 'stream-1', history })
    expect(dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 61_000)).toBe(true)
  })

  it('配信が違えば、クールダウン内でも投稿する', () => {
    const dedupe = createDedupe(60, { streamId: 'stream-2', history })
    expect(dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 2_000)).toBe(true)
  })

  it('配信 ID が取れないときは、履歴に対してだけクールダウンを長い方へ倒す', () => {
    const floorMs = UNKNOWN_STREAM_MIN_COOLDOWN_SEC * 1_000
    // 設定どおりの 60 秒が明けても、前回の起動での投稿なら止める(通知は消えずに残るため)
    expect(createDedupe(60, { streamId: '', history }).tryAcquire(ev(FAKE_CHANNEL.url), 61_000)).toBe(
      false,
    )
    expect(
      createDedupe(60, { streamId: '', history }).tryAcquire(ev(FAKE_CHANNEL.url), floorMs + 2_000),
    ).toBe(true)
  })

  it('同じ画面のまま連続で発火した場合は、設定どおりのクールダウンで判定する', () => {
    const dedupe = createDedupe(60, { streamId: '' })
    expect(dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 0)).toBe(true)
    expect(dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 59_000)).toBe(false)
    expect(dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 60_000)).toBe(true)
  })

  it('履歴に無い送信元は通す', () => {
    const dedupe = createDedupe(60, { streamId: 'stream-1', history })
    expect(dedupe.tryAcquire(ev(FAKE_OTHER_CHANNEL.url), 2_000)).toBe(true)
  })

  it('クールダウン 0(抑止なし)は履歴があっても通す', () => {
    const dedupe = createDedupe(0, { streamId: 'stream-1', history })
    expect(dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 2_000)).toBe(true)
  })

  it('他の配信の履歴は抑止に使わない(複数の配信の記録が混ざっていても)', () => {
    const mixed = [
      { url: FAKE_CHANNEL.url, postedAt: 1_000, streamId: 'stream-1' },
      { url: FAKE_CHANNEL.url, postedAt: 5_000, streamId: 'stream-2' },
    ]
    // 今は stream-1。stream-2 の新しい記録に引きずられてはいけない
    expect(createDedupe(60, { streamId: 'stream-1', history: mixed }).tryAcquire(
      ev(FAKE_CHANNEL.url),
      61_500,
    )).toBe(true)
    expect(createDedupe(60, { streamId: 'stream-1', history: mixed }).tryAcquire(
      ev(FAKE_CHANNEL.url),
      2_000,
    )).toBe(false)
  })

  it('壊れた履歴は無視する (AC6)', () => {
    const broken = [
      { url: '', postedAt: 1_000 },
      { url: FAKE_CHANNEL.url, postedAt: Number.NaN, streamId: 'stream-1' },
    ]
    const dedupe = createDedupe(60, { streamId: 'stream-1', history: broken })
    expect(dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 2_000)).toBe(true)
  })
})

// --- 004: コメント返しの記録を取り込まない (AC8) ---------------------------------

describe('createDedupe — 種別つきの履歴 (004 / AC8)', () => {
  it('**コメント返しの記録は抑止に取り込まない**(コメント返し済みでもリダイレクト返礼はする)', () => {
    const dedupe = createDedupe(60, {
      streamId: 'stream-1',
      history: [
        { url: FAKE_CHANNEL.url, postedAt: 0, streamId: 'stream-1', kind: 'comment' },
      ],
    })
    expect(dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 1_000)).toBe(true)
  })

  it('リダイレクト返礼の記録は今までどおり抑止に効く', () => {
    const dedupe = createDedupe(60, {
      streamId: 'stream-1',
      history: [
        { url: FAKE_CHANNEL.url, postedAt: 0, streamId: 'stream-1', kind: 'redirect' },
      ],
    })
    expect(dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 1_000)).toBe(false)
  })

  it('**kind の無い記録(004 以前)は redirect として抑止に効く**', () => {
    const dedupe = createDedupe(60, {
      streamId: 'stream-1',
      history: [{ url: FAKE_CHANNEL.url, postedAt: 0, streamId: 'stream-1' }],
    })
    expect(dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 1_000)).toBe(false)
  })

  it('同じ相手にコメント返しとリダイレクト返礼の両方の記録があっても、redirect 側だけを見る', () => {
    const dedupe = createDedupe(60, {
      streamId: 'stream-1',
      history: [
        { url: FAKE_CHANNEL.url, postedAt: 0, streamId: 'stream-1', kind: 'redirect' },
        { url: FAKE_OTHER_CHANNEL.url, postedAt: 0, streamId: 'stream-1', kind: 'comment' },
      ],
    })
    expect(dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 1_000)).toBe(false)
    expect(dedupe.tryAcquire(ev(FAKE_OTHER_CHANNEL.url), 1_000)).toBe(true)
  })

  it('配信 ID が空でも、コメント返しの記録は取り込まない', () => {
    const dedupe = createDedupe(60, {
      history: [{ url: FAKE_CHANNEL.url, postedAt: 0, kind: 'comment' }],
    })
    expect(dedupe.tryAcquire(ev(FAKE_CHANNEL.url), 1_000)).toBe(true)
  })
})
