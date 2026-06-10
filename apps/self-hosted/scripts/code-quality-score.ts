import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve } from 'node:path'

type SourceFile = {
    path: string
    lines: string[]
    lineCount: number
    kind: 'source' | 'test' | 'generated'
    area: 'routes' | 'components' | 'lib' | 'server' | 'scripts' | 'other'
}

type DuplicateProfile = {
    name: string
    files: SourceFile[]
    minLines: number
    minTokens: number
}

type DuplicateResult = {
    cloneGroups: number
    duplicatedLines: number
    totalLines: number
    duplicatedLinePercent: number
}

type Graph = Map<string, Set<string>>

type ModuleOwnershipHotspot = {
    path: string
    lines: number
    branchCount: number
    branchDensity: number
    fanOut: number
    fanIn: number
    reasons: string[]
}

const root = process.cwd()
const sourceRoots = ['src', 'scripts']
const sourceExtensions = ['.ts', '.tsx']

function isSourcePath(path: string): boolean {
    return sourceExtensions.some((extension) => path.endsWith(extension))
}

function walk(directory: string): string[] {
    if (!existsSync(directory)) {
        return []
    }

    return readdirSync(directory).flatMap((name) => {
        const path = join(directory, name)
        const stat = statSync(path)

        if (stat.isDirectory()) {
            if (['node_modules', 'dist', '.git', '.agent-room'].includes(name)) {
                return []
            }

            return walk(path)
        }

        return [path]
    })
}

function classifyKind(path: string): SourceFile['kind'] {
    if (path.endsWith('.gen.ts') || path.endsWith('.gen.tsx')) {
        return 'generated'
    }

    if (path.includes('.test.') || path.includes('.spec.')) {
        return 'test'
    }

    return 'source'
}

function classifyArea(path: string): SourceFile['area'] {
    if (path.startsWith('src/routes/')) {
        return 'routes'
    }

    if (path.startsWith('src/components/')) {
        return 'components'
    }

    if (path.startsWith('src/lib/')) {
        return 'lib'
    }

    if (path.startsWith('src/server/')) {
        return 'server'
    }

    if (path.startsWith('scripts/')) {
        return 'scripts'
    }

    return 'other'
}

function isRouteServerFunctionPath(path: string): boolean {
    return /^src\/routes\/-[^/]+-server\.ts$/.test(path)
}

function readSourceFiles(): SourceFile[] {
    return sourceRoots
        .flatMap(walk)
        .filter(isSourcePath)
        .map((path) => {
            const normalizedPath = path.split('\\').join('/')
            const text = readFileSync(path, 'utf8')
            const lines = sourceLines(text)

            return {
                path: normalizedPath,
                lines,
                lineCount: lines.length,
                kind: classifyKind(normalizedPath),
                area: classifyArea(normalizedPath),
            }
        })
}

function sourceLines(text: string): string[] {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const withoutFinalNewline = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
    return withoutFinalNewline ? withoutFinalNewline.split('\n') : []
}

function scoreFromPenalty(base: number, penalty: number): number {
    return Math.max(0, Math.min(100, Math.round(base - penalty)))
}

function countPattern(files: SourceFile[], pattern: RegExp): number {
    return files.reduce((total, file) => {
        const text = file.lines.join('\n')
        return total + Array.from(text.matchAll(pattern)).length
    }, 0)
}

function normalizedLine(line: string): string {
    return line
        .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, 'STR')
        .replace(/\b\d+(?:\.\d+)?\b/g, 'NUM')
        .replace(/\s+/g, ' ')
        .trim()
}

function tokenCount(text: string): number {
    return (
        text.match(/[A-Za-z_$][A-Za-z0-9_$]*|\d+|===|!==|=>|&&|\|\||[{}()[\].,:?+\-*/%<>]/g)
            ?.length ?? 0
    )
}

function duplicateScan(profile: DuplicateProfile): DuplicateResult {
    const windows = new Map<string, Array<{ path: string; start: number; end: number }>>()
    const totalLines = profile.files.reduce((total, file) => total + file.lineCount, 0)

    for (const file of profile.files) {
        const normalizedLines = file.lines.map(normalizedLine)

        for (let start = 0; start <= normalizedLines.length - profile.minLines; start += 1) {
            const windowLines = normalizedLines.slice(start, start + profile.minLines)

            if (windowLines.some((line) => line.length === 0)) {
                continue
            }

            if (windowLines.every((line) => line.startsWith('import '))) {
                continue
            }

            const text = windowLines.join('\n')

            if (tokenCount(text) < profile.minTokens) {
                continue
            }

            const entries = windows.get(text) ?? []
            entries.push({ path: file.path, start, end: start + profile.minLines })
            windows.set(text, entries)
        }
    }

    const duplicatedLineKeys = new Set<string>()
    let cloneGroups = 0

    for (const entries of windows.values()) {
        const paths = new Set(entries.map((entry) => entry.path))

        if (entries.length < 2 || paths.size < 1) {
            continue
        }

        cloneGroups += 1

        for (const entry of entries) {
            for (let line = entry.start; line < entry.end; line += 1) {
                duplicatedLineKeys.add(`${entry.path}:${line}`)
            }
        }
    }

    const duplicatedLines = duplicatedLineKeys.size
    const duplicatedLinePercent = totalLines === 0 ? 0 : (duplicatedLines / totalLines) * 100

    return {
        cloneGroups,
        duplicatedLines,
        totalLines,
        duplicatedLinePercent,
    }
}

function resolveImport(fromPath: string, specifier: string, fileSet: Set<string>): string | null {
    if (!specifier.startsWith('.') && !specifier.startsWith('#/')) {
        return null
    }

    const base = specifier.startsWith('#/')
        ? join(root, 'src', specifier.slice(2))
        : resolve(root, dirname(fromPath), specifier)

    const candidates = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        join(base, 'index.ts'),
        join(base, 'index.tsx'),
    ].map((path) => relative(root, normalize(path)).split('\\').join('/'))

    return candidates.find((candidate) => fileSet.has(candidate)) ?? null
}

function importSpecifiers(text: string): string[] {
    const specifiers: string[] = []
    const pattern = /from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g

    for (const match of text.matchAll(pattern)) {
        const specifier = match[1] ?? match[2]

        if (specifier) {
            specifiers.push(specifier)
        }
    }

    return specifiers
}

function buildGraph(files: SourceFile[]): Graph {
    const graph: Graph = new Map()
    const fileSet = new Set(files.map((file) => file.path))

    for (const file of files) {
        const imports = new Set<string>()
        const text = file.lines.join('\n')

        for (const specifier of importSpecifiers(text)) {
            const target = resolveImport(file.path, specifier, fileSet)

            if (target) {
                imports.add(target)
            }
        }

        graph.set(file.path, imports)
    }

    return graph
}

function stronglyConnectedComponents(graph: Graph): string[][] {
    const indexByNode = new Map<string, number>()
    const lowLinkByNode = new Map<string, number>()
    const stack: string[] = []
    const onStack = new Set<string>()
    const components: string[][] = []
    let index = 0

    function visit(node: string): void {
        indexByNode.set(node, index)
        lowLinkByNode.set(node, index)
        index += 1
        stack.push(node)
        onStack.add(node)

        for (const target of graph.get(node) ?? []) {
            if (!indexByNode.has(target)) {
                visit(target)
                lowLinkByNode.set(
                    node,
                    Math.min(lowLinkByNode.get(node) ?? 0, lowLinkByNode.get(target) ?? 0),
                )
            } else if (onStack.has(target)) {
                lowLinkByNode.set(
                    node,
                    Math.min(lowLinkByNode.get(node) ?? 0, indexByNode.get(target) ?? 0),
                )
            }
        }

        if (lowLinkByNode.get(node) !== indexByNode.get(node)) {
            return
        }

        const component: string[] = []

        while (stack.length > 0) {
            const current = stack.pop()

            if (!current) {
                break
            }

            onStack.delete(current)
            component.push(current)

            if (current === node) {
                break
            }
        }

        if (component.length > 1) {
            components.push(component)
        }
    }

    for (const node of graph.keys()) {
        if (!indexByNode.has(node)) {
            visit(node)
        }
    }

    return components
}

function countLayerViolations(files: SourceFile[], graph: Graph): number {
    const areaByPath = new Map(files.map((file) => [file.path, file.area]))
    let violations = 0

    for (const [from, targets] of graph.entries()) {
        const fromArea = areaByPath.get(from)

        for (const target of targets) {
            const targetArea = areaByPath.get(target)

            if (
                fromArea === 'components' &&
                targetArea === 'routes' &&
                isRouteServerFunctionPath(target)
            ) {
                continue
            }

            if (fromArea === 'components' && ['routes', 'server'].includes(targetArea ?? '')) {
                violations += 1
            }

            if (
                fromArea === 'lib' &&
                ['routes', 'components', 'server'].includes(targetArea ?? '')
            ) {
                violations += 1
            }

            if (fromArea === 'server' && ['routes', 'components'].includes(targetArea ?? '')) {
                violations += 1
            }
        }
    }

    return violations
}

function branchCount(file: SourceFile): number {
    const text = file.lines.join('\n')
    return Array.from(text.matchAll(/\b(if|for|while|switch|catch|case)\b|&&|\|\|/g)).length
}

function fanInCounts(graph: Graph): Map<string, number> {
    const fanIn = new Map<string, number>()
    for (const [file, targets] of graph.entries()) {
        if (!fanIn.has(file)) {
            fanIn.set(file, fanIn.get(file) ?? 0)
        }
        for (const target of targets) {
            fanIn.set(target, (fanIn.get(target) ?? 0) + 1)
        }
    }
    return fanIn
}

function moduleOwnershipHotspots(files: SourceFile[], graph: Graph): ModuleOwnershipHotspot[] {
    const fanIn = fanInCounts(graph)

    return files.flatMap((file) => {
        const branches = branchCount(file)
        const fanOut = graph.get(file.path)?.size ?? 0
        const branchDensity = branches / Math.max(file.lineCount, 1)
        const reasons: string[] = []
        if (file.lineCount > 700 && branches > 45) {
            reasons.push('large_branching_module')
        }
        if (file.lineCount > 500 && fanOut > 18) {
            reasons.push('large_broad_module')
        }
        if (branches > 80) {
            reasons.push('very_branch_heavy')
        }
        if (fanOut > 24) {
            reasons.push('very_high_fan_out')
        }
        if (branches > 55 && fanOut > 15) {
            reasons.push('branching_broad_module')
        }
        if (reasons.length === 0) {
            return []
        }
        return [
            {
                path: file.path,
                lines: file.lineCount,
                branchCount: branches,
                branchDensity,
                fanOut,
                fanIn: fanIn.get(file.path) ?? 0,
                reasons,
            },
        ]
    })
}

function fanMetrics(graph: Graph): {
    highFanOut: number
    highFanIn: number
    maxFanOut: number
    maxFanIn: number
} {
    const fanIn = fanInCounts(graph)
    let highFanOut = 0
    let maxFanOut = 0

    for (const [file, targets] of graph.entries()) {
        maxFanOut = Math.max(maxFanOut, targets.size)

        if (targets.size > 18) {
            highFanOut += 1
        }

        fanIn.set(file, fanIn.get(file) ?? 0)
    }

    let highFanIn = 0
    let maxFanIn = 0

    for (const count of fanIn.values()) {
        maxFanIn = Math.max(maxFanIn, count)

        if (count > 18) {
            highFanIn += 1
        }
    }

    return { highFanOut, highFanIn, maxFanOut, maxFanIn }
}

function round(value: number): number {
    return Math.round(value * 100) / 100
}

function countByArea(files: SourceFile[]): Record<string, number> {
    const counts: Record<string, number> = {}

    for (const file of files) {
        counts[file.area] = (counts[file.area] ?? 0) + 1
    }

    return counts
}

function main(): void {
    const allFiles = readSourceFiles()
    const sourceFiles = allFiles.filter((file) => file.kind === 'source')
    const nonGeneratedFiles = allFiles.filter((file) => file.kind !== 'generated')
    const testFiles = allFiles.filter((file) => file.kind === 'test')
    const graph = buildGraph(sourceFiles)
    const cycles = stronglyConnectedComponents(graph)
    const fan = fanMetrics(graph)
    const layerViolations = countLayerViolations(sourceFiles, graph)
    const productionDuplication = duplicateScan({
        name: 'production',
        files: sourceFiles,
        minLines: 8,
        minTokens: 80,
    })
    const sensitiveDuplication = duplicateScan({
        name: 'sensitive',
        files: nonGeneratedFiles,
        minLines: 3,
        minTokens: 30,
    })
    const over700 = nonGeneratedFiles.filter((file) => file.lineCount > 700)
    const over500 = nonGeneratedFiles.filter((file) => file.lineCount > 500)
    const branchDenseFiles = sourceFiles.filter((file) => {
        const branches = branchCount(file)
        const density = branches / Math.max(file.lineCount, 1)
        return branches > 60 || (branches > 35 && density > 0.08)
    })
    const ownershipHotspots = moduleOwnershipHotspots(sourceFiles, graph)
    const largeOwnershipHotspots = ownershipHotspots.filter((file) =>
        file.reasons.some((reason) => reason.startsWith('large_')),
    )
    const safetyHits = {
        fallback: countPattern(sourceFiles, /\bfallback\b/gi),
        processEnv: countPattern(sourceFiles, /process\.env/g),
        unknownAs: countPattern(sourceFiles, /unknown\s+as/g),
        anyCast: countPattern(sourceFiles, /\bas\s+any\b/g),
    }
    const sourceCountByArea = countByArea(sourceFiles)
    const testCountByArea = countByArea(testFiles)

    const qualitySizePenalty = Math.min(8, largeOwnershipHotspots.length * 0.35)
    const qualityDuplicatePenalty = Math.min(
        8,
        productionDuplication.duplicatedLinePercent * 6 +
            sensitiveDuplication.duplicatedLinePercent * 0.4,
    )
    const qualityCyclePenalty = Math.min(8, cycles.length * 4)
    const qualityCouplingPenalty = Math.min(
        7,
        layerViolations * 0.24 + fan.highFanOut * 0.45 + fan.highFanIn * 0.08,
    )
    const qualityComplexityPenalty = Math.min(
        5,
        branchDenseFiles.length * 0.05 + ownershipHotspots.length * 0.05,
    )
    const qualitySafetyPenalty = Math.min(
        5,
        safetyHits.fallback * 0.01 +
            safetyHits.processEnv * 0.02 +
            safetyHits.unknownAs * 0.1 +
            safetyHits.anyCast * 0.75,
    )
    const qualityTestPenalty = Math.min(
        4,
        sourceFiles.length / Math.max(testFiles.length, 1) > 7 ? 2 : 0,
    )
    const sizePenalty = Math.min(
        25,
        largeOwnershipHotspots.length * 1.25 + ownershipHotspots.length * 0.25,
    )
    const duplicatePenalty = Math.min(
        18,
        productionDuplication.duplicatedLinePercent * 10 +
            sensitiveDuplication.duplicatedLinePercent * 1.2,
    )
    const cyclePenalty = Math.min(10, cycles.length * 5)
    const couplingPenalty = Math.min(
        12,
        layerViolations * 2 + fan.highFanOut * 1.5 + fan.highFanIn * 0.3,
    )
    const complexityPenalty = Math.min(
        12,
        branchDenseFiles.length * 0.3 + ownershipHotspots.length * 0.35,
    )
    const safetyPenalty = Math.min(
        10,
        safetyHits.fallback * 0.04 +
            safetyHits.processEnv * 0.08 +
            safetyHits.unknownAs * 0.2 +
            safetyHits.anyCast * 1,
    )
    const testPenalty = Math.min(6, sourceFiles.length / Math.max(testFiles.length, 1) > 6 ? 3 : 0)
    const rawQuality = scoreFromPenalty(
        100,
        qualitySizePenalty +
            qualityDuplicatePenalty +
            qualityCyclePenalty +
            qualityCouplingPenalty +
            qualityComplexityPenalty +
            qualitySafetyPenalty +
            qualityTestPenalty,
    )
    const qualityScore = rawQuality
    const spaghettiScore = Math.min(
        100,
        Math.round(
            sizePenalty * 0.9 +
                duplicatePenalty * 1.2 +
                cyclePenalty * 1.4 +
                couplingPenalty * 1.3 +
                complexityPenalty * 1.1 +
                safetyPenalty * 0.8,
        ),
    )
    const output = {
        qualityScore,
        spaghettiScore,
        interpretation: {
            quality: 'higher is better',
            spaghetti: 'lower is better',
        },
        metrics: {
            files: {
                source: sourceFiles.length,
                test: testFiles.length,
                generated: allFiles.filter((file) => file.kind === 'generated').length,
                sourceByArea: sourceCountByArea,
                testsByArea: testCountByArea,
            },
            size: {
                over700: over700.map((file) => ({ path: file.path, lines: file.lineCount })),
                over500Count: over500.length,
                ownershipHotspots: ownershipHotspots.map((file) => ({
                    ...file,
                    branchDensity: round(file.branchDensity),
                })),
            },
            duplication: {
                production: {
                    cloneGroups: productionDuplication.cloneGroups,
                    duplicatedLines: productionDuplication.duplicatedLines,
                    duplicatedLinePercent: round(productionDuplication.duplicatedLinePercent),
                },
                sensitive: {
                    cloneGroups: sensitiveDuplication.cloneGroups,
                    duplicatedLines: sensitiveDuplication.duplicatedLines,
                    duplicatedLinePercent: round(sensitiveDuplication.duplicatedLinePercent),
                },
            },
            dependencyGraph: {
                cycles: cycles.map((cycle) => cycle.sort()),
                layerViolations,
                highFanOut: fan.highFanOut,
                highFanIn: fan.highFanIn,
                maxFanOut: fan.maxFanOut,
                maxFanIn: fan.maxFanIn,
            },
            complexity: {
                branchDenseFiles: branchDenseFiles.map((file) => ({
                    path: file.path,
                    branchCount: branchCount(file),
                    lines: file.lineCount,
                })),
            },
            safetyHits,
        },
        penalties: {
            quality: {
                size: round(qualitySizePenalty),
                duplication: round(qualityDuplicatePenalty),
                cycles: round(qualityCyclePenalty),
                coupling: round(qualityCouplingPenalty),
                complexity: round(qualityComplexityPenalty),
                safety: round(qualitySafetyPenalty),
                tests: round(qualityTestPenalty),
            },
            spaghetti: {
                size: round(sizePenalty),
                duplication: round(duplicatePenalty),
                cycles: round(cyclePenalty),
                coupling: round(couplingPenalty),
                complexity: round(complexityPenalty),
                safety: round(safetyPenalty),
                tests: round(testPenalty),
            },
        },
    }

    if (process.argv.includes('--json')) {
        console.log(JSON.stringify(output, null, 4))
        return
    }

    console.log(`Quality score: ${qualityScore}/100`)
    console.log(`Spaghetti score: ${spaghettiScore}/100`)
    console.log('')
    console.log('Top signals:')
    console.log(`- Files over 700 lines: ${over700.length}`)
    console.log(`- Files over 500 lines: ${over500.length}`)
    console.log(`- Production duplication: ${round(productionDuplication.duplicatedLinePercent)}%`)
    console.log(`- Sensitive duplication: ${round(sensitiveDuplication.duplicatedLinePercent)}%`)
    console.log(`- Dependency cycles: ${cycles.length}`)
    console.log(`- Layer violations: ${layerViolations}`)
    console.log(`- High fan-out files: ${fan.highFanOut}`)
    console.log(`- High fan-in files: ${fan.highFanIn}`)
    console.log(`- Branch-dense files: ${branchDenseFiles.length}`)
    console.log(
        `- Safety-sensitive hits: ${Object.values(safetyHits).reduce((total, value) => total + value, 0)}`,
    )
    console.log('')
    console.log('Run with --json for full detail.')
}

main()
