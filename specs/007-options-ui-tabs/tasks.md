---
feature: options-ui-tabs
---

# タスク — 設定画面をタブに分け、辞書を左右分割にする

> tasks.md — 実作業の分解。各タスクは GitHub sub-issue(type: Task)と対応。
> `- [ ]` 未完 / `- [x]` 完了。

- [x] T1: `options.ts` のトップレベル副作用を `initOptions()` に畳んで export し、ビルドのエントリを新規の `src/options/main.ts` へ移す(挙動は変えない)  <!-- #130 -->
- [x] T2: `public/options.html` を 4 タブ(基本設定 / 辞書 / 履歴 / 開発)に組み替え、警告バナーと保存バーをタブの外へ出し、`options.ts` にタブ切り替えを足す。あわせて 120 行の「1 配信あたり 20 件までです。」(#127 で撤廃済みの取りこぼし)を消す(T1 の後)  <!-- #131 -->
- [x] T3: `tests/fixtures/chrome.ts` と `tests/options-dom.test.ts` を作り、`options.html` を jsdom へ流し込んで `initOptions()` を呼ぶ土台を用意して AC1〜AC5 を固定する(T2 の後)  <!-- #132 -->
- [x] T4: `renderDirectory()` を左右分割に作り替える(`expandedRows` を `selectedKey` に置換 / 詳細を右ペインへ / caret を削除 / 左右をそれぞれ独立してスクロールさせる)(T3 の後)  <!-- #133 -->
- [x] T5: 左ペインに絞り込み欄を足し、絞り込みで選択中の行が消えても右ペインを残す  <!-- #134 -->
- [x] T6: 左右分割の AC6・AC6b・AC7〜AC13 と、回帰の AC21〜AC23 を `tests/options-dom.test.ts` と `tests/docs.test.ts` で固定する(T5 の後)  <!-- #135 -->
- [ ] T7: `src/channel-id.ts` に `extractChannelIconUrl` / `iconUrlAtSize` / `fetchIconAsDataUrl` / `resolveChannelPage` を足し、`tests/channel-id.test.ts` で固定する  <!-- #136 -->
- [ ] T8: `src/directory.ts` に `iconDataUrl` / `MAX_ICON_DATA_URL_LENGTH` / `upsertChannelIcon` / `initialForAvatar` を足し、`tests/directory.test.ts` で固定する  <!-- #137 -->
- [ ] T9: `resolveEntryChannelId` の取得を `resolveChannelPage` に差し替え、左ペインにアイコンとモノグラム、「アイコンをまとめて取得」ボタンを足す(T6・T7・T8 の後)  <!-- #138 -->
- [ ] T10: アイコンの AC14〜AC20 を `tests/options-dom.test.ts` で固定する(T9 の後)  <!-- #139 -->
- [ ] T11: README.md / docs/privacy-policy.md の通信の記述を更新し、docs/install.md・docs/setup-and-verify.md・docs/for-testers.md の `▸` を前提にした手順と設定画面の構成表を 4 タブへ書き換える(T10 の後)  <!-- #140 -->
- [ ] T12: **人手** — `dist/` を Chrome に読み込んで設定画面を開き、`docs/assets/screenshot-1-options.png` と `screenshot-3-directory.png` を同じ構図で撮り直して差し替える(T11 の後)  <!-- #141 -->
