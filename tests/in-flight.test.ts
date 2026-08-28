import { describe, expect, it } from 'vitest'
import { createInFlightGuard } from '../src/in-flight'
import { FAKE_CHANNEL, FAKE_OTHER_CHANNEL } from './fixtures/live-chat'

describe('createInFlightGuard (AC1 / AC13)', () => {
  it('同じ URL で begin を 2 回呼ぶと 2 回目は false', () => {
    const guard = createInFlightGuard()
    expect(guard.begin(FAKE_CHANNEL.url)).toBe(true)
    expect(guard.begin(FAKE_CHANNEL.url)).toBe(false)
  })

  it('end の後は再び true(投稿に失敗した後も再び試せる)', () => {
    const guard = createInFlightGuard()
    guard.begin(FAKE_CHANNEL.url)
    guard.end(FAKE_CHANNEL.url)
    expect(guard.begin(FAKE_CHANNEL.url)).toBe(true)
  })

  it('違う URL は互いに影響しない', () => {
    const guard = createInFlightGuard()
    expect(guard.begin(FAKE_CHANNEL.url)).toBe(true)
    expect(guard.begin(FAKE_OTHER_CHANNEL.url)).toBe(true)
  })

  it('URL の表記ゆれ(前後の空白・大文字小文字)を同じ鍵として扱う', () => {
    const guard = createInFlightGuard()
    expect(guard.begin(FAKE_CHANNEL.url)).toBe(true)
    expect(guard.begin(`  ${FAKE_CHANNEL.url.toUpperCase()} `)).toBe(false)
  })

  it('begin してから end するまで isBusy() が true、end の後は false', () => {
    const guard = createInFlightGuard()
    expect(guard.isBusy()).toBe(false)
    guard.begin(FAKE_CHANNEL.url)
    expect(guard.isBusy()).toBe(true)
    guard.end(FAKE_CHANNEL.url)
    expect(guard.isBusy()).toBe(false)
  })

  it('違う URL でも begin されていれば isBusy() は true(入力欄は 1 つしかない)', () => {
    const guard = createInFlightGuard()
    guard.begin(FAKE_CHANNEL.url)
    expect(guard.isBusy()).toBe(true)
  })
})
