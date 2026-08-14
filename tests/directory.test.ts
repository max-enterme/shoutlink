import { afterEach, describe, expect, it } from 'vitest'
import { MAX_ENTRY_MESSAGE_LENGTH } from '../src/composer'
import {
  displayHandle,
  loadDirectory,
  migrateDirectoryToLocal,
  normalizeDirectory,
  rememberSource,
  removeEntry,
  resolveDisplayName,
  resolveMessage,
  saveDirectory,
  sortForDisplay,
  upsertNickname,
} from '../src/directory'
import type { Directory, DirectoryEntry } from '../src/directory'
import type { RedirectEvent } from '../src/types'
import { FAKE_CHANNEL, FAKE_OTHER_CHANNEL } from './fixtures/live-chat'

function ev(url: string, name = 'そのままの表示名', detectedAt = 100): RedirectEvent {
  return { sourceChannelName: name, sourceChannelUrl: url, detectedAt }
}

/** テスト内でだけ使う省略記法。message を書かない既存の観点を短く保つ */
function entry(patch: Partial<DirectoryEntry> & { url: string }): DirectoryEntry {
  return { nickname: '', message: '', lastSeenAt: 0, ...patch }
}

describe('resolveDisplayName', () => {
  it('辞書に呼び名があればそれを使う', () => {
    const directory: Directory = [entry({ url: FAKE_CHANNEL.url, nickname: 'れい', lastSeenAt: 1 })]
    expect(resolveDisplayName(directory, ev(FAKE_CHANNEL.url))).toBe('れい')
  })

  it('登録が無ければ検知した表示名のまま', () => {
    expect(resolveDisplayName([], ev(FAKE_CHANNEL.url, '@example-channel'))).toBe('@example-channel')
  })

  it('登録があっても呼び名が空ならハンドルのまま', () => {
    const directory: Directory = [entry({ url: FAKE_CHANNEL.url, nickname: '', lastSeenAt: 1 })]
    expect(resolveDisplayName(directory, ev(FAKE_CHANNEL.url, '@example-channel'))).toBe(
      '@example-channel',
    )
  })

  it('呼び名が空白だけなら未設定として扱う', () => {
    const directory: Directory = [entry({ url: FAKE_CHANNEL.url, nickname: '   ', lastSeenAt: 1 })]
    expect(resolveDisplayName(directory, ev(FAKE_CHANNEL.url, '@example-channel'))).toBe(
      '@example-channel',
    )
  })

  it('URL の大小文字が違っても同じ登録とみなす', () => {
    const directory: Directory = [
      entry({ url: FAKE_CHANNEL.url.toUpperCase(), nickname: 'れい', lastSeenAt: 1 }),
    ]
    expect(resolveDisplayName(directory, ev(FAKE_CHANNEL.url))).toBe('れい')
  })
})

describe('resolveMessage (AC1)', () => {
  it('辞書に自由文があればそれを返す', () => {
    const directory: Directory = [entry({ url: FAKE_CHANNEL.url, message: 'いつもありがとう' })]
    expect(resolveMessage(directory, ev(FAKE_CHANNEL.url))).toBe('いつもありがとう')
  })

  it('登録が無ければ空文字', () => {
    expect(resolveMessage([], ev(FAKE_CHANNEL.url))).toBe('')
  })

  it('自由文が空白だけなら未設定として扱う', () => {
    const directory: Directory = [entry({ url: FAKE_CHANNEL.url, message: '   ' })]
    expect(resolveMessage(directory, ev(FAKE_CHANNEL.url))).toBe('')
  })

  it('URL の大小文字が違っても同じ登録とみなす', () => {
    const directory: Directory = [
      entry({ url: FAKE_CHANNEL.url.toUpperCase(), message: 'いつもありがとう' }),
    ]
    expect(resolveMessage(directory, ev(FAKE_CHANNEL.url))).toBe('いつもありがとう')
  })

  it('呼び名と自由文は独立して解決される', () => {
    const directory: Directory = [
      entry({ url: FAKE_CHANNEL.url, nickname: 'れい', message: 'いつもありがとう' }),
    ]
    expect(resolveDisplayName(directory, ev(FAKE_CHANNEL.url))).toBe('れい')
    expect(resolveMessage(directory, ev(FAKE_CHANNEL.url))).toBe('いつもありがとう')
  })
})

describe('rememberSource', () => {
  it('未登録の相手を呼び名・自由文なしで追加する', () => {
    const next = rememberSource([], ev(FAKE_CHANNEL.url, 'x', 42))
    expect(next).toEqual([
      { url: FAKE_CHANNEL.url, nickname: '', message: '', lastSeenAt: 42 },
    ])
  })

  it('既存の登録は呼び名と自由文を保ったまま lastSeenAt だけ更新する', () => {
    const directory: Directory = [
      entry({ url: FAKE_CHANNEL.url, nickname: 'れい', message: 'いつもありがとう', lastSeenAt: 1 }),
    ]
    expect(rememberSource(directory, ev(FAKE_CHANNEL.url, 'x', 99))).toEqual([
      { url: FAKE_CHANNEL.url, nickname: 'れい', message: 'いつもありがとう', lastSeenAt: 99 },
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
      { url: FAKE_CHANNEL.url, nickname: 'れい', message: '', lastSeenAt: 0 },
    ])
  })

  it('既存の呼び名を更新する', () => {
    const directory: Directory = [
      entry({ url: FAKE_CHANNEL.url, nickname: 'ふるい', lastSeenAt: 5 }),
    ]
    expect(upsertNickname(directory, FAKE_CHANNEL.url, 'あたらしい')).toEqual([
      { url: FAKE_CHANNEL.url, nickname: 'あたらしい', message: '', lastSeenAt: 5 },
    ])
  })

  it('呼び名を変えても既存の自由文を落とさない', () => {
    const directory: Directory = [
      entry({ url: FAKE_CHANNEL.url, nickname: 'ふるい', message: 'いつもありがとう', lastSeenAt: 5 }),
    ]
    expect(upsertNickname(directory, FAKE_CHANNEL.url, 'あたらしい')).toEqual([
      { url: FAKE_CHANNEL.url, nickname: 'あたらしい', message: 'いつもありがとう', lastSeenAt: 5 },
    ])
  })

  it('削除できる', () => {
    const directory: Directory = [entry({ url: FAKE_CHANNEL.url, nickname: 'れい', lastSeenAt: 1 })]
    expect(removeEntry(directory, FAKE_CHANNEL.url)).toEqual([])
  })
})

describe('displayHandle / sortForDisplay', () => {
  it('URL からハンドルを取り出す', () => {
    expect(displayHandle(entry({ url: FAKE_CHANNEL.url }))).toBe(FAKE_CHANNEL.handle)
  })

  it('最近受けた順に並べ、手動登録 (lastSeenAt 0) は末尾', () => {
    const directory: Directory = [
      entry({ url: FAKE_OTHER_CHANNEL.url, lastSeenAt: 0 }),
      entry({ url: FAKE_CHANNEL.url, lastSeenAt: 10 }),
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
    ).toEqual([{ url: FAKE_CHANNEL.url, nickname: '', message: '', lastSeenAt: 0 }])
  })

  // AC10: 自由文が欠損・文字列でない保存内容でも落ちず、空文字で埋まる
  it('003 より前に保存された(message の無い)辞書を空文字で受ける', () => {
    expect(normalizeDirectory([{ url: FAKE_CHANNEL.url, nickname: 'れい', lastSeenAt: 3 }])).toEqual(
      [{ url: FAKE_CHANNEL.url, nickname: 'れい', message: '', lastSeenAt: 3 }],
    )
  })

  it('message が文字列でなければ空文字にする', () => {
    for (const message of [null, 42, { a: 1 }, ['x'], true]) {
      expect(normalizeDirectory([{ url: FAKE_CHANNEL.url, message }])[0]?.message).toBe('')
    }
  })

  it('MAX_ENTRY_MESSAGE_LENGTH を超える自由文は切り詰める', () => {
    const long = 'あ'.repeat(MAX_ENTRY_MESSAGE_LENGTH + 50)
    const normalized = normalizeDirectory([{ url: FAKE_CHANNEL.url, message: long }])
    expect(normalized[0]?.message).toHaveLength(MAX_ENTRY_MESSAGE_LENGTH)
  })

  it('切り詰めでサロゲートペアを割らない', () => {
    // 上限ちょうどの位置に絵文字が来る並び。コードポイントで数えるので絵文字ごと残る
    const message = 'あ'.repeat(MAX_ENTRY_MESSAGE_LENGTH - 1) + '🎉' + 'い'
    const normalized = normalizeDirectory([{ url: FAKE_CHANNEL.url, message }])
    expect(normalized[0]?.message).toBe('あ'.repeat(MAX_ENTRY_MESSAGE_LENGTH - 1) + '🎉')
    expect(normalized[0]?.message).not.toContain('�')
  })

  it('切り詰めはコードポイントで数える(絵文字を UTF-16 の 2 と数えない)', () => {
    // 絵文字だけ 201 個 = 402 コードユニット / 201 コードポイント。
    // `String.prototype.length` で数えると 100 個に切られてしまう
    const message = '🎉'.repeat(MAX_ENTRY_MESSAGE_LENGTH + 1)
    const clamped = normalizeDirectory([{ url: FAKE_CHANNEL.url, message }])[0]?.message ?? ''

    expect(Array.from(clamped)).toHaveLength(MAX_ENTRY_MESSAGE_LENGTH)
    expect(clamped).toBe('🎉'.repeat(MAX_ENTRY_MESSAGE_LENGTH))
    expect(clamped).not.toContain('�')
  })

  it('上限ちょうど(コードポイント)の自由文はそのまま残す', () => {
    const message = '🎉'.repeat(MAX_ENTRY_MESSAGE_LENGTH)
    expect(normalizeDirectory([{ url: FAKE_CHANNEL.url, message }])[0]?.message).toBe(message)
  })
})

// --- 保存先の移行 (AC5 / security-review.md S7) ----------------------------
//
// 既存テストに `chrome` をスタブした前例が無いので、ここで最小のフェイクを置く。
// 見るのは「どのエリアに何が書かれたか」だけなので、`get` / `set` があれば足りる。

type Store = Record<string, unknown>

const DIRECTORY_KEY = 'ytRedirectPin.directory'
const MIGRATED_KEY = 'ytRedirectPin.directoryMigratedAt'

/** 003 より前の(message の無い)保存内容 */
const LEGACY_ENTRY = { url: FAKE_CHANNEL.url, nickname: 'れい', lastSeenAt: 7 }
const MIGRATED_ENTRY = { url: FAKE_CHANNEL.url, nickname: 'れい', message: '', lastSeenAt: 7 }

type FailOpts = {
  /** すべての `set` を失敗させる */
  failSet?: boolean
  /** このキーを含む `set` だけを失敗させる */
  failSetKey?: string
}

function fakeArea(store: Store, opts: FailOpts = {}): chrome.storage.StorageArea {
  return {
    async get(keys?: string | string[] | null): Promise<Store> {
      const names = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys]
      const out: Store = {}
      for (const name of names) if (name in store) out[name] = store[name]
      return out
    },
    async set(items: Store): Promise<void> {
      // sync の 8KB 上限で reject する状況(S7)を模す
      if (opts.failSet || (opts.failSetKey && opts.failSetKey in items)) {
        throw new Error('QUOTA_BYTES quota exceeded')
      }
      Object.assign(store, items)
    },
  } as unknown as chrome.storage.StorageArea
}

function stubChrome(local: Store, sync: Store, localFail: FailOpts = {}): void {
  ;(globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: fakeArea(local, localFail),
      sync: fakeArea(sync),
      onChanged: { addListener() {}, removeListener() {} },
    },
  }
}

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome
})

describe('辞書の保存先の移行 (AC5)', () => {
  it('local にキーが無ければ sync から引き継ぎ、移行済みフラグを立てる', async () => {
    const local: Store = {}
    const sync: Store = { [DIRECTORY_KEY]: [LEGACY_ENTRY] }
    stubChrome(local, sync)

    const result = await migrateDirectoryToLocal()

    expect(result.status).toBe('migrated')
    expect(result.count).toBe(1)
    expect(local[DIRECTORY_KEY]).toEqual([MIGRATED_ENTRY])
    expect(local[MIGRATED_KEY]).toEqual(expect.any(Number))
  })

  it('sync 側のキーは消さない(まだ移行していない別 PC から辞書が消えるため)', async () => {
    const local: Store = {}
    const sync: Store = { [DIRECTORY_KEY]: [LEGACY_ENTRY] }
    stubChrome(local, sync)

    await migrateDirectoryToLocal()

    expect(sync[DIRECTORY_KEY]).toEqual([LEGACY_ENTRY])
  })

  it('引き継ぎは 1 度きり — 2 回目は sync の更新を取り込まない', async () => {
    const local: Store = {}
    const sync: Store = { [DIRECTORY_KEY]: [LEGACY_ENTRY] }
    stubChrome(local, sync)
    await migrateDirectoryToLocal()

    sync[DIRECTORY_KEY] = [LEGACY_ENTRY, { url: FAKE_OTHER_CHANNEL.url, nickname: 'あと', lastSeenAt: 9 }]
    const second = await migrateDirectoryToLocal()

    expect(second.status).toBe('skipped')
    expect(local[DIRECTORY_KEY]).toEqual([MIGRATED_ENTRY])
  })

  it('全件削除した後に読み直しても、sync の古い辞書は復活しない', async () => {
    const local: Store = {}
    const sync: Store = { [DIRECTORY_KEY]: [LEGACY_ENTRY] }
    stubChrome(local, sync)

    expect(await loadDirectory()).toEqual([MIGRATED_ENTRY])
    await saveDirectory([]) // 設定画面で全件削除した状態
    expect(await loadDirectory()).toEqual([])
  })

  it('フラグが立っていれば、local のキーごと消えていても引き継がない', async () => {
    // 「空配列かどうか」ではなくキーの有無で見ているため、キーごと消えた場合に
    // 1 度きりを保証するのはフラグだけ
    const local: Store = { [MIGRATED_KEY]: 1_700_000_000_000 }
    const sync: Store = { [DIRECTORY_KEY]: [LEGACY_ENTRY] }
    stubChrome(local, sync)

    expect((await migrateDirectoryToLocal()).status).toBe('skipped')
    expect(await loadDirectory()).toEqual([])
  })

  it('local への書き込みに失敗したらフラグを立てず、次回の起動で再試行する', async () => {
    const local: Store = {}
    const sync: Store = { [DIRECTORY_KEY]: [LEGACY_ENTRY] }
    stubChrome(local, sync, { failSet: true })

    const failed = await migrateDirectoryToLocal()

    expect(failed.status).toBe('failed')
    expect(local[DIRECTORY_KEY]).toBeUndefined()
    expect(local[MIGRATED_KEY]).toBeUndefined()

    // 書き込めるようになれば引き継げる(再移行の導線が UI に無いので、ここが唯一の復旧経路)
    stubChrome(local, sync)
    expect((await migrateDirectoryToLocal()).status).toBe('migrated')
    expect(local[DIRECTORY_KEY]).toEqual([MIGRATED_ENTRY])
  })

  it('辞書は書けてフラグだけ書けなかった場合は migrated を返す(再試行は起きないし要らない)', async () => {
    const local: Store = {}
    const sync: Store = { [DIRECTORY_KEY]: [LEGACY_ENTRY] }
    stubChrome(local, sync, { failSetKey: MIGRATED_KEY })

    const result = await migrateDirectoryToLocal()

    expect(result.status).toBe('migrated')
    expect(result.count).toBe(1)
    expect(result.reason).toContain('フラグ')
    expect(local[DIRECTORY_KEY]).toEqual([MIGRATED_ENTRY])
    expect(local[MIGRATED_KEY]).toBeUndefined()

    // 次回はフラグではなく「既に local に辞書がある」で止まるので、sync を取り込み直さない
    sync[DIRECTORY_KEY] = [LEGACY_ENTRY, { url: FAKE_OTHER_CHANNEL.url, nickname: 'あと', lastSeenAt: 9 }]
    expect((await migrateDirectoryToLocal()).status).toBe('skipped')
    expect(local[DIRECTORY_KEY]).toEqual([MIGRATED_ENTRY])
  })

  it('移行が失敗しても loadDirectory は例外を投げない', async () => {
    stubChrome({}, { [DIRECTORY_KEY]: [LEGACY_ENTRY] }, { failSet: true })
    await expect(loadDirectory()).resolves.toEqual([])
  })

  it('保存は local に書き、sync は書き換えない', async () => {
    const local: Store = {}
    const sync: Store = { [DIRECTORY_KEY]: [LEGACY_ENTRY] }
    stubChrome(local, sync)

    await saveDirectory([entry({ url: FAKE_OTHER_CHANNEL.url, nickname: 'あたらしい' })])

    expect(local[DIRECTORY_KEY]).toEqual([
      { url: FAKE_OTHER_CHANNEL.url, nickname: 'あたらしい', message: '', lastSeenAt: 0 },
    ])
    expect(sync[DIRECTORY_KEY]).toEqual([LEGACY_ENTRY])
  })

  it('自由文を含む辞書がそのまま local に保存される', async () => {
    const local: Store = {}
    stubChrome(local, {})

    await saveDirectory([entry({ url: FAKE_CHANNEL.url, message: 'いつもありがとう' })])

    expect(local[DIRECTORY_KEY]).toEqual([
      { url: FAKE_CHANNEL.url, nickname: '', message: 'いつもありがとう', lastSeenAt: 0 },
    ])
  })
})
