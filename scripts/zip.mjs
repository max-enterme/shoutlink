// 最小限の ZIP ライタ。
//
// PowerShell の Compress-Archive はエントリ名の区切りに `\` を書くことがあり、
// ZIP 仕様 (区切りは `/`) から外れる。ストア提出物でそれを踏みたくないので自前で書く。
// deflate は node 標準の zlib。
import { deflateRawSync } from 'node:zlib'

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

/** JS の Date -> MS-DOS の日付・時刻 (2 秒刻み) */
function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}

/**
 * entries: [{ name: 'icons/icon16.png', data: Buffer }] — name の区切りは `/`
 * mtime: 全エントリに使う更新時刻 (省略時は現在時刻)
 */
export function makeZip(entries, mtime = new Date()) {
  const { time, day } = dosTime(mtime)
  const locals = []
  const centrals = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name.replaceAll('\\', '/'), 'utf8')
    const deflated = deflateRawSync(entry.data, { level: 9 })
    // 圧縮して大きくなるなら無圧縮 (method 0) で入れる
    const compressed = deflated.length < entry.data.length
    const body = compressed ? deflated : entry.data
    const crc = crc32(entry.data)
    // 非 ASCII のファイル名に備えて UTF-8 フラグ (bit 11) を立てておく
    const flags = 0x0800

    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(compressed ? 8 : 0, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(day, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    locals.push(local, body)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(compressed ? 8 : 0, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(day, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centrals.push(central)

    offset += local.length + body.length
  }

  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, centralBuf, eocd])
}
