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

  /**
   * **コメント返しの対象にする要素** (004 / AC3)。
   *
   * ⚠️ **`chatTextMessage` を流用しない。**あちらは
   * `yt-live-chat-paid-message-renderer`(スパチャ)と
   * `yt-live-chat-membership-item-renderer`(メンバー加入)を含むうえ、
   * **除外用にも使われている**定数。コメント経路が対象にしてよいのは**通常のテキストコメントだけ**。
   *
   * ✅ 確認済み (2026-08-15 / 実配信): 項目リストに出ていたのは
   * `yt-live-chat-text-message-renderer` と
   * `yt-live-chat-viewer-engagement-message-renderer`(システムメッセージ)の 2 種類。
   * 後者は投稿者が存在しないので、下の `getCommentAuthorParams` が空を返して自然に外れる。
   */
  commentTextMessage: ['yt-live-chat-text-message-renderer'],

  /**
   * **コメントの投稿者が入っている属性** (004 / AC4)。
   *
   * ✅ 確認済み (2026-08-15 / 実配信): `whole-message-clickable` の JSON の中の
   * `liveChatItemContextMenuEndpoint.params` を **base64 で 2 回**解くと、
   * 「メッセージ ID / {チャンネル ID, 動画 ID} / {チャンネル ID}」が出る。
   * 実配信の全メッセージでページ内部の正解と一致した。
   */
  commentAuthorParamsAttribute: ['whole-message-clickable'],

  /** コメントのタイムスタンプ。✅ 確認済み: `5:17 PM` 形式(**分単位・日付なし**) */
  commentTimestamp: ['#timestamp'],

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
 *
 * ✅ **確認済み (2026-08-05 / 実配信のスクリーンショット): 実際の文言は**
 *    `@ハンドル とその視聴者が参加しました。挨拶しましょう`
 *    **「リダイレクト」という語は入っていない。**これが初回に検知できなかった直接の原因。
 *
 * パターンは 2 つに分けてある:
 *   `REDIRECT_TEXT_PATTERNS`             … 自動発火させてよい文言
 *   `UNCONFIRMED_REDIRECT_TEXT_PATTERNS` … 診断ログに出すだけの推測
 *
 * TODO(T1): 英語 UI の文言は未確認。「リダイレクト」を含む別形式の通知が存在するかも未確認。
 */
/**
 * **通知とみなしてはいけない文言。**文言パターンより優先して除外する。
 *
 * ⚠️ **確認済み (2026-08-06 / 事故): リダイレクトを「送る」側にもバナーが出る。**
 *    `この機会に、@<送信先> のコンテンツの視聴を促進しましょう`
 *    これを通知として拾うと、**自分が送った相手に対して「ありがとうございます」を投稿する**
 *    という逆向きの誤動作になる。しかもそこに出る `@ハンドル` は送信先であって送信元ではない。
 */
export const EXCLUDED_TEXT_PATTERNS: readonly RegExp[] = [
  /視聴を促進/,
  /促進しましょう/,
  /この機会に/,
  /promote .{0,20}content/i,
]

/**
 * **自動発火の対象にしてよい文言。**
 *
 * ⚠️ ここに置いてよいのは「リダイレクトを**受けた**ことだけを意味する文言」に限る。
 *    ここに当たった要素は、そのまま投稿まで走る。
 *
 * - `とその視聴者が参加しました` は実配信で確認済み (2026-08-05)。
 * - 英語 2 つは**未確認**だが、確認済みの文言をそのまま英訳した形であり、
 *   「受けた」以外の意味では出てこない。
 */
export const REDIRECT_TEXT_PATTERNS: readonly RegExp[] = [
  // 確認済みの形
  /とその視聴者が参加しました/,
  /視聴者が参加しました/,
  // 未確認だが、確認済みの文言と同じ形(受信のみを意味する)
  /and their viewers?\b/i,
  /viewers? (have )?joined/i,
]

/**
 * **自動発火させない文言。診断ログに「候補」として出すだけ。**
 *
 * ⚠️ 2026-08-06 の②の教訓「未確認の推測を、チェックを飛ばす強い経路に置かない」を、
 *    セレクタだけでなく文言にも適用したもの (security-review.md S2)。
 *
 * ここにあるのは**リダイレクトという話題に触れているだけ**の語で、
 * 「受けた」とは限らない。実際に踏んだ事故:
 *
 * - 送信側のバナー(`この機会に、@<送信先> …`)— 送った側にも出る
 * - 自分が投稿する返礼文そのもの(既定テンプレートに「リダイレクト」が入る / S1)
 *
 * 別形式の通知を実際に観測したら、その文言を上の
 * `REDIRECT_TEXT_PATTERNS` へ**確認済みとして昇格**させる。
 */
export const UNCONFIRMED_REDIRECT_TEXT_PATTERNS: readonly RegExp[] = [
  /リダイレクト/,
  /誘導されました/,
  /redirect(ed|ing)?\b/i,
  /\braid(ed|ing)?\b/i,
]

/**
 * 「固定」メニュー項目のラベル候補。
 *
 * ✅ **確認済み (2026-08-05 / Studio のチャットで手動でメニューを開いて採取):**
 *    メッセージのメニューは `["チャンネルへ", "メッセージを固定", "削除"]`。
 *    **「メッセージを固定」が存在する**(plan.md C2 は肯定)。`固定` の部分一致で当たる。
 * TODO(T1): 英語 UI のラベルは未確認。
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

/**
 * 要素が通常のチャットメッセージを内包しているか。
 * **通知は他のチャットメッセージを含まない。**含むならそれはコンテナであり、通知ではない。
 */
export function containsChatTextMessage(el: ParentNode): boolean {
  return queryFirst(el, SELECTORS.chatTextMessage) != null
}

/**
 * 要素が通常のチャットメッセージの内側にあるか。
 *
 * **自分が投稿した返礼メッセージを通知として検知しないための判定。**
 * 返礼文には「リダイレクト」とチャンネル URL が両方入るため、
 * メッセージの中身(`#message` の span 等)を単独で見ると通知の条件を満たしてしまう。
 */
export function isInsideChatTextMessage(el: Element): boolean {
  for (const selector of SELECTORS.chatTextMessage) {
    try {
      if (el.closest?.(selector)) return true
    } catch {
      // 環境が解釈できないセレクタは飛ばす
    }
  }
  return false
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

/**
 * 祖先までさかのぼって表示されているか。
 *
 * ⚠️ **要素自身の `display` だけを見ても足りない。**`display:none` の親の中にいる子要素は、
 *    `getComputedStyle(子).display` が `none` にならない(継承される値ではない)ため、
 *    「閉じているドロップダウンの中の項目」を表示中と誤判定する。
 */
function isDisplayedDeep(el: Element): boolean {
  let node: Element | null = el
  while (node) {
    if (!isDisplayed(node)) return false
    node = node.parentElement
  }
  return true
}

/**
 * **実際に開いている**メニューの項目。
 *
 * ⚠️ 2026-08-07 の不具合: 閉じたままのドロップダウン(チャットの
 *    `["Q&A を開始…", "アンケートを開始…", "閉じる"]`)の項目を「開いているメニュー」として
 *    読み、**メッセージのメニューが開いていないのに「固定項目が無い」と誤って報告**していた。
 *    このドロップダウンには `aria-hidden="true"` が付かないため、セレクタ側の除外をすり抜ける。
 *    → 表示状態を祖先までさかのぼって確認する。
 *
 * 候補セレクタは順に試すが、**表示されている項目が取れた候補**だけを採用する。
 */
export function getOpenMenuItems(root: ParentNode): HTMLElement[] {
  for (const selector of SELECTORS.menuItems) {
    try {
      const found = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(isDisplayedDeep)
      if (found.length > 0) return found
    } catch {
      // 環境が解釈できないセレクタは飛ばす
    }
  }
  return []
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

/**
 * 開いているメニューに「固定を解除」があるか。
 *
 * ✅ **確認済み (2026-08-07): 既に固定されているメッセージのメニューには
 * 「メッセージを固定」が無く、代わりに「固定を解除」が出る。**
 * これを見ないと、**固定済みのメッセージを「固定 UI が見つからない」(`unavailable`)と
 * 誤って警告する。**「解除」があること自体が「そのメッセージは固定されている」証拠。
 */
export function hasUnpinMenuItem(root: ParentNode): boolean {
  return getOpenMenuItems(root).some((item) => {
    const label = textOf(item)
    return !!label && UNPIN_MENU_LABELS.some((l) => label.includes(l))
  })
}

// --- コメント経路のアクセサ (004) ------------------------------------------

/** 対象は**通常のテキストコメントだけ** (AC3)。`chatTextMessage` を流用しない */
export function isCommentTextMessage(el: Element): boolean {
  return matchesAny(el, SELECTORS.commentTextMessage)
}

/**
 * 投稿者が入っている属性の**生の値**(JSON 文字列)。
 * 解析は [comment-detector.ts](./comment-detector.ts) の純関数が行う。
 */
export function getCommentAuthorParams(el: Element): string | null {
  for (const name of SELECTORS.commentAuthorParamsAttribute) {
    const value = el.getAttribute(name)
    if (value) return value
  }
  return null
}

/**
 * `author-type` 属性 (AC10)。
 * ✅ 確認済み (2026-08-15): 配信者のコメントは `owner`、他の視聴者は空文字。**追加ノードにも付く**。
 */
export function getCommentAuthorType(el: Element): string {
  return el.getAttribute('author-type') ?? ''
}

/**
 * タイムスタンプのテキスト (AC9)。
 *
 * **要素が無いことと、テキストが空であることを区別する** — 前者は「構造が変わった」で
 * 安全側に倒し、後者は猶予で判定する(AC9)。
 */
export function getCommentTimestampText(el: ParentNode): string | null {
  const node = queryFirst(el, SELECTORS.commentTimestamp)
  return node ? textOf(node) : null
}
