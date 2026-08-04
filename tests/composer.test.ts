import { describe, expect, it } from 'vitest'
import { MAX_MESSAGE_LENGTH, compose } from '../src/composer'
import { DEFAULT_CONFIG } from '../src/config'
import type { RedirectEvent } from '../src/types'
import { FAKE_CHANNEL } from './fixtures/live-chat'

const event: RedirectEvent = {
  sourceChannelName: FAKE_CHANNEL.name,
  sourceChannelUrl: FAKE_CHANNEL.url,
  detectedAt: 0,
}

describe('compose', () => {
  it('{name} と {url} を差し込む (AC2 / AC5)', () => {
    expect(compose('{name}さんからリダイレクトありがとうございます! {url}', event)).toBe(
      `${FAKE_CHANNEL.name}さんからリダイレクトありがとうございます! ${FAKE_CHANNEL.url}`,
    )
  })

  it('既定テンプレートに URL と表示名が両方入る (AC2)', () => {
    const text = compose(DEFAULT_CONFIG.template, event)
    expect(text).toContain(FAKE_CHANNEL.url)
    expect(text).toContain(FAKE_CHANNEL.name)
  })

  it('同じプレースホルダを複数回使える', () => {
    expect(compose('{name} / {name} / {url}', event)).toBe(
      `${FAKE_CHANNEL.name} / ${FAKE_CHANNEL.name} / ${FAKE_CHANNEL.url}`,
    )
  })

  it('未知のプレースホルダはそのまま残す', () => {
    expect(compose('{name} {foo}', event)).toBe(`${FAKE_CHANNEL.name} {foo}`)
  })

  it('差し込んだ値の中の {url} を再展開しない', () => {
    const tricky = { ...event, sourceChannelName: '{url}' }
    expect(compose('{name}', tricky)).toBe('{url}')
  })

  it('改行・制御文字を落として 1 行にする', () => {
    const dirty = { ...event, sourceChannelName: 'Multi\nLine\tName' }
    expect(compose('{name}', dirty)).toBe('Multi Line Name')
  })

  it('URL を含まないテンプレートも許す (R2: スパムフィルタ回避の代替文面)', () => {
    expect(compose('{name}さんありがとうございます!', event)).toBe(
      `${FAKE_CHANNEL.name}さんありがとうございます!`,
    )
  })

  it('上限を超えるときは表示名を削り、URL は壊さない', () => {
    const long = { ...event, sourceChannelName: 'あ'.repeat(300) }
    const text = compose('{name}さんからリダイレクトありがとうございます! {url}', long)
    expect(text.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH)
    expect(text).toContain(FAKE_CHANNEL.url)
  })

  it('表示名を削っても収まらない場合は末尾を切る', () => {
    const text = compose(`${'x'.repeat(300)}{url}`, event, { maxLength: 50 })
    expect(text).toHaveLength(50)
  })
})
