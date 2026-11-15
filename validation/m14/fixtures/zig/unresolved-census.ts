/**
 * ZIG UNRESOLVED CENSUS — decomposing the incoming gate's `unresolved` column.
 *
 * ## Why this instrument exists
 *
 * `npx tsx script/m14/incoming-gate.ts zig zig 60` reports 4,251 unresolved edges of 18,606
 * and 259 REFUTED external claims. "Unresolved" is one counter standing for at least three
 * different things with three different fixes, and the count is not actionable without the
 * split. This file produces the split.
 *
 * ## The population is the gate's own
 *
 * Discovery, sorting, the stride sample, the size cap and `parseFile(f, repoOf(f),
 * {projectRoot: repoOf(f)})` are reproduced from `incoming-gate.ts` so the total this census
 * decomposes is the total the gate printed. `classifyEdge`/`externalClaimOf` are IMPORTED from
 * `script/m14/incoming-rule.ts` rather than re-implemented: two copies of the counting rule are
 * two rules, and the copy the census runs would be the one that was wrong.
 *
 * ## The buckets, defined so each can be computed and each can fail
 *
 * For every edge whose project-scope outcome is `unresolved` (carries no claim) or
 * `externalRefuted` (carries a claim the project refutes), the WRITTEN FORM of the access is
 * read from the analyzer's own metadata (`callExpression` / `fieldAccessExpression`), and the
 * edge is classified by what that written form names:
 *
 *   external-module-member   the receiver is a MODULE — `std`, `builtin`, an `@cImport` binding,
 *                            a bare-name `@import`, or an `@import("…")` call used inline. The
 *                            target exists nowhere in this project by construction.
 *   binding-receiver         the receiver is a local binding or parameter (`self`, `allocator`,
 *                            `writer`, an `err`/`it`/`item` parameter). The family contract
 *                            publishes no locals or parameters as symbols (DARTD8), so no key
 *                            space can answer this target — the declaration it names is a field
 *                            of a type, reachable only by knowing the receiver's TYPE.
 *   corpus-declared          the project DOES publish the target (or its leaf) — a real
 *                            resolution defect, and it is named.
 *   unknown                  none of the above; reported so the buckets sum to the total.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/zig/unresolved-census.ts [--sample 60] [--out p.json]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"
import { classifyEdge, externalClaimOf, isMarkedExternal, targetOwner } from "../../../../script/m14/incoming-rule"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024

const argv = process.argv.slice(2)
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const SAMPLE = Number(arg("sample", "60"))
const OUT = arg("out", "")

// ───────────────────────────────────────────── the gate's population, reproduced
const found: string[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".zig")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    found.push(abs)
  }
}
found.sort()
const total = found.length
let files = found
if (SAMPLE > 0 && total > SAMPLE) {
  const stride = Math.max(1, Math.floor(total / SAMPLE))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < SAMPLE; i += stride) picked.push(found[i])
  files = picked
}
const repoOf = (f: string) => path.join(CR, path.relative(CR, f).split(path.sep)[0]!)

// ───────────────────────────────────────────── walk, key space, classify
type Bucket = "external-module-member" | "binding-receiver" | "corpus-declared" | "unknown"
type Rec = {
  repo: string; file: string; type: string; target: string; source: string
  outcome: string; written: string; bucket: Bucket; leaf: string; leafDecls: number
  reason: string; metaModule: string
  /** owner key-space facts — present only for a marked edge, so a REFUTED claim can be
   *  explained by the declarations that refute it rather than by a guess */
  owner: string; ownerDecls: number; ownerKinds: string; nameDecls: number; kinds: string
}

/** module receivers: bound by an `@import`/`@cImport` of a bare module name in the SOURCE,
 *  plus the two the compiler provides without an import at all. */
const IMPLICIT_MODULES = new Set(["std", "builtin", "root"])
/** the analyzer's own metadata key for the alias, read from the edge — no second source model */
const moduleFromMeta = (md: any): string | null =>
  typeof md?.zigImportModule === "string" && md.zigImportModule.length > 0 ? md.zigImportModule : null

const recs: Rec[] = []
const perFile = new Map<string, { decls: Map<string, number>; kinds: Map<string, Set<string>> }>()
const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
const pending: { r: Rec; rel: any; claim: any; repo: string }[] = []

let parsed = 0
for (const f of files) {
  const repo = repoOf(f)
  let r: any
  try { r = await parseFile(f, repo, { projectRoot: repo } as any) } catch { continue }
  if (!r) continue
  parsed++
  const fDecl = new Map<string, number>()
  const fKinds = new Map<string, Set<string>>()
  perFile.set(f, { decls: fDecl, kinds: fKinds })
  let pDecl = projectDecl.get(repo)
  if (!pDecl) projectDecl.set(repo, (pDecl = new Map()))
  let pKinds = projectKinds.get(repo)
  if (!pKinds) projectKinds.set(repo, (pKinds = new Map()))
  const count = (key: string, kind: string) => {
    fDecl.set(key, (fDecl.get(key) ?? 0) + 1)
    let fs = fKinds.get(key)
    if (!fs) fKinds.set(key, (fs = new Set()))
    fs.add(kind)
    pDecl!.set(key, (pDecl!.get(key) ?? 0) + 1)
    let ps = pKinds!.get(key)
    if (!ps) pKinds!.set(key, (ps = new Set()))
    ps.add(kind)
  }
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const nm = String(s?.name ?? "")
    if (nm.length === 0) continue
    const k = String(s?.kind ?? "")
    count(nm, k)
    const q = String(s?.qualifiedName ?? "")
    if (q.length > 0 && q !== nm) count(q, k)
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const md = rel?.metadata ?? {}
    const written = String(md.callExpression ?? md.fieldAccessExpression ?? md.reflectedMember ?? "")
    pending.push({
      repo,
      rel,
      claim: externalClaimOf(rel),
      r: {
        repo, file: path.relative(CR, f), type: String(rel?.type ?? ""),
        target: String(rel?.target ?? ""), source: String(rel?.source ?? rel?.from ?? ""),
        outcome: "", written, bucket: "unknown", leaf: "", leafDecls: 0, reason: "",
        // the module an external alias names, straight from the analyzer's own metadata
        metaModule: moduleFromMeta(md) ?? "",
        owner: "", ownerDecls: 0, ownerKinds: "", nameDecls: 0, kinds: "",
      },
    })
  }
}

// classification, over the finished key space (the gate's own ordering)
for (const p of pending) {
  const c = classifyEdge(projectDecl.get(p.repo)!, projectKinds.get(p.repo)!, p.r.target, p.claim)
  if (c.outcome !== "unresolved" && c.outcome !== "externalRefuted") continue
  const rec = p.r
  rec.outcome = c.outcome
  const own = targetOwner(rec.target)
  const pd = projectDecl.get(p.repo)!
  const pk = projectKinds.get(p.repo)!
  rec.owner = own ?? ""
  rec.ownerDecls = own === null ? 0 : (pd.get(own) ?? 0)
  rec.ownerKinds = own === null ? "" : [...(pk.get(own) ?? [])].sort().join("|")
  rec.nameDecls = pd.get(rec.target) ?? 0
  rec.kinds = c.kinds
  const dot = rec.target.lastIndexOf(".")
  const leaf = dot > 0 ? rec.target.slice(dot + 1) : rec.target
  rec.leaf = leaf
  const fk = perFile.get(path.join(CR, rec.file))
  rec.leafDecls = fk?.decls.get(leaf) ?? 0
  const totalDecls = projectDecl.get(p.repo)!.get(rec.target) ?? 0
  const writtenRoot = (() => {
    const w = rec.written
    const m = /^([A-Za-z_@][A-Za-z0-9_]*)/.exec(w)
    return m ? m[1]! : ""
  })()
  const metaModule = rec.metaModule
  if (metaModule) {
    rec.bucket = "external-module-member"
    rec.reason = `receiver ${writtenRoot} is @import("${metaModule}") — marked but broken`
  } else if (IMPLICIT_MODULES.has(writtenRoot) || writtenRoot.startsWith("@")) {
    rec.bucket = "external-module-member"
    rec.reason = `receiver ${writtenRoot} is a module/stdlib global`
  } else if (/^@import\(/.test(rec.written) || /^std\.|^builtin\./.test(rec.written)) {
    rec.bucket = "external-module-member"
    rec.reason = `written form is a module path`
  } else if (totalDecls > 0) {
    rec.bucket = "corpus-declared"
    rec.reason = `project publishes ${rec.target} (${totalDecls} decl) — the lookup should have answered`
  } else if (rec.leafDecls > 0) {
    rec.bucket = "corpus-declared"
    rec.reason = `project publishes the leaf ${leaf} (${rec.leafDecls} in this file) — a member/method call`
  } else if (dot > 0) {
    rec.bucket = "binding-receiver"
    rec.reason = `receiver ${rec.target.slice(0, dot)} is not a module and not a published owner`
  } else {
    rec.bucket = "unknown"
    rec.reason = `bare target ${rec.target} is not published in this project`
  }
  recs.push(rec)
}

// ───────────────────────────────────────────── report
const byBucket = new Map<string, Rec[]>()
for (const r of recs) {
  const a = byBucket.get(r.bucket) ?? []
  a.push(r)
  byBucket.set(r.bucket, a)
}
const byOutcome = new Map<string, number>()
for (const r of recs) byOutcome.set(r.outcome, (byOutcome.get(r.outcome) ?? 0) + 1)
const byType = new Map<string, number>()
for (const r of recs) byType.set(r.type, (byType.get(r.type) ?? 0) + 1)

const topBy = (key: (r: Rec) => string, n = 20) => {
  const m = new Map<string, number>()
  for (const r of recs) m.set(key(r), (m.get(key(r)) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
}

if (OUT) writeFileSync(OUT, JSON.stringify({ sample: files.length, corpusTotal: total, parsed, recs }, null, 2))

console.log(`zig unresolved census — ${parsed} parsed of ${files.length} sampled (corpus ${total} .zig)`)
console.log(`unresolved+refuted edges classified: ${recs.length}`)
console.log(`by outcome: ${[...byOutcome.entries()].map(([k, v]) => `${k}=${v}`).join("  ")}`)
console.log(`by type:    ${[...byType.entries()].map(([k, v]) => `${k}=${v}`).join("  ")}`)
console.log(`\nBUCKETS`)
for (const [b, a] of [...byBucket.entries()].sort((x, y) => y[1].length - x[1].length)) {
  const types = new Map<string, number>()
  for (const r of a) types.set(r.type, (types.get(r.type) ?? 0) + 1)
  console.log(
    `  ${b.padEnd(24)} ${String(a.length).padStart(5)}  (${[...types.entries()].map(([k, v]) => `${k}=${v}`).join(" ")})`,
  )
}
console.log(`\nTOP TARGETS`)
for (const [t, n] of topBy((r) => `${r.target}   [${r.bucket}]`, 30)) console.log(`  ${String(n).padStart(4)}  ${t}`)
console.log(`\nTOP WRITTEN FORMS (unresolved only)`)
for (const [t, n] of topBy((r) => r.written || "(none)", 25)) console.log(`  ${String(n).padStart(4)}  ${t}`)
void isMarkedExternal
