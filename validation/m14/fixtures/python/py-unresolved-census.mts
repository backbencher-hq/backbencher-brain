/**
 * PY-ROUND19 — WHAT EXACTLY IS STILL UNRESOLVED, BY NAMED EVIDENCE, ON THE GATE'S OWN
 * POPULATION AND ITS OWN RESOLUTION RULE.
 *
 * WHY THIS INSTRUMENT EXISTS. `python-endpoint-resolution.ts` classifies unresolved targets
 * by named axis, but it resolves against a POOLED 400-file slice while the gate resolves
 * PER PROJECT (production's scope) over a STRIDE sample. The two answer different questions,
 * and the programme has already paid for reading one as the other. This probe walks the
 * GATE'S population with the GATE'S rule — `classifyEdge` is imported from
 * `script/m14/incoming-rule.ts`, never re-implemented — and buckets every edge the arbiter
 * calls `unresolved` by evidence the ANALYZER already holds:
 *
 *   import-bound-target   the target is a name this file binds by a module-level,
 *                         non-relative, non-`__future__` import (`from pathlib import Path`)
 *   import-bound-route    the edge's `metadata.qualified` is a dotted route whose ROOT is
 *                         such a name (`unittest.TestCase`, `os.path.exists`)
 *   dynamic-reason        the edge's own reasonCode says the target is chosen at runtime
 *   builtin-leaf          the leaf is in `dir(builtins)` (the namespace claim's remit)
 *   imports-module-item   the edge is an `imports` edge (`mod:item` / `mod:*`)
 *   other                 none of the above — the class no claim can honestly carry
 *
 * The distinction this instrument exists to draw is between "the file's own import is the
 * evidence for where this name comes from" and "nothing in the file says". Only the first can
 * carry a claim that is not an invention; the second is the structurally closed class
 * PYTHON-FIX.md §3 measured.
 *
 * CLAIMS ARE IGNORED ON PURPOSE. `classifyEdge` is called with `claim: null`, so this is the
 * classification of the EDGES' names, not of the markers a fix has added: an edge the analyzer
 * has already certified external still appears in its evidence bucket, with `claimed` recorded
 * beside it. That makes one whole-population run answer BOTH questions — the raw residual by
 * evidence (the classification) and how much of each class a claim now covers.
 *
 * READ-ONLY: writes only the JSON passed with --out.
 *
 * Usage:
 *   bun run validation/m14/fixtures/python/py-unresolved-census.mts --max 400 --out x.json
 *   bun run validation/m14/fixtures/python/py-unresolved-census.mts --max 0   --out x.json
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { classifyEdge, externalClaimOf } from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const argv = process.argv.slice(2)
const argOf = (flag: string): string | undefined => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const MAX = Number(argOf("--max") ?? "400")
const EXT = argOf("--ext") ?? "py"
const OUT = argOf("--out")

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Label = (typeof ALL_TYPES)[number]
const ALIASES: Record<string, string> = {
  calls: "calls", call: "calls", uses: "uses", contains: "contains", composition: "contains",
  part_of: "contains", imports: "imports", brain_import: "imports", references: "references",
  depends_on: "references", related: "references", exports: "exports", provides: "exports",
  extends: "extends", inheritance: "extends", implements: "implements", implementation: "implements",
  overrides: "overrides", override: "overrides", instantiates: "instantiates",
}
const labelOf = (raw: string): Label | null => (ALIASES[raw] as Label) ?? undefined ?? null

const BUILTINS: Set<string> = (() => {
  try {
    const out = execFileSync("python3", ["-c", "import builtins, json; print(json.dumps(sorted(dir(builtins))))"], {
      encoding: "utf8", timeout: 10_000,
    })
    return new Set<string>(JSON.parse(out))
  } catch {
    return new Set<string>()
  }
})()
const DYNAMIC_REASONS = new Set([
  "dispatch-on-receiver", "dispatch-on-parameter", "member-read", "first-parent-guess",
])
const REFUSING_REASONS = new Set(["local-binding-target", "inline-type-parameter"])

// ── discovery: the gate's own rule (`discoverFiles`, incoming-gate.ts:323-420) ─────────────
function discover(): { files: string[]; admitted: string[]; total: number; repos: number } {
  const found: string[] = []
  const repos = new Set<string>()
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      if (!rel.toLowerCase().endsWith(`.${EXT}`)) continue
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > SIZE_CAP) continue
      } catch {
        continue
      }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  const total = found.length
  if (MAX <= 0 || total <= MAX) return { files: found, admitted: found, total, repos: repos.size }
  const stride = Math.max(1, Math.floor(total / MAX))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < MAX; i += stride) picked.push(found[i])
  return { files: picked, admitted: found, total, repos: repos.size }
}
const repoOf = (f: string): string => {
  const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
  return path.join(CR, rel.split(path.sep)[0]!)
}

/** Names this file binds at MODULE level by an import: the evidence a route/name is external. */
function moduleBoundNames(rels: any[]): { bound: Set<string>; modules: Set<string> } {
  const bound = new Set<string>()
  for (const r of rels) {
    if (String(r?.type ?? "") !== "imports") continue
    const md = (r?.metadata ?? {}) as Record<string, any>
    if (md.starImport === true) continue
    const tgt = String(r?.target ?? "")
    const colon = tgt.indexOf(":")
    const module = String(md.module ?? (colon > 0 ? tgt.slice(0, colon) : tgt.endsWith(":*") ? tgt.slice(0, -2) : tgt))
    // RELATIVE and __future__ imports are not external evidence: the first names this
    // project, the second binds no name at all (the analyzer's own PY-D19 comment).
    if (!module || module.startsWith(".") || module === "__future__") continue
    const as = md.importedAs
    if (typeof as === "string" && as.length > 0) { bound.add(as); continue }
    if (colon > 0) {
      const item = tgt.slice(colon + 1)
      // `import a.b` binds the ROOT `a`; `from a import b` binds the ITEM `b`;
      // `from a import *` is handled above (no single name is bound).
      if (item === "*") { bound.add(module.split(".")[0]!); continue }
      if (item !== "") bound.add(item)
      continue
    }
    // A bare module target with no item spelling: `import a.b`'s endpoint is `a.b:*`
    // normally, so this branch is the defensive case.
    bound.add(module.split(".")[0]!)
  }
  return { bound }
}

type Stat = {
  edges: number
  resolved: number
  amb: number
  unresolved: number
  ext: number
  claimed: number
  un: Record<string, { count: number; claimed: number; samples: string[] }>
}
const mk = (): Stat => ({ edges: 0, resolved: 0, amb: 0, unresolved: 0, ext: 0, claimed: 0, un: {} })
const stats = new Map<string, Stat>()
for (const t of ALL_TYPES) stats.set(t, mk())
const overall = mk()
const bump = (s: Stat, key: string, row: string, claimed: boolean) => {
  s.unresolved++
  const e = s.un[key] ?? (s.un[key] = { count: 0, claimed: 0, samples: [] })
  e.count++
  if (claimed) e.claimed++
  if (e.samples.length < 6) e.samples.push(row)
}

const { files, admitted, total, repos } = discover()
const admittedByRepo = new Map<string, Set<string>>()
for (const f of admitted) {
  const repo = repoOf(f)
  const set = admittedByRepo.get(repo) ?? new Set<string>()
  set.add(f.slice(repo.length + 1).split(path.sep).join("/"))
  admittedByRepo.set(repo, set)
}
const factsByRepo = new Map<string, { packages: Set<string>; files: Set<string>; sdkLib: boolean }>()
for (const [repo, set] of admittedByRepo) factsByRepo.set(repo, { packages: new Set(), files: set, sdkLib: false })

const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
const pending: Array<{ label: Label; tgt: string; claim: any; repo: string; file: string; ownFile: boolean; reason: string; route: string; moduleBound: Set<string>; ownNames: Set<string> }> = []
let parsed = 0
let failed = 0

for (const f of files) {
  const repo = repoOf(f)
  let r: any
  try {
    r = await parseFile(f, repo, { projectRoot: repo } as any)
    parsed++
  } catch {
    failed++
    continue
  }
  if (!r) { failed++; continue }
  let decl = projectDecl.get(repo)
  if (!decl) projectDecl.set(repo, (decl = new Map()))
  let kinds = projectKinds.get(repo)
  if (!kinds) projectKinds.set(repo, (kinds = new Map()))
  const countKey = (key: string, kind: string) => {
    decl!.set(key, (decl!.get(key) ?? 0) + 1)
    let ks = kinds!.get(key)
    if (!ks) kinds!.set(key, (ks = new Set()))
    ks.add(kind)
  }
  const ownNames = new Set<string>()
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (!name) continue
    ownNames.add(name)
    const kind = String(s?.kind ?? "")
    countKey(name, kind)
    const q = String(s?.qualifiedName ?? "")
    if (q.length > 0 && q !== name) countKey(q, kind)
  }
  const { bound } = moduleBoundNames(Array.isArray(r.relationships) ? r.relationships : [])
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = labelOf(String(rel?.type ?? rel?.relationshipType ?? ""))
    if (!label) continue
    const tgt = String(rel?.target ?? "")
    if (!tgt) continue
    const md = (rel?.metadata ?? {}) as Record<string, any>
    pending.push({
      label, tgt, claim: null, claimed: md.isExternalTarget === true || md.languageNamespace !== undefined,
      repo, file: f, ownFile: ownNames.has(tgt),
      reason: String(md.reasonCode ?? "none"), route: String(md.qualified ?? ""), moduleBound: bound, ownNames,
    })
  }
}

for (const p of pending) {
  const decl = projectDecl.get(p.repo)!
  const kinds = projectKinds.get(p.repo)!
  const facts = factsByRepo.get(p.repo)
  const out = classifyEdge(decl, kinds, p.tgt, p.claim, facts, p.label === "contains", p.ownFile)
  const s = stats.get(p.label)!
  s.edges++
  overall.edges++
  if (out.outcome === "resolved") { s.resolved++; overall.resolved++ }
  else if (out.outcome === "ambiguousByDecl" || out.outcome === "ambDeclOnly" || out.outcome === "ambBoth") { s.amb++; overall.amb++ }
  else if (out.outcome === "externalVerified") { s.ext++; overall.ext++ }
  else if (out.outcome === "unresolved") {
    const leaf = p.tgt.includes(":") ? p.tgt.slice(p.tgt.lastIndexOf(":") + 1) : p.tgt.slice(p.tgt.lastIndexOf(".") + 1)
    const routeRoot = p.route.includes(".") ? p.route.split(".")[0]! : ""
    const importBoundTarget = p.moduleBound.has(p.tgt)
    const importBoundRoute = routeRoot.length > 0 && p.moduleBound.has(routeRoot)
    const bucket =
      p.label === "imports" ? "imports-module-item"
      : importBoundTarget ? "import-bound-target"
      : importBoundRoute ? "import-bound-route"
      : DYNAMIC_REASONS.has(p.reason) ? "dynamic-reason"
      : BUILTINS.has(leaf) ? "builtin-leaf"
      : "other"
    if (p.claimed) { s.claimed++; overall.claimed++ }
    bump(s, bucket, `${path.relative(CR, p.file)}\t${p.tgt}\t${p.reason}\t${p.route}\t${p.claimed ? "CLAIMED" : ""}`, p.claimed)
    overall.unresolved++
    const e = overall.un[bucket] ?? (overall.un[bucket] = { count: 0, claimed: 0, samples: [] })
    e.count++
    if (p.claimed) e.claimed++
  }
}

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`py unresolved-evidence census — ${files.length} of ${total} files (${repos} repos), ext=.${EXT}, max=${MAX || "whole"}`)
console.log(`parsed ${parsed} · failed ${failed} · edges ${overall.edges}`)
console.log(`resolved ${overall.resolved} · ambiguous ${overall.amb} · unresolved ${overall.unresolved} (claims ignored; ${overall.claimed} of them now carry a claim)\n`)
console.log("== UNRESOLVED BY EVIDENCE AND TYPE ==")
console.log(`${w("type", 14)}${w("edges", 9)}${w("unres", 9)}${w("import-target", 15)}${w("import-route", 14)}${w("dynamic", 10)}${w("builtin", 10)}${w("imports-type", 14)}${w("other", 9)}`)
for (const t of ALL_TYPES) {
  const s = stats.get(t)!
  const g = (k: string) => s.un[k]?.count ?? 0
  console.log(`${w(t, 14)}${w(String(s.edges), 9)}${w(String(s.unresolved), 9)}${w(String(g("import-bound-target")), 15)}${w(String(g("import-bound-route")), 14)}${w(String(g("dynamic-reason")), 10)}${w(String(g("builtin-leaf")), 10)}${w(String(g("imports-module-item")), 14)}${w(String(g("other")), 9)}`)
}
console.log(`\n== OVERALL: UNRESOLVED ${overall.unresolved} BY EVIDENCE =="`)
for (const [k, v] of Object.entries(overall.un).sort((a, b) => b[1].count - a[1].count)) {
  console.log(`${w(k, 24)}${w(String(v.count), 9)}${w(String(v.claimed), 9)}`)
  for (const row of v.samples.slice(0, 4)) console.log(`    ${row.replace(/\t/g, " | ")}`)
}
console.log(`\nCLAIMABLE (import-bound-target + import-bound-route): ${(overall.un["import-bound-target"]?.count ?? 0) + (overall.un["import-bound-route"]?.count ?? 0)}`)

if (OUT) {
  const out = {
    population: { files: files.length, total, repos, ext: EXT, max: MAX },
    parsed, failed,
    overall: {
      edges: overall.edges, resolved: overall.resolved, ambiguous: overall.amb,
      externalVerified: overall.ext, unresolved: overall.unresolved,
      claimed: overall.claimed,
      unresolvedByEvidence: Object.fromEntries(Object.entries(overall.un).map(([k, v]) => [k, { edges: v.count, claimed: v.claimed }])),
    },
    perType: Object.fromEntries(ALL_TYPES.map((t) => {
      const s = stats.get(t)!
      return [t, {
        edges: s.edges, resolved: s.resolved, ambiguous: s.amb, externalVerified: s.ext, unresolved: s.unresolved,
        claimed: s.claimed,
        unresolvedByEvidence: Object.fromEntries(Object.entries(s.un).map(([k, v]) => [k, { edges: v.count, claimed: v.claimed }])),
        samples: Object.fromEntries(Object.entries(s.un).map(([k, v]) => [k, v.samples])),
      }]
    })),
  }
  writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(`wrote ${OUT}`)
}
