/**
 * What share of the C++ lane's OUTPUT is actually audited, and what share is not.
 *
 * The M14 differential reports "100% covered, MISSING=0, unexplained=0" for
 * fmt:cpp and nlohmann-json:cpp. That sentence is about a SUBSET. The audited
 * label set for cpp is read out of `script/m14/differential.ts` itself:
 *
 *   ["extends", "implements", "instantiates", … , "calls", …]      (15295)
 *   … plus ["calls", "uses"] for cpp                              (14654 region)
 *
 * so `overrides` is excluded for cpp by name, `contains` is audited only for
 * perl/xml, and `references` is in neither list. Every row of those three kinds
 * is inside the "100%" and is nevertheless unexamined by that gate.
 *
 * This probe counts the rows by kind over the whole corpus, so the unaudited
 * share is a number rather than an impression — and it is the number that
 * decides whether "the output is fully covered" is a claim or a hope.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { parseFile } from "../../src/ast/engine"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/ishaq/fixtures/repositories"
const REPOS = (process.env.CPP_REPOS ?? "fmt,nlohmann-json,catch2,abseil-cpp,spdlog,zig").split(",").filter(Boolean)
const EXTS = [".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx", ".hh", ".h++"]
const SKIP = new Set([".git", "build", "node_modules", ".github", "cmake-build-debug"])
const OUT = process.env.CPP_OUT ?? "/tmp/opencode/cpp-review"

// Read out of the differential, not from memory: a coverage claim that hardcodes
// the audited set is the failure mode this whole round is about.
const AUDITED = new Set(["extends", "implements", "instantiates", "calls", "uses"])

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

const byType = new Map<string, number>()
let files = 0, syms = 0, rels = 0, audited = 0, unaudited = 0
let heuristic = 0, subOne = 0
const t0 = Date.now()
for (const repo of REPOS) {
  for (const f of walk(path.join(CORPUS, repo))) {
    let r: any
    try { r = await parseFile(f, readFileSync(f, "utf8")) } catch { continue }
    files++
    syms += r.symbols?.length ?? 0
    for (const x of (r.relationships ?? []) as any[]) {
      rels++
      const t = String(x.type ?? "")
      byType.set(t, (byType.get(t) ?? 0) + 1)
      if (AUDITED.has(t)) audited++
      else unaudited++
      const c = typeof x.confidence === "number" ? x.confidence : 1
      if (c < 1) subOne++
      if (c < 0.7) heuristic++
    }
  }
  process.stderr.write(`${repo} done files=${files}\n`)
}

const out = {
  generatedAt: new Date().toISOString(), files, symbols: syms, relationships: rels,
  wallMs: Date.now() - t0,
  auditedLabels: [...AUDITED].sort(),
  byType: Object.fromEntries([...byType].sort((a, b) => b[1] - a[1])),
  auditedRows: audited, unauditedRows: unaudited,
  auditedPct: +((100 * audited) / Math.max(1, rels)).toFixed(1),
  unauditedPct: +((100 * unaudited) / Math.max(1, rels)).toFixed(1),
  subConfidenceOne: subOne,
  heuristicRows: heuristic,
  note: "`audited` is the label set the M14 differential compares for cpp. Rows outside it are inside the lane's '100% covered' and are not examined by that gate. This probe counts them; it does not judge them — see loss-census.ts for the other half (what the analyzer does NOT publish).",
}
mkdirSync(OUT, { recursive: true })
writeFileSync(path.join(OUT, "coverage-share.json"), JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
