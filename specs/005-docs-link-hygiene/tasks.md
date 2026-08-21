---
feature: docs-link-hygiene
---

# タスク — 005 ドキュメントの参照が壊れたら落ちるようにする

> tasks.md — 実作業の分解。各タスクは GitHub sub-issue(type: Task)と対応。
> `- [ ]` 未完 / `- [x]` 完了。
> **人手が要るタスクは無い**(SPEC-OPS §08 に該当するものが無い)。

- [ ] T1: **`scripts/check-links.mjs` を作る**(AC1 / AC2)。検査は 4 種。
      ① `README.md` / `docs/**/*.md` / `docs/index.html` の**相対リンク**の実在
      ② **自リポジトリの絶対 URL**(`https://github.com/max-enterme/yt-redirect-pin/blob/main/…`)を
      パスへ還元した実在確認。**index.html の md リンクは全部この形**なので、
      これが無いと公開サイトの導線を 1 本も検査しない(plan.md R1)
      ③ **md の見出しアンカー**(現在 6 本。日本語見出しを含む / plan.md R4)
      ④ **孤立検出** — `docs/**/*.md` で index.html からも README からも参照されていないもの
      切れ・孤立は**一覧を出して非 0 で終了**。**Node 標準のみ**(新規依存なし)。
      **検査ロジックは純関数に切り出す**(ファイル走査と分ける / T3 のテスト用)。
      **還元対象は自リポジトリの `blob/main/` だけ**に限る(plan.md R3)
- [ ] T2: **既にある違反を解消する**(AC3 / AC4)。
      `README.md` のドキュメント一覧表に `install.md` / `stability-research.md` /
      `004-t1-collect.md` を追加する(現在 9 本中 6 本)。これで **`stability-research.md` の
      孤立(検査④の唯一の違反)が解消**される。
      **一覧表の本数を固定値で持たず、実ファイルと突き合わせる形にする**(AC4)。
      **一覧表への追記以外で地の文を触らない**
      → **T1 と同じ PR に入れる**(plan.md アプローチ。分けると `test` と CI が赤で残る)
- [ ] T3: **回帰テストを置く**(AC2)。`tests/check-links.test.ts` を新規に作り、
      **4 種それぞれについて意図的に壊した入力で非 0 になること**を固定する。
      T1 で切り出した純関数を対象にする(実ファイルを壊さない)。
      **現在の 6 本の md アンカーが通ること**も固定する(plan.md R4)
- [ ] T4: **`package.json` と `ci.yml` に登録する**(AC5)。
      `"check-links": "node scripts/check-links.mjs"` を足し、
      `.github/workflows/ci.yml` に 1 行加える。
      **`test` に載るだけでは着地後に誰も回さない**

## 実装フロー(SPEC-OPS §11)

- 集約ブランチ **`005-docs-link-hygiene`**(main から切る)
- **T1 + T2 で 1 PR**(検査と、既にある違反の解消を同時に入れて緑で着地させる)
- **T3 + T4 で 1 PR**(回帰テストと登録)
- **人手タスクが無いので、`/spec-implement` が最後まで走り切れる。**
  着地は 集約ブランチ → main の PR
- **`docs/index.html` の中身は 1 文字も変えない。**変えるのは 006
