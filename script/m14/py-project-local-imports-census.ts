/**
 * PY-PROJECT-LOCAL-IMPORTS-CENSUS — the D7 W2 instrument: on the PRODUCTION population, what
 * exactly is the project-local-imports wall, and which of its rows the project index can answer?
 *
 * WHY THIS FILE EXISTS. W2 ("project-local imports — 29,223 unresolved, §13") has been carried as a
 * named wall with a partly-INSTRUMENT-GAP disposition, and the disposition rests on a SAMPLE
 * (`py-import-fact-census.ts --repos 5`, 20,606 imports). A sample is a proportion, not a count.
 * This instrument answers the SAME question on the WHOLE admitted population, with the gate's own
 * admission rules (git-tracked, `.py/.pyi/.pyw`, ≤ 1 MB), and it separates the classes that the
 * sample could only proportion.
 *
 * THE QUESTION, PRECISELY. For every `imports` edge the analyzer emits on a project-local module,
 * the index KNOWS the module is this project's own. The question the wall asks is: can the edge
 * NAME a declaration the project publishes? That needs three facts, and each is separately
 * checkable:
 *
 *   · LOCALITY      — the module is a path suffix of a project file (the index's own `modules` set).
 *   · ONCE          — the item the import binds is declared EXACTLY ONCE in the project
 *                     (`symbolCounts[item] === 1`). This is production's own strategy-2 condition
 *                     (`_res_name.cnt = 1`), so a retarget here is not a lane invention.
 *   · TARGETABLE    — the gate's key space can actually ANSWER the retargeted target, i.e. the
 *                     project publishes a declaration under that name at all.
 *
 * The third fact is the one the sample could not price, and it is where a wall can be converted
 * into a real resolution rather than only a fact. A row can be project-local, once-declared, and
 * still UNRESOLVABLE because the declaration is not published under that name (a module-level
 * `__all__` re-export, a function assigned rather than defined, a name the analyzer publishes
 * under a qualified spelling only).
 *
 * WHAT THIS FILE DOES NOT DO. It does not resolve anything and it does not touch the analyzer.
 * It MEASURES, and the numbers it prints are the ones the wall's disposition must quote.
 *
 * USAGE:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/py-project-local-imports-census.ts \
 *     --out validation/m14/results/PYTHON-PROJECT-LOCAL-IMPORTS.json
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { RealPythonAnalyzer } from "../../src/ast/real-python-analyzer"
import { buildProjectIndex, PYTHON_DECLARATION_SPEC } from "../../src/ast/project-index"

const ROOT = process.cwd()
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const OUT = argOf("--out")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const SIZE_CAP = 1_048_576

// ── THE GATE'S OWN ADMISSION RULES, replicated here (read-only, from incoming-gate.ts) ────────
// git-tracked, extension-admitted, ≤ 1 MB, present in the working tree. The gate's list is
// `git ls-files` per repo; symlinked corpus entries are followed with statSync, never with
// `grep -r` (the corpus is a symlink farm).
function admittedPythonFiles(): { files: string[]; absent: number; overCap: number; overCapLargest: number; repos: string[] } {
  const found: string[] = []
  const excluded = { absent: 0, overCap: 0, overCapLargest: 0 }
  const repos: string[] = []
  let entries: string[]
  try { entries = readdirSync(CR).sort() } catch { entries = [] }
  for (const name of entries) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    let saw = false
    for (const rel of tracked) {
      const lower = rel.toLowerCase()
      if (!(lower.endsWith(".py") || lower.endsWith(".pyi") || lower.endsWith(".pyw"))) continue
      const abs = path.join(dir, rel)
      let size = 0
      try { size = statSync(abs).size } catch { excluded.absent++; continue }
      if (size > SIZE_CAP) { excluded.overCap++; excluded.overCapLargest = Math.max(excluded.overCapLargest, size); continue }
      found.push(abs)
      saw = true
    }
    if (saw) repos.push(name)
  }
  found.sort()
  return { files: found, ...excluded, repos }
}

/** THE INDEX'S OWN MODULE SET, in the shape `projectModuleLocalityOf` reads. */
function localityOf(modules: Set<string>): (m: string) => "project-local" | "third-party" | "unknown" {
  const paths: string[] = []
  const stems = new Set<string>()
  const dirSegments = new Set<string>()
  for (const raw of modules) {
    let m = ""
    for (let i = 0; i < raw.length; i++) m += raw[i] === "\\" ? "/" : raw[i]
    if (m.length === 0) continue
    paths.push(m)
    const slash = m.lastIndexOf("/")
    const base = slash >= 0 ? m.slice(slash + 1) : m
    const dot = base.lastIndexOf(".")
    if (dot > 0) { const stem = base.slice(0, dot); if (stem.length > 0) stems.add(stem) }
    if (slash > 0) {
      const dir = m.slice(0, slash)
      const dSlash = dir.lastIndexOf("/")
      dirSegments.add(dSlash >= 0 ? dir.slice(dSlash + 1) : dir)
    }
  }
  const EXTS = [".py", ".pyi", ".pyw"]
  const hasPathSuffix = (suffix: string): boolean => {
    for (const p of paths) for (const ext of EXTS) {
      if (p === suffix + ext || p.endsWith(`/${suffix}${ext}`) || p.endsWith(`/${suffix}/__init__${ext}`)) return true
    }
    return false
  }
  return (module: string): "project-local" | "third-party" | "unknown" => {
    const m = String(module ?? "").trim()
    if (m === "" || m.startsWith(".")) return "unknown"
    const segments = m.split(".").filter((s) => s.length > 0)
    if (segments.length === 0) return "unknown"
    for (let k = segments.length; k >= 2; k--) {
      if (hasPathSuffix(segments.slice(segments.length - k).join("/"))) return "project-local"
    }
    const root = segments[0]!
    if (stems.has(root) || dirSegments.has(root)) return "unknown"
    return "third-party"
  }
}

/** THE DECLARATION NAMES THE PROJECT PUBLISHES, per project — the key space the gate resolves in. */
function publishedNames(index: any): Set<string> {
  const out = new Set<string>()
  for (const n of index.symbolNames ?? []) out.add(n)
  return out
}

const pop = admittedPythonFiles()
console.error(`population: ${pop.files.length} admitted .py/.pyi/.pyw across ${pop.repos.length} repos · absent ${pop.absent} · overCap ${pop.overCap}`)

const parser: any = await ASTEngine.getParser("python")

type Class = {
  /** total imports edges */
  total: number
  /** project-local, retargeted by the once-question (index says declared once) */
  retargeted: number
  /** project-local, retargeted AND the project publishes the name (TARGETABLE) */
  retargetedTargetable: number
  /** project-local, retargeted but the project does NOT publish the name */
  retargetedUntargetable: number
  /** project-local, item declared MORE THAN ONCE (ambiguous by the once-question) */
  ambiguousItem: number
  /** project-local, item NOT declared at all (absent) */
  absentItem: number
  /** project-local namespace import (no single item bound) */
  namespace: number
  /** project-local, item is itself dotted */
  dottedItem: number
  /** third-party module claim */
  thirdParty: number
  /**
   * THE PROJECT SHOWS A TRACE OF THE ROOT — the index's `unknown` verdict: a same-named file stem
   * or directory basename exists somewhere in the project, but the dotted path does not match it.
   * This is the class the ARBITER'S PROJECT-ABSOLUTE REFINER leaves UNVERIFIABLE (ext?), and it is
   * NOT a project-local import and NOT a third-party one: the project MIGHT ship the module. The
   * first version of this census folded it into `notAsked`, which is why the D7 W2 partition could
   * not sum to the whole without an unnamed remainder.
   */
  unknown: number
  /** relative / __future__ / no module at all / otherwise not asked */
  notAsked: number
  /** CROSS-CHECK: the analyzer's respell marker disagreed with the index's once-question */
  respellDisagreement: number
}
const zero = (): Class => ({
  total: 0, retargeted: 0, retargetedTargetable: 0, retargetedUntargetable: 0,
  ambiguousItem: 0, absentItem: 0, namespace: 0, dottedItem: 0, thirdParty: 0,
  unknown: 0, notAsked: 0, respellDisagreement: 0,
})
const global = zero()
const perRepo: Array<{ repo: string; files: number; c: Class }> = []
/** THE UNTARGETABLE SAMPLES — the rows a retarget would leave unresolved, named. */
const untargetableSamples: string[] = []

const repoNames = [...new Set(pop.files.map((f) => f.slice(CR.length + 1).split(path.sep)[0]!))].sort()
for (const repo of repoNames) {
  const files = pop.files.filter((f) => f.slice(CR.length + 1).split(path.sep)[0] === repo)
  const trees: any[] = []
  const contents: string[] = []
  for (const f of files) {
    let text: string | null = null
    try { text = readFileSync(f, "utf8") } catch { text = null }
    if (text === null) continue
    const tree = parser.parse(text)
    if (!tree) continue
    trees.push({ path: f, tree })
    contents.push(text)
  }
  if (trees.length === 0) continue
  const index = buildProjectIndex(trees as any, PYTHON_DECLARATION_SPEC)
  index.complete = true
  const locality = localityOf(index.modules ?? new Set<string>())
  const published = publishedNames(index)
  const analyzer = new RealPythonAnalyzer()
  const c = zero()
  for (let i = 0; i < trees.length; i++) {
    const f = files[i]!
    let r: any
    try { r = analyzer.analyze(trees[i]!.tree.rootNode, contents[i]!, f, { projectIndex: index } as any) } catch { continue }
    for (const rel of r.relationships ?? []) {
      if (String(rel.type ?? rel.relationshipType ?? "") !== "imports") continue
      const md = rel.metadata ?? {}
      c.total++
      const target = String(rel.target ?? "")
      let module = typeof md.module === "string" ? String(md.module) : ""
      const colon = target.lastIndexOf(":")
      if (module === "" && colon > 0) module = target.slice(0, colon)
      if (module === "" || module.startsWith(".") || module === "__future__") { c.notAsked++; continue }
      const verdict = locality(module)
      if (verdict === "third-party") { c.thirdParty++; continue }
      // THE PROJECT SHOWS A TRACE OF THE ROOT — the index's `unknown` verdict, and the class the
      // arbiter's project-absolute refiner leaves UNVERIFIABLE. It is its own bucket: the project
      // MIGHT ship the module, so neither a project-local answer nor a third-party claim is safe.
      if (verdict === "unknown") { c.unknown++; continue }
      // PROJECT-LOCAL. THE SHAPE SPLIT.
      //
      // THE ITEM, READ FROM THE SOURCE SPELLING, NOT FROM THE RESPELLED TARGET. The analyzer
      // RE-SPELLS a project-local import's target to the item it binds (`module:item` -> `item`),
      // so a target that no longer carries a colon is an ALREADY-RESPELLED edge and its item is
      // the target itself. The first version of this census read `item = "*"` for every respelled
      // edge and counted the whole retargeted class as `namespace` — a partition that did not
      // describe the population it claimed to.
      const respelled = typeof md.projectIndexResolution === "string"
      const item = respelled ? target : (colon > 0 ? target.slice(colon + 1) : "*")
      if (item === "" || item === "*") { c.namespace++; continue }
      if (item.indexOf(".") !== -1) { c.dottedItem++; continue }
      const count = index.symbolCounts?.get(item) ?? 0
      if (count > 1) { c.ambiguousItem++; continue }
      if (count === 0) { c.absentItem++; continue }
      // DECLARED ONCE — the retarget the once-question makes.
      c.retargeted++
      // THE CROSS-CHECK: the analyzer respells exactly when the once-question is true. A
      // disagreement is a defect in the analyzer's own test, and it is counted, not smoothed.
      if (respelled !== (count === 1)) c.respellDisagreement++
      if (published.has(item)) c.retargetedTargetable++
      else {
        c.retargetedUntargetable++
        if (untargetableSamples.length < 40) {
          untargetableSamples.push(`${path.relative(CR, f)} · ${target} · module ${module} · symbolCounts ${count} · published ${published.has(item)}`)
        }
      }
    }
  }
  for (const k of Object.keys(global) as Array<keyof Class>) global[k] += c[k]
  perRepo.push({ repo, files: trees.length, c })
  console.error(`  ${repo.padEnd(26)} files=${String(trees.length).padEnd(6)} imports=${String(c.total).padStart(7)} local=${String(c.retargeted + c.ambiguousItem + c.absentItem + c.namespace + c.dottedItem).padStart(7)} retargeted=${String(c.retargeted).padStart(6)} targetable=${String(c.retargetedTargetable).padStart(6)} unknown=${String(c.unknown).padStart(6)}`)
}

const projectLocal = global.retargeted + global.ambiguousItem + global.absentItem + global.namespace + global.dottedItem
const bucketSum = global.thirdParty + global.unknown + global.notAsked + projectLocal
console.log(`\nPYTHON PROJECT-LOCAL IMPORTS CENSUS — whole admitted population (${pop.files.length} files, ${pop.repos.length} repos)`)
console.log(`total imports edges: ${global.total}`)
console.log(`\nCLASS SPLIT (whole population)`)
console.log(`  third-party module claim (moduleNamespace)     ${String(global.thirdParty).padStart(8)}`)
console.log(`  PROJECT SHOWS A TRACE OF THE ROOT (unknown)     ${String(global.unknown).padStart(8)}   <- the ext? class: the project MIGHT ship the module`)
console.log(`  not asked (relative / __future__ / no module)   ${String(global.notAsked).padStart(8)}`)
console.log(`  PROJECT-LOCAL total                             ${String(projectLocal).padStart(8)}`)
console.log(`    retargeted (item declared ONCE)               ${String(global.retargeted).padStart(8)}`)
console.log(`      of which TARGETABLE (project publishes it)  ${String(global.retargetedTargetable).padStart(8)}   <- A REAL RESOLUTION`)
console.log(`      of which UNTARGETABLE (not published)        ${String(global.retargetedUntargetable).padStart(8)}   <- a retarget that would stay unresolved`)
console.log(`    ambiguous item (symbolCounts > 1)             ${String(global.ambiguousItem).padStart(8)}`)
console.log(`    absent item (symbolCounts 0)                  ${String(global.absentItem).padStart(8)}`)
console.log(`    namespace import (item *)                     ${String(global.namespace).padStart(8)}`)
console.log(`    dotted item                                   ${String(global.dottedItem).padStart(8)}`)
console.log(`\nCLOSURE: ${global.thirdParty} + ${global.unknown} + ${global.notAsked} + ${projectLocal} = ${bucketSum} vs total ${global.total} — ${bucketSum === global.total ? "EXACT" : "MISMATCH"}`)
console.log(`CROSS-CHECK (the analyzer's respell vs the index's once-question): disagreements ${global.respellDisagreement}`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    population: { files: pop.files.length, repos: pop.repos.length, absent: pop.absent, overCap: pop.overCap },
    global, perRepo, untargetableSamples,
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}
