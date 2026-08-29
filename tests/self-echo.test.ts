/**
 * 自己反射の抑止 (security-review.md S1)。
 *
 * 投稿 → 固定 → その固定バナーを新しい通知として検知 → 投稿 … の自己ループを、
 * **投稿履歴に基づく抑止(同じ配信・同じ相手には 1 回)とは独立して**止められることを確かめる。
 */
import { describe, expect, it } from 'vitest'
import { SELF_ECHO_WINDOW_MS, createSelfEchoGuard } from '../src/self-echo'

describe('createSelfEchoGuard', () => {
  it('覚えていない相手は反射ではない', () => {
    const guard = createSelfEchoGuard()
    expect(guard.isEcho('https://www.youtube.com/@a', 0)).toBe(false)
  })

  it('直前に投稿した相手は反射とみなす', () => {
    const guard = createSelfEchoGuard()
    guard.remember('https://www.youtube.com/@a', 0)
    expect(guard.isEcho('https://www.youtube.com/@a', 1_000)).toBe(true)
  })

  it('窓を過ぎれば反射ではなくなる', () => {
    const guard = createSelfEchoGuard()
    guard.remember('https://www.youtube.com/@a', 0)
    expect(guard.isEcho('https://www.youtube.com/@a', SELF_ECHO_WINDOW_MS)).toBe(false)
  })

  it('別の相手は素通しする', () => {
    const guard = createSelfEchoGuard()
    guard.remember('https://www.youtube.com/@a', 0)
    expect(guard.isEcho('https://www.youtube.com/@b', 1_000)).toBe(false)
  })

  it('URL の表記ゆれ(大小文字・前後の空白)を吸収する', () => {
    const guard = createSelfEchoGuard()
    guard.remember('https://www.youtube.com/@Example', 0)
    expect(guard.isEcho('  https://www.youtube.com/@example  ', 1_000)).toBe(true)
  })

  it('窓の長さは投稿履歴の抑止とは独立している(履歴の有無に関係なく歯止めが残る)', () => {
    const guard = createSelfEchoGuard()
    guard.remember('https://www.youtube.com/@a', 0)
    expect(guard.isEcho('https://www.youtube.com/@a', 1)).toBe(true)
  })

  it('reset で覚えていた相手をすべて忘れる(AC14: 履歴クリア時に呼ぶ)', () => {
    const guard = createSelfEchoGuard()
    guard.remember('https://www.youtube.com/@a', 0)
    guard.reset()
    expect(guard.isEcho('https://www.youtube.com/@a', 1_000)).toBe(false)
  })
})
