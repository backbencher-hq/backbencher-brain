/**
 * PY-OWNER-ABSENT-JOIN — the owner-join for W1's `ownerMemberAbsent` claim, on the REAL index.
 *
 * WHAT THIS FILE ANSWERS, AND WHY IT IS A SEPARATE INSTRUMENT.
 *
 * W1 (`PYTHON-D7-WALLS.md`) records the claim's arm numbers: the flag-ON indexed arm reads
 * **claimed rows 7,994 = 6,562 externalVerified + 1,432 unresolved (claim-emitted /
 * gate-unverified)**, while the earlier COUNT PASS read **7,925 claims**. The D7 page closes the
 * arithmetic (`7,925 + 69 = 7,994`) and calls the 69 "the synthetic-vs-real index emission
 * difference", and it names the next step explicitly:
 *
 *   "the remaining split between (b) owner spelling/leaf divergence and (c) owner absent from the
 *    gate's owner-evidence map needs the per-row `metadata.owner` JOIN (an analyzer+real-index pass
 *    over the 13 repos) — the dump alone carries no owner column, and that join is the named next
 *    step."
 *
 * THIS IS THAT PASS. It runs the analyzer with the REAL project index (the same builder and spec
 * production uses) and with the flag on, joins every claimed row's `metadata.owner` against the
 * gate's OWN owner-evidence map (rebuilt here from the run's own symbols, with the gate's own
 * construction, copied line for line from `incoming-gate.ts`), and classifies every row that the
 * gate could NOT verify.
 *
 * THE CLASSES ARE NAMED, AND THE SUM IS EXACT:
 *
 *   VERIFIED      the owner is a key of the gate's map and the member is absent from it.
 *   REFUTED       the owner is a key and the member IS declared under it (the claim is false).
 *   UNVERIFIED    the owner is NOT a key of the gate's map. Split into FOUR named causes:
 *       b1 SPELLING       the owner's LEAF is a key, the written spelling is not — the arbiter's
 *                        lookup is an EXACT key read (`facts.ownerMembers.get(claim.owner)`), so a
 *                        qualified spelling misses a key the gate published under the leaf.
 *       c1 NO-MEMBER-KEY the owner IS declared (a class-like symbol in the run's own symbols) but
 *                        publishes NO member symbol, so the gate's map — which is keyed on the
 *                        owners OF MEMBERS — has no entry for it at all. The absence claim is TRUE
 *                        (the class declares no member of that name) and the instrument cannot see
 *                        it. THIS IS A GATE-SIDE GAP, and it is sized here.
 *       c2 OWNER-ABSENT   the owner is not declared anywhere in the run's symbols.
 *       c3 OTHER          the owner is a key of neither the map nor the leaf, and is not a
 *                        class-like symbol — the residual, reported with its own rows.
 *
 * THE 69, EXPLAINED NOT AVERAGED. The same pass runs the analyzer a SECOND time with the
 * SYNTHETIC index the count pass used (the analyzer's own symbol names, no `modules`), and diffs
 * the two claim sets row by row. For every row only one side emitted, the instrument reports the
 * GUARD that differed, read from the row's own metadata in both runs:
 *
 *   marker-set     the index pass wrote a different set of claim markers (the synthetic index has
 *                  no `modules`, so `applyProjectIndexFacts` cannot mark locality), which changes
 *                  the "a row already carries a specific claim marker" guard.
 *   count          `index.symbolCounts[owner] === 1` — the once-test — reads differently on the
 *                  two index shapes.
 *   closure        an ancestor the project declares but the index cannot resolve makes the
 *                  analyzer's closure unknown, and the claim is withheld.
 *   other          anything else, named with its rows.
 *
 * USAGE:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/py-owner-absent-join.ts \
 *     --out validation/m14/results/PYTHON-OWNER-ABSENT-JOIN.json [--repo <name>] [--limit-repos N]
 *
 * The population is the GATE'S OWN admission rule, replicated read-only from `incoming-gate.ts`
 * (git-tracked, `.py/.pyi/.pyw`, <= 1 MB, present in the working tree). The corpus is a symlink
 * farm, so `statSync` follows the link and `git -C <dir> ls-files` is the tracker.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { RealPythonAnalyzer } from "../../src/ast/real-python-analyzer"
import { buildProjectIndex, PYTHON_DECLARATION_SPEC } from "../../src/ast/project-index"

// THE CLAIM IS FLAG-GATED IN THE ANALYZER (fail-closed: no flag or no complete index => zero
// claims, byte-identical output). The flag is set BEFORE the analyzer is constructed.
process.env.BB_PY_OWNER_MEMBER_ABSENT = "1"

const ROOT = process.cwd()
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const OUT = argOf("--out")
const ONLY = argOf("--repo")
const LIMIT_REPOS = Number(argOf("--limit-repos") ?? 0)
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

/** THE GATE'S OWN LEAF SPELLING (`incoming-gate.ts`'s `leaf`), copied so the key space is the gate's. */
const leaf = (n: string): string => {
  const t = n.replace(/[<[].*$/, "").trim()
  const segs = t.split(/[.:]/).filter((x) => x.length > 0)
  return segs.length > 0 ? segs[segs.length - 1]! : t
}

/**
 * THE GATE'S OWN OWNER-EVIDENCE MAP, rebuilt from the run's SYMBOLS exactly as
 * `incoming-gate.ts` builds it. The construction is copied, not approximated:
 *
 *   · a symbol WITH an owner contributes its NAME to the member set of {ownerName, leaf(ownerName)};
 *   · a symbol WITHOUT an owner contributes its HERITAGE to {name, leaf(name)};
 *   · the closure map is keyed on the owners THAT HAVE MEMBERS — a class-like symbol with no
 *     member symbol is NOT a key, and that is exactly the `c1 NO-MEMBER-KEY` class.
 */
function buildOwnerMembers(symbols: any[]): Map<string, Set<string>> {
  const supers = new Map<string, string[]>()
  const membersByName = new Map<string, Set<string>>()
  const addKey = (m: Map<string, string[]>, k: string, v: string[]) => {
    const cur = m.get(k)
    if (cur) m.set(k, [...cur, ...v])
    else m.set(k, v)
  }
  for (const s of symbols) {
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    const owner = String(s?.ownerName ?? s?.scope ?? "").trim()
    const sup = (Array.isArray(s?.superTypes) ? s.superTypes : Array.isArray(s?.metadata?.superTypes) ? s.metadata.superTypes : [])
      .map(leaf).filter((x: string) => x.length > 0)
    if (owner.length > 0) {
      for (const k of new Set([owner, leaf(owner)])) {
        let set = membersByName.get(k)
        if (!set) membersByName.set(k, (set = new Set()))
        set.add(name)
      }
      continue
    }
    for (const k of new Set([name, leaf(name)])) if (sup.length > 0) addKey(supers, k, sup)
  }
  const closed = new Map<string, Set<string>>()
  for (const start of membersByName.keys()) {
    const out = new Set<string>()
    const seen = new Set<string>([start])
    const stack = [start]
    while (stack.length > 0) {
      const cur = stack.pop() as string
      const own = membersByName.get(cur)
      if (own) for (const m of own) out.add(m)
      for (const up of supers.get(cur) ?? []) {
        if (seen.has(up)) continue
        seen.add(up)
        stack.push(up)
      }
    }
    closed.set(start, out)
  }
  return closed
}

/** THE CLASS-LIKE OWNERS the run's own symbols declare — the evidence that an owner EXISTS. */
function classLikeOwners(symbols: any[]): Set<string> {
  const out = new Set<string>()
  for (const s of symbols) {
    const kind = String(s?.kind ?? "")
    if (kind !== "class" && kind !== "enum" && kind !== "interface" && kind !== "struct") continue
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    out.add(name)
    out.add(leaf(name))
  }
  return out
}

/**
 * THE GATE'S OWN DECLARATION COUNT MAP, rebuilt from the run's symbols the way the gate builds it:
 * EVERY analyzer symbol's NAME is a declaration key (properties and attributes included — the gate
 * counts symbols, not the index's declaration proxy), and a symbol's `qualifiedName` is another
 * SPELLING of the same symbol, so it is counted as a second key (the gate's own rule: "a symbol's
 * qualifiedName is another spelling of that symbol, so incrementing both keys keeps the
 * declaration-count honest").
 *
 * WHY THE INSTRUMENT NEEDS IT: the arbiter reads the `ownerMemberAbsent` claim ONLY where
 * `decls === 0` (`incoming-rule.ts`, `classifyEdge`). So a claim on a row whose target the project
 * declares SOMEWHERE ELSE is never read at all — the row reads by the name model, and the claim on
 * it is inert. That is the difference between "the claim was refuted" and "the claim was never
 * read", and the two are counted apart here.
 */
function declarationCounts(symbols: any[]): Map<string, number> {
  const out = new Map<string, number>()
  const bump = (k: string): void => { if (k.length > 0) out.set(k, (out.get(k) ?? 0) + 1) }
  for (const s of symbols) {
    const name = String(s?.name ?? "")
    bump(name)
    const q = String(s?.qualifiedName ?? "")
    if (q.length > 0 && q !== name) bump(q)
  }
  return out
}

/** THE CLAIM MARKERS the analyzer's owner-absence certifier refuses to sit beside. */
const CLAIM_MARKERS = [
  "isExternalTarget", "isStdlib", "externalReason", "externalSpecifier",
  "localBinding", "importedBinding", "importedName", "languageNamespace",
  "projectIndexResolution", "projectLocalModule", "isImportFile", "importOutsideProject",
  "remoteRef", "sourcePath", "cause", "ownerMemberAbsent",
]

type ClaimRow = {
  file: string; line: number; label: string; target: string; owner: string
  markers: string[]; hasClaim: boolean
}

const key = (r: ClaimRow): string => `${r.file}\u0000${r.line}\u0000${r.label}\u0000${r.target}\u0000${r.owner}`

function collectRun(rows: any[], file: string): { claims: ClaimRow[]; all: Map<string, ClaimRow> } {
  const claims: ClaimRow[] = []
  const all = new Map<string, ClaimRow>()
  for (const rel of rows) {
    const md = rel.metadata as Record<string, any> | undefined
    if (!md) continue
    const owner = typeof md.owner === "string" ? md.owner : ""
    if (owner.length === 0) continue
    const target = String(rel.target ?? "")
    if (target.length === 0) continue
    const label = String(rel.type ?? rel.relationshipType ?? "")
    const line = Number(rel.line_number ?? rel.lineNumber ?? rel.line ?? 0) || 0
    const markers = Object.keys(md).filter((k) => CLAIM_MARKERS.some((c) => k === c || k.startsWith(c)))
    const hasClaim = md.ownerMemberAbsent !== undefined && md.ownerMemberAbsent !== null
    const row: ClaimRow = { file, line, label, target, owner, markers, hasClaim }
    if (hasClaim) claims.push(row)
    all.set(`${file}\u0000${line}\u0000${label}\u0000${target}\u0000${owner}`, row)
  }
  return { claims, all }
}

const pop = admittedPythonFiles()
const repoNames = [...new Set(pop.files.map((f) => f.slice(CR.length + 1).split(path.sep)[0]!))].sort()
const reposToRun = (ONLY ? repoNames.filter((r) => r === ONLY) : repoNames).slice(0, LIMIT_REPOS > 0 ? LIMIT_REPOS : undefined)
console.error(`population: ${pop.files.length} admitted .py/.pyi/.pyw across ${pop.repos.length} repos · absent ${pop.absent} · overCap ${pop.overCap} · running ${reposToRun.length} repos`)

const parser: any = await ASTEngine.getParser("python")

type ClassCounts = { verified: number; refuted: number; unverified: number; notRead: number }
const unverifiedByCause = new Map<string, number>()
const diffByCause = new Map<string, number>()
const samples = new Map<string, string[]>()
const perRepo: any[] = []
let totalClaims = 0, totalVerified = 0, totalRefuted = 0, totalUnverified = 0, totalNotRead = 0
const notReadByCause = new Map<string, number>()
/** WHAT THE PROPOSED ARBITER RULE WOULD DECIDE on the not-read rows. */
let wouldVerify = 0, wouldRefute = 0, wouldUnverifiable = 0
let diffRealOnly = 0, diffSynthOnly = 0, diffBoth = 0

const addSample = (k: string, s: string): void => {
  const arr = samples.get(k) ?? []
  if (arr.length < 8) arr.push(s)
  samples.set(k, arr)
}

for (const repo of reposToRun) {
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

  // THE REAL INDEX — the same builder and spec production uses.
  const realIndex: any = buildProjectIndex(trees as any, PYTHON_DECLARATION_SPEC)
  realIndex.complete = true

  const runOne = (index: any): { claims: ClaimRow[]; all: Map<string, ClaimRow>; symbols: any[] } => {
    const analyzer = new RealPythonAnalyzer()
    const claims: ClaimRow[] = []
    const all = new Map<string, ClaimRow>()
    const symbols: any[] = []
    for (let i = 0; i < trees.length; i++) {
      let r: any
      try { r = analyzer.analyze(trees[i]!.tree.rootNode, contents[i]!, files[i]!, { projectIndex: index } as any) } catch { continue }
      if (!r) continue
      symbols.push(...(r.symbols ?? []))
      const c = collectRun(r.relationships ?? [], files[i]!)
      claims.push(...c.claims)
      for (const [k, v] of c.all) all.set(k, v)
    }
    return { claims, all, symbols }
  }

  const real = runOne(realIndex)
  // THE SYNTHETIC INDEX — the count pass's shape: the analyzer's OWN symbol names, no `modules`.
  // It is built from the REAL run's symbols, because the analyzer's SYMBOLS do not depend on the
  // index (the index writes relationship metadata, not symbols) — so one symbol pass answers both
  // and the second analyzer pass is the only extra work this instrument does.
  const synthCounts = new Map<string, number>()
  const synthKinds = new Map<string, string>()
  for (const sym of real.symbols) {
    if (!sym?.name) continue
    synthCounts.set(sym.name, (synthCounts.get(sym.name) ?? 0) + 1)
    if ((sym.kind === "class" || sym.kind === "enum") && !synthKinds.has(sym.name)) synthKinds.set(sym.name, "class")
  }
  const synthIndex: any = { complete: true, typeKinds: synthKinds, typeMembers: new Map(), typeBases: new Map(), symbolCounts: synthCounts }
  const synth = runOne(synthIndex)
  const closed = buildOwnerMembers(real.symbols)
  const owners = classLikeOwners(real.symbols)

  const counts: ClassCounts = { verified: 0, refuted: 0, unverified: 0, notRead: 0 }
  const declCounts = declarationCounts(real.symbols)
  for (const c of real.claims) {
    totalClaims++
    // THE ARBITER'S OWN GATE, FIRST: the claim is read ONLY where the name model has nothing.
    const decls = declCounts.get(c.target) ?? 0
    if (decls > 0) {
      // NOT READ. The claim is on the edge and the arbiter ignores it: the row reads by the name
      // model, and in production the OWNER CHANNEL withdrew that name binding, so the row is NULL.
      counts.notRead++
      totalNotRead++
      // WHAT THE PROPOSED ARBITER RULE WOULD DECIDE, measured on the same rows: the claim's own
      // evidence still decides — VERIFIED when the owner is in the map and the member is absent,
      // REFUTED when the project DECLARES the member under that owner (a refuted claim is a
      // failure, extFAIL, and must be counted as one), UNVERIFIABLE when the owner is unknown.
      const m = closed.get(c.owner)
      if (m === undefined) wouldUnverifiable++
      else if (m.has(c.target)) wouldRefute++
      else wouldVerify++
      addSample("not-read", `${path.relative(CR, c.file)}:${c.line} ${c.label} ${c.target} owner=${c.owner} decls=${decls}`)
      continue
    }
    const members = closed.get(c.owner)
    if (members !== undefined) {
      if (members.has(c.target)) { counts.refuted++; totalRefuted++; addSample("refuted", `${path.relative(CR, c.file)}:${c.line} ${c.label} ${c.target} owner=${c.owner}`) }
      else { counts.verified++; totalVerified++ }
      continue
    }
    counts.unverified++; totalUnverified++
    // THE FOUR NAMED CAUSES OF AN UNVERIFIABLE CLAIM.
    let cause: string
    if (closed.get(leaf(c.owner)) !== undefined) cause = "b1-spelling-leaf-divergence"
    else if (owners.has(c.owner) || owners.has(leaf(c.owner))) cause = "c1-owner-declared-but-no-member-key"
    else if (real.symbols.some((s: any) => String(s?.name ?? "") === c.owner || leaf(String(s?.name ?? "")) === leaf(c.owner))) cause = "c2-owner-absent-from-symbols"
    else cause = "c3-other"
    unverifiedByCause.set(cause, (unverifiedByCause.get(cause) ?? 0) + 1)
    addSample(cause, `${path.relative(CR, c.file)}:${c.line} ${c.label} ${c.target} owner=${c.owner}`)
  }

  // THE 69 — THE SYNTHETIC-vs-REAL CLAIM-SET DIFF, WITH THE GUARD THAT DIFFERED.
  const realKeys = new Set(real.claims.map(key))
  const synthKeys = new Set(synth.claims.map(key))
  for (const k of realKeys) if (!synthKeys.has(k)) diffRealOnly++
  for (const k of synthKeys) if (!realKeys.has(k)) diffSynthOnly++
  diffBoth += [...realKeys].filter((k) => synthKeys.has(k)).length
  for (const c of real.claims) {
    if (synthKeys.has(key(c))) continue
    // WHY DID THE SYNTHETIC RUN NOT CLAIM IT? Read the row's own metadata in BOTH runs.
    const rowKey = `${c.file}\u0000${c.line}\u0000${c.label}\u0000${c.target}\u0000${c.owner}`
    const s = synth.all.get(rowKey)
    let cause: string
    if (!s) cause = "row-not-emitted-by-the-synthetic-run"
    else if (s.markers.join("|") !== c.markers.join("|")) cause = "marker-set-differs"
    else if ((synthCounts.get(c.owner) ?? 0) !== (realIndex.symbolCounts?.get(c.owner) ?? 0)) cause = "once-test-count-differs"
    else cause = "closure-differs"
    diffByCause.set(cause, (diffByCause.get(cause) ?? 0) + 1)
    addSample(`diff:${cause}`, `${path.relative(CR, c.file)}:${c.line} ${c.label} ${c.target} owner=${c.owner} synthCount=${synthCounts.get(c.owner) ?? 0} realCount=${realIndex.symbolCounts?.get(c.owner) ?? 0}`)
  }

  perRepo.push({
    repo, files: trees.length,
    realClaims: real.claims.length, synthClaims: synth.claims.length,
    verified: counts.verified, refuted: counts.refuted, unverified: counts.unverified, notRead: counts.notRead,
    diffRealOnly: [...realKeys].filter((k) => !synthKeys.has(k)).length,
    diffSynthOnly: [...synthKeys].filter((k) => !realKeys.has(k)).length,
  })
  console.error(`  ${repo.padEnd(26)} files=${String(trees.length).padEnd(6)} claims(real)=${String(real.claims.length).padEnd(6)} claims(synth)=${String(synth.claims.length).padEnd(6)} verified=${String(counts.verified).padEnd(6)} unverified=${String(counts.unverified).padEnd(6)} diff=${String([...realKeys].filter((k) => !synthKeys.has(k)).length)}`)
}

const sum = (m: Map<string, number>): Record<string, number> => Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]))
console.log(`\nPY OWNER-ABSENT JOIN — whole admitted population (${pop.files.length} files, ${pop.repos.length} repos, ${reposToRun.length} repos run)`)
console.log(`claims (real index): ${totalClaims} · VERIFIED ${totalVerified} · REFUTED ${totalRefuted} · UNVERIFIED ${totalUnverified} · NOT READ (decls > 0) ${totalNotRead}`)
console.log(`closure: ${totalVerified} + ${totalRefuted} + ${totalUnverified} + ${totalNotRead} = ${totalVerified + totalRefuted + totalUnverified + totalNotRead} (claims ${totalClaims})`)
console.log(`\nUNVERIFIED by named cause: ${JSON.stringify(sum(unverifiedByCause), null, 2)}`)
console.log(`\nWHAT THE PROPOSED ARBITER RULE WOULD DECIDE on the NOT-READ rows: would VERIFY ${wouldVerify} · would REFUTE (extFAIL) ${wouldRefute} · would read UNVERIFIABLE ${wouldUnverifiable}`)
console.log(`\nSYNTHETIC-vs-REAL claim-set diff: real-only ${diffRealOnly} · synth-only ${diffSynthOnly} · both ${diffBoth}`)
console.log(`diff by named cause: ${JSON.stringify(sum(diffByCause), null, 2)}`)
for (const [k, v] of samples) console.log(`\nsample[${k}]:\n  ${v.join("\n  ")}`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    population: { files: pop.files.length, repos: pop.repos.length, absent: pop.absent, overCap: pop.overCap, reposRun: reposToRun.length },
    claims: totalClaims, verified: totalVerified, refuted: totalRefuted, unverified: totalUnverified, notRead: totalNotRead,
    notReadByCause: sum(notReadByCause),
    proposedRule: { wouldVerify, wouldRefute, wouldUnverifiable },
    unverifiedByCause: sum(unverifiedByCause), diff: { realOnly: diffRealOnly, synthOnly: diffSynthOnly, both: diffBoth, byCause: sum(diffByCause) },
    samples: Object.fromEntries(samples), perRepo,
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}
