/**
 * ARE THE `imports`/`references` TARGETS ALL PATHS? — the ruling, with its count.
 *
 * The incoming gate reads `9 unresolved imports + 9 unresolved references` on `bash sh 60` and
 * cannot resolve any of them. That is not a gap to chase: the gate's key space holds SYMBOLS
 * (`parseFile(...).symbols` keyed by name and qualifiedName), and a `source`/`.` operand is a
 * FILESYSTEM PATH — BD9 publishes it verbatim, de-quoted, exactly as the shell will read it.
 * A path is not a symbol, so those edges cannot resolve in that key space by construction.
 *
 * This file measures the claim instead of asserting it: every `imports`/`references` target on
 * the gate's own population, classified by SHAPE on the tree — dynamic (contains an expansion),
 * relative path, absolute path, or a bare filename — and cross-checked against the edge's own
 * `resolution` metadata, which BD9 sets to `dynamic` for a path no analyzer can resolve.
 *
 * A single non-path target would overturn the ruling and is printed as `NOT PATH-SHAPED`.
 *
 * Read-only. CLI: npx tsx validation/m14/fixtures/bash/probe-bash-source-path-shapes.mts [--nf 60]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const REPO_ROOT = path.join(import.meta.dirname, "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const NF = Number(process.argv.includes("--nf") ? process.argv[process.argv.indexOf("--nf") + 1] : 60)
const EXT = "sh"
const SIZE_CAP = 1024 * 1024

// The gate's discovery: git checkouts, `git ls-files`, extension, size cap, sorted, STRIDE.
const found: string[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(`.${EXT}`)) continue
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size <= SIZE_CAP) found.push(abs)
    } catch {
      /* absent */
    }
  }
}
found.sort()
let files = found
if (found.length > NF) {
  const stride = Math.max(1, Math.floor(found.length / NF))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < NF; i += stride) picked.push(found[i])
  files = picked
}
const repoOf = (f: string): string => path.relative(CR, f).split(path.sep)[0]

const { parseFile } = await import(`${REPO_ROOT}/src/ast/pool-worker.ts`)
type Row = { type: string; target: string; repo: string; resolution: unknown; form: unknown }
const rows: Row[] = []
for (const f of files) {
  let r: any
  try {
    r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any)
  } catch {
    continue
  }
  if (!r) continue
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const t = String(rel?.type ?? rel?.relationshipType ?? "")
    if (t !== "imports" && t !== "references") continue
    rows.push({ type: t, target: String(rel?.target ?? ""), repo: repoOf(f), resolution: rel?.metadata?.resolution, form: rel?.metadata?.importForm })
  }
}

/** Shape by character scan (the lane forbids regex literals). */
const hasExpansion = (s: string): boolean => s.includes("$") || s.includes("`")
const isAbsolute = (s: string): boolean => s.length > 0 && s.charCodeAt(0) === 47 /* / */
const hasSlash = (s: string): boolean => s.includes("/")
const hasShellExtension = (s: string): boolean => {
  const i = s.lastIndexOf(".")
  if (i <= 0) return false
  const ext = s.slice(i)
  return ext === ".sh" || ext === ".bash" || ext === ".zsh" || ext === ".inc" || ext === ".lib" || ext === ".env"
}
const shapeOf = (s: string): string => {
  if (!hasSlash(s) && !hasShellExtension(s) && !hasExpansion(s)) return "NOT PATH-SHAPED (identifier)"
  if (hasExpansion(s) && hasSlash(s)) return "dynamic path (expansion + separator)"
  if (hasExpansion(s)) return "dynamic (expansion decides the path)"
  if (isAbsolute(s)) return "absolute path"
  if (hasSlash(s)) return "relative path"
  return "bare filename with a shell extension"
}

const byShape = new Map<string, { edges: number; names: Set<string>; examples: string[] }>()
for (const r of rows) {
  const s = shapeOf(r.target)
  let a = byShape.get(s)
  if (!a) byShape.set(s, (a = { edges: 0, names: new Set(), examples: [] }))
  a.edges++
  a.names.add(r.target)
  if (a.examples.length < 4) a.examples.push(r.target)
}
console.log(`SOURCE/. TARGET SHAPES — ${files.length} sampled of ${found.length} tracked .${EXT} files in the gate's population`)
console.log(`  imports/references edges: ${rows.length}   distinct targets: ${new Set(rows.map((r) => r.target)).size}`)
for (const [shape, a] of [...byShape.entries()].sort((x, y) => y[1].edges - x[1].edges)) {
  console.log(`  ${String(a.edges).padStart(4)} edges / ${String(a.names.size).padStart(2)} names  ${shape}`)
  console.log(`        e.g. ${a.examples.join(", ")}`)
}
const identifierShaped = rows.filter((r) => shapeOf(r.target).startsWith("NOT PATH-SHAPED"))
console.log("")
console.log(
  identifierShaped.length === 0
    ? `RULING HOLDS — every one of the ${rows.length} edges names a PATH (or an expansion that decides one). The gate's key space is SYMBOLS, so none of them can resolve in it by construction.`
    : `RULING FALSIFIED — ${identifierShaped.length} target(s) are identifier-shaped: ${identifierShaped.map((r) => r.target).join(", ")}`,
)
console.log(`BD9 metadata check: edges carrying resolution="dynamic": ${rows.filter((r) => r.resolution === "dynamic").length} of ${rows.length}`)
