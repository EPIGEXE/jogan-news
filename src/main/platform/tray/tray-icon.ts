import { crc32, deflateSync } from 'node:zlib'
import { nativeImage, type NativeImage } from 'electron'
import { MONOGRAM_J } from '@shared/wordmark'
import type { TrayState } from '../../services/ports'

// 트레이 아이콘: 앱 아이콘과 같은 모양(종이 + 먹색 테두리 + 블랙레터 J) + 오른쪽 아래 상태 배지 (DESIGN.md 13.8절).
// 이미지 파일 없이 코드로 그린다. 화면 배율마다(16·20·24·32px) 따로 그려 125%·150%에서도 또렷하게 한다.
// 모양은 32칸 좌표로 정의하고, 픽셀마다 4×4 점을 찍어 가장자리를 부드럽게 한다.

type Rgb = [number, number, number]

// 조간 디자인 토큰과 같은 색 (tokens.css)
const INK: Rgb = [17, 17, 20]
const PAPER: Rgb = [245, 245, 242]
const GREY: Rgb = [142, 142, 149] // 오프라인 배지
const ACCENT: Rgb = [178, 65, 14]
const DANGER: Rgb = [180, 35, 24]
const WHITE: Rgb = [255, 255, 255]

type Polygon = [number, number][]

type Shape =
  | { kind: 'rect'; x0: number; y0: number; x1: number; y1: number; r?: number; color: Rgb }
  | { kind: 'circle'; cx: number; cy: number; r: number; color: Rgb }
  /** 채운 경로. bold만큼 사방으로 두껍게 칠한다 (작은 크기에서 가는 획이 사라지지 않게) */
  | { kind: 'path'; polygons: Polygon[]; bold: number; color: Rgb; box: [number, number, number, number] }

/** SVG 경로(M·L·Q·C·Z, 절대 좌표)를 다각형으로 펴고, 32칸 좌표의 box 안에 가운데 맞춰 넣는다 */
function pathPolygons(d: string, w: number, h: number, box: { x: number; y: number; size: number }): Polygon[] {
  const k = box.size / Math.max(w, h)
  const ox = box.x + (box.size - w * k) / 2
  const oy = box.y + (box.size - h * k) / 2
  const tokens = d.match(/[MLQCZ]|-?\d*\.?\d+/g) ?? []
  const polys: Polygon[] = []
  let cur: Polygon = []
  let x = 0
  let y = 0
  let i = 0
  const num = () => Number(tokens[i++])
  const push = (px: number, py: number) => cur.push([ox + px * k, oy + py * k])
  while (i < tokens.length) {
    const cmd = tokens[i++]
    if (cmd === 'M') {
      if (cur.length) polys.push(cur)
      cur = []
      x = num()
      y = num()
      push(x, y)
    } else if (cmd === 'L') {
      x = num()
      y = num()
      push(x, y)
    } else if (cmd === 'Q') {
      const [cx, cy, ex, ey] = [num(), num(), num(), num()]
      for (let t = 1; t <= 6; t++) {
        const u = t / 6
        push((1 - u) ** 2 * x + 2 * (1 - u) * u * cx + u * u * ex, (1 - u) ** 2 * y + 2 * (1 - u) * u * cy + u * u * ey)
      }
      x = ex
      y = ey
    } else if (cmd === 'C') {
      const [c1x, c1y, c2x, c2y, ex, ey] = [num(), num(), num(), num(), num(), num()]
      for (let t = 1; t <= 8; t++) {
        const u = t / 8
        const a = (1 - u) ** 3
        const b = 3 * (1 - u) ** 2 * u
        const c = 3 * (1 - u) * u * u
        const e = u ** 3
        push(a * x + b * c1x + c * c2x + e * ex, a * y + b * c1y + c * c2y + e * ey)
      }
      x = ex
      y = ey
    } else if (cmd === 'Z') {
      if (cur.length) polys.push(cur)
      cur = []
    }
  }
  if (cur.length) polys.push(cur)
  return polys
}

/** 0이 아닌 감김 수(nonzero) 규칙으로 점이 경로 안에 있는지 */
function insidePolygons(polys: Polygon[], x: number, y: number): boolean {
  let winding = 0
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [x1, y1] = poly[j]!
      const [x2, y2] = poly[i]!
      if (y1 <= y) {
        if (y2 > y && (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1) > 0) winding++
      } else if (y2 <= y && (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1) < 0) winding--
    }
  }
  return winding !== 0
}

function covers(s: Shape, x: number, y: number): boolean {
  if (s.kind === 'circle') return Math.hypot(x - s.cx, y - s.cy) <= s.r
  if (s.kind === 'path') {
    const b = s.bold
    // 경로를 둘러싼 상자 밖이면 바로 제외 (대부분의 점이 여기서 끝나 빠르다)
    if (x < s.box[0] - b || x > s.box[2] + b || y < s.box[1] - b || y > s.box[3] + b) return false
    return (
      insidePolygons(s.polygons, x, y) ||
      (b > 0 &&
        (insidePolygons(s.polygons, x - b, y) ||
          insidePolygons(s.polygons, x + b, y) ||
          insidePolygons(s.polygons, x, y - b) ||
          insidePolygons(s.polygons, x, y + b)))
    )
  }
  if (x < s.x0 || x > s.x1 || y < s.y0 || y > s.y1) return false
  const r = s.r ?? 0
  if (r === 0) return true
  // 둥근 모서리: 모서리 원의 중심에서 r 안쪽만
  const cx = Math.min(Math.max(x, s.x0 + r), s.x1 - r)
  const cy = Math.min(Math.max(y, s.y0 + r), s.y1 - r)
  return Math.hypot(x - cx, y - cy) <= r
}

function boundingBox(polys: Polygon[]): [number, number, number, number] {
  const pts = polys.flat()
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]
}

const J_POLYGONS = pathPolygons(MONOGRAM_J.d, MONOGRAM_J.width, MONOGRAM_J.height, { x: 5, y: 4.5, size: 19 })

/** 종이 + 먹색 테두리 + 블랙레터 J (앱 아이콘과 같은 구성) */
const PAPER_SHAPES: Shape[] = [
  { kind: 'rect', x0: 2, y0: 2, x1: 30, y1: 30, r: 5, color: INK },
  { kind: 'rect', x0: 4.5, y0: 4.5, x1: 27.5, y1: 27.5, r: 3, color: PAPER },
  { kind: 'path', polygons: J_POLYGONS, bold: 0.45, color: INK, box: boundingBox(J_POLYGONS) }
]

/** 오른쪽 아래 배지. 종이색 테두리로 아이콘과 떼어 보이게 한다 */
function badge(state: TrayState): Shape[] {
  // 모서리에 작게 둬서 J를 가리지 않는다
  const C = 25.5
  const ring: Shape = { kind: 'circle', cx: C, cy: C, r: 6.5, color: PAPER }
  const dot = (color: Rgb): Shape => ({ kind: 'circle', cx: C, cy: C, r: 5.2, color })
  switch (state) {
    case 'idle':
      return []
    case 'busy':
      // 속이 빈 원: 진행 중
      return [ring, dot(INK), { kind: 'circle', cx: C, cy: C, r: 3, color: PAPER }]
    case 'new':
      return [ring, dot(ACCENT)]
    case 'offline':
      return [ring, dot(GREY)]
    case 'error':
      return [
        ring,
        dot(DANGER),
        { kind: 'rect', x0: 24.6, y0: 22, x1: 26.4, y1: 26.2, color: WHITE },
        { kind: 'rect', x0: 24.6, y0: 27.2, x1: 26.4, y1: 29, color: WHITE }
      ]
  }
}

const SAMPLES = 4

/** 모양 목록을 size×size RGBA로 그린다. 뒤에 오는 모양이 위에 그려진다 */
function rasterize(shapes: Shape[], size: number): Buffer {
  const scale = 32 / size
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let py = 0; py < size; py++) {
    const row = py * (size * 4 + 1)
    raw[row] = 0 // PNG filter: none
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let hits = 0
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) * scale
          const y = (py + (sy + 0.5) / SAMPLES) * scale
          for (let i = shapes.length - 1; i >= 0; i--) {
            const s = shapes[i]!
            if (covers(s, x, y)) {
              r += s.color[0]
              g += s.color[1]
              b += s.color[2]
              hits++
              break
            }
          }
        }
      }
      const i = row + 1 + px * 4
      if (hits > 0) {
        raw[i] = Math.round(r / hits)
        raw[i + 1] = Math.round(g / hits)
        raw[i + 2] = Math.round(b / hits)
      }
      raw[i + 3] = Math.round((hits / (SAMPLES * SAMPLES)) * 255)
    }
  }
  return encodePng(raw, size)
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(raw: Buffer, size: number): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** Windows 화면 배율 100%·125%·150%·200%에 맞는 크기 */
const SIZES = [16, 20, 24, 32]

/** 상태별 아이콘 PNG (크기별). 테스트·미리보기용으로도 쓴다 */
export function trayIconPng(state: TrayState, size: number): Buffer {
  return rasterize([...PAPER_SHAPES, ...badge(state)], size)
}

const cache = new Map<TrayState, NativeImage>()

export function trayIcon(state: TrayState): NativeImage {
  let img = cache.get(state)
  if (!img) {
    img = nativeImage.createEmpty()
    for (const size of SIZES) {
      img.addRepresentation({ scaleFactor: size / 16, width: size, height: size, buffer: trayIconPng(state, size) })
    }
    cache.set(state, img)
  }
  return img
}
