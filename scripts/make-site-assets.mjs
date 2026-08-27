// 説明ページ (docs/) 用の画像を撮るための HTML を dist/ に吐く。
//
//   dist/_site-ogp.html    … OGP 画像 (440x280) の版下
//   dist/_site-options.html  … オプションページに見本データを流し込んだもの (1280x800 で撮る)
//
// 撮影はブラウザ側でやる (Playwright なり手動なり)。撮った PNG は docs/assets/ に置く。
// dist/ は .gitignore 済みなので、この 2 枚はコミットされない。
//
//   npm run site-assets
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')

// --- 小プロモタイル 440x280 -----------------------------------------------

const PROMO = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        width: 440px; height: 280px; overflow: hidden;
        display: flex; flex-direction: column; justify-content: center; gap: 18px;
        padding: 0 34px;
        background: linear-gradient(135deg, #1b3492 0%, #2447b5 55%, #3a63d8 100%);
        color: #fff;
        font-family: 'Yu Gothic UI', 'Meiryo', system-ui, sans-serif;
      }
      .mark { width: 76px; height: 76px; }
      h1 { font-size: 30px; font-weight: 700; letter-spacing: 0.01em; }
      p { font-size: 15px; line-height: 1.6; color: rgba(255, 255, 255, 0.82); }
      .tag {
        align-self: flex-start; font-size: 12px; letter-spacing: 0.04em;
        padding: 4px 10px; border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.35); color: rgba(255, 255, 255, 0.8);
      }
    </style>
  </head>
  <body>
    <svg class="mark" viewBox="0 0 100 100" fill="none">
      <rect width="100" height="100" rx="22" fill="#fff" fill-opacity="0.14" />
      <path d="M74 24 V56 H27" stroke="#fff" stroke-width="17" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M19 56 L47 35 V77 Z" fill="#fff" />
    </svg>
    <div>
      <h1>返礼リンク</h1>
      <p>来てくれた人のチャンネル URL を、<br />ライブチャットへ代わりに投稿します。</p>
    </div>
    <span class="tag">YouTube Studio のライブチャット用</span>
  </body>
</html>
`

await writeFile(path.join(dist, '_site-ogp.html'), PROMO)

// --- オプションページ (見本データ入り) -------------------------------------

// chrome.* が無い環境でも options.js は既定値で動くが、辞書が空だと画面が寂しいので
// 見本の登録を入れておく。実在するチャンネルは使わない。
const MOCK = `
    <style>
      /* 1280x800 に対して本文 640px は余白が目立つので、撮影用に拡大する */
      body { zoom: 1.55; }
    </style>
    <script>
      const sample = {
        'ytRedirectPin.config': {
          enabled: true,
          // **見本のテンプレートには {msg} を入れる。** 見本の辞書に自由文が入っているので、
          // {msg} が無いと設定画面が AC7 の警告を出し、撮影版下が「警告が出ている画面」になる
          template: '{name}さん {msg} リダイレクトありがとうございます! {url}',
          pinMode: 'ifEmpty',
          // **既定値 (config.ts の 6 * 60 * 60) をそのまま使う。**
          // 以前は 600 (10 分) にしていたが、実装の既定と食い違う絵になっていた
          cooldownSec: 21600,
          debug: false,
          // **コメント返しは ON にする** (004 / T13)。OFF のままだと、辞書側でフラグを付けた
          // 見本と食い違って設定画面が AC13 の不整合表示を常時出し、版下が「警告の出ている画面」になる。
          // **既定は OFF** (config.ts) で、ここで ON にしているのは撮影用の見本であることに注意
          commentReplyEnabled: true,
          // コメント返し用のテンプレートにも {msg} を入れる (理由は上と同じ / AC16)
          commentTemplate: '{name}さん {msg} 来てくれてありがとうございます! {url}',
        },
        // 自由文 (message / commentMessage) は空の行も混ぜる。「未設定でも成立する」ことが絵で分かるように。
        // **フラグ (replyToComment) と channelId は 3 通りを混ぜる** (004 / AC13 / AC17):
        //   ① ON + 解決済み … 正常に効いている行
        //   ② どれも未設定    … リダイレクトを受けて自動で載っただけの行 (印は出ない)
        //   ③ ON + 未解決    … **「設定したのに効かない行」**。⚠ と背景色、辞書の上に再試行の行が出る
        // ③ を入れているのは、**畳んだ状態でも効かない行が分かる**ことが絵で伝わるようにするため。
        // channelId は実在しない値にする (UC[\w-]{20,} に合う形であればよい / CHANNEL_ID_PATTERN)
        'ytRedirectPin.directory': [
          {
            url: 'https://www.youtube.com/@example-live',
            nickname: 'れい',
            message: 'いつも遊びに来てくれてありがとう!',
            replyToComment: true,
            commentMessage: 'コメントありがとう!',
            channelId: 'UCexample0000000000000a',
            lastSeenAt: 1,
          },
          {
            url: 'https://www.youtube.com/@sample-channel',
            nickname: '',
            message: '',
            replyToComment: false,
            commentMessage: '',
            channelId: '',
            lastSeenAt: 2,
          },
          {
            url: 'https://www.youtube.com/@demo-streamer',
            nickname: 'でも先輩',
            message: '今日もお疲れさまです',
            replyToComment: true,
            commentMessage: '',
            channelId: '',
            lastSeenAt: 0,
          },
        ],
        // 投稿履歴にも見本を入れる。**種別の列 (004 / AC13) が空の絵にならないように**、
        // リダイレクト返礼とコメント返しを 1 件ずつ置く
        'ytRedirectPin.postLog': [
          {
            url: 'https://www.youtube.com/@example-live',
            handle: '@example-live',
            text: 'れいさん いつも遊びに来てくれてありがとう! リダイレクトありがとうございます! https://www.youtube.com/@example-live',
            postedAt: Date.now() - 26 * 60 * 1000,
            streamId: 'sample-stream',
            kind: 'redirect',
          },
          {
            url: 'https://www.youtube.com/@example-live',
            handle: '@example-live',
            text: 'れいさん コメントありがとう! 来てくれてありがとうございます! https://www.youtube.com/@example-live',
            postedAt: Date.now() - 12 * 60 * 1000,
            streamId: 'sample-stream',
            kind: 'comment',
          },
        ],
      }
      // 辞書の保存先は local。local が無ければ sync に落ちる作りなので、両方に同じ見本を返させる
      const area = { get: async (key) => ({ [key]: sample[key] }), set: async () => {} }
      globalThis.chrome = {
        storage: {
          sync: area,
          local: area,
          onChanged: { addListener() {}, removeListener() {} },
        },
      }
    </script>
`

const optionsHtml = await readFile(path.join(dist, 'options.html'), 'utf8')
const marker = '<script src="options.js"></script>'
if (!optionsHtml.includes(marker)) {
  console.error(`options.html に ${marker} が無い。差し込み位置を直すこと`)
  process.exit(1)
}
await writeFile(
  path.join(dist, '_site-options.html'),
  optionsHtml.replace(marker, MOCK + '    ' + marker),
)

console.log('wrote dist/_site-ogp.html (440x280)')
console.log('wrote dist/_site-options.html (1280x800 で撮る)')
