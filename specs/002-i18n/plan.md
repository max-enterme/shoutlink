---
feature: i18n
test: npm run typecheck && npx vitest run
---

# 実装計画 — 002 ローカライズ対応

> plan.md — 「どう作るか」。spec.md の受け入れ条件を満たす設計。

## アプローチ

**2 層を別々の仕組みで扱う。**混ぜると「翻訳したのに動かない」が起きる。

### ① UI — `_locales/` + `chrome.i18n`(MV3 標準)

```
public/_locales/ja/messages.json   ← default_locale
public/_locales/en/messages.json
```

- manifest は `"default_locale": "ja"` と `__MSG_extName__` 形式
- **HTML は `data-i18n` 属性を置いて、読み込み時に 1 箇所でまとめて差し込む。**
  `options.html` に 55 行の日本語が散っているので、テンプレートリテラルで書き直すより
  属性を振るほうが差分が小さく、翻訳漏れも見つけやすい
- TS 側は `t('key')` の薄いラッパを 1 つ作って `chrome.i18n.getMessage` を包む
  (`chrome` が無いテスト環境ではキーをそのまま返す — 既存の `getStorageArea` と同じ考え方)

### ② 検知の文言 — 言語別テーブル + 昇格フロー

`src/selectors.ts` の平坦な配列を、**言語をキーにしたテーブル**にする。

```ts
// 確認済みだけを入れる。ここに入ったものが自動投稿の本線に乗る
export const REDIRECT_TEXT_PATTERNS: Record<Lang, readonly RegExp[]>
// 推測。診断ログに出るだけで、投稿はしない (spec.md D1)
export const UNCONFIRMED_REDIRECT_TEXT_PATTERNS: Record<Lang, readonly RegExp[]>
```

- **照合は「全言語のパターンを順に試す」。** UI 言語の判定に頼らない —
  ブラウザの言語と YouTube の表示言語は一致しないことがあり、そこを取り違えると
  検知が黙って止まる。テーブルを言語で分けるのは**採取元を追えるようにするため**であって、
  実行時の絞り込みのためではない
- `EXCLUDED_TEXT_PATTERNS`(送信側バナーの誤爆よけ)も**同じ形で言語別に持つ**。
  ここが薄いまま他言語の受信パターンだけ増やすと、**逆向き投稿の危険が増える**

## 主要コンポーネント / 変更点

| 層 | 変更 |
|---|---|
| `public/_locales/{ja,en}/messages.json` | **新規。**UI 文字列の実体 |
| `public/manifest.json` | `default_locale` 追加、`name` / `description` / `default_title` を `__MSG_*__` へ |
| `public/options.html` | 文言を `data-i18n` 属性へ移す |
| `src/i18n.ts` | **新規。**`chrome.i18n` の薄いラッパ(chrome 不在でも落ちない) |
| `src/options/options.ts` | 起動時に `data-i18n` を差し込む。動的生成部も `t()` 経由 |
| `src/manual-trigger.ts` | パネルの文字列を `t()` 経由に |
| `src/selectors.ts` | 文言 4 種を `Record<Lang, ...>` へ。照合ヘルパは全言語を走査 |
| `scripts/build.mjs` | `public/_locales` の複製(現状の `cp public → dist` で足りるはず。要確認) |
| `tests/selectors.test.ts` | **新規。**言語別テーブルの照合と、未確認が本線に乗らないことの回帰 |

## 依存 / 前提

- **英語 UI の Studio にアクセスできること**(T3 の採取に必要)。
  Google アカウントの表示言語を切り替えれば足りる見込み。**要確認**
- **英語のリダイレクト通知文言は、実際に英語 UI でリダイレクトを受けた報告が要る。**
  これは自分では作れない(→ §08 該当・T5)
- 001 の Issue テンプレ(「Studio の表示言語」「通知の文面」欄)が収集導線として既にある
- **[003](../003-per-source-message/spec.md) / [004](../004-comment-link/spec.md) が先に main へ載る**
  (003 spec.md D2 の決定 / 2026-08-13)。**002 は待たれる側ではなく、後から拾う側。**
  T5 / T6 が英語圏の実データ待ちで自力では閉じられないため、003 / 004 を待たせない判断になった。
  → **T2 の対象には、003 / 004 がベタ書きの日本語で足した UI 文言が含まれる**
  (自由文の列見出し / 残り文字数 / 200 字超のエラー / `{msg}` の説明 / コメント返しのスイッチと
  テンプレート欄 / 辞書テーブルの畳む表示のラベル 等)。**着手前に main の `public/options.html` を見て
  範囲を取り直す。**なお **`{msg}` というプレースホルダ名そのものは i18n の対象外**
  (翻訳すると保存済みテンプレートが壊れる)。

## リスク / 降りる箇所

- **R1(高): 未確認パターンの昇格。** spec.md D1 のとおり、**人間が判断する。**
  自動実装に昇格させない。T4 は「昇格の仕組みを作る」までで、
  「実際に昇格させる」は別(T6)。

- **R2(高): 誤爆よけの非対称。**
  受信パターンだけ他言語対応して、送信側バナーの除外パターンが日本語のままだと、
  **英語圏で逆向き投稿が起きうる。**受信と除外は**必ずセットで**足す。
  片方だけの PR は通さない。

- **R3(中): 「英語対応」の看板と実態のずれ。** spec.md D2。
  UI が英語になった時点で英語圏の人が入れる。検知が動かないなら、
  **オプション画面と説明ページの両方で明示**しないと不誠実な配布になる。

- **R4(中): ドキュメントの言語。** spec.md D4。
  UI だけ英語で警告文が日本語のままだと、**リスクを読めない人が入れられる状態**になる。
  README / 説明ページの警告部分の英訳を、本 feature に含めるか別で切るかを決める。

- **R5(低): `chrome.i18n` はテスト環境に無い。**
  `src/i18n.ts` を挟んで、`chrome` 不在ならキーを返すようにする。
  既存の `getStorageArea()` と同じ扱いで、jsdom のテストは通る。
