// ストア掲載画像を撮るための HTML を dist/ に吐く。
//
//   dist/_store-promo.html    … 小プロモタイル (440x280) の版下
//   dist/_store-options.html  … オプションページに見本データを流し込んだもの (1280x800 で撮る)
//
// 撮影はブラウザ側でやる (Playwright なり手動なり)。撮った PNG は store/assets/ に置く。
// dist/ は .gitignore 済みなので、この 2 枚はコミットされない。
//
//   npm run build && node scripts/make-store-assets.mjs
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
      <h1>リダイレクト返礼ピン</h1>
      <p>受け取ったライブリダイレクトを検知して、<br />送信元チャンネルの URL をチャットに投稿・固定します。</p>
    </div>
    <span class="tag">YouTube Studio のライブチャット用</span>
  </body>
</html>
`

await writeFile(path.join(dist, '_store-promo.html'), PROMO)

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
          template: '{name}さんからリダイレクトありがとうございます! {url}',
          pinMode: 'ifEmpty',
          cooldownSec: 600,
          debug: false,
        },
        'ytRedirectPin.directory': [
          { url: 'https://www.youtube.com/@example-live', nickname: 'れい', lastSeenAt: 1 },
          { url: 'https://www.youtube.com/@sample-channel', nickname: '', lastSeenAt: 2 },
          { url: 'https://www.youtube.com/@demo-streamer', nickname: 'でも先輩', lastSeenAt: 0 },
        ],
      }
      globalThis.chrome = {
        storage: {
          sync: { get: async (key) => ({ [key]: sample[key] }), set: async () => {} },
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
  path.join(dist, '_store-options.html'),
  optionsHtml.replace(marker, MOCK + '    ' + marker),
)

console.log('wrote dist/_store-promo.html (440x280)')
console.log('wrote dist/_store-options.html (1280x800 で撮る)')
