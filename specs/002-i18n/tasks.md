---
feature: i18n
---

# タスク — 002 ローカライズ対応

> tasks.md — 実作業の分解。各タスクは GitHub sub-issue(type: Task)と対応。
> `- [ ]` 未完 / `- [x]` 完了。

## 自動実装できるもの

- [ ] T1: `src/i18n.ts` を足す(`chrome.i18n` の薄いラッパ。chrome 不在ならキーを返す)
- [ ] T2: `_locales/{ja,en}/messages.json` と `manifest` の `__MSG_*__` 化。`options.html` を `data-i18n` へ移し、`manual-trigger` / `options.ts` を `t()` 経由にする (AC1 / AC2)
- [ ] T3: `src/selectors.ts` の文言 4 種を `Record<Lang, ...>` にする。**照合は全言語を走査**(実行時に言語で絞らない)。日本語の挙動が変わらないことを回帰テストで固定 (AC3 / AC6)
- [ ] T4: 未確認パターンが**自動投稿の本線に乗らない**ことをテストで固定する。昇格は人間が行う口だけ用意する (AC5)

## 人手・実機が要るもの(SPEC-OPS §08 — `/spec-implement` に投げても止まる)

- [ ] T5: **英語 UI の Studio で `PIN_MENU_LABELS` / `UNPIN_MENU_LABELS` を実採取**して確定させる (AC4)
- [ ] T6: **英語のリダイレクト通知文言を実データで確認して昇格させる。**
      自分では作れない — 英語 UI で実際にリダイレクトを受けた報告が要る。
      受信パターンと**除外パターンをセットで**足す(plan.md R2)
- [ ] T7: spec.md D2 / D4 の判断 — 検知が日本語前提であることの明示と、README / 説明ページの警告部分を英訳するか

> **T5 / T6 が閉じない限り「英語対応」と名乗らない**(plan.md R3)。
> T1–T4 が終わった時点で言えるのは「UI が英語になった」まで。
