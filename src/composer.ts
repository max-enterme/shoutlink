/**
 * テンプレート + RedirectEvent → 投稿文 (AC2 / AC5)。
 * DOM に触らない純関数。
 */
import type { RedirectEvent } from './types'

/**
 * ライブチャット 1 メッセージの文字数上限。
 * ⚠️ 200 は一般に知られている値だが、このプロジェクトでは未検証。
 *    T8(実配信での通し確認)で実際に弾かれないかを見る。
 */
export const MAX_MESSAGE_LENGTH = 200

const PLACEHOLDER = /\{(name|url)\}/g
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f]+', 'g')

/** 改行・制御文字を落として 1 行に潰す。チャット入力欄は 1 行のため */
function sanitize(value: string): string {
  return value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim()
}

export type ComposeOptions = {
  /** 既定は MAX_MESSAGE_LENGTH */
  maxLength?: number
}

/**
 * テンプレートに `{name}` `{url}` を差し込む。
 *
 * - 差し込みは 1 パスで行う。値の中に `{url}` のような文字列が含まれても再展開しない。
 * - 未知のプレースホルダ(`{foo}`)はそのまま残す。
 * - 上限を超える場合、**URL を壊さないよう先に表示名を削る**。それでも収まらなければ末尾を切る。
 */
export function compose(template: string, event: RedirectEvent, opts: ComposeOptions = {}): string {
  const maxLength = opts.maxLength ?? MAX_MESSAGE_LENGTH
  const url = sanitize(event.sourceChannelUrl)
  const name = sanitize(event.sourceChannelName)

  const render = (nameValue: string): string =>
    sanitize(template.replace(PLACEHOLDER, (_, key: string) => (key === 'name' ? nameValue : url)))

  const full = render(name)
  if (full.length <= maxLength) return full

  // 超過分を表示名から削る
  const over = full.length - maxLength
  if (name.length > over) {
    const shortened = `${name.slice(0, Math.max(1, name.length - over - 1))}…`
    const retried = render(shortened)
    if (retried.length <= maxLength) return retried
  }

  return full.slice(0, maxLength)
}
