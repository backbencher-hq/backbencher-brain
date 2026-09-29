/**
 * M59.A7 / M60.P1 (#825 / #873): THE LINE CONTRACT, audited for the C++ lane.
 *
 * The contract, in the repo's own words: *call-site line or NULL* — a row's
 * `line_number` is the line of the node that NAMES the relationship, 1-based, or
 * absent. Never a fabricated 0, never an enclosing declaration's line, and never
 * two different lines between `line_number` and the metadata mirror (#873 was
 * about exactly that ambiguity: "the row's line" must mean one thing).
 *
 * The M60 payload matrix records that `line_number` is a produced-by-3-of-41
 * field, stored as 0 for 189,499 rows across the product. This probe asks the
 * narrower, per-lane question the matrix cannot: for EVERY relationship the C++
 * analyzer emits, is the line real, is it the naming node's line, and does the
 * metadata mirror agree?
 *
 *   bun run script/cpp-review/line-contract.ts
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { ASTEngine, parseFile } from "../../src/ast/engine"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/ishaq/fixtures/repositories"
const REPOS = (process.env.CPP_REPOS ?? "fmt,nlohmann-json,catch2,abseil-cpp,spdlog,zig").split(",").filter(Boolean)
const EXTS = [".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx", ".hh", ".h++"]
const SKIP = new Set([".git", "build", "node_modules", ".github", "cmake-build-debug"])
const OUT = process.env.CPP_OUT ?? "/tmp/opencode/cpp-review"

const walk = (d: string, out: string[] = [], depth = 0): string[] => {
  if (depth > 10) return out
  let es: string[]
  try { es = readdirSync(d) } catch { return out }
  for (const e of es) {
    if (SKIP.has(e)) continue
    const p = path.join(d, e)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out, depth + 1)
    else if (EXTS.some((x) => p.endsWith(x)) && st.size > 0) out.push(p)
  }
  return out
}

const byType = new Map<string, { n: number; noLine: number; zero: number; mirrorAgrees: number; mirrorDisagrees: number; mirrorAbsent: number; subOne: number }>()
const samples: any[] = []
let files = 0, total = 0
const t0 = Date.now()
const bump = (t: string) => {
  let e = byType.get(t)
  if (!e) { e = { n: 0, noLine: 0, zero: 0, mirrorAgrees: 0, mirrorDisagrees: 0, mirrorAbsent: 0, subOne: 0 }; byType.set(t, e) }
  return e
}

for (const repo of REPOS) {
  for (const f of walk(path.join(CORPUS, repo))) {
    let r: any
    try { r = await parseFile(f, readFileSync(f, "utf8")) } catch { continue }
    files++
    const rel = f.replace(CORPUS + "/", "")
    for (const x of (r.relationships ?? []) as any[]) {
      total++
      const t = String(x.type ?? "")
      const e = bump(t)
      e.n++
      const ln = x.line_number
      if (ln === undefined || ln === null) {
        e.noLine++
        if (samples.length < 40) samples.push({ kind: "no-line", file: rel, type: t, source: x.source, target: x.target, line: ln })
        continue
      }
      if (ln === 0) {
        e.zero++
        if (samples.length < 40) samples.push({ kind: "line-0", file: rel, type: t, source: x.source, target: x.target })
        continue
      }
      if (ln < 1 || !Number.isInteger(ln)) {
        e.subOne++
        if (samples.length < 40) samples.push({ kind: "sub-1-or-non-integer", file: rel, type: t, source: x.source, target: x.target, line: ln })
        continue
      }
      // #873: `line_number` and the metadata mirror must name the SAME node
      const md = (x.metadata ?? {}) as any
      if (md.line === undefined) e.mirrorAbsent++
      else if (md.line === ln) e.mirrorAgrees++
      else {
        e.mirrorDisagrees++
        if (samples.length < 40) samples.push({ kind: "mirror-disagrees", file: rel, type: t, source: x.source, target: x.target, line_number: ln, "metadata.line": md.line })
      }
    }
  }
  process.stderr.write(`${repo} done files=${files}\n`)
}

// Every RELATIONSHIP TYPE the analyzer can emit, vs the ones measured above —
// so a type the analyzer emits on a corpus that did not reach it is still named.
const ALL_TYPES = ["contains", "calls", "uses", "references", "extends", "implements", "instantiates", "overrides", "imports", "exports"]
const rows = [...byType.entries()].sort((a, b) => b[1].n - a[1].n).map(([t, e]) => ({ type: t, ...e }))

const out = {
  generatedAt: new Date().toISOString(), files, relationships: total, wallMs: Date.now() - t0,
  contract: "M59.A7 (#825) / M60.P1 (#873): line_number is the line of the node that NAMES the relationship, 1-based, or absent — never 0, never an enclosing declaration's line, and never a different line from the metadata mirror.",
  byType: rows,
  totals: {
    noLine: rows.reduce((a, r) => a + r.noLine, 0),
    lineZero: rows.reduce((a, r) => a + r.zero, 0),
    subOneOrNonInteger: rows.reduce((a, r) => a + r.subOne, 0),
    mirrorAgrees: rows.reduce((a, r) => a + r.mirrorAgrees, 0),
    mirrorDisagrees: rows.reduce((a, r) => a + r.mirrorDisagrees, 0),
    mirrorAbsent: rows.reduce((a, r) => a + r.mirrorAbsent, 0),
  },
  declaredTypesNeverSeen: ALL_TYPES.filter((t) => !byType.has(t)),
  samples,
}
mkdirSync(OUT, { recursive: true })
writeFileSync(path.join(OUT, "line-contract.json"), JSON.stringify(out, null, 2))
console.log(JSON.stringify({ files, relationships: total, byType: rows, totals: out.totals, declaredTypesNeverSeen: out.declaredTypesNeverSeen }, null, 2))
if (samples.length) { console.log("\nsamples:"); for (const s of samples.slice(0, 20)) console.log("  " + JSON.stringify(s)) }
