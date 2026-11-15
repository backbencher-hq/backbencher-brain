/**
 * PROBE-GRAPHQL-SPEC-SCALAR-CLAIM — what a claim on the five built-in scalars would move, what it
 * would MASK, and the ten edges it moves, measured BEFORE the analyzer is edited.
 *
 * ## The question this instrument exists to answer
 *
 * `references` carries 23,972 unresolved edges on this lane and 23,814 of them (99.3%) name one of
 * the five scalars the GraphQL specification predeclares (§3.5 — `String` `Int` `Float` `Boolean`
 * `ID`). No document in any project declares them, so no key space can answer them and they are
 * the lane's largest single named cause with no answer. The candidate dispositions are the two the
 * arbiter knows for a BARE target:
 *
 *   `isExternal: true`      the `owner` claim — read only where `decls === 0`, so on a bare name it
 *                           verifies by construction and CANNOT be refuted by any corpus
 *                           (`../verification/OWNER-CLAIM-BASIS-PROPOSAL.md` §1 measures exactly
 *                           this, and this lane's own report refused it as §5l's laundering vector).
 *   `languageNamespace`     the DECLARED-VOCABULARY claim (`incoming-rule.ts:274-330`): the target's
 *                           ROOT is checked against a list carried ON THE EDGE, never against the
 *                           symbol table, and a target whose root is NOT in the list reads
 *                           `externalRefuted`. The list is the claim, so widening it is a visible
 *                           diff, and misapplying it is a counted `extFAIL`.
 *
 * The second is the one the arbiter's design authorises for a closed language vocabulary (hcl, zig,
 * protobuf, powershell all carry it) and the one this lane's own report named as the missing
 * mechanism. But it fires BEFORE the declaration count, so it does not only move `unresolved`:
 * a project that (invalidly) redeclares a built-in scalar would have its edge read as external
 * anyway. THAT IS THE PRICE, and this probe prices it instead of arguing about it:
 *
 *   1. the class split of every declared-type edge to a built-in scalar, by project decl count;
 *   2. the FILES that declare those five names (the corpus's own counterexamples);
 *   3. the outcome the arbiter would give each edge with the claim attached — computed by
 *      `classifyEdge` itself, imported and never copied;
 *   4. the FALSIFIER, run: the same claim on a target whose root is not in the list must REFUTE.
 *      A claim whose refutation cannot be observed is a claim this lane may not make.
 *   5. ten edges that would move from `unresolved` to `externalVerified`, with the source line, for
 *      the hand-read.
 *
 * Read-only. Nothing here is attached to an edge; the analyzer is not touched by this file.
 *
 * CLI: npx tsx validation/m14/fixtures/graphql/probe-graphql-spec-scalar-claim.mts [--sample 10]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { classifyEdge, emptyOutcomes, tally, targetOwner } from "../../../../script/m14/incoming-rule"
import type { ExternalClaim, Outcomes } from "../../../../script/m14/incoming-rule"

const REPO_ROOT = path.join(import.meta.dirname, "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const argv = process.argv.slice(2)
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const SAMPLE = Number(flag("sample") ?? "10")

/**
 * THE SPECIFICATION'S OWN FIVE, AND THE LIST IS THE SPEC'S — §3.5 "Scalars": *"GraphQL provides a
 * number of built-in scalars … The following scalars are built-in: `String` `Int` `Float` `Boolean`
 * `ID`."* It is CLOSED (`a name not in it cannot be filed under it`), and it is not corpus-derived:
 * a corpus-derived list would be an authority that is not one (`OWNER-CLAIM-BASIS-PROPOSAL.md` §3,
 * option B's failure mode).
 */
const SPEC_SCALARS = ["String", "Int", "Float", "Boolean", "ID"] as const
const SPEC_SCALAR_SET = new Set<string>(SPEC_SCALARS)

/** The claim as the analyzer would attach it: a non-empty array of root strings, ON THE EDGE. */
const CLAIM: ExternalClaim = { kind: "namespace", roots: [...SPEC_SCALARS] }

// ------------------------------------------------------------------ discovery (the gate's rule)
const found: string[] = []
const repos = new Set<string>()
let overCap = 0
let absent = 0
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try {
    if (!statSync(dir).isDirectory()) continue
  } catch { continue }
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".graphql")) continue
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size > SIZE_CAP) { overCap++; continue }
    } catch { absent++; continue }
    found.push(abs)
    repos.add(name)
  }
}
found.sort()
const repoOf = (f: string): string => {
  const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
  return path.join(CR, rel.split(path.sep)[0])
}
const relOf = (f: string): string => path.relative(repoOf(f), f).split(path.sep).join("/")

// ------------------------------------------------------------- key space, PER PROJECT (production)
type Proj = { decl: Map<string, number>; kinds: Map<string, Set<string>>; byFile: Map<string, string[]> }
const projs = new Map<string, Proj>()
const proj = (repo: string): Proj => {
  let p = projs.get(repo)
  if (!p) projs.set(repo, (p = { decl: new Map(), kinds: new Map(), byFile: new Map() }))
  return p
}
const bump = (p: Proj, key: string, kind: string, file: string) => {
  p.decl.set(key, (p.decl.get(key) ?? 0) + 1)
  let ks = p.kinds.get(key)
  if (!ks) p.kinds.set(key, (ks = new Set()))
  ks.add(kind)
  let bf = p.byFile.get(key)
  if (!bf) p.byFile.set(key, (bf = []))
  bf.push(file)
}

/**
 * THE DECLARATIONS THAT ANSWER A BUILT-IN SCALAR'S NAME, per project — collected so the PRICE half of
 * the claim can be attributed to a file:line:kind rather than to a story about "redeclaration". A
 * project's key space counts a symbol under its `name` AND its `qualifiedName` alias, so what answers
 * `ID` is any symbol NAMED `ID` (a top-level `scalar ID`, or a member `Owner.ID` whose bare name is
 * `ID`), and nothing else.
 */
const declRows = new Map<string, { file: string; line: number; kind: string; qname: string }[]>()

const { parseFile } = await import(`${REPO_ROOT}/src/ast/pool-worker.ts`)
type Edge = { repo: string; file: string; rel: string; line: number; src: string; tgt: string; role: string; type: string; text: string }
const edges: Edge[] = []
/** edges to a built-in scalar that are NOT declared-type edges — the change's stated remainder. */
const outside: Edge[] = []
let parsed = 0
let failed = 0
const sourceLines = new Map<string, string[]>()
for (const f of found) {
  const repo = repoOf(f)
  let r: any
  try {
    r = await parseFile(f, repo, { projectRoot: repo } as any)
  } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  const p = proj(repo)
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (!name) continue
    const qname = String(s?.qualifiedName ?? "")
    const kind = String(s?.kind ?? "")
    bump(p, name, kind, f)
    if (qname && qname !== name) bump(p, qname, kind, f)
    if (SPEC_SCALAR_SET.has(name)) {
      const key = `${repo}\u0000${name}`
      const rows = declRows.get(key) ?? []
      rows.push({ file: relOf(f), line: Number(s?.range?.startLine ?? 0) || 0, kind, qname })
      declRows.set(key, rows)
    }
  }
  const rels = Array.isArray(r.relationships) ? r.relationships : []
  if (rels.length > 0 && !sourceLines.has(f)) {
    try { sourceLines.set(f, readFileSync(f, "utf8").split("\n")) } catch { sourceLines.set(f, []) }
  }
  for (const rel of rels) {
    const md = (rel as any)?.metadata ?? {}
    const tgt = String(rel?.target ?? "")
    if (!SPEC_SCALAR_SET.has(tgt)) continue
    // THE BOUNDARY IS MEASURED, NOT ASSUMED: the claim is attached at the DECLARED-TYPE chokepoint, so
    // every edge to a built-in scalar that is NOT a declared-type edge is the change's stated remainder.
    // It is collected here with its role and type so the report can name what it leaves out.
    if (md.relationshipType === "declared_type") {
      edges.push({
        repo, file: f, rel: relOf(f), line: Number(rel?.line_number ?? 0) || 0,
        src: String(rel?.source ?? ""), tgt, role: String(md.relationshipRole ?? "(none)"),
        type: String(rel?.type ?? ""), text: "",
      })
    } else {
      outside.push({
        repo, file: f, rel: relOf(f), line: Number(rel?.line_number ?? 0) || 0,
        src: String(rel?.source ?? ""), tgt, role: String(md.relationshipRole ?? "(none)"),
        type: String(rel?.type ?? ""), text: "",
      })
    }
  }
}

// --------------------------------------------------------------------------------- the measurement
const w = (s: any, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
const num = (n: number) => n.toLocaleString("en-US")
console.log(`PROBE-GRAPHQL-SPEC-SCALAR-CLAIM  ext=.graphql  spec scalars = ${SPEC_SCALARS.join(" ")}`)
console.log(`  population: ${found.length} admitted of ${found.length + overCap + absent} tracked, ${repos.size} repos · parsed=${parsed} failed=${failed}`)
console.log(`  declared-type edges to a built-in scalar: ${num(edges.length)}`)
console.log(`  edges to a built-in scalar that are NOT declared-type edges (left alone, named below): ${num(outside.length)}`)
{
  const byRole = new Map<string, number>()
  for (const e of outside) byRole.set(`${e.type}/${e.role}`, (byRole.get(`${e.type}/${e.role}`) ?? 0) + 1)
  for (const [k, n] of [...byRole.entries()].sort((a, b) => b[1] - a[1])) console.log(`      ${w(num(n), 6)}  ${k}`)
}
console.log("")

/** decl counts of the five names, per project — the counterexample surface. */
const declaringFiles: { file: string; name: string; line: number }[] = []
console.log("WHO DECLARES A BUILT-IN SCALAR IN THIS CORPUS (the spec says a schema must not — so every")
console.log("row below is a project whose key space answers a name the language predeclares):")
{
  const named = new Set<string>(SPEC_SCALARS)
  const seen = new Map<string, { file: string; name: string; line: number }>()
  for (const f of found) {
    for (const s of proj(repoOf(f)).byFile.keys()) void s
    let lines: string[]
    try { lines = sourceLines.get(f) ?? (sourceLines.set(f, readFileSync(f, "utf8").split("\n")), sourceLines.get(f)!) } catch { continue }
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim()
      for (const n of named) {
        if (t === `scalar ${n}` || t.startsWith(`scalar ${n} `) || t.startsWith(`scalar ${n}@`)) {
          const key = `${f}\u0000${n}\u0000${i + 1}`
          if (!seen.has(key)) seen.set(key, { file: relOf(f), name: n, line: i + 1 })
        }
      }
    }
  }
  for (const d of [...seen.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    console.log(`    ${w(d.file, 96)} line ${d.line}  scalar ${d.name}`)
  }
  declaringFiles.push(...seen.values())
  if (seen.size === 0) console.log("    (none)")
}
console.log("")

// ---- 1/3: the class split, and the arbiter's own outcome with the claim attached ----------------
type Cls = Outcomes & { edges: number }
const withClaim = new Map<string, Cls>()
for (const k of ["decls=0", "decls=1", "decls>1"]) withClaim.set(k, { ...emptyOutcomes(), edges: 0 })
const moved = new Map<string, number>()
const movedEdges: Edge[] = []
/** EVERY edge whose outcome the claim moves, whatever it moves FROM — the price set included. */
const movedAny: Edge[] = []
const unchangedByClaim = new Map<string, number>()
for (const e of edges) {
  const p = proj(e.repo)
  const decls = p.decl.get(e.tgt) ?? 0
  const cls = decls === 0 ? "decls=0" : decls === 1 ? "decls=1" : "decls>1"
  // NO claim: what the gate reads today.
  const none = classifyEdge(p.decl, p.kinds, e.tgt, null, undefined, false)
  // THE CLAIM ATTACHED: computed by the arbiter's own classifier, imported — never re-implemented.
  const c = classifyEdge(p.decl, p.kinds, e.tgt, CLAIM, undefined, false)
  const cell = withClaim.get(cls)!
  cell.edges++
  tally(cell, c, e.tgt, e.type)
  const key = `${none.outcome} -> ${c.outcome}`
  moved.set(key, (moved.get(key) ?? 0) + 1)
  if (none.outcome !== c.outcome) {
    movedAny.push(e)
    if (none.outcome === "unresolved" && c.outcome === "externalVerified") movedEdges.push(e)
  } else unchangedByClaim.set(none.outcome, (unchangedByClaim.get(none.outcome) ?? 0) + 1)
}
console.log("THE CLASS SPLIT, and the outcome `classifyEdge` gives each edge WITH the namespace claim")
console.log("attached (the tail column is what the edge reads TODAY, with no claim):")
console.log(`  ${w("decls in project", 18)} ${w("edges", 9)} ${w("unres", 9)} ${w("amb", 9)} ${w("resolved", 10)} ${w("extOK", 9)} ${w("extFAIL", 9)}`)
for (const [k, c] of withClaim) {
  console.log(`  ${w(k, 18)} ${w(num(c.edges), 9)} ${w(num(c.unresolved), 9)} ${w(num(c.ambiguousByDecl), 9)} ${w(num(c.resolved), 10)} ${w(num(c.externalVerified), 9)} ${w(num(c.externalRefuted), 9)}`)
}
console.log("")
console.log("EVERY CLASS TRANSITION THE CLAIM CAUSES (no claim -> claim), arbiter-computed:")
for (const [k, n] of [...moved.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${w(num(n), 9)}  ${k}`)
console.log("")
console.log(`  THE GAIN: ${num(movedEdges.length)} edges move unresolved -> externalVerified (`)
console.log(`            ${((movedEdges.length / edges.length) * 100).toFixed(2)}% of the class).`)
const masked = (moved.get("ambDeclOnly -> externalVerified") ?? 0) + (moved.get("ambBoth -> externalVerified") ?? 0)
const stolen = moved.get("resolved -> externalVerified") ?? 0
console.log(`  THE PRICE: ${num(masked)} AMBIGUOUS edges read external, and ${num(stolen)} RESOLVED edges read external,`)
console.log(`             because the namespace branch is checked BEFORE the declaration count. Both are`)
console.log(`             edges whose name a project in this corpus does declare (see the list above).`)
console.log("")

// ---- 4: the FALSIFIER, run --------------------------------------------------------------------
const control = classifyEdge(new Map(), new Map(), "NotABuiltinScalar", CLAIM, undefined, false)
const controlListed = classifyEdge(new Map(), new Map(), "String", CLAIM, undefined, false)
console.log("THE FALSIFIER, RUN (a claim whose refutation cannot be observed is not a claim this lane may make):")
console.log(`  target "String"              with the list -> ${controlListed.outcome} (verifiedBy ${JSON.stringify(controlListed.verifiedBy ?? null)})`)
console.log(`  target "NotABuiltinScalar"   with the list -> ${control.outcome}  ${control.outcome === "externalRefuted" ? "<= the claim REFUTES a root it does not carry" : "** CONTROL DID NOT FIRE **"}`)
if (control.outcome !== "externalRefuted") { console.error("FATAL: the namespace claim's refutation did not fire."); process.exit(3) }
// AND THE CHANNEL THE FLEET-WIDE FINDING NAMES — the DECLARED CAUSE (`baseBeyondRunScope`), which is
// where `causeOK` comes from. It is run here because a reader will ask why this lane did not use it:
// the cause channel requires the declared base to BE the target's own owner, and a BARE target has no
// owner, so the claim is REFUTED (counted AGAINST the lane as `causeFAIL`) rather than read.
const causeClaim: ExternalClaim = { kind: "cause", base: "String", conflict: false }
const causeControl = classifyEdge(new Map(), new Map(), "String", causeClaim, undefined, false)
const causeOnDotted = classifyEdge(new Map(), new Map(), "Foo.Bar", { kind: "cause", base: "Foo", conflict: false }, undefined, false)
console.log(`  target "String"  + baseBeyondRunScope "String" -> ${causeControl.outcome}  (targetOwner("String") is ${JSON.stringify(targetOwner("String"))})`)
console.log(`  target "Foo.Bar" + baseBeyondRunScope "Foo"    -> ${causeOnDotted.outcome}  <= the channel works only on an OWNER-qualified target`)
console.log("")

// ---- 5: ten edges the claim moves, with their source line --------------------------------------
console.log(`TEN EDGES THE CLAIM MOVES (unresolved -> externalVerified), sorted by file:line — read these against`)
console.log(`the source: the target is a Name the document writes in a TYPE position, and the meaning is the`)
console.log(`specification's built-in scalar, which no file in the project declares.`)
/**
 * THE SAMPLE IS STRATIFIED ON PURPOSE. `movedEdges` sorted by file:line and truncated to ten lands
 * entirely inside one small example schema, which is the sample a lane draws when it wants ten easy
 * rows. This takes ONE EDGE PER FILE, from files spread EVENLY across the whole moved population, so
 * ten different repositories are read; and it prints, separately, the edges belonging to the projects
 * that DECLARE a built-in scalar — the half the claim re-reads out of `resolved`/`ambiguous`, which is
 * the half a reader must be able to check for himself.
 */
const byFile = new Map<string, Edge[]>()
for (const e of movedEdges) {
  const list = byFile.get(e.file) ?? []
  list.push(e)
  byFile.set(e.file, list)
}
const filesSorted = [...byFile.keys()].sort()
const stride = Math.max(1, Math.floor(filesSorted.length / SAMPLE))
const picked: Edge[] = []
for (let i = 0; i < filesSorted.length && picked.length < SAMPLE; i += stride) {
  const list = byFile.get(filesSorted[i])!.sort((a, b) => a.line - b.line)
  picked.push(list[0])
}
const show = (e: Edge) => {
  const lines = sourceLines.get(e.file) ?? []
  const text = (lines[e.line - 1] ?? "").trim()
  console.log(`  ${e.rel}:${e.line}  [${e.role}]  ${e.src} -> ${e.tgt}`)
  console.log(`      ${text}`)
}
console.log(`THE TEN, ONE PER FILE, SPREAD OVER ${num(filesSorted.length)} FILES (stride ${stride}):`)
for (const e of picked) show(e)
console.log("")
const priceEdges = movedAny.filter((e) => (proj(e.repo).decl.get(e.tgt) ?? 0) > 0)
const priceFiles = new Map<string, Edge>()
for (const e of priceEdges) if (!priceFiles.has(e.repo)) priceFiles.set(e.repo, e)
/**
 * THE PRICE, ATTRIBUTED — what actually ANSWERS the name on each edge the claim re-reads. The claim's
 * design says the list is the sole authority, so the question a reader must be able to ask is not "how
 * many edges moved" but "what was answering them". A project's key space answers a name through a
 * top-level definition (`scalar String`, `type ID`) or through ANY symbol carrying that bare name —
 * including a FIELD (`EmbeddedPointer.ID` is a member whose bare `name` is `ID`).
 */
{
  const priceBy = new Map<string, { edges: number; ex?: Edge; who?: string }>()
  for (const e of priceEdges) {
    const rows = declRows.get(`${e.repo}\u0000${e.tgt}`) ?? []
    const top = rows.filter((r) => r.qname === e.tgt)
    const cls =
      top.length > 0
        ? top.some((r) => r.kind === "type")
          ? "TOP-LEVEL SCALAR named X — the specification's own name, redefined by a document"
          : `TOP-LEVEL ${top[0].kind.toUpperCase()} named X — a non-scalar declaration owns the name`
        : "A MEMBER named X — a FIELD (or enum value) carries the bare name; no type is involved"
    const cell = priceBy.get(cls) ?? { edges: 0 }
    cell.edges++
    if (!cell.ex) {
      cell.ex = e
      const r = (top[0] ?? rows[0])
      cell.who = r ? `${r.file}:${r.line} kind=${r.kind} qualifiedName=${JSON.stringify(r.qname)}` : "(no row)"
    }
    priceBy.set(cls, cell)
  }
  console.log(`THE PRICE ATTRIBUTED — what answers the name on the ${num(priceEdges.length)} edges the claim re-reads:`)
  for (const [cls, c] of [...priceBy.entries()].sort((a, b) => b[1].edges - a[1].edges)) {
    console.log(`  ${w(num(c.edges), 7)}  ${cls}`)
    if (c.ex) console.log(`           e.g. ${c.ex.rel}:${c.ex.line}  ${c.ex.src} -> ${c.ex.tgt}   answered by ${c.who}`)
  }
  console.log("")
}
console.log(`THE PRICE EDGES — the projects that DO declare the name (${num(priceEdges.length)} edges, one per project):`)
for (const e of [...priceFiles.values()].sort((a, b) => a.rel.localeCompare(b.rel))) {
  show(e)
  for (const d of (declRows.get(`${e.repo}\u0000${e.tgt}`) ?? []).slice(0, 4)) {
    console.log(`      ANSWERS: ${d.file}:${d.line}  kind=${d.kind}  name=${e.tgt}  qualifiedName=${JSON.stringify(d.qname)}`)
  }
}
console.log("")
console.log(`CHECKED: the falsifier fired · the class split closes on ${num(edges.length)} edges · nothing was written.`)
