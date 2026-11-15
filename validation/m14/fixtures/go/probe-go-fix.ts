/**
 * GO-FIX probe — bounded, read-only, one process, foreground.
 *
 * WHAT IT IS FOR. The go lane's residual is 25,215 unresolved over a 400-file stride. The fleet
 * brief's remedy for this lane ("route the existing reasonCode into the gate's cause channel") is a
 * claim about the RULE, and the rule is importable — so this probe tests it against the rule's own
 * `classifyEdge` instead of asserting it. It then censuses the SHAPE of each unresolved bucket (what
 * the analyzer already computed on that edge and did not publish) and SIMULATES the candidate fixes
 * so the choice is made on counts rather than on a story.
 *
 * IT REPRODUCES THE GATE. Discovery, stride, parse entry, key space and classifier are the gate's
 * (`script/m14/incoming-gate.ts` + `incoming-rule.ts`); the first thing it prints is its own TABLE 1
 * beside the gate's, so a probe that disagreed with the instrument would be visible immediately.
 *
 * RUN:  bun run validation/m14/fixtures/go/probe-go-fix.ts
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import {
  classifyEdge, externalClaimOf, type ExternalClaim,
} from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const MAX_FILES = Number(process.env.BB_MAX_FILES ?? 400)
const LANE = "go"
/**
 * `BB_REPO` — A REPO FILTER, ADDITIVE AND OFF BY DEFAULT (2026-10-21, the D7 reconciliation).
 * The probe's whole-corpus stride is the HISTORICAL behaviour and is UNCHANGED when this is unset.
 * Set it to a comma-separated list of repo names to measure WHOLE named repositories instead of a
 * stride — which is what a per-repo RECONCILIATION needs: the D7 wall classes have to be read
 * against the gate's DUMP for the SAME repo, and a stride cannot be compared with a whole repo.
 * The ADMISSION rule is the gate's own (git ls-files · `.go` · ≤1 MB) — the filter only CHOOSES
 * which repos, so a filtered run's population is a SUBSET of the unfiltered one.
 */
const REPO_FILTER = (process.env.BB_REPO ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const REPO_FILTER_SET = REPO_FILTER.length > 0 ? new Set(REPO_FILTER) : undefined

/**
 * THE GO STANDARD LIBRARY'S SINGLE-SEGMENT IMPORT PATHS — the packages whose import path carries no
 * `/`. A CLOSED set, which is what makes membership a DECIDABLE TEST (the graphql built-in-scalar
 * precedent) rather than a shape heuristic. Deliberately conservative: a package left out costs an
 * edge that stays unresolved (no harm), while a package wrongly included would fabricate a claim.
 * This is NOT the same object as the analyzer's `isGoStandardLibrary`, whose last clause is
 * `|| !stringIncludes(importPath, ".")` — a sweep that calls a project-local `internal/util` a
 * standard-library package.
 */
const GO_STDLIB_SINGLE = new Set([
  "bufio", "bytes", "cmp", "context", "crypto", "embed", "encoding", "errors", "expvar", "flag",
  "fmt", "hash", "html", "image", "io", "iter", "log", "maps", "math", "mime", "net", "os",
  "path", "plugin", "reflect", "regexp", "runtime", "slices", "sort", "strconv", "strings",
  "structs", "sync", "syscall", "testing", "time", "unicode", "unique", "unsafe", "weak",
])

/* ── discovery: the gate's own rule (git ls-files | admit .go | 1 MB cap | sort | stride) ────── */
function discover() {
  const found: string[] = []
  for (const name of readdirSync(CR).sort()) {
    if (REPO_FILTER_SET && !REPO_FILTER_SET.has(name)) continue
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!rel.toLowerCase().endsWith(`.${LANE}`)) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      found.push(abs)
    }
  }
  found.sort()
  const total = found.length
  // A REPO FILTER MEASURES THE WHOLE REPO ✓✓ — a stride inside a named repo would be a sample of
  // it, and the D7 reconciliation compares a whole repo against the gate's whole-repo dump ✓✓.
  // Unfiltered, the historical stride is UNCHANGED ✓✓.
  const stride = REPO_FILTER_SET ? 1 : Math.max(1, Math.floor(total / MAX_FILES))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < MAX_FILES; i += stride) picked.push(found[i])
  const whole = REPO_FILTER_SET ? found : picked
  return { files: whole, total, stride, repos: new Set(whole.map((f) => f.slice(CR.length + 1).split(path.sep)[0])).size }
}

/* ── key space: name -> declarations, and the QUALIFIED-NAME alias space go does NOT publish ──── */
type KeySpace = { name: Map<string, number>; kinds: Map<string, Set<string>>; alias: Map<string, number> }
const ws = (name: string, kind: string, k: KeySpace) => {
  k.name.set(name, (k.name.get(name) ?? 0) + 1)
  let s = k.kinds.get(name); if (!s) k.kinds.set(name, (s = new Set())); s.add(kind)
}

const repoOf = (f: string) => path.join(CR, f.slice(CR.length + 1).split(path.sep)[0])

const t0 = Date.now()
const disc = discover()
console.error(`discovery: ${disc.files.length} of ${disc.total} .go files (stride ${disc.stride}), ${disc.repos} repos`)

type FileInfo = {
  file: string; repo: string; pkg: string
  importAliases: Map<string, { module: string; stdlib: boolean; thirdParty: boolean }>
  symbols: any[]
  rels: any[]
}
const parsed: FileInfo[] = []
for (const f of disc.files) {
  let r: any
  try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { continue }
  if (!r) continue
  const pkgSym = (r.symbols ?? []).find((s: any) => s?.metadata?.nodeType === "package_clause")
  const aliases = new Map<string, { module: string; stdlib: boolean; thirdParty: boolean }>()
  for (const imp of r.imports ?? []) {
    // NOTE the spelling: `parseFile` NORMALISES the analyzer's own ImportInfo
    // (`{module, alias, metadata:{packageName,isStandardLibrary,…}}`) into
    // `{name, path, type, isExternal, line}`, so the analyzer's per-import metadata is NOT reachable
    // from this entry point. Read the fields the normalised shape actually has — an earlier version
    // of this probe read `imp.module`, found nothing, and censused every qualified call as "not
    // imported", which is why the census below is checked against the file's own imports.
    const mod = String(imp.path ?? imp.module ?? "")
    if (!mod) continue
    // the spelling a Go file may use to qualify a call: the alias, else the path's last segment
    const used = String(imp.name ?? imp.alias ?? mod.split("/").pop() ?? "")
    if (used) aliases.set(used, {
      module: mod,
      stdlib: imp.metadata?.isStandardLibrary === true,
      thirdParty: imp.metadata?.isThirdParty === true,
    })
  }
  parsed.push({
    file: f, repo: repoOf(f), pkg: String(pkgSym?.name ?? ""),
    importAliases: aliases,
    symbols: Array.isArray(r.symbols) ? r.symbols : [],
    rels: Array.isArray(r.relationships) ? r.relationships : [],
  })
}

// TWO key spaces per repo, filled in the same loop: the gate's (names) and the SIMULATED one that
// also carries the qualified alias a fix would have to publish for a qualified target to answer.
const space = new Map<string, KeySpace>()
const sim = new Map<string, KeySpace>()
const getSpace = (m: Map<string, KeySpace>, repo: string) => {
  let k = m.get(repo); if (!k) m.set(repo, (k = { name: new Map(), kinds: new Map(), alias: new Map() })); return k
}
for (const fi of parsed) {
  const k = getSpace(space, fi.repo)
  const s = getSpace(sim, fi.repo)
  for (const sym of fi.symbols) {
    const name = String(sym?.name ?? ""); if (!name) continue
    const kind = String(sym?.kind ?? "")
    ws(name, kind, k); ws(name, kind, s)
    const q = String(sym?.qualifiedName ?? "")
    if (q && q !== name) { k.alias.set(q, (k.alias.get(q) ?? 0) + 1); s.alias.set(q, (s.alias.get(q) ?? 0) + 1) }
    // THE SIMULATED QUALIFIED ALIAS — what a fix would publish. Package-scope unit: `<pkg>.<Name>`;
    // owned member: `<owner>.<Name>` (methods and fields already carry ownerName).
    const owner = String(sym?.ownerName ?? "")
    const alias = owner ? `${owner}.${name}` : (fi.pkg ? `${fi.pkg}.${name}` : "")
    if (alias) { s.alias.set(alias, (s.alias.get(alias) ?? 0) + 1); s.name.set(alias, (s.name.get(alias) ?? 0) + 1) }
  }
}

/* ── classification, exactly the gate's, plus the shape census ─────────────────────────────────── */
type Type = string
const TYPES: Type[] = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
const zero = () => ({ edges: 0, resolved: 0, collRes: 0, amb: 0, unres: 0, extOK: 0, extU: 0, extF: 0, causeOK: 0, causeF: 0 })
const table = new Map<Type, ReturnType<typeof zero>>()
for (const t of TYPES) table.set(t, zero())

type Shape = { n: number; samples: string[] }
const inc = (m: Map<string, Shape>, k: string, sample: string) => {
  let e = m.get(k); if (!e) m.set(k, (e = { n: 0, samples: [] })); e.n++; if (e.samples.length < 3) e.samples.push(sample)
}
/** CANDIDATE B's closure: every unresolved import edge lands in exactly one of these. */
const B = { eligible: 0, verified: 0, refuted: 0, other: 0, singleNotStdlib: 0, multiSegment: 0 }
// cause-channel test: the same edge with its OWN reasonCode on the gate's cause key
const trap1 = new Map<string, Shape>()
// imports: `isStdlib: true` (a RECOGNISED external key the analyzer already computes but drops)
const stdlibSim = new Map<string, Shape>()
// calls: shape of the qualifier, and what a qualified TARGET would do
const callShape = new Map<string, Shape>()
const callQualifiedSim = new Map<string, Shape>()
// references: the qualifiedType the lane computes and discards
const refQualifiedSim = new Map<string, Shape>()
/**
 * THE METADATA WALL CENSUS (2026-10-21, the D7 reconciliation).
 *
 * EVERY non-resolved edge, bucketed by THE ANALYZER's OWN `metadata.reasonCode` — the vocabulary
 * the analyzer publishes precisely so that a residual class can be NAMED rather than guessed
 * (11 reasons over 6 types, `GO_SUB_UNIT_REASON` in `src/ast/real-go-analyzer.ts:113`). This is the
 * LANE's classification; the gate's DUMP is the ARBITER's, and the D7 page must reconcile the two
 * by MEASUREMENT. A class with no reasonCode is reported as such — the analyzer publishes one for
 * every edge below 1.0, and a row without one is a row whose class is UNKNOWN, not a row whose
 * class is "no class".
 */
const wallByReason = new Map<string, Shape>()
const wallNoReason = new Map<string, Shape>()
const wallByBind = new Map<string, Shape>()
const wallNoBind = new Map<string, Shape>()

for (const fi of parsed) {
  const k = getSpace(space, fi.repo)
  const s = getSpace(sim, fi.repo)
  const ownNames = new Set(fi.symbols.map((x: any) => String(x?.name ?? "")))
  for (const rel of fi.rels) {
    const t = String(rel?.type ?? "")
    const row = table.get(t); if (!row) continue
    row.edges++
    const tgt = String(rel?.target ?? "")
    if (!tgt) continue
    const claim = externalClaimOf(rel)
    // THE OWN-FILE TIE-BREAK MUST BE PASSED IN, OR THIS PROBE CLASSIFIES WITH A STALE ARBITER.
    // The gate computes `ownFileDeclares` — "does the target's exact string have a declaration in
    // this row's OWN file" — and passes it to `classifyEdge` as the seventh argument; the
    // ambiguous branch consults it (incoming-rule.ts:2153). This probe used to pass only six
    // arguments, so it classified WITHOUT the tie-break, and it reported the exports label as
    // 2,222 ambiguous rows where the gate (WITH the tie-break) reports 0. `ownNames` is this
    // file's own declared names, so `ownNames.has(tgt)` is the same predicate the gate computes.
    // The eighth argument (the edge's source file) is only consulted when `facts` are present —
    // the probe passes none — so it is not needed here.
    const c = classifyEdge(k.name, k.kinds, tgt, claim, undefined, t === "contains", ownNames.has(tgt))
    if (c.outcome === "resolved") { row.resolved++; if (c.boundAmongCollision) row.collRes++ }
    else if (c.outcome === "ambDeclOnly" || c.outcome === "ambBoth") row.amb++
    else if (c.outcome === "unresolved") row.unres++
    else if (c.outcome === "externalVerified") row.extOK++
    else if (c.outcome === "externalUnverified") row.extU++
    else if (c.outcome === "externalRefuted") row.extF++
    else if (c.outcome === "causeDeclared") row.causeOK++
    else if (c.outcome === "causeRefuted") row.causeF++

    const md = rel?.metadata ?? {}
    // ── THE METADATA WALL CENSUS: every non-resolved edge, by the analyzer's OWN reasonCode.
    if (c.outcome !== "resolved") {
      const rc = typeof md.reasonCode === "string" && md.reasonCode.length ? md.reasonCode : "(NO reasonCode)"
      inc(wallByReason, `${t} · ${c.outcome} · ${rc}`, `${tgt}`)
      if (rc === "(NO reasonCode)") inc(wallNoReason, `${t} · ${c.outcome} · ${String(md.relationshipType ?? "(NO relationshipType)")} · confidence ${String(rel?.confidence ?? "?")}`, `${tgt}`)
      // ── THE BIND REASON (the analyzer's own second field, 2026-10-21): the
      // class a wall row can be NAMED by, for BOTH the confidence-1.0 rows and
      // the sub-1.0 rows. A wall row with no bind reason is a row the reader
      // cannot audit.
      const br = typeof md.bindReason === "string" && md.bindReason.length ? md.bindReason : "(NO bindReason)"
      inc(wallByBind, `${t} · ${c.outcome} · ${br}`, `${tgt}`)
      if (br === "(NO bindReason)") inc(wallNoBind, `${t} · ${c.outcome} · ${String(md.relationshipType ?? "(NO relationshipType)")}`, `${tgt}`)
    }
    if (c.outcome !== "unresolved") continue

    // ── TRAP 1: the brief's remedy — the lane's own reasonCode on the cause key, target unchanged
    if (typeof md.reasonCode === "string") {
      const rc = classifyEdge(k.name, k.kinds, tgt, { kind: "cause", base: md.reasonCode, conflict: false } as ExternalClaim, undefined, t === "contains")
      inc(trap1, `${t} · reasonCode-as-cause -> ${rc.outcome}`, `${tgt} <- ${md.reasonCode}`)
    }

    // ── imports: what an external claim would do on THIS target shape. The lane's own
    // `isGoStandardLibrary` (`:4407-4443`) is NOT a standard-library list: it ends with
    // `|| !stringIncludes(importPath, ".")`, so it answers "the path carries no dot" — which is true
    // of a project-local `internal/util` too. Simulated here as the lane's own predicate would mark
    // it, so the fabrication is measured rather than described.
    if (t === "imports") {
      const mod = tgt
      const laneWouldFlag = !mod.includes(".")
      const r2 = classifyEdge(k.name, k.kinds, tgt, { kind: "owner" } as ExternalClaim, undefined, false)
      // CANDIDATE B — the claim a CLOSED stdlib list supports: a SINGLE-SEGMENT path that is a member
      // of the Go standard library's package set. Multi-segment paths are path-like to the rule and
      // can only ever be `ext?`, which is a clause-1 failure like `unresolved` — so they are NOT
      // counted as a win here even though a claim could be attached to them.
      const single = !mod.includes("/")
      const inList = single && GO_STDLIB_SINGLE.has(mod)
      if (inList) {
        B.eligible++
        if (r2.outcome === "externalVerified") B.verified++
        else if (r2.outcome === "externalRefuted") B.refuted++
        else B.other++
      } else if (single) B.singleNotStdlib++
      else B.multiSegment++
      inc(stdlibSim, `single-segment stdlib member (candidate B): "${mod}" -> ${r2.outcome} (decls=${k.name.get(mod) ?? 0})`, mod)
      if (!single) inc(stdlibSim, "MULTI-segment path — a claim could only reach `ext?` (no win)", mod)
      else if (!inList) inc(stdlibSim, `single-segment, NOT in the stdlib list"${mod}" -> left untouched`, mod)
      if (laneWouldFlag && !inList && single) inc(stdlibSim, `THE LANE'S OWN PREDICATE WOULD HAVE CLAIMED IT: "${mod}" is not stdlib`, mod)
    }

    // ── calls: the qualifier the analyzer holds in metadata.callExpression
    if (t === "calls") {
      const full = typeof md.callExpression === "string" ? md.callExpression : ""
      const dot = full.lastIndexOf(".")
      if (dot <= 0) { inc(callShape, "no qualifier held", tgt); continue }
      const root = full.slice(0, dot)
      const first = root.split(".")[0]
      const imp = fi.importAliases.get(first)
      const kind = imp
        ? "root = a package the FILE IMPORTS"
        : (first === fi.pkg ? "root = the file's OWN package name"
          : (ownNames.has(first) ? "root = a name the file DECLARES (variable/receiver)"
            : "root = a name the file neither declares nor imports"))
      inc(callShape, kind, `${full}`)
      // what a qualified TARGET would do, with and without published aliases
      const qTgt = full
      const noAlias = classifyEdge(k.name, k.kinds, qTgt, null, undefined, false)
      const withAlias = classifyEdge(s.name, s.kinds, qTgt, null, undefined, false)
      const base = targetBaseOf(qTgt)
      const asCause = classifyEdge(k.name, k.kinds, qTgt, { kind: "cause", base, conflict: false } as ExternalClaim, undefined, false)
      inc(callQualifiedSim, `[${kind}] target:=qualified, NO alias published      -> ${noAlias.outcome}`, full)
      inc(callQualifiedSim, `[${kind}] target:=qualified, alias published          -> ${withAlias.outcome}`, full)
      inc(callQualifiedSim, `[${kind}] target:=qualified + baseBeyondRunScope="${base || "(unspellable)"}" -> ${asCause.outcome}`, full)
      if (!base) inc(callQualifiedSim, `[${kind}] base UNSPELLABLE (not an identifier) -> cause cannot be attached`, full)
    }

    // ── references: the qualifiedType the lane computes and throws away (:876-878)
    if (t === "references" && typeof md.qualifiedType === "string") {
      const q = md.qualifiedType
      const noAlias = classifyEdge(k.name, k.kinds, q, null, undefined, false)
      const withAlias = classifyEdge(s.name, s.kinds, q, null, undefined, false)
      const base = targetBaseOf(q)
      const asCause = classifyEdge(k.name, k.kinds, q, { kind: "cause", base, conflict: false } as ExternalClaim, undefined, false)
      inc(refQualifiedSim, `target:=qualifiedType, NO alias published -> ${noAlias.outcome}`, `${q} <- ${tgt}@${rel?.line_number ?? "?"}`)
      inc(refQualifiedSim, `target:=qualifiedType, alias published     -> ${withAlias.outcome}`, `${q} <- ${tgt}@${rel?.line_number ?? "?"}`)
      inc(refQualifiedSim, `target:=qualifiedType + baseBeyondRunScope="${base || "(unspellable)"}" -> ${asCause.outcome}`, `${q} <- ${tgt}@${rel?.line_number ?? "?"}`)
    }
  }
}

/** everything before the last dot, and only when that is an identifier (the rule's own shape) */
function targetBaseOf(t: string): string {
  const dot = t.lastIndexOf(".")
  if (dot <= 0) return ""
  const base = t.slice(0, dot)
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(base) ? base : ""
}

const pad = (s: string | number, n: number) => String(s).padEnd(n)
const padL = (s: string | number, n: number) => String(s).padStart(n)
console.log("\nTABLE 1 (probe, per project) — compare with the gate's")
console.log(pad("type", 14) + padL("edges", 9) + padL("resolved", 10) + padL("collRes", 9) + padL("amb", 11) + padL("unres", 12) + padL("extOK", 8))
let T = zero()
for (const t of TYPES) {
  const r = table.get(t)!
  T = { edges: T.edges + r.edges, resolved: T.resolved + r.resolved, collRes: T.collRes + r.collRes, amb: T.amb + r.amb, unres: T.unres + r.unres, extOK: T.extOK + r.extOK, extU: T.extU + r.extU, extF: T.extF + r.extF, causeOK: T.causeOK + r.causeOK, causeF: T.causeF + r.causeF }
  console.log(pad(t, 14) + padL(r.edges, 9) + padL(r.resolved, 10) + padL(r.collRes, 9) + padL(r.amb, 11) + padL(r.unres, 12) + padL(r.extOK, 8))
}
console.log(pad("TOTAL", 14) + padL(T.edges, 9) + padL(T.resolved, 10) + padL(T.collRes, 9) + padL(T.amb, 11) + padL(T.unres, 12) + padL(T.extOK, 8))

const dump = (title: string, m: Map<string, Shape>, top = 40) => {
  console.log(`\n${title}`)
  const rows = [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, top)
  for (const [k, v] of rows) console.log(`  ${padL(v.n, 8)}  ${k}${v.samples.length ? `   e.g. ${v.samples.join(" · ")}` : ""}`)
  if (m.size > top) console.log(`  (${m.size - top} further key(s) not shown)`)
}
dump("TRAP 1 — the lane's OWN reasonCode placed on the gate's cause key (target unchanged):", trap1, 10)
console.log("\nTHE METADATA WALL CENSUS — every non-resolved edge, by the analyzer's OWN reasonCode:")
const wallSum = [...wallByReason.values()].reduce((a, s) => a + s.n, 0)
const wallNoReasonSum = [...wallNoReason.values()].reduce((a, s) => a + s.n, 0)
for (const [k, v] of [...wallByReason.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${padL(v.n, 8)}  ${k}${v.samples.length ? `   e.g. ${v.samples.slice(0, 2).join(" · ")}` : ""}`)
}
console.log(`  wall rows: ${padL(wallSum, 8)}  ·  of which with NO reasonCode: ${wallNoReasonSum} ${wallNoReasonSum === 0 ? "(the analyzer published one for every row)" : "** rows whose class is UNKNOWN, not 'no class' **"}`)
if (wallNoReasonSum > 0) {
  console.log("  THE PUBLICATION GAP — the no-reason rows, by (type, relationshipType):")
  for (const [k, v] of [...wallNoReason.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`    ${padL(v.n, 8)}  ${k}`)
  }
}
console.log("\nTHE BIND CENSUS — every non-resolved edge, by the analyzer's OWN `metadata.bindReason`:")
const bindSum = [...wallByBind.values()].reduce((a, s) => a + s.n, 0)
const noBindSum = [...wallNoBind.values()].reduce((a, s) => a + s.n, 0)
for (const [k, v] of [...wallByBind.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${padL(v.n, 8)}  ${k}${v.samples.length ? `   e.g. ${v.samples.slice(0, 2).join(" · ")}` : ""}`)
}
console.log(`  wall rows: ${padL(bindSum, 8)}  ·  of which with NO bindReason: ${noBindSum} ${noBindSum === 0 ? "** EVERY wall row is now NAMED **" : "** rows whose class is UNKNOWN **"}`)
if (noBindSum > 0) {
  console.log("  THE BIND GAP — the no-bind rows, by (type, relationshipType):")
  for (const [k, v] of [...wallNoBind.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`    ${padL(v.n, 8)}  ${k}`)
  }
}
dump("IMPORTS — what the analyzer already computed (isStandardLibrary) would do if published:", stdlibSim, 12)
dump("CALLS (unresolved) — what the qualifier in metadata.callExpression IS:", callShape, 12)
dump('CALLS (unresolved) — simulation of a QUALIFIED target, three ways:', callQualifiedSim, 12)
dump("REFERENCES (unresolved, qualifiedType held) — simulation of a QUALIFIED target:", refQualifiedSim, 12)

console.log("\nCANDIDATE B — CLOSURE over the unresolved imports (each edge in exactly one bucket):")
console.log(`  ${padL(B.eligible, 8)}  single-segment path in the stdlib list  -> ${B.verified} verify (extOK) · ${B.refuted} REFUTE (extFAIL) · ${B.other} other`)
console.log(`  ${padL(B.singleNotStdlib, 8)}  single-segment path NOT in the list    -> left untouched (the lane's own predicate would have claimed these)`)
console.log(`  ${padL(B.multiSegment, 8)}  multi-segment path                     -> a claim can only reach \`ext?\`, which is a clause-1 failure like unresolved: NOT counted as a win`)
console.log(`  closure: ${B.eligible + B.singleNotStdlib + B.multiSegment} of the imports bucket`)
console.error(`done in ${Math.round((Date.now() - t0) / 1000)}s`)
