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
   * リダイレクト専用と思われる通知ノード。**これに一致すれば文言を見ずに通知とみなす。**
   * TODO(T1): 実 DOM で要確認。実際にリダイレクトを受けた画面をまだ見ていないため、
   *           これらの要素が存在するかどうか自体が未確認(plan.md C1 / R1)。
   */
  redirectNoticeStrict: [
    'yt-live-chat-banner-redirect-renderer',
    'yt-live-chat-redirect-renderer',
    'ytd-live-chat-redirect-banner-renderer',
    '[class*="redirect"][class*="live-chat"]',
  ],

  /**
   * システムメッセージの汎用コンテナ。リダイレクト通知もここに出る可能性がある。
   *
   * ⚠️ **確認済み (2026-08-05 / studio 版ポップアウト): この要素は「ライブ チャットへようこそ」の
   *    常設メッセージにも使われている。**通常時から 1 件存在する。
   *    したがって**要素の一致だけで通知と判定してはいけない**。文言パターンとの併用が必須。
   */
  redirectNoticeGeneric: ['yt-live-chat-viewer-engagement-message-renderer'],

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
   * チャット入力欄。
   * ✅ 確認済み (2026-08-05 / studio 版ポップアウト): 第 1・第 2 候補が当たる。
   * ⚠️ ただし **`contenteditable` の値は `"true"` ではなく空文字**(属性はあるが値なし)。
   *    そのため `[contenteditable="true"]` では当たらない。以前の候補は死んでいたので差し替えた。
   */
  chatInput: [
    'yt-live-chat-text-input-field-renderer #input',
    'div#input.yt-live-chat-text-input-field-renderer',
    '#input[contenteditable]',
    '[contenteditable]:not([contenteditable="false"])',
    'textarea#input',
  ],

  /**
   * 送信ボタン。
   * ✅ 確認済み (2026-08-05 / studio 版ポップアウト): 第 1・第 2 候補が当たる。
   * TODO(T1): 無効化状態の判定方法(disabled 属性 / aria-disabled)は未確認。
   */
  chatSendButton: [
    'yt-live-chat-message-input-renderer #send-button button',
    '#send-button button',
    'button#send-button',
    'yt-icon-button#send-button button',
  ],

  /**
   * メッセージ 1 件のメニュー(︙)ボタン。メッセージ要素を root に探す。
   * ✅ 確認済み (2026-08-05 / studio 版ポップアウト): 第 1 候補が当たる。
   *    ホバー前から DOM に存在する。`aria-label` は「チャットの操作」。
   */
  messageMenuButton: [
    '#menu yt-icon-button#menu-button button',
    'yt-icon-button#menu-button button',
    '#menu-button button',
    'button[aria-label*="チャットの操作"]',
    'button[aria-label*="その他"]',
    'button[aria-label*="More"]',
  ],

  /**
   * 開いたメニューの項目。
   * ✅ 確認済み (2026-08-05 / studio 版ポップアウト): 項目は `ytd-menu-service-item-renderer`
   *    (`role="menuitem"`)で、`ytd-menu-popup-renderer` > `tp-yt-iron-dropdown` の中に出る。
   * ⚠️ **開いた状態のメニューはまだ見ていない。**プログラムからの `click()` では
   *    ドロップダウンが可視にならず、項目一覧を採れていない(下の pinner の注記を参照)。
   */
  menuItems: [
    'tp-yt-iron-dropdown:not([aria-hidden="true"]) ytd-menu-service-item-renderer',
    'tp-yt-iron-dropdown:not([aria-hidden="true"]) ytd-menu-navigation-item-renderer',
    'ytd-menu-popup-renderer ytd-menu-service-item-renderer',
    'tp-yt-paper-listbox ytd-menu-service-item-renderer',
    '[role="menuitem"]',
  ],

  /**
   * 現在固定中のメッセージのバナー。`ifEmpty` の判定に使う (spec.md D2 / plan.md R4)。
   *
   * ⚠️ **確認済み (2026-08-05 / studio 版ポップアウト): `yt-live-chat-pinned-message-renderer` は
   *    何も固定していなくても DOM に常駐する**(`hidden` 属性つき / `display:none` / 子要素なし)。
   *    **要素の有無だけで判定すると `ifEmpty` が常に「固定済み」と誤判定し、一度も固定しなくなる。**
   *    そのため `getPinnedBanner` は「表示されていて、かつ中身がある」ことまで見る。
   *
   * 実際に固定されたときにどこへ生えるかは未確認。`yt-live-chat-banner-manager` 配下の
   * `#visible-banners`(通常時は空・高さ 0)が本命と見て先頭に置いてある。
   * TODO(T1): 何かを固定した状態で要確認。
   */
  pinnedBanner: [
    'yt-live-chat-banner-manager #visible-banners yt-live-chat-banner-renderer',
    'yt-live-chat-banner-manager #visible-banners yt-live-chat-pinned-message-renderer',
    'yt-live-chat-pinned-message-renderer:not([hidden])',
    'yt-live-chat-banner-renderer[is-pinned]',
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

/** リダイレクト専用の要素か(文言を見ずに通知と判定してよい) */
export function isRedirectNoticeElement(el: Element): boolean {
  return matchesAny(el, SELECTORS.redirectNoticeStrict)
}

/**
 * 要素が画面に出ているか。
 * jsdom では `offsetParent` / `getClientRects` が使えないため、属性と computed style で見る
 * (jsdom では「表示されている」側に倒れる)。
 */
function isDisplayed(el: Element): boolean {
  if (el.hasAttribute('hidden')) return false
  if (el.getAttribute('aria-hidden') === 'true') return false

  const view = el.ownerDocument?.defaultView
  if (view?.getComputedStyle) {
    try {
      const computed = view.getComputedStyle(el)
      if (computed.display === 'none' || computed.visibility === 'hidden') return false
    } catch {
      // 取れない環境では表示扱いにする
    }
  }
  return true
}

/** 中身があるか(空の placeholder を「固定中」と誤判定しないため) */
function hasContent(el: Element): boolean {
  return el.children.length > 0 || textOf(el).length > 0
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
 *
 * **要素が在るだけでは「固定中」と判定しない。**`yt-live-chat-pinned-message-renderer` は
 * 何も固定していなくても `hidden` で常駐していることを確認済み (2026-08-05)。
 * 表示されていて中身があるものだけを「固定中」とみなす。
 *
 * ⚠️ null は「固定が無い」ではなく「**このセレクタでは見つからなかった**」でしかない。
 *    実際に固定した状態の DOM は未確認 (plan.md R4)。
 */
export function getPinnedBanner(root: ParentNode): Element | null {
  for (const selector of SELECTORS.pinnedBanner) {
    let found: Element[]
    try {
      found = Array.from(root.querySelectorAll(selector))
    } catch {
      continue
    }
    for (const el of found) {
      if (isDisplayed(el) && hasContent(el)) return el
    }
  }
  return null
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
