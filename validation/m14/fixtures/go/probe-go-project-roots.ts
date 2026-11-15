/**
 * GO — ITERATION 3, STEP 1: THE PROJECT-SCOPE REACHABILITY INTERSECTION. **Writes no analyzer code.**
 *
 * THE QUESTION, from GO-STATE §9 and the Lead's iteration-3 brief: of the 4,789 unresolved `calls` edges
 * whose target root the edge's own file neither declares nor imports (the `dec.Decode` shape), how many
 * name a root that the SAME PROJECT declares IN ANOTHER FILE? Only those are reachable by a project-scope
 * pass. `r.reader.SearchWhere` is a value/receiver chain and is not reachable this way (its receiver's
 * TYPE is unknown per file), so it is counted apart rather than folded in.
 *
 * WHAT IT DOES NOT DO: it does not build a `ProjectIndex`, and it does not emit a claim. The project
 * declaration set here is a SOURCE SCAN of every `.go` file in the edge's own repository (whole repo, not
 * the 400-file stride), because the question is a set-membership question and the stride cannot answer it
 * — a root declared in an unsampled sibling file is exactly the case the class exists for.
 *
 * RUN: bun run validation/m14/fixtures/go/probe-go-project-roots.ts        (one instrument, foreground)
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { classifyEdge } from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const MAX_FILES = Number(process.env.BB_MAX_FILES ?? 400)
const LANE = "go"
const repoOf = (f: string) => path.join(CR, f.slice(CR.length + 1).split(path.sep)[0])

/* ── discovery: the gate's own rule (git ls-files | admit .go | 1 MB cap | sort | stride) ───────── */
type Repo = { name: string; dir: string; files: string[] }
const repos = new Map<string, Repo>()
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  const go = tracked.filter((r) => r.toLowerCase().endsWith(`.${LANE}`)).map((r) => path.join(dir, r))
    .filter((abs) => { try { return statSync(abs).size <= SIZE_CAP } catch { return false } })
  if (go.length) repos.set(name, { name, dir, files: go })
}
const allFiles = [...repos.values()].flatMap((r) => r.files).sort()
const stride = Math.max(1, Math.floor(allFiles.length / MAX_FILES))
const sample: string[] = []
for (let i = 0; i < allFiles.length && sample.length < MAX_FILES; i += stride) sample.push(allFiles[i])
console.error(`discovery: ${sample.length} of ${allFiles.length} .go files (stride ${stride}), ${repos.size} repos`)

/* ── pass 1: parse the stride, build the run key space, find the 4,789-shaped unresolved calls ──── */
const names = new Map<string, number>()
const kinds = new Map<string, Set<string>>()
const add = (n: string, k: string) => {
  names.set(n, (names.get(n) ?? 0) + 1)
  let s = kinds.get(n); if (!s) kinds.set(n, (s = new Set())); s.add(k)
}
const parsed: { file: string; repo: string; symbols: any[]; rels: any[]; imports: Set<string>; declared: Set<string> }[] = []
for (const f of sample) {
  let r: any
  try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { continue }
  if (!r) continue
  const syms = Array.isArray(r.symbols) ? r.symbols : []
  for (const s of syms) if (s?.name) add(String(s.name), String(s?.kind ?? "unknown"))
  const imports = new Set<string>()
  for (const imp of r.imports ?? []) {
    const mod = String(imp.path ?? imp.module ?? "")
    const used = String(imp.name ?? imp.alias ?? mod.split("/").pop() ?? "")
    if (used) imports.add(used)
  }
  parsed.push({
    file: f, repo: repoOf(f), symbols: syms,
    rels: Array.isArray(r.relationships) ? r.relationships : [],
    imports,
    declared: new Set(syms.map((s: any) => String(s?.name ?? "")).filter(Boolean)),
  })
}

/** root of `a.b.C` is `a`; `r.reader.SearchWhere`'s root is `r`. */
const rootOf = (tgt: string) => (tgt.includes(".") ? tgt.slice(0, tgt.indexOf(".")) : "")
const receiverShaped = (root: string) => /^[a-z][A-Za-z0-9]?$/.test(root) // `r`, `t`, `db` — a VALUE name, one char or a short lowercase word

let unresolvedCalls = 0
const roots = new Map<string, { edges: number; repos: Set<string> }>()
for (const fi of parsed) {
  for (const rel of fi.rels) {
    const t = String(rel?.type ?? rel?.kind ?? "")
    if (t !== "calls") continue
    const tgt = String(rel?.target ?? "")
    if (!tgt) continue
    const c = classifyEdge(names, kinds, tgt, null, undefined, false)
    if (c.outcome !== "unresolved") continue
    unresolvedCalls++
    // THE EMITTED TARGET IS A LEAF — the family contract pins it (`Decode`), and the QUALIFIED
    // SPELLING lives in metadata (`callExpression`, e.g. `dec.Decode`). Reading the root off the
    // emitted target returns "" for every edge and makes this probe report zero; that is the trap the
    // lane's head comment names, and the first run of this probe fell into it.
    const md = rel?.metadata ?? {}
    const qualified = String(md.callExpression ?? "")
    const root = rootOf(qualified)
    if (!root) continue
    if (fi.declared.has(root) || fi.imports.has(root)) continue // not the 4,789 shape
    if (receiverShaped(root)) continue // `r.reader.…` — counted apart, NOT reachable by a project pass
    const e = roots.get(root) ?? { edges: 0, repos: new Set<string>() }
    e.edges++
    e.repos.add(path.basename(fi.repo))
    roots.set(root, e)
  }
}
console.error(`unresolved calls in the stride: ${unresolvedCalls}`)
console.error(`package-rooted, file does not declare or import the root: ${[...roots.values()].reduce((a, b) => a + b.edges, 0)} edges over ${roots.size} distinct roots`)

/* ── pass 2: WHOLE-REPO declaration scan — every .go file of the root's own repository ───────────── */
const SHAPES = (n: string): RegExp[] => [
  new RegExp(`^package\\s+${n}\\b`), // another PACKAGE of the same module
  new RegExp(`^func\\s+(?:\\([^)]*\\)\\s*)?${n}\\b`), // function or method
  new RegExp(`^type\\s+${n}\\b`), // type
  new RegExp(`^var\\s+${n}\\b`), // package-level var
  new RegExp(`^const\\s+${n}\\b`), // package-level const
]
const scanCache = new Map<string, { pkg: Set<string>; other: Set<string> }>()
/**
 * A ROOT IS REACHABLE ONLY IF ANOTHER FILE DECLARES IT AS A **PACKAGE**.
 *
 * The first version of this probe accepted ANY declaration shape, and that turned receiver variables
 * into "reachable roots": `client.Exec`, `req.Body`, `output.Name` matched a `func client(...)` or a
 * `var output` somewhere else in the repo and were counted as project-scope wins. **They are not.**
 * `client` in `client.Exec` is a VALUE the file holds; a declaration key space cannot bind it, and
 * neither can a project index — only a TYPE can, which is the `r.reader.SearchWhere` wall the Lead
 * ruled out. The `pkg` set below is the only set that makes `X.Name` a PACKAGE reference, i.e. a
 * cross-file target inside the same module. `other` is kept so the misclassification is COUNTED
 * rather than silently dropped.
 */
function repoDeclarations(repo: string): { pkg: Set<string>; other: Set<string> } {
  const hit = scanCache.get(repo)
  if (hit) return hit
  const pkg = new Set<string>()
  const other = new Set<string>()
  const r = repos.get(repo)
  if (r) for (const f of r.files) {
    let text: string
    try { text = readFileSync(f, "utf8") } catch { continue }
    for (const line of text.split("\n")) {
      const t = line.trim()
      const pm = /^package\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(t)
      if (pm && pm[1]) pkg.add(pm[1])
      const m = /^(?:func|type|var|const)\s+(?:\s*\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)/.exec(t)
      if (m && m[1]) other.add(m[1])
    }
  }
  const out = { pkg, other }
  scanCache.set(repo, out)
  return out
}

let reachableEdges = 0
let reachableRoots = 0
let valueOnlyEdges = 0
let valueOnlyRoots = 0
const examples: string[] = []
const samplesFor: string[] = []
for (const [root, e] of [...roots].sort((a, b) => b[1].edges - a[1].edges)) {
  let asPackage = false
  let asOther = false
  for (const repoName of e.repos) {
    const d = repoDeclarations(repoName)
    if (d.pkg.has(root)) asPackage = true
    if (d.other.has(root)) asOther = true
  }
  if (asPackage) {
    reachableRoots++
    reachableEdges += e.edges
    if (examples.length < 8) {
      examples.push(`REACHABLE(package) ${root} (${e.edges})`)
      // HAND-READ MATERIAL: the source line for the largest reachable roots, because "the repo has a
      // `package client`" is NOT the same claim as "THIS file's `client.Exec` names it". Go requires an
      // import for that, and the bucket is defined by the file NOT importing the root — so the only way
      // to settle it is to read the line.
      if (samplesFor.length < 6) for (const fi of parsed) {
        for (const rel of fi.rels) {
          const t = String(rel?.type ?? "")
          if (t !== "calls") continue
          const q = String((rel?.metadata ?? {}).callExpression ?? "")
          if (!q.startsWith(`${root}.`)) continue
          const c2 = classifyEdge(names, kinds, String(rel?.target ?? ""), null, undefined, false)
          if (c2.outcome !== "unresolved") continue
          let line = ""
          try { line = readFileSync(fi.file, "utf8").split("\n")[Number(rel?.line ?? 0) - 1]?.trim().slice(0, 110) ?? "" } catch {}
          samplesFor.push(`${root}: ${path.relative(CR, fi.file)}:${rel?.line}  ${line}`)
          break
        }
        if (samplesFor.length >= 6) break
      }
    }
  } else if (asOther) {
    valueOnlyRoots++
    valueOnlyEdges += e.edges
    if (examples.length < 14) examples.push(`VALUE-ONLY ${root} (${e.edges})`)
  } else if (examples.length < 18) examples.push(`NOT-REACHABLE ${root} (${e.edges})`)
}
const totalEdges = [...roots.values()].reduce((a, b) => a + b.edges, 0)
console.log(`\n=== GO ITERATION 3 — PROJECT-SCOPE INTERSECTION ===`)
console.log(`unresolved calls in the 400-file stride:                         ${unresolvedCalls}`)
console.log(`of those, package-rooted and neither declared nor imported:      ${totalEdges} edges / ${roots.size} roots`)
console.log(`roots the SAME PROJECT declares in another file (REACHABLE):     ${reachableRoots} roots / ${reachableEdges} edges`)
console.log(`reachable share of that bucket:                                  ${(100 * reachableEdges / Math.max(1, totalEdges)).toFixed(1)}%`)
console.log(`  of those, roots declared by 'package X' = a REAL package:       ${reachableRoots} roots / ${reachableEdges} edges`)
console.log(`  roots declared only as func/type/var/const = VALUE names:       ${valueOnlyRoots} roots / ${valueOnlyEdges} edges`)
console.log(`roots NOT declared anywhere in their project (NOT reachable):     ${roots.size - reachableRoots - valueOnlyRoots} roots / ${totalEdges - reachableEdges - valueOnlyEdges} edges`)
console.log(`\nexamples: ${examples.join(" · ")}`)
console.log(`\nHAND-READ SAMPLES (source lines for the largest 'reachable' roots):`)
for (const x of samplesFor) console.log(`  ${x}`)
console.log(`\nVERDICT INPUT, not a claim: only the REACHABLE line above is what a project-scope pass could reach.`)
console.log(`A root declared nowhere in its project cannot be resolved by a project index — that is the julia class.`)
