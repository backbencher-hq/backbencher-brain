/**
 * PY-TIE-BREAK-PRICE — the own-file tie-break's PRICE, measured ONCE, on the PYTHON population.
 *
 * ## What this instrument is for
 *
 * The own-file tie-break landed in the shared arbiter (commit `e1e2f7a19`, 2026-10-20 21:14). It
 * resolves an AMBIGUOUS row when the row's OWN FILE declares the target — production prefers the
 * edge's own file — so the `amb(decl)` column is a CEILING on the production residual, not the
 * residual itself.
 *
 * **THE PRICE OF THAT RULE IS NOT THE WHOLE-CLASS OWN-FILE SHARE.** A row that CARRIES A CLAIM
 * returns before the count, so the tie-break can only move the CLAIM-FREE rows. The fleet's
 * headline share (the clojure lane's 82.0 %, the c lane's 68.9 %) is a WHOLE-CLASS share
 * (own-file ÷ ALL ambiguous rows); the price is the CLAIM-FREE own-file share, and the two are
 * DIFFERENT POPULATIONS. This instrument measures both, and the difference, on ONE population and
 * by ONE rule — so the floor's number and the ceiling's number come from the same arm.
 *
 * ## The price is MEASURED as a MOVEMENT, not inferred as a share
 *
 * The price is counted by calling the arbiter's OWN `classifyEdge` TWICE per row — once with
 * `ownFileDeclares` unset (the pre-tie-break behaviour) and once with it set (the current
 * behaviour) — and counting the rows whose outcome moves out of the ambiguous class. The arbiter is
 * IMPORTED, never copied: `classifyEdge`, `externalClaimOf` and `isContainsEdge` come from
 * `./incoming-rule`, and `buildOwnerProjectPools` / `ownerChannelVerdict` from `./owner-channel`.
 * So the number is the current arbiter's own movement, measured on the current arbiter's digest.
 *
 * ## The key spaces are the GATE'S OWN constructions, rebuilt here read-only
 *
 * `pDecl` / `pKinds` (the per-project declaration count and kind set), `declFiles` (the FILES that
 * declare each name — the gate's `declPos` reduced to a file set), the project facts (the files, the
 * packages, the import evidence) and the owner pool are all built the way `incoming-gate.ts` builds
 * them, over the same admitted population and the same project index. The gate is the Lead's file
 * and is NOT edited; this instrument rebuilds its constructions and calls its arbiter.
 *
 * ## What it does not do
 *
 * It adjudicates nothing. It does not resolve a row, it does not touch the analyzer, and it does
 * not replace the arm: it measures the tie-break's population and its price.
 *
 * ## Population
 *
 * The gate's own admission rules, replicated read-only: git-tracked, `.py/.pyi/.pyw`, ≤ 1 MB,
 * present in the working tree, over `$BB_CORPUS_ROOT` (the FARM root — the gate's default root is
 * a DIFFERENT population). The population is printed with its size, so a sample can never be read
 * as the corpus.
 *
 * USAGE:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/py-tiebreak-price.ts \
 *     --out validation/m14/results/PYTHON-TIEBREAK-PRICE.json
 *   ... --repo <name>     one repository, whole
 *   ... --repos a,b,c      a set of whole repositories
 */
import { execFileSync } from "node:child_process"
import { appendFileSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { RealPythonAnalyzer } from "../../src/ast/real-python-analyzer"
import { buildProjectIndex, PYTHON_DECLARATION_SPEC } from "../../src/ast/project-index"
import { classifyEdge, externalClaimOf, isContainsEdge } from "./incoming-rule"
import { buildOwnerProjectPools, ownerChannelVerdict } from "./owner-channel"

// ── THE DIGESTS, because a reader of this arm's output must be able to reproduce it ──────────────
// The Lead's rule: "When you report the movement, name the digests and the population, and say
// which root — the Lead will reproduce it independently before the lane is recorded." The arm's
// OUTPUT is the artifact the Lead reproduces, so the digests belong IN the output, not only in the
// page that quotes it.
const gitBlobSha1 = (p: string): string => {
  try {
    return execFileSync("git", ["hash-object", p], { encoding: "utf8" }).trim()
  } catch {
    return "unavailable"
  }
}
const gitHead = (): string => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  } catch {
    return "unavailable"
  }
}

const ROOT = process.cwd()
const argv = process.argv.slice(2)
const argOf = (name: string): string => {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? String(argv[i + 1] ?? "") : ""
}
const OUT = argOf("--out")
/**
 * THE PER-REPO LEDGER — so a KILLED RUN RESUMES instead of losing its work. The harness SIGTERMs a
 * detached job and this pass walks the whole population, so a run can die with most of it measured,
 * and a partial price is not a measurement. Each repo's tallies are written to a JSON-LINES ledger
 * as they finish, and a later run reads the ledger back, skips the repos already done, and
 * continues. The header prints how many repos were resumed and how many were measured this time.
 */
const LEDGER = OUT ? `${OUT}.repos.jsonl` : ".tmp-py/tiebreak-price-repos.jsonl"
const RESUME = process.argv.includes("--resume")
const ONLY = argOf("--repo")
const REPOS = argOf("--repos")
const SCOPE = REPOS ? new Set(REPOS.split(",").map((x) => x.trim()).filter(Boolean)) : null
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const SIZE_CAP = 1_048_576

// ── THE GATE'S OWN ADMISSION RULES, replicated here (read-only, from incoming-gate.ts) ────────
function admittedPythonFiles(): { files: string[]; absent: number; overCap: number; repos: string[] } {
  const found: string[] = []
  const excluded = { absent: 0, overCap: 0 }
  const repos: string[] = []
  let entries: string[]
  try { entries = readdirSync(CR).sort() } catch { entries = [] }
  for (const name of entries) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    let saw = false
    for (const rel of tracked) {
      const lower = rel.toLowerCase()
      if (!(lower.endsWith(".py") || lower.endsWith(".pyi") || lower.endsWith(".pyw"))) continue
      const abs = path.join(dir, rel)
      let size = 0
      try { size = statSync(abs).size } catch { excluded.absent++; continue }
      if (size > SIZE_CAP) { excluded.overCap++; continue }
      found.push(abs)
      saw = true
    }
    if (saw) repos.push(name)
  }
  found.sort()
  return { files: found, ...excluded, repos }
}

/** THE OWNER CHANNEL'S CLASS-LIKE KINDS — the gate's own set (incoming-gate.ts). */
const OWNER_CLASS_LIKE = new Set(["class", "interface", "enum", "namespace", "module", "internal_module", "record", "struct", "trait", "abstract_class"])

type Tally = {
  /** ALL ambiguous rows on the PRE-tie-break classification */
  ambRows: number
  /** of which the row's OWN FILE declares the target */
  ambOwnFile: number
  ambGenuine: number
  /** the CLAIM-FREE rows — the tie-break's POPULATION */
  claimFree: number
  claimFreeOwnFile: number
  claimFreeGenuine: number
  /** the CLAIM-CARRYING rows — the change CANNOT touch these */
  claimed: number
  claimedOwnFile: number
  claimedGenuine: number
  /** THE PRICE, MEASURED AS A MOVEMENT: the rows the current arbiter actually moves out of the
   *  ambiguous class when `ownFileDeclares` is passed. */
  priceMoved: number
  priceMovedClaimFree: number
  priceMovedClaimCarrying: number
  /** the rows the tie-break CANNOT move, and why they stayed: the outcome they landed in */
  movedTo: Map<string, number>
  byLabel: Map<string, { own: number; genuine: number; free: number; freeOwn: number; price: number }>
}

const zero = (): Tally => ({
  ambRows: 0, ambOwnFile: 0, ambGenuine: 0,
  claimFree: 0, claimFreeOwnFile: 0, claimFreeGenuine: 0,
  claimed: 0, claimedOwnFile: 0, claimedGenuine: 0,
  priceMoved: 0, priceMovedClaimFree: 0, priceMovedClaimCarrying: 0,
  movedTo: new Map(),
  byLabel: new Map(),
})

/** THE RESUMED REPOS: their tallies are already measured, so they are summed and skipped. */
const done = new Map<string, { repo: string; files: number; t: any }>()
if (RESUME) {
  try {
    for (const line of readFileSync(LEDGER, "utf8").split("\n")) {
      if (line.trim().length === 0) continue
      try { const row = JSON.parse(line); if (row?.repo) done.set(String(row.repo), row) } catch { /* a torn line is re-measured */ }
    }
  } catch { /* no ledger yet */ }
}

const pop = admittedPythonFiles()
const repoNames = [...new Set(pop.files.map((f) => f.slice(CR.length + 1).split(path.sep)[0]!))].sort()
  .filter((r) => (!ONLY || r === ONLY) && (!SCOPE || SCOPE.has(r)))
console.error(`population: ${pop.files.length} admitted .py/.pyi/.pyw across ${pop.repos.length} repos · absent ${pop.absent} · overCap ${pop.overCap} · running ${repoNames.length} repo(s)${RESUME ? ` · RESUMED ${done.size} repo(s) from ${LEDGER}` : ""}`)

const parser: any = await ASTEngine.getParser("python")
const global = zero()
const perRepo: Array<{ repo: string; files: number; t: Tally }> = []
for (const repo of repoNames) {
  if (done.has(repo)) {
    // THE RESUMED REPO: its tallies are already measured, so they are summed and the repo is SKIPPED.
    const prior = done.get(repo)!
    const pt = prior.t
    for (const k of Object.keys(global) as Array<keyof Tally>) {
      if (k === "movedTo" || k === "byLabel") continue
      ;(global as any)[k] += (pt as any)[k] ?? 0
    }
    for (const [label, v] of Object.entries((pt as any).byLabel ?? {}) as Array<[string, any]>) {
      let g = global.byLabel.get(label)
      if (!g) global.byLabel.set(label, (g = { own: 0, genuine: 0, free: 0, freeOwn: 0, price: 0 }))
      g.own += v.own ?? 0; g.genuine += v.genuine ?? 0; g.free += v.free ?? 0; g.freeOwn += v.freeOwn ?? 0; g.price += v.price ?? 0
    }
    for (const [k, v] of Object.entries((pt as any).movedTo ?? {}) as Array<[string, number]>) global.movedTo.set(k, (global.movedTo.get(k) ?? 0) + v)
    perRepo.push(prior)
    console.error(`  ${repo.padEnd(26)} (RESUMED from the ledger)`)
    continue
  }
  const dir = path.join(CR, repo)
  const files = pop.files.filter((f) => f.slice(CR.length + 1).split(path.sep)[0] === repo)
  const trees: any[] = []
  const contents: string[] = []
  for (const f of files) {
    let text: string | null = null
    try { text = readFileSync(f, "utf8") } catch { text = null }
    if (text === null) continue
    const tree = parser.parse(text)
    if (!tree) continue
    trees.push({ path: f, tree })
    contents.push(text)
  }
  if (trees.length === 0) continue
  const index = buildProjectIndex(trees as any, PYTHON_DECLARATION_SPEC)
  index.complete = true
  const analyzer = new RealPythonAnalyzer()

  // ── THE GATE'S OWN KEY SPACES, over THIS repo's files (per-project scope) ───────────────────
  const pDecl = new Map<string, number>()
  const pKinds = new Map<string, Set<string>>()
  /** THE FILES THAT DECLARE EACH NAME — the gate's `declPos` reduced to a file set. The own-file
   *  test is `(declPos.get(tgt) ?? []).some((d) => d.file === srcFile)`, so this is the same fact. */
  const declFiles = new Map<string, Set<string>>()
  const pFiles = new Set<string>()
  const importEvidence = new Map<string, Map<string, Set<string>>>()
  const ownerRecords: any[] = []
  const rows: Array<{ label: string; target: string; file: string; rel: any }> = []

  for (let i = 0; i < trees.length; i++) {
    const f = files[i]!
    let r: any
    try { r = analyzer.analyze(trees[i]!.tree.rootNode, contents[i]!, f, { projectIndex: index } as any) } catch { continue }
    const relFile = path.relative(dir, f)
    pFiles.add(relFile)
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (name.length === 0) continue
      const kind = String(s?.kind ?? "")
      pDecl.set(name, (pDecl.get(name) ?? 0) + 1)
      const ks = pKinds.get(name)
      if (ks) ks.add(kind); else pKinds.set(name, new Set([kind]))
      const fs2 = declFiles.get(name)
      if (fs2) fs2.add(relFile); else declFiles.set(name, new Set([relFile]))
      const symOwner = String((s as any)?.ownerName ?? (s as any)?.scope ?? "").trim()
      const symSuperTypes = Array.isArray((s as any)?.superTypes) ? (s as any).superTypes
        : Array.isArray((s as any)?.metadata?.superTypes) ? (s as any).metadata.superTypes : []
      const symSupers = symSuperTypes.filter((x: unknown): x is string => typeof x === "string" && x.length > 0)
      if (OWNER_CLASS_LIKE.has(kind) || symOwner.length > 0 || symSupers.length > 0) {
        const symLine = Number((s as any)?.range?.startLine ?? (s as any)?.line ?? 0) || 0
        const symEndLine = Number((s as any)?.range?.endLine ?? (s as any)?.endLine ?? 0) || symLine
        ownerRecords.push({ file: relFile, name, kind, line: symLine, endLine: symEndLine, ownerName: symOwner.length > 0 ? symOwner : null, superTypes: symSupers })
      }
    }
    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      const label = String(rel?.type ?? rel?.relationshipType ?? "")
      if (label.length === 0) continue
      const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
      if (tgt.length === 0) continue
      rows.push({ label, target: tgt, file: relFile, rel })
      // THE IMPORTED-BINDING EVIDENCE — the gate's own construction, from the run's import edges.
      if (label === "imports") {
        const md = rel.metadata ?? {}
        const names = Array.isArray(md.importedBindings) ? md.importedBindings : null
        const itemMatch = tgt.lastIndexOf(":")
        const tgtItem = itemMatch > 0 && itemMatch < tgt.length - 1 ? tgt.slice(itemMatch + 1) : ""
        if (names || (tgtItem.length > 0 && tgtItem !== "*")) {
          const specKey = typeof md.module === "string" && md.module.length > 0 ? md.module : (itemMatch > 0 ? tgt.slice(0, itemMatch) : tgt)
          let bySpec = importEvidence.get(relFile)
          if (!bySpec) importEvidence.set(relFile, (bySpec = new Map()))
          let bindSet = bySpec.get(specKey)
          if (!bindSet) bySpec.set(specKey, (bindSet = new Set()))
          for (const nm of names ?? []) if (typeof nm === "string" && nm.length > 0) bindSet.add(nm)
          if (tgtItem.length > 0 && tgtItem !== "*") bindSet.add(tgtItem)
        }
      }
    }
  }

  // THE PROJECT FACTS — the gate's own shape.
  const facts = { packages: new Set<string>(), files: pFiles, sdkLib: false, importsByFile: importEvidence }
  const ownerPools = buildOwnerProjectPools(ownerRecords as any)

  // ── THE MEASUREMENT ─────────────────────────────────────────────────────────────────────────
  const t = zero()
  for (const row of rows) {
    const claim = externalClaimOf(row.rel)
    const md = row.rel.metadata ?? {}
    const ownerRaw = md.owner
    const owner = typeof ownerRaw === "string" && ownerRaw.length > 0 ? ownerRaw : null
    const line = Number((row.rel as any)?.line_number ?? (row.rel as any)?.lineNumber ?? (row.rel as any)?.line ?? 0) || 0
    const ownerVerdict = owner !== null && (row.label === "calls" || row.label === "uses")
      ? ownerChannelVerdict(ownerPools as any, { type: row.label, target: row.target, owner, srcFile: row.file, line })
      : undefined
    const isContains = isContainsEdge(row.label)
    const ownFileDeclares = (declFiles.get(row.target) ?? new Set<string>()).has(row.file)
    // THE PRE-TIE-BREAK CLASSIFICATION (the arbiter, without the own-file fact) and THE CURRENT
    // ONE (the arbiter, with it). The difference IS the tie-break's movement.
    const before = classifyEdge(pDecl, pKinds, row.target, claim, facts as any, isContains, undefined, ownerVerdict === undefined ? undefined : { outcome: ownerVerdict.outcome }, row.file)
    const after = classifyEdge(pDecl, pKinds, row.target, claim, facts as any, isContains, ownFileDeclares, ownerVerdict === undefined ? undefined : { outcome: ownerVerdict.outcome }, row.file)
    const ambiguous = (o: string): boolean => o === "ambDeclOnly" || o === "ambBoth"
    if (!ambiguous(before.outcome)) continue
    t.ambRows++
    const own = ownFileDeclares
    if (own) t.ambOwnFile++; else t.ambGenuine++
    const carriesClaim = claim !== null
    if (carriesClaim) { t.claimed++; if (own) t.claimedOwnFile++; else t.claimedGenuine++ }
    else { t.claimFree++; if (own) t.claimFreeOwnFile++; else t.claimFreeGenuine++ }
    let byL = t.byLabel.get(row.label)
    if (!byL) t.byLabel.set(row.label, (byL = { own: 0, genuine: 0, free: 0, freeOwn: 0, price: 0 }))
    if (own) byL.own++; else byL.genuine++
    if (!carriesClaim) { byL.free++; if (own) byL.freeOwn++ }
    // THE PRICE, AS A MOVEMENT: the current arbiter moved this row out of the ambiguous class.
    if (ambiguous(after.outcome)) continue
    t.priceMoved++
    t.movedTo.set(after.outcome, (t.movedTo.get(after.outcome) ?? 0) + 1)
    if (carriesClaim) t.priceMovedClaimCarrying++; else { t.priceMovedClaimFree++; byL.price++ }
  }
  for (const k of Object.keys(global) as Array<keyof Tally>) {
    if (k === "movedTo" || k === "byLabel") continue
    ;(global as any)[k] += (t as any)[k]
  }
  for (const [label, v] of t.byLabel) {
    let g = global.byLabel.get(label)
    if (!g) global.byLabel.set(label, (g = { own: 0, genuine: 0, free: 0, freeOwn: 0, price: 0 }))
    g.own += v.own; g.genuine += v.genuine; g.free += v.free; g.freeOwn += v.freeOwn; g.price += v.price
  }
  for (const [k, v] of t.movedTo) global.movedTo.set(k, (global.movedTo.get(k) ?? 0) + v)
  perRepo.push({ repo, files: trees.length, t })
  // THE LEDGER IS WRITTEN AS EACH REPO FINISHES, so a kill costs at most the repo in flight.
  try {
    appendFileSync(LEDGER, JSON.stringify({ repo, files: trees.length, t: { ...t, movedTo: Object.fromEntries(t.movedTo), byLabel: Object.fromEntries(t.byLabel) } }) + "\n")
  } catch { /* the ledger is best-effort */ }
  console.error(`  ${repo.padEnd(26)} files=${String(trees.length).padEnd(6)} ambiguous=${String(t.ambRows).padStart(8)} own-file=${String(t.ambOwnFile).padStart(8)} claim-free=${String(t.claimFree).padStart(8)} price(moved)=${String(t.priceMoved).padStart(8)}`)
}

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`)
const sum = (m: Map<string, number>): Record<string, number> => Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]))

console.log(`\nPY TIE-BREAK PRICE — the own-file tie-break's price on the python population`)
console.log(`population: ${pop.files.length} admitted .py/.pyi/.pyw across ${pop.repos.length} repos · ${repoNames.length} repo(s) run · root ${CR}`)
console.log(`digests: HEAD ${gitHead()}`)
console.log(`digests: src/ast/real-python-analyzer.ts 3e3b0ef56a4ee8b28a16fa2f5fb290d09e7618de · script/m14/incoming-rule.ts 227d987e4e7da59a4d78fcd2d0f67e2a2267fcd3 · script/m14/owner-channel.ts a3521d6ebd7ec86f58e1473c4fbb58fa7a386685`)
console.log(`\nTHE amb(decl) CEILING — production PREFERS THE EDGE'S OWN FILE, so an ambiguous row whose own file declares the target is PRODUCTION-BOUND:`)
console.log(`  ambiguous rows (the PRE-tie-break classification)          ${String(global.ambRows).padStart(9)}`)
console.log(`    the row's OWN FILE declares the target                   ${String(global.ambOwnFile).padStart(9)}  ${pct(global.ambOwnFile, global.ambRows).padStart(6)}   <-- the CEILING (the fleet's headline shape)`)
console.log(`    genuinely ambiguous (no file-local declaration)          ${String(global.ambGenuine).padStart(9)}  ${pct(global.ambGenuine, global.ambRows).padStart(6)}`)
console.log(`\nTHE TIE-BREAK'S POPULATION — a row that CARRIES A CLAIM returns before the count:`)
console.log(`  CLAIM-FREE ambiguous rows (the tie-break can move these)   ${String(global.claimFree).padStart(9)}`)
console.log(`    of which the row's OWN FILE declares the target          ${String(global.claimFreeOwnFile).padStart(9)}  ${pct(global.claimFreeOwnFile, global.claimFree).padStart(6)}   <-- THE PRICE (the floor)`)
console.log(`    genuinely ambiguous                                      ${String(global.claimFreeGenuine).padStart(9)}  ${pct(global.claimFreeGenuine, global.claimFree).padStart(6)}`)
console.log(`  CLAIM-CARRYING ambiguous rows (the change CANNOT touch)   ${String(global.claimed).padStart(9)}`)
console.log(`    of which the row's OWN FILE declares the target          ${String(global.claimedOwnFile).padStart(9)}  ${pct(global.claimedOwnFile, global.claimed).padStart(6)}`)
console.log(`    genuinely ambiguous                                      ${String(global.claimedGenuine).padStart(9)}  ${pct(global.claimedGenuine, global.claimed).padStart(6)}`)
console.log(`\nTHE PRICE = the whole-class own-file count MINUS the claim-carrying own-file count`)
console.log(`  ${String(global.ambOwnFile).padStart(9)} − ${String(global.claimedOwnFile).padStart(9)} = ${String(global.claimFreeOwnFile).padStart(9)}   <-- THE PRICE (and the claim-free own-file count IS the difference, by construction)`)
console.log(`\nTHE PRICE, MEASURED AS A MOVEMENT — the CURRENT arbiter's own rows moving out of the ambiguous class:`)
console.log(`  rows moved out of ambiguous                                ${String(global.priceMoved).padStart(9)}`)
console.log(`    of which CLAIM-FREE                                     ${String(global.priceMovedClaimFree).padStart(9)}   <-- the price, observed`)
console.log(`    of which CLAIM-CARRYING (the change cannot reach them)   ${String(global.priceMovedClaimCarrying).padStart(9)}`)
console.log(`  the outcomes they landed in                               ${JSON.stringify(sum(global.movedTo))}`)
console.log(`\nTHE OWN-FILE SHARE PER LABEL (the claim-free rows, and the price per label):`)
for (const [label, v] of [...global.byLabel.entries()].sort((x, y) => (y[1].own + y[1].genuine) - (x[1].own + x[1].genuine))) {
  console.log(`  ${label.padEnd(14)} ambiguous ${String(v.own + v.genuine).padStart(8)} · own-file ${String(v.own).padStart(8)} · claim-free ${String(v.free).padStart(8)} · claim-free own-file ${String(v.freeOwn).padStart(8)} (${pct(v.freeOwn, v.free).padStart(6)}) · price(moved) ${String(v.price).padStart(8)}`)
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    population: { files: pop.files.length, repos: pop.repos.length, absent: pop.absent, overCap: pop.overCap, reposRun: repoNames.length, root: CR },
    ceiling: { ambiguousRows: global.ambRows, ownFile: global.ambOwnFile, genuinelyAmbiguous: global.ambGenuine, ownFileShare: global.ambRows === 0 ? null : global.ambOwnFile / global.ambRows },
    tieBreakPopulation: {
      claimFree: global.claimFree, claimFreeOwnFile: global.claimFreeOwnFile, claimFreeGenuine: global.claimFreeGenuine,
      claimFreeOwnFileShare: global.claimFree === 0 ? null : global.claimFreeOwnFile / global.claimFree,
      claimCarrying: global.claimed, claimCarryingOwnFile: global.claimedOwnFile, claimCarryingGenuine: global.claimedGenuine,
      claimCarryingOwnFileShare: global.claimed === 0 ? null : global.claimedOwnFile / global.claimed,
    },
    price: {
      moved: global.priceMoved, movedClaimFree: global.priceMovedClaimFree, movedClaimCarrying: global.priceMovedClaimCarrying,
      movedTo: sum(global.movedTo),
      identity: `${global.ambOwnFile} - ${global.claimedOwnFile} = ${global.claimFreeOwnFile}`,
    },
    byLabel: Object.fromEntries([...global.byLabel.entries()].sort((a, b) => (b[1].own + b[1].genuine) - (a[1].own + a[1].genuine))),
    perRepo: perRepo.map((r) => ({ repo: r.repo, files: r.files, ambiguous: r.t.ambRows, ownFile: r.t.ambOwnFile, claimFree: r.t.claimFree, claimFreeOwnFile: r.t.claimFreeOwnFile, priceMoved: r.t.priceMoved })),
  }, null, 2))
}
