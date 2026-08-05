/** リダイレクト受信イベント (plan.md のモジュール構成に対応) */
export type RedirectEvent = {
  sourceChannelName: string
  /** https://www.youtube.com/@handle または https://www.youtube.com/channel/UC... に正規化済み */
  sourceChannelUrl: string
  detectedAt: number
  /**
   * 発生経路。自動検知と手動トリガーは同じ RedirectEvent としてパイプラインを流れる
   * (分岐を 2 系統にしない)。ログ・デバッグ用の付加情報でしかない。
   */
  origin?: 'auto' | 'manual'
}

/** 固定モード (AC8) */
export type PinMode =
  | 'off' // 固定しない(投稿のみ)
  | 'ifEmpty' // 既存の固定が無いときだけ固定する(既定)
  | 'always' // 既存の固定があっても上書きする

export type Config = {
  enabled: boolean
  /** 例: '{name}さんからリダイレクトありがとうございます! {url}' */
  template: string
  pinMode: PinMode
  cooldownSec: number
  /**
   * 診断ログ。チャットに現れた「通常のメッセージ以外」のノードをすべてコンソールに出す。
   * リダイレクト通知の DOM が未確認(T1 未完)の間、その正体を掴むための唯一の手段。
   */
  debug: boolean
  /**
   * 自分のチャンネル(`@ハンドル` または URL)。**任意。空なら何も判定しない。**
   *
   * 用途は **「送信元が自分自身になったら捨てる」** の一点。
   * 抽出のバグで自分に向けてお礼を投稿する失敗を止める最後の歯止め。
   * 実際、2026-08-05 に起きた 2 件(コンテナ誤検知で自分のハンドルを拾う /
   * 自分が投稿した返礼を再検知する)は、どちらも送信元が自分になっていた。
   *
   * ⚠️ **送信側バナーの誤検知には効かない。**あのバナーが載せているのは送信先であって
   *    バナーを見ている本人ではないため。そちらは文言パターンで防いでいる。
   */
  ownChannelUrl: string
}

/** pinner.ts の戻り値 (plan.md) */
export type PinResult = 'pinned' | 'skipped' | 'unavailable'
