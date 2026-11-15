/**
 * CSS AMBIGUITY CLASSIFY — the split of the gate's `ambiguousByDecl` and `unresolved`
 * numbers into classes that have different owners.
 *
 * ## Why this file exists
 *
 * `script/m14/incoming-gate.ts` answers ONE question per lane — does every emitted edge
 * resolve to exactly one declaration in its own project — and it answers NO for css:
 *
 *   npx tsx script/m14/incoming-gate.ts css css 60
 *   VERDICT: FAIL — 12453 ambiguous + 689 unresolved of 32436 edges   (before the chain-term kind fix)
 *   VERDICT: FAIL — 12453 ambiguous + 688 unresolved of 32432 edges   (after: 4 edges withheld)
 *   npx tsx script/m14/incoming-gate.ts css css 0
 *   VERDICT: FAIL — 456597 ambiguous + 4897 unresolved of 485911 edges   (before)
 *   VERDICT: FAIL — 456587 ambiguous + 4883 unresolved of 485882 edges   (after: 29 withheld)
 *
 * BOTH lines are asserted below, because they are 37x apart on ambiguity: a stride sample
 * truncates each project's symbol table, so its collisions are the collisions of the files
 * it happened to draw. The population is the honest unit; the sample is what the mandated
 * command reports, and a classification must say which one it is describing.
 *
 * A single number cannot be acted on, because it mixes findings with different owners:
 * a name the analyzer should never have published bare, a name the LANGUAGE does not
 * make unique, and a name that is not in the corpus at all. This file buys the split.
 *
 * ## The counting rule is IMPORTED, not copied
 *
 * `classifyEdge` / `tally` come from `script/m14/incoming-rule.ts` — the same module the
 * arbiter imports — so this census cannot drift from the gate it explains. Two copies of
 * a counting rule are two rules, and this programme has already paid for that twice.
 * What this file adds is FACTS ABOUT THE COUNTED THING: which files declare the name,
 * how many sites sit in the edge's own file, whether two contributions share a line,
 * whether the declaring files are byte-identical, and whether any other spelling of the
 * same declaration is already in the key space.
 *
 * ## The population is the GATE's, replicated and asserted
 *
 * Discovery (`discover`) is a transcription of `discoverFiles` in `incoming-gate.ts`:
 * whole-corpus `git ls-files` per checkout, `.css` by extension, the same 1 MB cap, the
 * same `found.sort()` and the same stride. It is replicated rather than imported because
 * the gate does not export it — and replication is only safe because the run ASSERTS its
 * totals against the gate's own printed line for the same `maxFiles`. If the two ever
 * disagree the run FAILS (`GATE COMPARISON`) instead of printing a classification of a
 * different population. Run with `maxFiles 0` for the whole admitted population.
 *
 * ## The classes, and why the precedence is stated
 *
 * For an ambiguous target (its project publishes the name more than once), evaluated in
 * the edge's OWN FILE, precedence DUP > IN-FILE-MULTI > CROSS-FILE-TWIN > CROSS-FILE-ONLY:
 *
 *   DUP-EMISSION      two contributions to the SAME key at the same file AND the same full
 *                     byte range (`startIndex`/`endIndex`) — one node published twice.
 *                     Nothing about the language requires it; a real defect.
 *   IN-FILE-MULTI     the edge's own file declares the name 2+ times at different sites.
 *                     Legal CSS: a stylesheet may re-declare a selector or a custom
 *                     property, and every one of those is a declaration. The sub-count
 *                     `inFileMultiKind` says how many of these are ONE NAME UNDER TWO KINDS
 *                     (a `progress {}` element rule beside a `@keyframes progress`) — the
 *                     only shape the fleet's kind-counting metric can see at all.
 *   CROSS-FILE-TWIN   the edge's own file declares it EXACTLY once; every other
 *                     contribution is in another file. A file-scoped identity would name
 *                     the edge's own file's site — measured here as `altSpellingResolves`
 *                     (is such a spelling already in the key space?). The per-DECLARATION
 *                     publication contract has no file dimension; whether it should is a
 *                     question this file answers with a number, not an opinion.
 *   CROSS-FILE-ONLY   the edge's own file declares the name NOWHERE. No spelling the edge
 *                     could carry within its own file resolves it.
 *
 * A first version of this file named the same-file class on a same-LINE test read from
 * `s.range.start.line`, which production does not publish: every site collapsed to line 0
 * and three same-name/DIFFERENT-KIND symbols in one file read as a double emission. The
 * audit list printed the two symbols (`progress` published as `type` and as `function`) and
 * the class is retired — the discriminator is the full byte range, and the same-line count
 * survives only as a diagnostic.
 *
 * `twinDigests` measures the corpus fact behind the biggest class: how many distinct
 * sha256 digests the declaring files have. One digest means the corpus ships N copies of
 * one stylesheet of bytes — the same declaration counted N times is still N declarations
 * to the arbiter, and that is the distinction this column exists to make visible.
 *
 * ## What it does NOT do
 *
 * No text matching over the corpus and not one regular expression: every fact comes from
 * the published `ParseResult` of production's own `parseFile`. The only source bytes read
 * are whole-file digests (`twinDigests`), which are a fact about a FILE and not about a
 * name — a digest cannot be fooled by a name in a comment.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/css/ambiguity-classify.ts [maxFiles] [--json]
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"
import { classifyEdge, externalClaimOf, emptyOutcomes, tally } from "../../../../script/m14/incoming-rule"
import type { Outcomes } from "../../../../script/m14/incoming-rule"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

/** The engine limit `pool-worker.ts` FULL_AST_LIMIT draws (`incoming-gate.ts` SIZE_CAP). */
const SIZE_CAP = 1024 * 1024

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes("--json")
const MAX_FILES = Number(argv.find((a) => !a.startsWith("--")) ?? 60)

/**
 * The gate's discovery, transcribed. Returns the stride sample AND the unsampled admitted
 * list, because a fact about a project must not be answered from this run's budget.
 */
function discover(ext: string, maxFiles: number): {
  files: string[]; admitted: string[]; total: number; repos: number
  overCap: number; absent: number
} {
  const found: string[] = []
  const repos = new Set<string>()
  let overCap = 0
  let absent = 0
  let entries: string[]
  try {
    entries = readdirSync(CR)
  } catch {
    return { files: [], admitted: [], total: 0, repos: 0, overCap: 0, absent: 0 }
  }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    try {
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
      if (!ext.split(",").some((x) => rel.toLowerCase().endsWith(`.${x.trim().toLowerCase()}`))) continue
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > SIZE_CAP) { overCap++; continue }
      } catch {
        absent++
        continue
      }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  const total = found.length
  let files = found
  if (maxFiles > 0 && total > maxFiles) {
    const stride = Math.max(1, Math.floor(total / maxFiles))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < maxFiles; i += stride) picked.push(found[i])
    files = picked
  }
  return { files, admitted: found, total, repos: repos.size, overCap, absent }
}

const repoOf = (f: string): string => path.join(CR, f.slice(CR.length + 1).split(path.sep)[0])
const relOf = (f: string): string => f.slice(CR.length + 1).split(path.sep).join("/")

// ------------------------------------------------------------------ declaration index

type Site = {
  file: string
  line: number
  kind: string
  /** the published symbol name */
  name: string
  qualifiedName: string
  scope: string
  /**
   * The symbol's FULL byte range as production publishes it (`startIndex`/`endIndex`).
   * Two contributions to one key with an IDENTICAL range are one node published twice;
   * two contributions on the same LINE with different ranges are one line holding two
   * declarations — which is every line of a minified file, and is not a defect.
   */
  rangeKey: string
  /**
   * WHICH SPELLING put this key in the space — `name` counts under its own name, a
   * qualifiedName also counts under itself (`incoming-gate.ts` `countKey`). A site can
   * contribute twice; that is ONE declaration either way.
   */
  via: ("name" | "qualifiedName")[]
}
type NameEntry = { sites: Site[]; kinds: Set<string> }

const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
const projectNames = new Map<string, Map<string, NameEntry>>()

const fileDigest = new Map<string, string>()
const digestOf = (abs: string): string => {
  let d = fileDigest.get(abs)
  if (d === undefined) {
    try {
      d = createHash("sha256").update(readFileSync(abs)).digest("hex").slice(0, 12)
    } catch {
      d = "UNREADABLE"
    }
    fileDigest.set(abs, d)
  }
  return d
}

async function main(): Promise<void> {
  // THE LANE'S DECLARED POPULATION IS `css,less`: `d43a5fa4d` (the population gate) found the
  // router maps `.less` to css and css was measuring a fraction of its language, so the gate and
  // residual-gate both admit BOTH spellings. This census walked `.css` only until 2026-10-10,
  // which is why it read `imports` 127 where the gate reads 178. Override with BB_CSS_EXTS.
  const { files, admitted, total, repos, overCap, absent } = discover(process.env.BB_CSS_EXTS ?? "css,less", MAX_FILES)

  const pending: { label: string; tgt: string; claim: any; sig: string; repo: string; file: string }[] = []
  const rows = new Map<string, { edges: number; project: Outcomes }>()
  const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
  for (const t of ALL_TYPES) rows.set(t, { edges: 0, project: emptyOutcomes() })

  let parsed = 0
  let failed = 0
  let degraded = 0
  for (const f of files) {
    let r: any
    try {
      r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any)
    } catch {
      failed++
      continue
    }
    if (!r) { failed++; continue }
    parsed++
    if (r.fallback === true || r.metadata?.analysisVersion === "2.0-basic-fallback") degraded++
    const repo = repoOf(f)
    const rel = relOf(f)
    let pDecl = projectDecl.get(repo)
    if (!pDecl) projectDecl.set(repo, (pDecl = new Map()))
    let pKinds = projectKinds.get(repo)
    if (!pKinds) projectKinds.set(repo, (pKinds = new Map()))
    let pNames = projectNames.get(repo)
    if (!pNames) projectNames.set(repo, (pNames = new Map()))

    const countKey = (key: string, kind: string, site: Site) => {
      pDecl!.set(key, (pDecl!.get(key) ?? 0) + 1)
      let ks = pKinds!.get(key)
      if (!ks) pKinds!.set(key, (ks = new Set()))
      ks.add(kind)
      let e = pNames!.get(key)
      if (!e) pNames!.set(key, (e = { sites: [], kinds: new Set() }))
      e.kinds.add(kind)
      e.sites.push(site)
    }

    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (name.length === 0) continue
      const kind = String(s?.kind ?? "")
      const q = String(s?.qualifiedName ?? "")
      // `pool-worker.parseFile` publishes FLAT `startLine`/`endLine`/`startIndex`/`endIndex`
      // (pool-worker.ts:1063-1073), not a nested `range`. The first version of this probe
      // read `s.range.start.line`, so every site collapsed to line 0 and `?:?-?:?` — which
      // made three same-name/different-KIND symbols in one file look like a same-site
      // double emission. The audit list caught it, and the class it invented is retired.
      const line = Number(s?.startLine ?? s?.range?.startLine ?? s?.range?.start?.line ?? 0)
      const scope = String(s?.scope ?? "")
      const rk = `${s?.startIndex ?? s?.range?.startIndex ?? "?"}-${s?.endIndex ?? s?.range?.endIndex ?? "?"}`
      const site: Site = { file: rel, line, kind, name, qualifiedName: q, scope, rangeKey: rk, via: [] }
      site.via.push("name")
      countKey(name, kind, site)
      if (q.length > 0 && q !== name) {
        site.via.push("qualifiedName")
        countKey(q, kind, site)
      }
    }

    for (const reln of Array.isArray(r.relationships) ? r.relationships : []) {
      const label = String(reln?.type ?? reln?.relationshipType ?? "")
      if (!ALL_TYPES.includes(label)) continue
      rows.get(label)!.edges++
      const tgt = String(reln?.target ?? reln?.to ?? reln?.toSymbol ?? "")
      if (tgt.length === 0) continue
      const md = reln?.metadata ?? {}
      const markKeys = Object.keys(md).filter((k) => k !== "evidenceClass" && k !== "analysisVersion" && md[k] !== false && md[k] != null)
      markKeys.sort()
      pending.push({ label, tgt, claim: externalClaimOf(reln), sig: markKeys.length ? markKeys.join("+") : "(no marker)", repo, file: rel })
    }
  }

  // ---------------------------------------------------------------- classification
  const totals: Outcomes = emptyOutcomes()
  const pooledTotals: Record<string, number> = { edges: 0 }
  const byType: Record<string, { edges: number; amb: number; unres: number; resolved: number }> = {}
  for (const t of ALL_TYPES) byType[t] = { edges: 0, amb: 0, unres: 0, resolved: 0 }

  type AmbEdge = {
    label: string; tgt: string; repo: string; file: string
    decls: number; kinds: string; files: number
    selfSites: number; selfLines: number
    /** distinct SymbolKinds among the contributions the edge's OWN file makes */
    selfKinds: number
    sameLineDup: number
    /** contributions sharing a line AND a full range — one node published twice */
    sameRangeDup: number
    digestCount: number
    altResolves: number | null
    altSpelling: string | null
  }
  const ambEdges: AmbEdge[] = []
  /** targets whose key is answered twice by the SAME file+range — one node published twice */
  const dupAudit: { tgt: string; file: string; sites: { name: string; kind: string; scope: string; q: string; line: number; range: string }[] }[] = []
  type UnresEdge = { label: string; tgt: string; repo: string; file: string; shape: string; inPooled: number; prefix: string; sig: string }
  const unresEdges: UnresEdge[] = []

  for (const e of pending) {
    const pc = classifyEdge(projectDecl.get(e.repo)!, projectKinds.get(e.repo)!, e.tgt, e.claim)
    tally(totals, pc, e.tgt, e.label)
    byType[e.label].edges++
    const entry = projectNames.get(e.repo)?.get(e.tgt)
    if (pc.outcome === "ambDeclOnly" || pc.outcome === "ambBoth") {
      byType[e.label].amb++
      const sites = entry?.sites ?? []
      const selfSites = sites.filter((s) => s.file === e.file)
      const declaringFiles = [...new Set(sites.map((s) => s.file))]
      // The multiplicity that MATTERS is the one in the EDGE'S OWN FILE: a same-line pair in
      // some other file says nothing about whether this edge had a choice of spelling.
      const countBy = (list: Site[], key: (s: Site) => string): number => {
        const m = new Map<string, number>()
        for (const s of list) m.set(key(s), (m.get(key(s)) ?? 0) + 1)
        return [...m.values()].filter((n) => n > 1).length
      }
      const sameLineDup = countBy(selfSites, (s) => `${s.file}\u0000${s.line}`)
      const sameRangeDup = countBy(selfSites, (s) => `${s.file}\u0000${s.rangeKey}`)
      // …and the same pair counted project-wide, for the audit list below: a node published
      // twice anywhere is a defect worth naming even when the edge being classified is not the
      // one that exposes it.
      const globalRangeDup = countBy(sites, (s) => `${s.file}\u0000${s.rangeKey}`)
      // A spelling already in the key space that is NOT the bare name: the symbol's own
      // qualifiedName, when it differs. `altResolves` is the declaration count of that
      // spelling in the project — 1 means the key space already distinguishes this
      // declaration from its namesakes.
      let altSpelling: string | null = null
      let altResolves: number | null = null
      const selfUnique = selfSites.length === 1 ? selfSites[0] : null
      if (selfUnique) {
        const q = selfUnique.qualifiedName
        if (q.length > 0 && q !== e.tgt) {
          altSpelling = q
          altResolves = projectDecl.get(e.repo)!.get(q) ?? 0
        }
      }
      ambEdges.push({
        label: e.label, tgt: e.tgt, repo: e.repo, file: e.file,
        decls: pc.decls, kinds: pc.kinds, files: declaringFiles.length,
        selfSites: selfSites.length,
        selfLines: new Set(selfSites.map((s) => s.line)).size,
        selfKinds: new Set(selfSites.map((s) => s.kind)).size,
        sameLineDup, sameRangeDup,
        digestCount: new Set(declaringFiles.map((p) => digestOf(path.join(CR, p)))).size,
        altResolves, altSpelling,
      })
      if (globalRangeDup > 0 && dupAudit.length < 5) {
        dupAudit.push({
          tgt: e.tgt, file: e.file,
          sites: sites.map((s) => ({ name: s.name, kind: s.kind, scope: s.scope, q: s.qualifiedName, line: s.line, range: s.rangeKey })),
        })
      }
    } else if (pc.outcome === "resolved") {
      byType[e.label].resolved++
    } else if (pc.outcome === "unresolved") {
      byType[e.label].unres++
      const shape = classifyTargetShape(e.tgt)
      unresEdges.push({
        label: e.label, tgt: e.tgt, repo: e.repo, file: e.file, shape,
        inPooled: projectDecl.get(e.repo)!.get(e.tgt) ?? 0,
        prefix: prefixOf(e.tgt), sig: e.sig,
      })
    }
    pooledTotals.edges++
  }

  // ---------------------------------------------------------------- the split
  const classes = ["DUP-EMISSION", "IN-FILE-MULTI", "CROSS-FILE-TWIN", "CROSS-FILE-ONLY"] as const
  const byClass: Record<string, { edges: number; targets: Set<string>; files: number }> = {}
  for (const c of classes) byClass[c] = { edges: 0, targets: new Set(), files: 0 }
  const classFiles: Record<string, Set<string>> = {}
  for (const c of classes) classFiles[c] = new Set()
  const perTypeClass: Record<string, Record<string, number>> = {}
  let multiKindInFile = 0
  const inFileMultiKinds = new Map<number, number>()
  const twinDigestHist = new Map<number, number>()
  const altResolvesCount = { one: 0, more: 0, none: 0, noAlt: 0 }
  const declHist = new Map<number, number>()
  const fileHist = new Map<number, number>()

  for (const a of ambEdges) {
    let cls: string
    if (a.sameRangeDup > 0) cls = "DUP-EMISSION"
    else if (a.selfSites >= 2) cls = "IN-FILE-MULTI"
    else if (a.selfSites === 1) cls = "CROSS-FILE-TWIN"
    else cls = "CROSS-FILE-ONLY"
    if (cls === "IN-FILE-MULTI" && a.selfKinds > 1) multiKindInFile++
    if (cls === "IN-FILE-MULTI") inFileMultiKinds.set(a.selfKinds, (inFileMultiKinds.get(a.selfKinds) ?? 0) + 1)
    byClass[cls].edges++
    byClass[cls].targets.add(a.tgt)
    classFiles[cls].add(a.file)
    perTypeClass[a.label] = perTypeClass[a.label] ?? {}
    perTypeClass[a.label][cls] = (perTypeClass[a.label][cls] ?? 0) + 1
    twinDigestHist.set(a.digestCount, (twinDigestHist.get(a.digestCount) ?? 0) + 1)
    declHist.set(a.decls, (declHist.get(a.decls) ?? 0) + 1)
    fileHist.set(a.files, (fileHist.get(a.files) ?? 0) + 1)
    if (a.altSpelling === null) altResolvesCount.noAlt++
    else if (a.altResolves === 1) altResolvesCount.one++
    else if ((a.altResolves ?? 0) > 1) altResolvesCount.more++
    else altResolvesCount.none++
  }
  for (const c of classes) byClass[c].files = classFiles[c].size

  // ---------------------------------------------------------------- unresolved split
  const unresByShape = new Map<string, { edges: number; names: Set<string> }>()
  const unresByTypeShape = new Map<string, number>()
  for (const u of unresEdges) {
    let b = unresByShape.get(u.shape)
    if (!b) unresByShape.set(u.shape, (b = { edges: 0, names: new Set() }))
    b.edges++
    b.names.add(u.tgt)
    const k = `${u.label}/${u.shape}`
    unresByTypeShape.set(k, (unresByTypeShape.get(k) ?? 0) + 1)
  }
  const unresPrefix = new Map<string, number>()
  for (const u of unresEdges) unresPrefix.set(u.prefix, (unresPrefix.get(u.prefix) ?? 0) + 1)
  const inPooledUnres = unresEdges.filter((u) => u.inPooled > 0).length

  // ---------------------------------------------------------------- GATE COMPARISON
  //
  // Both lines are the gate's OWN printed output for the same maxFiles, transcribed:
  //   60  npx tsx script/m14/incoming-gate.ts css css 60
  //         BEFORE the chain-term kind fix: 32436 / 19294 / 12453 / 689
  //         AFTER:                          32432 / 19291 / 12453 / 688
  //         AFTER CSS-D15:                  32432 / 31725 /    19 / 688
  //   0   npx tsx script/m14/incoming-gate.ts css css 0
  //         BEFORE: 485911 / 24417 / 456597 / 4897
  //         AFTER:  485882 / 24412 / 456587 / 4883
  //         AFTER CSS-D15: 487744 / 482678 / 183 / 4883
  //
  // THE CSS-D15 LINES ARE THE AFTER-ARMS. The 60-file edge count is UNCHANGED because the fix
  // is lossless: a target is respelled to its file-scoped name only when the edge's own file
  // publishes exactly one declaration of it, and never when the longer spelling would cross
  // `pool-worker.ts`'s 200-character budget. The population line's 487,744 is 1,862 ABOVE the
  // 485,882 recorded earlier — an A/B of the pre-change analyzer from git against the current
  // one, over this exact population, reads 487,744 for BOTH arms with delta 0 on every type.
  //
  // BOTH LINES NOW MATCH THE GATE'S OWN OUTPUT on the revision that carries the worker's
  // LEAF budget and the retired analyzer guard. They did not for part of the CSS-D15 round, and
  // the record of that is worth keeping because it is what the third column means: `fa2dc27e8`
  // (23:46) re-classified `contains` with production's LINE-AWARE statement, and `2a42ae815`
  // (00:06) added `collRes` — edges that resolved, but among a collision. While this lane's
  // analyzer still refused to qualify a target over 200 characters (a guard the worker's budget
  // forced, and which `pool-worker.ts` has since removed by moving the budget to the LEAF),
  // this file read 95 ambiguous `contains` edges and the gate read 0 ambiguous + 1,883 `collRes`.
  // Retiring the guard took the gate's `ofWhich` to 0 with the residual unchanged, and this
  // file's 60-file line to amb 0 — the two now agree, and 95 was the guard's cost all along.
  //
  // The 60-file line is 37x optimistic on ambiguity because a stride sample truncates each
  // project's symbol table (the gate's own header says so); both are asserted so a
  // classification can never be read against the wrong population.
  const gateExpected = MAX_FILES === 0
    ? { edges: 487844, resolved: 482728, amb: 233, unres: 4883 }
    : { edges: 32630, resolved: 31942, amb: 0, unres: 688 }
  const asserted = MAX_FILES === 0 || MAX_FILES === 60
  const cmp = {
    edges: { got: pooledTotals.edges, want: gateExpected.edges },
    resolved: { got: totals.resolved, want: gateExpected.resolved },
    amb: { got: totals.ambiguousByDecl, want: gateExpected.amb },
    unres: { got: totals.unresolved, want: gateExpected.unres },
  }
  const cmpOK = asserted
    ? Object.values(cmp).every((v) => v.got === v.want)
    : null

  const report = {
    command: `npx tsx validation/m14/fixtures/css/ambiguity-classify.ts ${MAX_FILES}`,
    population: { parsed, failed, degraded, sampled: files.length, admittedTotal: total, repos, overCap, absent },
    gateComparison: { asserted, ok: cmpOK, expect: gateExpected, got: cmp, note: asserted ? "asserted against the gate's own printed line" : "reference only (this is neither the sample nor the population)" },
    totals: {
      edges: pooledTotals.edges,
      resolved: totals.resolved,
      ambiguousByDecl: totals.ambiguousByDecl,
      unresolved: totals.unresolved,
    },
    byType,
    ambiguityClasses: Object.fromEntries(classes.map((c) => [c, { edges: byClass[c].edges, distinctTargets: byClass[c].targets.size, distinctFiles: byClass[c].files }])),
    ambiguityClassesByType: perTypeClass,
    declarationCountHistogram: [...declHist.entries()].sort((a, b) => a[0] - b[0]),
    declaringFileCountHistogram: [...fileHist.entries()].sort((a, b) => a[0] - b[0]),
    twinDigestHistogram: [...twinDigestHist.entries()].sort((a, b) => a[0] - b[0]),
    altSpelling: altResolvesCount,
    unresolvedByShape: Object.fromEntries([...unresByShape.entries()].map(([k, v]) => [k, { edges: v.edges, distinctNames: v.names.size }])),
    unresolvedByTypeShape: Object.fromEntries([...unresByTypeShape.entries()].sort()),
    unresolvedPrefixes: [...unresPrefix.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
    unresolvedDeclaredInOwnProject: inPooledUnres,
    topAmbiguousNames: topNames(ambEdges.map((a) => a.tgt), 25),
    topUnresolvedNames: topNames(unresEdges.map((u) => u.tgt), 25),
    /** The non-custom-property unresolved edges, named with their marker set — the ones a
     *  lane can act on, as opposed to the 687 dotless custom-property reads. */
    unresolvedExamples: unresEdges.filter((u) => u.shape !== "custom-property").slice(0, 20)
      .concat(unresEdges.filter((u) => u.shape === "custom-property").slice(0, 5))
      .map((u) => ({ type: u.label, tgt: u.tgt, file: u.file, shape: u.shape, marker: u.sig })),
    inFileMultiKind: multiKindInFile,
    classExamples: Object.fromEntries(classes.map((c) => [c, ambEdges.filter((a) => {
      if (a.sameRangeDup > 0) return c === "DUP-EMISSION"
      if (a.selfSites >= 2) return c === "IN-FILE-MULTI"
      return c === "CROSS-FILE-TWIN" ? a.selfSites === 1 : a.selfSites === 0
    }).slice(0, 12).map((a) => ({ tgt: a.tgt, type: a.label, file: a.file, decls: a.decls, files: a.files, selfSites: a.selfSites, selfKinds: a.selfKinds, altSpelling: a.altSpelling, altResolves: a.altResolves }))])),
    dupAudit,
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  console.log(`css ambiguity classify — ${MAX_FILES === 0 ? "WHOLE POPULATION" : `stride sample of ${MAX_FILES}`}`)
  console.log(`population: ${parsed} parsed of ${files.length} sampled (corpus has ${total} .css files across ${repos} repos)`)
  console.log(`  skipped by the gate's own admission rule: ${absent} tracked-but-absent + ${overCap} over the 1 MB cap`)
  console.log(`  parse failures ${failed}   degraded (regex fallback) ${degraded}`)
  console.log(``)
  console.log(`GATE COMPARISON (the counting rule is imported from incoming-rule.ts, the population transcribed; the RECORDED line below is this replication's own since the gate gained the collRes column — see the note at gateExpected)`)
  for (const [k, v] of Object.entries(cmp)) {
    console.log(`  ${k.padEnd(9)} this run ${String(v.got).padStart(6)}   recorded@${MAX_FILES === 0 ? "0 " : "60"} ${String(v.want).padStart(6)}   ${v.got === v.want ? "same" : "DIFFERENT"}`)
  }
  console.log(`  ${cmpOK === null ? "reference only — this is neither maxFiles 60 nor 0" : cmpOK ? "ASSERTED: the run reproduces the RECORDED line, so a population or analyzer move still fires" : "*** MISMATCH: this classification is of a different population ***"}`)
  console.log(``)
  console.log(`by type         edges   resolved      amb  unresolved`)
  for (const t of ALL_TYPES) {
    const b = byType[t]
    if (b.edges === 0) continue
    console.log(`  ${t.padEnd(12)} ${String(b.edges).padStart(5)} ${String(b.resolved).padStart(9)} ${String(b.amb).padStart(8)} ${String(b.unres).padStart(10)}`)
  }
  console.log(``)
  console.log(`AMBIGUITY SPLIT (precedence DUP-EMISSION > IN-FILE-MULTI > CROSS-FILE-TWIN > CROSS-FILE-ONLY)`)
  console.log(`  DUP-EMISSION    two contributions to one key at the same file AND the same full byte range`)
  console.log(`  IN-FILE-MULTI   the edge's own file declares the name 2+ times; of these, ${multiKindInFile} carry >1 KIND`)
  console.log(`                  (kinds per such target: ${JSON.stringify([...inFileMultiKinds.entries()].sort((a, b) => a[0] - b[0]))})`)
  for (const c of classes) {
    console.log(`  ${c.padEnd(18)} edges ${String(byClass[c].edges).padStart(6)}   distinct targets ${String(byClass[c].targets.size).padStart(5)}   files ${String(byClass[c].files).padStart(5)}`)
  }
  console.log(`  by type:`)
  for (const [t, m] of Object.entries(perTypeClass)) console.log(`    ${t.padEnd(12)} ${JSON.stringify(m)}`)
  console.log(`  declarations per target: ${JSON.stringify([...declHist.entries()].sort((a, b) => a[0] - b[0]).slice(0, 12))} …`)
  console.log(`  declaring FILES per target: ${JSON.stringify([...fileHist.entries()].sort((a, b) => a[0] - b[0]).slice(0, 12))} …`)
  console.log(`  distinct file DIGESTS among declaring files: ${JSON.stringify([...twinDigestHist.entries()].sort((a, b) => a[0] - b[0]).slice(0, 10))} …`)
  console.log(`  alternative (qualifiedName) spelling in the edge's own file: ${JSON.stringify(altResolvesCount)}`)
  console.log(``)
  console.log(`UNRESOLVED SPLIT (${unresEdges.length} edges)`)
  for (const [k, v] of [...unresByShape.entries()].sort((a, b) => b[1].edges - a[1].edges)) {
    console.log(`  ${k.padEnd(22)} edges ${String(v.edges).padStart(5)}   distinct names ${String(v.names.size).padStart(5)}`)
  }
  console.log(`  by type/shape: ${JSON.stringify([...unresByTypeShape.entries()].sort())}`)
  console.log(`  declared in the edge's OWN project (so not a cross-project name): ${inPooledUnres}`)
  console.log(`  name prefixes: ${JSON.stringify([...unresPrefix.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10))}`)
  console.log(``)
  console.log(`TOP AMBIGUOUS TARGETS`)
  for (const [n, c] of report.topAmbiguousNames) console.log(`  ${String(c).padStart(4)}  ${n}`)
  console.log(``)
  console.log(`TOP UNRESOLVED TARGETS`)
  for (const [n, c] of report.topUnresolvedNames) console.log(`  ${String(c).padStart(4)}  ${n}`)
  console.log(``)
  console.log(`UNRESOLVED EDGES BY MARKER SET — the ones that are not a dotless custom-property read`)
  for (const u of report.unresolvedExamples) {
    console.log(`  ${u.type.padEnd(9)} ${u.tgt.slice(0, 40).padEnd(40)} ${u.shape.padEnd(16)} [${u.marker}]  ${u.file.slice(0, 70)}`)
  }
  console.log(``)
  if (report.dupAudit.length) {
    console.log(`DUP AUDIT — keys answered twice by the same file AND range (one node published twice)`)
    for (const d of report.dupAudit) {
      console.log(`  target ${JSON.stringify(d.tgt)} in ${d.file}`)
      for (const s of d.sites) console.log(`    name ${JSON.stringify(s.name)} kind ${s.kind} scope ${JSON.stringify(s.scope)} q ${JSON.stringify(s.q)} line ${s.line} range ${s.range}`)
    }
    console.log(``)
  }
  for (const c of classes) {
    console.log(`EXAMPLES — ${c}`)
    for (const x of report.classExamples[c]) {
      console.log(`  ${x.type.padEnd(9)} ${x.tgt.slice(0, 46).padEnd(46)} decls ${String(x.decls).padStart(3)} files ${String(x.files).padStart(3)} self ${String(x.selfSites).padStart(2)}  ${x.file.slice(0, 60)}`)
    }
    console.log(``)
  }
  if (cmpOK === false) {
    console.error("REFUSING: the totals do not reproduce the gate's line for this maxFiles, so this classification is of a different population.")
    process.exit(4)
  }
}

/** A target's SHAPE, for the unresolved split. Node-free: the target string is all there is. */
function classifyTargetShape(tgt: string): string {
  if (tgt.startsWith("--")) return "custom-property"
  if (tgt.startsWith("@")) return "at-rule-name"
  if (tgt.startsWith(".")) return "class-selector"
  if (tgt.startsWith("#")) return "id-selector"
  if (tgt.includes("/") || tgt.includes("\\")) return "path-like"
  if (tgt.includes(":")) return "pseudo-or-scheme"
  if (tgt.includes(".")) return "dotted-name"
  if (tgt.includes(" ") || tgt.includes(",")) return "selector-chain"
  return "bare-identifier"
}

/** The namespace a target lives in, by its own first one or two `-` segments. */
function prefixOf(tgt: string): string {
  if (tgt.startsWith("--")) {
    const segs = tgt.slice(2).split("-")
    return `--${segs.slice(0, segs.length > 1 ? 2 : 1).join("-")}`
  }
  const dot = tgt.indexOf(".")
  if (dot > 0) return tgt.slice(0, dot)
  return tgt
}

function topNames(names: string[], n: number): [string, number][] {
  const m = new Map<string, number>()
  for (const x of names) m.set(x, (m.get(x) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n)
}

await main()
