---
feature: redirect-pin
test: npm run typecheck && npx vitest run
---

# 001 実装計画

## 方針

**API を使わず、ブラウザ内で ①検知 ②投稿 ③固定 を完結させる。**

③(固定)がどのみち DOM 操作でしか実現できない以上、①②だけ API 側に置いても
構成が二重化してメリットが無い。全部を content script に寄せると、OAuth もクォータも不要になる。

```
ログイン済みブラウザで自分の配信の live_chat ページを開いておく
  → content script が chat DOM を MutationObserver で監視
  → リダイレクト通知ノードを検出 → 送信元の表示名 / チャンネル URL を抽出
  → テンプレートから投稿文を生成 → チャット入力欄へ入れて送信
  → 自分が投稿したメッセージを特定 → メニューから「固定」をクリック
```

- 利点: OAuth 不要 / API クォータ不要(数秒間隔のチャットポーリングは既定の 1 日 1 万ユニットで足りない)/
  ①②③が同じ DOM 知識で書ける
- 欠点: ブラウザを開きっぱなしにする必要がある / YouTube の UI 変更で壊れる

### 採用形態(D4 の提案)

**Chrome 拡張 (MV3) の content script。** 理由:

| 候補 | 評価 |
|---|---|
| **Chrome 拡張 (MV3)** | ◎ 配信用ブラウザに入れておけば常時有効。設定 UI(options page)と永続設定(`chrome.storage`)が素直 |
| Tampermonkey ユーザースクリプト | ○ 一番軽いが、設定 UI と配布・更新が雑になる |
| Playwright で別ブラウザを起動 | △ 配信者本人のログインセッションと別になり、投稿の名義・固定権限が面倒。常駐プロセスも増える |

### 対象ウィンドウ — ポップアウトチャットを主対象にする

ライブチャットは独立ウィンドウにポップアウトでき、それが `live_chat` ページの実体そのもの。
**ポップアウトを主対象にすると、watch ページ内の iframe を跨がずトップレベル文書として扱えるため実装が単純になる。**

```jsonc
// manifest.json
"content_scripts": [{
  "matches": [
    "https://www.youtube.com/live_chat*",      // ポップアウト (?is_popout=1) と watch 埋め込み iframe
    "https://studio.youtube.com/live_chat*"    // Studio ライブ管制室からのポップアウト
  ],
  "all_frames": true                            // 埋め込み iframe でも動くように
}]
```

- `all_frames: true` にしておけば、ポップアウトと watch ページ埋め込みの**両対応が追加コストほぼゼロ**で成立する。
- 運用上の利点: 配信画面を閉じてもチャットウィンドウだけ常駐させられる。サブモニタに小さく置ける。

**未確認(T1 で確認する):**

- **C1: リダイレクト受信の通知がポップアウトチャットにも出るか。** watch ページのプレイヤー上バナーにしか
  出ない場合、ポップアウト単独では検知できず、watch ページ or Studio 管制室を開いておく必要がある。
- **C2: ポップアウトのメッセージメニューに「固定」があるか。** `www` 版と `studio` 版で
  モデレーション操作の出方が異なる可能性がある。差があるなら `studio` 版を推奨構成にする。
- **C3: ウィンドウが最小化・非前面のときのスロットリング。** 検知は `MutationObserver`(DOM 変更駆動)で
  タイマーに依存しないため影響は小さいはずだが、**バックグラウンドで実際に発火し続けるかは実測が要る**。
  ここが駄目ならウィンドウを可視のまま置く運用制約になる。

## モジュール構成

```
src/
  selectors.ts   # DOM セレクタを一箇所に集約(YouTube UI 変更時はここだけ直す)
  detector.ts    # MutationObserver → RedirectEvent を emit
  composer.ts    # テンプレート + RedirectEvent → 投稿文
  poster.ts      # チャット入力欄へ投稿し、投稿された自分のメッセージ要素を返す
  pinner.ts      # pinMode を解釈し、メッセージ要素 → メニュー → 「固定」クリック
  dedupe.ts      # 同一送信元・クールダウンの多重発火抑止
  config.ts      # テンプレート / 有効無効 / クールダウン / pinMode (chrome.storage)
  main.ts        # 上記を配線。全体を try/catch で包む(AC6)
options/         # 設定 UI(テンプレート編集・ON/OFF)
tests/fixtures/  # 採取した live_chat DOM の匿名化スナップショット
```

```ts
type RedirectEvent = {
  sourceChannelName: string
  sourceChannelUrl: string   // https://www.youtube.com/@handle または /channel/UC...
  detectedAt: number
}

/** 固定モード (AC8) */
type PinMode =
  | 'off'      // 固定しない(投稿のみ)
  | 'ifEmpty'  // 既存の固定が無いときだけ固定する(既定)
  | 'always'   // 既存の固定があっても上書きする

type Config = {
  enabled: boolean
  template: string           // 例: '{name}さんからリダイレクトありがとうございます! {url}'
  pinMode: PinMode
  cooldownSec: number
}
```

`pinner.ts` は「固定するかどうか」の判断を持ち、DOM 操作はその結果でしかない:

```ts
async function pin(el: HTMLElement, mode: PinMode): Promise<'pinned' | 'skipped' | 'unavailable'>
```

- `off` → 何もせず `skipped`
- `ifEmpty` → 既存の固定バナーを検出。あれば `skipped`、無ければ固定して `pinned`
- `always` → 既存を見ずに固定して `pinned`
- 固定 UI 自体が見つからない → `unavailable`(投稿は成立しているので処理は継続 / AC6)

**壊れやすさの隔離**: DOM に触るのは `selectors.ts` / `poster.ts` / `pinner.ts` の 3 つだけ。
`detector.ts` 以降は `RedirectEvent` を介して DOM から切り離し、テスト可能にする。

## テスト戦略

`test: npm run typecheck && npx vitest run`

| 対象 | やり方 |
|---|---|
| `detector` | 採取した live_chat DOM の fixture を jsdom に流し、`RedirectEvent` が正しく出るか |
| `composer` | テンプレート差し込み(`{name}` `{url}`、エスケープ、長さ上限) |
| `dedupe` | 同一送信元の連続発火 / クールダウン明け / 配信をまたいだ場合 |
| `pinner` | `PinMode` × 既存固定バナーの有無 → 期待する戻り値(`pinned`/`skipped`/`unavailable`)の分岐を fixture + スタブで検証 |
| `poster` | 単体テストは骨組みのみ。**実際の合否は実配信での通し確認 (T8)** に依存 |

> ⚠️ **fixture に実在する第三者の識別子(チャンネル名・ハンドル・ID)を残さない。**
> 採取した DOM は必ず匿名化してからコミットする(→ [max/CLAUDE.md](../../../../max/CLAUDE.md))。
> 2026-08-02 に `obs-tachie-generator` で実データ混入事故があるため、ここは自動化せず目視で確認する。

## リスク / 降りる箇所

- **R1(最大): 受信側のチャット欄に、送信元が特定できる形の通知が実際に出るか未確認。**
  出ない、または送信元チャンネルが取れない形式だった場合、① 検知が成立しない。
  → **代替: ①だけ手動トリガー**(ホットキー / OBS ボタンで送信元を選ぶ)にして ②③ を自動化する縮小版に切り替える。
  T1 の結果が出るまで T3 以降の仕様は確定できない。**T1 完了時にいったん人間に返す。**
- **R2: チャットへの URL 投稿がスパムフィルタで弾かれる可能性。**
  チャンネル所有者でもリンクがブロックされることがある。
  → 代替文面(URL 無し・チャンネル名と `@ハンドル` のみ)をテンプレートで選べるようにする。
- **R3: 「固定」UI の出現条件。** 画面幅・権限・チャットのモードで操作パスが変わりうる。
  想定 UI が見つからない場合は**固定をスキップして投稿だけ成立させる**(AC6)。
- **R4: `ifEmpty` の実現可否。** 既定モード `ifEmpty` は「現在何かが固定されているか」を
  DOM から判定できることが前提。判定手段が無ければ `off` / `always` の 2 値に縮退し、
  既定は `always` になる(告知を固定している場合は配信者が `off` にする運用)。**T1 で確認。**
- **R5: 自動投稿の是非**(spec D3)。**人間の判断が要る。実装完了後、有効化の前に確認する。**

## 段階

- **Phase 0 (T1)** — 実配信で DOM を採取。ここが通らないと先に進めない。
- **Phase 1 (T2–T4)** — 検知〜文面生成。fixture ベースで自動テスト可能。
- **Phase 2 (T5–T6)** — 投稿・固定。DOM 操作の実体。
- **Phase 3 (T7–T8)** — 設定 UI と実配信での通し確認。
