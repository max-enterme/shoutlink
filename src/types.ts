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
   * `www.youtube.com` のライブチャットでも動かす。**既定は false。**
   *
   * ⚠️ ここを true にすると、**他人の配信のチャットを開いているだけで動く。**
   *    その配信がリダイレクトを受けると、自分の名義で投稿してしまう (2026-08-06 の事故)。
   */
  allowWww: boolean
  /**
   * 自分のチャンネル(`@ハンドル` または URL)。
   *
   * リダイレクトを**送った**ときにも自分のチャットにバナーが出る。そこに載っているのは
   * 送信先(自分ではない)だが、取り違えの保険として、送信元が自分自身になった場合は捨てる。
   * 空なら judgement しない。
   */
  ownChannelUrl: string
}

/** pinner.ts の戻り値 (plan.md) */
export type PinResult = 'pinned' | 'skipped' | 'unavailable'
