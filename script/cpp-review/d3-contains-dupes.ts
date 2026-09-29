/**
 * D3, measured correctly.
 *
 * The first pass of the register counted every repeated (source, type, target)
 * row and reported 29,708 — but that conflated two different things. The
 * family's "one edge per pair" contract is enforced by `emittedUseRelationships`
 * (C) and `usesSeen` (C++) on `uses`/`references`: a member read or an include
 * is ONE fact no matter how many sites express it. A `calls` row is NOT that
 * shape — line N calling `foo` and line M calling `foo` are two facts, and the
 * C, TypeScript and Java analyzers all emit both (they carry distinct
 * `line_number`s, which is the M59.A7 contract).
 *
 * So D3 is measured here as what it actually is: `contains` is a CONTAINMENT
 * relation between two named entities, and two rows saying the same owner
 * contains the same member are the same fact twice. This probe counts only that,
 * plus `uses`/`references` as a check that the existing dedupe still holds.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { parseFile } from "../../src/ast/engine"

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

const byType = new Map<string, { pairs: number; excess: number; top: Map<string, number>; sites: any[] }>()
const note = (t: string, k: string, n: number, site: any) => {
  let e = byType.get(t)
  if (!e) { e = { pairs: 0, excess: 0, top: new Map(), sites: [] }; byType.set(t, e) }
  e.pairs++
  e.excess += n - 1
  e.top.set(k, (e.top.get(k) ?? 0) + n)
  if (e.sites.length < 12) e.sites.push({ ...site, occurrences: n })
}

let files = 0
const t0 = Date.now()
for (const repo of REPOS) {
  for (const f of walk(path.join(CORPUS, repo))) {
    let r: any
    try { r = await parseFile(f, readFileSync(f, "utf8")) } catch { continue }
    files++
    const rel = f.replace(CORPUS + "/", "")
    // containment is a per-FILE fact: a class and its members live in one TU
    const seen = new Map<string, number>()
    for (const x of (r.relationships ?? []) as any[]) {
      if (x.type !== "contains" && x.type !== "uses" && x.type !== "references") continue
      const k = `${x.source} ${x.target}`
      const n = (seen.get(k) ?? 0) + 1
      seen.set(k, n)
      if (n === 2) note(x.type, k, n, { repo, file: rel, line: x.line_number, source: x.source, target: x.target })
    }
  }
}
const out: any = { generatedAt: new Date().toISOString(), files, wallMs: Date.now() - t0, note: "calls is EXCLUDED by design: two call sites are two facts (distinct line_number, the M59.A7 contract), and the C/TypeScript/Java lanes all emit both." }
for (const [t, e] of byType) {
  out[t] = { duplicatePairs: e.pairs, excessRows: e.excess, top: [...e.top].sort((a, b) => b[1] - a[1]).slice(0, 20), sites: e.sites }
}
mkdirSync(OUT, { recursive: true })
writeFileSync(path.join(OUT, "d3-contains-dupes.json"), JSON.stringify(out, null, 2))
console.log(`files=${files}`)
for (const [t, e] of byType) {
  console.log(`\n${t}: ${e.pairs} duplicate pairs, ${e.excess} excess rows`)
  for (const [k, n] of [...e.top].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`   ${String(n).padStart(4)}x  ${k}`)
}
