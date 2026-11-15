/**
 * CAUSE 1 — THE `imports` SPLIT, per lane, in the gate's own columns.
 *
 * THE RULING (the Lead's): `imports` should target the DECLARATION where the project has one, and carry
 * the module in metadata; the EXTERNAL half is a BOUNDARY to be RULED with a measured count.
 *
 * FOUR TARGET SHAPES, and they are not the same question:
 *   colon      `${module}:${item}`   (typescript, javascript, python) — item = after the last colon
 *   moduleName `a.b.C`               (java, groovy) — the whole target is the module, the leaf is `C`
 *   includePath `foo.h` / `<vector>` (cpp, c) — a FILE or a system header, not a name at all
 *
 * LOCALITY IS DECIDED PER SHAPE, and never by whether the edge resolves:
 *   colon      — relative (`./`, `../`) or absolute specifier
 *   moduleName — the target's PACKAGE PREFIX matches a package the project's own files declare
 *                (the import edge's `source` IS the importing file's package, so the project's set of
 *                packages is read off the population itself)
 *   includePath — a quoted include whose basename names an admitted file in the project
 *
 * USAGE  BB_CC_REPOS=<repo> npx tsx validation/m14/fixtures/scss/lane-imports-split.mts <lane>
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { classifyEdge } from "../../../../script/m14/incoming-rule"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANE = process.argv[2]
const ONLY_REPOS = (process.env.BB_CC_REPOS ?? "").split(",").map((x) => x.trim()).filter(Boolean)
if (!LANE) { console.error("usage: lane-imports-split.mts <lane>"); process.exit(2) }

type Row = { repo: string; rel: string; abs: string }
const rows: Row[] = []
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
    try { if (statSync(abs).size > 1024 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== LANE) continue
    rows.push({ repo: name, rel, abs })
  }
}

const decl = new Map<string, Map<string, number>>()
const kinds = new Map<string, Map<string, Set<string>>>()
type Edge = { repo: string; file: string; target: string; shape: "colon" | "moduleName" | "includePath"; module: string; item: string; source: string }
const edges: Edge[] = []
let parsed = 0, failed = 0
const packageByRepo = new Map<string, Set<string>>()
const filesByRepo = new Map<string, Set<string>>()

for (const f of rows) {
  let r: any
  try { r = await parseFile(f.abs, path.join(CR, f.repo), { projectRoot: path.join(CR, f.repo) } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  if (!decl.has(f.repo)) { decl.set(f.repo, new Map()); kinds.set(f.repo, new Map()); packageByRepo.set(f.repo, new Set()); filesByRepo.set(f.repo, new Set()) }
  const d = decl.get(f.repo)!, k = kinds.get(f.repo)!
  const bump = (key: string, kind: string) => { d.set(key, (d.get(key) ?? 0) + 1); let s = k.get(key); if (!s) k.set(key, (s = new Set())); s.add(kind) }
  filesByRepo.get(f.repo)!.add(f.rel.split(path.sep).join("/"))
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? ""); if (!name) continue
    const kind = String(s?.kind ?? "")
    bump(name, kind)
    const q = String(s?.qualifiedName ?? ""); if (q && q !== name) bump(q, kind)
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    if (String(rel?.type ?? rel?.relationshipType ?? "") !== "imports") continue
    const target = String(rel?.target ?? ""); if (!target) continue
    const md: any = rel?.metadata ?? {}
    const src = String(rel?.source ?? "")
    if (src && src !== "root" && src !== "global") packageByRepo.get(f.repo)!.add(src)
    if (typeof md.module === "string" && md.module.length > 0) {
      edges.push({ repo: f.repo, file: f.rel, target, shape: "colon", module: String(md.module), item: target.includes(":") ? target.slice(target.lastIndexOf(":") + 1) : target, source: src })
    } else if (LANE === "java" || LANE === "groovy") {
      const leaf = target.includes(".") ? target.slice(target.lastIndexOf(".") + 1) : target
      edges.push({ repo: f.repo, file: f.rel, target, shape: "moduleName", module: target, item: leaf, source: src })
    } else {
      // cpp / c: an include path. `<vector>` is a system header; `"foo.h"` is project-relative.
      const systemish = target.startsWith("<")
      const base = target.replace(/^[<"]|[>"]$/g, "").split("/").pop() ?? target
      edges.push({ repo: f.repo, file: f.rel, target, shape: "includePath", module: systemish ? `<${base}>` : base, item: base, source: src })
    }
  }
}

const isLocal = (e: Edge): boolean => {
  const repo = e.repo
  if (e.shape === "colon") return e.module.startsWith(".") || e.module.startsWith("/")
  if (e.shape === "moduleName") {
    // JAVA/GROOVY: the package IS the directory. An import is LOCAL iff the FQN maps onto a file the
    // project actually holds — `grails.util.Holder` -> `grails/util/Holder.java`. The first version of
    // this test asked whether the import's package matched a package declared by the importing files,
    // and it read **0 LOCAL of 33,734** on grails-core: the importing package is not a population the
    // edges carry, so the test was asking a question the data could not answer. This one reads the
    // FILES, which are the population.
    const parts = e.module.split(".")
    const leaf = parts.pop() ?? ""
    if (leaf === "") return false
    const dir = parts.join("/")
    const files = filesByRepo.get(repo) ?? new Set<string>()
    for (const p of files) {
      if (!p.endsWith(`/${leaf}.java`) && !p.endsWith(`/${leaf}.groovy`) && !p.endsWith(`/${leaf}.kt`) && !p.endsWith(`/${leaf}.scala`) && !p.endsWith(`/${leaf}.gradle`)) continue
      const dirOf = p.slice(0, p.lastIndexOf("/"))
      if (dir === "" || dirOf === dir || dirOf.endsWith("/" + dir)) return true
    }
    return false
  }
  // includePath: a quoted include whose basename names an admitted project file
  if (e.target.startsWith("<")) return false
  const files = filesByRepo.get(repo) ?? new Set<string>()
  for (const p of files) if ((p.split("/").pop() ?? "") === e.item) return true
  return false
}
const outcome = (e: Edge, tgt: string) => String((classifyEdge(decl.get(e.repo)!, kinds.get(e.repo)!, tgt, null) as any)?.outcome ?? "?")
const tally = (pred: (e: Edge) => boolean, fn: (e: Edge) => string) => {
  const t: Record<string, number> = {}
  for (const e of edges) { if (!pred(e)) continue; const key = fn(e); t[key] = (t[key] ?? 0) + 1 }
  return t
}
const LOCAL = (e: Edge) => isLocal(e)
const EXTERNAL = (e: Edge) => !isLocal(e)
const report = {
  instrument: "CAUSE 1 — the `imports` split (LOCAL vs EXTERNAL) with the ceiling in the gate's own columns",
  lane: LANE,
  population: { admitted: rows.length, parsed, failed, repos: decl.size, repoFilter: ONLY_REPOS.length ? ONLY_REPOS : "ALL" },
  scope: "per PROJECT (the repository a file belongs to) — the gate's default",
  importsEdges: edges.length,
  shapes: tally(() => true, (e) => e.shape),
  theSplit: { LOCAL: edges.filter(LOCAL).length, EXTERNAL: edges.filter(EXTERNAL).length },
  asEmitted: { LOCAL: tally(LOCAL, (e) => outcome(e, e.target)), EXTERNAL: tally(EXTERNAL, (e) => outcome(e, e.target)) },
  ceiling_onTheLeaf: {
    LOCAL: tally(LOCAL, (e) => outcome(e, e.item)),
    EXTERNAL: tally(EXTERNAL, (e) => outcome(e, e.item)),
  },
  /**
   * CAN THE ANALYZER DECIDE LOCALITY AT EMISSION? It has no project file list, so the path-based truth
   * above is NOT available to it. The candidate rule it CAN compute is the PACKAGE PREFIX: an import
   * sharing the first two name segments with the importing file's own package (`org.grails.*` for a file
   * under `org/grails/...`). This is the confusion matrix against the path truth, so the emission rule
   * is chosen by measurement rather than by hope.
   */
  packagePrefixHeuristic: (() => {
    const filePkg = (repo: string, file: string): string => {
      const segs = file.split("/")
      const anchor = Math.max(segs.lastIndexOf("java"), segs.lastIndexOf("groovy"), segs.lastIndexOf("kotlin"))
      const tail = anchor >= 0 ? segs.slice(anchor + 1, segs.length - 1) : segs.slice(0, segs.length - 1)
      return tail.join(".")
    }
    let tp = 0, fp = 0, fn = 0, tn = 0
    for (const e of edges) {
      if (e.shape !== "moduleName") continue
      const own = filePkg(e.repo, e.file)
      const segs = own.split(".").slice(0, 2).join(".")
      const heur = segs !== "" && segs !== "." && e.module.startsWith(segs + ".")
      const truth = LOCAL(e)
      if (heur && truth) tp++; else if (heur && !truth) fp++; else if (!heur && truth) fn++; else tn++
    }
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp)
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn)
    return { trueLocal: tp, falseLocal: fp, missedLocal: fn, trueExternal: tn, precision: Number(precision.toFixed(4)), recall: Number(recall.toFixed(4)) }
  })(),
  samples: { LOCAL: edges.filter(LOCAL).slice(0, 4).map((e) => `${e.target} -> leaf ${e.item}`), EXTERNAL: edges.filter(EXTERNAL).slice(0, 4).map((e) => e.target) },
}
writeFileSync(`validation/m14/fixtures/scss/imports-split-${LANE}.json`, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({ lane: LANE, population: report.population, edges: report.importsEdges, shapes: report.shapes, split: report.theSplit, asEmitted: report.asEmitted, ceiling: report.ceiling_onTheLeaf }, null, 2))
