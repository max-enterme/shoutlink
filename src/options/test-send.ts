/**
 * 設定画面の「テスト送信」まわりの判定 (006 / AC7 / AC9 / AC13)。
 *
 * `options.ts` は import した時点で要素 id を要求して throw する副作用モジュールなので、
 * ここに判断を切り出して `tests/test-send.test.ts` で固定する。`options.ts` 側は
 * 「返ってきたものを DOM へ書き、`chrome.tabs.sendMessage` で送るだけ」にする。
 */
import type { DirectoryEntry } from '../directory'
import type { TestSendResponse } from '../test-send'

/** ボタンを押せるか (確定値 B4)。押せない理由は `title` に出す */
export function testSendAvailability(entry: DirectoryEntry): {
  redirect: { enabled: true }
  comment: { enabled: true } | { enabled: false; reason: string }
} {
  return {
    // 返礼文側は URL で照合するので、チャンネル ID が未解決でも常に押せる
    redirect: { enabled: true },
    comment: entry.channelId
      ? { enabled: true }
      : { enabled: false, reason: 'チャンネル ID が未解決です' },
  }
}

/**
 * ライブチャットのタブを、宛先として先に試す順に並べる(plan.md「宛先タブの決め方」)。
 *
 * **`active` は当てにしない** — `options_ui.open_in_tab: true` のため、ボタンを押した時点で
 * 「最後にフォーカスされたウィンドウのアクティブなタブ」は設定画面そのもの。Studio のタブが
 * この条件を満たすことはほぼ無い。
 *
 * 規則: **`lastAccessed` の降順**(直前に見ていたタブを先頭に)。`lastAccessed` が無いものは
 * **最後**へ回す。同値・未定義どうしは**元の並び順を保つ**(安定ソート)。
 *
 * ⚠️ `@types/chrome@0.0.268` に `chrome.tabs.Tab.lastAccessed` の型が無い(Chrome 121+ で入った
 * プロパティ)。呼び出し側で局所的に型を足して渡す。
 */
export function orderStudioTabsForTestSend<T extends { lastAccessed?: number }>(
  tabs: readonly T[],
): T[] {
  return tabs
    .map((tab, index) => ({ tab, index }))
    .sort((a, b) => {
      const hasA = a.tab.lastAccessed !== undefined
      const hasB = b.tab.lastAccessed !== undefined
      if (hasA && hasB && a.tab.lastAccessed !== b.tab.lastAccessed) {
        return (b.tab.lastAccessed as number) - (a.tab.lastAccessed as number)
      }
      if (hasA !== hasB) return hasA ? -1 : 1
      // 同値・未定義どうしは元の並び順を保つ
      return a.index - b.index
    })
    .map(({ tab }) => tab)
}

/** 行に返す文言 (AC9 の 6 通り)。`'no-tab'` は options 側だけで起きる */
export function testSendResultMessage(
  result: TestSendResponse | { status: 'failed'; reason: 'no-tab' },
): string {
  if (result.status === 'posted') {
    // streamId が空(配信 ID が取れない)ときの表記は main.ts の起動ログ(`streamId || '(不明)'`)に揃える
    return `投稿した(配信 ${result.streamId || '(不明)'}): ${result.text}`
  }
  switch (result.reason) {
    case 'no-input':
      return 'チャットの入力欄が見つかりませんでした'
    case 'no-tab':
      return 'ライブチャットのタブが開いていません'
    case 'unresolved-channel-id':
      return 'この行はチャンネル ID が未解決です'
    case 'no-entry':
      return 'この行はまだ保存されていません'
    case 'busy':
      return '他の投稿が進行中のため見送りました'
  }
}
