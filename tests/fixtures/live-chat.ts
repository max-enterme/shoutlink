/**
 * ⚠️ **合成 DOM。T1(実配信での live_chat DOM 採取)の実 DOM で差し替えること。**
 *
 * T1 が未実施のため、実際の YouTube live_chat の DOM は分かっていない。
 * ここにあるのは selectors.ts の推測セレクタに合わせて**こちらで組み立てた**構造であり、
 * 「このテストが通る = 実配信で動く」ではない。T1 で採取・匿名化した DOM に置き換えた時点で、
 * ここのテストが落ちたら**実装側を直す**(fixture を実装に合わせて歪めない)。
 *
 * 識別子はすべて架空値 (`@example-channel` 等)。実在する第三者の
 * チャンネル名・ハンドル・ID は入れない。
 */

export const FAKE_CHANNEL = {
  name: 'Example Channel',
  handle: '@example-channel',
  url: 'https://www.youtube.com/@example-channel',
  channelId: 'UCexampleexampleexampl',
} as const

export const FAKE_OTHER_CHANNEL = {
  name: 'Another Example',
  handle: '@another-example',
  url: 'https://www.youtube.com/@another-example',
} as const

function frag(html: string): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = html.trim()
  return wrapper.firstElementChild as HTMLElement
}

/**
 * リダイレクト通知ノード(合成)。
 *
 * ⚠️ 既定の文言は**実配信で確認済みのもの**を使う。以前は `からリダイレクトされました` を
 *    既定にしていたが、これは推測でしかなく、`/リダイレクト/` のパターンが
 *    自動発火から外れた時点で「通知ですらない」文字列になった
 *    (→ [docs/security-review.md](../../docs/security-review.md) S2)。
 */
export function makeRedirectNotice(
  opts: { name?: string; href?: string; text?: string } = {},
): HTMLElement {
  const name = opts.name ?? FAKE_CHANNEL.name
  const href = opts.href ?? `/${FAKE_CHANNEL.handle}`
  const text = opts.text ?? 'とその視聴者が参加しました'
  return frag(`
    <yt-live-chat-viewer-engagement-message-renderer>
      <div id="content">
        <a href="${href}"><span id="author-name">${name}</span></a>
        <span id="message">${text}</span>
      </div>
    </yt-live-chat-viewer-engagement-message-renderer>
  `)
}

/** 通常のチャットメッセージ(合成) */
export function makeChatMessage(text: string, author = 'viewer'): HTMLElement {
  return frag(`
    <yt-live-chat-text-message-renderer>
      <span id="author-name">${author}</span>
      <span id="message">${text}</span>
    </yt-live-chat-text-message-renderer>
  `)
}

/**
 * 「ライブ チャットへようこそ」の常設メッセージ(合成)。
 * ⚠️ **リダイレクト通知と同じ `yt-live-chat-viewer-engagement-message-renderer` が使われている**
 *    ことを実 DOM で確認済み (2026-08-05 / studio 版ポップアウト)。
 *    要素の一致だけで通知と判定すると、これを毎回拾ってしまう。
 */
export function makeWelcomeMessage(): HTMLElement {
  return frag(`
    <yt-live-chat-viewer-engagement-message-renderer modern>
      <div id="card">
        <span id="message">下記のガイドラインを守ってチャットを楽しみましょう
          <a href="//support.google.com/youtube/answer/2853856?hl=ja#safe">詳細</a>
        </span>
      </div>
    </yt-live-chat-viewer-engagement-message-renderer>
  `)
}

/**
 * リダイレクトを受けたときにチャットへ出る参加通知(合成)。
 *
 * ✅ 文言は実配信で確認済み (2026-08-05): `@ハンドル とその視聴者が参加しました。挨拶しましょう`。
 *    **「リダイレクト」という語は含まれない。**
 * ⚠️ 要素の種類とハンドルがリンクかどうかは**未確認**。ここでは
 *    「ウェルカムと同じ汎用コンテナ・ハンドルはテキストのみ」を仮定して組んである。
 *    T1 で実 DOM を採ったら差し替えること。
 */
export function makeJoinNotice(
  opts: { handle?: string; withLink?: boolean } = {},
): HTMLElement {
  const handle = opts.handle ?? FAKE_CHANNEL.handle
  const subject = opts.withLink ? `<a href="/${handle}">${handle}</a>` : handle
  return frag(`
    <yt-live-chat-viewer-engagement-message-renderer modern>
      <div id="card">
        <yt-icon id="icon"></yt-icon>
        <div id="content">
          <yt-formatted-string id="message">${subject} とその視聴者が参加しました。挨拶しましょう</yt-formatted-string>
        </div>
        <div id="menu"><yt-icon-button id="menu-button"><button id="button"></button></yt-icon-button></div>
      </div>
    </yt-live-chat-viewer-engagement-message-renderer>
  `)
}

/**
 * 実際に固定中のバナー(合成)。`#visible-banners` の中に生える想定。
 * TODO(T1): 何かを固定した状態の実 DOM は未確認。構造は推測。
 */
export function makePinnedBanner(text = '固定中の告知'): HTMLElement {
  return frag(`
    <yt-live-chat-banner-renderer>
      <yt-live-chat-pinned-message-renderer>
        <span id="message">${text}</span>
      </yt-live-chat-pinned-message-renderer>
    </yt-live-chat-banner-renderer>
  `)
}

/**
 * チャット画面の骨格を document に組む。
 *
 * 実 DOM で確認できた点を反映してある (2026-08-05 / studio 版ポップアウト):
 * - 入力欄の `contenteditable` は **値なし**(`"true"` ではない)
 * - `yt-live-chat-pinned-message-renderer` は**何も固定していなくても `hidden` で常駐する**
 * - `yt-live-chat-banner-manager` の中に `#visible-banners`(通常時は空)がある
 * - 「ライブ チャットへようこそ」の常設メッセージが最初から 1 件ある
 */
export function mountChatShell(): {
  items: HTMLElement
  input: HTMLElement
  sendButton: HTMLButtonElement
  visibleBanners: HTMLElement
} {
  document.body.innerHTML = `
    <yt-live-chat-renderer>
      <yt-live-chat-banner-manager id="banner-container">
        <div id="visible-banners"></div>
      </yt-live-chat-banner-manager>
      <yt-live-chat-pinned-message-renderer id="pinned-message" hidden disable-upgrade></yt-live-chat-pinned-message-renderer>
      <yt-live-chat-item-list-renderer>
        <div id="items"></div>
      </yt-live-chat-item-list-renderer>
      <yt-live-chat-message-input-renderer>
        <yt-live-chat-text-input-field-renderer>
          <div id="input" contenteditable></div>
        </yt-live-chat-text-input-field-renderer>
        <div id="send-button"><button></button></div>
      </yt-live-chat-message-input-renderer>
    </yt-live-chat-renderer>
  `
  document.querySelector('#items')!.appendChild(makeWelcomeMessage())
  return {
    items: document.querySelector<HTMLElement>('#items')!,
    input: document.querySelector<HTMLElement>('#input')!,
    sendButton: document.querySelector<HTMLButtonElement>('#send-button button')!,
    visibleBanners: document.querySelector<HTMLElement>('#visible-banners')!,
  }
}

/** メニュー(︙)を持つメッセージ要素。クリックで固定メニューが開くところまで合成する */
export function makeOwnMessageWithMenu(
  text: string,
  opts: { pinLabel?: string | null } = {},
): HTMLElement {
  const message = frag(`
    <yt-live-chat-text-message-renderer>
      <span id="author-name">me</span>
      <span id="message">${text}</span>
      <div id="menu"><yt-icon-button id="menu-button"><button></button></yt-icon-button></div>
    </yt-live-chat-text-message-renderer>
  `)

  const button = message.querySelector<HTMLButtonElement>('#menu-button button')!
  button.addEventListener('click', () => {
    if (opts.pinLabel === null) {
      // 「固定」項目が無いメニュー(権限・画面幅で出ないケース / plan.md R3)
      openMenu(['報告', 'ブロック'])
      return
    }
    openMenu([opts.pinLabel ?? '固定', '報告'])
  })

  return message
}

function openMenu(labels: string[]): void {
  const dropdown = document.createElement('tp-yt-iron-dropdown')
  for (const label of labels) {
    const item = document.createElement('ytd-menu-service-item-renderer')
    item.textContent = label
    dropdown.appendChild(item)
  }
  document.body.appendChild(dropdown)
}
