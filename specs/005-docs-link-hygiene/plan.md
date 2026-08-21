---
feature: docs-link-hygiene
test: npm run typecheck && npx vitest run && node scripts/check-links.mjs
---

# 実装計画 — 005 ドキュメントの参照が壊れたら落ちるようにする

> plan.md — 「どう作るか」。spec.md の受け入れ条件を満たす設計。

## アプローチ

**検査を作るのと、既にある違反を直すのを、同じ PR に入れる。**

検査④(孤立)は現在の main で **1 件(`stability-research.md`)落ちる**。
検査だけ先に入れると `test` と CI が赤のまま残り、以降の作業が
SPEC-OPS §07 の「塊が `test` で詰まった」に該当して止まる。
そこで **T1(検査)と T2(違反の解消)を 1 PR にまとめ、緑で着地させる。**

検査②(自リポジトリ絶対 URL の還元)がこの feature の核心である。
`docs/index.html` の md リンクは全部この形なので、
**これが無いと公開サイトの導線を 1 本も検査しない。**

## 主要コンポーネント / 変更点

| 層 | 変更 |
|---|---|
| `scripts/check-links.mjs` | **新規。**4 種の検査(spec.md AC2)。切れ・孤立の一覧を出して非 0 で終了。**新規依存を足さない** — 既存 `scripts/*.mjs` 5 本と同じく `node:` 組み込みのみ |
| `tests/check-links.test.ts` | **新規。**意図的に壊した入力で各検査が非 0 になることを固定(AC2)。検査ロジックを**純関数として切り出し**、ファイル走査と分ける |
| `README.md` | ドキュメント一覧表に `install.md` / `stability-research.md` / `004-t1-collect.md` を追加(AC3 / AC4) |
| `package.json` | `"check-links": "node scripts/check-links.mjs"` |
| `.github/workflows/ci.yml` | `check-links` を回す 1 行 |

## 依存 / 前提

- **#69 が main にマージ済み**(`7f756e4`)
- **006-docs-restructure はこの feature の後**。006 は `docs/index.html` の再構成と
  md の仕分けを扱い、**この feature が作る `check-links.mjs` を土台にする**
- 現在の main の実測値(この feature が守る基準):
  相対リンク **85 本・切れ 0** / md 見出しアンカー **6 本** / 孤立 **1 本** /
  `docs/*.md` **9 本** / index.html の md リンクは**全部が絶対 URL・相対 0 本**

## リスク / 降りる箇所

- **R1(降りる箇所 / spec.md D1): `docs/index.html` のリンクを相対に倒さない。**
  GitHub Pages(`main` の `/docs`)配信のため、相対にすると公開サイトが壊れる。
  しかも `check-links.mjs` はディスクしか見ないので**緑のまま壊れる**。
  エージェントは倒す提案をしない。
- **R2(降りる箇所 / spec.md D2): 検査の守備範囲を 006 の決定前に広げない。**
  `specs` / `src` / `tests` / `.github` からの docs 参照(70 本以上、裸のパス混じり)は、
  md を動かさない限り壊れない。広げるのは 006 で移動すると決めてから。
- **R3: 検査②の URL 判定を緩くしない。**
  自リポジトリ(`max-enterme/yt-redirect-pin`)の `blob/main/` だけを還元対象にする。
  他リポジトリや `releases` / `issues` への URL を還元しようとすると誤検出になる。
- **R4: 検査③の md アンカーは日本語見出しを含む。**
  `#上限が効かない場合` のような URL エンコードされていない形で書かれている。
  GitHub の見出し ID 生成規則(小文字化・空白→ハイフン・記号除去)を**完全には再現しない**。
  **現在ある 6 本が通ることを最低条件**とし、再現しきれない形は検出できない旨をコードに書く。
- **R5: `src/composer.ts:15` の `docs/003-findings.md` は不在だが、この feature では直さない。**
  Markdown リンクではなく本文中の裸のパスで、検査対象(spec.md スコープ)の外。
  **記録だけ残す** — 直すなら別の機会に。
