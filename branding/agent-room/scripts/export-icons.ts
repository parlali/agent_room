import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

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

type ExportSpec = {
    path: string
    size: number
    foreground: Color
    background: Color
}

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const colors = {
    ink: hex('#151816'),
    paper: hex('#faf9f4'),
    night: hex('#111411'),
    white: hex('#ffffff'),
    transparent: { r: 0, g: 0, b: 0, a: 0 },
}

const points: Point[] = [
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

const markSizes = [16, 24, 32, 48, 64, 96, 128, 180, 192, 256, 384, 512, 1024]

const iosSizes = [20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 1024]

const androidSizes = [36, 48, 72, 96, 144, 192, 512]

const exportSpecs: ExportSpec[] = [
    ...markSizes.map((size) => ({
        path: `exports/mark/agent-room-mark-${size}x${size}.png`,
        size,
        foreground: colors.ink,
        background: colors.transparent,
    })),
    ...markSizes.map((size) => ({
        path: `exports/mark/agent-room-mark-light-${size}x${size}.png`,
        size,
        foreground: colors.paper,
        background: colors.transparent,
    })),
    ...[16, 32, 48, 64].map((size) => ({
        path: `exports/favicon/favicon-${size}x${size}.png`,
        size,
        foreground: colors.ink,
        background: colors.transparent,
    })),
    {
        path: 'exports/web/apple-touch-icon.png',
        size: 180,
        foreground: colors.ink,
        background: colors.paper,
    },
    {
        path: 'exports/web/android-chrome-192x192.png',
        size: 192,
        foreground: colors.ink,
        background: colors.paper,
    },
    {
        path: 'exports/web/android-chrome-512x512.png',
        size: 512,
        foreground: colors.ink,
        background: colors.paper,
    },
    {
        path: 'exports/web/maskable-icon-192x192.png',
        size: 192,
        foreground: colors.ink,
        background: colors.paper,
    },
    {
        path: 'exports/web/maskable-icon-512x512.png',
        size: 512,
        foreground: colors.ink,
        background: colors.paper,
    },
    {
        path: 'exports/master/agent-room-logo-1024x1024.png',
        size: 1024,
        foreground: colors.ink,
        background: colors.transparent,
    },
    {
        path: 'exports/master/agent-room-app-icon-light-1024x1024.png',
        size: 1024,
        foreground: colors.ink,
        background: colors.paper,
    },
    {
        path: 'exports/master/agent-room-app-icon-dark-1024x1024.png',
        size: 1024,
        foreground: colors.paper,
        background: colors.night,
    },
    ...iosSizes.map((size) => ({
        path: `exports/ios/app-icon-${size}x${size}.png`,
        size,
        foreground: colors.ink,
        background: colors.paper,
    })),
    ...androidSizes.map((size) => ({
        path: `exports/android/mipmap-${size}x${size}.png`,
        size,
        foreground: colors.ink,
        background: colors.paper,
    })),
    ...androidSizes.map((size) => ({
        path: `exports/android/mipmap-dark-${size}x${size}.png`,
        size,
        foreground: colors.paper,
        background: colors.night,
    })),
]

const crcTable = new Uint32Array(256)

for (let index = 0; index < crcTable.length; index += 1) {
    let value = index

    for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }

    crcTable[index] = value >>> 0
}

const generated = new Map<string, Buffer>()

await mkdir(join(packageRoot, 'exports/favicon'), { recursive: true })
await writeFile(
    join(packageRoot, 'exports/favicon/favicon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path d="M315 792V356L512 232L709 356V792H575M575 792H439V479H575" fill="none" stroke="#151816" stroke-width="72" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`,
)

for (const spec of exportSpecs) {
    const outputPath = join(packageRoot, spec.path)
    const buffer = renderIcon(spec)

    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, buffer)
    generated.set(spec.path, buffer)
}

await writeFile(
    join(packageRoot, 'exports/favicon/favicon.ico'),
    createIco([
        generated.get('exports/favicon/favicon-16x16.png')!,
        generated.get('exports/favicon/favicon-32x32.png')!,
        generated.get('exports/favicon/favicon-48x48.png')!,
    ]),
)

console.log(
    `Generated ${exportSpecs.length + 2} branding assets in ${join(packageRoot, 'exports')}`,
)

function hex(value: string): Color {
    const clean = value.replace('#', '')

    return {
        r: parseInt(clean.slice(0, 2), 16),
        g: parseInt(clean.slice(2, 4), 16),
        b: parseInt(clean.slice(4, 6), 16),
        a: 1,
    }
}

function renderIcon(spec: ExportSpec): Buffer {
    const image = new Uint8Array(spec.size * spec.size * 4)
    const strokeRadius = 36
    const feather = 1024 / spec.size

    for (let y = 0; y < spec.size; y += 1) {
        for (let x = 0; x < spec.size; x += 1) {
            const index = (y * spec.size + x) * 4
            const canvasX = ((x + 0.5) / spec.size) * 1024
            const canvasY = ((y + 0.5) / spec.size) * 1024
            const distance = distanceToMark(canvasX, canvasY)
            const coverage = clamp((strokeRadius + feather - distance) / (2 * feather), 0, 1)
            const pixel = composite(spec.foreground, coverage, spec.background)

            image[index] = pixel.r
            image[index + 1] = pixel.g
            image[index + 2] = pixel.b
            image[index + 3] = pixel.a
        }
    }

    return encodePng(spec.size, spec.size, image)
}

function distanceToMark(x: number, y: number): number {
    let distance = Number.POSITIVE_INFINITY

    for (let index = 0; index < points.length - 1; index += 1) {
        distance = Math.min(distance, distanceToSegment({ x, y }, points[index], points[index + 1]))
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

function composite(foreground: Color, coverage: number, background: Color): Color {
    const foregroundAlpha = foreground.a * coverage
    const backgroundAlpha = background.a * (1 - foregroundAlpha)
    const alpha = foregroundAlpha + backgroundAlpha

    if (alpha === 0) {
        return { r: 0, g: 0, b: 0, a: 0 }
    }

    return {
        r: Math.round((foreground.r * foregroundAlpha + background.r * backgroundAlpha) / alpha),
        g: Math.round((foreground.g * foregroundAlpha + background.g * backgroundAlpha) / alpha),
        b: Math.round((foreground.b * foregroundAlpha + background.b * backgroundAlpha) / alpha),
        a: Math.round(alpha * 255),
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

function createIco(images: Buffer[]): Buffer {
    const header = Buffer.alloc(6)
    const directory = Buffer.alloc(images.length * 16)
    const parts = [header, directory, ...images]
    let offset = 6 + images.length * 16

    header.writeUInt16LE(0, 0)
    header.writeUInt16LE(1, 2)
    header.writeUInt16LE(images.length, 4)

    images.forEach((image, index) => {
        const size = [16, 32, 48][index]
        const entryOffset = index * 16

        directory[entryOffset] = size
        directory[entryOffset + 1] = size
        directory[entryOffset + 2] = 0
        directory[entryOffset + 3] = 0
        directory.writeUInt16LE(1, entryOffset + 4)
        directory.writeUInt16LE(32, entryOffset + 6)
        directory.writeUInt32LE(image.length, entryOffset + 8)
        directory.writeUInt32LE(offset, entryOffset + 12)

        offset += image.length
    })

    return Buffer.concat(parts)
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
}
