# Chrome ウェブストアへの公開

提出物と、提出までにやることの一覧。文面は [listing.md](listing.md) と [privacy.md](privacy.md) に
そのまま貼れる形で置いてある。

## 提出物を作る

```bash
npm run package:store
```

`release/yt-redirect-pin-store-<version>.zip` ができる。中身は `dist/` そのままで、
**manifest.json が ZIP の直下**にある (フォルダに包むとストアが弾く)。sourcemap は入らない。

テスター配布用の `npm run package` とは別物。あちらはソースと手順書を同梱していて、
ストアには出せない形になっている。

掲載画像を撮り直す場合:

```bash
npm run build && node scripts/make-store-assets.mjs
```

`dist/_store-promo.html` (440x280) と `dist/_store-options.html` (1280x800 で撮る) が出る。
ブラウザでその大きさに合わせて撮り、`store/assets/` に置く。
アイコンの図案を変えたときは `npm run icons`。

## 進捗

### こちらで用意済み

- [x] アイコン 16 / 32 / 48 / 128 (`public/icons/`, `npm run icons` で再生成)
- [x] manifest の `name` / `description` / `icons` をストア提出向けに整備
- [x] ストア用 ZIP を作る仕組み (`npm run package:store`) と提出前チェック
      (description 132 文字 / アイコンの有無 / sourcemap の混入)
- [x] 小プロモタイル 440x280 (`store/assets/promo-440x280.png`)
- [x] スクリーンショット 1280x800 × 3 枚 (設定画面) — **実配信の絵は未撮影**
- [x] 掲載文面の下書き ([listing.md](listing.md))
- [x] プライバシータブの回答文 ([privacy.md](privacy.md))
- [x] プライバシーポリシー本文 ([../docs/privacy-policy.md](../docs/privacy-policy.md))

### 人がやること

- [ ] **公開して良いかの判断** — spec.md D3 (自動投稿が YouTube の自動化ポリシーに触れないか)。
      自分だけで使うのと、他人に配って使わせるのとでは重さが違う。ここが未決のまま出さない
- [ ] **T8 の残りを潰す** — 自動経路の通しで固定まで到達するか / AC1 の 10 秒 /
      `ifEmpty` が実際の固定バナーを拾うか。動かない機能を掲載文に書くと審査でも評価でも刺さる
- [ ] デベロッパー登録 (Google アカウント / 一度きりの登録料 5 USD / 2 段階認証が要る)
- [ ] 公開者の表示名 (パブリッシャー名) を決める。ストアに出る名前
- [ ] 連絡先メールアドレスの登録と確認 (ダッシュボードの Account タブ。未確認だと公開できない)
- [ ] プライバシーポリシーを**公開 URL に置く** (`privacy.md` の候補を参照)
- [ ] 実配信でのスクリーンショット 2 枚を撮って差し替え ([listing.md](listing.md) 末尾)
- [ ] 公開範囲を決める (一般公開 / 限定公開 / 非公開)
- [ ] `version` を上げるか決める (今 `0.1.0`。公開なら `1.0.0` が素直)

## 提出後

- 審査は数日かかることがある。**ホスト権限を持つ拡張は追加のレビューに回りやすい**
- 却下されたらメールで理由が来る。直して同じアイテムに再提出する
- 更新のたびに `manifest.json` の `version` を上げる (下げる・据え置きは不可)

## 覚えておくこと

- **提出用 ZIP に難読化をかけない。** ストアは読めるコードを前提に審査する
- **掲載文面と実装を食い違わせない。** 特に権限とデータの扱い
- 拡張の ID は初回公開時に確定する。以後は同じアイテムを更新していく
