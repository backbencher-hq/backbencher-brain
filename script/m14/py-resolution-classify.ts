/**
 * PY-RESOLUTION-CLASSIFY — EVERY non-resolved python edge, by type and by CAUSE, on the
 * GATE'S OWN population and the GATE'S OWN rule.
 *
 * ## Why this file exists
 *
 * `incoming-gate.ts --dump` prints the not-resolved rows (label, outcome, target, file:line,
 * claimKind) and that is exactly enough to WORK on them — it is not enough to PLAN the work,
 * because it does not say WHY a row failed. The message that consumed the dump ranked
 * `calls unresolved 1,463` and stopped there; the axis that decides the next round is
 * "how many of these are a receiver whose type the source does not write down", and the dump
 * cannot answer it because the reason is in the edge's `metadata.reasonCode` and the
 * dump does not print metadata.
 *
 * So this instrument walks the SAME population with the SAME analyzer and the SAME rule
 * (`classifyEdge` is imported from `script/m14/incoming-rule.ts`, never re-implemented — the
 * programme has paid twice for a copied rule) and buckets every edge the arbiter refuses:
 *
 *   · for `unresolved`:
 *       import-bound-target   the target is a name this file binds by a module-level,
 *                             non-relative, non-`__future__` import (`from pathlib import Path`)
 *       import-bound-route    the edge's `metadata.qualified` root is such a name
 *                             (`os.getenv`, `unittest.TestCase`)
 *       dynamic-reason        the edge's own reasonCode says the target is chosen at runtime
 *                             (`dispatch-on-parameter`, `dispatch-on-receiver`, `member-read`,
 *                             `first-parent-guess`)
 *       builtin-leaf          the leaf is in `dir(builtins)` — the namespace claim's remit
 *       imports-module-item   an `imports` edge (`mod:item` / `mod:*`), split further into
 *                             project-local / third-party / relative by the REPO'S OWN FILE LIST
 *       local-callee/bare     the target is a name the file's own function binds, or a bare
 *                             name with no route — the structurally closed class
 *       other
 *
 *   · for `externalUnverified` (ext? — a claim no check can reach): by claim kind and by the
 *     target shape the verifier could not answer. This column is NOT a win and it is not a
 *     refusal either; it is the third bucket the gate counts and a PASS does not allow.
 *
 * CLAIMS ARE READ (unlike `py-unresolved-census.mts`, which deliberately ignores them): the
 * question here is the GATE's question, so `externalClaimOf(rel)` is passed to `classifyEdge`
 * and the printed outcome columns must reproduce the gate's own TABLE 1. The instrument
 * ASSERTS that reproduction when the gate log is passed with `--gate-log`, so a drifting
 * rule fails the instrument instead of printing a comfortable number.
 *
 * POPULATION IS THE GATE'S: corpus root discovered at run time, git-tracked files under the
 * size cap, admitted extensions, the same stride sample. A count here without `--max` is a
 * whole-population statement; with `--max 50` it is a TRIAGE statement and is printed as one.
 *
 * READ-ONLY. Writes only the JSON passed with --out.
 *
 * Usage:
 *   bun run script/m14/py-resolution-classify.ts --max 50
 *   bun run script/m14/py-resolution-classify.ts --max 50 --gate-log .tmp-py/gate-50-now.log
 *   bun run script/m14/py-resolution-classify.ts --max 0 --out .tmp-py/classify-whole.json
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { classifyEdge, externalClaimOf } from "./incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const SIZE_CAP = 1024 * 1024
const argv = process.argv.slice(2)
const argOf = (flag: string): string | undefined => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const MAX = Number(argOf("--max") ?? "50")
const EXT = (argOf("--ext") ?? "py,pyi,pyw").split(",").map((e) => e.trim()).filter(Boolean)
const OUT = argOf("--out")
const GATE_LOG = argOf("--gate-log")

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Label = (typeof ALL_TYPES)[number]
const ALIASES: Record<string, Label> = {
  calls: "calls", call: "calls", uses: "uses", contains: "contains", composition: "contains",
  part_of: "contains", imports: "imports", brain_import: "imports", references: "references",
  depends_on: "references", related: "references", exports: "exports", provides: "exports",
  extends: "extends", inheritance: "extends", implements: "implements", implementation: "implements",
  overrides: "overrides", override: "overrides", instantiates: "instantiates",
}
const labelOf = (raw: string): Label | null => ALIASES[raw] ?? null

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
const DYNAMIC_REASONS = new Set(["dispatch-on-receiver", "dispatch-on-parameter", "member-read", "first-parent-guess"])

// ── discovery: the gate's own rule (`discoverFiles`, incoming-gate.ts) ─────────────────────
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
      const lower = rel.toLowerCase()
      if (!EXT.some((e) => lower.endsWith(`.${e}`))) continue
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
function moduleBoundNames(rels: any[]): Set<string> {
  const bound = new Set<string>()
  for (const r of rels) {
    if (String(r?.type ?? "") !== "imports") continue
    const md = (r?.metadata ?? {}) as Record<string, any>
    if (md.starImport === true) continue
    const tgt = String(r?.target ?? "")
    const colon = tgt.indexOf(":")
    const module = String(md.module ?? (colon > 0 ? tgt.slice(0, colon) : tgt.endsWith(":*") ? tgt.slice(0, -2) : tgt))
    if (!module || module.startsWith(".") || module === "__future__") continue
    const as = md.importedAs
    if (typeof as === "string" && as.length > 0) { bound.add(as); continue }
    if (colon > 0) {
      const item = tgt.slice(colon + 1)
      if (item === "*") { bound.add(module.split(".")[0]!); continue }
      if (item !== "") bound.add(item)
      continue
    }
    bound.add(module.split(".")[0]!)
  }
  return bound
}

/**
 * THE REPO'S OWN FILE SPACE, as a dotted-module predicate. Used ONLY to classify a cause
 * (project-local vs third-party), never to resolve: `a.b.c` is project-local iff some admitted
 * file's repo-relative path ends with `a/b/c.py`, `a/b/c/__init__.py` (or the module is a
 * directory the project fills). Full-repo file list, because the question is about the REPO.
 */
function moduleLocalityOf(admittedRel: Set<string>): (mod: string) => "project-local" | "third-party" {
  const suffixes = new Map<string, boolean>()
  const dirs = new Set<string>()
  for (const rel of admittedRel) {
    const parts = rel.split("/")
    const base = parts[parts.length - 1]!
    const stem = base.replace(/\.[^.]+$/, "")
    const dirParts = parts.slice(0, -1)
    for (let i = 0; i <= dirParts.length; i++) dirs.add(dirParts.slice(i).join("/"))
    // any suffix chain ending at this file, for a dotted module naming its stem
    for (let i = dirParts.length; i >= 0; i--) {
      const prefix = dirParts.slice(i).join("/")
      const key = prefix === "" ? stem : `${prefix}/${stem}`
      suffixes.set(key, true)
    }
  }
  return (mod: string) => {
    if (mod.startsWith(".") || mod === "") return "third-party"
    const dotted = mod.split(".").filter(Boolean)
    if (dotted.length === 0) return "third-party"
    const slash = dotted.join("/")
    if (suffixes.has(slash)) return "project-local"
    if (dirs.has(slash)) return "project-local"
    // a single-segment module matches when a directory of that name exists anywhere
    if (dotted.length >= 1 && dirs.has(dotted[0]!)) return "project-local"
    return "third-party"
  }
}

type Counts = {
  edges: number
  resolved: number
  collRes: number
  ambiguous: number
  externalVerified: number
  externalUnverified: number
  externalRefuted: number
  unresolved: number
  unresolvedByCause: Map<string, number>
  extUnverifiedByCause: Map<string, number>
  samples: Map<string, string[]>
}
const mk = (): Counts => ({
  edges: 0, resolved: 0, collRes: 0, ambiguous: 0, externalVerified: 0, externalUnverified: 0,
  externalRefuted: 0, unresolved: 0, unresolvedByCause: new Map(), extUnverifiedByCause: new Map(), samples: new Map(),
})
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
const sample = (c: Counts, k: string, row: string) => {
  const arr = c.samples.get(k) ?? (c.samples.set(k, []) ? c.samples.get(k)! : [])
  if (arr.length < 5) arr.push(row)
}
const stats = new Map<string, Counts>(ALL_TYPES.map((t) => [t, mk()]))
const overall = mk()

const { files, admitted, total, repos } = discover()
const admittedByRepo = new Map<string, Set<string>>()
for (const f of admitted) {
  const repo = repoOf(f)
  const set = admittedByRepo.get(repo) ?? new Set<string>()
  set.add(f.slice(repo.length + 1).split(path.sep).join("/"))
  admittedByRepo.set(repo, set)
}
const localityByRepo = new Map<string, (mod: string) => "project-local" | "third-party">()
for (const [repo, set] of admittedByRepo) localityByRepo.set(repo, moduleLocalityOf(set))

const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
type Pending = {
  label: Label; tgt: string; claim: any; repo: string; file: string; ownFile: boolean
  reason: string; route: string; module: string; moduleBound: Set<string>; ownNames: Set<string>
}
const pending: Pending[] = []
let parsed = 0
let failed = 0

for (const f of files) {
  const repo = repoOf(f)
  let r: any
  try {
    r = await parseFile(f, repo, { projectRoot: repo } as any)
    parsed++
  } catch { failed++; continue }
  if (!r) { failed++; continue }
  let decl = projectDecl.get(repo) ?? (projectDecl.set(repo, new Map()) ? projectDecl.get(repo)! : new Map())
  let kinds = projectKinds.get(repo) ?? (projectKinds.set(repo, new Map()) ? projectKinds.get(repo)! : new Map())
  const countKey = (key: string, kind: string) => {
    decl.set(key, (decl.get(key) ?? 0) + 1)
    const ks = kinds.get(key) ?? (kinds.set(key, new Set()) ? kinds.get(key)! : new Set())
    ks.add(kind)
  }
  const ownNames = new Set<string>()
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (!name) continue
    ownNames.add(name)
    const kind = String(s?.kind ?? s?.type ?? "")
    countKey(name, kind)
    const q = String(s?.qualifiedName ?? "")
    if (q.length > 0 && q !== name) countKey(q, kind)
  }
  const bound = moduleBoundNames(Array.isArray(r.relationships) ? r.relationships : [])
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = labelOf(String(rel?.type ?? rel?.relationshipType ?? ""))
    if (!label) continue
    const tgt = String(rel?.target ?? "")
    if (!tgt) continue
    const md = (rel?.metadata ?? {}) as Record<string, any>
    const colon = tgt.lastIndexOf(":")
    pending.push({
      label, tgt, claim: externalClaimOf(rel), repo, file: f, ownFile: ownNames.has(tgt),
      reason: String(md.reasonCode ?? "none"),
      route: String(md.qualified ?? ""),
      module: String(md.module ?? (colon > 0 ? tgt.slice(0, colon) : tgt.endsWith(":*") ? tgt.slice(0, -2) : tgt)),
      moduleBound: bound, ownNames,
    })
  }
}

for (const p of pending) {
  const decl = projectDecl.get(p.repo)!
  const kinds = projectKinds.get(p.repo)!
  const facts = { packages: new Set<string>(), files: admittedByRepo.get(p.repo)!, sdkLib: false }
  const out = classifyEdge(decl, kinds, p.tgt, p.claim, facts, p.label === "contains", p.ownFile)
  const c = stats.get(p.label)!
  c.edges++; overall.edges++
  const row = `${path.relative(CR, p.file)}:${p.tgt} [${p.reason}]`
  const leaf = p.tgt.includes(":") ? p.tgt.slice(p.tgt.lastIndexOf(":") + 1) : p.tgt.slice(p.tgt.lastIndexOf(".") + 1)
  const routeRoot = p.route.includes(".") ? p.route.split(".")[0]! : ""
  const importBoundTarget = p.moduleBound.has(p.tgt)
  const importBoundRoute = routeRoot.length > 0 && p.moduleBound.has(routeRoot)
  if (out.outcome === "resolved") {
    c.resolved++; overall.resolved++
    if ((out as any).boundAmongCollision === true) { c.collRes++; overall.collRes++ }
    continue
  }
  if (out.outcome === "ambDeclOnly" || out.outcome === "ambBoth" || out.outcome === "ambiguousByDecl") {
    c.ambiguous++; overall.ambiguous++
    continue
  }
  if (out.outcome === "externalVerified") { c.externalVerified++; overall.externalVerified++; continue }
  if (out.outcome === "externalRefuted") { c.externalRefuted++; overall.externalRefuted++; continue }
  if (out.outcome === "externalUnverified") {
    c.externalUnverified++; overall.externalUnverified++
    const kind = String(p.claim?.kind ?? "null")
    const shape = p.tgt.includes(":") ? (p.tgt.endsWith(":*") ? "module:*" : "module:item") : p.tgt.includes(".") ? "dotted" : "bare"
    const key = `${kind}|${shape}|${p.reason === "none" ? "no-reason" : p.reason}`
    bump(c.extUnverifiedByCause, key); bump(overall.extUnverifiedByCause, key)
    sample(c, key, row); sample(overall, key, row)
    continue
  }
  // unresolved
  let cause: string
  if (p.label === "imports") {
    if (p.module.startsWith(".")) cause = "imports-relative"
    else if (localityByRepo.get(p.repo)!(p.module) === "project-local") cause = "imports-project-local"
    else cause = "imports-third-party"
  } else if (importBoundTarget) cause = "import-bound-target"
  else if (importBoundRoute) cause = "import-bound-route"
  else if (DYNAMIC_REASONS.has(p.reason)) cause = `dynamic:${p.reason}`
  else if (BUILTINS.has(leaf)) cause = "builtin-leaf"
  else if (p.reason === "local-callee") cause = "local-callee-or-binding"
  else if (p.reason === "bare-name-callee") cause = "bare-name-callee"
  else cause = `other:${p.reason}`
  c.unresolved++; overall.unresolved++
  bump(c.unresolvedByCause, cause); bump(overall.unresolvedByCause, cause)
  sample(c, cause, row); sample(overall, cause, row)
}

const w = (s: string | number, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
console.log(`py resolution classify — ${files.length} of ${total} files (${repos} repos), ext=${EXT.join(",")}, max=${MAX || "whole"}`)
console.log(`parsed ${parsed} · failed ${failed} · edges ${overall.edges}${MAX > 0 ? "  [TRIAGE SAMPLE — not a population statement]" : "  [whole admitted population]"}`)
console.log(`resolved ${overall.resolved} (collRes ${overall.collRes}) · ambiguous ${overall.ambiguous} · unresolved ${overall.unresolved} · extOK ${overall.externalVerified} · ext? ${overall.externalUnverified} · extFAIL ${overall.externalRefuted}\n`)

// The reproduction assertion against the gate's own printed row.
if (GATE_LOG) {
  const log = readFileSync(GATE_LOG, "utf8")
  const m = log.match(/^TOTAL\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m)
  if (!m) {
    console.error("REPRODUCTION CHECK FAILED: could not find the gate's TOTAL row in " + GATE_LOG)
    process.exitCode = 3
  } else {
    const [, edges, resolved, collRes, amb, , unresolved, extOK, extUnv] = m.map(Number)
    const mine = [overall.edges, overall.resolved, overall.collRes, overall.ambiguous, overall.unresolved, overall.externalVerified, overall.externalUnverified]
    const theirs = [edges, resolved, collRes, amb, unresolved, extOK, extUnv]
    const names = ["edges", "resolved", "collRes", "amb(decl)", "unresolved", "extOK", "ext?"]
    let ok = true
    for (let i = 0; i < names.length; i++) {
      if (mine[i] !== theirs[i]) {
        ok = false
        console.error(`REPRODUCTION CHECK FAILED: ${names[i]} gate=${theirs[i]} instrument=${mine[i]}`)
      }
    }
    console.log(ok
      ? `REPRODUCTION CHECK: PASS — edges ${overall.edges} · resolved ${overall.resolved} · collRes ${overall.collRes} · amb ${overall.ambiguous} · unresolved ${overall.unresolved} · extOK ${overall.externalVerified} · ext? ${overall.externalUnverified} — identical to the gate's own TOTAL row.`
      : "REPRODUCTION CHECK: FAILED — the numbers above are NOT the gate's row and must not be read as one.")
    if (!ok) process.exitCode = 3
  }
}

console.log("\n== PER TYPE: OUTCOMES ==")
console.log(`${w("type", 14)}${w("edges", 9)}${w("resolved", 10)}${w("collRes", 9)}${w("amb", 8)}${w("unres", 9)}${w("extOK", 8)}${w("ext?", 8)}${w("extFAIL", 9)}`)
for (const t of ALL_TYPES) {
  const c = stats.get(t)!
  console.log(`${w(t, 14)}${w(c.edges, 9)}${w(c.resolved, 10)}${w(c.collRes, 9)}${w(c.ambiguous, 8)}${w(c.unresolved, 9)}${w(c.externalVerified, 8)}${w(c.externalUnverified, 8)}${w(c.externalRefuted, 9)}`)
}

console.log("\n== UNRESOLVED BY TYPE AND CAUSE ==")
for (const t of ALL_TYPES) {
  const c = stats.get(t)!
  if (c.unresolved === 0) continue
  console.log(`\n-- ${t}: ${c.unresolved} unresolved`)
  const rows = [...c.unresolvedByCause.entries()].sort((a, b) => b[1] - a[1])
  for (const [k, n] of rows) {
    console.log(`   ${w(k, 32)}${w(n, 7)}${((n / c.unresolved) * 100).toFixed(1)}%`)
    for (const r of (c.samples.get(k) ?? []).slice(0, 2)) console.log(`       ${r}`)
  }
}

console.log("\n== ext? (A CLAIM NO CHECK CAN REACH) BY CLAIM KIND / SHAPE / REASON ==")
for (const [k, n] of [...overall.extUnverifiedByCause.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${w(k, 52)}${w(n, 8)}`)
  for (const r of (overall.samples.get(k) ?? []).slice(0, 2)) console.log(`       ${r}`)
}

console.log("\n== OVERALL UNRESOLVED BY CAUSE ==")
for (const [k, n] of [...overall.unresolvedByCause.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${w(k, 32)}${w(n, 8)}${((n / overall.unresolved) * 100).toFixed(1)}%`)
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    population: { files: files.length, total, repos, ext: EXT, max: MAX },
    parsed, failed,
    overall: {
      edges: overall.edges, resolved: overall.resolved, collRes: overall.collRes,
      ambiguous: overall.ambiguous, unresolved: overall.unresolved,
      externalVerified: overall.externalVerified, externalUnverified: overall.externalUnverified,
      externalRefuted: overall.externalRefuted,
      unresolvedByCause: Object.fromEntries(overall.unresolvedByCause),
      extUnverifiedByCause: Object.fromEntries(overall.extUnverifiedByCause),
    },
    perType: Object.fromEntries(ALL_TYPES.map((t) => {
      const c = stats.get(t)!
      return [t, {
        edges: c.edges, resolved: c.resolved, collRes: c.collRes, ambiguous: c.ambiguous,
        unresolved: c.unresolved, externalVerified: c.externalVerified,
        externalUnverified: c.externalUnverified, externalRefuted: c.externalRefuted,
        unresolvedByCause: Object.fromEntries(c.unresolvedByCause),
        extUnverifiedByCause: Object.fromEntries(c.extUnverifiedByCause),
        samples: Object.fromEntries(c.samples),
      }]
    })),
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}
