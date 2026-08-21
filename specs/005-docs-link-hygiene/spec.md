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

**ドキュメントの参照が壊れたことを、人が気づく前に落として知らせる。**
今は壊れても静かに壊れる。切れたリンクも、どこからも辿れないファイルも、
誰かが偶然踏むまで分からない。

この feature は**機械で判定できることだけ**を扱う。読みやすさ・構成・見た目は
006-docs-restructure の管掌であり、ここでは触らない。

## 背景 / 課題

### 参照は多く、壊れても静か

`docs/*.md` は 9 本・計 192,188 B。`README.md` と `docs/*.md` の相対リンクは **85 本**あり、
現時点で切れは 0。だが**それを確かめる手段が repo に無い**。
`.github/workflows/ci.yml` が回すのは `npm run typecheck` / `npm test` / `npm run package` の 3 本だけ。

### 説明ページは GitHub Pages のサイトルートで、リンクの形が違う

GitHub Pages は **`main` ブランチの `/docs`** から配信されている(確認済み)。
つまり [docs/index.html](../../docs/index.html) は
`https://max-enterme.github.io/yt-redirect-pin/` **そのもの**である。

`docs/index.html` から md へのリンクは**すべて絶対 URL**
(`https://github.com/max-enterme/yt-redirect-pin/blob/main/docs/…`)で、相対リンクは 0 本。
**これは意図的**で、Pages 上で `.md` へ相対リンクすると GitHub は描画せず生ファイルを返す。

したがって**素朴な「相対リンクだけ検査する」実装では、公開サイトの導線を 1 本も検査しない。**

### 被参照 0 のファイルがある

[docs/stability-research.md](../../docs/stability-research.md)(12,648 B)は、
README・他の md・index.html のいずれからも参照されていない**孤立ファイル**。
残り 8 本はいずれも被参照がある。

### README のドキュメント一覧表が欠けている

`README.md` の `## 開発` にあるドキュメント一覧表は **9 本中 6 本**しか載せていない。
`install.md` / `stability-research.md` / `004-t1-collect.md` が抜けている
(`install.md` は本文中からは張られている)。

### docs を指す参照は docs の外にもある

| 場所 | 実測 |
|---|---|
| `.github/ISSUE_TEMPLATE/config.yml` | 絶対 URL 2 本 |
| `specs/001` / `002` / `003` / `004` | 6 / 1 / 22 / 41 本 |
| `src/*.ts` / `tests/*.ts` / `tests/fixtures/` / `scripts/*.js` | Markdown リンクと**裸のパス**が混在 |
| `src/composer.ts:15` | **`docs/003-findings.md` は既に不在** |

**これらは md を動かさない限り壊れない。**動かすかどうかは 006 の管掌なので、
この feature では**検査対象に含めない**(→ D2)。

## スコープ

- **含む**:
  - `scripts/check-links.mjs`(新規)と、その 4 種の検査
  - `package.json` の `scripts` と `.github/workflows/ci.yml` への登録
  - `README.md` のドキュメント一覧表の是正(9 本すべてを載せる)
  - 孤立の解消(`stability-research.md`)
- **含まない**:
  - `docs/index.html` の再構成、目次、表のほどき、見た目(**006 の管掌**)
  - `docs/*.md` の仕分け・移動、サイトジェネレータ(**006 の管掌**)
  - 記述内容の変更。**一覧表への追記以外で地の文を触らない**
  - docs 外(`specs` / `src` / `tests` / `.github`)からの参照の検査(→ D2)
  - 外部ホストへの到達性確認(URL の形と自リポジトリ判定だけを見る)

## 受け入れ条件

- [ ] AC1: `node scripts/check-links.mjs` が **exit 0**
- [ ] AC2: 検査は次の 4 種すべてを行う。**それぞれについて、意図的に壊した入力で
      非 0 になることを `tests/` の回帰テストで固定する**
      ① `README.md` / `docs/**/*.md` / `docs/index.html` の**相対リンク**の実在
      ② **自リポジトリを指す絶対 URL**(`https://github.com/max-enterme/yt-redirect-pin/blob/main/…`)
      をパスへ還元した実在確認
      ③ **md の見出しアンカー**(`…install.md#上限が効かない場合` の形。現在 6 本ある)
      ④ **孤立検出** — `docs/**/*.md` で `docs/index.html` からも `README.md` からも
      参照されていないもの
- [ ] AC3: `docs/**/*.md` に**被参照 0 のファイルが無い**
- [ ] AC4: `README.md` のドキュメント一覧表に **`docs/**/*.md` が全て載っている**。
      本数は固定値で持たず、**実際のファイル数と突き合わせる**
- [ ] AC5: `package.json` の `scripts` に `check-links` があり、
      `.github/workflows/ci.yml` がそれを回す

**AC1〜AC5 はすべて機械で判定できる。**この feature に目視判定の受け入れ条件は無い。

## メモ / 降りる箇所

- **D1: `docs/index.html` から md への参照は、絶対 `blob/main` URL のままにする。**
  GitHub Pages は `/docs` を配信しており、相対リンクに倒すと**公開サイトの導線が全滅する**
  (Pages は `.md` を描画せず生ファイルを返す)。しかも `check-links.mjs` は
  ディスク上の実在しか見ないので **exit 0 のまま通る**。
  **エージェントは相対へ倒す提案をしない。**検査②はこの前提の上に立つ。
- **D2: docs 外からの参照を検査対象に含めるかは、006 の仕分けが決まるまで保留する。**
  `specs` に 70 本、`src` / `tests` に裸のパス混じりで存在するが、
  **md を動かさない限り壊れない。**動かすと決めたら 006 で検査対象を広げる。
- **GUI 要件は無い。**この feature は `docs/index.html` の**見た目を一切変えない**ため、
  §10 のモック併置は該当しない。
- **人手が要るタスクは無い。**§08 に該当するものが無く、`/spec-implement` が
  最後まで走り切れる。
