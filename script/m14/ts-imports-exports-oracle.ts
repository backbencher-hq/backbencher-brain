/**
 * TYPESCRIPT imports/exports ORACLE RUN — the DERIVATION answer for the two
 * labels the differential does not audit.
 *
 * ## The finding this exists to close
 *
 * `script/m60/rel-type-coverage-gate.ts` reports, for this lane:
 *
 *   DERIVATION typescript emits `imports` but the differential audits
 *     ["calls","contains","extends","implements","instantiates","overrides",
 *      "references","uses"] — the type is stored and compared against nothing
 *   DERIVATION typescript emits `exports` but the differential audits
 *     [ …the same eight… ] — the type is stored and compared against nothing
 *
 * So `imports` and `exports` ARE two of the DERIVATION findings, and they are the
 * two labels IMPORTS_ENUM is about. An unverified edge ships a bug invisibly, and
 * this lane had just added 68 dependency edges per 200 files to one of them.
 *
 * ## Why the lane cannot simply wire the shared gate
 *
 * `script/m14/differential.ts` is MASTER-owned, and two changes there are needed:
 *   1. import `deriveImportsExportsTruth` from `./oracles/typescript-imports-exports`
 *      and add its rows to the typescript tree-truth set;
 *   2. add `"imports"` and `"exports"` to the typescript lane's audited label list
 *      (differential.ts:23186), which currently reads `["references","uses"]`.
 * Both are reported to master, not made here.
 *
 * What IS in this lane is `oracles/typescript-imports-exports.ts` (258 lines, its
 * own header calls itself LANE-OWNED) — and it was imported by NOTHING. That is
 * the "finished but unconnected" shape the differential's own header names for
 * the M60 label-coverage sweep: *"`zig-truth.ts` carries FOUR finished oracles
 * … each of which was consumed only by a script/m14/tmp probe."* So this runner
 * is the missing consumer: it runs the finished oracle against the real analyzer
 * over real corpus and reports the agreement as a number.
 *
 * ## What the number is and is not
 *
 * It is a SET comparison per label, per file, on the production path
 * (`getParser` → `parse` → `parseFile`), because a count comparison cannot see a
 * compensating pair — one invented module and one dropped dependency sum to zero.
 * It is NOT L3 by itself: the oracle shares the PARSER with the analyzer, so a bug
 * in the grammar is invisible to both, and this script says so in its output rather
 * than claiming more than the harness supports.
 *
 * Usage: bun run script/m14/ts-imports-exports-oracle.ts [--repo element-plus]
 *                                                  [--limit N] [--out path.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { getParser } from "../../src/ast/engine"
import { parseFile } from "../../src/ast/pool-worker"
import { deriveImportsExportsTruth } from "./oracles/typescript-imports-exports"

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const REPO_FILTER = argOf("--repo") ?? "element-plus"
const LIMIT = Number(argOf("--limit") ?? "0")
const MAX_BYTES = Number(argOf("--max-bytes") ?? String(300 * 1024))
const OUT = argOf("--out")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

const files: { repo: string; dir: string; rel: string; abs: string }[] = []
for (const e of readdirSync(CR).sort()) {
  if (!e.includes(REPO_FILTER)) continue
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let size: number
    try { size = statSync(abs).size } catch { continue }
    if (size > MAX_BYTES || size === 0) continue
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "typescript") continue
    files.push({ repo: e, dir, rel, abs })
    if (LIMIT && files.length >= LIMIT) break
  }
  if (LIMIT && files.length >= LIMIT) break
}

type Stat = {
  truth: number
  emitted: number
  agree: number
  truthOnly: Set<string>
  emittedOnly: Set<string>
  truthOnlyFiles: Map<string, string>
  emittedOnlyFiles: Map<string, string>
}
const stat = (): Stat => ({ truth: 0, emitted: 0, agree: 0, truthOnly: new Set(), emittedOnly: new Set(), truthOnlyFiles: new Map(), emittedOnlyFiles: new Map() })
const stats: Record<string, Stat> = { imports: stat(), exports: stat() }

let parsed = 0, failed = 0
const errors: string[] = []
let idx = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const label = `${f.repo}/${f.rel}`
    let res: any
    try { res = await parseFile(f.abs, f.dir) } catch (e) { failed++; if (errors.length < 5) errors.push(String(e).slice(0, 100)); continue }
    parsed++
    let truth: ReturnType<typeof deriveImportsExportsTruth>
    try {
      const content = readFileSync(f.abs, "utf8")
      const parser = await getParser("typescript")
      const tree = await parser.parse(content)
      if (!tree) throw new Error("parser.parse returned no tree (null result)")
      const leaf = path.basename(f.abs, path.extname(f.abs))
      truth = deriveImportsExportsTruth(tree.rootNode, leaf)
    } catch (e) { if (errors.length < 10) errors.push(`oracle ${label} ${String(e).slice(0, 90)}`); continue }

    for (const t of truth) {
      const s = stats[t.label]
      if (!s) continue
      s.truth++
    }
    for (const rel of res.relationships ?? []) {
      const label2 = String(rel.type ?? rel.relationshipType ?? "")
      const s = stats[label2]
      if (!s) continue
      const from = String(rel.source ?? "")
      const target = String(rel.target ?? "")
      s.emitted++
      const key = `${label2}|${from}->${target}`
      if (truth.some((t) => t.label === label2 && t.from === from && t.target === target)) s.agree++
      else { s.emittedOnly.add(key); if (s.emittedOnlyFiles.size < 25) s.emittedOnlyFiles.set(key, label) }
    }
    // Truth-only: every truth row with no matching emitted edge in this file.
    for (const t of truth) {
      const s = stats[t.label]
      if (!s) continue
      const found = (res.relationships ?? []).some((rel: any) => {
        const l = String(rel.type ?? rel.relationshipType ?? "")
        return l === t.label && String(rel.source ?? "") === t.from && String(rel.target ?? "") === t.target
      })
      if (!found) {
        const key = `${t.label}|${t.from}->${t.target}`
        s.truthOnly.add(key)
        if (s.truthOnlyFiles.size < 25) s.truthOnlyFiles.set(key, label)
      }
    }
  }
}
await Promise.all(Array.from({ length: Number(process.env.BB_ORACLE_WORKERS ?? "6") }, () => worker()))

const pad = (x: string, n: number) => (x + " ".repeat(n)).slice(0, n)
console.log(`typescript imports/exports oracle — corpus ${REPO_FILTER}`)
console.log(`${files.length} files admitted, ${parsed} analysed, ${failed} analyzer failures`)
if (errors.length) console.log(`errors: ${errors.join(" | ")}`)
console.log("\nLIMIT OF THIS HARNESS, stated up front: the oracle and the analyzer share the")
console.log("PARSER, so a bug in the grammar is invisible to both. This measures agreement")
console.log("between two walkers over the same tree, not the tree's correctness.\n")
console.log(`${pad("label", 10)}${pad("truth", 10)}${pad("emitted", 10)}${pad("agree", 10)}${pad("truthOnly", 12)}${pad("emittedOnly", 13)}agreement`)
console.log("-".repeat(110))
const out: any = {
  at: new Date().toISOString(), repo: REPO_FILTER, maxBytes: MAX_BYTES,
  filesAdmitted: files.length, filesAnalysed: parsed, analyzerFailures: failed,
  sharedParserLimit: "the oracle and the analyzer share the parser; a grammar bug is invisible to both",
  labels: {},
}
for (const label of ["imports", "exports"] as const) {
  const s = stats[label]
  const pct = s.truth ? ((100 * s.agree) / s.truth).toFixed(1) : "-"
  console.log(pad(label, 10) + pad(String(s.truth), 10) + pad(String(s.emitted), 10) + pad(String(s.agree), 10) + pad(String(s.truthOnly.size), 12) + pad(String(s.emittedOnly.size), 13) + pct + "% of truth")
  out.labels[label] = {
    truth: s.truth, emitted: s.emitted, agree: s.agree,
    truthOnly: s.truthOnly.size, emittedOnly: s.emittedOnly.size,
    truthOnlySample: [...s.truthOnlyFiles].slice(0, 15).map(([k, f]) => `${k}  @ ${f}`),
    emittedOnlySample: [...s.emittedOnlyFiles].slice(0, 15).map(([k, f]) => `${k}  @ ${f}`),
  }
  if (s.truthOnly.size) {
    console.log(`  TRUTH-ONLY (derived, never emitted) — first 12:`)
    for (const [k, f] of [...s.truthOnlyFiles].slice(0, 12)) console.log(`    ${k}  @ ${f}`)
  }
  if (s.emittedOnly.size) {
    console.log(`  EMITTED-ONLY (published, never derived) — first 12:`)
    for (const [k, f] of [...s.emittedOnlyFiles].slice(0, 12)) console.log(`    ${k}  @ ${f}`)
  }
}
if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`\nwrote ${OUT}`) }