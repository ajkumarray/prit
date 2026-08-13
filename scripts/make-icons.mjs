#!/usr/bin/env node
/**
 * Draws the app icons.
 *
 *   npm run icons
 *
 * PNGs are generated rather than committed as opaque binaries, so the icon can
 * actually be edited later — change the drawing below and re-run. Written with
 * a small PNG encoder over node:zlib so this needs no image dependency.
 *
 * The mark: a heart inside a radio wave. It's a couple's playlist on a radio.
 */

import { deflateSync } from 'node:zlib'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const OUT_DIR = resolve(process.cwd(), 'public')

// --- a minimal PNG encoder -------------------------------------------------

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
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** rgba: Uint8Array of size*size*4 */
function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // truecolour with alpha
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  // Each scanline is prefixed with a filter byte; 0 means "none".
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --- the drawing -----------------------------------------------------------

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)

/** Heart, as an implicit curve: negative inside, positive outside. */
function heartField(x, y) {
  const a = x * x + y * y - 1
  return a * a * a - x * x * y * y * y
}

/**
 * Colour for one sample point in [-1,1] space.
 * Returns [r,g,b,a] with a in 0..1.
 */
/*
 * Everything is kept inside a circle of radius 0.8, which is the maskable
 * safe zone — Android crops icons to whatever shape the launcher prefers, and
 * anything outside that circle can be shaved off.
 */
function sample(x, y) {
  // Warm background, brighter toward the top-left like the site's lamp.
  const d = Math.hypot(x + 0.35, y + 0.55)
  const bg = mix([138, 66, 28], [42, 22, 15], Math.min(1, d / 2.1))
  let out = [...bg, 1]

  // Radio waves rippling out from the heart, lower-right only so they read as
  // a signal leaving rather than a ring around.
  const r = Math.hypot(x, y)
  const angle = Math.atan2(y, x) // y is positive downward here
  const inArc = angle > -0.12 && angle < 1.28
  for (const [radius, width] of [
    [0.58, 0.036],
    [0.72, 0.03],
  ]) {
    if (inArc && Math.abs(r - radius) < width) {
      const t = 1 - Math.abs(r - radius) / width
      out = [...mix(out.slice(0, 3), [250, 230, 198], 0.8 * t), 1]
    }
  }

  // The heart, a touch above centre so the arcs have room beneath it.
  const hx = x / 0.4
  const hy = -(y + 0.06) / 0.4 - 0.2
  if (heartField(hx, hy) < 0) out = [250, 238, 214, 1]

  return out
}

function draw(size) {
  const rgba = new Uint8Array(size * size * 4)
  const SS = 3 // supersampling factor, for smooth edges

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let acc = [0, 0, 0, 0]
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((px + (sx + 0.5) / SS) / size) * 2 - 1
          const y = ((py + (sy + 0.5) / SS) / size) * 2 - 1
          const c = sample(x, y)
          acc = [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2], acc[3] + c[3]]
        }
      }
      const n = SS * SS
      const i = (py * size + px) * 4
      rgba[i] = Math.round(acc[0] / n)
      rgba[i + 1] = Math.round(acc[1] / n)
      rgba[i + 2] = Math.round(acc[2] / n)
      rgba[i + 3] = Math.round((acc[3] / n) * 255)
    }
  }
  return rgba
}

await mkdir(OUT_DIR, { recursive: true })

// 192 and 512 are what the manifest needs; 180 is what iOS uses.
for (const size of [180, 192, 512]) {
  const png = encodePng(draw(size), size)
  const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`
  await writeFile(resolve(OUT_DIR, name), png)
  console.log(`${name.padEnd(22)} ${size}×${size}  ${(png.length / 1024).toFixed(1)} kB`)
}
