---
feature: docs-link-hygiene
issue: TBD
release: r2
priority: should
status: 未着手
---

# 005 ドキュメントの参照が壊れたら落ちるようにする

> spec.md — フィーチャーの「何を・なぜ」。正本はこのテキストと GitHub(Feature issue)。

## 目的

**リポジトリ内のドキュメント参照が壊れたことを、人が踏む前に CI で落として知らせる。**
今は壊れても静かに壊れる。切れたリンクも、README から辿れないファイルも、
誰かが偶然踏むまで分からない。

この feature は**機械で判定できることだけ**を扱う。
読みやすさ・構成・見た目・**公開サイト(GitHub Pages)からの到達性**は
006-docs-restructure の管掌であり、ここでは触らない。

## 背景 / 課題

### 参照は多く、壊れても静か

`docs/*.md` は 9 本・計 192,188 B。`README.md` と `docs/*.md` の Markdown リンクは **132 本**
(うち**相対 85 本** / `http(s):` 44 / ページ内アンカー 3)で、現時点で相対リンクの切れは 0。だが**それを確かめる手段が repo に無い**。
`.github/workflows/ci.yml` が回すのは `npm run typecheck` / `npm test` / `npm run package` の 3 本だけ。

### 説明ページは GitHub Pages のサイトルートで、リンクの形が違う

GitHub Pages は **`main` ブランチの `/docs`** から配信されている(`gh api …/pages` で確認)。
[docs/index.html](../../docs/index.html) は `https://max-enterme.github.io/yt-redirect-pin/` そのもの。

`docs/index.html` から md へのリンクは**すべて絶対 URL**
(`https://github.com/max-enterme/yt-redirect-pin/blob/main/docs/…`)で、相対リンクは 0 本。
**これは意図的**で、Pages 上で `.md` へ相対リンクすると GitHub は描画せず生ファイルを返す。

つまり**素朴な「相対リンクだけ検査する」実装では、index.html の md 参照を 1 本も検査しない。**
index.html の相対参照は `<img src="assets/screenshot-*.png">` の **3 本**と、
favicon の `data:` URI **1 本**だけである。

### 被参照 0 のファイルがある

[docs/stability-research.md](../../docs/stability-research.md)(12,648 B)は、
README・他の md・index.html のいずれからも参照されていない。
残り 8 本はいずれも被参照がある。

### README のドキュメント一覧表が欠けている

`README.md` の `## 開発` にある一覧表は docs を **6 本**しか載せていない
(表は 9 行だが 3 行は `specs/`)。`install.md` と `004-t1-collect.md` は
**表の外の地の文からは張られている**が、`stability-research.md` はどこからも張られていない。

### 検査の実装で踏みやすい罠(実測)

| 罠 | 実測 |
|---|---|
| `docs/security-review.md` の**コードフェンス内**に HTML アンカー | `href="/@sender"` 等が **4 本**(L87 / L141 / L143 / L145)。HTML 属性を md に当てると初日から誤検出 |
| Markdown 記法 `](…)` はフェンス内に | **0 本**。md は Markdown 記法だけ見れば誤検出しない |
| `docs/index.html` の og:url / og:image | **`<meta content="…">` にある**(L18 / L21)。`href` / `src` には Pages URL が **0 本**なので、抽出面に `content` を足さないと還元規則ごと死ぬ。`og:url` は `…/yt-redirect-pin/` = **ディレクトリ**なので還元対象から外す |
| favicon | `href="data:image/svg+xml,…"`。相対パスとして扱うと誤検出 |
| md 見出しアンカーは 6 本 | **相対 5 本 + index.html の絶対 URL 1 本**。②の還元を通して初めて 6 本になる |

### docs を指す参照は docs の外にもある

`.github/ISSUE_TEMPLATE/config.yml` に絶対 URL 2 本、`specs/001`〜`004` に 6 / 1 / 22 / 41 本、
`src/*.ts` と `tests/*.ts` に Markdown リンクと**裸のパス**が混在。
`src/composer.ts:15` の `docs/003-findings.md` は**既に不在**。

**これらは md を動かさない限り壊れない。**動かすかは 006 の管掌なので、ここでは検査しない(→ D2)。

## スコープ

- **含む**:
  - `scripts/check-links.mjs`(新規)と 4 種の検査
  - `tests/check-links.test.ts`(新規)— **子プロセス起動で exit code を見る**回帰テスト
  - `package.json` の `scripts` と `.github/workflows/ci.yml` への登録
  - `README.md` の一覧表に `install.md` / `stability-research.md` / `004-t1-collect.md` を追加
- **含まない**:
  - `docs/index.html` の再構成、目次、表のほどき、見た目(**006 の管掌**)
  - `docs/*.md` の仕分け・移動、サイトジェネレータ(**006 の管掌**)
  - **公開サイト(Pages)からの到達性**(**006 の管掌**。ここで見るのは repo 上の参照だけ)
  - 記述内容の変更。**一覧表への追記以外で地の文を触らない**
  - docs 外(`specs` / `src` / `tests` / `.github`)からの参照の検査(→ D2)
  - 外部ホストへの到達性確認(URL の形と自リポジトリ判定だけを見る)
  - **`tsconfig.json` の変更**(→ D3)

## 受け入れ条件

- [ ] AC1: `npm run check-links` が **exit 0**
- [ ] AC2: 検査は次の 4 種。**それぞれについて、下記の壊し方で非 0 になることを
      `tests/check-links.test.ts` で固定する**

      ① **相対リンクの実在**
      　対象: `README.md` / `docs/**/*.md` は **Markdown 記法 `](…)` のみ**、
      　`docs/index.html` は **`href` / `src` / `<meta content>`**。
      　**いずれもコードフェンス内は対象外。`data:` と `mailto:` は除外。**
      　壊し方: 実在しないファイルへの相対リンクを 1 本置く

      ② **自リポジトリの絶対 URL をパスへ還元した実在確認**
      　対象: `https://github.com/max-enterme/yt-redirect-pin/blob/main/…` と
      　**`https://max-enterme.github.io/yt-redirect-pin/…`(Pages 絶対 URL → `docs/`)**。
      　**末尾が `/` のもの(= `docs/` 自身を指す `og:url`)は還元対象から外す。**
      　**他リポジトリ・`releases`・`issues` への URL は還元しない**(誤検出になる)。
      　壊し方: 実在しないパスを指す `blob/main` URL を 1 本置く

      ③ **md の見出しアンカー**(`…install.md#上限が効かない場合` の形)。
      　見出しレベルは混在するので **`^#{1,6}`** を見る(h2 / h3 / h4 の実例がある)
      　壊し方: **実在する md ファイル + 実在しない見出しアンカー**。
      　**あわせて正例を固定する** — 実在する日本語見出し(`#上限が効かない場合`)が
      　解決されることを確かめる。**これが無いと③を空実装のまま①で緑にできる**

      ④ **孤立検出** — `docs/**/*.md` で **`README.md` から参照されていないもの**
      　壊し方: どこからも参照されない md を 1 本置く

      **各テストは exit code だけでなく、出力に違反したパスが含まれることも見る**
      (検査の取り違えを防ぐ)

- [ ] AC3: `docs/**/*.md` に **`README.md` から参照されていないファイルが無い**。
      **被参照元を README に一本化する**理由は 2 つ。
      ① 一覧表という曖昧な範囲を機械的に切らずに済む
      ② `docs/index.html` は Pages の公開ページで、そこからの到達性は 006 の管掌
- [ ] AC4: `package.json` の `scripts` に `check-links` があり、
      `.github/workflows/ci.yml` がそれを回す。
      **`ci.yml` の内容を固定する回帰テストを置く**(`tests/manifest.test.ts` が
      `public/manifest.json` を直読みしている前例と同じ形)
- [ ] AC5: `scripts/check-links.mjs` が**走査ルートを引数で受ける**。
      テストが一時フィクスチャを指せること(AC2 の前提)

**AC1〜AC5 はすべて機械で判定できる。**目視判定の受け入れ条件は無い。

## メモ / 降りる箇所

- **D1: `docs/index.html` から md への参照は、絶対 `blob/main` URL のままにする。**
  Pages は `/docs` を配信しており、相対に倒すと**公開サイトの導線が全滅する**
  (Pages は `.md` を描画せず生ファイルを返す)。しかも検査はディスク上の実在しか見ないので
  **exit 0 のまま通る。エージェントは相対へ倒す提案をしない。**
- **D2: docs 外からの参照を検査対象に含めるかは、006 の仕分けが決まるまで保留する。**
  `specs` に 70 本、`src` / `tests` に裸のパス混じりで存在するが、
  **md を動かさない限り壊れない。**動かすと決めたら 006 で広げる。
  **006 はまだ `specs/` に存在しない**ので、この保留が解けるのは 006 を切ってから。
- **D3: `tsconfig.json` を変更しない。代わりに `@types/node` を devDependency に足し、
  テストファイルの冒頭に `/// <reference types="node" />` を書く。**
  この repo は `tsconfig` が `"types": ["chrome"]` / `include: ["src", "tests"]` /
  `allowJs` 無し / `strict` で、**`@types/node` が入っていない**
  (`node_modules/@types/` は chrome / estree / filesystem / filewriter / har-format のみ。
  既存の `src` `tests` に `node:` の import は 1 本も無い)。
  そのため `tests/*.ts` から `node:fs` / `node:child_process` を読むと **TS2307 で落ちる**
  (両レビューが独立に再現)。
  **`@types/node` の追加 + トリプルスラッシュ参照で、`types` 配列を触らずに緑になることを実測で確認した。**
  `types` に `"node"` を足す形は tsconfig の変更にあたるので採らない。
  > **plan.md の「新規依存を足さない」は `check-links.mjs` の実行時依存の話であり、
  > 型定義の devDependency 追加は別。**`scripts/check-links.mjs` 自体は Node 標準のみで書く。
- **検査対象ファイルの中にも、検査されない裸のパスがある(006 へ申し送り)。**
  `docs/security-review.md` の **L104 / L236 / L241 / L248 / L286** に、Markdown リンクではなく
  バッククォート付きの裸パスで `docs/for-testers.md` / `docs/setup-and-verify.md` /
  `docs/install.md` を指す記述が **5 本**ある。検査①は Markdown 記法のみなので拾わない。
  **005 では範囲を広げない**(誤検出が増える)が、**006 で md を移動・改名すると黙って壊れる。**
- **006 が「公開サイト専用の md」を作ると検査④で落ちる。**
  被参照元を README に一本化したため。意図した挙動だが、006 側で踏むので記録しておく。
- **他の feature が docs に md を足すと、README への追記も必須になる。**
  例: **003 T6**(issue #20, open)は `docs/003-findings.md` を新設する予定で、
  README に足さないと**検査④で CI が落ちる**。意図した挙動だが、理由が分からないと踏む。
- **GUI 要件は無い。**`docs/index.html` の**見た目を一切変えない**ため §10 は該当しない。
- **人手が要るタスクは無い。**§08 該当なし。`/spec-implement` が最後まで走り切れる。
