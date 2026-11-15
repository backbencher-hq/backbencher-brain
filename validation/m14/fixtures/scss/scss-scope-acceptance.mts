/**
 * THE ACCEPTANCE BOWED BY `07aa75c80` — the file-scoped identity for SCSS-added symbols.
 *
 * SAME-PROCESS A/B over ONE COMPLETE REPOSITORY: every admitted `.scss` file is parsed ONCE and run
 * through BOTH analyzers (the pre-fix revision from `git show 07aa75c80~1` and the tree's), so the
 * population is identical by construction and no stride is involved.
 *
 * THE GATE'S OWN CLASSIFICATION (`classifyEdge`) against the CURRENT arm's key space (names plus
 * qualifiedName aliases, with kinds), per type, and the three buckets are required to SUM to the edge
 * count — a partition that does not close is a residual with somewhere to hide.
 *
 * THE PRE-REGISTERED FALSIFIER: the class the fix exists for is "the same name declared by MORE THAN
 * ONE FILE of one project" — a `$variable` is a THEME's property, so `catppuccin/{_frappe,_macchiato,
 * _mocha}.scss` each declare `$catppuccin-rosewater`. Its before/after is reported separately, because
 * if THAT class does not move the fix is not doing what its comment says.
 *
 * AND THE FALSE-BINDING CHECK: a respelled edge must bind to a declaration IN ITS OWN FILE (the
 * delegate's rule is that the discriminator rides the prefix). An edge whose respelled target binds
 * elsewhere is a false binding, and 0 is asserted with the check that shows it.
 *
 * USAGE  npx tsx validation/m14/fixtures/scss/scss-scope-acceptance.mts <repo>
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { classifyEdge } from "../../../../script/m14/incoming-rule"
import { getParser } from "../../../../src/ast/engine"
import { RealScssAnalyzer as After } from "../../../../src/ast/real-scss-analyzer"
import { RealScssAnalyzer as Before } from "../../../../src/ast/real-scss-analyzer-prefix-scratch"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPO = process.argv[2]
if (!REPO) { console.error("usage: scss-scope-acceptance.mts <repo>"); process.exit(2) }
const dir = path.join(CR, REPO)
const rels = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
  .split("\0").filter((f) => f.toLowerCase().endsWith(".scss"))
const files = rels.filter((f) => { try { return statSync(path.join(dir, f)).size <= 1024 * 1024 } catch { return false } })
const parser = await getParser("scss")

type Arm = { edges: any[]; symbols: any[] }
const arms: { before: Arm; after: Arm }[] = []
for (const rel of files) {
  const abs = path.join(dir, rel)
  const text = readFileSync(abs, "utf8")
  const tree: any = await parser.parse(text, path.basename(rel))
  const out: any = {}
  for (const [key, A] of [["before", Before], ["after", After]] as const) {
    try { const r: any = new (A as any)().analyze(tree.rootNode, text, abs); out[key] = { edges: r?.relationships ?? [], symbols: r?.symbols ?? [] } }
    catch { out[key] = { edges: [], symbols: [] } }
  }
  arms.push({ before: out.before, after: out.after })
}

// THE KEY SPACE, from the CURRENT arm (the state the gate would see), plus the name -> files map
const decl = new Map<string, number>()
const kinds = new Map<string, Set<string>>()
const nameFiles = new Map<string, Set<string>>()
for (let i = 0; i < files.length; i++) {
  const { after } = arms[i]
  for (const s of after.symbols) {
    for (const key of [String(s?.name ?? ""), String(s?.qualifiedName ?? "")]) {
      if (!key) continue
      decl.set(key, (decl.get(key) ?? 0) + 1)
      let ks = kinds.get(key); if (!ks) kinds.set(key, (ks = new Set())); ks.add(String(s?.kind ?? ""))
      let fs = nameFiles.get(key); if (!fs) nameFiles.set(key, (fs = new Set())); fs.add(files[i])
    }
  }
}
// THE COLLISION CLASS: names declared by more than one FILE of this project
const colliding = new Set<string>()
for (const [name, fs] of nameFiles) if (fs.size > 1) colliding.add(name)

const bucket = (arm: Arm) => {
  const perType: Record<string, Record<string, number>> = {}
  let onCollisions: Record<string, number> = {}
  for (const e of arm.edges) {
    const type = String(e?.type ?? "")
    const tgt = String(e?.target ?? "")
    if (!tgt) continue
    const c: any = classifyEdge(decl, kinds, tgt, null)
    const out = String(c?.outcome ?? "?")
    perType[type] = perType[type] ?? {}
    perType[type][out] = (perType[type][out] ?? 0) + 1
    // the class the fix exists for: a target whose BARE name is declared by >1 file here
    if (!tgt.includes("::") && colliding.has(tgt)) onCollisions[out] = (onCollisions[out] ?? 0) + 1
  }
  return { perType, onCollisions }
}
const before = bucket(arms.reduce((a, x) => ({ edges: a.edges.concat(x.before.edges), symbols: [] }), { edges: [], symbols: [] } as Arm))
const after = bucket(arms.reduce((a, x) => ({ edges: a.edges.concat(x.after.edges), symbols: [] }), { edges: [], symbols: [] } as Arm))
// FALSE BINDINGS: a respelled target whose declaration is NOT in the edge's own file
let falseBindings = 0, respelledChecked = 0
for (let i = 0; i < files.length; i++) {
  for (const e of arms[i].after.edges) {
    const tgt = String(e?.target ?? "")
    if (!tgt.includes("::")) continue
    respelledChecked++
    const fs = nameFiles.get(tgt)
    if (!fs || !fs.has(files[i])) falseBindings++
  }
}
const sum = (t: Record<string, number>) => Object.values(t).reduce((a, b) => a + b, 0)
const report = {
  repo: REPO, files: files.length,
  partition: {
    before: Object.fromEntries(Object.entries(before.perType).map(([k, v]) => [k, { ...v, total: sum(v) }])),
    after: Object.fromEntries(Object.entries(after.perType).map(([k, v]) => [k, { ...v, total: sum(v) }])),
  },
  theCollisionClass: { collidingNames: colliding.size, before: before.onCollisions, after: after.onCollisions },
  falseBindings: { respelledEdgesChecked: respelledChecked, falseBindings },
}
writeFileSync(`validation/m14/fixtures/scss/scope-acceptance-${REPO}.json`, JSON.stringify(report, null, 2) + "\n")
const t = (p: any, ty: string) => { const v = p.perType[ty] ?? {}; return `${ty} ${JSON.stringify(v)}` }
console.log(`[${REPO}] files ${files.length} | colliding names ${colliding.size} | respelled checked ${respelledChecked} | FALSE BINDINGS ${falseBindings}`)
for (const ty of ["references", "exports", "calls", "uses", "overrides", "imports"]) {
  console.log(`   ${ty}\n      before ${JSON.stringify(before.perType[ty] ?? {})}\n      after  ${JSON.stringify(after.perType[ty] ?? {})}`)
}
console.log(`   COLLISION CLASS before ${JSON.stringify(before.onCollisions)} -> after ${JSON.stringify(after.onCollisions)}`)
