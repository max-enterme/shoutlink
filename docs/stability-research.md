# 挙動の安定化に使える資料 — 調査メモ

調査日: 2026-08-12 / 調査方法: 公開リポジトリのコードと実データサンプルの読解のみ

> ⚠️ **ここに書いたことは、実際の Studio 管制室の DOM に当てて確認していない。**
> 要素名・enum・エンドポイントは他プロジェクトの実装とサンプル JSON からの引用であり、
> 「この拡張で動く」ことは確認していない。**推測と断定を混ぜないため、各項に確度を書く。**
> 確認できたものは [t1-findings.md](t1-findings.md) 側へ移す。

## 要点

いま不安定さの原因になっているのは、大きく **(a) 文言依存の検知**、**(b) バナー領域の
読み違え**、**(c) 非表示タブでのタイマー** の 3 つ。(a)(b) は**言語にも文言にも依存しない
判定材料が実在する**ことが分かった。(c) は今のコードに直接刺さる既知のブラウザ仕様。

一般論の記事(MutationObserver のベストプラクティス、CSS セレクタ耐性)は一通り見たが、
**[t1-findings.md](t1-findings.md) に既に書いてあることの下位互換**で、採るものは無かった。

---

## 1. リダイレクト通知には専用の要素・専用の型がある

**確度: 高**(複数の独立した実装が同じ名前を使っている)

現状 [`selectors.ts`](../src/selectors.ts) は `REDIRECT_TEXT_PATTERNS`(`とその視聴者が参加しました`)
との一致を**必須**にしている。これが日本語 UI 前提([README](../README.md) の前提)と
未解決 G、[specs/002-i18n](../specs/002-i18n/spec.md) の根になっている。

実際には専用の型がある。

### DOM 側: `yt-live-chat-banner-redirect-renderer`

| 参照 | 使い方 |
|---|---|
| [social_stream `sources/youtube.js`](https://github.com/steveseguin/social_stream/blob/main/sources/youtube.js) | `tagName == "YT-LIVE-CHAT-BANNER-REDIRECT-RENDERER"` **だけ**で redirect と判定。送信元名は `#banner-text` 内の `.bold` から `@` を剥がして取る |
| [YT-Nickname-Restoration-Assistant](https://github.com/lisheng099/YT-Nickname-Restoration-Assistant) | `yt-live-chat-banner-redirect-renderer #banner-text span` |

### 内部 API 側: `LIVE_CHAT_BANNER_TYPE_CROSS_CHANNEL_REDIRECT`

```
addBannerToLiveChatCommand
  └ bannerRenderer.liveChatBannerRenderer
      ├ bannerType: "LIVE_CHAT_BANNER_TYPE_CROSS_CHANNEL_REDIRECT"
      └ contents.liveChatBannerRedirectRenderer
          ├ bannerMessage.runs[]   … bold の run が相手の名前
          ├ authorPhoto
          ├ inlineActionButton
          └ contextMenuButton
```

型定義: [YouTube.js `LiveChatBannerRedirect.ts`](https://github.com/LuanRT/YouTube.js/blob/main/src/parser/classes/livechat/items/LiveChatBannerRedirect.ts) /
[masterchat `addBannerToLiveChatCommand.ts`](https://github.com/sigvt/masterchat/blob/master/src/chat/actions/addBannerToLiveChatCommand.ts) /
[Agash/YTLiveChat](https://github.com/Agash/YTLiveChat) / [youtube-livechat-emitter](https://github.com/nanikaka666/youtube-livechat-emitter) /
[LiveTL (HyperChat)](https://github.com/LiveTL/LiveTL)

### できるようになること

**文言の一致を「必須条件」から「補助」へ降格できる。**要素名で通知を特定し、文言は
診断ログと保険に回す。日本語 UI 前提という前提条件そのものが外れる。

---

## 2. 送信側/受信側の見分けも、文言なしで付く

**確度: 高**(実データのサンプルが両方向ぶんある)

[jonz94/youtube-js-raw-data-dumper `samples/`](https://github.com/jonz94/youtube-js-raw-data-dumper/tree/main/samples)
に本物の JSON がある。**両方向とも `bannerType` は同じ**なので enum だけでは足りないが、
構造が違う。

| | `bannerMessage.runs` | `inlineActionButton` |
|---|---|---|
| **受信**(返礼したい方) | `[{bold:true, text:"<相手>"}, {text:" and their viewers just joined. Say hello!"}]` | 「詳細」→ support.google.com |
| **送信**(2026-08-06 に誤爆した方) | `[{text:"Don't miss out! People are going to watch something from "}, {bold:true, text:"<送信先>"}]` | 「今すぐ移動」→ **`watchEndpoint` (`/watch?v=...`)** |

→ **バナー内のボタンのリンク先が `/watch?v=` なら送信側**、という言語非依存の判定が作れる。
現在の `EXCLUDED_TEXT_PATTERNS`(`視聴を促進` など)の上位互換になる。
bold run の位置(先頭か末尾か)でも分かるが、ボタンのほうが安定しているはず。

### 期待が外れた点

**このバナーに channelId は入っていない。**bold の run はテキスト(表示名またはハンドル)
だけで `navigationEndpoint` も持たない。**ハンドル文字列から URL を組み立てる今のやり方は、
API 経路に移っても改善しない。**

### 副産物

このサンプル群は、合成 DOM のままの [`tests/fixtures/live-chat.ts`](../tests/fixtures/live-chat.ts)
を実データに置き換える材料としてそのまま使える。

---

## 3. 🔴 `ifEmpty`(既定)が常に「固定済み」と読んでいる疑い

**確度: 仮説。ただし観測済みのログと整合する。**未解決 C の答えになりそう。

分かったこと: **リダイレクトバナーも、AI チャット要約バナーも、固定メッセージも、
すべて `yt-live-chat-banner-manager` 配下に同じ `yt-live-chat-banner-renderer` として出る。**
(根拠: [AdGuard のフィルタ](https://github.com/AdguardTeam/FiltersRegistry) が
`yt-live-chat-banner-manager:has(yt-live-chat-banner-chat-summary-renderer)` と
`:has()` で要約バナーだけを狙い撃ちしている = 兄弟に別種のバナーが居る)

いまの [`getPinnedBanner`](../src/selectors.ts) の第 1 候補は

```
yt-live-chat-banner-manager #visible-banners yt-live-chat-banner-renderer
```

を「表示されていて中身がある」で採る。**リダイレクトバナーが出ている最中に判定するので、
`ifEmpty` は何も固定していなくても「既に固定中」と読む。**
t1-findings の 2 回目で出た `既に固定中のメッセージがあるため固定しない (pinMode=ifEmpty)`
はこれで説明が付く。

### 見分け方(構造で付く)

| バナー | header | 中身 |
|---|---|---|
| 固定メッセージ | **あり**(`liveChatBannerHeaderRenderer` / icon `KEEP`) | `yt-live-chat-text-message-renderer` |
| リダイレクト | なし | `yt-live-chat-banner-redirect-renderer` |
| チャット要約 | — | `yt-live-chat-banner-chat-summary-renderer` |

→ 「固定中」の判定は **中身が `yt-live-chat-text-message-renderer` であること**まで見る。

### 確認のしかた

実配信の往復を使わずに済む。`debug` ログに `yt-live-chat-banner-manager` 配下の要素名を
出すだけで、次のリダイレクト 1 回で確定する。

---

## 4. 「固定」メニュー項目はアイコンで識別できる

**確度: 中**(内部 API 側は確実。DOM に iconType がどう出るかは未確認)

[masterchat の API 一覧コメント](https://github.com/sigvt/masterchat/blob/master/src/api/index.ts)
が、コンテキストメニュー各項目の識別子を列挙している。

| 項目 | icon | エンドポイント |
|---|---|---|
| Pin message | **`KEEP`** | `POST /youtubei/v1/live_chat/live_chat_action`(params は `liveChatActionEndpoint`) |
| Unpin message | **`KEEP_OFF`** | 同上 |
| Remove / timeout / hide | `DELETE` / `HOURGLASS` / `REMOVE_CIRCLE` | `live_chat/moderate` |

**ラベル文字列ではなくアイコンで識別されている。**`PIN_MENU_LABELS`(`固定` / `Pin`)と
`UNPIN_MENU_LABELS` の言語依存を、DOM 上の `yt-icon` で置き換えられる可能性がある。
メニュー取得は `live_chat/get_item_context_menu`(t1-findings の「メニュー項目はサーバから
取りに行く」の裏付け)。

> ⚠️ **内部 API を直接叩くのは、DOM 操作より明確に「自動化された手段」寄り。**
> [d3-automation-policy.md](d3-automation-policy.md) の判断を変える話になる。
> **参考として記録するだけで、移行先としては薦めない。**
> なお「固定するエンドポイントは無い」は **Data API について**は正しく、内部 API には在る。

---

## 5. ブラウザ側の落とし穴(どちらも今のコードに刺さる)

### 5-1. 🔴 非表示タブでのタイマー絞り込み

**確度: 高**(Chrome の公式仕様)/ 参照: [Heavy throttling of chained JS timers beginning in Chrome 88](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)

- 非表示ページでは**入れ子 5 段以上の `setTimeout` チェーンが 1 秒に**絞られる
- **5 分以上非表示だと 1 分に 1 回**まで絞られる(intensive throttling)
- 音声再生・WebSocket/WebRTC のあるページは対象外。**ライブチャットのポップアップは該当しない**

[`wait.ts`](../src/wait.ts) の `waitFor` は `setTimeout(100ms)` のチェーン。
[`pinner.ts:149`](../src/pinner.ts) の 4 秒待ちは、**ポップアウトを OBS の裏に置く/最小化する
実運用で、最初の 1 回の sleep を抜けた時点で期限切れになり `unavailable` に落ちる。**

未解決 F は MutationObserver の発火だけを心配しているが、**危ないのはポーリング側**。

### 5-2. 孤児化した content script

**確度: 高** / 参照: [WXT — Content Scripts](https://wxt.dev/guide/essentials/content-scripts.html)

拡張を再読み込みしてもタブに残った旧 content script は動き続け、`Extension context invalidated`
を出す。WXT の `ctx`(`ctx.setTimeout` / `ctx.addEventListener` など、コンテキスト失効時に
自動で止まるラッパ)の設計が参考になる。

「旧ビルドが動いていて 2 往復無駄にした」件と同じ系統の事故を、起動ログ以外の手段で潰せる。

### 5-3. (将来) レスポンスを直接読む場合

[Chrome の content-scripts / `world: "MAIN"`](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)。
`world: "MAIN"` は manifest 宣言だと不安定で、`chrome.scripting.registerContentScripts` から
登録するのが確実、という既知の癖がある。

---

## 手を付けるならこの順

| 順 | 何を | 効く先 | 実配信の往復 |
|---|---|---|---|
| 1 | `debug` ログに banner-manager 配下の要素名を出す | 3. の確定 | 1 回で済む |
| 2 | `getPinnedBanner` を「中身が text-message-renderer」まで見る | `ifEmpty` = 既定モード | 1 と同時 |
| 3 | `yt-live-chat-banner-redirect-renderer` を検知の第 1 経路にする | 002-i18n / 未解決 G | 1 と同時 |
| 4 | 送信側の判定をボタンのリンク先に置き換える | 2026-08-06 の事故 2 の再発防止 | 送信側で試せる |
| 5 | `waitFor` を非表示タブで壊れない形にする | 5-1 | 最小化して試すだけ |
| 6 | fixture をサンプル JSON 由来に差し替える | テストの実効性 | 不要 |

---

## 参照一覧

- [steveseguin/social_stream — sources/youtube.js](https://github.com/steveseguin/social_stream/blob/main/sources/youtube.js)
- [jonz94/youtube-js-raw-data-dumper — samples](https://github.com/jonz94/youtube-js-raw-data-dumper/tree/main/samples)
- [LuanRT/YouTube.js — livechat parser classes](https://github.com/LuanRT/YouTube.js/tree/main/src/parser/classes/livechat)
- [sigvt/masterchat — src/api/index.ts](https://github.com/sigvt/masterchat/blob/master/src/api/index.ts)
- [Agash/YTLiveChat](https://github.com/Agash/YTLiveChat) / [nanikaka666/youtube-livechat-emitter](https://github.com/nanikaka666/youtube-livechat-emitter) / [LiveTL/LiveTL](https://github.com/LiveTL/LiveTL)
- [lisheng099/YT-Nickname-Restoration-Assistant](https://github.com/lisheng099/YT-Nickname-Restoration-Assistant)
- [AdguardTeam/FiltersRegistry](https://github.com/AdguardTeam/FiltersRegistry)
- [Chrome 88 のタイマー絞り込み](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)
- [WXT — Content Scripts](https://wxt.dev/guide/essentials/content-scripts.html)
- [Chrome for Developers — Manifest: content scripts](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)
- [How to use YouTube Live Redirect (YouTube ヘルプ)](https://support.google.com/youtube/answer/10359590?hl=en)
