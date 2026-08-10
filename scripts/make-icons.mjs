// 拡張のアイコン (public/icons/*.png) を生成する。
//
// 依存を増やしたくないので、PNG エンコーダ (zlib は node 標準) と
// 4x4 スーパーサンプリングのラスタライザをここに直接書いてある。
// 図案: 角丸正方形の地 + 白い返信矢印 (↩)。
//
//   node scripts/make-icons.mjs
//
// 生成物はコミットする (ビルド時には走らせない)。図案を変えたときだけ実行する。
import { deflateSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outdir = path.join(root, 'public', 'icons')

// --- PNG エンコード -------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/** rgba: Uint8Array(width * height * 4) -> PNG バイト列 */
function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  // 10..12 = compression / filter / interlace = 0

  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: None
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --- 図形 (すべて単位座標 0..1, y は下向き) --------------------------------

/** 角丸正方形の内側か */
function inRoundedSquare(x, y, r) {
  // 角丸長方形の SDF。角の中心からの距離が r 以下なら内側
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0)
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0)
  return Math.hypot(dx, dy) <= r
}

/** 線分 ab を半径 r で太らせた領域(丸い端・丸い継ぎ目)の内側か */
function inCapsule(x, y, ax, ay, bx, by, r) {
  const vx = bx - ax
  const vy = by - ay
  const len2 = vx * vx + vy * vy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / len2))
  return Math.hypot(x - (ax + vx * t), y - (ay + vy * t)) <= r
}

function inTriangle(x, y, p) {
  const sign = (ax, ay, bx, by, cx, cy) => (ax - cx) * (by - cy) - (bx - cx) * (ay - cy)
  const d1 = sign(x, y, p[0], p[1], p[2], p[3])
  const d2 = sign(x, y, p[2], p[3], p[4], p[5])
  const d3 = sign(x, y, p[4], p[5], p[0], p[1])
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

const BG = [0x24, 0x47, 0xb5] // 濃い青。YouTube の赤とは意図的に変えてある
const FG = [0xff, 0xff, 0xff]

/** 返信矢印。縦の軸 → 左へ折れる → 左向きの矢じり */
function inArrow(x, y) {
  return (
    inCapsule(x, y, 0.74, 0.24, 0.74, 0.56, 0.085) ||
    inCapsule(x, y, 0.74, 0.56, 0.46, 0.56, 0.085) ||
    inTriangle(x, y, [0.19, 0.56, 0.47, 0.35, 0.47, 0.77])
  )
}

/**
 * size px の RGBA を作る。
 * pad は透明の余白 (px)。ストア用 128px は 96px の絵 + 各辺 16px の余白が求められる。
 */
function render(size, pad = 0) {
  const art = size - pad * 2
  const rgba = new Uint8Array(size * size * 4)
  const SS = 4 // 1px あたり 4x4 のスーパーサンプリング

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0
      let fg = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS - pad) / art
          const y = (py + (sy + 0.5) / SS - pad) / art
          if (x < 0 || x > 1 || y < 0 || y > 1) continue
          if (!inRoundedSquare(x, y, 0.22)) continue
          bg++
          if (inArrow(x, y)) fg++
        }
      }
      const total = SS * SS
      const alpha = bg / total
      if (alpha === 0) continue
      // 地の上に前景を重ねた色を、被覆率で合成する
      const k = bg === 0 ? 0 : fg / bg
      const i = (py * size + px) * 4
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(BG[c] * (1 - k) + FG[c] * k)
      rgba[i + 3] = Math.round(alpha * 255)
    }
  }
  return rgba
}

await mkdir(outdir, { recursive: true })

// 16/32/48 はツールバー用なので余白なし。128 はストア掲載用の規定に合わせて 96 + 余白 16。
const SPECS = [
  { size: 16, pad: 0 },
  { size: 32, pad: 0 },
  { size: 48, pad: 0 },
  { size: 128, pad: 16 },
]

for (const { size, pad } of SPECS) {
  const file = path.join(outdir, `icon${size}.png`)
  await writeFile(file, encodePng(render(size, pad), size, size))
  console.log(`wrote ${path.relative(root, file)}`)
}
