import { describe, expect, it } from 'vitest'
import {
  displayHandle,
  normalizeDirectory,
  rememberSource,
  removeEntry,
  resolveDisplayName,
  sortForDisplay,
  upsertNickname,
} from '../src/directory'
import type { Directory } from '../src/directory'
import type { RedirectEvent } from '../src/types'
import { FAKE_CHANNEL, FAKE_OTHER_CHANNEL } from './fixtures/live-chat'

function ev(url: string, name = 'そのままの表示名', detectedAt = 100): RedirectEvent {
  return { sourceChannelName: name, sourceChannelUrl: url, detectedAt }
}

describe('resolveDisplayName', () => {
  it('辞書に呼び名があればそれを使う', () => {
    const directory: Directory = [{ url: FAKE_CHANNEL.url, nickname: 'れい', lastSeenAt: 1 }]
    expect(resolveDisplayName(directory, ev(FAKE_CHANNEL.url))).toBe('れい')
  })

  it('登録が無ければ検知した表示名のまま', () => {
    expect(resolveDisplayName([], ev(FAKE_CHANNEL.url, '@example-channel'))).toBe('@example-channel')
  })

  it('登録があっても呼び名が空ならハンドルのまま', () => {
    const directory: Directory = [{ url: FAKE_CHANNEL.url, nickname: '', lastSeenAt: 1 }]
    expect(resolveDisplayName(directory, ev(FAKE_CHANNEL.url, '@example-channel'))).toBe(
      '@example-channel',
    )
  })

  it('呼び名が空白だけなら未設定として扱う', () => {
    const directory: Directory = [{ url: FAKE_CHANNEL.url, nickname: '   ', lastSeenAt: 1 }]
    expect(resolveDisplayName(directory, ev(FAKE_CHANNEL.url, '@example-channel'))).toBe(
      '@example-channel',
    )
  })

  it('URL の大小文字が違っても同じ登録とみなす', () => {
    const directory: Directory = [{ url: FAKE_CHANNEL.url.toUpperCase(), nickname: 'れい', lastSeenAt: 1 }]
    expect(resolveDisplayName(directory, ev(FAKE_CHANNEL.url))).toBe('れい')
  })
})

describe('rememberSource', () => {
  it('未登録の相手を呼び名なしで追加する', () => {
    const next = rememberSource([], ev(FAKE_CHANNEL.url, 'x', 42))
    expect(next).toEqual([{ url: FAKE_CHANNEL.url, nickname: '', lastSeenAt: 42 }])
  })

  it('既存の登録は呼び名を保ったまま lastSeenAt だけ更新する', () => {
    const directory: Directory = [{ url: FAKE_CHANNEL.url, nickname: 'れい', lastSeenAt: 1 }]
    expect(rememberSource(directory, ev(FAKE_CHANNEL.url, 'x', 99))).toEqual([
      { url: FAKE_CHANNEL.url, nickname: 'れい', lastSeenAt: 99 },
    ])
  })

  it('同じ相手を何度受けても重複しない', () => {
    let directory = rememberSource([], ev(FAKE_CHANNEL.url, 'x', 1))
    directory = rememberSource(directory, ev(FAKE_CHANNEL.url, 'x', 2))
    expect(directory).toHaveLength(1)
  })

  it('元の配列を書き換えない', () => {
    const directory: Directory = []
    rememberSource(directory, ev(FAKE_CHANNEL.url))
    expect(directory).toEqual([])
  })
})

describe('upsertNickname / removeEntry', () => {
  it('未登録なら手動登録として追加する (lastSeenAt は 0)', () => {
    expect(upsertNickname([], FAKE_CHANNEL.url, 'れい')).toEqual([
      { url: FAKE_CHANNEL.url, nickname: 'れい', lastSeenAt: 0 },
    ])
  })

  it('既存の呼び名を更新する', () => {
    const directory: Directory = [{ url: FAKE_CHANNEL.url, nickname: 'ふるい', lastSeenAt: 5 }]
    expect(upsertNickname(directory, FAKE_CHANNEL.url, 'あたらしい')).toEqual([
      { url: FAKE_CHANNEL.url, nickname: 'あたらしい', lastSeenAt: 5 },
    ])
  })

  it('削除できる', () => {
    const directory: Directory = [{ url: FAKE_CHANNEL.url, nickname: 'れい', lastSeenAt: 1 }]
    expect(removeEntry(directory, FAKE_CHANNEL.url)).toEqual([])
  })
})

describe('displayHandle / sortForDisplay', () => {
  it('URL からハンドルを取り出す', () => {
    expect(displayHandle({ url: FAKE_CHANNEL.url, nickname: '', lastSeenAt: 0 })).toBe(
      FAKE_CHANNEL.handle,
    )
  })

  it('最近受けた順に並べ、手動登録 (lastSeenAt 0) は末尾', () => {
    const directory: Directory = [
      { url: FAKE_OTHER_CHANNEL.url, nickname: '', lastSeenAt: 0 },
      { url: FAKE_CHANNEL.url, nickname: '', lastSeenAt: 10 },
    ]
    expect(sortForDisplay(directory).map((e) => e.url)).toEqual([
      FAKE_CHANNEL.url,
      FAKE_OTHER_CHANNEL.url,
    ])
  })
})

describe('normalizeDirectory', () => {
  it('配列でなければ空', () => {
    expect(normalizeDirectory(undefined)).toEqual([])
    expect(normalizeDirectory({ url: FAKE_CHANNEL.url })).toEqual([])
  })

  it('URL の無い項目は捨てる', () => {
    expect(normalizeDirectory([{ nickname: 'れい' }, null, 'x'])).toEqual([])
  })

  it('欠けた値を埋め、重複を落とす', () => {
    expect(
      normalizeDirectory([
        { url: FAKE_CHANNEL.url },
        { url: FAKE_CHANNEL.url.toUpperCase(), nickname: 'あとの方' },
      ]),
    ).toEqual([{ url: FAKE_CHANNEL.url, nickname: '', lastSeenAt: 0 }])
  })
})
