/**
 * TOML WHOLE-POPULATION RESIDUAL SPLIT — the four questions the residual gate's table cannot answer
 * on its own, measured on the SAME population the gate measures (whole admitted .toml corpus).
 *
 * ## Why this file exists
 *
 * `npx tsx script/m14/residual-gate.ts --lane toml` prints the per-type table and is the instrument
 * the four-clause bar is read from. It answers "how many edges are not resolved". It does NOT answer:
 *
 *   1. WHICH DECLARATION a resolved edge is bound to. The gate's `ofWhich` is an UPPER BOUND and its
 *      own legend says so ("only the store can split it"). The exact test the gate itself uses for
 *      the BINDING INTENT block is `(own file, own line)` — `incoming-gate.ts:classifyIntent` — and
 *      this probe re-derives that split independently and prints it per type. A disagreement between
 *      the two is evidence about THIS probe, which is why the gate's own printed intent columns are
 *      carried here as the expected value (bash-lane's rule: a probe that cannot reproduce the
 *      gate's columns is evidence about the probe).
 *   2. WHICH EDGES are unresolved and WHERE. A count of 13 is not a location; the four-clause bar
 *      asks for a NAMED cause with a measured count, and a cause you cannot point at is prose.
 *   3. Whether the NAMED CAUSE survives its own falsifier, and what the two candidate "fixes" would
 *      actually do. Both fix arms are RUN here over the same unresolved edges, through the SHARED
 *      (`verifyFileClaim`, `verifyExternalClaim` in `script/m14/incoming-rule.ts`) — the same
 *      functions the arbiter calls — instead of being argued about.
 *   4. The `exports` gap the language board names: publish-surface key sites and whether ANY of them
 *      names a declaration (the measurement `toml-applicability-audit.ts` reports as missing).
 *
 * ## The counting rule is IMPORTED, not copied
 *
 * Every per-type column is computed with `classifyEdge` and `externalClaimOf` from
 * `script/m14/incoming-rule.ts` — the one rule the gate and its positive control both call. The only
 * transcription here is `classifyIntent`'s three-line test, and it is cross-checked against the
 * gate's printed intent block rather than trusted.
 *
 * ## The production path, not the analyzer
 *
 * Edges come from `parseFile` (`src/ast/pool-worker.ts`) with `projectRoot` set to the file's own
 * repository — the identical call `incoming-gate.ts` makes. `analyzer.analyze()` directly would
 * measure a key space production does not have (php-lane's falsifier, HANDOFF §5k).
 *
 * READ-ONLY on the corpus. Writes only the file named by --json.
 *
 *   npx tsx validation/m14/fixtures/toml/tools/residual-whole-population.mts [--json=<path>]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const EXTS = ["toml"]
const JSON_OUT = (process.argv.find((a) => a.startsWith("--json=")) ?? "").split("=")[1] ?? null

const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
const RULE = await import(path.join(ROOT, "script/m14/incoming-rule.ts"))
const { fileClaimForTarget, projectRelativeOf, dirOf } = await import(path.join(ROOT, "src/ast/file-claim.ts"))

/**
 * THE EXPECTED COLUMNS — the live `residual-gate.ts --lane toml` run this probe must reproduce.
 * Recorded as data so the check is a comparison and not a memory: a probe that agrees with itself
 * proves nothing.
 */
const EXPECTED: Record<string, { edges: number; resolved: number; ofWhich: number; amb: number; unres: number; extOK: number; extFAIL: number; intended: number; twin: number; noDecl: number }> = {
  contains: { edges: 25033, resolved: 25033, ofWhich: 0, amb: 0, unres: 0, extOK: 0, extFAIL: 0, intended: 25033, twin: 0, noDecl: 0 },
  references: { edges: 1350, resolved: 1350, ofWhich: 0, amb: 0, unres: 0, extOK: 0, extFAIL: 0, intended: 0, twin: 1085, noDecl: 0 },
  // 2026-10-14: the SOURCE-PATH claim (1aad2e4a7) plus the gate's `needsFacts` fix turned 5 of the
  // 10 into VERIFIED claims: unresolved 10 -> 5, extOK 321 -> 326. The 5 that remain are BARE names.
  imports: { edges: 331, resolved: 0, ofWhich: 0, amb: 0, unres: 5, extOK: 326, extFAIL: 0, intended: 0, twin: 0, noDecl: 331 },
  // LEAD RULING 2026-10-13: `exports` is a PUBLISHED NAME, and this lane emits NONE — the corpus's
  // 174 publish-surface SITES name paths/directories/coordinates, and the data test refuses all of
  //  them. The gate prints no exports row because the count is zero; this row makes that a positive
  //  statement rather than an absence a reader has to notice.
  exports: { edges: 0, resolved: 0, ofWhich: 0, amb: 0, unres: 0, extOK: 0, extFAIL: 0, intended: 0, twin: 0, noDecl: 0 },
}

const repoOf = (f: string): string => path.join(CR, path.relative(CR, f).split(path.sep)[0])
const relOf = (repo: string, f: string): string => path.relative(repo, f).split(path.sep).join("/")

/** THE GATE'S ADMISSION RULE, transcribed: tracked by git, present on disk, under the engine cap. */
function discover(): { files: string[]; repos: string[]; absent: number; overCap: number } {
  const files: string[] = []
  const repos: string[] = []
  let absent = 0
  let overCap = 0
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const low = rel.toLowerCase()
      if (!EXTS.some((e) => low.endsWith(`.${e}`))) continue
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > SIZE_CAP) { overCap++; continue }
      } catch { absent++; continue }
      files.push(abs)
    }
    repos.push(name)
  }
  files.sort()
  return { files, repos, absent, overCap }
}

type Pos = { file: string; line: number }
const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
const LINE_IS_TARGET_LINE = new Set(["contains", "exports"])

const pop = discover()
process.stderr.write(`population: ${pop.files.length} admitted .toml files across ${pop.repos.length} repos (absent ${pop.absent}, over cap ${pop.overCap})\n`)

// ── PHASE 1 — parse the whole population and build each project's key space ───────────────────────
const decl = new Map<string, Map<string, number>>()
const kinds = new Map<string, Map<string, Set<string>>>()
const pos = new Map<string, Pos[]>()
const admittedByRepo = new Map<string, Set<string>>()
const parsedFiles: { abs: string; repo: string; rel: string; symbols: any[]; relationships: any[] }[] = []
let failed = 0
let emptyResults = 0

for (let i = 0; i < pop.files.length; i++) {
  const abs = pop.files[i]
  const repo = repoOf(abs)
  let r: any
  try {
    r = await parseFile(abs, repo, { projectRoot: repo } as any)
  } catch { failed++; continue }
  if (!r) { failed++; continue }
  if ((r.symbols?.length ?? 0) === 0 && (r.relationships?.length ?? 0) === 0) emptyResults++
  if (i > 0 && i % 500 === 0) process.stderr.write(`  … ${i}/${pop.files.length} parsed\n`)
  if (!decl.has(repo)) {
    decl.set(repo, new Map()); kinds.set(repo, new Map()); pos.set(repo, new Map()); admittedByRepo.set(repo, new Set())
  }
  const d = decl.get(repo)!
  const k = kinds.get(repo)!
  const p = pos.get(repo)!
  const admitted = admittedByRepo.get(repo)!
  admitted.add(relOf(repo, abs))
  const countKey = (key: string, kind: string, line: number | null) => {
    d.set(key, (d.get(key) ?? 0) + 1)
    let ks = k.get(key)
    if (!ks) k.set(key, (ks = new Set()))
    ks.add(kind)
    const at = p.get(key)
    const entry = { file: abs, line: line ?? -1 }
    if (!at) p.set(key, [entry])
    else if (!at.some((x) => x.file === abs && x.line === entry.line)) at.push(entry)
  }
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    // THE GATE'S OWN FALLBACK CHAIN, transcribed exactly (`incoming-gate.ts:973`). The first run of
    // this probe read `s.range.startLine` only and every declaration line came back null, so its
    // `intended` column read 0 where the gate reads 25,033 — one disagreement in thirty compared
    // columns, and the cause was a NORMALISATION the production path applies: `parseFile` publishes
    // `startLine` flat and no `range` at all. The probe was wrong, not the gate (bash-lane's rule).
    const line = Number(s?.range?.startLine ?? s?.range?.start_line ?? s?.range?.line_start ?? s?.line_start ?? s?.lineStart ?? s?.startLine ?? s?.line ?? 0) || null
    countKey(name, String(s?.kind ?? ""), line)
    const q = String(s?.qualifiedName ?? "")
    if (q.length > 0 && q !== name) countKey(q, String(s?.kind ?? ""), line)
  }
  parsedFiles.push({ abs, repo, rel: relOf(repo, abs), symbols: r.symbols ?? [], relationships: r.relationships ?? [], metadata: r.metadata ?? {} })
}
const repoTotal = pop.repos.length
const parsedRepos = decl.size
process.stderr.write(`parsed ${parsedFiles.length} files · failed ${failed} · empty results ${emptyResults} · repos ${parsedRepos}/${repoTotal}\n`)

// ── PHASE 2 — classify every edge through the SHARED rule ─────────────────────────────────────────
type Row = { edges: number; resolved: number; ambColl: number; amb: number; unres: number; extOK: number; extQ: number; extFAIL: number; bindOK: number; bindQ: number; bindFAIL: number; causeOK: number; causeFAIL: number; intended: number; sameFileOffLine: number; foreignOnly: number; nothingAnywhere: number }
const rows = new Map<string, Row>()
const unmapped = new Map<string, number>()
const emptyTarget = new Map<string, number>()
const unresolvedEdges: { type: string; file: string; line: number | null; target: string; claim: string }[] = []
const exportsEdges: string[] = []
let importsTotal = 0
let importsWithClaim = 0
let importsWithoutClaim = 0
const referenceLines: { target: string; edgeLine: number | null; declLine: number | null; sameFile: boolean }[] = []
const claimArms: { file: string; line: number | null; target: string }[] = []

for (const f of parsedFiles) {
  const d = decl.get(f.repo)
  const k = kinds.get(f.repo)
  const p = pos.get(f.repo)
  if (!d || !k || !p) continue
  const facts = { packages: new Set<string>(), files: admittedByRepo.get(f.repo) ?? new Set<string>(), sdkLib: false }
  for (const rel of f.relationships) {
    const label = String(rel?.type ?? rel?.relationshipType ?? "")
    if (!TYPES.includes(label)) { unmapped.set(label, (unmapped.get(label) ?? 0) + 1); continue }
    let row = rows.get(label)
    if (!row) rows.set(label, (row = { edges: 0, resolved: 0, ambColl: 0, amb: 0, unres: 0, extOK: 0, extQ: 0, extFAIL: 0, bindOK: 0, bindQ: 0, bindFAIL: 0, causeOK: 0, causeFAIL: 0, intended: 0, sameFileOffLine: 0, foreignOnly: 0, nothingAnywhere: 0 }))
    row.edges++
    const tgt = String(rel?.target ?? "")
    if (tgt.length === 0) { emptyTarget.set(label, (emptyTarget.get(label) ?? 0) + 1); continue }
    const claim = RULE.externalClaimOf(rel)
    const isContains = label === "contains"
    const ownFileDeclares = (p.get(tgt) ?? []).some((x) => x.file === f.abs)
    const c = RULE.classifyEdge(d, k, tgt, claim, facts, isContains, ownFileDeclares)
    const line = Number(rel?.line_number ?? rel?.lineNumber ?? rel?.line ?? 0) || null
    if (c.outcome === "resolved") {
      row.resolved++
      if (c.boundAmongCollision) row.ambColl++
    } else if (c.outcome === "ambDeclOnly" || c.outcome === "ambBoth") row.amb++
    else if (c.outcome === "unresolved") row.unres++
    else if (c.outcome === "externalVerified") row.extOK++
    else if (c.outcome === "externalUnverified") row.extQ++
    else if (c.outcome === "externalRefuted") row.extFAIL++
    else if (c.outcome === "bindingVerified") row.bindOK++
    else if (c.outcome === "bindingUnverified") row.bindQ++
    else if (c.outcome === "bindingRefuted") row.bindFAIL++
    else if (c.outcome === "causeDeclared") row.causeOK++
    else if (c.outcome === "causeRefuted") row.causeFAIL++

    // THE INTENT SPLIT — `incoming-gate.ts:classifyIntent`, transcribed and cross-checked.
    const at = p.get(tgt) ?? []
    if (at.length === 0) row.nothingAnywhere++
    else {
      const sameFile = at.filter((x) => x.file === f.abs)
      if (sameFile.length === 0) row.foreignOnly++
      else if (LINE_IS_TARGET_LINE.has(label) && line !== null && sameFile.some((x) => x.line === line)) row.intended++
      else row.sameFileOffLine++
    }
    if (label === "exports") {
      // EVERY emitted exports edge, by identity: the ruling is about whether these name something a
      // consumer could import, and a count cannot answer that — the site and its target must be read.
      exportsEdges.push(`${relOf(f.repo, f.abs)}:${line ?? "?"}  ${String(rel?.source ?? "")} -> ${JSON.stringify(tgt)}`)
    }
    if (label === "imports") {
      // THE ANALYZER'S OWN CLAIM DECISION, read off the edge — not re-derived here, because the
      // claim arithmetic now includes Cargo's `[path-bases]` fallback and a probe that re-implemented
      // it would be a second rule. This is the count the gate's `extOK` column is about.
      importsTotal++
      if (typeof rel?.metadata?.importProjectFile === "string" && rel.metadata.importProjectFile.length > 0) importsWithClaim++
      else importsWithoutClaim++
    }
    if (c.outcome === "unresolved") {
      unresolvedEdges.push({ type: label, file: f.abs, line, target: tgt, claim: claim === null ? "none" : String(claim.kind) })
    }
    if (label === "references") {
      const dpos = (p.get(tgt) ?? []).filter((x) => x.file === f.abs)
      referenceLines.push({ target: tgt, edgeLine: line, declLine: dpos.length > 0 ? dpos[0].line : null, sameFile: dpos.length > 0 })
    }
    if (label === "imports" && c.outcome === "unresolved") claimArms.push({ file: f.abs, line, target: tgt })
  }
}

// ── PHASE 3 — reproduce the gate's table, or say where this probe disagrees ──────────────────────
const w = (s: unknown, n: number): string => String(s).padEnd(n)
const wn = (s: unknown, n: number): string => String(s).padStart(n)
const out: string[] = []
out.push("RESIDUAL WHOLE POPULATION — toml · PRODUCTION path (parseFile) · shared rule (classifyEdge)")
out.push(`population: ${parsedFiles.length} parsed of ${pop.files.length} admitted · ${parsedRepos} repos with symbols · parse failures ${failed} · empty results ${emptyResults} · absent ${pop.absent} · over cap ${pop.overCap}`)
out.push("")
out.push(`${w("type", 14)}${wn("edges", 8)}${wn("resolved", 10)}${wn("ofWhich", 9)}${wn("amb", 8)}${wn("unres", 8)}${wn("extOK", 8)}${wn("ext?", 7)}${wn("extFAIL", 9)}${wn("bindFAIL", 10)}${wn("causeFAIL", 11)}`)
const ZERO_ROW = { edges: 0, resolved: 0, ambColl: 0, amb: 0, unres: 0, extOK: 0, extQ: 0, extFAIL: 0, bindOK: 0, bindQ: 0, bindFAIL: 0, causeOK: 0, causeFAIL: 0, intended: 0, sameFileOffLine: 0, foreignOnly: 0, nothingAnywhere: 0 }
for (const t of TYPES) {
  // EVERY ontology type is printed, zeros included: a type with no row is indistinguishable from a
  // type nobody looked at, and `exports` is exactly the row this lane must be able to show as 0.
  const r = rows.get(t) ?? ZERO_ROW
  out.push(`${w(t, 14)}${wn(r.edges, 8)}${wn(r.resolved, 10)}${wn(r.ambColl, 9)}${wn(r.amb, 8)}${wn(r.unres, 8)}${wn(r.extOK, 8)}${wn(r.extQ, 7)}${wn(r.extFAIL, 9)}${wn(r.bindFAIL, 10)}${wn(r.causeFAIL, 11)}`)
}
out.push("")
out.push("REPRODUCTION — this probe against the live `residual-gate.ts --lane toml` table:")
let mismatches = 0
for (const [t, e] of Object.entries(EXPECTED)) {
  const r = rows.get(t)
  // A TYPE WITH NO EDGES IS A ZERO, NOT AN UNKNOWN: the expected rows now include `exports`, whose
  // correct value is 0, and a `-1` sentinel would print a disagreement against a measurement the gate
  // simply does not print a row for. The distinction matters — the lane must be able to STATE that
  // exports reads 0 rather than leave it unmentioned.
  const got = r ?? { edges: 0, resolved: 0, ambColl: 0, amb: 0, unres: 0, extOK: 0, extQ: 0, extFAIL: 0, intended: 0, foreignOnly: 0, nothingAnywhere: 0, sameFileOffLine: 0 }
  const fields: [string, number, number][] = [
    ["edges", e.edges, got.edges], ["resolved", e.resolved, got.resolved], ["ofWhich", e.ofWhich, got.ambColl],
    ["amb", e.amb, got.amb], ["unres", e.unres, got.unres], ["extOK", e.extOK, got.extOK], ["extFAIL", e.extFAIL, got.extFAIL],
    ["intended", e.intended, got.intended], ["twin(foreignOnly)", e.twin, got.foreignOnly], ["noDecl(nothingAnywhere)", e.noDecl, got.nothingAnywhere],
  ]
  const bad = fields.filter(([, x, y]) => x !== y)
  if (bad.length === 0) out.push(`  ${w(t, 12)} MATCH on all ${fields.length} compared columns`)
  else {
    mismatches++
    out.push(`  ${w(t, 12)} ** DISAGREEMENT ** ` + bad.map(([n, x, y]) => `${n} gate=${x} probe=${y}`).join(" · "))
  }
}
if (unmapped.size > 0) out.push(`  UNMAPPED relationship labels (not in the ontology's ten): ${[...unmapped].map(([k, v]) => `${k}×${v}`).join(" ")}`)
if (emptyTarget.size > 0) out.push(`  EDGES WITH AN EMPTY TARGET: ${[...emptyTarget].map(([k, v]) => `${k}×${v}`).join(" ")}`)
out.push("")
out.push("INTENT SPLIT — where each edge's target is declared (`incoming-gate.ts:classifyIntent`, re-derived):")
out.push(`${w("type", 14)}${wn("edges", 8)}${wn("intended", 10)}${wn("sameFileOffLine", 17)}${wn("foreignOnly", 13)}${wn("nothingAnywhere", 16)}`)
for (const t of TYPES) {
  const r = rows.get(t)
  if (!r || r.edges === 0) continue
  out.push(`${w(t, 14)}${wn(r.edges, 8)}${wn(r.intended, 10)}${wn(r.sameFileOffLine, 17)}${wn(r.foreignOnly, 13)}${wn(r.nothingAnywhere, 16)}`)
}
out.push("  (\"intended\" is only defined for contains/exports — the types whose edge line IS the target's")
out.push("   start line. For references the edge line is the READ SITE, so its sameFileOffLine count is")
out.push("   not a defect count; the target's own declaration position is printed below.)")
out.push("")
out.push(`REFERENCES — the 167 alias edges, edge line against the target declaration's line (same file):`)
const refOff = referenceLines.filter((r) => r.sameFile && r.edgeLine !== null && r.declLine !== null && r.edgeLine === r.declLine)
const refOffBy = referenceLines.filter((r) => !refOff.includes(r))
out.push(`  edges ${referenceLines.length} · target declared in the edge's own file ${referenceLines.filter((r) => r.sameFile).length} · foreign ${referenceLines.filter((r) => !r.sameFile).length}`)
out.push(`  edge line == declaration line: ${refOff.length} · off-line: ${refOffBy.length} (expected for a READ-SITE type: the alias is written on the referencing key's line, the declaration is on the version key's line)`)
const deltas = refOffBy.filter((r) => r.declLine !== null && r.edgeLine !== null).map((r) => Math.abs((r.edgeLine as number) - (r.declLine as number)))
if (deltas.length > 0) out.push(`  off-line distance (lines): min ${Math.min(...deltas)} · max ${Math.max(...deltas)} · mean ${(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(1)}`)
out.push("")
out.push(`UNRESOLVED — every edge, with its location (${unresolvedEdges.length} total):`)
for (const [i, e] of unresolvedEdges.entries()) {
  out.push(`  [${i + 1}] ${e.type.padEnd(10)} ${relOf(repoOf(e.file), e.file)}:${e.line ?? "?"}  target=${JSON.stringify(e.target)}  claim=${e.claim}`)
}

// ── PHASE 4 — the falsifier for the named cause, and both candidate fix arms ─────────────────────
const MANIFESTS = ["Cargo.toml", "Project.toml", "JuliaProject.toml", "pyproject.toml", "Package.toml"]
out.push("")
out.push("TOML-G2 FALSIFIER — for each unresolved `imports` edge: does the target name a manifest the project")
out.push("carries? (a single YES refutes the ruling and makes the row a defect)")
out.push(`  THE ANALYZER'S OWN DECISION, before the gate: ${importsTotal} imports edges — ${importsWithClaim} carry `)
out.push(`  \`metadata.importProjectFile\` (a claim the project can check) and ${importsWithoutClaim} carry none.`)
let onDisk = 0
let admittedHit = 0
let guardClaim = 0
const falsifierRows: any[] = []
for (const e of unresolvedEdges.filter((x) => x.type === "imports")) {
  const repo = repoOf(e.file)
  const rel = relOf(repo, e.file)
  const written = e.target
  const posix = projectRelativeOf(dirOf(rel), written.trim())
  const cands: string[] = []
  if (posix !== null) {
    for (const m of MANIFESTS) cands.push(posix.length === 0 ? m : `${posix}/${m}`)
    if (posix.length > 0) cands.push(posix)
  }
  const onDiskCands = cands.filter((c) => { try { return statSync(path.join(repo, c)).isFile() } catch { return false } })
  const admittedCands = cands.filter((c) => (admittedByRepo.get(repo) ?? new Set()).has(c))
  const claim = fileClaimForTarget({ projectRoot: repo, filePath: e.file, written, admittedExtensions: ["toml"], extraCandidates: cands })
  if (onDiskCands.length > 0) onDisk++
  if (admittedCands.length > 0) admittedHit++
  if (claim !== null) guardClaim++
  falsifierRows.push({ file: rel, line: e.line, target: written, candidates: cands, onDisk: onDiskCands, admitted: admittedCands, guardClaim: claim })
  out.push(`  ${rel}:${e.line ?? "?"} target=${JSON.stringify(written)}`)
  out.push(`      folded=${JSON.stringify(posix)} candidates=[${cands.map((c) => JSON.stringify(c)).join(", ")}]`)
  out.push(`      on disk: ${onDiskCands.length === 0 ? "NONE" : onDiskCands.join(", ")} · in the admitted list: ${admittedCands.length === 0 ? "NONE" : admittedCands.join(", ")} · guard would claim: ${claim === null ? "null" : JSON.stringify(claim)}`)
}
const unresImports = unresolvedEdges.filter((x) => x.type === "imports").length
out.push(`  RESULT: ${onDisk} of ${unresImports} name a manifest ON DISK · ${admittedHit} of ${unresImports} name one in the ADMITTED list · ${guardClaim} of ${unresImports} would receive a file claim.`)
out.push(`  ${onDisk === 0 && admittedHit === 0 && guardClaim === 0 ? "FILE-CLAIM ARM DID NOT FIRE — the ruling holds on this population." : "** FILE-CLAIM ARM FIRED — the ruling is REFUTED for the rows above. **"}`)
out.push("")
// THE NAIVE READING, RUN AT ITS STRONGEST. A path that does not exist beside its declaring file might
// still name a directory ONE LEVEL UP — the "the path is relative to the workspace root" reading. It is
// measured rather than dismissed, because a falsifier that is not run is not a falsifier.
out.push(`ONE-LEVEL-UP ARM — the same ${unresImports} folded against the PARENT of the declaring file's directory`)
out.push(`(the "the path is relative to the workspace root" reading), tested on disk and against the admitted list:`)
let upOnDisk = 0
let upAdmitted = 0
const upRows: string[] = []
for (const e of unresolvedEdges.filter((x) => x.type === "imports")) {
  const repo = repoOf(e.file)
  const rel = relOf(repo, e.file)
  const dirRel = dirOf(rel) // "a/b/" — the base the analyzer folds against
  const trimmed = dirRel.endsWith("/") ? dirRel.slice(0, -1) : dirRel
  const upBase = trimmed.includes("/") ? trimmed.slice(0, trimmed.lastIndexOf("/") + 1) : dirRel
  const up = projectRelativeOf(upBase, e.target.trim())
  if (up === null) continue
  const upCands = MANIFESTS.map((m) => (up.length === 0 ? m : `${up}/${m}`))
  const hit = upCands.find((c) => { try { return statSync(path.join(repo, c)).isFile() } catch { return false } }) ?? null
  const adm = upCands.find((c) => (admittedByRepo.get(repo) ?? new Set()).has(c)) ?? null
  if (hit !== null) { upOnDisk++; upRows.push(`${rel}:${e.line ?? "?"} target=${JSON.stringify(e.target)} -> ${hit} (ON DISK)`) }
  if (adm !== null) { upAdmitted++; upRows.push(`${rel}:${e.line ?? "?"} target=${JSON.stringify(e.target)} -> ${adm} (ADMITTED)`) }
}
out.push(`  RESULT: ${upOnDisk} of ${unresImports} name a manifest one level up ON DISK · ${upAdmitted} of ${unresImports} name one in the ADMITTED list.`)
for (const r of upRows) out.push(`    ${r}`)
out.push(`  WHEN THIS ARM FIRES, THE EDGE IS STILL NOT CLAIMABLE, and the reason is the LANGUAGE'S OWN`)
out.push(`  resolution rule, not a preference: Pkg.jl src/Operations.jl:3295-3301 — "Paths in project`)
out.push(`  sources are project-relative, so join with project_file dir, not manifest_file dir" — joins a`)
out.push(`  [sources] path with dirname(the declaring Project.toml). Cargo does the same for a member's`)
out.push(`  path dependency. A claim folded one level up would name a DIFFERENT unit than the document`)
out.push(`  means and would VERIFY, because the sibling directory really is in the project — a wrong edge`)
out.push(`  the arbiter cannot see (HANDOFF §5h).`)
out.push("")
// ── PHASE 4b — THE PER-EDGE BATTERY (--battery) ──────────────────────────────────────────────────
//
// "Close it or prove it cannot be closed" needs one row per unresolved edge showing EVERY spelling
// that would name a file, which arm finds what, and — for the arms that DO find a file — the reason
// the arm is not a rule. This is the measurement behind the disposition table; a verdict inferred
// without it is the "falsifier you have to infer" the task forbids.
const BATTERY = process.argv.includes("--battery")
const batteryRows: any[] = []
if (BATTERY) {
  /** The analyzer's one-layer quote strip, kept tiny: a refusal returns null. */
  const unquote = (t: string): string | null => {
    if (t.length < 2) return null
    const q = t.charCodeAt(0)
    if ((q !== 34 && q !== 39) || t.charCodeAt(t.length - 1) !== q) return null
    const inner = t.slice(1, -1)
    return inner.includes("\\") ? null : inner
  }
  /** Every `[path-bases] name = "value"` entry in a config's text; {} when the text is not understood. */
  const pathBaseEntries = (text: string): Map<string, string> => {
    const outM = new Map<string, string>()
    let inSection = false
    for (const raw of text.split("\n")) {
      const line = raw.trim()
      if (line.length === 0 || line.startsWith("#")) continue
      if (line.startsWith("[")) { const c = line.indexOf("]"); if (c < 0) return new Map(); inSection = line.slice(1, c).trim() === "path-bases"; continue }
      if (!inSection) continue
      const eq = line.indexOf("=")
      if (eq < 0) return new Map()
      const k = line.slice(0, eq).trim()
      const key = (k.length >= 2 && (k.charCodeAt(0) === 34 || k.charCodeAt(0) === 39)) ? unquote(k) : k
      const v = unquote(line.slice(eq + 1).trim())
      if (key !== null && v !== null) outM.set(key, v)
    }
    return outM
  }
  const declaresWorkspace = (text: string): boolean => text.split("\n").some((l) => l.trim() === "[workspace]")
  /** The quoted names in an ancestor manifest's `[workspace] projects = [...]` list. */
  const workspaceMembers = (text: string): Set<string> => {
    const names = new Set<string>()
    let inWs = false
    let inList = false
    for (const raw of text.split("\n")) {
      const line = raw.trim()
      if (line.startsWith("[")) { inWs = line === "[workspace]"; inList = false; continue }
      if (!inWs) continue
      if (!inList && line.startsWith("projects")) inList = true
      if (!inList) continue
      for (const part of line.replace(/^projects\s*=\s*/, "").split(",")) {
        const v = unquote(part.trim())
        if (v !== null) names.add(v)
      }
      if (line.includes("]")) inList = false
    }
    return names
  }
  const readText = (p: string): string | null => { try { return readFileSync(p, "utf8") } catch { return null } }
  const dirsByRepo = new Map<string, Set<string>>()
  for (const [repo, files] of admittedByRepo) {
    const dirs = new Set<string>()
    for (const rel of files) {
      let d = dirOf(rel)
      while (d.length > 0) {
        const trimmed = d.endsWith("/") ? d.slice(0, -1) : d
        if (trimmed.length > 0) dirs.add(trimmed)
        const i = trimmed.lastIndexOf("/")
        if (i < 0) break
        d = trimmed.slice(0, i + 1)
      }
    }
    dirsByRepo.set(repo, dirs)
  }
  out.push("")
  out.push("PER-EDGE BATTERY — every arm that could name a FILE for each unresolved edge, RUN one by one.")
  out.push("  A1 file-relative fold · A2 project-root fold · A3 any ancestor `.cargo/config.toml` [path-bases]")
  out.push("  A4 nearest ancestor holding a manifest that declares [workspace] · A5 one-level-up fold")
  out.push("  A6 any directory in the project with the target's own basename")
  out.push("  A7 the `in/` twin of an `out/` fragment (cargo's test harness) · A8 declared workspace member")
  for (const e of unresolvedEdges.filter((x) => x.type === "imports")) {
    const repo = repoOf(e.file)
    const rel = relOf(repo, e.file)
    const dirRel = dirOf(rel)
    const written = e.target
    const hit = (cand: string | null): string | null => {
      if (cand === null || cand.length === 0) return null
      for (const m of MANIFESTS) { const c = `${cand}/${m}`; try { if (statSync(path.join(repo, c)).isFile()) return c } catch { /* miss */ } }
      try { return statSync(path.join(repo, cand)).isFile() ? cand : null } catch { return null }
    }
    let a3: string | null = null
    {
      let dir = path.dirname(e.file)
      for (let d = 0; d < 64; d++) {
        const text = readText(path.join(dir, ".cargo", "config.toml"))
        if (text !== null) {
          for (const [, base] of pathBaseEntries(text)) {
            const abs = path.resolve(path.resolve(dir, base), written.trim())
            const r = path.relative(repo, abs).split(path.sep).join("/")
            if (r.length > 0 && !r.startsWith("..")) { a3 = hit(r); if (a3 !== null) break }
          }
        }
        if (a3 !== null) break
        const parent = path.dirname(dir)
        if (dir === repo || parent === dir) break
        dir = parent
      }
    }
    let a4: string | null = null
    let a8 = false
    {
      let dir = path.dirname(e.file)
      for (let d = 0; d < 64; d++) {
        for (const m of ["Cargo.toml", "Project.toml", "pyproject.toml", "Package.toml"]) {
          const text = readText(path.join(dir, m))
          if (text === null || !declaresWorkspace(text)) continue
          if (workspaceMembers(text).has(written.trim())) a8 = true
          const baseRel = path.relative(repo, dir).split(path.sep).join("/")
          a4 = hit(baseRel.length === 0 ? written.trim() : `${baseRel}/${written.trim()}`)
        }
        if (a4 !== null || a8) break
        const parent = path.dirname(dir)
        if (dir === repo || parent === dir) break
        dir = parent
      }
    }
    const trimmedDir = dirRel.endsWith("/") ? dirRel.slice(0, -1) : dirRel
    const upBase = trimmedDir.includes("/") ? trimmedDir.slice(0, trimmedDir.lastIndexOf("/") + 1) : dirRel
    const a5 = hit(projectRelativeOf(upBase, written.trim()))
    const leaf = written.trim().replace(/\/+$/, "").split("/").filter((s) => s.length > 0 && s !== "." && s !== "..").pop() ?? ""
    const a6Dirs = [...(dirsByRepo.get(repo) ?? new Set<string>())].filter((d) => d.split("/").pop() === leaf)
    const a6 = a6Dirs.length > 0 ? `${a6Dirs.length} dir(s) named ${JSON.stringify(leaf)}: ${a6Dirs.slice(0, 3).join(", ")}` : null
    let a7: string | null = null
    {
      const segs = rel.split("/")
      const oi = segs.indexOf("out")
      if (oi >= 0) a7 = hit(projectRelativeOf(dirOf([...segs.slice(0, oi), "in", ...segs.slice(oi + 1)].join("/")), written.trim()))
    }
    const a1 = hit(projectRelativeOf(dirRel, written.trim()))
    const a2 = hit(projectRelativeOf("", written.trim()))
    const found = [a1 && `A1->${a1}`, a2 && `A2->${a2}`, a3 && `A3->${a3}`, a4 && `A4->${a4}`, a5 && `A5->${a5}`, a6 && `A6->${a6}`, a7 && `A7->${a7}`, a8 && "A8->declared workspace member"].filter(Boolean)
    out.push(`  ${rel}:${e.line ?? "?"} target=${JSON.stringify(written)}`)
    out.push(`      ARMS THAT NAME A FILE: ${found.length === 0 ? "NONE" : found.join("  ·  ")}`)
    batteryRows.push({ file: rel, line: e.line, target: written, a1, a2, a3, a4, a5, a6, a7, a8 })
  }
  out.push(`  REFUSALS — why each arm that FIRED is not a rule:`)
  out.push(`    A1/A2  the analyzer's own standard spellings; they found nothing on any of these edges.`)
  out.push(`    A3     IMPLEMENTED (the Cargo [path-bases] fallback). It fires only where an ancestor config`)
  out.push(`           DEFINES the base — never for an out/ fragment whose config is absent from the tree.`)
  out.push(`    A4     Cargo resolves a \`path\` against the manifest that declares it and requires \`base\` to be`)
  out.push(`           DEFINED; the workspace root is a base only when written \`base = "workspace"\`. A4 is right`)
  out.push(`           here by accident of the snapshot layout (cargo's out/ mirrors in/) and wrong in general.`)
  out.push(`    A5     the same rule; additionally refuted by Pkg.jl src/Operations.jl:3295-3301 for [sources].`)
  out.push(`    A6     a name match anywhere in the project is not a resolution: it would VERIFY while naming a`)
  out.push(`           different unit — HANDOFF §5h's wrong edge the arbiter cannot see.`)
  out.push(`    A7     cargo test-harness layout knowledge (\`assert_ui().subset_matches(out, project_root)\` in each`)
  out.push(`           fixture's mod.rs), not a language rule: a real project has no in/ twin. It explains the`)
  out.push(`           whole cargo class — an out/ manifest is a FRAGMENT of a run tree whose dependencies were`)
  out.push(`           satisfied by files the snapshot does not carry.`)
  out.push(`    A8     the project's own root manifest declares the member, so the DEPENDENCY is real — but the`)
  out.push(`           arbiter has no claim kind for membership (incoming-rule.ts verifies file claims and the`)
  out.push(`           external marker only, and a bare-target external marker is unfalsifiable — §5l).`)
}
out.push(`FIX ARM A — a FILE claim (\`verifyFileClaim\`, the verifier the arbiter calls), over the same ${unresImports} edges:`)
let fileClaimRefuted = 0
let fileClaimVerified = 0
let fileClaimUnverifiable = 0
for (const e of unresolvedEdges.filter((x) => x.type === "imports")) {
  const repo = repoOf(e.file)
  const facts = { packages: new Set<string>(), files: admittedByRepo.get(repo) ?? new Set<string>(), sdkLib: false }
  const rel = relOf(repo, e.file)
  const posix = projectRelativeOf(dirOf(rel), e.target.trim())
  const cands: string[] = []
  if (posix !== null) {
    for (const m of MANIFESTS) cands.push(posix.length === 0 ? m : `${posix}/${m}`)
    if (posix.length > 0) cands.push(posix)
  }
  const v = RULE.verifyFileClaim(facts, cands)
  if (v === "externalRefuted") fileClaimRefuted++
  else fileClaimVerified++
}
out.push(`  verdicts over the ${unresImports} edges: verified ${fileClaimVerified} · REFUTED ${fileClaimRefuted} · unverifiable ${fileClaimUnverifiable}`)
out.push(`  CONSEQUENCE IF EMITTED: extFAIL ${fileClaimRefuted} (a file claim on a miss REFUTES — the arbiter's own control pins it).`)
out.push("")
out.push(`FIX ARM B — an EXTERNAL marker on a BARE target (\`verifyExternalClaim\`), over the same ${unresImports} edges:`)
let extVerified = 0
let extRefused = 0
const extExamples: string[] = []
for (const e of unresolvedEdges.filter((x) => x.type === "imports")) {
  const d = decl.get(repoOf(e.file)) ?? new Map<string, number>()
  const v = RULE.verifyExternalClaim(d, e.target)
  if (v === "externalVerified") { extVerified++; if (extExamples.length < 3) extExamples.push(`${e.target} → ${v}`) }
  else { extRefused++; if (extExamples.length < 6) extExamples.push(`${e.target} → ${v}`) }
}
out.push(`  verdicts over the ${unresImports} edges: externalVerified ${extVerified} · refused/unverifiable ${extRefused}`)
out.push(`  examples: ${extExamples.join(" · ")}`)
out.push(`  CONSEQUENCE IF EMITTED: the gate would read extOK ${importsWithClaim}+${extVerified} = ${importsWithClaim + extVerified}, unresolved ${unresImports}-${extVerified} = ${unresImports - extVerified}, residual 0 —`)
out.push(`  and the verification would be VACUOUS: the claim was checked on targets the same rule had already`)
out.push(`  found name nothing (decls === 0), which is the exact condition the external branch excludes, so it`)
out.push(`  cannot refute. This is HANDOFF §5l's laundering vector, RUN rather than quoted.`)
// ── PHASE 5 — the `exports` gap the language board names (--exports) ─────────────────────────────
//
// The census (`tools/construct-census.ts`, commit 840bffea9) measures publish-surface key sites with a
// controlled vocabulary matcher; it reports `referentSites` as "the value names a declaration the SAME
// DOCUMENT makes" (`docDeclared` = every pair's lowercase leaf). This phase reproduces that predicate
// so the census's 174/118/0 is checked rather than quoted, and adds the two facts the census does not
// carry: whether the value names a declaration ANYWHERE IN THE PROJECT (which is what the store would
// have to bind), and whether it is path-shaped at all (the only shape a file claim could verify).
const EXPORTS_MODE = process.argv.includes("--exports")
const exportsStats: Record<string, unknown> = { measured: false }
if (EXPORTS_MODE) {
  const { getParser } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const parser = await getParser("toml")
  // The census's own helpers, transcribed for comparability (`construct-census.ts:200-224`).
  const kidsOf = (n: any): any[] => { const o: any[] = []; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) o.push(c) } return o }
  const walkTree = (n: any, fn: (x: any) => void): void => { const st = [n]; while (st.length) { const x = st.pop(); fn(x); const cs = kidsOf(x); for (let i = cs.length - 1; i >= 0; i--) st.push(cs[i]) } }
  const leafOf = (keyNode: any): string => {
    if (!keyNode) return ""
    if (keyNode.type === "dotted_key") { const cs = kidsOf(keyNode); return cs.length > 0 ? leafOf(cs[cs.length - 1]) : "" }
    let t = String(keyNode.text ?? "").trim()
    if (t.length >= 2) { const q = t.charCodeAt(0); if ((q === 34 || q === 39) && t.charCodeAt(t.length - 1) === q) t = t.slice(1, -1) }
    return t.toLowerCase()
  }
  const valueNodeOf = (pair: any): any => { const cs = kidsOf(pair); return cs.length > 1 ? cs[cs.length - 1] : null }
  const stringValueOf = (pair: any): string | null => {
    const v = valueNodeOf(pair)
    if (!v || v.type !== "string") return null
    let t = String(v.text ?? "").trim()
    if (t.length >= 2) { const q = t.charCodeAt(0); if ((q === 34 || q === 39) && t.charCodeAt(t.length - 1) === q) t = t.slice(1, -1) }
    return t
  }
  const EXPORT_KEYS = new Set(["export", "exports", "expose", "exposed", "pub", "public", "publish", "main", "module", "mod", "entrypoint"])
  let sites = 0
  let stringSites = 0
  let docReferents = 0
  let projectReferents = 0
  let pathShaped = 0
  let tomlShaped = 0
  let coordinateShaped = 0
  const projectRefExamples: string[] = []
  for (const f of parsedFiles) {
    let root: any
    try {
      const tree: any = await parser.parse(readFileSync(f.abs, "utf8"), f.abs)
      root = tree.rootNode
    } catch { continue }
    const docLeaves = new Set<string>()
    const pairs: any[] = []
    walkTree(root, (x: any) => {
      if (x.type !== "pair") return
      const k = kidsOf(x)[0]
      if (!k) return
      const leaf = leafOf(k)
      if (leaf.length === 0) return
      docLeaves.add(leaf)
      pairs.push(x)
    })
    const d = decl.get(f.repo) ?? new Map<string, number>()
    for (const pair of pairs) {
      const k = kidsOf(pair)[0]
      const leaf = leafOf(k)
      if (!EXPORT_KEYS.has(leaf)) continue
      sites++
      const v = stringValueOf(pair)
      if (v === null) continue
      stringSites++
      const low = v.toLowerCase()
      if (docLeaves.has(low)) docReferents++
      if (d.has(v) || d.has(low)) {
        projectReferents++
        if (projectRefExamples.length < 10) projectRefExamples.push(`${f.rel}  ${leaf} = ${JSON.stringify(v)}  (project declares ${d.has(v) ? JSON.stringify(v) : JSON.stringify(low)})`)
      }
      // THREE SHAPES, counted apart because only one of them could ever carry a claim. This probe's
      // first version called any value containing a dot "path-shaped" and reported Gradle coordinates
      // (`org.jetbrains.exposed:exposed-core`) and version strings as paths — a predicate that
      // measures its own sloppiness. The question that matters is narrower: a file claim can only
      // verify a value naming a file of the lane's ADMITTED population, and that population is .toml.
      if (low.includes("/")) pathShaped++
      if (low.endsWith(".toml")) tomlShaped++
      if (low.includes(":") && !low.includes("/")) coordinateShaped++
    }
  }
  out.push("")
  out.push("EXPORTS — the board's named unimplemented type, measured over the same population:")
  out.push(`  publish-surface key sites (census predicate, ${[...EXPORT_KEYS].length} leaf names): ${sites}`)
  out.push(`  of those with a STRING value: ${stringSites}`)
  out.push(`  value names a declaration in the SAME DOCUMENT (census's referentSites): ${docReferents}   [census artifact: referentSites 0 of 174 sites / 118 string]`)
  out.push(`  value names a declaration ANYWHERE IN THE PROJECT (what the store could bind): ${projectReferents}`)
  for (const e of projectRefExamples) out.push(`      e.g. ${e}`)
  out.push(`  value contains a path separator (/): ${pathShaped}   ends in .toml (the only shape a file claim can verify): ${tomlShaped}   a colon coordinate, not a path: ${coordinateShaped}`)
  out.push(`  => an \`exports\` edge here could only target a NAME that is not a declaration of the project, and the`)
  out.push(`     lane's admitted population is .toml alone, so no file claim can verify one either.`)
  exportsStats.measured = true
  exportsStats.sites = sites
  exportsStats.stringSites = stringSites
  exportsStats.documentReferents = docReferents
  exportsStats.projectReferents = projectReferents
  exportsStats.pathShaped = pathShaped
  exportsStats.tomlShaped = tomlShaped
  exportsStats.coordinateShaped = coordinateShaped
  exportsStats.projectReferentExamples = projectRefExamples
}

// ── PHASE 6 — TOML-G1, the workspace-inheritance sites (--workspace) ─────────────────────────────
//
// `x.workspace = true` says this key's value is declared by the workspace manifest. The lane records
// 1,269 such sites in 138 documents as UNIMPLEMENTED (TOML-G1). Before fixing anything, this phase
// measures the population the claim is about, split by KIND, and — for each kind — whether the edge
// the analyzer COULD emit would land on a declaration that exists, which is the only test that
// decides between "fixable" and "a boundary".
const WORKSPACE = process.argv.includes("--workspace")
const wsStats: Record<string, unknown> = { measured: false }
if (WORKSPACE) {
  const { getParser: getTomlParser } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const { applyDocumentScope: scopeOf, documentDirScope: dirScopeOf } = await import(path.join(ROOT, "src/ast/project-scoped-identity.ts"))
  const parser = await getTomlParser("toml")
  const kidsOf = (n: any): any[] => { const o: any[] = []; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) o.push(c) } return o }
  const leafOfKey = (k: any): string => {
    if (!k) return ""
    if (k.type === "dotted_key") { const cs = kidsOf(k); return cs.length > 0 ? leafOfKey(cs[cs.length - 1]) : "" }
    let t = String(k.text ?? "").trim()
    if (t.length >= 2) { const q = t.charCodeAt(0); if ((q === 34 || q === 39) && t.charCodeAt(t.length - 1) === q) t = t.slice(1, -1) }
    return t
  }
  const boolTrue = (pair: any): boolean => {
    const cs = kidsOf(pair)
    const v = cs.length > 1 ? cs[cs.length - 1] : null
    return v !== null && v.type === "boolean" && String(v.text).trim() === "true"
  }
  const readTxt = (p: string): string | null => { try { return readFileSync(p, "utf8") } catch { return null } }
  /** Does this manifest text declare `[workspace]`? */
  const hasWs = (t: string): boolean => t.split("\n").some((l) => l.trim() === "[workspace]")
  /**
   * The DECLARED KEY PATHS of a workspace root, as full dotted paths. Pure String.
   *
   * The first version recorded `[table] -> bare keys`, and that read `hasura-engine/v3/Cargo.toml`
   * — which declares the workspace package fields as DOTTED KEYS under `[workspace]`
   * (`package.version = "3.0.0"`, `package.edition`, `package.license`) — as NOT declaring them,
   * while the target name it computed existed in the key space. That disagreement is what exposed the
   * hole: the analyzer publishes `workspace.package.version` for those lines, so the target was right
   * and the READER was wrong. A declared path is now `header + "." + keyText`, with TOML's minimum
   * quote handling, so both spellings land on the same path.
   */
  const rootDeclaredPaths = (t: string): Set<string> => {
    const paths = new Set<string>()
    let cur = ""
    for (const raw of t.split("\n")) {
      const line = raw.trim()
      if (line.length === 0 || line.startsWith("#")) continue
      if (line.startsWith("[")) { const c = line.indexOf("]"); cur = c < 0 ? "" : line.slice(1, c).trim().replace(/^["']|["']$/g, ""); continue }
      const eq = line.indexOf("=")
      if (eq < 0) continue
      const k = line.slice(0, eq).trim().replace(/^["']|["']$/g, "")
      if (k.length === 0) continue
      paths.add(cur.length > 0 ? `${cur}.${k}` : k)
    }
    return paths
  }
  const DEP_SECTIONS = new Set(["dependencies", "dev-dependencies", "build-dependencies"])
  // `[target.'cfg(unix)'.dependencies]` and `[target.'cfg(windows)'.dependencies.windows-sys]` are the
  // TARGET-SCOPED spellings of the same table, and the first version missed both: the second because
  // the header ENDS with the dependency's name, not with `.dependencies`. Measured, they carry 4 sites.
  const isDepSection = (h: string): boolean => {
    if (DEP_SECTIONS.has(h) || h.startsWith("workspace.dependencies")) return true
    const segs = h.split(".")
    for (const s of segs) if (DEP_SECTIONS.has(s)) return true
    return false
  }
  /** The dependency NAME a site inherits: the last segment after the dependency section, or the last
   *  segment of the site key. `[target.'cfg(windows)'.dependencies.windows-sys]` -> `windows-sys`. */
  const depNameOf = (h: string, siteKey: string): string => {
    const segs = h.split(".")
    for (let i = segs.length - 1; i >= 0; i--) {
      if (DEP_SECTIONS.has(segs[i])) {
        if (i + 1 < segs.length) return segs[segs.length - 1].replace(/^["']|["']$/g, "")
        break
      }
    }
    return siteKey.replace(/\.workspace$/, "")
  }
  const byKind = new Map<string, { sites: number; files: Set<string>; rootFound: number; rootDeclares: number; targetExists: number; examples: string[] }>()
  const bumpKind = (kind: string, file: string, rootFound: boolean, rootDeclares: boolean, targetExists: boolean, example: string, mismatch: string | null) => {
    let r = byKind.get(kind)
    if (!r) byKind.set(kind, (r = { sites: 0, files: new Set(), rootFound: 0, rootDeclares: 0, targetExists: 0, examples: [], mismatches: [] as string[] }))
    r.sites++; r.files.add(file)
    if (rootFound) r.rootFound++
    if (rootDeclares) r.rootDeclares++
    if (targetExists) r.targetExists++
    if (r.examples.length < 3) r.examples.push(example)
    // `targetExists && !rootDeclares` CANNOT both be true if this reader and the analyzer agree: the
    // target names the root's own key, so it exists only if the root declares it. Any such row is
    // printed, because that is either a hole in this text reader or a symbol the target would bind to
    // by mistake — and a fix must not be built on either.
    if (targetExists && !rootDeclares && mismatch !== null && r.mismatches.length < 3) r.mismatches.push(mismatch)
  }
  let totalSites = 0
  const docsWithSites = new Set<string>()
  for (const f of parsedFiles) {
    let root: any
    try { root = (await parser.parse(readFileSync(f.abs, "utf8"), f.abs)).rootNode } catch { continue }
    const repo = f.repo
    const keySpace = decl.get(repo) ?? new Map<string, number>()
    // A NODE LIST, not a node: the first version of this walk passed `[inner]` into a helper that called
    // `kidsOf` on it, so `namedChildCount` was undefined, the loop body never ran, and the whole phase
    // reported 0 sites in 0 documents against a spec that records 1,269 in 138. The probe was wrong.
    const visitPairs = (nodes: any[], header: string, enclosingKey: string | null) => {
      for (const child of nodes) {
        if (child.type === "table" || child.type === "table_array_element") {
          const hk = kidsOf(child)[0]
          const hdr = hk ? String(hk.text ?? "").trim().replace(/^["']|["']$/g, "") : ""
          visitPairs(kidsOf(child), hdr, null)
          continue
        }
        if (child.type !== "pair") continue
        const k = kidsOf(child)[0]
        if (!k) continue
        const leaf = leafOfKey(k)
        if (leaf === "workspace" && boolTrue(child)) {
          // A SITE. `enclosingKey` is set when the pair is `dep = { workspace = true }`.
          const siteKey = enclosingKey !== null ? enclosingKey : String(k.text ?? "").trim()
          const kind = enclosingKey !== null
            ? (isDepSection(header) ? "dependency-inline" : "other-inline")
            : (header === "package" ? "package-field" : header === "lints" || header.startsWith("lints.") ? "lints" : isDepSection(header) ? (header.endsWith(".dependencies") || header.endsWith(".dev-dependencies") || header.endsWith(".build-dependencies") ? "dependency-table" : "dependency-dotted") : header.startsWith("profile") ? "profile" : "other")
          totalSites++
          docsWithSites.add(f.rel)
          // THE WORKSPACE ROOT, and whether it declares what this site inherits.
          let rootFound = false
          let rootDeclares = false
          let targetExists = false
          {
            let dir = path.dirname(path.resolve(f.abs))
            const projRoot = path.resolve(repo)
            for (let d = 0; d < 64; d++) {
              for (const m of ["Cargo.toml", "Project.toml"]) {
                const text = readTxt(path.join(dir, m))
                if (text === null || !hasWs(text)) continue
                rootFound = true
                const rootAbs = path.join(dir, m)
                const rootModule = scopeOf(path.basename(rootAbs, path.extname(rootAbs)) || "document", dirScopeOf(rootAbs, projRoot))
                // which key does this site inherit, and from which [workspace.*] table?
                let table = ""
                let field = ""
                if (kind === "dependency-inline" || kind === "dependency-dotted" || kind === "dependency-table") { table = "workspace.dependencies"; field = kind === "dependency-table" ? depNameOf(header, siteKey) : siteKey.replace(/\.workspace$/, "") }
                else if (kind === "package-field") { table = "workspace.package"; field = siteKey.replace(/\.workspace$/, "") }
                else if (kind === "lints") { table = "workspace.lints"; field = "" }
                if (table.length > 0) {
                  const declared = rootDeclaredPaths(text)
                  rootDeclares = field.length > 0 ? declared.has(`${table}.${field}`) : [...declared].some((d) => d === table || d.startsWith(`${table}.`))
                  const target = field.length > 0 ? `${rootModule}.${table}.${field}` : `${rootModule}.${table}`
                  targetExists = keySpace.has(target)
                }
                break
              }
              if (rootFound) break
              const parent = path.dirname(dir)
              if (dir === projRoot || parent === dir) break
              dir = parent
            }
          }
          bumpKind(kind, f.rel, rootFound, rootDeclares, targetExists, `${f.rel}  ${header ? `[${header}] ` : ""}${siteKey} = true`,
            targetExists && !rootDeclares ? `${f.rel}  field=${JSON.stringify(siteKey.replace(/\.workspace$/, ""))}  target-exists-but-root-not-read-as-declaring-it` : null)
        }
        // descend into an inline table value to catch `dep = { workspace = true }`
        const cs = kidsOf(child)
        const v = cs.length > 1 ? cs[cs.length - 1] : null
        if (v !== null && v.type === "inline_table") visitPairs(kidsOf(v), header, String(k.text ?? "").trim())
      }
    }
    visitPairs(kidsOf(root), "", null)
  }
  out.push("")
  out.push("TOML-G1 — WORKSPACE-INHERITANCE SITES, split by kind, each tested against the manifest that would answer it")
  out.push(`  population: ${parsedFiles.length} parsed files · sites ${totalSites} in ${docsWithSites.size} documents (the spec records 1,269 in 138 at 2026-10-09)`)
  out.push(`  ${"kind".padEnd(18)}${"sites".padStart(7)}${"files".padStart(7)}${"rootFound".padStart(11)}${"rootDeclares".padStart(14)}${"targetExists".padStart(14)}`)
  for (const [kind, r] of [...byKind].sort((a, b) => b[1].sites - a[1].sites)) {
    out.push(`  ${kind.padEnd(18)}${String(r.sites).padStart(7)}${String(r.files.size).padStart(7)}${String(r.rootFound).padStart(11)}${String(r.rootDeclares).padStart(14)}${String(r.targetExists).padStart(14)}`)
    for (const e of r.examples) out.push(`      e.g. ${e}`)
    for (const m of (r as any).mismatches ?? []) out.push(`      MISMATCH: ${m}`)
  }
  {
    // THE ANALYZER'S OWN ACCOUNTING, summed over the population — the cross-check on this instrument's
    // site count and the measured source of the residual. A difference between the two is a finding
    // about one of them, not something to average away.
    let refs = 0, skipLints = 0, skipNoDecl = 0, skipNoRoot = 0
    for (const f of parsedFiles) {
      const dm: any = (f as any).metadata?.documentMetrics ?? {}
      refs += Number(dm.workspaceInheritanceRefs ?? 0)
      skipLints += Number(dm.workspaceInheritanceSkippedLints ?? 0)
      skipNoDecl += Number(dm.workspaceInheritanceSkippedNoDecl ?? 0)
      skipNoRoot += Number(dm.workspaceInheritanceSkippedNoRoot ?? 0)
    }
    out.push(`  ANALYZER'S OWN ACCOUNTING over the same population: refs emitted ${refs} · skipped lints(no single target) ${skipLints} · skipped root-does-not-declare ${skipNoDecl} · skipped no-workspace-root ${skipNoRoot}`)
    out.push(`     (${refs} + ${skipLints} + ${skipNoDecl} + ${skipNoRoot} = ${refs + skipLints + skipNoDecl + skipNoRoot} sites accounted for, against ${totalSites} counted by this instrument)`)
  }
  out.push(`  "rootDeclares" = the nearest ancestor manifest declaring [workspace] also declares the key this site inherits.`)
  out.push(`  "targetExists" = the edge the analyzer COULD emit (\`<rootModule>.workspace.package.<field>\` etc.) names a symbol`)
  out.push(`                   in the project key space — the test that separates FIXABLE from a boundary.`)
  wsStats.measured = true
  wsStats.totalSites = totalSites
  wsStats.documents = docsWithSites.size
  wsStats.byKind = Object.fromEntries([...byKind].map(([k, r]) => [k, { sites: r.sites, files: r.files.size, rootFound: r.rootFound, rootDeclares: r.rootDeclares, targetExists: r.targetExists, examples: r.examples, mismatches: (r as any).mismatches ?? [] }]))
}

out.push("")
out.push(`SUMMARY`)
out.push(`  total edges ${[...rows.values()].reduce((a, r) => a + r.edges, 0)} · resolved ${[...rows.values()].reduce((a, r) => a + r.resolved, 0)} · amb ${[...rows.values()].reduce((a, r) => a + r.amb, 0)} · unresolved ${[...rows.values()].reduce((a, r) => a + r.unres, 0)} · extOK ${[...rows.values()].reduce((a, r) => a + r.extOK, 0)} · ext? ${[...rows.values()].reduce((a, r) => a + r.extQ, 0)} · extFAIL ${[...rows.values()].reduce((a, r) => a + r.extFAIL, 0)} · bindFAIL ${[...rows.values()].reduce((a, r) => a + r.bindFAIL, 0)} · causeFAIL ${[...rows.values()].reduce((a, r) => a + r.causeFAIL, 0)}`)
out.push(`  reproduction: ${mismatches === 0 ? "ALL EXPECTED ROWS MATCH the gate's live table on every compared column." : `${mismatches} row(s) DISAGREE — see above.`}`)
{
  // THE EMISSION SITE'S OWN COUNT of the ruled `exports` defect, summed over the population: the
  // candidates the conventional name list generates, and the ones the DATA test turned into edges.
  let sites = 0, emitted = 0
  for (const f of parsedFiles) {
    const dm: any = (f as any).metadata?.documentMetrics ?? {}
    sites += Number(dm.publishSurfaceSites ?? 0)
    emitted += Number(dm.publishSurfaceExports ?? 0)
  }
  out.push(`  publish-surface CANDIDATES (conventional name list): ${sites} · turned into \`exports\` edges by the DATA test (the value names a declaration of this document): ${emitted}`)
  for (const e of exportsEdges) out.push(`     EDGE: ${e}`)
  out.push(`     The ruling is about the first number; the graph is about the second. 174 candidates and ${emitted} edges means no candidate can dangle.`)
}

const text = out.join("\n")
console.log(text)
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({
    instrument: "validation/m14/fixtures/toml/tools/residual-whole-population.mts",
    population: { parsed: parsedFiles.length, admitted: pop.files.length, repos: parsedRepos, failed, emptyResults, absent: pop.absent, overCap: pop.overCap },
    perType: Object.fromEntries([...rows].map(([t, r]) => [t, r])),
    expected: EXPECTED,
    reproductionMismatches: mismatches,
    unresolved: unresolvedEdges.map((e) => ({ type: e.type, file: relOf(repoOf(e.file), e.file), line: e.line, target: e.target, claim: e.claim })),
    falsifier: { importsTotal, importsWithClaim, importsWithoutClaim, unresolvedImports: unresImports, nameManifestOnDisk: onDisk, nameAdmittedManifest: admittedHit, wouldReceiveClaim: guardClaim, rows: falsifierRows, oneLevelUp: { onDisk: upOnDisk, admitted: upAdmitted, rows: upRows } },
    fixArmA_fileClaim: { verified: fileClaimVerified, refuted: fileClaimRefuted, unverifiable: fileClaimUnverifiable },
    fixArmB_externalMarker: { externalVerified: extVerified, refused: extRefused },
    referencesLines: referenceLines.length,
    exports: exportsStats,
    workspaceInheritance: wsStats,
    battery: batteryRows,
  }, null, 2))
}
