# yt-redirect-pin

YouTube ライブ配信で**他チャンネルからライブリダイレクトを受け取ったとき**に検知し、
送信元チャンネルの URL をライブチャットへ投稿して、そのメッセージを固定する。

status: 実装中(T2–T7 実装済み / **T1・T1b・T8 は未実施**)

## ドキュメント

規約は [SPEC-OPS.md](../../SPEC-OPS.md)。

| ファイル | 内容 |
|---|---|
| [specs/001-redirect-pin/spec.md](specs/001-redirect-pin/spec.md) | 何を・なぜ / 受け入れ条件 / 降りる箇所 |
| [specs/001-redirect-pin/plan.md](specs/001-redirect-pin/plan.md) | 構成・モジュール・テスト戦略・リスク |
| [specs/001-redirect-pin/tasks.md](specs/001-redirect-pin/tasks.md) | 作業分解(T1–T8) |

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

### 構成

| ファイル | 役割 |
|---|---|
| `src/selectors.ts` | **DOM 依存の集約点。**候補の配列を先頭から試す。他モジュールは `document.querySelector` を直接呼ばない |
| `src/detector.ts` | MutationObserver → `RedirectEvent`。抽出部は純関数 (`extractRedirectEvent`) として分離 |
| `src/composer.ts` | テンプレート差し込み (`{name}` `{url}`) |
| `src/dedupe.ts` | 同一送信元・クールダウンの多重発火抑止 |
| `src/poster.ts` | チャット入力欄への投稿と、投稿した自分のメッセージ要素の特定 |
| `src/pinner.ts` | `PinMode` の解釈と「固定」の実行 |
| `src/manual-trigger.ts` | **手動トリガー UI(常設)。**自動検知と同じ `RedirectEvent` を同じパイプラインに流す |
| `src/config.ts` | `chrome.storage` 永続化 |
| `src/main.ts` | 配線。全体を try/catch (AC6) |

## 次にやること

**T1: 実配信でリダイレクトを受け、`live_chat` の DOM を採取する。**
受信側チャットに送信元が特定できる通知が出るかは未確認で、ここが全体のゲート。

⚠️ **現在の `src/selectors.ts` のセレクタ・文言はすべて推測値**(各定義に `TODO(T1)`)。
`tests/fixtures/live-chat.ts` も実 DOM ではなく合成 DOM。テストが緑でも実配信で動く保証はない。

自動検知が空振りでも成果物が動くよう、**手動トリガーを常設の経路として実装済み**
(ライブチャット画面右下の「↩ 返礼」に送信元 URL を入れると、投稿 → 固定が自動検知時と
同じ経路を通る)。

**有効化の前に spec.md D3(自動投稿の是非)の判断が要る。**
