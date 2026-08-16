/**
 * テンプレート + RedirectEvent → 投稿文 (AC2 / AC5)。
 * DOM に触らない純関数。
 */
import type { RedirectEvent } from './types'

/**
 * ライブチャット 1 メッセージの文字数上限。
 *
 * ⚠️ 200 は一般に知られている値だが、このプロジェクトでは未検証。
 *    しかも**「超えたら弾かれるか」は拡張経由では観測できない** — `compose` は必ず上限以下に
 *    切り詰めて返すので、この拡張が 200 字超を投稿することが構造上あり得ないため(003 plan.md R1)。
 *    003 の T6(実配信での通し確認)で見るのは「**ちょうど 200 字**の文面が通ること」まで。
 *    実値そのものを知りたい場合はチャット入力欄へ直接貼って確かめ、
 *    分かったことを `docs/003-findings.md` に残す。
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

const PLACEHOLDER = /\{(name|url|msg)\}/g
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f]+', 'g')

/**
 * 自由文を削るときに、これ未満しか残せないなら**自由文ごと落とす** (AC4)。
 * 「あ…」だけが残る文面は、書いた側の意図が伝わらないうえ意味が変わりうるため。
 */
const MIN_KEPT_MESSAGE_LENGTH = 10

/** 改行・制御文字を落として 1 行に潰す。チャット入力欄は 1 行のため */
function sanitize(value: string): string {
  return value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim()
}

/** テンプレートへ差し込む値。すべて差し込み前に `sanitize` 済みである前提 */
export type TemplateValues = {
  /** `{name}` — 呼び名(未設定ならハンドル / 検知した表示名) */
  name: string
  /** `{url}` — 送信元チャンネル URL */
  url: string
  /** `{msg}` — 送信元ごとの自由文。空文字なら `{msg}` は消える (AC2) */
  message: string
}

/**
 * **1 パス**で差し込む。差し込んだ値の中に `{name}` `{url}` `{msg}` が含まれていても
 * 再展開しない (AC9)。**`{msg}` だけ先に別の `replace` で埋めてはいけない** —
 * そうすると自由文の中の `{url}` が後段で展開される。
 *
 * 空の `{msg}` を落としたあとの余った空白は、最後の `sanitize` が 1 つに畳む (AC2)。
 */
function render(template: string, values: TemplateValues): string {
  return sanitize(
    template.replace(PLACEHOLDER, (_, key: string) =>
      key === 'name' ? values.name : key === 'msg' ? values.message : values.url,
    ),
  )
}

/** 自由文を `keep` コードポイントまで縮めて「…」を付ける */
function ellipsize(chars: string[], keep: number): string {
  return `${chars.slice(0, keep).join('')}…`
}

/**
 * 「…」を付けて上限に収まる、自由文の**最長**の長さ(コードポイント数)を返す。
 * `MIN_KEPT_MESSAGE_LENGTH` 以上残せなければ `-1`(= 自由文ごと落とす / AC4)。
 *
 * ⚠️ **削る量を算術で見積もらない。** 上限は UTF-16 コードユニットで数えるのに、削る単位は
 *    コードポイントで、**絵文字では 1 : 2 にずれる。**見積もると過剰に削り、70 字残せる自由文が
 *    丸ごと落ちる(AC4 違反)。テンプレートが `{msg}` を複数回持てば 1 : n にもなる。
 *    **実際に組み立てた長さ**で決める。出力長は残す長さに対して単調非減少なので二分探索でよい。
 */
function longestFittingMessage(
  chars: string[],
  maxLength: number,
  build: (kept: string) => string,
): number {
  let lo = MIN_KEPT_MESSAGE_LENGTH
  // 全部残す形は既に収まらないと分かっている(呼び出し元が `full` で確認済み)ので 1 つ手前から
  let hi = chars.length - 1
  let best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (build(ellipsize(chars, mid)).length <= maxLength) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

export type ComposeOptions = {
  /** 既定は MAX_MESSAGE_LENGTH */
  maxLength?: number
  /**
   * `{msg}` に差し込む自由文 (AC1)。**辞書からの解決は呼び出し側の役目** —
   * `composer.ts` は辞書を知らないままでいる(単体テストの容易さを壊さない / plan.md)。
   */
  message?: string
}

/**
 * 差し込む相手。**「誰に・どの URL で」だけを持つ** (004 / plan.md 3.)。
 *
 * `RedirectEvent` を受けない形にしてあるのは、コメント経路には `RedirectEvent` が無いため
 * (リダイレクトを受けていないので作れない)。**引き金の種類を composer に持ち込まない。**
 */
export type ComposeTarget = {
  /** `{name}` に入る値。**呼び出し側が辞書から解決して渡す** */
  name: string
  /** `{url}` に入る値。**辞書に登録されている URL**(コメントから取った URL ではない / 004 AC5) */
  url: string
}

/**
 * テンプレートに `{name}` `{url}` `{msg}` を差し込む。
 *
 * - 差し込みは 1 パスで行う。値の中に `{url}` のような文字列が含まれても再展開しない (AC9)。
 * - 未知のプレースホルダ(`{foo}`)はそのまま残す。
 * - 上限を超える場合、**自由文 → 表示名 → 末尾**の順に削る (AC3)。
 *   自由文か表示名を削って収まるなら URL は壊れない。末尾切りは両方削っても収まらないときだけ。
 *
 * ⚠️ **リダイレクト返礼とコメント返しで規則を分けない。**004 が足したのは
 *    「`RedirectEvent` ではなく `{ name, url }` を受ける」ことと、`{msg}` に渡す値を
 *    **呼び出し側が選ぶ**ことだけで、削り順も切り出し単位も 003 のものをそのまま使う
 *    (spec.md D4 / 004 AC16)。
 */
export function composeText(
  template: string,
  target: ComposeTarget,
  opts: ComposeOptions = {},
): string {
  const maxLength = opts.maxLength ?? MAX_MESSAGE_LENGTH
  const url = sanitize(target.url)
  const name = sanitize(target.name)
  const message = sanitize(opts.message ?? '')

  const full = render(template, { name, url, message })
  if (full.length <= maxLength) return full

  // --- 1. 自由文を削る (AC3) ---------------------------------------------
  // 溢れる主因は自由文側。利用者が自分で書いたものより、相手の名前が消えるほうが事故として大きい。
  let current = full
  if (message) {
    // **コードポイント単位**で切り出す (AC4)。`slice` はサロゲートペアの中間で切れるため、
    // 末尾が絵文字の自由文で壊れた文字 (U+FFFD) が投稿される。自由文は絵文字が入るのが普通
    const chars = Array.from(message)
    const build = (kept: string): string => render(template, { name, url, message: kept })
    const keep = longestFittingMessage(chars, maxLength, build)
    if (keep >= MIN_KEPT_MESSAGE_LENGTH) return build(ellipsize(chars, keep))

    // 10 字未満しか残せない → **自由文ごと落として**次の段へ (AC4)。
    // 落とした形は AC2(自由文が未登録のとき)と同じになる
    current = render(template, { name, url, message: '' })
    if (current.length <= maxLength) return current
  }

  // --- 2. 超過分を表示名から削る(自由文が入る前からの挙動) ----------------
  // ここは `slice`(UTF-16)のまま。**AC11「`{msg}` を含まないテンプレートの出力が
  // 現状と 1 文字も変わらない」**を守るため、既存の削り方に手を入れない。
  //
  // 自由文は**この時点で必ず落ちている** — 少しでも残せるなら上で return しているため。
  // 「縮めた自由文を残したまま表示名を削る」経路は存在しないので `''` を直接渡す
  const over = current.length - maxLength
  if (name.length > over) {
    const shortened = `${name.slice(0, Math.max(1, name.length - over - 1))}…`
    const retried = render(template, { name: shortened, url, message: '' })
    if (retried.length <= maxLength) return retried
  }

  // --- 3. 末尾を切る(最終手段。**ここでは URL が壊れうる** — 現状どおり) ---
  return current.slice(0, maxLength)
}

/**
 * リダイレクト返礼の文面 (001 / 003)。**`composeText` の薄いラッパ。**
 *
 * 004 で本体を `{ name, url }` 化したときに、既存の呼び出し側を書き換えずに済ませるためのもの。
 * **ここに規則を足さない** — 足すなら `composeText` 側で、両方の経路に効く形にする。
 */
export function compose(template: string, event: RedirectEvent, opts: ComposeOptions = {}): string {
  return composeText(
    template,
    { name: event.sourceChannelName, url: event.sourceChannelUrl },
    opts,
  )
}

/**
 * 展開後の投稿文の長さ(**切り詰める前**)。設定画面の残り文字数の算出用 (AC8)。
 *
 * ⚠️ 数える単位は `compose` が上限と比べるのと**同じ `String.prototype.length`**。
 *    ここだけコードポイントで数えると、「あと 3 字」と出したのに投稿時に削られる、
 *    という嘘になる(自由文の保存上限 `MAX_ENTRY_MESSAGE_LENGTH` の単位とは別物)。
 */
export function composedLength(template: string, values: TemplateValues): number {
  return render(template, {
    name: sanitize(values.name),
    url: sanitize(values.url),
    message: sanitize(values.message),
  }).length
}

/**
 * 上限に対する残り文字数 (AC8)。**負でも保存は妨げない** — 投稿時に
 * AC3 / AC4 の規則で削られるだけなので、設定画面は「負である」と分かる形で出せばよい。
 */
export function remainingLength(
  template: string,
  values: TemplateValues,
  maxLength: number = MAX_MESSAGE_LENGTH,
): number {
  return maxLength - composedLength(template, values)
}
