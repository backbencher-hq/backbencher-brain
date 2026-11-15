#!/usr/bin/env npx tsx
/**
 * EMISSION CENSUS — the four extended types' EMITTED edges and FILES, whole population.
 *
 * The construct census (`census-extended-constructs.ts`) answers "how many sites does the
 * language present". This instrument answers the other half of the measurement: "how many
 * edges does the ANALYZER publish, in how many files", over the same gate-admitted
 * population — so a construct site and its published edge can be set beside each other
 * rather than assumed to agree (cpp measured a 4,612-row gap between those two counts).
 *
 * It runs the production `parseFile` (the analyzer), not the raw parser, and counts edges
 * by `type` with the FILES that carry them. `degraded`/failure counts are declared because
 * a parse that silently fell back emits fewer edges with no error.
 *
 * Run: BB_CORPUS_ROOT=$PWD/.corpus npx tsx validation/m14/fixtures/r/emission-census.ts
 * Artifact: validation/m14/fixtures/r/measurements/r-emission-census.txt
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { extensionsFor } from "../../../../script/m14/language-extensions"

const T0 = Date.now()
const loadAtStart = os.loadavg()
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ARTIFACT = path.resolve(HERE, "measurements", "r-emission-census.txt")

// The gate's admission predicate, copied from script/m14/incoming-gate.ts:367.
const LANE = "r"
const EXTS = extensionsFor(LANE).map((e) => e.replace(/^\./, ""))
const SIZE_CAP = 1024 * 1024
function admit(rel: string): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (EXTS.some((e) => low.endsWith(`.${e}`))) return true
  return EXTS.some((e) => base === e) && detectLanguageFromPath(rel) === LANE
}

const files: string[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!admit(rel)) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    files.push(abs)
  }
}
files.sort()
const corpusDigest = createHash("sha256").update(files.join("\n")).digest("hex")

const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates", "decorates", "renders", "mixes_in", "part_of"]
const edges = new Map<string, number>(TYPES.map((t) => [t, 0]))
const fileCount = new Map<string, number>(TYPES.map((t) => [t, 0]))
const subTypes = new Map<string, number>()
let parsed = 0, degraded = 0, failures = 0
const trapLines: string[] = []
const origWrite = process.stderr.write.bind(process.stderr)
process.stderr.write = ((chunk: any, ...rest: any[]) => {
  const s = String(chunk)
  if (s.includes("[BB-PARSE-ERR]")) trapLines.push(s.trim())
  return origWrite(chunk, ...rest)
}) as any

const WORKERS = Number(process.env.BB_R_WORKERS ?? "4")
let cursor = 0
async function worker() {
  while (cursor < files.length) {
    const f = files[cursor++]
    let r: any
    try { r = await parseFile(f, "r") } catch { failures++; continue }
    if (r?.fallback === true || r?.metadata?.fallback === true) degraded++
    parsed++
    const seen = new Set<string>()
    for (const rel of Array.isArray(r?.relationships) ? r.relationships : []) {
      const t = String(rel?.type ?? "")
      if (edges.has(t)) edges.set(t, (edges.get(t) ?? 0) + 1)
      else edges.set(t, 1)
      if (TYPES.includes(t)) {
        seen.add(t)
        const st = `${t}:${String(rel?.metadata?.relationshipSubType ?? "(none)")}`
        subTypes.set(st, (subTypes.get(st) ?? 0) + 1)
      }
    }
    for (const t of seen) fileCount.set(t, (fileCount.get(t) ?? 0) + 1)
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

const out: string[] = []
out.push("=".repeat(78))
out.push("EMISSION CENSUS — emitted edges and files per relationship type, whole admitted R population")
out.push("=".repeat(78))
out.push(`node ${process.version}   workers ${WORKERS}   cores ${os.cpus().length}`)
out.push(`load at start: ${loadAtStart.map((n) => n.toFixed(2)).join(" ")}`)
out.push(`corpus root: ${CR}`)
out.push(`admission: the GATE's predicate (script/m14/incoming-gate.ts:367) — .${EXTS.join(", .")} + bare basename clause, SIZE_CAP ${SIZE_CAP} B`)
out.push(`admitted files [0,${files.length}) of ${files.length}`)
out.push(`corpus file set: sha256 ${corpusDigest} (${files.length} absolute paths, sorted)`)
out.push(`parsed: ${parsed}   degraded (regex fallback): ${degraded}   failures: ${failures}   traps: ${trapLines.length}`)
for (const t of trapLines) out.push(`  TRAP ${t}`)
out.push(`wall time: ${Date.now() - T0}ms`)
out.push("")
out.push("type            edges    files")
out.push("-".repeat(34))
for (const t of TYPES) out.push(`${t.padEnd(15)} ${String(edges.get(t) ?? 0).padStart(6)} ${String(fileCount.get(t) ?? 0).padStart(8)}`)
out.push("")
out.push("SUBTYPES of the extended four (how each edge was classified):")
for (const [k, v] of [...subTypes.entries()].filter(([k]) => /^(mixes_in|part_of|decorates|renders):/.test(k)).sort()) {
  out.push(`  ${k.padEnd(48)} ${String(v).padStart(5)}`)
}
out.push("=".repeat(78))
const report = out.join("\n") + "\n"
writeFileSync(ARTIFACT, report)
origWrite(report)
process.on("exit", (code) => origWrite(`EXIT code=${code} after ${Date.now() - T0}ms\n`))
process.exitCode = 0
