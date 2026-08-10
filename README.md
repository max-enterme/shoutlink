# yt-redirect-pin

**YouTube のライブ配信で他チャンネルからライブリダイレクトを受け取ったとき、送信元チャンネルの
URL をライブチャットへ投稿して固定する Chrome 拡張 (MV3)。**

[![release](https://img.shields.io/github/v/release/max-enterme/yt-redirect-pin?label=release&sort=semver)](https://github.com/max-enterme/yt-redirect-pin/releases/latest)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

説明ページ → **<https://max-enterme.github.io/yt-redirect-pin/>**

---

## ⚠️ 使う前に読んでください

**この拡張は Chrome ウェブストアには出していません。** 出さないと決めました。

ストアの審査は**単一用途・権限・データの扱い**を見るもので、**YouTube の規約に触れるかは見てくれません。**
つまり審査を通っても「規約上セーフ」の裏付けにはならず、**通ったという事実が誤った安心になる。**
そしてストアに出すというのは、自分がリスクを取ることではなく、**事情を知らない人にリスクを負わせること**でもあります。

- **YouTube の規約上、グレーな行為を含みます。**
  利用規約は「自動化された手段を使用して本サービスにアクセスすること」を禁じています。
  本拡張がこれに当たるかは文言からは決まらず、**YouTube の公式見解も、この形での処分の前例も
  見つかっていません。**「安全である証拠」ではなく「証拠が無い」という状態です。
  → 調べたことは全部 [docs/d3-automation-policy.md](docs/d3-automation-policy.md) に置いてあります。
- **投稿はあなた自身のアカウントの名義で行われます。** 何かあったとき失うのはあなたのチャンネルです。
- **未署名の拡張です。** デベロッパーモードでの読み込みになり、自動更新もされません。
- **YouTube の画面構造の変更で、ある日突然動かなくなります。** DOM に依存しているためです。
- **ほとんど検証されていません。** 実配信で通ったのは**日本語 UI・Studio のチャット・1 環境だけ**で、
  既定の固定モード `ifEmpty` の判定は**未検証**です (→ [状態](#状態))。

**リスクを自分で判断・管理できる人が、自己責任で使うことを想定しています。**
判断がつかない場合は、使わないでください。作者は結果について責任を負いません ([LICENSE](LICENSE))。

> **「有効にする」を外すと、自動検知も手動の「↩ 返礼」も止まります。**
> 止めたいときの唯一のスイッチで、経路を選り分ける設定は今のところありません。

---

## 何をするか

```
① 検知          ② 投稿                        ③ 固定
リダイレクトの   「◯◯さんからリダイレクト        その投稿を
受信通知を検知    ありがとうございます! URL」    チャット上部に固定
                 をチャットへ投稿
```

配信中に「誰から来たのか」を確認して、チャンネル URL をコピーして、投稿して、固定する ——
この一連の操作を、リダイレクトを受け取った時点で肩代わりします。

| | |
|---|---|
| 投稿文 | テンプレートで編集できる (`{name}` に表示名、`{url}` にチャンネル URL) |
| 呼び名 | 送信元ごとに呼び名を登録できる。リダイレクトを受けた相手は自動で一覧に載る |
| 固定モード | `off` (固定しない) / `ifEmpty` (既存の固定が無いときだけ) / `always` (上書き) |
| 多重発火の抑止 | 同一送信元はクールダウン内 1 回まで (既定 10 分) |
| 手動トリガー | チャット右下の「↩ 返礼」。自動検知が動かない環境でも実行できる |
| 止める | 設定の「有効にする」を外せば即止まる (自動・手動とも) |

**動くのは `studio.youtube.com` のライブ管制室のチャットだけです。**
`www.youtube.com` のライブチャットは他人の配信でも開けてしまい、自分の配信かどうかを
判別できないため、意図的に対象外にしています。

### 前提

| | |
|---|---|
| ブラウザ | Chrome (Chromium 系なら概ね動くはずですが、確認しているのは Chrome だけです) |
| 画面 | YouTube Studio のライブ管制室のチャット |
| **表示言語** | **YouTube Studio が日本語であること。** 検知はリダイレクト通知の**文言**に依存しているため、他言語では反応しません |

![設定画面](docs/assets/screenshot-1-options.png)

## 入れかた

1. [Releases](https://github.com/max-enterme/yt-redirect-pin/releases/latest) から
   `yt-redirect-pin-<version>.zip` を落とす
2. 展開する。**消さない場所に置く** (Chrome はこのフォルダを読み続けます)
3. Chrome で `chrome://extensions` を開き、右上の **「デベロッパー モード」** を ON
4. **「パッケージ化されていない拡張機能を読み込む」** → 展開したフォルダを選ぶ

詳しい手順・設定・動かないときの切り分けは **[docs/install.md](docs/install.md)**。

## 開発

```bash
npm install
npm run typecheck && npm test
npm run build      # dist/ に読み込める形が出る
npm run package    # release/yt-redirect-pin-<version>.zip
```

| ファイル | 役割 |
|---|---|
| `src/selectors.ts` | **DOM 依存の集約点。** 候補の配列を先頭から試す。他モジュールは `document.querySelector` を直接呼ばない |
| `src/detector.ts` | MutationObserver → `RedirectEvent`。抽出部は純関数 (`extractRedirectEvent`) として分離 |
| `src/composer.ts` | テンプレート差し込み |
| `src/dedupe.ts` | 同一送信元・クールダウンの多重発火抑止 |
| `src/poster.ts` | チャット入力欄への投稿と、投稿した自分のメッセージ要素の特定 |
| `src/pinner.ts` | `PinMode` の解釈と「固定」の実行 |
| `src/manual-trigger.ts` | 手動トリガー UI (常設) |
| `src/config.ts` / `src/directory.ts` | `chrome.storage` 永続化 |
| `src/main.ts` | 配線。全体を try/catch |

| ドキュメント | 内容 |
|---|---|
| [specs/001-redirect-pin/spec.md](specs/001-redirect-pin/spec.md) | 何を・なぜ / 受け入れ条件 / 降りる箇所 |
| [specs/001-redirect-pin/plan.md](specs/001-redirect-pin/plan.md) | 構成・テスト戦略・リスク |
| [docs/t1-findings.md](docs/t1-findings.md) | **実 DOM で確認できたこと・外れた推測・実害のある誤動作の記録** |
| [docs/d3-automation-policy.md](docs/d3-automation-policy.md) | 規約まわりで調べたこと |
| [docs/setup-and-verify.md](docs/setup-and-verify.md) | 開発者向けの導入・動作確認 |
| [docs/for-testers.md](docs/for-testers.md) | 他人にテストを頼むときの手順書 |
| [docs/privacy-policy.md](docs/privacy-policy.md) | データの扱い (外部送信は一切しません) |

`v*` のタグを push すると GitHub Actions がビルドして Release に ZIP を添付します。

## 状態

実配信で **①検知 → ②投稿 → ③固定** が通ることを確認済み (2026-08-05)。ただし:

- 確認できたのは**日本語 UI・Studio のチャット・1 環境だけ**
- `ifEmpty` (既定) の「現在何かが固定されているか」の DOM 判定は**未検証**
- 受信から投稿までの所要時間は未計測

詳細は [docs/t1-findings.md](docs/t1-findings.md)。

## ライセンス

[MIT](LICENSE)。**無保証です。**
