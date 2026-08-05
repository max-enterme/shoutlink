import { describe, expect, it } from 'vitest'
import { decideScope } from '../src/scope'

// 2026-08-06 の事故: www.youtube.com のライブチャットは他人の配信でも開けるため、
// そこで動かすと、他人の配信がリダイレクトを受けたときに自分の名義で投稿してしまう。
describe('decideScope', () => {
  it('Studio のライブ管制室だけ許可(自分の配信でしか開けない)', () => {
    expect(decideScope('studio.youtube.com').allowed).toBe(true)
  })

  it('www.youtube.com では動かない', () => {
    expect(decideScope('www.youtube.com').allowed).toBe(false)
  })

  it('m.youtube.com など他のホストでも動かない', () => {
    expect(decideScope('m.youtube.com').allowed).toBe(false)
    expect(decideScope('example.com').allowed).toBe(false)
  })

  it('不許可のときは理由を返す', () => {
    expect(decideScope('www.youtube.com').reason).toContain('他人のチャット')
  })
})
