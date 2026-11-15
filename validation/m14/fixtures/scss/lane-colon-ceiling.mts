/**
 * THE `imports` COLON — THE CEILING, MEASURED IN THE GATE'S OWN COLUMNS.
 *
 * Four lanes emit `target = `${modulePath}:${itemName}`` (typescript, javascript, java, python), and
 * `pathLikeTarget` (script/m14/incoming-rule.ts:561-569) returns true for ANY target containing a
 * colon — so the gate rules the target path-like and `imports` resolves 0 in all four lanes.
 *
 * THE QUESTION IS A CEILING, NOT AN OPPORTUNITY COUNT: if the target were the ITEM NAME instead, what
 * fraction of those edges would land in `resolved` / `amb(decl)` / `unresolved`? A membership count
 * ("the project publishes 46.9% of these names") is NOT the answer — the gate's predicate decides, and
 * a name the project publishes can still classify as ambiguous.
 *
 * AND THE SPLIT THAT IS THE WHOLE FINDING: `react:useState` has an EXTERNAL module, so
 * `externalUnverified` is CORRECT and must stay; `./OwnerType:OwnerTypeFromJSON` names a module IN this
 * project, so the edge SHOULD resolve and today cannot.
 *
 * IT CLASSIFIES WITH THE GATE'S OWN RULE MODULE (`classifyEdge`), over the gate's own scope (per
 * PROJECT — the repository a file belongs to), against the gate's own key space (symbol names plus
 * qualified-name aliases, with kinds).
 *
 * USAGE  npx tsx validation/m14/fixtures/scss/lane-colon-ceiling.mts <lane> [out-json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { classifyEdge } from "../../../../script/m14/incoming-rule"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const LANE = process.argv[2]
const OUT = process.argv[3]
if (!LANE) { console.error("usage: lane-colon-ceiling.mts <lane> [out-json]"); process.exit(2) }

type Row = { repo: string; rel: string; abs: string }
const rows: Row[] = []
/**
 * COVERAGE IS DECLARED, NOT IMPLIED. A whole-population run of a large lane exceeds 25 minutes and was
 * KILLED, so this takes an optional repo list and reports how many of the lane's files it covered.
 * Within each covered repo the walk is COMPLETE — the key space is built from every admitted file of
 * that project — so the ceiling is unbiased for the projects it covers; it is not a stride sample.
 */
const ONLY_REPOS = (process.env.BB_CC_REPOS ?? "").split(",").map((x) => x.trim()).filter(Boolean)
for (const name of execFileSync("ls", [CR], { encoding: "utf8" }).split("\n").filter(Boolean).sort()) {
  if (ONLY_REPOS.length > 0 && !ONLY_REPOS.includes(name)) continue
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > SIZE_CAP) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== LANE) continue
    rows.push({ repo: name, rel, abs })
  }
}

const decl = new Map<string, Map<string, number>>()
const kinds = new Map<string, Map<string, Set<string>>>()
/** every admitted path per repo, for the LOCAL/EXTERNAL test */
const filesByRepo = new Map<string, Set<string>>()
type Edge = { repo: string; file: string; target: string; modulePath: string; itemName: string; locality: "LOCAL" | "EXTERNAL" }
const edges: Edge[] = []
let parsed = 0, failed = 0

for (const f of rows) {
  let r: any
  try { r = await parseFile(f.abs, path.join(CR, f.repo), { projectRoot: path.join(CR, f.repo) } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  if (!decl.has(f.repo)) { decl.set(f.repo, new Map()); kinds.set(f.repo, new Map()); filesByRepo.set(f.repo, new Set()) }
  filesByRepo.get(f.repo)!.add(f.rel.split(path.sep).join("/"))
  const d = decl.get(f.repo)!, k = kinds.get(f.repo)!
  const bump = (key: string, kind: string) => {
    d.set(key, (d.get(key) ?? 0) + 1)
    let s = k.get(key); if (!s) k.set(key, (s = new Set())); s.add(kind)
  }
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? ""); if (!name) continue
    const kind = String(s?.kind ?? "")
    bump(name, kind)
    const q = String(s?.qualifiedName ?? ""); if (q && q !== name) bump(q, kind)
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    if (String(rel?.type ?? rel?.relationshipType ?? "") !== "imports") continue
    const target = String(rel?.target ?? "")
    const md: any = rel?.metadata ?? {}
    // AFTER THE EMISSION CHANGE a LOCAL edge's target is the BARE ITEM — no colon — so selection
    // cannot be "target contains a colon" any more. Every `imports` edge is collected and the
    // module is read from `metadata.module` (which all three lanes now carry); the colon spelling is
    // the fallback for an edge recorded before that metadata existed.
    const hasModuleMeta = typeof md.module === "string" && md.module.length > 0
    if (!hasModuleMeta && !target.includes(":")) continue
    const modulePath = hasModuleMeta ? String(md.module) : target.slice(0, target.lastIndexOf(":"))
    const itemName = hasModuleMeta && !target.includes(":") ? target : target.slice(target.lastIndexOf(":") + 1)
    // LOCAL: a relative specifier, or one whose basename names an admitted file in this repo
    const rel0 = modulePath.startsWith(".") || modulePath.startsWith("/")
    const base = (modulePath.split(/[\\/]/).pop() ?? "").replace(/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|java|py)$/i, "")
    const repo = filesByRepo.get(f.repo)!
    const namesAFile = base !== "" && [...repo].some((p) => {
      const b = (p.split("/").pop() ?? "").replace(/\.[^.]+$/, "").replace(/^index$/, "index")
      return b === base || b === base + ".d"
    })
    edges.push({ repo: f.repo, file: f.rel, target, modulePath, itemName, locality: rel0 || namesAFile ? "LOCAL" : "EXTERNAL" })
  }
}

const tally = (pred: (e: Edge) => boolean) => {
  const t: Record<string, number> = {}
  for (const e of edges) {
    if (!pred(e)) continue
    const c: any = classifyEdge(decl.get(e.repo)!, kinds.get(e.repo)!, e.itemName, null)
    const key = String(c?.outcome ?? "?")
    t[key] = (t[key] ?? 0) + 1
  }
  return t
}
const asIs = (pred: (e: Edge) => boolean) => {
  const t: Record<string, number> = {}
  for (const e of edges) {
    if (!pred(e)) continue
    const c: any = classifyEdge(decl.get(e.repo)!, kinds.get(e.repo)!, e.target, null)
    const key = String(c?.outcome ?? "?")
    t[key] = (t[key] ?? 0) + 1
  }
  return t
}
const report = {
  instrument: "the `imports` colon — the CEILING in the gate's own columns, split by LOCAL vs EXTERNAL module",
  lane: LANE,
  population: { admitted: rows.length, parsed, failed, repos: decl.size, repoFilter: ONLY_REPOS.length ? ONLY_REPOS : "ALL", admission: "git-tracked, <= 1 MiB, detectLanguageFromPath === lane" },
  scope: "per PROJECT (the repository a file belongs to) — the gate's default and production's scope",
  colonEdges: edges.length,
  /**
   * THE THIRD INPUT, and the Lead's addition: `_i13_pick` requires BOTH `instr(target_external,'.') = 0`
   * AND `instr(target_external,':') = 0` (parallel-indexer.ts:4484-4485). So a target can be refused by
   * EITHER clause — and a scoped package or any module path containing a dot (`@angular/core:Component`)
   * carries BOTH. A bare item name satisfies both; a fix to the colon alone would leave every
   * dotted-module edge refused. Counted here from the MODULE half, separately from the colon.
   */
  /** THE DOT CLAUSE, CROSS-TABULATED BY OUTCOME — the Lead's acceptance 4: a bare item name carries
   *  neither a dot nor a colon, so an edge whose MODULE half carries a dot should move too. */
  dotClauseCrossTab: {
    LOCAL: (() => { const t: Record<string, number> = {}
      for (const e of edges) { if (e.locality !== "LOCAL" || !e.modulePath.includes(".")) continue
        const c: any = classifyEdge(decl.get(e.repo)!, kinds.get(e.repo)!, e.target, null)
        t[String(c?.outcome ?? "?")] = (t[String(c?.outcome ?? "?")] ?? 0) + 1 }
      return t })(),
    EXTERNAL: (() => { const t: Record<string, number> = {}
      for (const e of edges) { if (e.locality !== "EXTERNAL" || !e.modulePath.includes(".")) continue
        const c: any = classifyEdge(decl.get(e.repo)!, kinds.get(e.repo)!, e.target, null)
        t[String(c?.outcome ?? "?")] = (t[String(c?.outcome ?? "?")] ?? 0) + 1 }
      return t })(),
  },
  dotInModuleHalf: {
    LOCAL: edges.filter((e) => e.locality === "LOCAL" && e.modulePath.includes(".")).length,
    EXTERNAL: edges.filter((e) => e.locality === "EXTERNAL" && e.modulePath.includes(".")).length,
    ofColonEdges: edges.length,
  },
  bothClauses: {
    note: "colon is present on EVERY edge counted here (it is the selection rule); a dot in the module half is the second clause",
    dotAndColon_LOCAL: edges.filter((e) => e.locality === "LOCAL" && e.modulePath.includes(".")).length,
    dotAndColon_EXTERNAL: edges.filter((e) => e.locality === "EXTERNAL" && e.modulePath.includes(".")).length,
  },
  corpusConstruction: "ONE PROJECT PER REPOSITORY, no merging: each file is parsed with `projectRoot` set to its own repo and the key space is built per repo, which is the gate's own scope and production's. r-lane's hcl instrument copies 13 repos into a single scratch project, which inflates cross-repo collisions; that artifact is NOT present here and cannot be.", 
  targetAsIs: { LOCAL: asIs((e) => e.locality === "LOCAL"), EXTERNAL: asIs((e) => e.locality === "EXTERNAL") },
  targetBareItemName: { LOCAL: tally((e) => e.locality === "LOCAL"), EXTERNAL: tally((e) => e.locality === "EXTERNAL"), ALL: tally(() => true) },
  reading: {
    asIs: "`classifyEdge` on the target AS EMITTED — the colon makes it path-like to the gate, and with no declaration of that spelling the outcome is `unresolved` (the lane's measured `resolves 0`).",
    ceiling: "`classifyEdge` on the BARE ITEM NAME, which is the emission change candidate. `resolved` here is the ceiling the change could reach; `ambDeclOnly`/`ambBoth` are edges it would NOT settle; `unresolved` are edges whose item is declared nowhere in the project.",
    localVsExternal: "the split that decides whether a change is a fix or a regression: an EXTERNAL module's items are legitimately outside the population, so an emission change that makes them resolve would be WRONG — their current unverified state is correct.",
  },
}
const text = JSON.stringify(report, null, 2)
writeFileSync(OUT ?? `validation/m14/fixtures/scss/colon-ceiling-${LANE}.json`, text + "\n")
console.log(JSON.stringify({ lane: LANE, population: report.population, colonEdges: report.colonEdges, targetAsIs: report.targetAsIs, targetBareItemName: report.targetBareItemName }, null, 2))
