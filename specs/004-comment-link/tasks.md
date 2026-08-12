---
feature: comment-link
---

# タスク — 004 登録した人のコメントに反応してリンクを投稿

> tasks.md — 実作業の分解。各タスクは GitHub sub-issue(type: Task)と対応。
> `- [ ]` 未完 / `- [x]` 完了。

## 先に片付けるもの(人手・SPEC-OPS §08)

- [ ] T1: **チャットのコメント要素から次の 3 点を実 DOM で採取する。**
      ① 投稿者のチャンネルが取れるか(属性・リンク) ② 取れる形式が `@handle` / `UC…` のどちらで、
      **辞書の鍵(`normalizeChannelUrl` の出力)と同じ正規形になるか** ③ **配信者自身の投稿を
      見分ける手掛かり**(バッジ・`author-type` 等)と、**メッセージのタイムスタンプ**が取れるか。
      結果を `docs/` に残し、`selectors.ts` に入れる形を確定する。
      **取れなかった場合は spec.md D1 / D2 を人間が決める**(エージェントは降りない / plan.md R1・R2)

## 自動実装できるもの(DOM に依存しない — T1 の前に進めてよい)

- [ ] T2: 設定に `commentReplyEnabled`(**既定 OFF**)と `commentTemplate`(既定 `{name}さん、来てくれてありがとうございます! {url}`)を足す。正規化と既定の回帰 (AC1 / AC5 / AC14 / AC15)
- [ ] T3: `DirectoryEntry.replyToComment`(既定 false / 自動登録でも false)、`setReplyToComment`、`normalizeDirectory` の追従 (AC2 / AC14)
- [ ] T4: `composer` を `{ name, url }` を受ける形へ広げる。**既存の出力が 1 文字も変わらないことをテストで固定** (AC5 / AC15)
- [ ] T5: 抑止の土台 — `post-log` に `kind` を足して鍵・検索・`prune` を種別込みにし(**欠損は `redirect` / 壊れた値は `comment`**)、`dedupe` の `absorb` から `comment` を除き、`main.ts` が渡す履歴を絞る。`streamId` が空のときは 6 時間の下限を適用する。件数の食い合いの回帰も置く (AC7 / AC8 / AC14 / plan.md R4)
- [ ] T6: `src/post-queue.ts` — 逐次処理 / 最低 5 秒間隔 / 1 配信 20 件の上限 / 無効化時の破棄。`now` を注入して実時間で待たないテストにする (AC11)

## T1 の後にしか書けないもの

- [ ] T7: `src/comment-detector.ts` と `selectors.ts` のコメント用定数・アクセサ。**通常のテキストメッセージだけを対象にする**(`SELECTORS.chatTextMessage` を流用しない)。**追加ノードだけを見る**(`scanExisting` を作らない)。**タイムスタンプ(または猶予)で起動前のコメントを切る**。**URL が取れない / 正規形が違うコメントは捨てる** (AC3 / AC4 / AC9 / plan.md R3)
- [ ] T8: `main.ts` への配線 — 照合 → キュー → 投稿(**固定はしない**)、自己ループ遮断 3 枚、有効化スイッチの切り替え追従、起動ログへの追加 (AC6 / AC10 / AC12)。**plan.md R2(降りる箇所)に触れるため、レビュー後に人が確認してからマージする**

## 仕上げ

- [ ] T9: 設定画面 — 有効化スイッチ / コメント用テンプレート + プレビュー / 辞書テーブルのフラグ列(**行編集で即保存**)/ 不整合の常時表示 / **投稿履歴の表に種別列**。002 が先に載っている場合は文言を `_locales/` へのキー追加で入れる (AC13)
- [ ] T10: ドキュメント — README / `docs/install.md` / `docs/index.html` / `docs/for-testers.md` / `docs/privacy-policy.md` / `docs/setup-and-verify.md` に、**引き金が増えたこと・既定 OFF・保存項目の追加**を反映する。`scripts/make-site-assets.mjs` の見本データにフラグを足す。**T11 の決定を書く作業なので、T11 の後に着手する**

## 人手・実機が要るもの(SPEC-OPS §08 — `/spec-implement` に投げても止まる)

- [ ] T11: **spec.md D3 の判断** — 引き金が増えて投稿頻度が上がることが、001 D3 の結論
      ([d3-automation-policy.md](../../docs/d3-automation-policy.md))を変えないか。**人間が決める**
- [ ] T12: **実配信での通し確認。**確認するのは 5 点 — ① 登録者のコメントで投稿されること
      ② **固定されないこと** ③ 同じ配信で 2 回目が出ないこと ④ **自分の投稿を引き金に再投稿しないこと**
      (plan.md R2) ⑤ **ポップアウトを開き直しても過去のコメントに一斉投稿しないこと**(plan.md R3)。
      あわせて **手打ち中に発火したときの入力欄の挙動**(plan.md R6)と、
      **チャット窓が非前面・最小化のときに発火するか**([t1-findings.md](../../docs/t1-findings.md) ❓F)を見る。
      相手が要るので自分では作れない(spec.md D5)
- [ ] T13: **スクリーンショットの撮り直し** — 辞書テーブルの列が増えるため
      `docs/assets/screenshot-3-directory.png` を撮り直す(§08 非コード成果物)。
      **T9 の実装と T10 の見本データ更新の後**。003 の T8 と重なるので、**後に入るほうが 1 回で撮る**

## 実装フロー(SPEC-OPS §11)

- 集約ブランチ **`004-comment-link`**(main から切る)。タスクの PR は**これを base**にする
- **T2–T6 は 1 PR に束ねてよい**(DOM に依存せず、降りる箇所に触れない範囲)
- **T1 / T11 / T12 / T13 はタスク単位で PR を分け、人が確認してからマージ**する
- **T7 は T1 の後**、**T8 は T7 の後**(T8 は R2 に触れるので単独 PR)。**T9 → T10 → T13** の順
- 最終的に `004-comment-link` → `main` で feature をまとめてマージ

> **T1 が閉じるまで T7 を実装しない。** 先に書くと、合成 DOM を仕様として固めることになる
> (`tests/fixtures/live-chat.ts` で一度やっている)。
> **T12 が閉じるまで「コメントに反応する」を検証済みとして書かない**(plan.md R2 / R3 の歯止めが
> 効いているかは実配信でしか分からない)。
