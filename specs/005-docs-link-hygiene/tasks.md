---
feature: docs-link-hygiene
---

# タスク — 005 ドキュメントの参照が壊れたら落ちるようにする

> tasks.md — 実作業の分解。各タスクは GitHub sub-issue(type: Task)と対応。
> `- [ ]` 未完 / `- [x]` 完了。
> **人手が要るタスクは無い**(SPEC-OPS §08 に該当するものが無い)。

- [ ] T1: **`scripts/check-links.mjs` を作る**(AC1 / AC2 / AC5)。
      **第 1 引数で走査ルートを受ける**(既定は repo ルート)。テストが一時フィクスチャを
      指せるようにするため。**Node 標準のみ**(新規依存なし)。検査は 4 種。

      ① **相対リンクの実在** — md は **Markdown 記法 `](…)` のみ**、`docs/index.html` は
      **`href` と `src`**。**コードフェンス内は対象外**(`docs/security-review.md` の
      フェンス内に HTML アンカーが 4 本ある)。**`data:` と `mailto:` は除外**
      (favicon が `data:`)
      ② **自リポジトリ絶対 URL の還元** — `…/blob/main/…` と
      **Pages 絶対 URL(`https://max-enterme.github.io/yt-redirect-pin/…` → `docs/`)**。
      **index.html の md リンクは全部①ではなくこちらに当たる**ので、
      これが無いと index.html の md 参照を 1 本も検査しない(plan.md R1)。
      **`releases` / `issues` / 他リポジトリは還元しない**(plan.md R4)
      ③ **md の見出しアンカー** — 現在 6 本(**相対 5 + ②の還元後に 1**)。
      日本語見出しを含む(plan.md R5)
      ④ **孤立検出** — `docs/**/*.md` で **`README.md` から参照されていないもの**。
      被参照元は README のみ(index.html は含めない / spec.md AC3)

- [ ] T2: **既にある違反を解消する**(AC3)。
      `README.md` の一覧表に `install.md` / `stability-research.md` / `004-t1-collect.md` を
      追加する。これで **`stability-research.md` の孤立(検査④の唯一の違反)が解消**される。
      **一覧表への追記以外で地の文を触らない**
      → **T1 と同じ PR に入れる**(plan.md アプローチ。分けると `test` と CI が赤で残る)

- [ ] T3: **回帰テストを置く**(AC2 / AC4)。`tests/check-links.test.ts` を新規に作る。
      **一時ディレクトリにフィクスチャを作り、子プロセスで
      `node scripts/check-links.mjs <fixtureRoot>` を起動して exit code を見る**
      (`.mjs` を import しない / spec.md D3)。固定するのは次の 5 つ。
      - ①: 実在しないファイルへの相対リンク → 非 0
      - ②: 実在しないパスを指す `blob/main` URL → 非 0
      - ③: **実在する md + 実在しない見出しアンカー** → 非 0。
        **あわせて正例** — 実在する日本語見出し(`#上限が効かない場合`)が解決される
      - ④: どこからも参照されない md → 非 0
      - **`ci.yml` に `check-links` があること**(`tests/manifest.test.ts` が
        `public/manifest.json` を直読みしている前例と同じ形)

- [ ] T4: **`package.json` と `ci.yml` に登録する**(AC4)。
      `"check-links": "node scripts/check-links.mjs"` を足し、
      `.github/workflows/ci.yml` に 1 行加える。
      **`test` の 3 本目が `npm run check-links` なので、登録漏れは `test` 自体が落ちる**

## 実装フロー(SPEC-OPS §11)

- 集約ブランチ **`005-docs-link-hygiene`**(main から切る)
- **着手前の `test` は赤**(`scripts/check-links.mjs` も `npm run check-links` も無い)。
  **T1+T2+T4 で 1 PR**にして緑にする — T4 を後回しにすると
  `test` の 3 本目 `npm run check-links` が「script が無い」で落ち続ける
- **T3 は 2 本目の PR**(回帰テスト)
- **人手タスクが無いので、`/spec-implement` が最後まで走り切れる。**
  着地は 集約ブランチ → main の PR
- **005 では `docs/index.html` の中身を 1 文字も変えない。**
  なお index.html を触る未完タスクは 006 以外にもある
  (**004 T13**(#37)が `alt` / `figcaption`、**004 T12**(#36)が「未検証」表記の除去)
