/**
 * PYTHON ONTOLOGY CENSUS — the lane's own instrument, because the shared two
 * cannot measure this lane at all. Measured, not asserted:
 *
 *   script/m14/firing-check.mjs      LANES.PYTHON -> "python-codesql", which does
 *                                    not exist on this disk. The lane key is
 *                                    present and its corpus is absent, so the run
 *                                    prints a row and no number. Verified here:
 *                                    it throws TypeError at firing-check.mjs:64
 *                                    rather than reporting anything.
 *
 *   script/m14/firing-check-v2.mjs   has no PYTHON entry in LANES at all, so
 *                                    `resolveLane("PY_INSTRUMENTS")` returns null
 *                                    and the script exits 2 with "no lane matches".
 *                                    Verified here: exit 2, no table.
 *
 *   script/m14/ontology-coverage-gate.ts   admits corpus only from a top-level dir
 *                                    that is a git checkout (`git rev-parse
 *                                    --git-dir`). `python-corpus/` IS NOT a git
 *                                    checkout — its six children are, and the
 *                                    aggregate is not — so the gate walks 0 python
 *                                    files from it and measures python only from
 *                                    424 stray `.py` files that live inside other
 *                                    languages' repos (swift-corpus 286, haskell 41,
 *                                    otp 32, ruby 20, ...). Measured: 5,982 vs 424,
 *                                    a 14x difference in the population, and a
 *                                    correct number about the wrong population is
 *                                    the shape docs/M14-HONESTY-CONTRACT.md §"Rule:
 *                                    an instrument must declare the population it
 *                                    covered" exists to stop.
 *
 * So this file measures the lane against the corpus that is actually python's, and
 * it derives that population from the DISK (readdir), never from a hand-written
 * list — a hard-coded `FILES = [...]` is a defect the moment a file is added
 * beside it, and it keeps reporting a stale number with total confidence.
 *
 * ## What it measures, per type
 *
 *   EMITTED-or-not  the count, and the FILES — production `parseFile`, not
 *                   `analyze()`, because `analyze()` is not what a consumer calls.
 *   resolved        both endpoints bind to a symbol the same run published. An
 *                   edge can exist and still name nothing; a count hides that.
 *   confident       evidenceClass present, confidence >= 0.7. Below 0.7 is a
 *                   heuristic and is counted separately (honesty contract §4).
 *   R7              no endpoint equal to the placeholder literal `unknown`, no
 *                   empty source, no empty target.
 *
 * ## Grammar-inventory (instrument A)
 *
 * It also enumerates EVERY node type the python grammar actually produces across
 * the corpus. That is the only sound way to answer "does this language have the
 * construct" for a type needing a node type the language does not have: a text
 * search cannot, because it matches comments and string literals.
 *
 * ## No regex
 *
 * Not one. Every construct question is answered by walking the tree-sitter AST.
 * The grammar-inventory map and the tree counters are the instruments; no pattern
 * matching over source text happens anywhere in this file.
 *
 * ## Usage
 *
 *   bun run script/m14/python-ontology-census.ts                 # whole corpus
 *   bun run script/m14/python-ontology-census.ts --files 200     # bounded sample
 *   bun run script/m14/python-ontology-census.ts --json           # machine-readable
 *   bun run script/m14/python-ontology-census.ts --fresh          # re-walk
 */
import { execFileSync } from "node:child_process"
import { appendFileSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

/** The lane's corpus root, and the sub-repos inside it. */
const PY_CORPUS = path.join(CR, "python-corpus")

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes("--json")
const FRESH = argv.includes("--fresh")
const FILES_FLAG = argv.indexOf("--files")
const LIMIT = FILES_FLAG >= 0 ? Number(argv[FILES_FLAG + 1]) || 0 : 0

const ALL_TYPES = [
  "calls",
  "uses",
  "contains",
  "imports",
  "references",
  "exports",
  "extends",
  "implements",
  "overrides",
  "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

// ---------------------------------------------------------------- population
//
// DERIVED, not written. This is the whole point of the file: the shared instruments
// measure 424 python files because they only look at git-tracked top-level dirs, and
// python's real corpus is a non-git aggregate of six git repos. Deriving the list
// from readdir means adding a repo to python-corpus/ is picked up without editing
// this file, which is the defect a hand-written list rots into.

interface Repo {
  name: string
  dir: string
  tracked: string[]
}

/** A directory that answers `git rev-parse --git-dir` is a checkout; else not. */
function isCheckout(dir: string): boolean {
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

function trackedFiles(dir: string): string[] {
  try {
    const raw = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
    return raw.split("\0").filter(Boolean)
  } catch {
    return []
  }
}

function discover(): Repo[] {
  const out: Repo[] = []
  let names: string[]
  try {
    names = readdirSync(PY_CORPUS).sort()
  } catch {
    return out
  }
  for (const name of names) {
    const dir = path.join(PY_CORPUS, name)
    let st
    try {
      st = statSync(dir)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    if (!isCheckout(dir)) continue
    out.push({ name, dir, tracked: trackedFiles(dir) })
  }
  return out
}

interface Population {
  files: string[]
  /** `.py`/`.pyi` present on disk inside a checkout but not TRACKED by git. */
  untracked: number
  /**
   * `.py`/`.pyi` in a directory of the corpus root that is NOT a git checkout.
   *
   * `python-corpus/cpython-stdlib` is 621 files of CPython's own stdlib with no
   * `.git`, so a walk that admits only checkouts silently drops it. That is a real
   * loss for this lane in particular — `abc`, `typing` and `enum` are where
   * Python's interface constructs live — so it is measured, but on a SEPARATE,
   * LABELLED population, because the honesty contract requires corpus commits to
   * be pinned and an unpinned directory cannot be pinned.
   */
  unpinned: { name: string; dir: string; files: string[] }[]
}

function walkDisk(dir: string, out: string[]) {
  let ents: ReturnType<typeof readdirSync>
  try {
    ents = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of ents) {
    if (e.name === ".git") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      walkDisk(p, out)
      continue
    }
    if (!e.name.endsWith(".py") && !e.name.endsWith(".pyi")) continue
    out.push(p)
  }
}

function population(repos: Repo[], root: string): Population {
  const files: string[] = []
  const onDisk: string[] = []
  for (const r of repos) {
    for (const rel of r.tracked) {
      if (!rel.endsWith(".py") && !rel.endsWith(".pyi")) continue
      files.push(path.join(r.dir, rel))
    }
    walkDisk(r.dir, onDisk)
  }
  const trackedAbs = new Set(files)
  const untracked = onDisk.filter((p) => !trackedAbs.has(p)).length

  const unpinned: Population["unpinned"] = []
  for (const name of readdirSync(root).sort()) {
    const dir = path.join(root, name)
    let st
    try {
      st = statSync(dir)
    } catch {
      continue
    }
    if (!st.isDirectory() || isCheckout(dir)) continue
    const f: string[] = []
    walkDisk(dir, f)
    if (f.length) unpinned.push({ name, dir, files: f })
  }
  return { files, untracked, unpinned }
}

const repos = discover()
const pop = population(repos, PY_CORPUS)
const allFiles = pop.files
const unpinnedFiles = pop.unpinned.flatMap((u) => u.files)

if (repos.length === 0) {
  console.error(`python-ontology-census: no git checkout under ${PY_CORPUS}`)
  console.error(`Either the corpus is absent, or it is not a set of checkouts. Both are`)
  console.error(`"unmeasured", which is NOT the same as a zero, so this refuses to print one.\n`)
  process.exit(2)
}

// ---------------------------------------------------------------- sample
//
// Deterministic stride, so the sample is reproducible on another machine and does
// not depend on a PRNG seed. A count nobody can reproduce is a number nobody can
// check, which is what this file exists to replace.
let sample = allFiles
let sampledByLimit = false
if (LIMIT > 0 && allFiles.length > LIMIT) {
  const stride = Math.max(1, Math.floor(allFiles.length / LIMIT))
  const picked: string[] = []
  for (let i = 0; i < allFiles.length && picked.length < LIMIT; i += stride) picked.push(allFiles[i])
  sample = picked
  sampledByLimit = true
}

// ---------------------------------------------------------------- walk
//
// WHY THIS DOES NOT USE `script/m14/resumable-walk.ts`, which the header of that
// file says is the fleet's crash-safe walk. That walk records only WHICH files it
// covered, so a resumed run skips them — and its TALLIES are gone with the dead
// process. Re-running this census at a different --files therefore reported every
// type as `silent`, at 100.0% walked, with zero edges. Measured here before this
// was changed: `--files 8` after `--files 40` printed `calls silent 0 0` under a
// header reading `walk: 8/8 (100.0%)`.
//
// That is the worst possible shape for a verification instrument: a complete,
// confident, wrong report. A resumed walk that prints the same number as a
// complete one would be the defect docs/M14-HONESTY-CONTRACT.md exists to end;
// this one printed ZERO.
//
// So the tally is persisted, not the visit. Each file's contribution is one NDJSON
// line appended BEFORE the next file starts, and the aggregate is rebuilt from
// those lines on every run. A kill costs at most the in-flight file; a resume
// reports the same numbers a complete run would.
const TALLY = "validation/m14/measurements/walk-python-ontology.ndjson"
if (FRESH) {
  try {
    unlinkSync(TALLY)
  } catch {
    /* nothing to remove */
  }
}

interface FileTally {
  f: string
  ok: boolean
  degraded: boolean
  sym: number
  rel: number
  imp: number
  err: number
  /** Symbol-level standing-rule counters, carried per file so a resumed run reports them too. */
  esn: number
  euk: number
  /** Labels outside the ten ontology types, per file. */
  off: Record<string, number>
  /** type -> per-type counters */
  t: Record<string, Partial<TypeRow> & { ex?: string[] }>
  names: string[]
}

type TypeRow = {
  edges: number
  files: number
  bothEndsResolve: number
  sourcePublished: number
  targetPublished: number
  belowConfidence07: number
  confidenceSum: number
  evidenceClassPresent: number
  reasonCodePresent: number
  emptyEndpoint: number
  placeholderEndpoint: number
  /** Any endpoint whose VALUE is the literal `unknown`, before the tree check. */
  unknownLiteralEndpoint: number
  /** Target resolvable through THIS file's own imports[] — see PY-INSTR-4. */
  targetImported: number
  /** Neither declared here nor imported here: needs a cross-file route or nothing. */
  targetUnaccounted: number
  byReasonCode: Record<string, number>
  examples: string[]
  /** Three corpus-relative FILES (not directories) this type fired in, for the record. */
  files_seen?: string[]
}

const rows = new Map<Type, TypeRow>()
for (const t of ALL_TYPES) {
  rows.set(t, {
    edges: 0,
    files: 0,
    bothEndsResolve: 0,
    sourcePublished: 0,
    targetPublished: 0,
    belowConfidence07: 0,
    confidenceSum: 0,
    evidenceClassPresent: 0,
    reasonCodePresent: 0,
    emptyEndpoint: 0,
    placeholderEndpoint: 0,
    unknownLiteralEndpoint: 0,
    targetImported: 0,
    targetUnaccounted: 0,
    byReasonCode: {},
    examples: [],
  })
}

const fileSets = new Map<Type, Set<string>>()
for (const t of ALL_TYPES) fileSets.set(t, new Set<string>())

/** Off-ontology labels the analyzer produced, so an off-enum literal cannot hide. */
const offOntology = new Map<string, number>()

let parsed = 0
let parseFailures = 0
let degraded = 0
const degradedFiles: string[] = []
let symbolsTotal = 0
let relsTotal = 0
let importsChannel = 0
let filesWithImports = 0
let emptySymbolNames = 0
let emptyOrUnknownKind = 0
let errorNodes = 0
let errorFiles = 0

/** Rebuild the aggregate from every tally already on disk. */
function absorb(row: FileTally) {
  if (!row.ok) {
    parseFailures++
    return
  }
  parsed++
  if (row.degraded) {
    degraded++
    if (degradedFiles.length < 10) degradedFiles.push(row.f)
  }
  symbolsTotal += row.sym
  relsTotal += row.rel
  importsChannel += row.imp
  if (row.imp > 0) filesWithImports++
  errorNodes += row.err
  if (row.err > 0) errorFiles++
  emptySymbolNames += row.esn ?? 0
  emptyOrUnknownKind += row.euk ?? 0
  for (const [k, n] of Object.entries(row.off ?? {})) offOntology.set(k, (offOntology.get(k) ?? 0) + n)
  const published = new Set(row.names)
  for (const s of row.names) published.add(s)
  for (const [t, v] of Object.entries(row.t)) {
    const r = rows.get(t as Type)
    if (!r) continue
    r.edges += v.edges ?? 0
    r.bothEndsResolve += v.bothEndsResolve ?? 0
    r.sourcePublished += v.sourcePublished ?? 0
    r.targetPublished += v.targetPublished ?? 0
    r.belowConfidence07 += v.belowConfidence07 ?? 0
    r.confidenceSum += v.confidenceSum ?? 0
    r.evidenceClassPresent += v.evidenceClassPresent ?? 0
    r.reasonCodePresent += v.reasonCodePresent ?? 0
    r.emptyEndpoint += v.emptyEndpoint ?? 0
    r.placeholderEndpoint += v.placeholderEndpoint ?? 0
    r.unknownLiteralEndpoint += v.unknownLiteralEndpoint ?? 0
    r.targetImported += v.targetImported ?? 0
    r.targetUnaccounted += v.targetUnaccounted ?? 0
    for (const [k, n] of Object.entries(v.byReasonCode ?? {})) r.byReasonCode[k] = (r.byReasonCode[k] ?? 0) + (n as number)
    // PY-INSTR-1. This added `path.basename(path.dirname(row.f))` — the PARENT DIRECTORY's
    // name, not the file's. So the per-type `files` column reported distinct directories:
    // `calls 243619 edges in 560 files` was 560 DIRECTORIES spread over thousands of files.
    // A correct count about the wrong population, which is the shape
    // docs/M14-HONESTY-CONTRACT.md's "Rule: an instrument must declare the population it
    // covered" exists to stop, committed by the very instrument written to enforce it.
    // The tally is keyed by the file's own path, so the fix is free: the NDJSON already
    // holds every row and the aggregate is rebuilt from it on each run.
    if ((v.edges ?? 0) > 0) {
      fileSets.get(t as Type)!.add(row.f)
      const rel = row.f.replace(PY_CORPUS + "/", "")
      if (!r.files_seen) r.files_seen = []
      if (r.files_seen.length < 3) r.files_seen.push(rel)
    }
    if (r.edges > 0) for (const ex of v.ex ?? []) if (r.examples.length < 3) r.examples.push(ex)
  }
}

const seenFiles = new Set<string>()
if (!FRESH) {
  let prior = ""
  try {
    prior = readFileSync(TALLY, "utf8")
  } catch {
    prior = ""
  }
  for (const line of prior.split("\n")) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line) as FileTally
      seenFiles.add(row.f)
      absorb(row)
    } catch {
      // A truncated final line is what a kill mid-append leaves behind. Dropping one
      // partial record costs one re-walk; refusing to start costs the whole run.
    }
  }
}

async function measureFile(file: string): Promise<FileTally> {
  const empty: FileTally = { f: file, ok: false, degraded: false, sym: 0, rel: 0, imp: 0, err: 0, esn: 0, euk: 0, off: {}, t: {}, names: [] }
  let r: any
  try {
    r = await parseFile(file, path.dirname(file))
  } catch {
    return empty
  }
  if (!r) return empty

  const symbols: any[] = Array.isArray(r.symbols) ? r.symbols : []
  const rels: any[] = Array.isArray(r.relationships) ? r.relationships : []
  // The imports channel is SEPARATE from relationships (ParseResult, src/ast/types.ts)
  // and parallel-indexer persists it to the brain_import TABLE. Reported, never
  // folded into the relationship tally — that conflation is the defect
  // firing-check.mjs has.
  const imps: any[] = Array.isArray(r.imports) ? r.imports : []

  const published = new Set<string>()
  let esn = 0
  let euk = 0
  for (const s of symbols) {
    const n = String(s?.name ?? "")
    const k = String(s?.kind ?? "")
    if (n.length === 0) esn++
    if (k.length === 0 || k === "unknown") euk++
    if (n.length > 0) {
      published.add(n)
      const q = String(s?.qualifiedName ?? "")
      if (q.length > 0) published.add(q)
      const o = String(s?.ownerName ?? "")
      if (o.length > 0) published.add(`${o}.${n}`)
    }
  }

  /**
   * PY-INSTR-4. The three-way resolution split, because "the target was not published
   * by THIS file" conflates two different things and the difference is the whole
   * question.
   *
   * A `calls` edge to `json.dumps` names a symbol this file has not read — but it has
   * READ that it imported `json`, so the name resolves through the imports channel. An
   * edge whose target is neither declared here nor imported here is a name the graph
   * has to resolve across some other route (a re-export, a `globals()` lookup, a
   * metaclass registration) or not at all.
   *
   * Reporting one combined number — the first version of this census printed `calls`
   * both-ends-resolve at 10.9% with no denominator for what the other 89% is — reads
   * as a resolution defect when most of it is ordinary cross-file traffic. So the
   * three buckets are counted separately, and the imported names come from the SAME
   * run's `imports[]`.
   */
  const importedNames = new Set<string>()
  for (const im of imps) {
    const mod = String(im?.module ?? "")
    if (mod.length === 0) continue
    // `import os` binds `os`; `import a.b.c` binds `a`; `from m import X[, Y]` binds
    // each item, and `from m import *` binds everything in m (unresolvable by name).
    const rootLeaf = mod.split(".")[0]
    if (rootLeaf.length > 0) importedNames.add(rootLeaf)
    for (const it of Array.isArray(im?.items) ? im.items : []) {
      const t = String(it ?? "")
      if (t.length === 0 || t === "*") continue
      importedNames.add(t)
      const dot = t.lastIndexOf(".")
      if (dot > 0) importedNames.add(t.slice(dot + 1))
    }
  }

  // PY-INSTR-3. `error nodes: 0 in 0 files` over 5,365 real Django/Ansible files was
  // this census reading NOTHING, not the corpus being clean.
  //
  // It walked `r.tree?.rootNode`, and `pool-worker.parseFile`'s `ret` object has no
  // `tree` key — it carries `errors`, `symbols`, `relationships`, `imports` and
  // `metadata`, and nothing else. So `visitErr(undefined)` returned immediately, every
  // file counted zero error nodes, and the header printed a clean 0 with the same
  // confidence as a real measurement. A parse-health figure that cannot fail is worse
  // than no figure, because `parseErrors` is one of the things the differential and the
  // lane doc both report.
  //
  // The count now comes from `errors`, which is the analyzer's OWN production-visible
  // parse-error channel (`ctx.errors`, populated from `node.type === "ERROR"` and
  // missing nodes) — i.e. the signal a consumer actually receives.
  const errList: any[] = Array.isArray(r.errors) ? r.errors : []
  const errNodes = errList.length

  // R7's placeholder test needs the TREE, and the tree is not on `ret` either. So it is
  // asked directly, and only for the files that actually carry an `unknown` endpoint —
  // 2 of 5,365 measured — so the second parse costs nothing on the population.
  //
  // Why the check exists at all: a value comparison alone convicts a REAL name. Both of
  // this lane's `unknown` endpoints are true attribute reads —
  //   django/tests/admin_views/admin.py:1032          return obj.unknown
  //   pydantic-core/tests/validators/test_uuid.py:235  ... is SafeUUID.unknown
  // and `unknown` is the attribute's own name in the source. Reporting those as R7
  // violations would put a fabricated defect in the report.
  let treeHasUnknownName: boolean | null = null
  const treeKnowsUnknown = async (): Promise<boolean> => {
    if (treeHasUnknownName !== null) return treeHasUnknownName
    try {
      const { getParser } = await import("../../src/ast/engine")
      const p = await getParser("python")
      const content = readFileSync(file, "utf8")
      const pr = await p.parse(content, file)
      let found = false
      const visit = (n: any): void => {
        if (!n || found) return
        if (n.type === "identifier" && n.text === "unknown") {
          found = true
          return
        }
        if (n.type === "attribute") {
          const leaf = n.namedChild(n.namedChildCount - 1)
          if (leaf && leaf.type === "identifier" && leaf.text === "unknown") {
            found = true
            return
          }
        }
        for (let k = 0; k < n.namedChildCount; k++) visit(n.namedChild(k))
      }
      visit(pr.rootNode)
      treeHasUnknownName = found
    } catch {
      // If the tree cannot be read the honest answer is "not established", and the
      // caller then reports the literal count WITHOUT claiming a violation.
      treeHasUnknownName = false
    }
    return treeHasUnknownName
  }

  // Does any edge in this file carry the literal at all? Decided before the loop so the
  // tree is consulted at most once per file, and only when there is something to decide.
  let sawUnknownLiteral = false
  for (const e of rels) {
    const src0 = String(e?.source ?? e?.fromSymbol ?? "")
    const tgt0 = String(e?.target ?? e?.toSymbol ?? "")
    if (src0 === "unknown" || tgt0 === "unknown") {
      sawUnknownLiteral = true
      break
    }
  }
  const unknownIsRealName = sawUnknownLiteral ? await treeKnowsUnknown() : false

  const offOntologyInFile = new Map<string, number>()
  const per: FileTally["t"] = {}
  const bump = (t: Type, k: keyof TypeRow) => {
    const row = (per[t] ??= { byReasonCode: {} }) as any
    row[k] = (row[k] ?? 0) + 1
  }
  for (const e of rels) {
    const label = String(e?.type ?? e?.relationshipType ?? "(empty)")
    const t = label.toLowerCase() as Type
    if (!ALL_TYPES.includes(t)) {
      offOntologyInFile.set(label, (offOntologyInFile.get(label) ?? 0) + 1)
      continue
    }
    bump(t, "edges")
    const src = String(e?.source ?? e?.fromSymbol ?? "")
    const tgt = String(e?.target ?? e?.toSymbol ?? "")
    if (src.length === 0 || tgt.length === 0) bump(t, "emptyEndpoint")
    // R7: the placeholder literal, compared as an exact VALUE, and then CONFIRMED
    // against the tree. See PY-INSTR-2 above for why a bare value test is not enough:
    // `obj.unknown` is a real attribute read, not a placeholder.
    if (src === "unknown" || tgt === "unknown") {
      bump(t, "unknownLiteralEndpoint")
      if (!unknownIsRealName) bump(t, "placeholderEndpoint")
    }
    if (published.has(src)) bump(t, "sourcePublished")
    if (published.has(tgt)) bump(t, "targetPublished")
    if (published.has(src) && published.has(tgt)) bump(t, "bothEndsResolve")
    // PY-INSTR-4: the target falls into exactly one of three buckets, so the report can
    // separate "external but declared by an import this file wrote" from "nothing here
    // accounts for it".
    const tgtDeclared = published.has(tgt)
    const tgtImported = importedNames.has(tgt)
    if (!tgtDeclared) {
      if (tgtImported) bump(t, "targetImported")
      else bump(t, "targetUnaccounted")
    }
    const conf = Number(e?.confidence ?? 0)
    ;(per[t] as any).confidenceSum = ((per[t] as any).confidenceSum ?? 0) + conf
    if (conf < 0.7) bump(t, "belowConfidence07")
    const ec = e?.metadata?.evidenceClass ?? e?.evidenceClass
    if (ec !== undefined && ec !== null && String(ec).length > 0) bump(t, "evidenceClassPresent")
    const rc = e?.metadata?.reasonCode
    if (rc !== undefined && rc !== null && String(rc).length > 0) {
      bump(t, "reasonCodePresent")
      const rcRow = per[t] as any
      rcRow.byReasonCode[String(rc)] = (rcRow.byReasonCode[String(rc)] ?? 0) + 1
    }
    const row = per[t] as any
    if (!row.ex) row.ex = []
    if (row.ex.length < 3) row.ex.push(`${file.replace(PY_CORPUS + "/", "")}:${e?.line_number ?? "?"} ${src} -> ${tgt}`)
  }

  return {
    f: file,
    ok: true,
    degraded: r.fallback === true,
    sym: symbols.length,
    rel: rels.length,
    imp: imps.length,
    err: errNodes,
    esn,
    euk,
    off: Object.fromEntries(offOntologyInFile),
    t: per,
    names: [...published],
  }
}

// Sequential on purpose. `parseFile` was measured nondeterministic under
// concurrency — resolveWasm's shared temp path gave concurrent readers a truncated
// grammar, and parseFile's catch silently substituted a regex extractor (see
// firing-check.ts's determinism note). A degraded file returns FEWER edges with no
// error, so a concurrent walk produces a number about a mixture. Sequential is
// slower and its number is about the analyzer.
let newlyWalked = 0
for (const file of sample) {
  if (seenFiles.has(file)) continue
  let tally: FileTally
  try {
    tally = await measureFile(file)
  } catch {
    tally = { f: file, ok: false, degraded: false, sym: 0, rel: 0, imp: 0, err: 0, esn: 0, euk: 0, off: {}, t: {}, names: [] }
  }
  appendFileSync(TALLY, `${JSON.stringify(tally)}\n`)
  seenFiles.add(file)
  newlyWalked++
  absorb(tally)
}

const walkStats = {
  total: sample.length,
  alreadyDone: sample.length - newlyWalked,
  walked: newlyWalked,
  skippedBad: parseFailures,
  partial: false,
  checkpoint: TALLY,
}

for (const t of ALL_TYPES) rows.get(t)!.files = fileSets.get(t)!.size

// ---------------------------------------------------------------- grammar inventory (instrument A)
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({
  locateFile: () => path.join(import.meta.dirname ?? ".", "..", "..", "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(import.meta.dirname ?? ".", "..", "..", "wasm", "tree-sitter-python.wasm"))))

const grammarNodeTypes = new Map<string, number>()
const grammarFiles = sample.length
let grammarParsed = 0
for (const f of sample) {
  let text: string
  try {
    text = readFileSync(f, "utf8")
  } catch {
    continue
  }
  let t: any
  try {
    t = parser.parse(text)
  } catch {
    continue
  }
  if (!t) continue
  grammarParsed++
  const v = (n: any) => {
    grammarNodeTypes.set(n.type, (grammarNodeTypes.get(n.type) ?? 0) + 1)
    for (let i = 0; i < n.childCount; i++) v(n.child(i))
  }
  v(t.rootNode)
  t.delete?.()
}

// ---------------------------------------------------------------- report
const walkedPct = walkStats.total === 0 ? 0 : ((walkStats.walked + walkStats.alreadyDone) / walkStats.total) * 100

if (!JSON_OUT) {
  console.log(`python ontology census`)
  console.log(`corpus root:   ${PY_CORPUS}`)
  console.log(`checkouts:     ${repos.length}  (${repos.map((r) => `${r.name}=${r.tracked.filter((f) => f.endsWith(".py") || f.endsWith(".pyi")).length}`).join(" ")})`)
  console.log(`POPULATION:    ${allFiles.length} tracked .py/.pyi in ${repos.length} checkouts  (${pop.untracked} on disk but untracked, excluded)`)
  for (const u of pop.unpinned) {
    console.log(`UNPINNED:      ${u.files.length} files in ${u.name}/ — NOT a git checkout, so NOT in the pinned population above. Measured separately below.`)
  }
  console.log(`SAMPLE:        ${sample.length}${sampledByLimit ? ` (stride-limited from ${allFiles.length})` : " (the whole population)"}`)
  console.log(`walk:          ${walkStats.walked + walkStats.alreadyDone}/${walkStats.total} (${walkedPct.toFixed(1)}%)  new ${walkStats.walked}, resumed ${walkStats.alreadyDone}, bad ${walkStats.skippedBad}`)
  if (walkStats.partial) console.log(`               PARTIAL — every count below is over ${walkedPct.toFixed(1)}% of the sample.`)
  console.log(`parsed:        ${parsed}/${sample.length}   parseFailures ${parseFailures}   degraded(fallback) ${degraded}`)
  if (degradedFiles.length) console.log(`               degraded files: ${degradedFiles.join(", ")}`)
  console.log(`symbols:       ${symbolsTotal}   relationships ${relsTotal}`)
  console.log(`imports[]:     ${importsChannel} in ${filesWithImports} files  (SEPARATE channel — brain_import TABLE, never a brain_relationship row)`)
  console.log(`grammar:       ${grammarNodeTypes.size} distinct node types over ${grammarParsed} parsed files`)
  console.log(`error nodes:   ${errorNodes} in ${errorFiles} files`)
  console.log()

  const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
  console.log(`type          verdict   edges    files  both-ends  <0.7    evClass  empty  ph  unk   examples`)
  console.log("-".repeat(150))
  for (const t of ALL_TYPES) {
    const r = rows.get(t)!
    const verdict = r.edges > 0 ? "EMITTED" : "silent"
    console.log(
      `${pad(t, 14)}${pad(verdict, 10)}${pad(String(r.edges), 9)}${pad(String(r.files), 7)}` +
        `${pad(`${r.bothEndsResolve}`, 11)}${pad(String(r.belowConfidence07), 7)}${pad(String(r.evidenceClassPresent), 9)}` +
        `${pad(String(r.emptyEndpoint), 6)}${pad(String(r.placeholderEndpoint), 4)}${pad(String(r.unknownLiteralEndpoint), 5)}` +
        `${r.examples[0] ?? ""}`,
    )
  }
  console.log()
  for (const t of ALL_TYPES) {
    const r = rows.get(t)!
    if (r.edges === 0) continue
    const avg = r.confidenceSum / r.edges
    const pct = (n: number) => `${n} (${((n / r.edges) * 100).toFixed(1)}%)`
    console.log(`${t}: mean confidence ${avg.toFixed(3)}  src declared-in-file ${pct(r.sourcePublished)}  reasonCode ${r.reasonCodePresent}/${r.edges}  ${JSON.stringify(r.byReasonCode)}`)
    console.log(`    TARGET RESOLUTION over ${r.edges}: declared in this file ${pct(r.targetPublished)}  |  not declared, but this file IMPORTS the name ${pct(r.targetImported)}  |  neither ${pct(r.targetUnaccounted)}`)
    if (r.files_seen?.length) console.log(`    fired in ${r.files} files, e.g. ${r.files_seen.join(", ")}`)
    for (const e of r.examples) console.log(`    ${e}`)
  }
  if (offOntology.size) console.log(`\nOFF-ONTONETYPE labels emitted: ${[...offOntology.entries()].map(([k, n]) => `${k}:${n}`).join("  ")}`)
  console.log(`\nstanding rules: emptySymbolNames ${emptySymbolNames}  emptyOrUnknownKind ${emptyOrUnknownKind}`)
  console.log(`R7 placeholders: ${[...rows.values()].reduce((a, r) => a + r.placeholderEndpoint, 0)}  of ${[...rows.values()].reduce((a, r) => a + r.unknownLiteralEndpoint, 0)} endpoints whose VALUE is the literal \`unknown\` (the rest are real attribute names in the source — see PY-INSTR-3)`)
  console.log(`\ngrammatically these node types EXIST in python across this sample (instrument A):`)
  const sorted = [...grammarNodeTypes.entries()].sort((a, b) => b[1] - a[1])
  console.log(`  ${sorted.slice(0, 60).map(([k, n]) => `${k}(${n})`).join(" ")}`)
  console.log(`\n  total distinct: ${grammarNodeTypes.size}`)
} else {
  const out: Record<string, any> = {
    corpusRoot: PY_CORPUS,
    checkouts: repos.map((r) => r.name),
    populationTracked: allFiles.length,
    populationUntrackedOnDisk: pop.untracked,
    unpinnedPopulation: pop.unpinned.map((u) => ({ name: u.name, files: u.files.length })),
    sample: sample.length,
    sampleLimited: sampledByLimit,
    parsed,
    parseFailures,
    degraded,
    symbols: symbolsTotal,
    relationships: relsTotal,
    importsChannel,
    filesWithImports,
    errorNodes,
    errorFiles,
    emptySymbolNames,
    emptyOrUnknownKind,
    walk: walkStats,
    types: Object.fromEntries(ALL_TYPES.map((t) => [t, rows.get(t)!])),
    offOntology: Object.fromEntries(offOntology),
    grammarNodeTypes: Object.fromEntries(grammarNodeTypes),
  }
  console.log(JSON.stringify(out, null, 1))
}