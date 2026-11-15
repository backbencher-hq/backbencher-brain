#!/usr/bin/env npx tsx
/**
 * CENSUS — do `overrides` and `instantiates` FIRE over the whole R corpus?
 *
 * `script/m14/firing-check.mjs R_LANG` reads BOTH as SILENT, and the board's `r 8/10` rests on
 * that reading. A silent type has two possible meanings and the firing instrument cannot tell them
 * apart, because it samples: the analyzer cannot express the construct (a defect), or the
 * population it read does not contain the construct (a ruling). This census is the whole-corpus
 * leg — 2,184 git-tracked `.R` files over 16 repositories, production `parseFile`, no stride.
 *
 * The population is enumerated EXACTLY as `r-b-pair-verify.ts` and `r-ambiguity-attribution.ts`
 * enumerate it (git-tracked, admitted by `detectLanguageFromPath`, <=512 KB), so this run's corpus
 * digest is directly comparable with the Oct-5 artifacts' `953c0314…`.
 *
 * THREE THINGS ARE COUNTED, and they answer different questions:
 *   1. emitted edges per type, and the FILES that emit them — "does the type fire at all".
 *   2. the analyzer's OWN `callAttribution.overridesEdgesEmitted` per file, summed — a cross-check
 *      that the edge count this census measures agrees with the count the analyzer believes it
 *      emitted. They are produced by different code paths and must not silently drift.
 *   3. the analyzer's `overridesBasesNotDeclaredEarlierInFile` — the bases it DECLINED to assert.
 *      Quoted because it sizes the opportunity the file-scoped pass cannot reach, and a completeness
 *      claim that hides its refusals is the thing a census exists to prevent.
 *
 * `degraded` and traps are declared, per HANDOFF §5.1: a degraded parse does not fail, it returns
 * fewer edges with no error, so an edge count without a degraded count is unlabelled.
 *
 * Run: ( flock -w 600 9 || exit 9; npx tsx validation/m14/fixtures/r/census-overrides-instantiates.ts ) 9>.bb-heavy.lock
 */

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

// The ANALYZER REVISION, because a count without it cannot be compared with a later run: the
// `overrides` self-report field was corrected on 2026-10-09 (`overridesEdgesEmitted` now counts
// what the result carries, not the pass's emissions), and the cross-check below reads differently
// before and after that change. The Oct-5 artifacts in this directory print the same line for the
// same reason. The path is resolved from this file so the census is runnable from anywhere.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ANALYZER_PATH = path.resolve(HERE, "..", "..", "..", "..", "src", "ast", "real-r-analyzer.ts")
const analyzerDigest = createHash("sha256").update(readFileSync(ANALYZER_PATH)).digest("hex")

const T0 = Date.now()
const loadAtStart = os.loadavg()
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const WORKERS = Number(process.env.BB_R_WORKERS ?? "4")
const LIMIT = Number(process.env.BB_R_LIMIT ?? "0")

const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]

interface Admitted { repo: string; rel: string; abs: string }
const admitted: Admitted[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "r") continue
    admitted.push({ repo: e, rel, abs })
  }
}
const covered = LIMIT > 0 ? admitted.slice(0, LIMIT) : admitted
const corpusDigest = createHash("sha256").update(covered.map((c) => c.abs).sort().join("\n")).digest("hex")

// Capture the engine's trap lines so a degraded parse is NAMED, not just counted.
const trapLines: string[] = []
const origWrite = process.stderr.write.bind(process.stderr)
process.stderr.write = ((chunk: any, ...rest: any[]) => {
  const s = String(chunk)
  if (s.includes("[BB-PARSE-ERR]")) trapLines.push(s.trim())
  return origWrite(chunk, ...rest)
}) as any

const edgeCount = new Map<string, number>(TYPES.map((t) => [t, 0]))
const fileCount = new Map<string, number>(TYPES.map((t) => [t, 0]))
/** repo -> type -> {edges, files} for the two types under test. */
const perRepo = new Map<string, Map<string, { edges: number; files: number }>>()
let selfReportedOverrides = 0
let declinedBases = 0
let degraded = 0
let failures = 0
let done = 0
let cursor = 0

async function worker(): Promise<void> {
  while (cursor < covered.length) {
    const f = covered[cursor++]
    let r: any
    try {
      r = await parseFile(f.abs, f.repo)
    } catch {
      failures++
      done++
      continue
    }
    if (r?.fallback === true || r?.metadata?.fallback === true) degraded++
    const ca = r?.metadata?.callAttribution
    if (ca) {
      selfReportedOverrides += Number(ca.overridesEdgesEmitted ?? 0)
      declinedBases += Number(ca.overridesBasesNotDeclaredEarlierInFile ?? 0)
    }
    const seen = new Set<string>()
    for (const e of Array.isArray(r?.relationships) ? r.relationships : []) {
      const t = String(e?.type ?? "")
      if (!edgeCount.has(t)) edgeCount.set(t, 0)
      edgeCount.set(t, (edgeCount.get(t) ?? 0) + 1)
      seen.add(t)
    }
    for (const t of seen) fileCount.set(t, (fileCount.get(t) ?? 0) + 1)
    for (const t of ["overrides", "instantiates"]) {
      if (!seen.has(t)) continue
      const per = perRepo.get(f.repo) ?? new Map()
      const cur = per.get(t) ?? { edges: 0, files: 0 }
      cur.files++
      per.set(t, cur)
      perRepo.set(f.repo, per)
    }
    for (const e of Array.isArray(r?.relationships) ? r.relationships : []) {
      const t = String(e?.type ?? "")
      if (t !== "overrides" && t !== "instantiates") continue
      const per = perRepo.get(f.repo) ?? new Map()
      const cur = per.get(t) ?? { edges: 0, files: 0 }
      cur.edges++
      per.set(t, cur)
      perRepo.set(f.repo, per)
    }
    done++
  }
}

await Promise.all(Array.from({ length: WORKERS }, () => worker()))
const walkMs = Date.now() - T0

const out: string[] = []
out.push("=".repeat(78))
out.push("CENSUS — `overrides` and `instantiates` over the WHOLE R corpus (production parseFile)")
out.push("=".repeat(78))
out.push(`node ${process.version}   workers ${WORKERS}`)
out.push(`load average at start: ${loadAtStart.map((n) => n.toFixed(2)).join(" ")}  (1m 5m 15m)  cores: ${os.cpus().length}`)
out.push(`corpus root: ${CR}`)
out.push(`corpus file set: sha256 ${corpusDigest} (${covered.length} paths, sorted)`)
out.push(`analyzer: src/ast/real-r-analyzer.ts sha256 ${analyzerDigest}`)
out.push(`files walked: ${done} (whole population${LIMIT > 0 ? `, LIMIT=${LIMIT}` : ", no stride"})`)
out.push(`degraded (regex fallback): ${degraded}   parse failures: ${failures}   traps ([BB-PARSE-ERR]): ${trapLines.length}`)
if (degraded || trapLines.length || failures) {
  out.push(`degraded/failed files are named because they change the population:`)
  for (const t of trapLines) out.push(`  TRAP ${t}`)
}
out.push(`walk wall time: ${walkMs}ms`)
out.push("")
out.push("EMITTED EDGES, PER TYPE — the firing measurement")
out.push("type            edges    files")
out.push("-".repeat(34))
for (const t of TYPES) {
  out.push(`${t.padEnd(15)} ${String(edgeCount.get(t) ?? 0).padStart(6)} ${String(fileCount.get(t) ?? 0).padStart(8)}`)
}
out.push("")
out.push("SILENT IN THE 120-FILE INSTRUMENT, MEASURED CORPUS-WIDE")
out.push("-".repeat(78))
for (const t of ["overrides", "instantiates"]) {
  const e = edgeCount.get(t) ?? 0
  const fl = fileCount.get(t) ?? 0
  out.push(`${t}: ${e} edges in ${fl} files of ${covered.length}`)
}
out.push("")
out.push("per repository (only repositories that emit the type are listed)")
for (const [repo, per] of [...perRepo.entries()].sort()) {
  const parts = [...per.entries()].sort().map(([t, v]) => `${t} ${v.edges} edges/${v.files} files`)
  out.push(`  ${repo.padEnd(18)} ${parts.join("   ")}`)
}
out.push("")
out.push("CROSS-CHECKS AND REFUSALS")
out.push("-".repeat(78))
out.push(`analyzer self-reported overridesEdgesEmitted (summed): ${selfReportedOverrides}`)
out.push(`census-measured overrides edges:                        ${edgeCount.get("overrides") ?? 0}`)
out.push(`  -> ${selfReportedOverrides === (edgeCount.get("overrides") ?? 0) ? "AGREE" : "DISAGREE — two counts of the same thing differ; investigate before declaring"}`)
out.push(`bases the file-scoped overrides pass DECLINED to assert (overridesBasesNotDeclaredEarlierInFile): ${declinedBases}`)
out.push(`  -> the pass is file-scoped by construction (base must be declared EARLIER IN THE SAME FILE);`)
out.push(`     this is the size of the opportunity it cannot reach, carried so it is not invisible.`)
out.push("")
out.push(`nothing further is scheduled: a leaked parse bomb would keep this process alive and exit 1`)
out.push(`~120s after a throw, printing [BB-HANG].`)
origWrite(out.join("\n") + "\n")

process.on("exit", (code) => {
  origWrite(`EXIT code=${code} after ${Date.now() - T0}ms total (walk ${walkMs}ms; post-walk drain ${Date.now() - T0 - walkMs}ms)\n`)
})
process.exitCode = 0
