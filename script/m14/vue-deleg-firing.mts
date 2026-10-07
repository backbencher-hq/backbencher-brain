/**
 * VUE — DOES THE SCRIPT DELEGATION FIRE? Two paths, one corpus, tallied.
 *
 * WHY THIS FILE EXISTS. The handover said: "on 11 real .vue SFCs the analyzer
 * fired ONLY instantiates:10 — calls is silent, meaning the inline <script>
 * delegation to the JS/TS analyzer is not happening or is not labelled." That
 * is a measurable claim and this file measures it, on both paths that exist:
 *
 *   PATH A "bare"      getParser(lang) -> parser.parse(content) -> analyze(root,
 *                      content, file) with NO context. This is the shape
 *                      script/m14/firing-check.mjs uses for every lane.
 *   PATH B production  parseFile(file, projectPath) from src/ast/pool-worker,
 *                      which is ASTEngine.parseFile — the only caller that
 *                      pre-parses the `<script>` block bodies with the JS/TS
 *                      grammar and hands the trees over in
 *                      context.sfcScriptTrees.
 *
 * The delegation for a `.vue` SFC is NOT reachable from PATH A: the vue grammar
 * exposes the script body as an opaque `raw_text` node, so without the engine
 * seam there is no JS/TS tree to hand a JS/TS analyzer. Every script-side edge
 * (`calls`, `imports`, `references`, `uses`, `exports`, `contains`) is therefore
 * structurally invisible to PATH A. Template-side edges (`instantiates`,
 * template `uses`) are produced by the analyzer's own SFC walk and DO fire.
 *
 * So the handover number measures the harness, not the analyzer. Both tallies
 * are printed so the difference is a number rather than an argument.
 *
 * NO REGEX: file admission is by extension and by `git ls-files`; every edge
 * tally comes from walking the returned `ParseResult`.
 *
 * CLI: npx tsx script/m14/vue-deleg-firing.mts [--repo vuejs,element-plus]
 *      [--dir <abs dir>] [--sample N] [--out f.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "path"
import { ASTEngine, getParser } from "../../src/ast/engine"
import { RelationshipType as TypesEnum } from "../../src/ast/types"
import { RealVueAnalyzer } from "../../src/ast/real-vue-analyzer"
import { parseFile } from "../../src/ast/pool-worker"

// The DENOMINATOR. `ASTEngine.RelationshipType` is the enum the analyzers
// actually emit through, and it is NOT the same set as `types.ts`'s:
// ASTEngine.Imports = "imports", types.ts.Imports = "brain_import". An edge
// emitted by any analyzer therefore carries a type string that firing-check.mjs's
// `Object.values(types.ts.RelationshipType)` denominator cannot name, and the
// import edges are counted as neither fired nor silent — they are invisible.
// Measured in vue-construct-probe.mts; reported, not fixed here (both enum files
// are MASTER-owned).
const ALL = [...new Set(Object.values(ASTEngine.RelationshipType))].sort()
const PRETTY: Record<string, string> = {
  calls: "calls", extends: "extends", implements: "implements", uses: "uses",
  brain_import: "imports", imports: "imports", exports: "exports",
  contains: "contains", references: "references", overrides: "overrides",
  instantiates: "instantiates",
}
const TYPES_ENUM_ONLY = [...new Set(Object.values(TypesEnum))].filter((t) => !ALL.includes(t))

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const REPOS = (argOf("--repo", "vuejs") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const EXTRA_DIRS = (argOf("--dir", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const SAMPLE = parseInt(argOf("--sample", "0") ?? "0")
const OUT = argOf("--out")
const MAX_BYTES = 512 * 1024

type File = { repo: string; rel: string; abs: string }
const files: File[] = []
const seen = new Set<string>()
const admit = (dir: string, repo: string) => {
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { return }
  for (const rel of tracked) {
    if (!rel.endsWith(".vue")) continue
    const abs = path.join(dir, rel)
    if (seen.has(abs)) continue
    seen.add(abs)
    files.push({ repo, rel, abs })
  }
}
for (const r of REPOS) admit(path.join("$HOME/fixtures/repositories", r), r)
for (const d of EXTRA_DIRS) admit(d, path.basename(d))
const drawn = SAMPLE > 0 ? files.slice(0, SAMPLE) : files

const bare = new Map<string, number>()
const prod = new Map<string, number>()
const bareFiles: Record<string, number> = {}
const prodFiles: Record<string, Record<string, number>> = {}
const OFF_ENUM = new Map<string, number>()
let bareSyms = 0, prodSyms = 0, bareRels = 0, prodRels = 0
let bareFail = 0, prodFail = 0

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
const relType = (r: any): string | null => {
  const t = r?.relationshipType ?? r?.type
  return typeof t === "string" && t.length > 0 ? t : null
}

const t0 = Date.now()
for (const f of drawn) {
  let content: string
  try { content = readFileSync(f.abs, "utf8") } catch { bareFail++; prodFail++; continue }
  if (content.length > MAX_BYTES) continue

  // PATH A — bare parser, no context (firing-check.mjs's shape)
  try {
    const parser = await getParser("vue")
    const tree = parser.parse(content)
    const res: any = new RealVueAnalyzer().analyze(tree.rootNode, content, f.abs)
    const rels = (res?.relationships ?? []) as any[]
    bareSyms += (res?.symbols ?? []).length
    bareRels += rels.length
    const per: Record<string, number> = {}
    for (const r of rels) {
      const t = relType(r)
      if (!t) continue
      bump(bare, t)
      per[t] = (per[t] ?? 0) + 1
    }
    bareFiles[`${f.repo}/${f.rel}`] = rels.length
  } catch (e) {
    bareFail++
    if (bareFail === 1) console.error("PATH A first failure:", String(e).slice(0, 200))
  }

  // PATH B — production entry
  try {
    const res: any = await parseFile(f.abs, path.dirname(f.abs))
    const rels = (res?.relationships ?? []) as any[]
    prodSyms += (res?.symbols ?? []).length
    prodRels += rels.length
    const per: Record<string, number> = {}
    for (const r of rels) {
      const t = relType(r)
      if (!t) continue
      bump(prod, t)
      per[t] = (per[t] ?? 0) + 1
      if (!ALL.includes(t)) bump(OFF_ENUM, t)
    }
    prodFiles[`${f.repo}/${f.rel}`] = per
  } catch (e) {
    prodFail++
    if (prodFail === 1) console.error("PATH B first failure:", String(e).slice(0, 200))
  }
}
const wall = (Date.now() - t0) / 1000

const row = (t: string) => ({
  type: PRETTY[t] ?? t,
  bare: bare.get(t) ?? 0,
  production: prod.get(t) ?? 0,
  delta: (prod.get(t) ?? 0) - (bare.get(t) ?? 0),
})
const rows = ALL.map(row)

console.log(`\nvue delegation firing — repos [${[...new Set(drawn.map((d) => d.repo))].join(", ")}]  .vue files ${drawn.length}`)
console.log(`  PATH A bare (getParser->parse->analyze, no context)   symbols ${bareSyms}  relationships ${bareRels}  failures ${bareFail}`)
console.log(`  PATH B production (pool-worker.parseFile)             symbols ${prodSyms}  relationships ${prodRels}  failures ${prodFail}`)
console.log(`  wall ${wall.toFixed(1)}s\n`)
console.log("type          PATH A   PATH B   delta")
console.log("------------------------------------------")
for (const r of rows) {
  console.log(`${r.type.padEnd(12)} ${String(r.bare).padStart(7)} ${String(r.production).padStart(8)} ${String(r.delta).padStart(8)}`)
}
const aFired = ALL.filter((t) => (bare.get(t) ?? 0) > 0)
const bFired = ALL.filter((t) => (prod.get(t) ?? 0) > 0)
console.log(`\nPATH A fired ${aFired.length}/10: ${aFired.map((t) => `${PRETTY[t] ?? t}:${bare.get(t)}`).join("  ")}`)
console.log(`PATH A SILENT: ${ALL.filter((t) => !(bare.get(t) ?? 0)).map((t) => PRETTY[t] ?? t).join(" ")}`)
console.log(`PATH B fired ${bFired.length}/10: ${bFired.map((t) => `${PRETTY[t] ?? t}:${prod.get(t)}`).join("  ")}`)
console.log(`PATH B SILENT: ${ALL.filter((t) => !(prod.get(t) ?? 0)).map((t) => PRETTY[t] ?? t).join(" ")}`)
if (OFF_ENUM.size) {
  console.log(`\nOFF-ENUM relationship types emitted (no member of ASTEngine.RelationshipType has this string): ${[...OFF_ENUM.entries()].map(([t, n]) => `${t}:${n}`).join("  ")}`)
}
console.log(`types.ts enum names ASTEngine's enum lacks: ${TYPES_ENUM_ONLY.join(" ") || "(none)"}`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    corpus: [...new Set(drawn.map((d) => d.repo))],
    files: drawn.length,
    wallSeconds: wall,
    denominator: "ASTEngine.RelationshipType (src/ast/engine.ts)",
    offEnumEmitted: Object.fromEntries(OFF_ENUM),
    typesTsOnly: TYPES_ENUM_ONLY,
    pathA: { note: "getParser->parse->analyze, no context (firing-check.mjs shape)", symbols: bareSyms, relationships: bareRels, failures: bareFail, tally: Object.fromEntries(bare), perFileRelationships: bareFiles },
    pathB: { note: "pool-worker.parseFile (ASTEngine.parseFile) — the production entry", symbols: prodSyms, relationships: prodRels, failures: prodFail, tally: Object.fromEntries(prod), perFileRelationships: prodFiles },
    allTypes: ALL.map((t) => PRETTY[t] ?? t),
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}