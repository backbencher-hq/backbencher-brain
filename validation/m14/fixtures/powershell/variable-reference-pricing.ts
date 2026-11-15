// VARIABLE-REFERENCE PRICING (powershell) — what a DOCUMENT-SCOPED target would reach, and what it
// would mis-bind.
//
// THE CAUSE. `uses` is this lane's largest type and its largest ambiguous marker sets are all
// variable references: `isArgumentReference+isVariableReference` amb 13,682, `isAssignmentRead+
// isVariableReference` amb 5,696, `isReceiverReference+isVariableReference` amb 1,977 (the gate's own
// table, 1,181-file population). The analyzer emits them as
// `addRel(scope, name, Uses, …)` — the target is the BARE variable NAME (`a` for `$a`), so production
// can bind it only when that name has exactly ONE declaration in the whole project, and a name like
// `a` or `result` never does.
//
// THE CANDIDATE RULE, and it is the shape this lane's sibling yaml lane used for `needs:`: where the
// edge's OWN FILE declares that name as a VARIABLE, target the declaration's QUALIFIED NAME
// (file-scoped, therefore unique project-wide) instead of the bare name. It can only fire on
// evidence the file itself carries.
//
// PRICED BEFORE APPLIED, in both directions, because a rule that reaches an EXISTING declaration is a
// fix while a rule that guesses is a ruling:
//   CEILING  ambiguous uses edges the rule can retarget to a declaration that EXISTS and is UNIQUE
//   CONTROL  edges where the file declares that name MORE THAN ONCE (the rule would have to pick)
//   CONTROL  edges where the declaration exists but its qualified name is NOT unique project-wide
//
//   npx tsx validation/m14/fixtures/powershell/variable-reference-pricing.ts
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const REPO = process.env.BB_REPO || "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(`${REPO}/src/ast/pool-worker.ts`)
const { classifyEdge, externalClaimOf, isContainsEdge } = await import(`${REPO}/script/m14/incoming-rule.ts`)

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const EXTS = [".ps1", ".psm1", ".psd1"]

const perRepo = new Map<string, { root: string; files: string[] }>()
for (const name of readdirSync(CR).sort()) {
  const dir = join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  const files: string[] = []
  for (const rel of tracked) {
    if (!EXTS.some((e) => rel.toLowerCase().endsWith(e))) continue
    const abs = join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    files.push(abs)
  }
  if (files.length) perRepo.set(name, { root: dir, files })
}

let files = 0, ambUses = 0, varRef = 0, ceiling = 0, controlMulti = 0, controlNotUnique = 0, noOwnDecl = 0
const byMarker = new Map<string, { n: number; ceiling: number }>()
const samples: string[] = []

for (const [repo, { root, files: list }] of perRepo) {
  const projectDecl = new Map<string, number>()
  const projectKinds = new Map<string, Set<string>>()
  const pending: { e: any; abs: string; own: Map<string, string[]> }[] = []
  for (const abs of list) {
    let r: any
    try { r = await parseFile(abs, root, { projectRoot: root }) } catch { continue }
    if (!r) continue
    files++
    const own = new Map<string, string[]>()
    for (const s of r.symbols ?? []) {
      const nm = String(s?.name ?? "")
      if (nm.length === 0) continue
      const kind = String(s?.kind ?? "")
      const add = (k: string) => {
        projectDecl.set(k, (projectDecl.get(k) ?? 0) + 1)
        let ks = projectKinds.get(k); if (!ks) projectKinds.set(k, (ks = new Set())); ks.add(kind)
      }
      add(nm)
      const q = String(s?.qualifiedName ?? "")
      if (q.length > 0 && q !== nm) add(q)
      // VARIABLE ONLY, and the SCOPE travels with it. A `property` is a member of some object, not
      // a binding a read can see; and a variable is visible only where its declaring scope ENCLOSES
      // the read — the first version of this price ignored both and would have retargeted a
      // file-scope read of `$before` to a function-local `before`, which is a MIS-BIND rather than
      // a fix. The scope is the declaration's qualified name minus its own leaf.
      if (kind === "variable") {
        const dot = q.lastIndexOf(".")
        const scope = dot > 0 ? q.slice(0, dot) : ""
        const l = own.get(nm) ?? []
        l.push(scope)
        own.set(nm, l)
      }
    }
    for (const e of r.relationships ?? []) pending.push({ e, abs, own })
  }
  for (const { e, abs, own } of pending) {
    if (String(e.type) !== "uses") continue
    const md = e.metadata ?? {}
    const c = classifyEdge(projectDecl, projectKinds, String(e.target ?? ""), externalClaimOf(e), undefined, isContainsEdge("uses"))
    if (c.outcome !== "ambDeclOnly" && c.outcome !== "ambBoth") continue
    ambUses++
    if (md.isVariableReference !== true) continue
    varRef++
    const key = ["isArgumentReference", "isAssignmentRead", "isReceiverReference", "isMemberAccess", "isElementAccess"].filter((k) => md[k] === true).join("+") || "(other)"
    const b = byMarker.get(key) ?? { n: 0, ceiling: 0 }
    b.n++
    // VISIBLE means the declaring scope encloses the read's own scope path.
    const src = String(e.source ?? "")
    const visible = (own.get(String(e.target ?? "")) ?? []).filter((scope) => scope.length === 0 || src === scope || src.startsWith(`${scope}.`))
    const hits = visible.length > 0 ? visible : (own.get(String(e.target ?? "")) ?? [])
    if (hits.length === 0) { noOwnDecl++; byMarker.set(key, b); continue }
    if (hits.length > 1) { controlMulti++; byMarker.set(key, b); continue }
    const qn = `${hits[0]}.${String(e.target ?? "")}`
    if ((projectDecl.get(qn) ?? 0) !== 1) { controlNotUnique++; byMarker.set(key, b); continue }
    ceiling++
    b.ceiling++
    byMarker.set(key, b)
    if (samples.length < 8) samples.push(`    ${e.target}  ->  ${qn}   (scope ${hits[0] || "<doc>"})  @ ${abs.slice(root.length + 1)}`)
  }
}

console.log(`population: ${files} files across ${perRepo.size} repos`)
console.log(`ambiguous 'uses' edges: ${ambUses}`)
console.log(`  of which carry isVariableReference: ${varRef}`)
console.log(`\nPRICE of the document-scoped retarget, both directions:`)
console.log(`  CEILING   ${ceiling} edge(s) retargetable to a declaration that EXISTS in their own file and is UNIQUE project-wide`)
console.log(`  CONTROL   ${controlMulti} edge(s) whose file declares that name MORE THAN ONCE (the rule would have to pick)`)
console.log(`  CONTROL   ${controlNotUnique} edge(s) whose declaration's qualified name is not unique project-wide`)
console.log(`  no own-file variable declaration: ${noOwnDecl}  (the rule cannot fire: it needs the file's own evidence)`)
console.log(`\nby marker:`)
for (const [k, b] of [...byMarker.entries()].sort((x, y) => y[1].n - x[1].n)) console.log(`  ${String(b.n).padStart(7)}  ceiling ${String(b.ceiling).padStart(7)}  ${k}`)
if (samples.length) { console.log(`\nexamples:`); for (const s of samples) console.log(s) }
console.log(`\nVERDICT: ${ceiling > 0 && controlMulti === 0 && controlNotUnique === 0 ? "CLEAN — apply the rule" : "controls non-zero — read them before applying"}`)
