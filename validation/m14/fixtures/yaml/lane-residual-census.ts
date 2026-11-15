// LANE RESIDUAL CENSUS (yaml) — the enumerator the gate cannot be, committed so it can be re-run.
//
// WHY IT EXISTS. `residual-gate --lane yaml` gives per-type counts and `incoming-gate`'s refuted
// worklist is CAPPED at 25 names per type (`incoming-rule.ts`: `out.refutedNames.length < 25`), so
// neither instrument can say WHICH edges are refuted, ambiguous or unresolved. This one classifies
// EVERY edge of the whole admitted population with the ARBITER'S OWN RULE
// (`incoming-rule.ts` classifyEdge/externalClaimOf), over the gate's own discovery rule
// (`git ls-files`, the extension filter, the 1 MB cap) and the gate's own scope (per project),
// and prints the three inventories: refuted by target, unresolved by reason + marker set + target
// shape, ambiguous by target.
//
// KNOWN LIMITATION, stated rather than discovered by a reader: its `candidates()` mirror does NOT
// reproduce the analyzer's role-relative candidate rule, so the CROSS-TAB section's
// "refused but admitted" line is an instrument limitation, not a finding. The direction that
// matters is exact and is proven by extFAIL 0 in the gate: no claim this analyzer made was
// refuted anywhere in the population.
//
// THE COUNTING RULE IS IMPORTED, NOT MIRRORED — including the `contains` predicate
// (`isContainsEdge`), so this instrument reproduces the gate's columns edge for edge. It used to
// call `classifyEdge` without that flag and printed `amb 142` against the gate's 138, all four
// being its own retired contains model; see the call site for the measurement.
//
// THE SAME LIMITATION APPLIES TO THE `claimable` COLUMN of the EXT-Q INVENTORY, and it is stated
// here for the same reason: `claimable` asks "would a file claim on this target have VERIFIED?"
// using the mirror above, so a non-zero count is a LEAD to walk by hand, not a verdict. What IS a
// verdict is `claimable === 0` for a bucket: the mirror is if anything OVER-permissive (it returns
// both the directory-relative and the project-relative candidate), so a bucket it cannot call
// claimable is not claimable by any spelling the analyzer could have used. Every non-zero row is
// printed back with its emitting file under CLAIMABLE EDGES below, so the lead can be walked.
//
//   npx tsx validation/m14/fixtures/yaml/lane-residual-census.ts   (whole corpus, ~10 min)
//
const REPO = process.env.BB_REPO || "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(`${REPO}/src/ast/pool-worker.ts`)
const { classifyEdge, externalClaimOf, isContainsEdge } = await import(`${REPO}/script/m14/incoming-rule.ts`)
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

const ONLY_LOWER_TESTDATA = process.env.BB_ONLY_LOWER_TESTDATA === "1"
const EXCLUDE_LOWER_TESTDATA = process.env.BB_EXCLUDE_LOWER_TESTDATA === "1"
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
// ── THE OTHER ADMISSION, and why this lane measures BOTH ─────────────────────────────────
// The gate's rule above (`git ls-files` + extension + 1 MiB cap) is NOT production's: the indexer
// refuses its built-in `skipPatterns` (lockfiles, `.generated.`, `generated/`, `deps/`, `build/`, …)
// before a file is ever parsed, so the store can never hold a row for such a file. MEASURED over the
// whole corpus, the difference is 53 of 18,364 admitted files (0.29 %) carrying 101,658 `contains`
// edges — 7.4 % of the lane's 1,380,046 — essentially all `pnpm-lock.yaml`. So every number this
// instrument prints has TWO populations, and which one is meant is not a detail: the gate's is the
// arbiter's, production's is the graph the product builds. `BB_CENSUS_PRODUCTION_ADMISSION=1`
// reproduces production's, and the only thing that may differ beyond the file count is the fate of a
// claim whose candidate lived in a refused file — which is exactly the sensitivity worth measuring
// rather than assuming.
const PRODUCTION_ADMISSION = process.env.BB_CENSUS_PRODUCTION_ADMISSION === "1"
const { ParallelIndexerConfig } = await import(`${REPO}/src/ast/parallel-indexer.ts`)
const refusedByDiscovery: string[] = []
const SIZE_CAP = 1024 * 1024
const EXTS = [".yaml", ".yml"]
const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]

// ── discovery, the gate's rule ─────────────────────────────────────────────────────────
const perRepo = new Map()   // repo -> { root, files: string[] }
let totalFiles = 0, absent = 0, overCap = 0
for (const name of readdirSync(CR).sort()) {
  const dir = join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  const files = []
  for (const rel of tracked) {
    if (!EXTS.some((e) => rel.toLowerCase().endsWith(e))) continue
    // THE `**/testData/**` QUESTION. The `ignore` package matches that camelCase glob
    // CASE-INSENSITIVELY, so the INDEXER's discovery swallows lowercase `testdata/` too — 7,065
    // routed-extension files on this lane. THIS instrument (and the gate) walk with `git ls-files`
    // and never consult that glob, so those files were ALWAYS in the population measured here; the
    // filter below exists to measure what they CONTRIBUTE, and to price the population the indexer
    // would give, without having to trust an argument about which walk is which.
    const parts = rel.split("/").slice(0, -1)
    const lowerTestdata = parts.some((p) => p === "testdata")
    if (ONLY_LOWER_TESTDATA && !lowerTestdata) continue
    if (EXCLUDE_LOWER_TESTDATA && lowerTestdata) continue
    const abs = join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) { overCap++; continue } } catch { absent++; continue }
    if (PRODUCTION_ADMISSION && ParallelIndexerConfig.skipPatterns.some((p: RegExp) => p.test(abs))) {
      refusedByDiscovery.push(`${name}/${rel}`)
      continue
    }
    files.push(abs)
  }
  if (files.length === 0) continue
  files.sort()
  perRepo.set(name, { root: dir, files })
  totalFiles += files.length
}
console.log(`population: ${totalFiles} admitted .yaml,.yml files across ${perRepo.size} repos (${absent} absent, ${overCap} over cap)${PRODUCTION_ADMISSION ? ` — PRODUCTION ADMISSION: ${refusedByDiscovery.length} file(s) the indexer's own skipPatterns refuse are EXCLUDED` : " — the GATE's admission (production refuses its built-in skipPatterns; re-run with BB_CENSUS_PRODUCTION_ADMISSION=1 for that population)"}`)


// ── the analyzer's candidate rule, mirrored from real-yaml-analyzer.ts (private methods) ──
const toPosix = (p: string) => { let o = ""; for (const ch of p) o += ch === "\\" ? "/" : ch; let e = o.length; while (e > 0 && o[e - 1] === "/") e--; return o.slice(0, e) }
const projectRelative = (f: string, r: string) => { const rr = toPosix(r), ff = toPosix(f); if (!rr || ff === rr || !ff.startsWith(rr + "/")) return null; return ff.slice(rr.length + 1) }
const normalizePosix = (p: string): string | null => { const parts: string[] = []; for (const seg of p.split("/")) { if (!seg || seg === ".") continue; if (seg === "..") { if (!parts.length) return null; parts.pop(); continue } parts.push(seg) } return parts.length ? parts.join("/") : null }
function candidates(written: string, filePath: string): string[] | null {
  if (written.includes("://")) return null
  const rel = projectRelative(filePath, CR)
  if (rel === null) return null
  const cut = rel.lastIndexOf("/")
  const dir = cut >= 0 ? rel.slice(0, cut) : ""
  const trimmed = written.startsWith("./") ? written.slice(2) : written
  const rooted = trimmed.startsWith("/")
  const out: string[] = []
  const add = (p: string) => { const n = normalizePosix(p); if (n && !out.includes(n)) out.push(n) }
  add(rooted ? trimmed.slice(1) : dir ? `${dir}/${trimmed}` : trimmed)
  if (!rooted) add(trimmed)
  return out.length ? out : null
}

// ── per-project key space + facts, built from symbols (the gate's own countKey rule) ────
type Tally = { edges: number; resolved: number; ambDecl: number; ambKind: number; unres: number; extOK: number; extQ: number; extFAIL: number; bindOK: number; bindQ: number; bindFAIL: number; causeOK: number; causeFAIL: number }
const blank = (): Tally => ({ edges: 0, resolved: 0, ambDecl: 0, ambKind: 0, unres: 0, extOK: 0, extQ: 0, extFAIL: 0, bindOK: 0, bindQ: 0, bindFAIL: 0, causeOK: 0, causeFAIL: 0 })
const tallyOf = new Map(TYPES.map((t) => [t, blank()]))
const total = blank()
/** THE SAME TALLY PER PROJECT, because the original finding (107 refuted) was measured on
 *  ansible alone and the Lead's worklist is the whole corpus. One run answers both. */
const perRepoTally = new Map()   // repo -> Map<type, Tally>
const repoBlank = (repo) => { if (!perRepoTally.has(repo)) perRepoTally.set(repo, new Map(TYPES.map((t) => [t, blank()]))); return perRepoTally.get(repo) }

const refuted = new Map()      // key -> { type, target, n, files:Set, claims:Set }
const crossTab = { agreeClaimed: 0, agreeNotClaimed: 0, disagreeClaimedNotAdmitted: 0, refusedButAdmitted: 0 }
const unresolved = new Map()   // key -> { type, sig, reason, shape, n, samples:[] }
const ambiguous = new Map()    // key -> { type, target, decls, n, samples:[] }
/** EXT-Q INVENTORY — every edge whose external claim the project can neither confirm nor deny.
 *  Bucketed by EMITTING SITE (type + relationshipType) and by TARGET SHAPE, with the FALSIFIER:
 *  would a file claim on this same target have been VERIFIED against the admitted list? A bucket
 *  with any claimable edge is a FIX (the analyzer is making a claim it cannot support), not a
 *  ruling. */
const extq = new Map()         // key -> { type, rt, shape, claim, n, claimable, samples:[] }
/** EVERY edge the mirror above could have claimed with a file claim — named, not counted, because
 *  the column is a LEAD (see the header). Each one is walked by hand: fix, or mirror artefact. */
const claimableEdges = []      // { type, rt, claim, repo, file, target, admitted[] }
const shapeOf = (t) => {
  if (/[{}$\s*?]/.test(t)) return /[*?]/.test(t) ? "glob" : /[{}$]/.test(t) ? "template" : "whitespace"
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(t)) return "uri-scheme"
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) return "free-form"
  if (t.includes("/")) return "path-like"
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(t)) return "bare-identifier"
  if (t.includes(".")) return "dotted"
  return "other"
}
/** The analyzer's own admissibility test for a file claim, mirrored (same rule as
 *  `isLiteralPathSpelling` + the `.ya?ml` requirement `keywordIncludeClaim` adds). */
const pathSpelled = (t) => !/[{}$\s*?]/.test(t) && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(t) && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t) && /\.ya?ml$/i.test(t)
const sigOf = (md) => { const k = Object.keys(md).filter((x) => x !== "evidenceClass" && x !== "analysisVersion" && md[x] !== false && md[x] != null).sort(); return k.length ? k.join("+") : "(no marker)" }

const bump = (T: Tally, o: string): void => {
  switch (o) {
    case "resolved": T.resolved++; break
    case "ambDeclOnly": T.ambDecl++; break
    case "ambBoth": T.ambDecl++; T.ambKind++; break
    case "unresolved": T.unres++; break
    case "externalVerified": T.extOK++; break
    case "externalUnverified": T.extQ++; break
    case "externalRefuted": T.extFAIL++; break
    case "bindingVerified": T.bindOK++; break
    case "bindingUnverified": T.bindQ++; break
    case "bindingRefuted": T.bindFAIL++; break
    case "causeDeclared": T.causeOK++; break
    case "causeRefuted": T.causeFAIL++; break
  }
}

let parsed = 0, failed = 0, degraded = 0, done = 0
for (const [repo, { root, files }] of perRepo) {
  const projectDecl = new Map()
  const projectKinds = new Map()
  const admittedRel = new Set()
  for (const abs of files) admittedRel.add(abs.slice(root.length + 1).split("\\").join("/"))
  const facts = { packages: new Set(), files: admittedRel, sdkLib: false }
  // PHASE 1 — parse, build THIS project's key space, hold the edges (per project only, so the
  // memory bound is one project rather than the corpus).
  const pending = []
  for (const abs of files) {
    let r
    try { r = await parseFile(abs, root, { projectRoot: root }) } catch { failed++; continue }
    if (!r) { failed++; continue }
    parsed++
    if (r.fallback === true || r.metadata?.analysisVersion === "2.0-basic-fallback") degraded++
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (name.length === 0) continue
      const kind = String(s?.kind ?? "")
      const add = (k) => { projectDecl.set(k, (projectDecl.get(k) ?? 0) + 1); let ks = projectKinds.get(k); if (!ks) projectKinds.set(k, (ks = new Set())); ks.add(kind) }
      add(name)
      const q = String(s?.qualifiedName ?? "")
      if (q.length > 0 && q !== name) add(q)
    }
    for (const e of r.relationships ?? []) pending.push({ e, abs })
  }
  // PHASE 2 — classify over the finished key space.
  for (const { e, abs } of pending) {
    const type = String(e.type ?? "")
    if (!tallyOf.has(type)) continue
    const tgt = String(e.target ?? e.to ?? e.toSymbol ?? "")
    const T = tallyOf.get(type)
    T.edges++; total.edges++
    if (tgt.length === 0) continue
    const md = e.metadata ?? {}
    const claim = externalClaimOf(e)
    // THE GATE'S OWN RULE, INCLUDING ITS `contains` PREDICATE. `classifyEdge` takes the caller's
    // `containsLike` as its sixth argument (`isContainsEdge(label)`), because production resolves a
    // containment with its own `WHERE s.project_id = ? AND s.name = ? ORDER BY (s.file_id = ?) DESC
    // LIMIT 1` statement — no "N candidates" state at all. Calling this WITHOUT the flag mirrored
    // the retired declaration-count model and printed `amb 142` where the gate printed 138; the
    // four were this instrument's own lag, and a lane whose enumerator and gate disagree by 4 is a
    // lane where a reader can pick the wrong number. Importing the predicate retires the caveat
    // instead of documenting it — bash-lane's pattern, and the reason its split is evidence about
    // the gate rather than about its own probe.
    const c = classifyEdge(projectDecl, projectKinds, tgt, claim, facts, isContainsEdge(type))
    bump(T, c.outcome); bump(total, c.outcome)
    bump(repoBlank(repo).get(type), c.outcome)
    const rel = abs.slice(root.length + 1).split("\\").join("/")
    // THE CROSS-TAB the Lead asked for: the analyzer's OWN evidence test (a `statSync`, which is
    // what makes it claim a project file) against the ARBITER'S admitted list (git ls-files + the
    // size cap). A claim the arbiter cannot see is a refutation waiting to happen; a refusal where
    // the arbiter WOULD have verified is a downgrade. Both directions must be measured, not
    // assumed — this is the check json-lane and toml-lane ran before writing anything.
    if (type === "imports" || type === "references") {
      const cands = candidates(tgt, abs)
      const admittedHit = cands !== null && cands.some((x) => admittedRel.has(x))
      const claims = claim?.kind === "projectFile"
      if (claims && !admittedHit) crossTab.disagreeClaimedNotAdmitted++
      else if (!claims && admittedHit) crossTab.refusedButAdmitted++
      else if (claims && admittedHit) crossTab.agreeClaimed++
      else crossTab.agreeNotClaimed++
    }
    if (c.outcome === "externalRefuted" || c.outcome === "bindingRefuted" || c.outcome === "causeRefuted") {
      const k = `${type}\u0000${tgt}`
      const b = refuted.get(k) ?? { type, target: tgt, n: 0, files: new Set(), claims: new Set(), cands: new Set() }
      b.n++; b.files.add(rel)
      b.claims.add(claim === null ? "(none)" : claim.kind)
      if (claim?.kind === "projectFile") for (const x of claim.candidates ?? []) b.cands.add(x)
      refuted.set(k, b)
    }
    if (c.outcome === "externalUnverified" || c.outcome === "bindingUnverified") {
      const rt = typeof md.relationshipType === "string" ? md.relationshipType : "(none)"
      const shape = shapeOf(tgt)
      const claimKind = claim === null ? "(none)" : claim.kind
      const k = `${type}\u0000${rt}\u0000${shape}\u0000${claimKind}`
      const b = extq.get(k) ?? { type, rt, shape, claim: claimKind, n: 0, claimable: 0, samples: [] }
      b.n++
      // THE FALSIFIER: a file claim on this target, checked against the arbiter's own admitted
      // list. If one would verify, this edge is claimable and belongs in a FIX bucket.
      if (pathSpelled(tgt)) {
        const cands = candidates(tgt, abs)
        if (cands !== null && cands.some((x) => admittedRel.has(x))) {
          b.claimable++
          claimableEdges.push({
            type, rt, claim: claimKind, repo, file: abs.slice(root.length + 1),
            target: tgt, admitted: cands.filter((x) => admittedRel.has(x)).slice(0, 3),
          })
        }
      }
      if (b.samples.length < 3) b.samples.push(`${tgt}  @ ${abs.slice(root.length + 1)}`)
      extq.set(k, b)
    }
    if (c.outcome === "unresolved") {
      const reason = typeof md.unresolvedReason === "string" ? md.unresolvedReason : "(no reason)"
      const k = `${type}\u0000${sigOf(md)}\u0000${reason}\u0000${shapeOf(tgt)}`
      const b = unresolved.get(k) ?? { type, sig: sigOf(md), reason, shape: shapeOf(tgt), n: 0, samples: [] }
      b.n++; if (b.samples.length < 6) b.samples.push(`${tgt}  @ ${rel}`)
      unresolved.set(k, b)
    }
    if (c.outcome === "ambDeclOnly" || c.outcome === "ambBoth") {
      const k = `${type}\u0000${tgt}`
      const b = ambiguous.get(k) ?? { type, target: tgt, decls: c.decls, n: 0, samples: [] }
      b.n++; if (b.samples.length < 4) b.samples.push(rel)
      ambiguous.set(k, b)
    }
  }
  done++
  if (done % 10 === 0) process.stderr.write(`  ${done}/${perRepo.size} repos, ${parsed} files parsed\n`)
}

const w = (s, n) => (String(s) + " ".repeat(n)).slice(0, n)
console.log(`\nscanned ${parsed} files, ${failed} failed, ${degraded} degraded\n`)
console.log(`${w("type", 14)} ${w("edges", 9)} ${w("resolved", 9)} ${w("amb(decl)", 10)} ${w("unresolved", 11)} ${w("extOK", 8)} ${w("ext?", 7)} ${w("extFAIL", 8)}`)
console.log("-".repeat(90))
const rowsOut = []
for (const t of TYPES) {
  const T = tallyOf.get(t)
  if (T.edges === 0) continue
  const line = `${w(t, 14)} ${w(T.edges, 9)} ${w(T.resolved, 9)} ${w(T.ambDecl, 10)} ${w(T.unres, 11)} ${w(T.extOK, 8)} ${w(T.extQ, 7)} ${w(T.extFAIL, 8)}`
  console.log(line); rowsOut.push(line)
}
const totLine = `${w("TOTAL", 14)} ${w(total.edges, 9)} ${w(total.resolved, 9)} ${w(total.ambDecl, 10)} ${w(total.unres, 11)} ${w(total.extOK, 8)} ${w(total.extQ, 7)} ${w(total.extFAIL, 8)}`
console.log("-".repeat(90)); console.log(totLine); rowsOut.push(totLine)

console.log(`\n=== EXT-Q INVENTORY (claim the project can neither confirm nor deny) ===`)
const extqRows = [...extq.values()].sort((a, b) => b.n - a.n)
const extqTotal = extqRows.reduce((a, b) => a + b.n, 0)
const extqClaimable = extqRows.reduce((a, b) => a + b.claimable, 0)
console.log(`  TOTAL ${extqTotal} edge(s); ${extqClaimable} of them CLAIMABLE by a file claim`)
console.log(`  (a non-zero claimable is a LEAD, not a FIX: the mirror that produces it is stated in the`)
console.log(`   header as an approximation. ${claimableEdges.length} edge(s) named below.)`)
for (const b of extqRows) {
  console.log(`  ${String(b.n).padStart(5)}  ${String(b.type).padEnd(11)} ${String(b.rt).padEnd(26)} shape=${String(b.shape).padEnd(15)} claim=${String(b.claim).padEnd(13)} claimable=${b.claimable}`)
  for (const x of b.samples) console.log(`           ${x}`)
}

console.log(`\n=== CLAIMABLE EDGES — every ext-Q edge a file claim could have verified (walked by hand) ===`)
for (const c of claimableEdges) {
  console.log(`  ${c.type} ${c.rt} claim=${c.claim}`)
  console.log(`     target   ${JSON.stringify(c.target)}`)
  console.log(`     admitted candidate(s): ${c.admitted.join(" , ")}`)
  console.log(`     in       ${c.repo}/${c.file}`)
}
if (claimableEdges.length === 0) console.log("  (none — every ext-Q edge in this population is unverifiable by every spelling a file claim could use)")

console.log(`\n=== CROSS-TAB: analyzer's statSync claim vs the arbiter's admitted list ===`)
console.log(`  claimed  AND arbiter would verify : ${crossTab.agreeClaimed}   (agreement)`)
console.log(`  claimed  AND arbiter CANNOT verify: ${crossTab.disagreeClaimedNotAdmitted}   (DISAGREEMENT -> a refutation)`)
console.log(`  refused  AND arbiter would verify : ${crossTab.refusedButAdmitted}   (downgrade -> a loss of a true claim)`)
console.log(`  refused  AND arbiter cannot verify: ${crossTab.agreeNotClaimed}   (agreement)`)

console.log(`\n=== PER PROJECT, the types with residual (top 15 by residual) ===`)
const repoResidual = []
for (const [repo, m] of perRepoTally) {
  let resid = 0, edges = 0, ext = 0
  for (const T of m.values()) { resid += T.ambDecl + T.unres + T.extFAIL + T.bindFAIL + T.causeFAIL; edges += T.edges; ext += T.extFAIL }
  if (resid > 0) repoResidual.push({ repo, resid, edges, ext, m })
}
for (const { repo, resid, edges, ext, m } of repoResidual.sort((a, b) => b.resid - a.resid).slice(0, 15)) {
  const parts = []
  for (const t of ["imports", "references", "contains"]) {
    const T = m.get(t)
    if (T && (T.edges > 0)) parts.push(`${t}: e=${T.edges} amb=${T.ambDecl} unres=${T.unres} extFAIL=${T.extFAIL}`)
  }
  console.log(`  ${w(repo, 22)} residual=${w(resid, 7)} of ${w(edges, 9)} edges  extFAIL=${w(ext, 5)}  ${parts.join("  ")}`)
}
const ansible = perRepoTally.get("ansible")
if (ansible) {
  console.log(`\n=== ANSIBLE ALONE (the population the original 107-refutation finding was stated on) ===`)
  for (const t of TYPES) {
    const T = ansible.get(t)
    if (!T || T.edges === 0) continue
    console.log(`  ${w(t, 12)} edges=${w(T.edges, 7)} resolved=${w(T.resolved, 7)} amb=${w(T.ambDecl, 5)} unres=${w(T.unres, 5)} extOK=${w(T.extOK, 6)} ext?=${w(T.extQ, 5)} extFAIL=${T.extFAIL}`)
  }
}

console.log(`\n=== REFUTED INVENTORY (${[...refuted.values()].reduce((a, b) => a + b.n, 0)} edges, ${refuted.size} distinct target(s)) ===`)
for (const b of [...refuted.values()].sort((a, b) => b.n - a.n)) {
  console.log(`  ${String(b.n).padStart(4)}  ${w(b.type, 11)} ${JSON.stringify(b.target)}  claim=${[...b.claims].join("|")}  files=${b.files.size}`)
  if (b.cands.size) console.log(`        candidates: ${[...b.cands].slice(0, 3).join(" , ")}`)
  console.log(`        e.g. ${[...b.files].slice(0, 2).join(" , ")}`)
}

console.log(`\n=== UNRESOLVED BY CAUSE ===`)
for (const b of [...unresolved.values()].sort((a, b) => b.n - a.n).slice(0, 25)) {
  console.log(`  ${String(b.n).padStart(5)}  ${w(b.type, 11)} reason=${w(b.reason, 34)} shape=${w(b.shape, 15)} markers=${b.sig}`)
  for (const s of b.samples.slice(0, 3)) console.log(`           ${s}`)
}

console.log(`\n=== AMBIGUOUS BY TARGET (top 25 of ${ambiguous.size}) ===`)
for (const b of [...ambiguous.values()].sort((a, b) => b.n - a.n).slice(0, 25)) {
  console.log(`  ${String(b.n).padStart(5)}  ${w(b.type, 11)} ${w(b.decls, 5)} decls  ${JSON.stringify(b.target)}  e.g. ${b.samples[0] ?? ""}`)
}
writeFileSync(`${REPO}/.tmp-yaml/residual-census.json`, JSON.stringify({
  population: { files: parsed, failed, degraded, repos: perRepo.size },
  table: rowsOut,
  refuted: [...refuted.values()].map((b) => ({ ...b, files: [...b.files], claims: [...b.claims], cands: [...b.cands] })),
  unresolved: [...unresolved.values()],
  ambiguous: [...ambiguous.values()],
}, null, 1))
console.log(`\nwrote .tmp-yaml/residual-census.json`)
