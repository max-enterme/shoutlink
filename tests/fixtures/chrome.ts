/**
 * `chrome.storage`(local / sync / onChanged)と `chrome.tabs` のスタブ。
 * `tests/directory.test.ts` の `stubChrome`(287 行目付近)と同じ形を、`tabs` まで足して外へ出したもの。
 */
export type FakeStore = Record<string, unknown>

export type ChromeStub = {
  /** いま保存されている内容。テストから直接読む */
  local: FakeStore
  sync: FakeStore
  /**
   * `chrome.storage.onChanged` のリスナを発火する。
   * `onDirectoryChanged`(directory.ts)は第 2 引数の areaName を
   * `getLocalStorageAreaName()`(config.ts)の戻り値と突き合わせるので、
   * 既定は `'local'` にしてある(スタブが `chrome.storage.local` を持つ限りこれで一致する)。
   */
  emitChange(key: string, newValue: unknown, areaName?: string): void
}

type ChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
) => void

/**
 * `areaName` と `listeners` を渡すのは、`set()` からも `onChanged` を発火するため(F2)。
 * 実物の `chrome.storage.local.set()` は自分の書き込みでも `onChanged` を発火する。
 */
function fakeArea(store: FakeStore, areaName: string, listeners: ChangeListener[]): chrome.storage.StorageArea {
  return {
    async get(keys?: string | string[] | null): Promise<FakeStore> {
      const names = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys]
      const out: FakeStore = {}
      for (const name of names) if (name in store) out[name] = store[name]
      return out
    },
    async set(items: FakeStore): Promise<void> {
      const changes: Record<string, chrome.storage.StorageChange> = {}
      for (const [key, newValue] of Object.entries(items)) {
        changes[key] = { oldValue: store[key], newValue }
      }
      Object.assign(store, items)
      for (const fn of listeners) fn(changes, areaName)
    },
  } as unknown as chrome.storage.StorageArea
}

/** `chrome.storage`(local / sync / onChanged)と `chrome.tabs` を差し替える。
 *  `afterEach` で `delete (globalThis as …).chrome` する運用は directory.test.ts と同じ */
export function stubChrome(options?: {
  local?: FakeStore
  sync?: FakeStore
  tabs?: chrome.tabs.Tab[]
  sendMessage?: (tabId: number, request: unknown) => Promise<unknown>
}): ChromeStub {
  const local = options?.local ?? {}
  const sync = options?.sync ?? {}
  const listeners: ChangeListener[] = []

  ;(globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: fakeArea(local, 'local', listeners),
      sync: fakeArea(sync, 'sync', listeners),
      onChanged: {
        addListener: (fn: ChangeListener) => listeners.push(fn),
        removeListener: (fn: ChangeListener) => {
          const index = listeners.indexOf(fn)
          if (index >= 0) listeners.splice(index, 1)
        },
      },
    },
    tabs: {
      query: async () => options?.tabs ?? [],
      sendMessage: options?.sendMessage ?? (async () => undefined),
    },
  }

  return {
    local,
    sync,
    emitChange(key, newValue, areaName = 'local') {
      const target = areaName === 'sync' ? sync : local
      const oldValue = target[key]
      target[key] = newValue
      for (const fn of listeners) fn({ [key]: { oldValue, newValue } }, areaName)
    },
  }
}
