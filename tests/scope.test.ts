import { describe, expect, it } from 'vitest'
import { decideScope } from '../src/scope'

// 2026-08-06 の事故: www.youtube.com のライブチャットは他人の配信でも開けるため、
// そこで動かすと、他人の配信がリダイレクトを受けたときに自分の名義で投稿してしまう。
describe('decideScope', () => {
  it('Studio のライブ管制室は常に許可(自分の配信でしか開けない)', () => {
    expect(decideScope('studio.youtube.com', false).allowed).toBe(true)
    expect(decideScope('studio.youtube.com', true).allowed).toBe(true)
  })

  it('www.youtube.com は既定で不許可', () => {
    expect(decideScope('www.youtube.com', false).allowed).toBe(false)
  })

  it('www.youtube.com は明示的に許可したときだけ動く', () => {
    expect(decideScope('www.youtube.com', true).allowed).toBe(true)
  })

  it('不許可のときは理由を返す', () => {
    expect(decideScope('www.youtube.com', false).reason).toContain('他人のチャット')
  })
})
