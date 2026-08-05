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

### 対象ウィンドウ — **`studio.youtube.com` のライブ管制室だけ**

```jsonc
// manifest.json
"content_scripts": [{
  "matches": ["https://studio.youtube.com/live_chat*"],  // 管制室の埋め込みとポップアウト
  "all_frames": true                                     // 管制室では iframe に入るため必須
}]
```

⚠️ **`www.youtube.com/live_chat*` は意図的に対象外**(2026-08-06 の事故)。

当初は「ポップアウトを主対象、`www` と `studio` の両方に注入」としていたが、
**`www` のライブチャットは他人の配信でも開ける。**そこで動かすと、他人の配信が
リダイレクトを受けたときに**自分の名義でその配信のチャットへ投稿してしまう**。
実際に起きた。

`www` で「自分の配信かどうか」を DOM から判別する確実な手段が無い以上、
**設定で許可する余地も持たせない**(「ON にすると他人のチャットを荒らしうる」設定は
安全にしようがない)。ライブ管制室は自分の配信でしか開けないため、これが
「自分の配信である」ことの代わりに使える唯一の確実な手掛かり。

- ポップアウト運用は `studio.youtube.com/live_chat?is_popout=1` で足りる。
  運用上の利点(配信画面を閉じてもチャットだけ常駐 / サブモニタに置ける)はそのまま。
- `all_frames: true` は管制室のチャットが iframe のため必須。
- コード側にも `src/scope.ts` で同じ判定を置き、注入先が増えたときの二重の歯止めとする。

**T1 の結果 (2026-08-05 / 詳細は [docs/t1-findings.md](../../docs/t1-findings.md)):**

- **C1: 通知の出る場所** → **Studio 管制室に埋め込まれたチャットで確認。**`all_frames: true` により
  iframe 内でも content script は動く。**ただし通知はチャット項目リスト (`#items`) の中ではなく
  その外に出る**ため、監視・走査とも `body` 全体を対象にする必要がある。
  ⚠️ `www` のポップアウトにも出るかは**未確認**。
- **C2: メニューの「固定」** → **ある。**メッセージのメニューは
  `["チャンネルへ", "メッセージを固定", "削除"]`。③ は実現可能で、実際に `pinned` まで通した。
  ⚠️ `click()` だけではドロップダウンが開かない。**座標付きのポインタイベント**が要る。
- **C3: 最小化・非前面でのスロットリング** → **未確認。**

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

- ~~**R1(最大): 受信側のチャット欄に通知が出るか**~~ → **解消 (2026-08-05)。出る。**
  文言は `@<送信元> とその視聴者が参加しました。挨拶しましょう。`。
  ⚠️ **「リダイレクト」という語は含まれない。**文言だけで判定する実装は、この語を
  前提にすると必ず外す。またハンドルは**日本語のことがある**ため、ASCII 前提の抽出も外す。
  なお手動トリガーは常設したままにする(切り分けと、通知形式が変わったときの逃げ道)。
- **R2: チャットへの URL 投稿がスパムフィルタで弾かれる可能性。**
  チャンネル所有者でもリンクがブロックされることがある。
  → 代替文面(URL 無し・チャンネル名と `@ハンドル` のみ)をテンプレートで選べるようにする。
  **投稿自体は通ることを確認済み**だが、URL が有効かは未確認(下記 R6)。
- ~~**R3: 「固定」UI の出現条件**~~ → **解消 (2026-08-05)。**「メッセージを固定」は存在し、
  実際に固定できた。ただし**プログラムからの `click()` では開かない**ため、座標付きの
  ポインタイベントが要る。UI が見つからない場合に投稿だけ成立させる方針 (AC6) は維持。
- **R4: `ifEmpty` の実現可否。** `yt-live-chat-pinned-message-renderer` は**何も固定していなくても
  `hidden` で常駐する**ため、要素の有無だけで判定すると一度も固定しない。表示状態と中身まで
  見るよう修正済み。⚠️ **実際に固定した状態のバナーを拾えるかは未確認。**
- **R5: 自動投稿の是非**(spec D3)。**人間の判断が要る。実装完了後、有効化の前に確認する。**
- ~~**R6(新): 通知の `@名前` がハンドルとは限らない**~~ → **解消 (2026-08-05)。**
  投稿された URL から送信元チャンネルへ実際に遷移できることを確認した。
  通知の `@名前` は**実際のハンドル**で、**日本語のハンドルが実在する**。
  これで **AC2(投稿文に送信元の URL と表示名が含まれる)は満たされた。**

## 段階

- **Phase 0 (T1)** — 実配信で DOM を採取。ここが通らないと先に進めない。
- **Phase 1 (T2–T4)** — 検知〜文面生成。fixture ベースで自動テスト可能。
- **Phase 2 (T5–T6)** — 投稿・固定。DOM 操作の実体。
- **Phase 3 (T7–T8)** — 設定 UI と実配信での通し確認。
