/**
 * DOM セレクタの集約点。
 *
 * ⚠️ **ここに書かれているセレクタ・文言はすべて推測である。**
 *    T1(実配信での live_chat DOM 採取)が未実施のため、実際の YouTube の DOM とは
 *    異なる可能性が高い。各定義に `TODO(T1)` を付けてある。T1 の結果でここだけを直す。
 *
 * 規約:
 * - **他のモジュールから `document.querySelector` を直接呼ばない。** DOM に触るのは
 *   このファイルと、ここが返した要素を操作する poster.ts / pinner.ts だけ。
 * - 各セレクタは**候補の配列**として持ち、先頭から順に試して最初に当たったものを使う。
 *   YouTube の UI 変更、ポップアウト版 (`www`) と Studio 版 (`studio`)、watch 埋め込み iframe の
 *   差を吸収するため。
 */

export type SelectorCandidates = readonly string[]

export const SELECTORS = {
  /** チャット項目のリスト。MutationObserver の監視ルート */
  chatItemList: [
    'yt-live-chat-item-list-renderer #items',
    '#chat #items',
    '#items.yt-live-chat-item-list-renderer',
    '#item-scroller #items',
  ],

  /**
   * リダイレクト受信の通知ノード。
   * TODO(T1): 実 DOM で要確認。そもそもチャット欄に出るのか(plan.md C1 / R1)、
   *           出るならどのカスタム要素名なのかが未確認。下記はすべて推測。
   */
  redirectNotice: [
    'yt-live-chat-viewer-engagement-message-renderer',
    'yt-live-chat-banner-redirect-renderer',
    'yt-live-chat-redirect-renderer',
    'ytd-live-chat-redirect-banner-renderer',
    '[class*="redirect"][class*="live-chat"]',
  ],

  /**
   * 通知ノード内の、送信元チャンネルへのリンク。
   * TODO(T1): 実 DOM で要確認。href が `/@handle` `/channel/UC...` のどちらで来るか未確認。
   */
  redirectNoticeChannelLink: [
    'a[href^="/@"]',
    'a[href^="/channel/"]',
    'a[href*="youtube.com/@"]',
    'a[href*="youtube.com/channel/"]',
    'a#author-name',
    'a',
  ],

  /**
   * 通知ノード内の、送信元チャンネルの表示名。
   * TODO(T1): 実 DOM で要確認。リンクのテキストが表示名とは限らない。
   */
  redirectNoticeChannelName: ['#author-name', '#channel-name', 'yt-formatted-string#text', '.channel-name'],

  /**
   * 通常のチャットメッセージ。
   * 「テキストにリダイレクトという語が含まれるだけの視聴者コメント」を
   * 通知と誤検知しないための除外に使う。
   * TODO(T1): 実 DOM で要確認。
   */
  chatTextMessage: [
    'yt-live-chat-text-message-renderer',
    'yt-live-chat-paid-message-renderer',
    'yt-live-chat-membership-item-renderer',
  ],

  /** チャットメッセージ本文 */
  chatMessageText: ['#message', '#content #message', '.message'],

  /**
   * チャット入力欄。YouTube は contenteditable な div。
   * TODO(T1): 実 DOM で要確認。`studio` 版は別構造の可能性がある(plan.md C2)。
   */
  chatInput: [
    'yt-live-chat-text-input-field-renderer #input',
    'div#input.yt-live-chat-text-input-field-renderer',
    'div[contenteditable="true"][id="input"]',
    'div[contenteditable="true"]',
    'textarea#input',
  ],

  /**
   * 送信ボタン。
   * TODO(T1): 実 DOM で要確認。無効化状態の判定方法(disabled 属性 / aria-disabled)も未確認。
   */
  chatSendButton: [
    'yt-live-chat-message-input-renderer #send-button button',
    '#send-button button',
    'button#send-button',
    'yt-icon-button#send-button button',
  ],

  /**
   * メッセージ 1 件のメニュー(︙)ボタン。メッセージ要素を root に探す。
   * TODO(T1): 実 DOM で要確認。ホバーしないと DOM に出ない可能性がある。
   */
  messageMenuButton: [
    '#menu yt-icon-button#menu-button button',
    'yt-icon-button#menu-button button',
    '#menu-button button',
    'button[aria-label*="その他"]',
    'button[aria-label*="More"]',
  ],

  /**
   * 開いたメニューの項目。document 直下のポップアップコンテナに出る想定。
   * TODO(T1): 実 DOM で要確認。
   */
  menuItems: [
    'tp-yt-iron-dropdown:not([aria-hidden="true"]) ytd-menu-service-item-renderer',
    'tp-yt-iron-dropdown:not([aria-hidden="true"]) ytd-menu-navigation-item-renderer',
    'tp-yt-paper-listbox ytd-menu-service-item-renderer',
    'ytd-menu-popup-renderer ytd-menu-service-item-renderer',
    '[role="menuitem"]',
  ],

  /**
   * 現在固定中のメッセージのバナー。`ifEmpty` の判定に使う。
   * TODO(T1): 実 DOM で要確認。**これが判定できないと `ifEmpty` は成立しない**
   *           (spec.md D2 / plan.md R4)。判定手段が無ければ `off` / `always` に縮退する。
   */
  pinnedBanner: [
    'yt-live-chat-banner-manager yt-live-chat-pinned-message-renderer',
    'yt-live-chat-pinned-message-renderer',
    'yt-live-chat-banner-renderer[is-pinned]',
    '#banner-container yt-live-chat-banner-renderer',
  ],
} as const satisfies Record<string, SelectorCandidates>

/**
 * リダイレクト通知の文言パターン。
 * TODO(T1): 実 DOM で要確認。実際の文言は未確認で、下記はすべて推測。
 *           日本語 UI / 英語 UI の両方を暫定で入れてある。
 */
export const REDIRECT_TEXT_PATTERNS: readonly RegExp[] = [
  /リダイレクト/,
  /誘導されました/,
  /redirect(ed|ing)?\b/i,
  /\braid(ed|ing)?\b/i,
]

/**
 * 「固定」メニュー項目のラベル候補。
 * TODO(T1): 実 DOM で要確認。
 */
export const PIN_MENU_LABELS: readonly string[] = ['固定', 'ピン留め', 'Pin message', 'Pin']

/** 「固定を解除」を「固定」と取り違えないための除外ラベル。TODO(T1): 実 DOM で要確認 */
export const UNPIN_MENU_LABELS: readonly string[] = ['固定を解除', 'ピン留めを解除', 'Unpin']

// --- 低レベルヘルパ -------------------------------------------------------

/** 候補を先頭から試し、最初に当たった 1 件を返す */
export function queryFirst<T extends Element = Element>(
  root: ParentNode,
  candidates: SelectorCandidates,
): T | null {
  for (const selector of candidates) {
    try {
      const found = root.querySelector<T>(selector)
      if (found) return found
    } catch {
      // 環境が解釈できないセレクタは飛ばす(jsdom と Chrome で対応が異なる)
    }
  }
  return null
}

/** 候補を先頭から試し、最初に 1 件以上当たった候補の結果をまとめて返す */
export function queryAll<T extends Element = Element>(
  root: ParentNode,
  candidates: SelectorCandidates,
): T[] {
  for (const selector of candidates) {
    try {
      const found = Array.from(root.querySelectorAll<T>(selector))
      if (found.length > 0) return found
    } catch {
      // 同上
    }
  }
  return []
}

/** 要素が候補のいずれかに一致するか */
export function matchesAny(el: Element, candidates: SelectorCandidates): boolean {
  for (const selector of candidates) {
    try {
      if (el.matches(selector)) return true
    } catch {
      // 同上
    }
  }
  return false
}

/** 要素のテキストを 1 行に正規化して返す */
export function textOf(el: Element | null | undefined): string {
  if (!el) return ''
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
}

// --- 用途別アクセサ -------------------------------------------------------

export function getChatItemList(root: ParentNode): Element | null {
  return queryFirst(root, SELECTORS.chatItemList)
}

export function isRedirectNoticeElement(el: Element): boolean {
  return matchesAny(el, SELECTORS.redirectNotice)
}

export function isChatTextMessage(el: Element): boolean {
  return matchesAny(el, SELECTORS.chatTextMessage)
}

export function getRedirectNoticeChannelLink(notice: ParentNode): HTMLAnchorElement | null {
  return queryFirst<HTMLAnchorElement>(notice, SELECTORS.redirectNoticeChannelLink)
}

export function getRedirectNoticeChannelName(notice: ParentNode): string {
  return textOf(queryFirst(notice, SELECTORS.redirectNoticeChannelName))
}

export function getChatInput(root: ParentNode): HTMLElement | null {
  return queryFirst<HTMLElement>(root, SELECTORS.chatInput)
}

export function getSendButton(root: ParentNode): HTMLElement | null {
  return queryFirst<HTMLElement>(root, SELECTORS.chatSendButton)
}

export function getChatMessages(root: ParentNode): HTMLElement[] {
  return queryAll<HTMLElement>(root, SELECTORS.chatTextMessage)
}

export function getMessageText(el: ParentNode & Element): string {
  const body = queryFirst(el, SELECTORS.chatMessageText)
  return textOf(body ?? el)
}

export function getMessageMenuButton(message: ParentNode): HTMLElement | null {
  return queryFirst<HTMLElement>(message, SELECTORS.messageMenuButton)
}

export function getOpenMenuItems(root: ParentNode): HTMLElement[] {
  return queryAll<HTMLElement>(root, SELECTORS.menuItems)
}

/**
 * 現在固定中のメッセージのバナー。
 * ⚠️ null は「固定が無い」ではなく「**このセレクタでは見つからなかった**」でしかない。
 *    T1 で判定手段が確認できるまで、`ifEmpty` の判定はこの推測に依存している(plan.md R4)。
 */
export function getPinnedBanner(root: ParentNode): Element | null {
  return queryFirst(root, SELECTORS.pinnedBanner)
}

/** 開いているメニューから「固定」項目を探す(「固定を解除」は除外する) */
export function findPinMenuItem(root: ParentNode): HTMLElement | null {
  for (const item of getOpenMenuItems(root)) {
    const label = textOf(item)
    if (!label) continue
    if (UNPIN_MENU_LABELS.some((l) => label.includes(l))) continue
    if (PIN_MENU_LABELS.some((l) => label.includes(l))) return item
  }
  return null
}
