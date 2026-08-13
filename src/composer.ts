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

/**
 * **自由文 1 件**の保存上限 (`DirectoryEntry.message` / AC6)。
 *
 * ⚠️ `MAX_MESSAGE_LENGTH`(**投稿文全体**の上限)とは別物。同じ 200 だが意味が違うので、
 *    片方を動かしたときにもう片方が黙って変わらないよう**別の定数として切ってある。**
 *    定型部分と URL が先に場所を食うため、自由文が 200 字まるごと投稿に載ることは構造上あり得ない。
 *
 * ⚠️ **単位はコードポイント**(`Array.from(value).length`)。`String.prototype.length` ではない。
 *    自由文は絵文字が入るのが普通で、UTF-16 コードユニットで数えると絵文字が 2 と数えられ、
 *    **設定画面の検証と保存時の切り詰めで数が食い違う。**この定数を使う側は全部この単位で数える。
 */
export const MAX_ENTRY_MESSAGE_LENGTH = 200

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
