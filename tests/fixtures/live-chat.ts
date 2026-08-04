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

/** リダイレクト通知ノード(合成) */
export function makeRedirectNotice(
  opts: { name?: string; href?: string; text?: string } = {},
): HTMLElement {
  const name = opts.name ?? FAKE_CHANNEL.name
  const href = opts.href ?? `/${FAKE_CHANNEL.handle}`
  const text = opts.text ?? 'からリダイレクトされました'
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

/** 固定中のバナー(合成)。`ifEmpty` の判定対象 */
export function makePinnedBanner(text = '固定中の告知'): HTMLElement {
  return frag(`
    <yt-live-chat-pinned-message-renderer>
      <span id="message">${text}</span>
    </yt-live-chat-pinned-message-renderer>
  `)
}

/** チャット画面の骨格(項目リスト + 入力欄 + 送信ボタン)を document に組む */
export function mountChatShell(): {
  items: HTMLElement
  input: HTMLElement
  sendButton: HTMLButtonElement
} {
  document.body.innerHTML = `
    <yt-live-chat-renderer>
      <yt-live-chat-banner-manager id="banner-container"></yt-live-chat-banner-manager>
      <yt-live-chat-item-list-renderer>
        <div id="items"></div>
      </yt-live-chat-item-list-renderer>
      <yt-live-chat-message-input-renderer>
        <yt-live-chat-text-input-field-renderer>
          <div id="input" contenteditable="true"></div>
        </yt-live-chat-text-input-field-renderer>
        <div id="send-button"><button></button></div>
      </yt-live-chat-message-input-renderer>
    </yt-live-chat-renderer>
  `
  return {
    items: document.querySelector<HTMLElement>('#items')!,
    input: document.querySelector<HTMLElement>('#input')!,
    sendButton: document.querySelector<HTMLButtonElement>('#send-button button')!,
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
