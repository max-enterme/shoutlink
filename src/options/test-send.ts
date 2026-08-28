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

/** 行に返す文言 (AC9 の 6 通り)。`'no-tab'` は options 側だけで起きる */
export function testSendResultMessage(
  result: TestSendResponse | { status: 'failed'; reason: 'no-tab' },
): string {
  if (result.status === 'posted') {
    return `投稿した(配信 ${result.streamId}): ${result.text}`
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
