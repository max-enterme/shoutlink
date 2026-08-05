# T1 途中経過 — 実 DOM で確認できたこと

採取日: 2026-08-05 / 対象: `https://studio.youtube.com/live_chat?is_popout=1&v=...`(Studio 版ポップアウト)/
自分のテスト配信 / チャンネル所有者としてログイン済み

**構造(タグ名・id・属性名・要素数)だけを記録する。** 視聴者のコメント本文・チャンネル名・ID は
一切持ち込まない(→ [max/CLAUDE.md](../../../max/CLAUDE.md))。

## 状況

- **T1 は未完。** リダイレクトを実際に受けていないため、**通知ノードそのものは未確認**(plan.md C1 / R1)。
- 確認できたのは②投稿・③固定に使う要素と、`ifEmpty` の判定材料。

## ✅ 確認できたこと

| 項目 | 結果 |
|---|---|
| content script の注入 | **studio ドメインで動く。**`#yt-redirect-pin-manual-trigger` がマウントされていた |
| ポップアウトの構造 | iframe なし。`yt-live-chat-app` > `yt-live-chat-renderer` のトップレベル文書 |
| `chatItemList` | `yt-live-chat-item-list-renderer #items` が当たる |
| `chatInput` | `yt-live-chat-text-input-field-renderer #input` が当たる |
| `chatSendButton` | `#send-button button` が当たる |
| `messageMenuButton` | `#menu yt-icon-button#menu-button button` が当たる。**ホバー前から DOM にある**。`aria-label` は「チャットの操作」 |
| メニューの器 | `ytd-menu-popup-renderer` > `tp-yt-iron-dropdown`、項目は `ytd-menu-service-item-renderer`(`role="menuitem"`) |

## ⚠️ 推測が外れていた点(修正済み)

### 1. 固定バナーは「何も固定していなくても」常駐する — `ifEmpty` が壊れていた

```
yt-live-chat-pinned-message-renderer
  attrs: [id, disable-upgrade, hidden, class]
  display: none / size 0x0 / 子要素なし / textLen 0
```

`getPinnedBanner` が要素の有無だけを見ていたため、**`ifEmpty`(既定モード)が常に
「既に固定済み」と誤判定し、一度も固定しない**状態だった。

→ 表示されていて (`hidden` / `aria-hidden` / `display:none` を除外) かつ中身があるものだけを
「固定中」とみなすよう修正。回帰テストを [tests/pinner.test.ts](../tests/pinner.test.ts) に追加。

なお `yt-live-chat-banner-manager` の中に `#visible-banners`(通常時は空・高さ 0)がある。
**実際に固定したときここに生えると見て候補の先頭に置いたが、これは未確認。**

### 2. リダイレクト通知の候補要素が、常設のウェルカムメッセージと同じだった

`yt-live-chat-viewer-engagement-message-renderer` は「ライブ チャットへようこそ…」の
常設メッセージにも使われており、**通常時から 1 件存在する**(リンク先は `support.google.com`)。

要素の一致だけで通知と判定すると毎回これを拾う。今は送信元チャンネル URL が取れないと
イベントを捨てるので実害は出ていなかったが、判定を 2 段に分けた:

- リダイレクト専用と思われる要素 (`redirectNoticeStrict`) → 文言を見ずに通知とみなす
- それ以外 → **文言パターンの一致を必須**にする

### 3. 入力欄の `contenteditable` は値が空

`contenteditable=""` であり `"true"` ではない。`div[contenteditable="true"]` の候補は
死んでいたので `[contenteditable]` 系に差し替えた。

## ❓ まだ分かっていないこと

| # | 内容 | 影響 |
|---|---|---|
| A | **リダイレクト通知の要素名・文言**(そもそもチャット欄に出るか) | ①検知の全部。plan.md C1 / R1 |
| B | **メッセージのメニューに「固定」があるか、そのラベル** | ③固定。plan.md C2 |
| C | **実際に固定した状態の DOM**(どこに生えるか) | `ifEmpty` の判定。plan.md R4 |
| D | 送信ボタンの無効化状態の表し方 | ②投稿のフォールバック経路 |
| E | 最小化・非前面での `MutationObserver` の発火 | plan.md C3 |

### B について: プログラムからは開けなかった

`menu-button` に `click()` を送ってもドロップダウンが可視にならず(`0x0` / `visible: false`)、
プリロードされた「報告」1 件しか読めなかった。**これがメニューの全項目とは限らない。**

同時に、これは `pinner.ts` のリスクでもある。**`button.click()` だけではメニューが開かない可能性**が
あり、開かなければ `unavailable` を返して固定をスキップする(投稿は成立する / AC6)。
実際の挙動は手でメニューを開いた状態で確認する必要がある。
