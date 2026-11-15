/**
 * AMBIGUITY SPLIT — why a target name binds to more than one published symbol.
 * ------------------------------------------------------------------------
 * The round brief asks for the split, and this file exists to produce it with numbers:
 *
 *   1. targets ambiguous because N declarations share a name in DIFFERENT SCOPES
 *      (a real scoping failure this lane may be able to repair);
 *   2. targets ambiguous because a name is declared in >1 table/module and the
 *      analyzer does not model which one is in scope;
 *   3. targets ambiguous because two different symbols LEGITIMATELY share a published
 *      name — the published name is not a unique identifier.
 *
 * Only 1 and 2 are repairable inside this lane. 3 is a property of the published-name
 * contract and is reported, not fixed.
 *
 * ## The measurement that makes the fleet's number wrong in a specific way
 *
 * `script/m14/incoming-check.ts` reports `ambiguousTargets` for every lane, and the
 * fleet-wide sweep put **julia at 4,249 ambiguous / 19,281 unresolved** over 600 files.
 * That column is computed as
 *
 *     const hits = published.get(tgt)      // published: Map<name, KIND[]>
 *     if (hits.length > 1) row.ambiguousTargets++
 *
 * where `published` accumulates only the DISTINCT KINDS a name was published under. So
 * the fleet column answers "does this name carry more than one kind", and the reverse
 * walk's actual question is "does this name carry more than one symbol".
 *
 * Those differ wherever two same-kind symbols share a name — a `property` named `name`
 * declared in two files of one package, two `function`s both named `main`. A reverse
 * walk keyed on `target_symbol_id` still has to pick one of them, so those edges are
 * ambiguous in the sense that matters and read 0 in the fleet column.
 *
 * This file therefore reports BOTH figures side by side and never substitutes one for
 * the other:
 *
 *   `ambKind`  — distinct kinds > 1            (incoming-check's definition, comparable)
 *   `ambSym`   — distinct published symbols > 1 (the reverse walk's actual problem)
 *
 * `ambSym - ambKind` is the population the fleet column cannot see. If that gap is
 * large, the fleet table is a floor and every lane's row inherits the same understatement.
 *
 * ## The three buckets, operationally
 *
 * For an edge whose target NAME binds to >1 published symbol, with `hit` the symbol list:
 *
 *   B1  distinct FILES == 1 and distinct `ownerName` > 1
 *       — one file, two enclosing scopes. The analyzer knows the owner on the SYMBOL and
 *         publishes neither it in `qualifiedName` nor on the edge, so the collision is
 *         information the analyzer has and throws away. REPAIRABLE.
 *
 *   B2  distinct FILES  > 1 and distinct REPOS == 1
 *       — one package, several modules declaring the name; the referring file's
 *         `using`/`import` set says which module is in scope and the analyzer does not
 *         consult it. REPAIRABLE (in principle).
 *
 *   B3a distinct FILES  > 1 and distinct REPOS  > 1
 *       — the name is declared independently in packages that do not know each other.
 *         No in-scope rule exists that could pick one: within any one package the target
 *         is unique, and the corpus-wide name table is what collides. NOT repairable by
 *         the analyzer; it is the shape of a multi-package corpus.
 *
 *   B3b distinct FILES == 1 and distinct `ownerName` == 1
 *       — two or more declarations under one name in one scope. Split further:
 *         `struct X … end` + `X(…)` publish two symbols for ONE Julia binding (the type
 *         object is callable), and `x::Int = 1` + `x() = 1` are two declarations that
 *         merely share a spelling. Neither is a scoping failure. NOT repairable here.
 *
 * `ownerName` is read off the published symbol, never inferred: `parseFile` emits it for
 * every member of a `module` block, and this lane's doc records that 71.9% of corpus
 * files have no `module` block at all, so a null owner is the common case and is
 * normalised to "" rather than treated as a distinct scope.
 *
 * ## WHY TREE/PUBLISHED DATA, NOT TEXT
 *
 * Everything here comes from `parseFile` output — symbols and relationships as the
 * production pipeline publishes them. No regex, no source-text scan: a comment or a
 * string literal can contain any of these names, and a text match would report a
 * collision that the language does not have.
 *
 * ## POPULATION AND SAMPLING — stated, because the fleet number is not reproducible here
 *
 * The fleet sweep's file selection was never committed (the commit `a7a5debfc` adds the
 * .tsv and a prose block, and no script), so 4,249 cannot be re-derived by replaying it.
 * This file takes a DETERMINISTIC sample instead: the admitted files sorted by
 * `repo/rel`, then a uniform stride over that order, which gives every repository a share
 * proportional to its file count. The stride, the sample size, the per-repository counts
 * and a hash of the exact file list are all printed, so a reader can rebuild the identical
 * set. Before/after numbers in this lane are always taken on THIS sample with THIS
 * method, and are comparable to each other; they are not claimed equal to the fleet's.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/julia/ambiguity-split.ts [--files 600] [--json out.json]
 *
 * READ-ONLY with respect to the corpus. Writes a parse cache under /tmp and nothing else.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

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

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const numArg = (flag: string, dflt: number): number => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : dflt
}
const SAMPLE = numArg("--files", 600)
const jsonIdx = argv.indexOf("--json")
const jsonOut = jsonIdx >= 0 ? argv[jsonIdx + 1] : null
const MAX_BYTES = 512 * 1024

// ------------------------------------------------------------------ corpus admission
// Identical to census.ts / unresolved-split.ts: git-tracked, .jl, <=512KB, and the
// production detector agrees. A file admitted by a different rule is a different population.
interface Admitted {
  repo: string
  rel: string
  abs: string
  dir: string
  bytes: number
  mtimeMs: number
}
const admitted: Admitted[] = []
let reposSeen = 0
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  reposSeen++
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    if (!rel.endsWith(".jl")) continue
    const abs = path.join(dir, rel)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(abs)
      if (st.size > MAX_BYTES) continue
      const text = readFileSync(abs, "utf8")
      if (detectLanguageFromPath(abs, text) !== "julia") continue
    } catch {
      continue
    }
    admitted.push({ repo: e, rel, abs, dir, bytes: st.size, mtimeMs: st.mtimeMs })
  }
}
admitted.sort((a, b) => {
  const x = `${a.repo}/${a.rel}`
  const y = `${b.repo}/${b.rel}`
  return x < y ? -1 : x > y ? 1 : 0
})
const corpusHash = createHash("sha256")
  .update(admitted.map((f) => `${f.repo}/${f.rel}:${f.bytes}`).join("\n"))
  .digest("hex")
  .slice(0, 16)

// Uniform stride over the sorted admission order. Deterministic, and every repository is
// represented in proportion to its file count.
//
// `--order first` takes the first N instead, which is the rule the fleet-wide sweep used:
// recovered by measurement, not guessed. On this corpus the fleet's published julia row
// (4,249 ambiguous / 19,281 unresolved at 600 files, `a7a5debfc`) is reproduced by
// `script/m14/incoming-check.ts` on the first 600 sorted files to within 61 ambiguous
// (1.4%) and 6 unresolved (0.03%), while the stride-600 sample gives 10,828 and 27,735 —
// 2.5x and 1.4x the fleet figures. A stride sample and a prefix sample of the SAME corpus
// at the SAME size are not the same measurement, so both are runnable here and every
// before/after pair in this lane names which one it used.
const ORDER = argv.includes("--order") ? argv[argv.indexOf("--order") + 1] : "stride"
const stride = Math.max(1, Math.floor(admitted.length / SAMPLE))
const sample: Admitted[] = []
if (ORDER === "first") {
  for (let i = 0; i < admitted.length && sample.length < SAMPLE; i++) sample.push(admitted[i])
} else {
  for (let i = 0; i < admitted.length && sample.length < SAMPLE; i += stride) sample.push(admitted[i])
}
const sampleHash = createHash("sha256")
  .update(sample.map((f) => `${f.repo}/${f.rel}`).join("\n"))
  .digest("hex")
  .slice(0, 16)
const perRepo: Record<string, number> = {}
for (const f of sample) perRepo[f.repo] = (perRepo[f.repo] ?? 0) + 1

// ------------------------------------------------------------------ phase one: parse
interface PubSym {
  name: string
  kind: string
  owner: string
  line: number
}
interface Rel {
  source: string
  target: string
  type: string
  line: number
}
interface FileRow {
  label: string
  repo: string
  degraded: boolean
  /** Set only by `BB_JULIA_FAULT_INJECT`; a row whose degradation is not real. Never in a record. */
  faultInjected?: boolean
  threw: boolean
  syms: PubSym[]
  rels: Rel[]
}

const analyzerHash = (() => {
  try {
    return createHash("sha256")
      .update(readFileSync(path.join(process.cwd(), "src/ast/real-julia-analyzer.ts")))
      .digest("hex")
      .slice(0, 12)
  } catch {
    return "unknown"
  }
})()
/**
 * Worker width, hoisted to module scope so the CACHE KEY and the JSON RECORD can see it.
 *
 * Measured 2026-10-05 on this file's own sample (600 files, stride 3, sampleHash
 * 1c76a52a3ba9c16c, corpus 1,985 files / 199 repositories):
 *
 *   width 1 -> 600 good, 0 degraded, 10,681 symbols, 70,959 edges, 19,938 ambSym, 27,735 unresolved
 *   width 4 -> 599 good, 1 degraded, 10,656 symbols, 70,702 edges, 19,801 ambSym, 27,636 unresolved
 *
 * The degraded file is `julia/stdlib/LibGit2/src/repository.jl`, and the population moves by
 * 257 edges and 137 ambiguous targets. At the width this file used to default to, EVERY number
 * it publishes was a function of whether one probabilistic parse degraded -- the same trap
 * `script/m14/ontology-coverage-gate.ts` has (lane doc section 8, rows 2 and 13).
 *
 * Three consequences, all three fixed here rather than left to the reader:
 *   1. the width is part of the cache key, so a degraded width-N parse can never be replayed
 *      as a clean width-1 claim (the old key was analyzer hash + file mtimes only);
 *   2. the width is recorded in the artifact, because a count whose population depends on a
 *      worker count the artifact does not carry is not reproducible;
 *   3. a degraded population exits 3 instead of printing a complete table, because every
 *      number downstream of this file is quoted as a whole-population figure.
 */
const WIDTH = Number(process.env.BB_JULIA_WORKERS ?? 1)
const ALLOW_DEGRADED = process.argv.includes("--allow-degraded")
/** `BB_JULIA_FAULT_INJECT=N` forces N sampled files to count as degraded. Test hook only. */
const FAULT_INJECT = Number(process.env.BB_JULIA_FAULT_INJECT ?? 0)

const CACHE = `/tmp/julia-ambiguity-cache/${analyzerHash}.ndjson`

async function phaseOne(): Promise<FileRow[]> {
  const rows: (FileRow | null)[] = new Array(sample.length).fill(null)
  let idx = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const i = idx++
      if (i >= sample.length) return
      const f = sample[i]
      const label = `${f.repo}/${f.rel}`
      let r: any = null
      let threw = false
      try {
        r = await parseFile(f.abs, f.dir)
      } catch {
        threw = true
      }
      const syms: PubSym[] = []
      const rels: Rel[] = []
      if (!threw && r) {
        for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
          const name = String((s as any)?.name ?? "")
          if (name.length === 0) continue
          syms.push({
            name,
            kind: String((s as any)?.kind ?? (s as any)?.type ?? ""),
            owner: String((s as any)?.ownerName ?? ""),
            line: Number((s as any)?.startLine ?? 0),
          })
        }
        for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
          const t = String((rel as any)?.type ?? "")
          if (!ALL_TYPES.includes(t as Type)) continue
          rels.push({
            source: String((rel as any)?.source ?? ""),
            target: String((rel as any)?.target ?? ""),
            type: t,
            line: Number((rel as any)?.line_number ?? 0),
          })
        }
      }
      // FAULT INJECTION — `BB_JULIA_FAULT_INJECT=N` marks the first N sampled files degraded.
      // It exists so the population gate below has a DETERMINISTIC regression test: the real
      // degradation is probabilistic (measured 2026-10-05: width 4 degraded
      // `julia/stdlib/LibGit2/src/repository.jl` in one run and `.../strarray.jl` in the next, and
      // 0 files in a third), so a test that waits for a real one is a test that mostly does not run.
      // Injection bypasses the cache in BOTH directions, so it can never poison a real record.
      const injected = FAULT_INJECT > 0 && i < FAULT_INJECT
      rows[i] = {
        label,
        repo: f.repo,
        degraded: r?.fallback === true || injected,
        faultInjected: injected || undefined,
        threw,
        syms,
        rels,
      }
    }
  }
  await Promise.all(Array.from({ length: WIDTH }, () => worker()))
  return rows as FileRow[]
}

async function loadOrParse(): Promise<{ rows: FileRow[]; fromCache: boolean }> {
  const key = createHash("sha256")
    .update(
      `${analyzerHash}|w${WIDTH}` +
        sample
          .map((f) => `${f.repo}/${f.rel}:${f.bytes}:${Math.round(f.mtimeMs)}`)
          .join("\n"),
    )
    .digest("hex")
    .slice(0, 16)
  const cachePath = `${CACHE}.${key}`
  if (!FAULT_INJECT && existsSync(cachePath)) {
    try {
      const parsed = readFileSync(cachePath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as FileRow)
      if (parsed.length === sample.length) return { rows: parsed, fromCache: true }
    } catch {
      /* fall through to a fresh parse */
    }
  }
  const rows = await phaseOne()
  try {
    if (!FAULT_INJECT) {
      mkdirSync(path.dirname(cachePath), { recursive: true })
      writeFileSync(cachePath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n")
    }
  } catch {
    /* the cache is an optimisation; its absence must not change a number */
  }
  return { rows, fromCache: false }
}

// ------------------------------------------------------------------ phase two: classify
// Single-threaded on purpose: classifying a name needs the corpus-wide table complete,
// and answering from a set four workers are still filling makes the answer depend on
// scheduling.
const { rows, fromCache } = await loadOrParse()
const good = rows.filter((r) => !r.threw && !r.degraded)
const degraded = rows.filter((r) => !r.threw && r.degraded)
const threw = rows.filter((r) => r.threw)

interface Owner2 {
  label: string
  repo: string
  kind: string
  owner: string
  line: number
}
const byName = new Map<string, Owner2[]>()
/**
 * Per FILE, name -> the distinct owners that file declares it under. This is the only scoping
 * evidence a per-file analyzer holds, so it is what decides repairability. `byName` above is
 * corpus-wide and answers a different question.
 */
const byFileName = new Map<string, Map<string, Set<string>>>()
for (const r of good) {
  for (const s of r.syms) {
    const arr = byName.get(s.name)
    const rec: Owner2 = { label: r.label, repo: r.repo, kind: s.kind, owner: s.owner, line: s.line }
    if (arr) arr.push(rec)
    else byName.set(s.name, [rec])
    let perFile = byFileName.get(r.label)
    if (!perFile) {
      perFile = new Map()
      byFileName.set(r.label, perFile)
    }
    let owners = perFile.get(s.name)
    if (!owners) {
      owners = new Set()
      perFile.set(s.name, owners)
    }
    owners.add(s.owner)
  }
}

type Bucket = "B1" | "B2" | "B3a" | "B3b"

/**
 * The refinement of B1 and B2, which the coarse buckets lump too coarsely to act on.
 *
 * `B2` as defined above is ">1 file in one repo". That single rule covers three populations
 * with three different fixes, and on this corpus it is the LARGEST bucket, so knowing which
 * of the three it is decides whether the lane can repair anything at all:
 *
 *   B2a  every colliding declaration shares ONE non-empty `ownerName`
 *        — one module declares the name N times. In Julia that is one BINDING with N method
 *          definitions (`function getproperty(x::T, s::Symbol) where T` in base/operators.jl
 *          and `getproperty(stream::IO, s::Symbol)` in base/stream.jl are both methods of
 *          `Base.getproperty`). No in-scope rule would separate them — they are not
 *          alternatives, they are the same function. Reported, and only repairable by
 *          publishing one symbol per binding, which the method-keyed `overrides` semantics
 *          forbid.
 *   B2b  the colliding declarations carry >=2 distinct `ownerName`s
 *        — >=2 modules of one package declare the name and the referring file's `using` /
 *          `import` set is what says which is in scope. THE REPAIRABLE ONE, in principle.
 *   B2c  every colliding declaration has an EMPTY `ownerName`
 *        — the corpus files have no `module` block, so there is no scope to model and the
 *          analyzer has nothing to disambiguate with. This lane's doc records 71.9% of Julia
 *          files have no module block, so this bucket is expected to be large, not surprising.
 *
 * `B1` is refined by whether the owners are real module names or the empty string, for the
 * same reason: "one file, two owners" is only a scoping failure if both owners are scopes.
 */
type Fine = "B1x" | "B1e" | "B2a" | "B2b" | "B2c" | "B3a" | "B3b"

interface TypeRow {
  edges: number
  emptyTarget: number
  selfLoop: number
  unresolved: number
  unique: number
  ambSym: number
  ambKind: number
  B1: number
  B2: number
  B3a: number
  B3b: number
  ambSymButNotAmbKind: number
  /**
   * The refinement. `fine` holds every ambiguous edge exactly once, split by `Fine`, so
   * `B1x + B1e + B2a + B2b + B2c + B3a + B3b === ambSym` on every type. This is an
   * invariant the report asserts rather than a claim a reader has to check by summing.
   */
  fine: Map<Fine, number>
  /** Per-bucket names, so a fix can be aimed at a name list rather than at a count. */
  fineNames: Map<Fine, Set<string>>
  /**
   * Within `B2a` — one module, N declarations of one name — the KIND histogram of the
   * colliding set. `allFunction` is the shape a Julia method table has; `withNonFunction`
   * is a binding published under two kinds (`struct X … end` plus `X(…)`, which is ONE
   * binding twice, because the type object is callable).
   */
  b2aAllFunction: number
  b2aWithNonFunction: number
  /** Number of distinct colliding declarations per B2a ambiguous edge — the multiplicity. */
  b2aHitCount: number
  b2aHitCountMax: number
  /**
   * PER-FILE REPAIRABILITY — the question that decides whether a change to a per-file
   * analyzer can move the number at all.
   *
   * The buckets above are properties of the COLLIDING SET. What an analyzer can act on is
   * narrower: an analyzer sees one file, so the only disambiguation it can make is one it can
   * derive from the referring file's own tree. That is exactly: **the referring file declares
   * the target name under >=2 distinct scopes.** Then the answer is the owner of the source
   * symbol, which is on the symbol, and the edge can carry `Owner.name`.
   *
   *   perFileRepairable — the referring file declares the name under >=2 owners. The analyzer
   *                      holds both facts already. This is the whole addressable population.
   *   perFilePartial    — the referring file declares the name under exactly ONE owner, and
   *                      that owner is a real scope, while OTHER files add more declarations.
   *                      Qualifying would pick the in-file scope; whether that is the binding
   *                      the call site meant depends on Julia's `using` semantics, which the
   *                      analyzer does not model. A fix here is a GUESS and is not counted as
   *                      repairable.
   *   perFileNoScope    — the referring file declares the name with no owner at all, or does
   *                      not declare it. Nothing in the file to derive an answer from.
   *
   * `perFileRepairable + perFilePartial + perFileNoScope === ambSym`, asserted at runtime.
   * This is deliberately NOT the same partition as `fine`, and the report prints both,
   * because a bucket can be large and unactionable (B3a) and another small and actionable
   * (B1x), and only this one answers "is a per-file change worth making".
   */
  perFileRepairable: number
  perFilePartial: number
  perFileNoScope: number
  perFileRepairableNames: Set<string>
  /**
   * HOW THE PRODUCT'S RESOLVER ATTRIBUTES AN AMBIGUOUS EDGE — `parallel-indexer.ts:2239`
   * resolves `target = extractLeaf(target)` by NAME project-wide, ordered
   * `(is_declaration, same-file, language, s.id)` and `LIMIT 1`. So every ambiguous edge is
   * attributed to exactly one published declaration, by a rule that prefers the referring FILE
   * and then the lexicographically smallest `${fileId}:${name}:${line}`.
   *
   *   attribForced     the referring file declares the name EXACTLY once — the same-file
   *                    preference lands on the only candidate this file has. The ambiguity is
   *                    real to `incoming-check` (which counts kinds) and harmless to the
   *                    resolver. THIS is the arm that needs no fix.
   *   attribInFileMulti the file declares it >=2 times, so the resolver picks among those.
   *   attribCrossFile  the file declares it 0 times, so the resolver picks among `hit.length`
   *                    declarations ACROSS FILES with nothing in the ORDER BY preferring the
   *                    right one. This is the population where the attribution is arbitrary.
   *
   * `attribForced + attribInFileMulti + attribCrossFile === ambSym`, asserted at runtime.
   */
  attribForced: number
  attribInFileMulti: number
  attribCrossFile: number
  /** Distinct colliding declarations summed over this type's ambiguous edges. */
  attribCandidates: number
  attribCandidatesMax: number
  /** Same, restricted to the `attribInFileMulti` arm, where the whole candidate set is in-file. */
  inFileMultiCandidates: number
  inFileMultiMax: number
  /**
   * THE DEDUP COUNTERFACTUAL — the ceiling of the only lever this lane holds. The analyzer
   * controls the set of published symbols; the resolver reads only `s.name`. So the best any
   * publication change can do is make a colliding set bind to one symbol, and whether a
   * hypothetical collapse achieves that is computable from the published data with no edit.
   *
   *   ambDedupSym   >1 distinct (repo, ownerName) — still ambiguous after collapsing every
   *                 declaration of one name in one module of one repo to ONE symbol. That is
   *                 Julia's binding: `struct X … end` and `X(…)` are one binding, and N method
   *                 definitions are one binding.
   *   ambDedupKind  >1 distinct (repo, ownerName, kind) — still ambiguous after that collapse
   *                 when the kind is kept.
   *   dedupFixed    would bind to exactly 1: the edges a one-symbol-per-binding publication
   *                 rule resolves, and the upper bound on what this lane can move.
   *
   * `ambDedupSym + dedupFixed === ambSym`, asserted at runtime.
   */
  ambDedupSym: number
  ambDedupKind: number
  dedupFixed: number
  dedupFixedNames: Set<string>
  /**
   * Self-loop edges (`source === target`) whose target name is kind-ambiguous.
   *
   * `incoming-check.ts` reports its per-type counts from a second pass that does NOT skip
   * self-loops, so its `ambiguousTargets` column includes them. This field is the size of
   * that difference and it is what makes this instrument's `ambKind` differ from that
   * column by exactly this much on an identical file set.
   */
  selfLoopKindAmbiguous: number
  ambNames: Set<string>
  ambNamesByBucket: Map<Bucket, Set<string>>
  examples: Map<Bucket, { name: string; hits: Owner2[] }>
}
const blank = (): TypeRow => ({
  edges: 0,
  emptyTarget: 0,
  selfLoop: 0,
  unresolved: 0,
  unique: 0,
  ambSym: 0,
  ambKind: 0,
  B1: 0,
  B2: 0,
  B3a: 0,
  B3b: 0,
  ambSymButNotAmbKind: 0,
  fine: new Map(),
  fineNames: new Map(),
  b2aAllFunction: 0,
  b2aWithNonFunction: 0,
  b2aHitCount: 0,
  b2aHitCountMax: 0,
  perFileRepairable: 0,
  perFilePartial: 0,
  perFileNoScope: 0,
  perFileRepairableNames: new Set(),
  attribForced: 0,
  attribInFileMulti: 0,
  attribCrossFile: 0,
  attribCandidates: 0,
  attribCandidatesMax: 0,
  inFileMultiCandidates: 0,
  inFileMultiMax: 0,
  ambDedupSym: 0,
  ambDedupKind: 0,
  dedupFixed: 0,
  dedupFixedNames: new Set(),
  selfLoopKindAmbiguous: 0,
  ambNames: new Set(),
  ambNamesByBucket: new Map(),
  examples: new Map(),
})
const perType = new Map<Type, TypeRow>()
for (const t of ALL_TYPES) perType.set(t, blank())

for (const r of good) {
  for (const rel of r.rels) {
    const row = perType.get(rel.type as Type)!
    row.edges++
    if (rel.target.length === 0) {
      row.emptyTarget++
      continue
    }
    if (rel.target === rel.source) {
      row.selfLoop++
      const sh = byName.get(rel.target)
      if (sh && sh.length > 0 && new Set(sh.map((h) => h.kind)).size > 1) row.selfLoopKindAmbiguous++
      continue
    }
    const hit = byName.get(rel.target)
    if (!hit || hit.length === 0) {
      row.unresolved++
      continue
    }
    if (hit.length === 1) {
      row.unique++
      continue
    }

    // --- genuinely ambiguous: more than one published symbol under this name
    row.ambSym++
    row.ambNames.add(rel.target)
    const kinds = new Set(hit.map((h) => h.kind))
    const kindCollide = kinds.size > 1
    if (kindCollide) row.ambKind++
    else row.ambSymButNotAmbKind++

    const files = new Set(hit.map((h) => h.label))
    const repos = new Set(hit.map((h) => h.repo))
    const owners = new Set(hit.map((h) => h.owner))
    let bucket: Bucket
    if (files.size === 1) bucket = owners.size > 1 ? "B1" : "B3b"
    else bucket = repos.size > 1 ? "B3a" : "B2"
    row[bucket]++

    // --- HOW THE PRODUCT'S RESOLVER ACTUALLY DECIDES, and whether it decides correctly
    //
    // The buckets above describe the colliding set. The question the round brief asks is the
    // one a consumer asks: an ambiguous target is ONE edge that will be attributed to ONE
    // declaration — is that declaration the right one?
    //
    // `src/ast/parallel-indexer.ts:2239` decides it in SQL, not in this repo's control:
    //
    //   SELECT s.id FROM brain_symbol s … WHERE s.project_id = ? AND s.name = ?
    //   ORDER BY COALESCE(s.is_declaration,0) ASC, (s.file_id = ?) DESC,
    //            (f.language = ?) DESC, s.id  LIMIT 1
    //
    // with `target = extractLeaf(targetName)` (`:3393`), so it resolves by LEAF NAME across
    // the whole project and prefers a same-file candidate. Two consequences this lane must
    // measure rather than assume:
    //
    //   * a QUALIFIED target is invisible to it — `extractLeaf` strips `Owner.name` to `name`
    //     before the lookup, so an analyzer that emitted `Base.getproperty` resolves exactly as
    //     if it had emitted `getproperty`. Qualifying a target cannot move the product's number.
    //   * what it picks is decided by `s.id`, which is `${fileId}:${name}:${line}` compared as
    //     TEXT — so among same-file candidates it is the lexicographically SMALLEST LINE that
    //     wins, and `class` before `function` is not a rule anybody chose.
    //
    // The three arms below are therefore about the only evidence the resolver uses:
    //
    //   fileHits == 1  the pick is FORCED. One same-file candidate exists, so whichever row the
    //                  ORDER BY returns, the edge lands on the only declaration this file makes.
    //                  The ambiguity is real to `incoming-check` and harmless to the resolver.
    //   fileHits >= 2  the file declares it more than once and the ORDER BY picks among them.
    //   fileHits == 0  no same-file candidate; the pick is one of `hit.length` by `s.id`, across
    //                  files, with nothing in the resolver preferring the right one.
    const fileHits = hit.filter((h) => h.label === r.label).length
    if (fileHits === 1) row.attribForced++
    else if (fileHits >= 2) row.attribInFileMulti++
    else row.attribCrossFile++
    row.attribCandidates += hit.length
    if (hit.length > row.attribCandidatesMax) row.attribCandidatesMax = hit.length
    if (fileHits >= 2) {
      row.inFileMultiCandidates += fileHits
      if (fileHits > row.inFileMultiMax) row.inFileMultiMax = fileHits
    }

    // --- THE DEDUP COUNTERFACTUAL: the one lever that is actually in this lane's hands.
    //
    // Every other lever ends at shared machinery. The analyzer controls ONE thing the resolver
    // reads: the SET of published symbols a name can bind to. So the ceiling of any
    // publication change is computable here, from the same published data, with no analyzer
    // edit — and it is the number that decides whether an edit is worth its blast radius.
    //
    //   dedupSym  distinct (repo, ownerName) pairs among the colliding declarations
    //             — one symbol per (module, name) in one repo, i.e. ONE Julia binding. This is
    //               the `struct X … end` + `X(…)` collapse and the N-methods-of-one-function
    //               collapse, both of which are one binding in Julia's data model.
    //   dedupKind distinct (repo, ownerName, kind) triples — the same collapse but keeping the
    //             kind, so struct + constructor stay two symbols and only same-kind duplicates go.
    //
    // An edge is `ambDedupSym` when dedupSym > 1: it would still bind to >1 symbol after the
    // collapse. The arms partition `ambSym`, asserted at runtime with the other two.
    const dSym = new Set(hit.map((h) => `${h.repo}\u0000${h.owner}`)).size
    const dKind = new Set(hit.map((h) => `${h.repo}\u0000${h.owner}\u0000${h.kind}`)).size
    if (dSym > 1) row.ambDedupSym++
    if (dKind > 1) row.ambDedupKind++
    if (dSym <= 1) {
      row.dedupFixed++
      row.dedupFixedNames.add(rel.target)
    }

    // --- the refinement, assigned here so `fine` partitions `ambSym` by construction
    const nonEmptyOwners = new Set([...owners].filter((o) => o !== ""))
    let fine: Fine
    if (files.size === 1) {
      if (owners.size === 1) fine = "B3b"
      else fine = nonEmptyOwners.size >= 2 ? "B1x" : "B1e"
    } else if (repos.size > 1) fine = "B3a"
    else if (nonEmptyOwners.size >= 2) fine = "B2b"
    else if (nonEmptyOwners.size === 1) fine = "B2a"
    else fine = "B2c"
    row.fine.set(fine, (row.fine.get(fine) ?? 0) + 1)
    if (!row.fineNames.has(fine)) row.fineNames.set(fine, new Set())
    row.fineNames.get(fine)!.add(rel.target)
    if (fine === "B2a") {
      row.b2aHitCount += hit.length
      if (hit.length > row.b2aHitCountMax) row.b2aHitCountMax = hit.length
      const kindsOf = new Set(hit.map((h) => h.kind))
      if ([...kindsOf].every((k) => k === "function")) row.b2aAllFunction++
      else row.b2aWithNonFunction++
    }

    // --- per-file repairability: does the REFERRING FILE hold the disambiguating evidence?
    //
    // The four-way test, in this order, so the three counts partition `ambSym`:
    //
    //   undefined          -> the referring file does not DECLARE this name at all.
    //   size >= 2          -> it declares it under >=2 scopes.
    //   size == 1, owner=""-> it declares it once, with no enclosing scope.
    //   size == 1, real    -> it declares it once, under exactly one real scope.
    //
    // The earlier draft folded the first case into `perFilePartial`, which contradicted the
    // field's own documented definition ("or does not declare it" was filed under
    // `perFileNoScope`). Fixed here, which is why the per-file counts below are NOT
    // comparable with any earlier print of this file.
    const fileOwners = byFileName.get(r.label)?.get(rel.target)
    if (!fileOwners) {
      row.perFileNoScope++
    } else if (fileOwners.size >= 2) {
      row.perFileRepairable++
      row.perFileRepairableNames.add(rel.target)
    } else if ([...fileOwners][0] === "") {
      row.perFileNoScope++
    } else {
      row.perFilePartial++
    }

    let names = row.ambNamesByBucket.get(bucket)
    if (!names) {
      names = new Set()
      row.ambNamesByBucket.set(bucket, names)
    }
    names.add(rel.target)
    if (!row.examples.has(bucket)) row.examples.set(bucket, { name: rel.target, hits: hit.slice(0, 4) })
  }
}

// ------------------------------------------------------------------ report
const tot = blank()
const FINE_ORDER: Fine[] = ["B1x", "B1e", "B2a", "B2b", "B2c", "B3a", "B3b"]
for (const f of FINE_ORDER) tot.fine.set(f, 0)
for (const t of ALL_TYPES) {
  const r = perType.get(t)!
  tot.edges += r.edges
  tot.emptyTarget += r.emptyTarget
  tot.selfLoop += r.selfLoop
  tot.unresolved += r.unresolved
  tot.unique += r.unique
  tot.ambSym += r.ambSym
  tot.ambKind += r.ambKind
  tot.B1 += r.B1
  tot.B2 += r.B2
  tot.B3a += r.B3a
  tot.B3b += r.B3b
  tot.ambSymButNotAmbKind += r.ambSymButNotAmbKind
  tot.selfLoopKindAmbiguous += r.selfLoopKindAmbiguous
  tot.b2aAllFunction += r.b2aAllFunction
  tot.b2aWithNonFunction += r.b2aWithNonFunction
  tot.b2aHitCount += r.b2aHitCount
  if (r.b2aHitCountMax > tot.b2aHitCountMax) tot.b2aHitCountMax = r.b2aHitCountMax
  for (const f of FINE_ORDER) {
    tot.fine.set(f, (tot.fine.get(f) ?? 0) + (r.fine.get(f) ?? 0))
    if (!tot.fineNames.has(f)) tot.fineNames.set(f, new Set())
    const src = r.fineNames.get(f)
    if (src) for (const n of src) tot.fineNames.get(f)!.add(n)
  }
  tot.perFileRepairable += r.perFileRepairable
  tot.perFilePartial += r.perFilePartial
  tot.perFileNoScope += r.perFileNoScope
  for (const n of r.perFileRepairableNames) tot.perFileRepairableNames.add(n)
  tot.attribForced += r.attribForced
  tot.attribInFileMulti += r.attribInFileMulti
  tot.attribCrossFile += r.attribCrossFile
  tot.attribCandidates += r.attribCandidates
  if (r.attribCandidatesMax > tot.attribCandidatesMax) tot.attribCandidatesMax = r.attribCandidatesMax
  tot.inFileMultiCandidates += r.inFileMultiCandidates
  if (r.inFileMultiMax > tot.inFileMultiMax) tot.inFileMultiMax = r.inFileMultiMax
  tot.ambDedupSym += r.ambDedupSym
  tot.ambDedupKind += r.ambDedupKind
  tot.dedupFixed += r.dedupFixed
  for (const n of r.dedupFixedNames) tot.dedupFixedNames.add(n)
}
// The invariant, asserted rather than asserted-in-prose: `fine` is a partition of `ambSym`.
const fineSum = FINE_ORDER.reduce((n, f) => n + (tot.fine.get(f) ?? 0), 0)
if (fineSum !== tot.ambSym) {
  console.error(`FATAL: fine buckets sum to ${fineSum} but ambSym is ${tot.ambSym}`)
  process.exit(2)
}
// Second partition, over the SAME population, answering a different question: `fine` describes
// the COLLIDING SET, this one describes the REFERRING FILE's evidence. Asserted for the same
// reason — a bucket table that does not add up is not a finding.
const perFileSum = tot.perFileRepairable + tot.perFilePartial + tot.perFileNoScope
if (perFileSum !== tot.ambSym) {
  console.error(
    `FATAL: per-file buckets sum to ${perFileSum} (${tot.perFileRepairable}+${tot.perFilePartial}+${tot.perFileNoScope}) but ambSym is ${tot.ambSym}`,
  )
  process.exit(2)
}
// Third partition: how the product's resolver attributes an ambiguous edge. A partition
// asserted for the same reason as the other two — these arms are quoted as a repairability
// argument and an arm that overlaps or drops an edge makes the argument unfalsifiable.
const attribSum = tot.attribForced + tot.attribInFileMulti + tot.attribCrossFile
if (attribSum !== tot.ambSym) {
  console.error(
    `FATAL: attribution arms sum to ${attribSum} (${tot.attribForced}+${tot.attribInFileMulti}+${tot.attribCrossFile}) but ambSym is ${tot.ambSym}`,
  )
  process.exit(2)
}
// Fourth partition: the dedup counterfactual, over the same edges.
const dedupSum = tot.ambDedupSym + tot.dedupFixed
if (dedupSum !== tot.ambSym) {
  console.error(`FATAL: dedup arms sum to ${dedupSum} but ambSym is ${tot.ambSym}`)
  process.exit(2)
}

const out = {
  generatedFor: "julia ambiguity split",
  corpusRoot: CR,
  admittedFiles: admitted.length,
  repositories: reposSeen,
  sampleFiles: sample.length,
  stride,
  order: ORDER,
  sampleHash,
  corpusHash,
  parseFromCache: fromCache,
  workerWidth: WIDTH,
  faultInjected: FAULT_INJECT,
  degraded: degraded.map((r) => r.label),
  parseThrew: threw.map((r) => r.label),
  symbols: good.reduce((n, r) => n + r.syms.length, 0),
  edges: good.reduce((n, r) => n + r.rels.length, 0),
  distinctNames: byName.size,
  perRepoSample: perRepo,
  sampleList: sample.map((f) => f.abs),
  definitions: {
    ambSym: "target name binds to >1 published symbol — the reverse walk's actual problem",
    ambKind: "target name published under >1 distinct KIND — incoming-check.ts's column",
    B1: "colliding symbols all in ONE file, >1 distinct ownerName — analyzer holds the owner and discards it",
    B2: "colliding symbols in >1 file of ONE repo — in-scope module not modelled",
    B3a: "colliding symbols in >1 REPO — independent packages, no in-scope rule exists",
    B3b: "colliding symbols in ONE file, ONE owner — one binding published twice, or two same-spelled declarations",
    "B1x": "ONE file, >=2 NON-EMPTY ownerName — real module scopes in one file; owner is on the symbol, absent from the edge",
    "B1e": "ONE file, owners present but not >=2 non-empty — not a scoping collision",
    "B2a": ">1 file, ONE repo, ALL colliding declarations share ONE non-empty ownerName — one Julia binding, N method definitions",
    "B2b": ">1 file, ONE repo, >=2 distinct non-empty ownerName — in-scope module not modelled. THE REPAIRABLE ONE",
    "B2c": ">1 file, ONE repo, every colliding declaration has an EMPTY ownerName — no module block, no scope to model",
  },
  finePartitionCheck: { fineSum, ambSym: tot.ambSym, holds: fineSum === tot.ambSym },
  perFilePartitionCheck: {
    sum: perFileSum,
    ambSym: tot.ambSym,
    holds: perFileSum === tot.ambSym,
  },
  // Third and fourth partitions, over the same population. Asserted for the same reason: the
  // numbers below are read as a repairability argument, and a partition that does not add up
  // cannot be one.
  attribPartitionCheck: {
    forced: tot.attribForced,
    inFileMulti: tot.attribInFileMulti,
    crossFile: tot.attribCrossFile,
    sum: tot.attribForced + tot.attribInFileMulti + tot.attribCrossFile,
    ambSym: tot.ambSym,
    holds: tot.attribForced + tot.attribInFileMulti + tot.attribCrossFile === tot.ambSym,
  },
  dedupPartitionCheck: {
    stillAmbiguous: tot.ambDedupSym,
    wouldResolve: tot.dedupFixed,
    sum: tot.ambDedupSym + tot.dedupFixed,
    ambSym: tot.ambSym,
    holds: tot.ambDedupSym + tot.dedupFixed === tot.ambSym,
  },
  total: {
    edges: tot.edges,
    emptyTarget: tot.emptyTarget,
    selfLoop: tot.selfLoop,
    unresolved: tot.unresolved,
    unique: tot.unique,
    ambSym: tot.ambSym,
    ambKind: tot.ambKind,
    ambSymButNotAmbKind: tot.ambSymButNotAmbKind,
    B1: tot.B1,
    B2: tot.B2,
    B3a: tot.B3a,
    B3b: tot.B3b,
    selfLoopKindAmbiguous: tot.selfLoopKindAmbiguous,
    fine: Object.fromEntries(FINE_ORDER.map((f) => [f, tot.fine.get(f) ?? 0])),
    b2aAllFunction: tot.b2aAllFunction,
    b2aWithNonFunction: tot.b2aWithNonFunction,
    b2aMeanHits: tot.b2aAllFunction + tot.b2aWithNonFunction > 0
      ? Number((tot.b2aHitCount / (tot.b2aAllFunction + tot.b2aWithNonFunction)).toFixed(3))
      : 0,
    b2aHitCountMax: tot.b2aHitCountMax,
    perFileRepairable: tot.perFileRepairable,
    perFilePartial: tot.perFilePartial,
    perFileNoScope: tot.perFileNoScope,
    perFileRepairableNames: [...tot.perFileRepairableNames].sort(),
    attribForced: tot.attribForced,
    attribInFileMulti: tot.attribInFileMulti,
    attribCrossFile: tot.attribCrossFile,
    attribCandidates: tot.attribCandidates,
    attribCandidatesMean: tot.ambSym > 0 ? Number((tot.attribCandidates / tot.ambSym).toFixed(3)) : 0,
    attribCandidatesMax: tot.attribCandidatesMax,
    inFileMultiCandidatesMean:
      tot.attribInFileMulti > 0 ? Number((tot.inFileMultiCandidates / tot.attribInFileMulti).toFixed(3)) : 0,
    inFileMultiMax: tot.inFileMultiMax,
    ambDedupSym: tot.ambDedupSym,
    ambDedupKind: tot.ambDedupKind,
    dedupFixed: tot.dedupFixed,
    dedupFixedNames: [...tot.dedupFixedNames].sort(),
  },
  perType: Object.fromEntries(
    ALL_TYPES.map((t) => {
      const r = perType.get(t)!
      return [
        t,
        {
          edges: r.edges,
          emptyTarget: r.emptyTarget,
          selfLoop: r.selfLoop,
          unresolved: r.unresolved,
          unique: r.unique,
          ambSym: r.ambSym,
          ambKind: r.ambKind,
          ambSymButNotAmbKind: r.ambSymButNotAmbKind,
          B1: r.B1,
          B2: r.B2,
          B3a: r.B3a,
          B3b: r.B3b,
          fine: Object.fromEntries(FINE_ORDER.map((f) => [f, r.fine.get(f) ?? 0])),
          fineNames: Object.fromEntries(
            FINE_ORDER.filter((f) => (r.fine.get(f) ?? 0) > 0).map((f) => [
              f,
              [...(r.fineNames.get(f) ?? new Set<string>())].sort(),
            ]),
          ),
          b2aAllFunction: r.b2aAllFunction,
          b2aWithNonFunction: r.b2aWithNonFunction,
          perFileRepairable: r.perFileRepairable,
          perFilePartial: r.perFilePartial,
          perFileNoScope: r.perFileNoScope,
          attribForced: r.attribForced,
          attribInFileMulti: r.attribInFileMulti,
          attribCrossFile: r.attribCrossFile,
          attribCandidates: r.attribCandidates,
          ambDedupSym: r.ambDedupSym,
          ambDedupKind: r.ambDedupKind,
          dedupFixed: r.dedupFixed,
          selfLoopKindAmbiguous: r.selfLoopKindAmbiguous,
          ambNames: [...r.ambNames].sort(),
          examples: Object.fromEntries(
            [...r.examples].map(([b, e]) => [
              b,
              {
                name: e.name,
                hits: e.hits.map((h) => `${h.label}:${h.line} ${h.kind}${h.owner ? ` in ${h.owner}` : ""}`),
              },
            ]),
          ),
        },
      ]
    }),
  ),
}

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(out, null, 2))
  console.log(`wrote ${jsonOut}`)
}

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
const num = (n: number) => n.toLocaleString("en-US")
const pct = (n: number) => `${((100 * n) / (tot.ambSym || 1)).toFixed(1).padStart(5)}%`
console.log(`ambiguity split — julia`)
console.log(`corpus root        : ${CR}`)
console.log(`admitted           : ${admitted.length} .jl files across ${reposSeen} repositories`)
console.log(`sample             : ${sample.length} files, stride ${stride}, sample hash ${sampleHash}`)
console.log(`corpus hash        : ${corpusHash}`)
console.log(`parse              : ${fromCache ? "CACHE" : "fresh"}, width ${WIDTH}, ${good.length} good, ${degraded.length} degraded, ${threw.length} threw`)
console.log(`symbols / edges    : ${num(out.symbols)} / ${num(out.edges)}`)
console.log(`distinct names     : ${num(out.distinctNames)}`)
console.log(`per-repo sample    : ${Object.entries(perRepo).map(([k, v]) => `${k}:${v}`).join(" ")}`)
console.log("")
console.log(pad("type", 13) + pad("edges", 10) + pad("unres", 10) + pad("unique", 10) + pad("ambSym", 10) + pad("ambKind", 10) + pad("B1", 9) + pad("B2", 9) + pad("B3a", 9) + "B3b")
console.log("-".repeat(108))
for (const t of ALL_TYPES) {
  const r = out.perType[t]
  console.log(
    pad(t, 13) +
      pad(num(r.edges), 10) +
      pad(num(r.unresolved), 10) +
      pad(num(r.unique), 10) +
      pad(num(r.ambSym), 10) +
      pad(num(r.ambKind), 10) +
      pad(num(r.B1), 9) +
      pad(num(r.B2), 9) +
      pad(num(r.B3a), 9) +
      num(r.B3b),
  )
}
console.log("-".repeat(108))
console.log(
  pad("TOTAL", 13) +
    pad(num(tot.edges), 10) +
    pad(num(tot.unresolved), 10) +
    pad(num(tot.unique), 10) +
    pad(num(tot.ambSym), 10) +
    pad(num(tot.ambKind), 10) +
    pad(num(tot.B1), 9) +
    pad(num(tot.B2), 9) +
    pad(num(tot.B3a), 9) +
    num(tot.B3b),
)
console.log("")
console.log("ambSym - ambKind = the same-kind collisions incoming-check.ts cannot see:")
console.log(`  ${num(tot.ambSymButNotAmbKind)} edges over ${num(new Set(ALL_TYPES.flatMap((t) => out.perType[t].ambNames)).size)} names`)
console.log("")
console.log("Bucket split of the ambiguous edges (ambSym):")
for (const [b, label] of [
  ["B1", "one file, >1 ownerName — REPAIRABLE (owner is on the symbol, absent from the edge)"],
  ["B2", ">1 file in one repo — in-scope module not modelled — REPAIRABLE in principle"],
  ["B3a", ">1 repo — independent packages, no in-scope rule exists — NOT repairable here"],
  ["B3b", "one file, one owner — one binding published twice, or same-spelled declarations — NOT repairable here"],
] as const) {
  const n = tot[b as keyof typeof tot] as number
  console.log(`  ${b.padEnd(4)} ${num(n).padStart(9)}  ${((100 * n) / (tot.ambSym || 1)).toFixed(1).padStart(5)}%  ${label}`)
}
console.log("")
console.log("FINE split — B1 and B2 resolved into populations with different fixes:")
for (const [f, label] of [
  ["B2a", "one module, N declarations of ONE name — one Julia binding's method table. NOT a scoping failure"],
  ["B2b", ">=2 modules of ONE package declare it; in-scope module not modelled. REPAIRABLE"],
  ["B2c", "no module block on any of them — no scope exists to model"],
  ["B1x", "ONE file, >=2 real module scopes — owner is on the symbol, absent from the edge. REPAIRABLE"],
  ["B1e", "ONE file, not >=2 non-empty owners"],
  ["B3a", ">1 repo — independent packages. NOT repairable by any analyzer"],
  ["B3b", "ONE file, ONE scope, two same-spelled declarations. NOT repairable here"],
] as const) {
  const n = tot.fine.get(f as Fine) ?? 0
  const names = tot.fineNames.get(f as Fine)?.size ?? 0
  console.log(
    `  ${f.padEnd(4)} ${num(n).padStart(9)}  ${((100 * n) / (tot.ambSym || 1)).toFixed(1).padStart(5)}%  ${num(names).padStart(6)} names  ${label}`,
  )
}
console.log(`  sum  ${num(fineSum).padStart(9)}  === ambSym ${num(tot.ambSym)} (asserted at runtime; exit 2 if not)`)
console.log("")
console.log("B2a composition — is it a method table, or one binding under two kinds?")
console.log(`  every colliding declaration is a 'function'  : ${num(tot.b2aAllFunction)} edges  (a Julia method table)`)
console.log(`  at least one non-'function' kind in the set  : ${num(tot.b2aWithNonFunction)} edges  (e.g. struct + constructor = ONE binding)`)
console.log(`  mean distinct declarations per ambiguous B2a edge: ${out.total.b2aMeanHits}, max ${num(tot.b2aHitCountMax)}`)
console.log("")
console.log("PER-FILE repairability — does the REFERRING FILE hold the disambiguating evidence?")
console.log(
  `  repairable  ${num(tot.perFileRepairable).padStart(7)}  the file declares the name under >=2 scopes`,
)
console.log(`  partial     ${num(tot.perFilePartial).padStart(7)}  the file declares it once, under one real scope`)
console.log(
  `  noScope     ${num(tot.perFileNoScope).padStart(7)}  the file does not declare it, or declares it with no scope`,
)
console.log(`  sum         ${num(perFileSum).padStart(7)}  === ambSym ${num(tot.ambSym)} (asserted; exit 2 if not)`)
console.log("")
console.log("HOW THE PRODUCT'S RESOLVER ATTRIBUTES IT (parallel-indexer.ts:2239, by leaf name):")
console.log(
  `  forced       ${num(tot.attribForced).padStart(7)}  ${pct(tot.attribForced)}  the file declares it EXACTLY once — the same-file preference has one candidate`,
)
console.log(
  `  inFileMulti  ${num(tot.attribInFileMulti).padStart(7)}  ${pct(tot.attribInFileMulti)}  the file declares it >=2 times; s.id picks among them`,
)
console.log(
  `  crossFile    ${num(tot.attribCrossFile).padStart(7)}  ${pct(tot.attribCrossFile)}  the file declares it 0 times; s.id picks among ${out.total.attribCandidatesMean} on average, max ${num(tot.attribCandidatesMax)}`,
)
console.log(`  sum          ${num(attribSum).padStart(7)}  === ambSym ${num(tot.ambSym)} (asserted; exit 2 if not)`)
console.log("")
console.log("DEDUP CEILING — the only lever in this lane's hands (fewer published symbols per name):")
console.log(
  `  would resolve to 1 : ${num(tot.dedupFixed).padStart(7)}  ${pct(tot.dedupFixed)}  if every declaration of one name in one module of one repo published ONE symbol`,
)
console.log(
  `  still ambiguous    : ${num(tot.ambDedupSym).padStart(7)}  ${pct(tot.ambDedupSym)}  >=2 modules/repos declare it — no publication rule collapses these`,
)
console.log(`  of those, kind-kept : ${num(tot.ambDedupKind).padStart(7)}  still ambiguous when the kind is part of the binding key`)
console.log(`  sum                 : ${num(dedupSum).padStart(7)}  === ambSym ${num(tot.ambSym)} (asserted; exit 2 if not)`)
console.log(`  distinct names the ceiling covers: ${num(tot.dedupFixedNames.size)}`)
console.log("")
console.log("Examples, one per bucket:")
for (const t of ALL_TYPES) {
  for (const [b, e] of Object.entries(out.perType[t].examples)) {
    console.log(`  ${b}  (${t})  ${e.name}`)
    for (const h of e.hits) console.log(`        ${h}`)
  }
}

/**
 * POPULATION GATE — a degraded parse must not print a complete table.
 *
 * Every partition above is asserted against `ambSym`, so an assertion passing says nothing
 * about whether the population it partitions was complete. Measured 2026-10-05: at the old
 * default width of 4, all four partitions still summed exactly while the population was one
 * file short of the admitted sample. The table looked complete and was not.
 *
 * Exit codes: 0 clean, 2 a partition failed to sum, 3 the population was degraded and
 * `--allow-degraded` was not passed.
 */
const degradedN = degraded.length
const threwN = threw.length
if (degradedN > 0 || threwN > 0) {
  console.log("")
  console.log("=".repeat(108))
  console.log(`POPULATION NOT CLEAN — width ${WIDTH}, ${degradedN} degraded, ${threwN} threw`)
  console.log(
    "  Every number above is over the population that parsed, not over the sample. It is NOT",
  )
  console.log("  a whole-population figure and must not be quoted as one.")
  for (const r of degraded) console.log(`  degraded: ${r.label}`)
  for (const r of threw) console.log(`  threw   : ${r.label}`)
  console.log("")
  console.log("  Re-run at width 1 (BB_JULIA_WORKERS=1), the only width measured clean over")
  console.log("  7,940 parses, or pass --allow-degraded to publish the reduced population anyway.")
  console.log("=".repeat(108))
  if (!ALLOW_DEGRADED) process.exit(3)
} else {
  console.log("")
  console.log(
    `population clean: ${good.length}/${sample.length} files at width ${WIDTH}, 0 degraded, 0 threw`,
  )
}
