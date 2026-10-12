// ============================================================================
// 트레이 아이콘 그리기
//
// [역할]
// - 앱 아이콘과 같은 모양(종이 + 먹색 테두리 + 블랙레터 J)에 오른쪽 아래 상태 배지를 붙인 트레이 아이콘 생성 (DESIGN.md 13.8절)
// - 상태별 배지: 대기는 없음, 생성 중은 속 빈 먹색 원, 새 브리핑은 강조색 원, 오프라인은 회색 원, 실패는 빨간 원에 흰 느낌표
// - 이미지 파일 없이 코드로 그려 PNG로 만듦
// - 화면 배율마다(16 · 20 · 24 · 32px) 따로 그려 125% · 150%에서도 또렷하게 표시
// - 모양은 32칸 좌표로 정의하고, 픽셀마다 4×4 점을 찍어 가장자리를 부드럽게 처리
// - J는 제호 글자의 SVG 경로를 다각형으로 펴서 칠함 (작은 크기에서 가는 획이 사라지지 않게 조금 두껍게)
// - 한 번 그린 아이콘은 상태별로 기억해 두고 다시 그리지 않음
// ============================================================================
import { crc32, deflateSync } from 'node:zlib'
import { nativeImage, type NativeImage } from 'electron'
import { MONOGRAM_J } from '@shared/wordmark'
import type { TrayState } from '../../services/ports'

type Rgb = [number, number, number] // 색 [빨강, 초록, 파랑] (각각 0~255)

// 조간 디자인 토큰과 같은 색 (tokens.css)
const INK: Rgb = [17, 17, 20] // 먹색: 테두리 · J · 생성 중 배지
const PAPER: Rgb = [245, 245, 242] // 종이색: 바탕 · 배지 둘레
const GREY: Rgb = [142, 142, 149] // 오프라인 배지
const ACCENT: Rgb = [178, 65, 14] // 강조색: 새 브리핑 배지
const DANGER: Rgb = [180, 35, 24] // 실패 배지
const WHITE: Rgb = [255, 255, 255] // 실패 배지 안의 느낌표

type Polygon = [number, number][] // 꼭짓점 [x, y] 목록

type Bounds = [number, number, number, number] // 둘러싼 상자 [왼쪽, 위, 오른쪽, 아래]

// 그릴 모양 하나 (좌표는 모두 32칸 기준)
type Shape =
    | { kind: 'rect'; left: number; top: number; right: number; bottom: number; cornerRadius?: number; color: Rgb }
    | { kind: 'circle'; centerX: number; centerY: number; radius: number; color: Rgb }
    // 채운 경로. boldOffset만큼 사방으로 두껍게 칠함 (작은 크기에서 가는 획이 사라지지 않게)
    | { kind: 'path'; polygons: Polygon[]; boldOffset: number; color: Rgb; bounds: Bounds }

// SVG 경로(M · L · Q · C · Z, 절대 좌표)를 다각형으로 펴고, 32칸 좌표의 targetBox 안에 가운데 맞춰 넣음
function pathPolygons(
    pathData: string,
    pathWidth: number,
    pathHeight: number,
    targetBox: { x: number; y: number; size: number }
): Polygon[] {
    // 경로를 상자에 맞추는 배율과 가운데 정렬 위치 계산
    const fitScale = targetBox.size / Math.max(pathWidth, pathHeight) // 경로의 긴 변이 상자에 꽉 차는 배율
    const offsetX = targetBox.x + (targetBox.size - pathWidth * fitScale) / 2 // 짧은 변 쪽에 남는 여백의 절반만큼 밀어 가운데에 둠
    const offsetY = targetBox.y + (targetBox.size - pathHeight * fitScale) / 2

    // 경로 글자를 명령과 숫자로 나누고, 읽어 나갈 준비
    const pathTokens = pathData.match(/[MLQCZ]|-?\d*\.?\d+/g) ?? [] // 명령 글자와 숫자로 나눈 목록
    const polygons: Polygon[] = [] // 완성된 다각형
    let currentPolygon: Polygon = [] // 지금 그리는 중인 다각형
    let penX = 0 // 지금까지 그린 경로의 끝점 (경로 자체의 좌표)
    let penY = 0
    let tokenIndex = 0 // 다음에 읽을 토큰의 위치
    const readNumber = () => Number(pathTokens[tokenIndex++]) // 숫자 하나를 읽고 다음 토큰으로 이동
    // 경로 좌표의 점을 32칸 좌표로 옮겨 지금 다각형에 추가
    const addPoint = (pathX: number, pathY: number) => currentPolygon.push([offsetX + pathX * fitScale, offsetY + pathY * fitScale])

    // 명령을 하나씩 읽어 다각형의 꼭짓점으로 변환
    while (tokenIndex < pathTokens.length) {
        const command = pathTokens[tokenIndex++]
        if (command === 'M') {
            // 새 다각형 시작 (그리던 다각형이 있으면 먼저 마무리)
            if (currentPolygon.length) polygons.push(currentPolygon)
            currentPolygon = []
            penX = readNumber()
            penY = readNumber()
            addPoint(penX, penY)
        } else if (command === 'L') {
            // 직선 → 끝점 하나 추가
            penX = readNumber()
            penY = readNumber()
            addPoint(penX, penY)
        } else if (command === 'Q') {
            // 2차 곡선을 직선 6개로 나눔
            const [controlX, controlY, curveEndX, curveEndY] = [readNumber(), readNumber(), readNumber(), readNumber()]
            for (let segmentNumber = 1; segmentNumber <= 6; segmentNumber++) {
                const curveRatio = segmentNumber / 6 // 곡선의 시작(0)에서 끝(1) 사이의 위치
                addPoint(
                    (1 - curveRatio) ** 2 * penX + 2 * (1 - curveRatio) * curveRatio * controlX + curveRatio * curveRatio * curveEndX,
                    (1 - curveRatio) ** 2 * penY + 2 * (1 - curveRatio) * curveRatio * controlY + curveRatio * curveRatio * curveEndY
                )
            }
            penX = curveEndX
            penY = curveEndY
        } else if (command === 'C') {
            // 3차 곡선을 직선 8개로 나눔
            const [control1X, control1Y, control2X, control2Y, cubicEndX, cubicEndY] = [
                readNumber(),
                readNumber(),
                readNumber(),
                readNumber(),
                readNumber(),
                readNumber()
            ]
            for (let cubicSegmentNumber = 1; cubicSegmentNumber <= 8; cubicSegmentNumber++) {
                const cubicRatio = cubicSegmentNumber / 8 // 곡선의 시작(0)에서 끝(1) 사이의 위치
                // 시작점 · 조절점 둘 · 끝점이 이 위치에 주는 비중
                const startWeight = (1 - cubicRatio) ** 3
                const control1Weight = 3 * (1 - cubicRatio) ** 2 * cubicRatio
                const control2Weight = 3 * (1 - cubicRatio) * cubicRatio * cubicRatio
                const endWeight = cubicRatio ** 3
                addPoint(
                    startWeight * penX + control1Weight * control1X + control2Weight * control2X + endWeight * cubicEndX,
                    startWeight * penY + control1Weight * control1Y + control2Weight * control2Y + endWeight * cubicEndY
                )
            }
            penX = cubicEndX
            penY = cubicEndY
        } else if (command === 'Z') {
            // 다각형 닫기
            if (currentPolygon.length) polygons.push(currentPolygon)
            currentPolygon = []
        }
    }

    // 닫지 않고 끝난 다각형도 포함
    if (currentPolygon.length) polygons.push(currentPolygon)
    return polygons
}

// 점이 경로 안에 있는지 (0이 아닌 감김 수 규칙, nonzero)
function insidePolygons(polygons: Polygon[], x: number, y: number): boolean {
    let windingNumber = 0 // 경로가 점을 감아 도는 횟수 (도는 방향에 따라 +1 · -1)
    for (const polygon of polygons) {
        // 마지막 꼭짓점과 첫 꼭짓점을 잇는 변부터 모든 변을 차례로 확인
        for (
            let vertexIndex = 0, previousVertexIndex = polygon.length - 1;
            vertexIndex < polygon.length;
            previousVertexIndex = vertexIndex++
        ) {
            const [edgeStartX, edgeStartY] = polygon[previousVertexIndex]!
            const [edgeEndX, edgeEndY] = polygon[vertexIndex]!
            // 변이 점의 높이를 가로지르고 점이 그 변의 정해진 쪽에 있을 때만 셈 (가로지르는 방향에 따라 더하거나 뺌)
            if (edgeStartY <= y) {
                if (edgeEndY > y && (edgeEndX - edgeStartX) * (y - edgeStartY) - (x - edgeStartX) * (edgeEndY - edgeStartY) > 0)
                    windingNumber++
            } else if (edgeEndY <= y && (edgeEndX - edgeStartX) * (y - edgeStartY) - (x - edgeStartX) * (edgeEndY - edgeStartY) < 0)
                windingNumber--
        }
    }
    return windingNumber !== 0
}

// 모양이 점 (x, y)를 덮는지
function covers(shape: Shape, x: number, y: number): boolean {
    // 원 → 중심에서 반지름 안쪽
    if (shape.kind === 'circle') return Math.hypot(x - shape.centerX, y - shape.centerY) <= shape.radius

    // 경로 → 다각형 안쪽 (두껍게 칠하는 만큼 넓혀서 판단)
    if (shape.kind === 'path') {
        const boldOffset = shape.boldOffset
        // 경로를 둘러싼 상자 밖이면 바로 제외 (대부분의 점이 여기서 끝나 빠름)
        if (
            x < shape.bounds[0] - boldOffset ||
            x > shape.bounds[2] + boldOffset ||
            y < shape.bounds[1] - boldOffset ||
            y > shape.bounds[3] + boldOffset
        )
            return false
        // 점 자체가 안에 있거나, 상하좌우로 boldOffset만큼 옮긴 점이 안에 있으면 덮는 것
        return (
            insidePolygons(shape.polygons, x, y) ||
            (boldOffset > 0 &&
                (insidePolygons(shape.polygons, x - boldOffset, y) ||
                    insidePolygons(shape.polygons, x + boldOffset, y) ||
                    insidePolygons(shape.polygons, x, y - boldOffset) ||
                    insidePolygons(shape.polygons, x, y + boldOffset)))
        )
    }

    // 사각형 → 네 변 안쪽 (모서리가 각지면 여기서 끝)
    if (x < shape.left || x > shape.right || y < shape.top || y > shape.bottom) return false
    const cornerRadius = shape.cornerRadius ?? 0
    if (cornerRadius === 0) return true

    // 둥근 모서리 원의 중심에서 반지름 안쪽만
    // 모서리 구역 밖의 점은 거리가 반지름을 넘지 않아 항상 통과
    const cornerCenterX = Math.min(Math.max(x, shape.left + cornerRadius), shape.right - cornerRadius)
    const cornerCenterY = Math.min(Math.max(y, shape.top + cornerRadius), shape.bottom - cornerRadius)
    return Math.hypot(x - cornerCenterX, y - cornerCenterY) <= cornerRadius
}

// 다각형들을 모두 둘러싼 상자
function boundingBox(polygons: Polygon[]): Bounds {
    const vertices = polygons.flat() // 모든 다각형의 꼭짓점
    return [
        Math.min(...vertices.map((vertex) => vertex[0])),
        Math.min(...vertices.map((vertex) => vertex[1])),
        Math.max(...vertices.map((vertex) => vertex[0])),
        Math.max(...vertices.map((vertex) => vertex[1]))
    ]
}

const J_POLYGONS = pathPolygons(MONOGRAM_J.d, MONOGRAM_J.width, MONOGRAM_J.height, { x: 5, y: 4.5, size: 19 }) // 종이 안쪽에 맞춰 넣은 J의 다각형

// 종이 + 먹색 테두리 + 블랙레터 J (앱 아이콘과 같은 구성)
// 먹색 사각형 위에 조금 작은 종이색 사각형을 겹쳐 테두리를 만들고, 그 위에 J를 그림
const PAPER_SHAPES: Shape[] = [
    { kind: 'rect', left: 2, top: 2, right: 30, bottom: 30, cornerRadius: 5, color: INK },
    { kind: 'rect', left: 4.5, top: 4.5, right: 27.5, bottom: 27.5, cornerRadius: 3, color: PAPER },
    { kind: 'path', polygons: J_POLYGONS, boldOffset: 0.45, color: INK, bounds: boundingBox(J_POLYGONS) }
]

// 오른쪽 아래 배지 (종이색 테두리로 아이콘과 떼어 보이게 함)
function badgeShapes(state: TrayState): Shape[] {
    const badgeCenter = 25.5 // 배지 중심의 x · y (모서리에 작게 둬서 J를 가리지 않음)
    const paperRing: Shape = { kind: 'circle', centerX: badgeCenter, centerY: badgeCenter, radius: 6.5, color: PAPER } // 배지 둘레의 종이색 테두리
    const colorDot = (color: Rgb): Shape => ({ kind: 'circle', centerX: badgeCenter, centerY: badgeCenter, radius: 5.2, color }) // 상태 색으로 채운 원
    switch (state) {
        case 'idle':
            // 대기: 배지 없음
            return []
        case 'busy':
            // 속이 빈 원: 진행 중
            return [paperRing, colorDot(INK), { kind: 'circle', centerX: badgeCenter, centerY: badgeCenter, radius: 3, color: PAPER }]
        case 'new':
            // 강조색 원: 새 브리핑
            return [paperRing, colorDot(ACCENT)]
        case 'offline':
            // 회색 원: 네트워크 연결 대기
            return [paperRing, colorDot(GREY)]
        case 'error':
            // 빨간 원 안의 흰 느낌표 (막대 + 점)
            return [
                paperRing,
                colorDot(DANGER),
                { kind: 'rect', left: 24.6, top: 22, right: 26.4, bottom: 26.2, color: WHITE },
                { kind: 'rect', left: 24.6, top: 27.2, right: 26.4, bottom: 29, color: WHITE }
            ]
    }
}

const SAMPLES_PER_AXIS = 4 // 픽셀 하나를 가로 · 세로로 몇 점씩 찍어 볼지

// 모양 목록을 size×size RGBA로 그려 PNG로 만듦 (뒤에 오는 모양이 위에 그려짐)
function rasterize(shapes: Shape[], size: number): Buffer {
    const gridUnitsPerPixel = 32 / size // 픽셀 하나가 32칸 좌표에서 차지하는 길이
    const rowByteLength = size * 4 + 1 // 한 줄: 필터 1바이트 + 픽셀마다 RGBA 4바이트
    const scanlines = Buffer.alloc(rowByteLength * size) // 모든 줄을 이어 붙인 픽셀 데이터 (0으로 채워져 있어 안 칠한 곳은 투명)
    for (let pixelY = 0; pixelY < size; pixelY++) {
        const rowOffset = pixelY * rowByteLength // 이 줄이 시작하는 위치
        scanlines[rowOffset] = 0 // PNG filter: none
        for (let pixelX = 0; pixelX < size; pixelX++) {
            // 모양에 덮인 점들의 색 합계와 개수
            let redSum = 0
            let greenSum = 0
            let blueSum = 0
            let coveredSampleCount = 0

            // 픽셀 안에 고르게 4×4 점을 찍어 점마다 어떤 모양에 덮였는지 확인
            for (let sampleRow = 0; sampleRow < SAMPLES_PER_AXIS; sampleRow++) {
                for (let sampleColumn = 0; sampleColumn < SAMPLES_PER_AXIS; sampleColumn++) {
                    // 점의 위치 (32칸 좌표)
                    const x = (pixelX + (sampleColumn + 0.5) / SAMPLES_PER_AXIS) * gridUnitsPerPixel
                    const y = (pixelY + (sampleRow + 0.5) / SAMPLES_PER_AXIS) * gridUnitsPerPixel
                    // 맨 위(목록의 뒤)부터 찾아 처음 덮는 모양의 색을 씀
                    for (let shapeIndex = shapes.length - 1; shapeIndex >= 0; shapeIndex--) {
                        const shape = shapes[shapeIndex]!
                        if (covers(shape, x, y)) {
                            redSum += shape.color[0]
                            greenSum += shape.color[1]
                            blueSum += shape.color[2]
                            coveredSampleCount++
                            break
                        }
                    }
                }
            }

            // 픽셀 색: 덮인 점들의 평균 색 (하나도 안 덮였으면 색을 쓰지 않음)
            const pixelOffset = rowOffset + 1 + pixelX * 4 // 이 픽셀의 RGBA가 시작하는 위치
            if (coveredSampleCount > 0) {
                scanlines[pixelOffset] = Math.round(redSum / coveredSampleCount)
                scanlines[pixelOffset + 1] = Math.round(greenSum / coveredSampleCount)
                scanlines[pixelOffset + 2] = Math.round(blueSum / coveredSampleCount)
            }
            // 덮인 점의 비율이 불투명도 (가장자리가 부드러워짐)
            scanlines[pixelOffset + 3] = Math.round((coveredSampleCount / (SAMPLES_PER_AXIS * SAMPLES_PER_AXIS)) * 255)
        }
    }
    return encodePng(scanlines, size)
}

// PNG 조각 하나 생성 (길이 + 종류 + 내용 + CRC)
function pngChunk(chunkType: string, chunkData: Buffer): Buffer {
    // 내용의 길이 (4바이트)
    const lengthField = Buffer.alloc(4)
    lengthField.writeUInt32BE(chunkData.length)

    // 종류 이름 + 내용, 그리고 그 둘의 CRC (4바이트)
    const typeAndData = Buffer.concat([Buffer.from(chunkType, 'ascii'), chunkData])
    const crcField = Buffer.alloc(4)
    crcField.writeUInt32BE(crc32(typeAndData))
    return Buffer.concat([lengthField, typeAndData, crcField])
}

// 줄 단위 RGBA 데이터를 size×size PNG 파일 내용으로 변환
function encodePng(scanlines: Buffer, size: number): Buffer {
    // 머리 조각(IHDR)의 내용: 가로 · 세로 크기와 픽셀 형식
    const headerData = Buffer.alloc(13)
    headerData.writeUInt32BE(size, 0)
    headerData.writeUInt32BE(size, 4)
    headerData[8] = 8 // bit depth
    headerData[9] = 6 // RGBA

    // PNG 파일: 고정 머리글 + 머리 조각 + 압축한 픽셀 조각 + 끝 조각
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', headerData),
        pngChunk('IDAT', deflateSync(scanlines)),
        pngChunk('IEND', Buffer.alloc(0))
    ])
}

const ICON_SIZES = [16, 20, 24, 32] // Windows 화면 배율 100% · 125% · 150% · 200%에 맞는 크기 (px)

/**
 * 상태별 트레이 아이콘을 PNG로 그리기
 *
 * - 테스트 · 미리보기용으로도 사용
 *
 * @param {TrayState} state - 앱 상태 (배지 모양을 정함)
 * @param {number} size - 한 변의 픽셀 수
 * @returns {Buffer} PNG 파일 내용
 */
export function trayIconPng(state: TrayState, size: number): Buffer {
    return rasterize([...PAPER_SHAPES, ...badgeShapes(state)], size)
}

const iconCache = new Map<TrayState, NativeImage>() // 상태별로 한 번 그린 아이콘

/**
 * 상태별 트레이 아이콘 (화면 배율별 크기를 모두 담은 이미지)
 *
 * - 한 번 그린 아이콘은 다시 그리지 않음
 *
 * @param {TrayState} state - 앱 상태
 * @returns {NativeImage} 트레이에 넣을 이미지
 */
export function trayIcon(state: TrayState): NativeImage {
    // 이미 그린 상태면 그대로 사용
    let icon = iconCache.get(state)
    if (!icon) {
        // 처음 쓰는 상태 → 크기별로 그려 한 이미지에 담고 기억해 둠 (16px이 배율 1)
        icon = nativeImage.createEmpty()
        for (const size of ICON_SIZES) {
            icon.addRepresentation({ scaleFactor: size / 16, width: size, height: size, buffer: trayIconPng(state, size) })
        }
        iconCache.set(state, icon)
    }
    return icon
}
