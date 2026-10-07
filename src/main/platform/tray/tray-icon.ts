import { crc32, deflateSync } from 'node:zlib'
import { nativeImage, type NativeImage } from 'electron'
import type { TrayState } from '../../services/ports'

// 트레이 아이콘을 상태별 색 원으로 직접 그린다. 디자인 아이콘이 생기기 전까지 쓰는 임시 구현.

const COLORS: Record<TrayState, [number, number, number]> = {
  idle: [99, 102, 241],
  busy: [245, 158, 11],
  new: [34, 197, 94],
  offline: [148, 163, 184],
  error: [239, 68, 68]
}

const SIZE = 32

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function circlePng([r, g, b]: [number, number, number]): Buffer {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
  const c = (SIZE - 1) / 2
  const radius = SIZE / 2 - 1
  for (let y = 0; y < SIZE; y++) {
    const row = y * (SIZE * 4 + 1)
    raw[row] = 0 // filter: none
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x - c, y - c)
      const alpha = Math.max(0, Math.min(1, radius - d + 0.5)) // 가장자리 안티앨리어싱
      const i = row + 1 + x * 4
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
      raw[i + 3] = Math.round(alpha * 255)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const cache = new Map<TrayState, NativeImage>()

export function trayIcon(state: TrayState): NativeImage {
  let img = cache.get(state)
  if (!img) {
    img = nativeImage.createFromBuffer(circlePng(COLORS[state]), { scaleFactor: 2 })
    cache.set(state, img)
  }
  return img
}
