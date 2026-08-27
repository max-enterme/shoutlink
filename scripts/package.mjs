// GitHub Releases に添付する ZIP を作る。
//
//   release/shoutlink-<version>.zip
//     shoutlink-<version>/
//       INSTALL.txt      … 展開した人がまず読むもの
//       manifest.json    … 「パッケージ化されていない拡張機能を読み込む」で選ぶのはこのフォルダ
//       content.js / options.html / options.js / icons/
//
// **中身をフォルダ 1 枚で包んである。**展開先に散らばると、どこを読み込めばよいか分からなくなるため。
//
// 前提: 先に `npm run build` で dist/ が作られていること。
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeZip } from './zip.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')

try {
  await access(path.join(dist, 'manifest.json'))
} catch {
  console.error('dist/ が無い。先に `npm run build` を実行すること')
  process.exit(1)
}

const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf8'))
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))

if (manifest.version !== version) {
  console.error(`版が食い違っている: package.json=${version} manifest=${manifest.version}`)
  process.exit(1)
}

// README を経由せず ZIP だけ手渡しされることがある。**この文書が唯一の告知になりうる**ので、
// 警告を手順より先に置く。
const INSTALL = `返礼リンク (shoutlink) ${version}

■ 使う前に必ず読んでください

この拡張は、あなたのアカウントの名義で YouTube のライブチャットへ自動投稿します。
これは YouTube の規約上グレーな行為を含みます。処分の前例は見つかっていませんが、
「安全である証拠」ではなく「証拠が無い」という状態です。
何かあったとき失うのは、作者ではなくあなたのチャンネルです。

リスクを自分で判断・管理できる人が、自己責任で使うことを想定しています。
判断がつかない場合は、使わないでください。作者は結果について責任を負いません (MIT / 無保証)。

また、実配信で動作を確認できているのは日本語 UI・1 環境だけです。
既定の固定モード ifEmpty の判定は未検証です。
自由文 ({msg}) 入りの文面は、実配信での通し確認 (検知 → 投稿 → 固定) が未実施です。
コメント返し (下記) も、実配信での通し確認が未実施です。

  詳細: https://max-enterme.github.io/shoutlink/

■ 前提

・Chrome (確認しているのは Chrome だけです)
・拡張が読み込まれて動くのは、YouTube Studio のライブ管制室のチャットだけです
  (studio.youtube.com/live_chat)。www.youtube.com のライブチャットには読み込まれません
・Studio の表示言語が日本語であること (検知は通知の文言に依存しています)

■ 求められる許可について

読み込むと、許可の表示に studio.youtube.com と www.youtube.com の 2 つが出ます。
役割が違います。

・studio.youtube.com … 拡張が読み込まれて動くのはここだけです (検知・投稿・固定)
・www.youtube.com    … 設定画面が、辞書に登録したチャンネルのページを 1 回だけ
                       読みに行くためのものです (コメント返しの照合に使うチャンネル ID を
                       控えるため)。このページに拡張が読み込まれることはありません。
                       ライブチャットの画面では通信しません。

⚠️ 「www.youtube.com のライブチャットでも動くようになった」という意味ではありません。
   この拡張は過去に、www.youtube.com でも拡張が動いてしまい、他人の配信のチャットへ
   投稿する不具合を起こしています (2026-08-06)。今回増えたのはページを取得してよいという
   許可だけで、拡張が読み込まれる範囲は studio.youtube.com/live_chat のままです。

■ 入れかた

1. このフォルダを、消さない場所に置く
   (Chrome はこのフォルダを読み続けます。消すと拡張も消えます)
2. Chrome で chrome://extensions を開く
3. 右上の「デベロッパー モード」を ON にする
4. 左上の「パッケージ化されていない拡張機能を読み込む」を押す
5. このフォルダ (manifest.json が入っているフォルダ) を選ぶ
6.「返礼リンク」のカードが出れば完了

■ 設定

chrome://extensions のカード →「詳細」→「拡張機能のオプション」

「リダイレクトを自動検知して投稿する」を外すと、リダイレクト返礼の自動投稿は止まります。
ただし手動の「↩ 返礼」は、外していても実行できます (人が押した時点で意思表示とみなすため)。
下の「コメント返し」は別のスイッチで、こちらを外しても止まりません (既定は OFF です)。
書き込みを完全に止めたいときは、拡張そのものを無効にするか外してください。

送信元ごとの自由文 ({msg}) を使う場合は、投稿文テンプレートに {msg} を入れたうえで、
「呼び名の辞書」の各行に自由文を書きます。テンプレートに {msg} が無いときは
設定画面が警告します。

⚠️ 送信元の検知は推測を含みます。取り違えると、その人に宛てて書いた一文が
   そのまま別の相手への投稿に載ります。取り違えて別の人に読まれても困らない
   内容だけを書いてください。

■ コメント返し (既定 OFF)

リダイレクトの受信とは別の引き金です。辞書で「コメントに反応する」を付けた人が
ライブチャットにコメントすると、その人のチャンネル URL を投稿します。

動かすには 2 つとも自分で入れる必要があります。何もしなければ、これまでと同じ挙動です。

  1. 設定の「コメントに反応して投稿する」を ON (既定 OFF)
  2. 辞書の行を左端の ▸ で開いて「コメントに反応する」を ON (既定 OFF。
     リダイレクトを受けて自動で載った相手にも付いていません)

・固定はしません (固定枠は 1 件しかなく、リダイレクト返礼の固定が流れるため)。
・同じ配信・同じ人には 1 回まで / 投稿の間隔は最低 5 秒 / 1 配信あたり 20 件まで。
  この 3 つは設定では変えられません。
・自分 (配信者) 自身のコメントには反応しません。辞書に載っていない人にも反応しません。
・ON にした時点で既にあるコメントには反応しません (その後に現れたコメントだけ)。
・「コメントに反応する」を ON にすると、その人のチャンネルページを 1 回だけ見に行って
  照合用の ID を控えます (上の「求められる許可について」)。取得できなかった行には ⚠ が付き、
  その人のコメントには反応しません。リダイレクト返礼は今までどおり動きます。

⚠️ ON にすると投稿の頻度が上がります。コメントはリダイレクトより桁違いに多いためです。
⚠️ コメント返しは実配信での通し確認が未実施です。登録した人のコメントで投稿されるか、
   固定されないか、同じ配信で 2 回目が出ないか、自分の投稿を引き金に再投稿しないか、
   チャットを開き直したときに過去のコメントへ一斉投稿しないかは、まだ確かめられていません。
   試すときは必ず限定公開のテスト配信で。

■ 注意

・Chrome が起動のたびに「デベロッパー モードの拡張機能を無効にする」と聞いてきます。
  未署名の拡張なので正常です。「キャンセル」で閉じてください。
・自動更新はされません。新しい版はここから取ってください。
  https://github.com/max-enterme/shoutlink/releases/latest

■ 新しい版に入れ替えるとき

設定・呼び名の辞書・投稿履歴は引き継がれます。書き写す必要はありません。

1. 新しい ZIP を展開する (古いフォルダとは別の場所で構いません)
2. chrome://extensions で古い「返礼リンク」を削除する
3.「パッケージ化されていない拡張機能を読み込む」で新しいフォルダを選ぶ

・先に古い方を削除してください。残したまま読み込むと
 「同じ ID の拡張機能が既にあります」で拒否されます。
  これは安全のための挙動で、2 つとも動いて同じ相手に 2 回投稿するのを防いでいます。
・古いフォルダの中身を新しい中身で上書きして ↻ を押す形でも構いません。
`

const files = (await readdir(dist, { recursive: true, withFileTypes: true }))
  .filter((e) => e.isFile() && !e.name.startsWith('_') && !e.name.endsWith('.map'))
  .map((e) => path.relative(dist, path.join(e.parentPath ?? e.path, e.name)))

// ZIP ライタもディレクトリ走査も自前なので、**取りこぼしても妥当な ZIP ができてしまう**。
// 「開けるが読み込めない拡張」を配らないよう、要るものが揃っているかをここで見る。
const REQUIRED = [
  'manifest.json',
  'content.js',
  'options.html',
  'options.js',
  ...Object.values(manifest.icons),
]
const found = new Set(files.map((f) => f.split(path.sep).join('/')))
const missing = REQUIRED.filter((f) => !found.has(f))
if (missing.length > 0) {
  console.error(`dist/ に足りないものがある: ${missing.join(', ')}`)
  process.exit(1)
}

const top = `shoutlink-${version}`
const entries = [{ name: `${top}/INSTALL.txt`, data: Buffer.from(INSTALL, 'utf8') }]
for (const file of files.sort()) {
  entries.push({
    name: `${top}/${file.split(path.sep).join('/')}`,
    data: await readFile(path.join(dist, file)),
  })
}

const releaseDir = path.join(root, 'release')
const zipPath = path.join(releaseDir, `${top}.zip`)
await mkdir(releaseDir, { recursive: true })
await rm(zipPath, { force: true })
await writeFile(zipPath, makeZip(entries))

console.log(`packaged -> ${zipPath}`)
for (const entry of entries) console.log(`  ${entry.name}`)
