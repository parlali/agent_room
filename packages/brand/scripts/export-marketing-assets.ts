import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const marketingRoot = join(packageRoot, 'exports/marketing')

type Color = {
    r: number
    g: number
    b: number
    a: number
}

type Point = {
    x: number
    y: number
}

const colors = {
    ink: hex('#151816'),
    paper: hex('#faf9f4'),
    accent: hex('#2f6fed'),
}

const markPoints: Point[] = [
    { x: 315, y: 792 },
    { x: 315, y: 356 },
    { x: 512, y: 232 },
    { x: 709, y: 356 },
    { x: 709, y: 792 },
    { x: 575, y: 792 },
    { x: 575, y: 792 },
    { x: 439, y: 792 },
    { x: 439, y: 479 },
    { x: 575, y: 479 },
]

const crcTable = new Uint32Array(256)

for (let index = 0; index < crcTable.length; index += 1) {
    let value = index

    for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }

    crcTable[index] = value >>> 0
}

await mkdir(marketingRoot, { recursive: true })
await writeFile(join(marketingRoot, 'og-share.png'), renderOgShare())

console.log(`Generated marketing assets in ${marketingRoot}`)

function renderOgShare(): Buffer {
    const width = 1200
    const height = 630
    const image = new Uint8Array(width * height * 4)

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const index = (y * width + x) * 4
            const gradient = colors.paper

            image[index] = gradient.r
            image[index + 1] = gradient.g
            image[index + 2] = gradient.b
            image[index + 3] = 255
        }
    }

    const markSize = 220
    const markX = 96
    const markY = 120

    stampMark(image, width, height, markX, markY, markSize, colors.ink)

    fillRect(image, width, height, 96, 390, 760, 8, colors.ink)
    fillRect(image, width, height, 96, 430, 520, 8, colors.accent)

    return encodePng(width, height, image)
}

function stampMark(
    image: Uint8Array,
    width: number,
    height: number,
    originX: number,
    originY: number,
    size: number,
    color: Color,
) {
    const strokeRadius = 36
    const feather = 1024 / size

    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const targetX = originX + x
            const targetY = originY + y

            if (targetX < 0 || targetY < 0 || targetX >= width || targetY >= height) {
                continue
            }

            const canvasX = ((x + 0.5) / size) * 1024
            const canvasY = ((y + 0.5) / size) * 1024
            const distance = distanceToMark(canvasX, canvasY)
            const coverage = clamp((strokeRadius + feather - distance) / (2 * feather), 0, 1)

            if (coverage <= 0) {
                continue
            }

            const index = (targetY * width + targetX) * 4
            const pixel = blend(
                {
                    r: image[index]!,
                    g: image[index + 1]!,
                    b: image[index + 2]!,
                    a: 1,
                },
                color,
                coverage,
            )

            image[index] = pixel.r
            image[index + 1] = pixel.g
            image[index + 2] = pixel.b
        }
    }
}

function fillRect(
    image: Uint8Array,
    width: number,
    height: number,
    left: number,
    top: number,
    rectWidth: number,
    rectHeight: number,
    color: Color,
) {
    for (let y = top; y < top + rectHeight; y += 1) {
        for (let x = left; x < left + rectWidth; x += 1) {
            if (x < 0 || y < 0 || x >= width || y >= height) {
                continue
            }

            paintPixel(image, width, x, y, color)
        }
    }
}

function paintPixel(image: Uint8Array, width: number, x: number, y: number, color: Color) {
    const index = (y * width + x) * 4

    image[index] = color.r
    image[index + 1] = color.g
    image[index + 2] = color.b
    image[index + 3] = 255
}

function distanceToMark(x: number, y: number): number {
    let distance = Number.POSITIVE_INFINITY

    for (let index = 0; index < markPoints.length - 1; index += 1) {
        distance = Math.min(
            distance,
            distanceToSegment({ x, y }, markPoints[index]!, markPoints[index + 1]!),
        )
    }

    return distance
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy

    if (lengthSquared === 0) {
        return Math.hypot(point.x - start.x, point.y - start.y)
    }

    const projection = clamp(
        ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
        0,
        1,
    )
    const closestX = start.x + projection * dx
    const closestY = start.y + projection * dy

    return Math.hypot(point.x - closestX, point.y - closestY)
}

function blend(base: Color, overlay: Color, amount: number): Color {
    const alpha = clamp(amount, 0, 1)

    return {
        r: Math.round(base.r * (1 - alpha) + overlay.r * alpha),
        g: Math.round(base.g * (1 - alpha) + overlay.g * alpha),
        b: Math.round(base.b * (1 - alpha) + overlay.b * alpha),
        a: 1,
    }
}

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
    const raw = Buffer.alloc((width * 4 + 1) * height)

    for (let y = 0; y < height; y += 1) {
        const sourceStart = y * width * 4
        const targetStart = y * (width * 4 + 1)

        raw[targetStart] = 0
        Buffer.from(rgba.buffer, rgba.byteOffset + sourceStart, width * 4).copy(
            raw,
            targetStart + 1,
        )
    }

    const header = Buffer.alloc(13)
    header.writeUInt32BE(width, 0)
    header.writeUInt32BE(height, 4)
    header[8] = 8
    header[9] = 6
    header[10] = 0
    header[11] = 0
    header[12] = 0

    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
    ])
}

function chunk(type: string, data: Buffer): Buffer {
    const typeBuffer = Buffer.from(type)
    const length = Buffer.alloc(4)
    const crc = Buffer.alloc(4)
    const payload = Buffer.concat([typeBuffer, data])

    length.writeUInt32BE(data.length, 0)
    crc.writeUInt32BE(crc32(payload), 0)

    return Buffer.concat([length, payload, crc])
}

function crc32(buffer: Buffer): number {
    let value = 0xffffffff

    for (const byte of buffer) {
        value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8)
    }

    return (value ^ 0xffffffff) >>> 0
}

function hex(value: string): Color {
    const clean = value.replace('#', '')

    return {
        r: parseInt(clean.slice(0, 2), 16),
        g: parseInt(clean.slice(2, 4), 16),
        b: parseInt(clean.slice(4, 6), 16),
        a: 1,
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
}
