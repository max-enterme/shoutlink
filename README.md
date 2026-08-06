# yt-redirect-pin

YouTube ライブ配信で**他チャンネルからライブリダイレクトを受け取ったとき**に検知し、
送信元チャンネルの URL をライブチャットへ投稿して、そのメッセージを固定する。

status: 実装中(T1–T7 完了 / **実配信で ①検知 → ②投稿 → ③固定 が通った** / T8 は一部残り)

## ドキュメント

規約は [SPEC-OPS.md](../../SPEC-OPS.md)。

| ファイル | 内容 |
|---|---|
| [specs/001-redirect-pin/spec.md](specs/001-redirect-pin/spec.md) | 何を・なぜ / 受け入れ条件 / 降りる箇所 |
| [specs/001-redirect-pin/plan.md](specs/001-redirect-pin/plan.md) | 構成・モジュール・テスト戦略・リスク |
| [specs/001-redirect-pin/tasks.md](specs/001-redirect-pin/tasks.md) | 作業分解(T1–T8) |
| [docs/setup-and-verify.md](docs/setup-and-verify.md) | **導入手順・設定・動作確認・切り分け・T1 の DOM 採取手順** |
| [docs/security-review.md](docs/security-review.md) | **セキュリティ点検 / インシデント点検 (2026-08-06)。未対応の指摘 S1–S9** |

## 前提(調査済み)

| 工程 | 公式 YouTube Data API | 判定 |
|---|---|---|
| ① リダイレクト受信の検知 | 該当イベント type が存在しない | ✗ |
| ② コメント/チャットへ投稿 | `liveChatMessages.insert` / `commentThreads.insert` | ○ |
| ③ そのコメントを固定 | エンドポイントが存在しない | ✗ |

③がどのみち DOM 操作でしか実現できないため、**Chrome 拡張 (MV3) の content script で
①②③を完結させる**方針。詳細は plan.md。

## 開発

```bash
npm install
npm run typecheck && npx vitest run
npm run build
```

`npm run build` が `dist/` に MV3 拡張を吐く(`chrome://extensions` の「パッケージ化されていない
拡張機能を読み込む」で `dist/` を指定する)。設定は拡張機能のオプションページ。

**導入から動作確認までの手順は [docs/setup-and-verify.md](docs/setup-and-verify.md)。**

### 他人に渡してテストしてもらう

```bash
npm run package
```

`release/yt-redirect-pin-test-<version>.zip` ができる。中身は
`START-HERE.md`(テスター向け手順書)/ `extension/`(読み込むフォルダ)/ `source/`(監査用のソース一式)。
渡す相手向けの説明は [docs/for-testers.md](docs/for-testers.md)。

### 構成

| ファイル | 役割 |
|---|---|
| `src/selectors.ts` | **DOM 依存の集約点。**候補の配列を先頭から試す。他モジュールは `document.querySelector` を直接呼ばない |
| `src/detector.ts` | MutationObserver → `RedirectEvent`。抽出部は純関数 (`extractRedirectEvent`) として分離 |
| `src/composer.ts` | テンプレート差し込み (`{name}` `{url}`) |
| `src/dedupe.ts` | 同一送信元・クールダウンの多重発火抑止。**クールダウンは同一配信内でのみ適用**(配信が違えば通す) |
| `src/post-log.ts` | 投稿履歴 (`chrome.storage.local`)。**リロードをまたいで再投稿を止める土台。**誰に・何を・いつ・どの配信で |
| `src/poster.ts` | チャット入力欄への投稿と、投稿した自分のメッセージ要素の特定 |
| `src/pinner.ts` | `PinMode` の解釈と「固定」の実行 |
| `src/manual-trigger.ts` | 手動トリガー UI(設定 `showManualTrigger` / **既定 OFF**)。自動検知と同じ `RedirectEvent` を同じパイプラインに流す |
| `src/self-echo.ts` | 自分の投稿(とその固定バナー)を通知として拾い直す自己ループの抑止。**設定と独立** |
| `src/config.ts` | `chrome.storage` 永続化 |
| `src/main.ts` | 配線。全体を try/catch (AC6) |

## 実配信で確認できたこと (2026-08-05)

**①検知 → ②投稿 → ③固定が通った。**詳細は [docs/t1-findings.md](docs/t1-findings.md)。

要点(推測が外れていた箇所):

- 通知の文言は `@<送信元> とその視聴者が参加しました。` で、**「リダイレクト」を含まない**
- **ハンドルは日本語のことがある**(ASCII 前提の抽出では取れない)
- 通知は**チャット項目リスト (`#items`) の外**に出る
- 固定バナーの要素は**何も固定していなくても `hidden` で常駐する**
- メニューは `click()` では開かない。**座標付きのポインタイベント**が要る

## 次にやること

**T8 の残り**(AC2 は確認済み — 投稿された URL から送信元チャンネルへ遷移できた):

- 自動経路の通しで、**投稿したメッセージ自体**が固定されるか
- 受信から投稿までの所要時間(AC1: 10 秒以内)
- `ifEmpty` が実際の固定バナーを拾うか(plan.md R4)

⚠️ `src/selectors.ts` には**確認済みの定義と推測のままの定義が混在**している。各定義のコメントに
`✅ 確認済み` / `TODO(T1)` を書き分けてある。`tests/fixtures/live-chat.ts` は依然として合成 DOM。

自動検知と並んで、**手動トリガーの経路がある**(設定「手動トリガーを出す」= ON でライブチャット
画面右下に「↩ 返礼」。**既定は OFF** — 配信画面への映り込み対策 / security-review.md S8)。
同じパネルの **「固定だけ試す」** は、投稿せずに固定だけを試す切り分け用の経路。

**有効化の前に spec.md D3(自動投稿の是非)の判断が要る。**
