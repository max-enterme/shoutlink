---
feature: docs-link-hygiene
test: npm run typecheck && npx vitest run && npm run check-links
---

# 実装計画 — 005 ドキュメントの参照が壊れたら落ちるようにする

> plan.md — 「どう作るか」。spec.md の受け入れ条件を満たす設計。

## アプローチ

**検査を作るのと、既にある違反を直すのを、同じ PR に入れる。**

検査④(孤立)は現在の main で **1 件(`stability-research.md`)落ちる**。
検査だけ先に入れると `test` と CI が赤のまま残り、以降の作業が
SPEC-OPS §07 の「塊が `test` で詰まった」に該当して止まる。
**T1(検査)と T2(違反の解消)を 1 PR にまとめ、緑で着地させる。**

> **着手前の `test` は赤である。**`scripts/check-links.mjs` も
> `npm run check-links` も存在しないため。**T1+T2 の PR で初めて緑になる。**

**純関数を切り出さない。**`tests/*.ts` から `.mjs` を import すると TS7016 で
typecheck が落ちる(spec.md D3)。回帰テストは**子プロセスで
`node scripts/check-links.mjs <fixtureRoot>` を起動し、exit code と出力を見る**。
そのために検査本体は**走査ルートを引数で受ける**(AC5)。

`test` の 3 本目を `node …` ではなく **`npm run check-links`** にしてあるのは、
`package.json` への登録(AC4)を `test` 自身が担保するため。

## 主要コンポーネント / 変更点

| 層 | 変更 |
|---|---|
| `scripts/check-links.mjs` | **新規。**4 種の検査(spec.md AC2)。**第 1 引数で走査ルートを受け、既定は repo ルート。**切れ・孤立の一覧を出して非 0 で終了。**新規依存を足さない** — 既存 `scripts/*.mjs` 5 本と同じく `node:` 組み込みのみ |
| `tests/check-links.test.ts` | **新規。**一時ディレクトリにフィクスチャを作り、**子プロセスで起動して exit code を見る**。4 種それぞれの壊し方(AC2)と、③の**正例**を固定。あわせて `ci.yml` に `check-links` があることを固定(AC4) |
| `README.md` | 一覧表に `install.md` / `stability-research.md` / `004-t1-collect.md` を追加 |
| `package.json` | `"check-links": "node scripts/check-links.mjs"` |
| `.github/workflows/ci.yml` | `check-links` を回す 1 行 |

## 依存 / 前提

- **#69 が main にマージ済み**(`7f756e4`)
- **006-docs-restructure はこの feature の後**。006 は `docs/index.html` の再構成と
  md の仕分けを扱い、**この feature が作る `check-links.mjs` を土台にする**
- 現在の main の実測値(この feature が守る基準):
  Markdown リンク **85 本・切れ 0**(フェンス内 0)/ md 見出しアンカー **6 本**
  (相対 5 + index.html の絶対 1)/ 孤立 **1 本** / `docs/*.md` **9 本** /
  index.html の md リンクは**全部が絶対 URL・相対 0 本**、相対参照は `<img src>` 3 本のみ

## リスク / 降りる箇所

- **R1(降りる箇所 / spec.md D1): `docs/index.html` のリンクを相対に倒さない。**
  Pages(`main` の `/docs`)配信のため、相対にすると公開サイトが壊れる。
  しかも検査はディスクしか見ないので**緑のまま壊れる**。倒す提案をしない。
- **R2(降りる箇所 / spec.md D2): 検査の守備範囲を 006 の決定前に広げない。**
  `specs` / `src` / `tests` / `.github` からの docs 参照(70 本以上、裸のパス混じり)は
  md を動かさない限り壊れない。広げるのは 006 で移動すると決めてから。
- **R3(降りる箇所 / spec.md D3): `tsconfig.json` を触らない。**
  typecheck を通すために `allowJs` を足す・`.d.mts` を手書きする等の判断を
  エージェントが下さない。**子プロセス方式で回避する**(AC5)。
- **R4: 検査②の還元対象を広げすぎない。**
  自リポジトリの `blob/main/` と **Pages 絶対 URL** の 2 つだけ。
  `releases` / `issues` / 他リポジトリを還元しようとすると誤検出になる。
- **R5: 検査③は GitHub の見出し ID 生成規則を完全には再現しない。**
  `#上限が効かない場合` のような URL エンコードされていない日本語見出しが対象。
  **現在ある 6 本(相対 5 + 還元後 1)が通ることを最低条件**とし、
  再現しきれない形は検出できない旨をコードに書く。
  **AC2③ の正例テストがこの逃げ道を塞ぐ** — ③を no-op にすると正例が落ちる。
- **R6: `src/composer.ts:15` の `docs/003-findings.md` は不在だが、この feature では直さない。**
  Markdown リンクではなく本文中の裸のパスで、検査対象の外。**記録だけ残す。**
