---
feature: reply-guard-and-test-send
---

# タスク — 006 返礼の抑止を配信単位に統一し、テスト送信の導線を作る

> tasks.md — 実作業の分解。各タスクは GitHub sub-issue(type: Task)と対応。
> `- [ ]` 未完 / `- [x]` 完了。

- [x] T1: `post-log.ts` の抑止判定を `findReplyBlocker(blockedBy)` に一般化し、`findRedirectReplyBlocker` / `findCommentReplyBlocker` の 2 本を生やす。`UNKNOWN_STREAM_MIN_COOLDOWN_SEC` を `dedupe.ts` から移設し `UNKNOWN_STREAM_WINDOW_SEC` へ改名する  <!-- #90 -->
- [x] T2: `in-flight.ts` を新設する(`begin` / `end` / `isBusy`)。`main.ts` の抑止を `findRedirectReplyBlocker` + `inFlight` に置き換え、投稿の失敗時も `finally` で `end` する。手動トリガー(`origin: 'manual'`)は両方とも素通しにする(T1 の後)  <!-- #91 -->
- [x] T3: `dedupe.ts` と `redirectHistory` を削除し、`tests/dedupe.test.ts` のケースを `tests/post-log.test.ts` へ移す。`tests/post-log.test.ts` の `redirectHistory` の import と `describe` も消す(T2 の後)  <!-- #92 -->
- [x] T4: `cooldownSec` を `types.ts` / `config.ts` / `main.ts` の起動ログ / `options.ts` / `public/options.html` の fieldset から削除し、`tests/config.test.ts` の期待値を直す(T3 の後)  <!-- #93 -->
- [x] T5: `self-echo.ts` の冒頭コメントを dedupe 廃止後の役割に書き直して `reset()` を足し、`self-echo.ts` 全体と `post-log.ts` / `directory.ts` / `detector.ts` / `comment-detector.ts` に残る `cooldownSec`・`dedupe` への言及を**行単位で**直す(T4 の後)  <!-- #94 -->
- [x] T6: `post-log.ts` に `onPostLogChanged` を足し、`main.ts` で購読して `postLog` の差し替えと `selfEcho.reset()` を行う。「履歴を消す」が再読み込みなしで届くようにする(T5 の後)  <!-- #95 -->
- [ ] T7: `test-send.ts` を新設する(メッセージの型 / `parseTestSendRequest` / `buildTestSendText` / 依存を注入で受ける `createTestSendHandler`)  <!-- #96 -->
- [ ] T8: `main.ts` に `createTestSendHandler` の生成と `chrome.runtime.onMessage` の配線を足す。固定せず履歴にも残さず、本文と要素の記憶にだけ登録する(T6 と T7 の後)  <!-- #97 -->
- [ ] T9: `options/test-send.ts`(`testSendAvailability` / `testSendResultMessage`)と、`renderDirectory` の展開行への 2 ボタン・結果表示・応答待ちの無効化の配線。`captureRowDrafts` の掃除に行ごとの状態を足す(T7 の後)  <!-- #98 -->
- [ ] T10: README / `docs/install.md` / `docs/index.html` / `docs/for-testers.md` / `docs/setup-and-verify.md` / `docs/d3-automation-policy.md` / `docs/store-submission.md` / `docs/privacy-policy.md` / `docs/security-review.md` からクールダウンの記述を消し、「同じ配信・同じ相手に 1 回」とテスト送信の手順に書き換える。`CHANGELOG.md` は過去のエントリを書き換えず新しいエントリを足すだけにする。`tests/docs.test.ts` を新設して残存を機械で見る(T5 と T9 の後)  <!-- #99 -->
- [ ] T11: **人手** — 拡張を読み込んだ Chrome で、管制室の `live_chat` フレーム数を数え、テスト送信が 1 回で 1 通だけ出ることと `tabs.query` が空を返さないことを確かめる。あわせて設定画面のスクリーンショットを撮り直す(クールダウン欄が消え、テスト送信ボタンが写った状態)。枚数と構図は #88 に合わせ、ストア掲載画像を差し替えるかを人が決める(T10 の後)  <!-- #100 -->
- [ ] T12: **人手** — 実配信での通し確認。リダイレクトを受けて投稿された後にチャットをポップアウトし直し、2 回目が出ないこと(AC1 / AC4)と、テスト送信が何度でも出せること(AC8)を見る(T11 の後)  <!-- #101 -->
