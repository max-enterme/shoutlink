/**
 * 手動トリガー UI(常設)。
 *
 * plan.md R1 は「自動検知が成立しない場合の代替」として手動トリガーを挙げているが、
 * ここでは**フォールバックではなく常設の経路**として実装する。T1(実配信での DOM 採取)が
 * 空振りでも成果物が動くようにするため。
 *
 * 自動検知と手動トリガーは**同じ RedirectEvent を作って同じパイプラインに流す**。
 * 投稿・固定の分岐を 2 系統に増やさない。
 */
import { normalizeChannelUrl } from './detector'
import { log } from './log'
import type { RedirectEvent } from './types'

export type ManualInput = {
  sourceChannelUrl: string
  /** URL から導いた既定の表示名(ハンドル)。UI で上書きできる */
  sourceChannelName: string
}

/**
 * 入力欄の文字列を解釈する純関数。
 * URL / `@ハンドル` / `youtube.com/channel/UC...` を受ける。解釈できなければ null。
 */
export function parseManualInput(raw: string): ManualInput | null {
  const url = normalizeChannelUrl(raw)
  if (!url) return null

  const handle = url.match(/\/(@[\w.\-]+)$/)
  const legacy = url.match(/\/(?:c|user)\/([\w.\-]+)$/)
  const channelId = url.match(/\/channel\/(UC[\w-]+)$/)
  const name = handle?.[1] ?? legacy?.[1] ?? channelId?.[1] ?? url

  return { sourceChannelUrl: url, sourceChannelName: name }
}

/** 入力からイベントを組み立てる純関数。表示名を上書きできる */
export function buildManualEvent(
  raw: string,
  displayName: string,
  detectedAt: number,
): RedirectEvent | null {
  const parsed = parseManualInput(raw)
  if (!parsed) return null
  const name = displayName.trim() || parsed.sourceChannelName
  return {
    sourceChannelName: name,
    sourceChannelUrl: parsed.sourceChannelUrl,
    detectedAt,
    origin: 'manual',
  }
}

const PANEL_STYLE = `
:host { all: initial; }
.root {
  position: fixed; right: 8px; bottom: 8px; z-index: 2147483647;
  font: 12px/1.5 system-ui, sans-serif; color: #eee;
}
button { font: inherit; cursor: pointer; }
.toggle {
  border: 0; border-radius: 999px; padding: 6px 10px;
  background: #2f2f2f; color: #eee; opacity: .75;
}
.toggle:hover { opacity: 1; }
.panel {
  display: none; margin-top: 6px; padding: 10px; width: 236px;
  background: #1f1f1f; border: 1px solid #444; border-radius: 8px;
}
.panel[data-open="1"] { display: block; }
label { display: block; margin: 0 0 2px; color: #aaa; }
input {
  width: 100%; box-sizing: border-box; margin-bottom: 8px; padding: 4px 6px;
  font: inherit; color: #eee; background: #111; border: 1px solid #555; border-radius: 4px;
}
.run { width: 100%; padding: 5px; border: 0; border-radius: 4px; background: #3ea6ff; color: #06121f; }
.pin-only {
  width: 100%; margin-top: 6px; padding: 5px;
  border: 1px solid #666; border-radius: 4px; background: transparent; color: #ddd;
}
hr { border: 0; border-top: 1px solid #444; margin: 10px 0 8px; }
.note { color: #888; margin: 0 0 6px; }
.status { margin-top: 6px; min-height: 1.5em; color: #ffb4b4; }
.status[data-ok="1"] { color: #9fdf9f; }
`

export type ManualTriggerOptions = {
  root?: Document
  onTrigger: (event: RedirectEvent) => void | Promise<void>
  /**
   * 切り分け用: **投稿せずに固定だけ**を試す。結果の文字列を返す。
   * ③ が単独で動くかを、①② と切り離して確認するための経路。
   */
  onPinTest?: () => Promise<string> | string
  now?: () => number
}

export type ManualTriggerHandle = {
  destroy(): void
}

/**
 * チャット文書内に小さなトリガー UI を差し込む。
 * YouTube 側の CSS と干渉しないよう shadow DOM に閉じる。
 */
export function mountManualTrigger(opts: ManualTriggerOptions): ManualTriggerHandle {
  const doc = opts.root ?? document
  const now = opts.now ?? (() => Date.now())

  const host = doc.createElement('div')
  host.id = 'yt-redirect-pin-manual-trigger'
  const shadow = host.attachShadow({ mode: 'open' })

  const style = doc.createElement('style')
  style.textContent = PANEL_STYLE

  const root = doc.createElement('div')
  root.className = 'root'
  root.innerHTML = `
    <button class="toggle" type="button" title="リダイレクト返礼を手動で投稿する">↩ 返礼</button>
    <div class="panel">
      <label for="ytrp-url">送信元チャンネル URL / @ハンドル</label>
      <input id="ytrp-url" type="text" placeholder="https://www.youtube.com/@example-channel" />
      <label for="ytrp-name">表示名(空なら URL から補う)</label>
      <input id="ytrp-name" type="text" placeholder="(任意)" />
      <button class="run" type="button">投稿して固定</button>
      <hr />
      <p class="note">切り分け用: 投稿せず、チャットの最後のメッセージを固定してみる</p>
      <button class="pin-only" type="button">固定だけ試す</button>
      <div class="status"></div>
    </div>
  `

  shadow.append(style, root)

  const panel = root.querySelector<HTMLElement>('.panel')!
  const toggle = root.querySelector<HTMLButtonElement>('.toggle')!
  const runButton = root.querySelector<HTMLButtonElement>('.run')!
  const pinOnlyButton = root.querySelector<HTMLButtonElement>('.pin-only')!
  const urlInput = root.querySelector<HTMLInputElement>('#ytrp-url')!
  const nameInput = root.querySelector<HTMLInputElement>('#ytrp-name')!
  const status = root.querySelector<HTMLElement>('.status')!

  const setStatus = (message: string, ok = false): void => {
    status.textContent = message
    status.dataset.ok = ok ? '1' : '0'
  }

  const onToggle = (): void => {
    const open = panel.dataset.open === '1'
    panel.dataset.open = open ? '0' : '1'
    if (!open) urlInput.focus()
  }

  const onRun = (): void => {
    const event = buildManualEvent(urlInput.value, nameInput.value, now())
    if (!event) {
      setStatus('チャンネル URL として解釈できない')
      return
    }
    setStatus(`実行: ${event.sourceChannelName}`, true)
    try {
      void opts.onTrigger(event)
    } catch (err) {
      log.error('手動トリガーで例外:', err)
      setStatus('実行に失敗した(詳細はコンソール)')
    }
  }

  const onPinOnly = (): void => {
    if (!opts.onPinTest) {
      setStatus('固定テストは無効')
      return
    }
    setStatus('固定を試している…', true)
    void (async () => {
      try {
        setStatus(`固定結果: ${await opts.onPinTest!()}`, true)
      } catch (err) {
        log.error('固定テストで例外:', err)
        setStatus('固定テストに失敗した(詳細はコンソール)')
      }
    })()
  }

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Enter') onRun()
  }

  toggle.addEventListener('click', onToggle)
  runButton.addEventListener('click', onRun)
  pinOnlyButton.addEventListener('click', onPinOnly)
  urlInput.addEventListener('keydown', onKey)
  nameInput.addEventListener('keydown', onKey)

  doc.body.appendChild(host)

  return {
    destroy() {
      host.remove()
    },
  }
}
