/**
 * PHP ONTOLOGY CENSUS — the lane's own instrument, built because the arbiter
 * (`script/m14/ontology-coverage-gate.ts`) REFUSES to report for this language.
 *
 * ## Why this file exists
 *
 * `ontology-coverage-gate.ts` exits 2 for any language absent from its
 * `RULED_BY_LANG` table, and `php` is absent:
 *
 *   > ontology coverage gate — no RULING TABLE for php.
 *   > Refusing to report: a gate with an empty table would call every
 *   > un-emitted type RULED-UNJUSTIFIED and that is a verdict about the TABLE,
 *   > not about the lane.
 *
 * That refusal is correct and it is the supervisor's file to fix, not this
 * lane's. So the measurement is done here instead, with the SAME instruments
 * the gate would have used, so that the numbers are comparable:
 *
 *   - the corpus walk is byte-for-byte the gate's (git-tracked files,
 *     `detectLanguageFromPath === "php"`, <= 512 KB), so the admitted set is
 *     the same set;
 *   - every relationship count comes from `parseFile` (`src/ast/pool-worker.ts`),
 *     never from `analyze()`, because `analyze()` skips the pipeline stages;
 *   - the ruling instrument is a GRAMMAR INVENTORY: every node type the pinned
 *     wasm actually produces across the admitted corpus is enumerated, and a
 *     type is ruled only when none of the node types that would express the
 *     construct appears in that inventory.
 *
 * ## What it measures (all of it, per the six questions)
 *
 *   1. EXISTS   — per relationship type, is the type in the emitted set at all.
 *   2. FIRES    — per type, the edge count and the files it came from.
 *   3. CORRECT  — not measured here. An oracle is `script/m14/differential.ts`,
 *                 which is shared machinery; this harness records which types
 *                 HAVE an oracle so the DERIVATION debt is countable.
 *   4. LABELLED — per type, the `metadata` flag vocabulary actually used, so
 *                 two labels sharing one vocabulary (a mislabelling) is visible.
 *   5. RESOLVED — per type, both endpoints resolved against the FILE's own
 *                 symbol set, plus the endpoint-name classes that do not
 *                 resolve (file-scope module edges are expected to be here).
 *   6. CONFIDENT— per type, the confidence histogram and the sub-0.7 ratio.
 *
 * Plus the standing-rule checks: empty symbol names, empty/unknown SymbolKind,
 * and relationship endpoints equal to the literal string `unknown` (rule R7).
 *
 * ## INCOMING: what the graph can walk TO, not only FROM
 *
 * `src/lsp/impact.ts` obtains reverse edges by SCANNING OUTGOING EDGES AND MATCHING
 * TARGETS — no inbound edge is stored. So the reverse walk is exactly as good as the
 * target-matching, and two things follow that are properties of the EDGES this
 * harness measures, not of the traversal code:
 *
 *   AMBIGUITY. A target that resolves to more than one published symbol is attributed
 *   to ONE of them by a rule nobody chose. PHP is dense with these: `calls` targets
 *   are LEAF names, and `runTest` is a method on more than one class in phpunit.
 *   Reported per type as `targetsByDeclCount` (1 / 2+ / 0) over DISTINCT targets, and
 *   as `edgesByTargetDeclCount` over EDGES, because `bb_impact` walks edges.
 *
 *   A NAME SET CANNOT EXPRESS AMBIGUITY. The first version of this harness resolved
 *   targets against a `Set<string>` of every symbol name in the sample, which answers
 *   "does any symbol have this name" and therefore reports an ambiguous target as
 *   RESOLVED — counting a name collision as a resolution. The declarations are now
 *   counted per name (`declsByName`), so "resolves" and "resolves to exactly one" are
 *   different numbers.
 *
 *   HOPELESS TARGETS. A target that is an external package, a filesystem path or a
 *   builtin is indistinguishable from a declaration that was never indexed. Those look
 *   identical in a count and are opposite findings, so the unresolved population is
 *   SPLIT, by declared tests, into:
 *
 *     pathShaped            — the target names a file (`/` or a `.php` suffix)
 *     qualifiedUndeclaredRoot — namespace-qualified, and its FIRST segment matches no
 *                           namespace declared in the sample (an external package
 *                           root, e.g. `Illuminate\...`)
 *     bareLeafUndeclared    — a leaf no file in the sample declares, and THIS is where
 *                           an indexing miss would live, so it is split again:
 *                             seenIn2PlusRepos — the same leaf called from two
 *                               independent repos that neither declares is cross-repo
 *                               evidence of an EXTERNAL library or builtin
 *                             seenIn1RepoOnly  — cannot be told apart from a
 *                               declaration this analyzer failed to publish
 *
 *   That last split is a BOUNDARY, not a solution: nothing in the graph distinguishes
 *   "external, not vendored here" from "ours, unpublished", and the harness says so
 *   rather than picking the flattering bucket.
 *
 * ## THREE INSTRUMENT DEFECTS THIS FILE HAD, all three found by reading its own output
 *
 * 1. `import` / `export` SYMBOLS were counted as DECLARATIONS. The analyzer publishes a
 *    symbol per `use` clause, so every imported class scored one declaration per importing
 *    file. A reference is not a declaration.
 * 2. Resolution took the MAX declaration count over the exact / first-segment /
 *    last-segment spellings, which manufactured ambiguity out of NAMESPACES: php publishes
 *    a `namespace` symbol in every file that declares one, so the `imports` target
 *    `PhpMyAdmin\Advisory\Advisor` matched 65 declarations of the name `PhpMyAdmin` and
 *    read as 65-way ambiguous. Nothing was ambiguous — one class is declared, under the leaf
 *    name php gives it. Resolution is now reported by TIER, and only a declaration the
 *    target actually names counts as one.
 * 3. The external/unindexed split asked how many repos DECLARE an unresolved name, and an
 *    unresolved name is declared by none — so every leaf scored 0 and the whole population
 *    fell into one bucket, which cannot separate a builtin like `isset` from a name of ours
 *    we failed to publish. It now asks how many repos emit an EDGE TO the name, which is
 *    the evidence that actually differs between the two.
 *
 * ## FALLBACK ACCOUNTING — a silent drop this harness used to have
 *
 * The first version read `if (r?.fallback) continue`: a file where `parseFile`
 * silently substituted its regex extractor was DROPPED from every tally with no
 * record, which is the degradation the wasm-temp-path fix (7a7f0810f) made
 * observable. A dropped file is an ABSENCE, and an absence reads exactly like a clean
 * run. Degraded files are now counted, named, EXCLUDED from the tallies (their edges
 * come from a regex extractor and would poison every rate), and the run EXITS 3 naming
 * them, so a published census is never a mixture.
 *
 * ## FAN-OUT and the 120s parseBomb
 *
 * `src/ast/engine.ts:1441` arms a 120s wall-clock self-destruct around the
 * SYNCHRONOUS `parser.parse()`. `parseFile`'s workers are async but the parse is not,
 * so N workers interleave on one thread and each file's arm-to-yield window absorbs
 * the other N-1 files' CPU time. Measured on 48 phpmyadmin test files:
 * p50 per-file 77-101 ms at 1 worker, 379-733 ms at 8 (~5-9x), max 1.3-1.6 s -> 2.6-3.4 s.
 * The timer is therefore a FALSE HANG REPORT under fan-out, not a parser defect:
 * `phpmyadmin/tests/unit/Controllers/Table/IndexRenameControllerTest.php` trips it at
 * 8 workers and parses in 2.9 s alone. BB_WORKERS is honoured below; the corpus runs
 * use 3. Reported, not fixed — engine.ts is shared machinery (lane brief §8).
 *
 * USAGE
 *   npx tsx validation/m14/fixtures/php/census-harness.mts            # full corpus
 *   BB_SAMPLE=200 npx tsx .../census-harness.mts                     # strided
 *   BB_REPOS=phpunit,phpmyadmin npx tsx .../census-harness.mts        # subset
 *   BB_JSON=1 npx tsx .../census-harness.mts > census.json
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
const TYPES: string[] = [...ALL_TYPES]

// ------------------------------------------------------------------ corpus
// IDENTICAL admission to ontology-coverage-gate.ts:196-209. Any divergence
// would make the two runs' counts incomparable, so it is written out rather
// than imported.
const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
const repoFilter = process.env.BB_REPOS ? process.env.BB_REPOS.split(",") : null
for (const e of readdirSync(CR)) {
  if (repoFilter && !repoFilter.includes(e)) continue
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "php") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
// Stable sort so a strided sample is reproducible and not directory-order
// dependent — the gate does not sort, and its draw therefore depends on
// readdir order. This lane's sample is declared, not inherited.
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
const SAMPLE = Number(process.env.BB_SAMPLE ?? 0)
const perRepo = new Map<string, number>()
for (const f of files) perRepo.set(f.repo, (perRepo.get(f.repo) ?? 0) + 1)
let selected = files
let sampling = "whole admitted corpus (no sampling)"
if (SAMPLE > 0) {
  // Strided PER REPO, so a large repo cannot crowd out a small one — the
  // failure mode a global stride has.
  const byRepo = new Map<string, typeof files>()
  for (const f of files) {
    const a = byRepo.get(f.repo) ?? []
    a.push(f)
    byRepo.set(f.repo, a)
  }
  selected = []
  for (const [repo, arr] of [...byRepo].sort()) {
    const take = Math.min(SAMPLE, arr.length)
    const stride = arr.length / take
    for (let i = 0; i < take; i++) selected.push(arr[Math.floor(i * stride)])
  }
  sampling = `strided per repo, floor(i*len/${SAMPLE}) over the sorted admitted list, capped at ${SAMPLE}/repo`
}

// ------------------------------------------------------------------ tallies
type Row = {
  n: number
  files: Set<string>
  conf: Map<number, number>
  bothResolved: number
  fromResolved: number
  toResolved: number
  metaFlags: Map<string, number>
  evidenceClasses: Map<string, number>
  examples: string[]
  /** EVERY edge's target, for the per-edge incoming figures. */
  edgeTargets: string[]
}
const rows = new Map<string, Row>()
const row = (t: string): Row => {
  let r = rows.get(t)
  if (!r) {
    r = { n: 0, files: new Set(), conf: new Map(), bothResolved: 0, fromResolved: 0, toResolved: 0, metaFlags: new Map(), evidenceClasses: new Map(), examples: [], edgeTargets: [] }
    rows.set(t, r)
  }
  return r
}
const kindTally = new Map<string, number>()
const kindsNotInEnum = new Set<string>()
const VALID_KINDS = new Set([
  "function", "class", "variable", "constant", "interface", "enum", "enum_member", "type", "import", "export",
  "method", "property", "constructor", "namespace", "module", "struct", "trait", "impl", "actor", "union",
  "mixin", "extension", "instance",
])
let symbols = 0
let emptyNames = 0
const emptyNameExamples: string[] = []
let unknownEndpoints = 0
const unknownEndpointExamples: string[] = []
let parseFail = 0
const parseFailFiles: string[] = []
let fallbackFiles = 0
const fallbackFileList: string[] = []
let filesWithSymbols = 0
// PROJECT-LEVEL resolution. An in-file rate alone cannot tell a defect from a
// cross-file shape: php's `calls` target is a LEAF name, so a call to
// `TestCase::runTest()` names a method this file does not declare and names a
// real one all the same. So every symbol name in the SAMPLE is kept, and each
// target is resolved twice — against its own file, and against the sample.
const corpusNames = new Set<string>()
/**
 * name -> the PUBLISHED DECLARATIONS carrying it, as `repo/rel:line`.
 *
 * A `Set<string>` cannot express ambiguity, and ambiguity is the question: a target
 * matching two declarations is attributed to one of them by a rule nobody chose, so
 * counting it as RESOLVED is how a name collision becomes a wrong refactor.
 */
const declsByName = new Map<string, Set<string>>()
/** name -> the REPOS whose files declare it. Separates a cross-repo external from a one-site miss. */
const reposByName = new Map<string, Set<string>>()
/**
 * target name -> the repos whose files emit an edge to it.
 *
 * The external-vs-unindexed split cannot use `reposByName`: that asks how many repos
 * DECLARE the name, and an unresolved name is by definition declared by NONE, so every
 * unresolved leaf scored 0 and the whole population landed in one bucket. The split is
 * vacuous that way — `isset` (a builtin) and a name we failed to publish look identical
 * because the test cannot separate them. What separates them is how INDEPENDENTLY the
 * name is used: a builtin is called from every repo, an unpublished declaration of ours
 * is called from the one repo that declares it.
 */
const reposTargeting = new Map<string, Set<string>>()
/** target name -> one file that emitted an edge to it, so an unresolved target is traceable. */
const firstFileForTarget = new Map<string, string>()
const declare = (nm: string, declId: string, repo: string): void => {
  let d = declsByName.get(nm)
  if (!d) { d = new Set(); declsByName.set(nm, d) }
  d.add(declId)
  let r = reposByName.get(nm)
  if (!r) { r = new Set(); reposByName.set(nm, r) }
  r.add(repo)
}
const targetsByType = new Map<string, Set<string>>()
// PHP's namespace separator is a BACKSLASH. An earlier version of this split
// only on `.`/`:`/`>` and so never reduced an FQN at all, understating
// `imports`/`extends` target resolution. Both ends are measured separately
// because they answer different questions and only reporting the first would
// understate a leaf-spelled index:
//   FIRST segment -> `Illuminate\Support\Facades\Route` -> `Illuminate`
//                    (the namespace root; only matches if the index spells
//                     namespaces as symbols, which php does — 4,442 of them)
//   LAST  segment -> `Illuminate\Support\Facades\Route` -> `Route`
//                    (the leaf; matches how class symbols are actually named)
/**
 * How many PUBLISHED DECLARATIONS a target name reaches, and — when zero — WHY.
 *
 * `resolvedTo` follows the same spellings the corpus-resolution numbers above accept
 * (exact, first segment, last segment) so the two figures are comparable, and
 * `declsFor` reports the declaration count behind the match, which is what turns
 * "resolves" into "resolves to exactly one".
 */
/**
 * Resolution TIER, and the number of declarations behind it.
 *
 * ## Why the tier is part of the answer
 *
 * The first version took the MAX declaration count over three spellings — exact, first
 * segment, last segment — which manufactured ambiguity out of namespaces. php publishes a
 * NAMESPACE symbol in every file that declares one, so the `imports` target
 * `PhpMyAdmin\Advisory\Advisor` matched 65 declarations of the name `PhpMyAdmin` and read
 * as 65-way ambiguous. Nothing was ambiguous: one class is declared, published under the
 * LEAF name php gives it, and the FQN is only the qualified spelling of that leaf.
 *
 * So the tiers are reported separately, and only the strong ones count as resolution:
 *
 *   exact     a declaration is named exactly this
 *   leaf      a declaration is named by the target's LAST segment — how php actually names
 *             classes and functions, so this is the CORRECT match for a qualified php name,
 *             not a weakening of the test
 *   rootOnly  only the namespace ROOT matches. NOT a resolution of the target and never
 *             counted as one; it is its own bucket, because "namespaced, root is ours, the
 *             name is not declared here" is a different finding from "no idea what this is"
 *   none      nothing matches at any tier
 */
const classify = (t: string): { tier: "exact" | "leaf" | "rootOnly" | "none"; n: number } => {
  const exact = declsByName.get(t)?.size ?? 0
  if (exact > 0) return { tier: "exact", n: exact }
  const leaf = declsByName.get(targetLast(t))?.size ?? 0
  if (leaf > 0) return { tier: "leaf", n: leaf }
  const root = declsByName.get(targetFirst(t))?.size ?? 0
  if (root > 0) return { tier: "rootOnly", n: 0 }
  return { tier: "none", n: 0 }
}
const declCountFor = (t: string): number => classify(t).n
/** How many REPOS emit an edge to this name — the cross-repo evidence, not declaration. */
const targetingRepos = (t: string): number => reposTargeting.get(t)?.size ?? 0
/** A filesystem path target: `require 'src/Foo.php'`, `include_once "a/b.php"`. */
const isPathShaped = (t: string): boolean => t.indexOf("/") >= 0 || t.endsWith(".php")
/** Namespace-qualified with a root that no file in the sample declares a namespace for. */
const isQualifiedWithUndeclaredRoot = (t: string): boolean => {
  if (t.indexOf("\\") < 0) return false
  const root = targetFirst(t)
  return !declsByName.has(root)
}
type Incoming = {
  /** Distinct-target resolution by tier. `rootOnly` is reported, never counted as resolved. */
  tiers: { exact: number; leaf: number; rootOnly: number; none: number }
  byDistinctTarget: { one: number; ambiguous: number; none: number }
  byEdge: { one: number; ambiguous: number; none: number }
  unresolvedSplit: { rootOnly: number; pathShaped: number; qualifiedUndeclaredRoot: number; bareLeafUndeclared: number }
  bareLeafUndeclaredBySpread: { seenIn2PlusRepos: number; seenIn1RepoOnly: number }
  ambiguousSamples: { target: string; declarations: number; repos: number }[]
  unresolvedSamples: string[]
}
const incomingFor = (t: string, edges: string[]): Incoming => {
  const byDistinctTarget = { one: 0, ambiguous: 0, none: 0 }
  const byEdge = { one: 0, ambiguous: 0, none: 0 }
  const tiers = { exact: 0, leaf: 0, rootOnly: 0, none: 0 }
  const unresolvedSplit = { rootOnly: 0, pathShaped: 0, qualifiedUndeclaredRoot: 0, bareLeafUndeclared: 0 }
  const bareLeafUndeclaredBySpread = { seenIn2PlusRepos: 0, seenIn1RepoOnly: 0 }
  const ambiguousSamples: Incoming["ambiguousSamples"] = []
  const unresolvedSamples: string[] = []
  const ts = targetsByType.get(t) ?? new Set<string>()
  for (const x of ts) {
    const cl = classify(x)
    tiers[cl.tier]++
    const dc = cl.n
    if (cl.tier === "rootOnly") {
      // Not a resolution, but not a mystery either: the namespace root is declared here
      // and the leaf is not. Counted with the unresolved population because the graph
      // cannot walk to it, and kept in its own sub-bucket so it is not confused with
      // `none` — the two have different fixes.
      byDistinctTarget.none++
      unresolvedSplit.rootOnly++
    } else if (dc === 0) {
      byDistinctTarget.none++
      if (isPathShaped(x)) unresolvedSplit.pathShaped++
      else if (isQualifiedWithUndeclaredRoot(x)) unresolvedSplit.qualifiedUndeclaredRoot++
      else {
        unresolvedSplit.bareLeafUndeclared++
        if (targetingRepos(x) >= 2) bareLeafUndeclaredBySpread.seenIn2PlusRepos++
        else bareLeafUndeclaredBySpread.seenIn1RepoOnly++
      }
      if (unresolvedSamples.length < 20) unresolvedSamples.push(`${x}  <- ${firstFileForTarget.get(x) ?? "?"}`)
    } else if (dc === 1) {
      byDistinctTarget.one++
    } else {
      byDistinctTarget.ambiguous++
      if (ambiguousSamples.length < 20) ambiguousSamples.push({ target: x, declarations: dc, repos: targetingRepos(x) })
    }
  }
  // bb_impact walks EDGES, so the per-edge figures are the ones a reverse traversal
  // meets; the distinct-target figures describe the NAME space.
  for (const x of edges) {
    const cl = classify(x)
    if (cl.tier === "rootOnly" || cl.n === 0) byEdge.none++
    else if (cl.n === 1) byEdge.one++
    else byEdge.ambiguous++
  }
  ambiguousSamples.sort((a, b) => b.declarations - a.declarations)
  return { tiers, byDistinctTarget, byEdge, unresolvedSplit, bareLeafUndeclaredBySpread, ambiguousSamples, unresolvedSamples }
}

const seg = (s: string) => s.split(/[.\\:>]+/).filter(Boolean)
const targetFirst = (s: string) => seg(s)[0] ?? s
const targetLast = (s: string) => { const a = seg(s); return a.length ? a[a.length - 1] : s }

// Endpoint resolution needs the FILE's own symbol set. A relationship whose
// source is a FILE (a module edge — `imports` is file-scoped in PHP) cannot
// resolve against it, so resolution is reported per type AND per endpoint side,
// and the `from` side is additionally resolved against the file's own relative
// path so a module edge is not silently counted as unresolved.
let idx = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= selected.length) return
    const f = selected[i]
    let r: any
    try {
      r = await parseFile(f.abs, f.dir)
    } catch (err) {
      parseFail++
      if (parseFailFiles.length < 20) parseFailFiles.push(`${f.repo}/${f.rel}: ${(err as any)?.message ?? String(err)}`)
      continue
    }
    const label = `${f.repo}/${f.rel}`
    // COUNTED, not silently dropped. See the header: a degraded file is an absence,
    // and an absence reads exactly like a clean run. Excluded from the tallies (its
    // edges come from a regex extractor) and fatal to the run, so a published census
    // can never be a mixture.
    if (r?.fallback) {
      fallbackFiles++
      if (fallbackFileList.length < 25) fallbackFileList.push(label)
      continue
    }
    const syms: any[] = r?.symbols ?? []
    if (syms.length) filesWithSymbols++
    const names = new Set<string>()
    for (const s of syms) {
      symbols++
      const k = String((s as any)?.kind ?? "")
      kindTally.set(k, (kindTally.get(k) ?? 0) + 1)
      if (!VALID_KINDS.has(k)) kindsNotInEnum.add(k)
      const nm = String((s as any)?.name ?? "")
      if (nm.trim() === "") {
        emptyNames++
        if (emptyNameExamples.length < 10) emptyNameExamples.push(`${label} kind=${k}`)
      }
      // A symbol's own identity as the analyzer spells it, plus the
      // qualified spellings an edge may legitimately use.
      if (nm) {
        names.add(nm)
        const owner = (s as any).ownerName
        if (owner) {
          names.add(`${owner}.${nm}`)
          names.add(`${owner}::${nm}`)
        }
      }
      const qn = (s as any).qualifiedName
      if (qn) names.add(String(qn))
      // Publish the DECLARATION, not just the name. The name alone cannot answer
      // "does this target resolve to exactly one declaration", which is the question
      // the reverse walk actually asks. Identity is repo/rel:line, so two symbols that
      // share a name in two files are two declarations, not one name.
      // An `import` / `export` SYMBOL is a reference the analyzer publishes, not a
      // declaration something owns. Counting them made every `use`d class look 65-way
      // ambiguous on phpmyadmin (one import symbol per importing file), which reads as
      // a resolution finding and is an artifact of the instrument.
      const isDeclaration = k !== "import" && k !== "export"
      if (nm.trim() !== "" && isDeclaration) {
        const line = (s as any).line ?? (s as any).startLine ?? 0
        declare(nm, `${label}:${line}`, f.repo)
        const qnS = qn ? String(qn) : ""
        if (qnS && qnS !== nm) declare(qnS, `${label}:${line}`, f.repo)
        const owner = (s as any).ownerName
        if (owner) {
          declare(`${owner}.${nm}`, `${label}:${line}`, f.repo)
          declare(`${owner}::${nm}`, `${label}:${line}`, f.repo)
        }
      }
    }
    for (const n of names) corpusNames.add(n)
    // File-scope identities: a PHP module edge names the FILE, and the
    // analyzer spells it from the relative path. Two spellings are accepted —
    // the full relative path and the basename — because which one production
    // uses is itself a measurement, not an assumption.
    names.add(f.rel)
    names.add(path.basename(f.rel))
    names.add(f.rel.replace(/\.php$/, ""))
    names.add(path.basename(f.rel).replace(/\.php$/, ""))
    names.add(f.repo + "/" + f.rel)

    for (const x of (r?.relationships ?? []) as any[]) {
      const t = String(x?.type ?? x?.relationshipType ?? "").toLowerCase()
      const rw = row(t)
      rw.n++
      if (rw.files.size < 4000) rw.files.add(label)
      const c = typeof x?.confidence === "number" ? x.confidence : -1
      rw.conf.set(c, (rw.conf.get(c) ?? 0) + 1)
      const ec = String((x?.metadata as any)?.evidenceClass ?? (x as any).evidenceClass ?? "(none)")
      rw.evidenceClasses.set(ec, (rw.evidenceClasses.get(ec) ?? 0) + 1)
      for (const [k, v] of Object.entries((x?.metadata ?? {}) as Record<string, any>)) {
        if (v === true || typeof v === "number" || typeof v === "string") {
          rw.metaFlags.set(k, (rw.metaFlags.get(k) ?? 0) + 1)
        }
      }
      const from = String(x?.from ?? x?.source ?? x?.fromSymbol ?? "")
      const to = String(x?.to ?? x?.target ?? x?.toSymbol ?? "")
      let ts = targetsByType.get(t)
      if (!ts) {
        ts = new Set()
        targetsByType.set(t, ts)
      }
      if (to !== "") {
        ts.add(to)
        rw.edgeTargets.push(to)
        let rt = reposTargeting.get(to)
        if (!rt) { rt = new Set(); reposTargeting.set(to, rt) }
        rt.add(f.repo)
        if (!firstFileForTarget.has(to)) firstFileForTarget.set(to, label)
      }
      if (from === "unknown" || to === "unknown") {
        unknownEndpoints++
        if (unknownEndpointExamples.length < 10) unknownEndpointExamples.push(`${t} ${label}: ${from} -> ${to}`)
      }
      const fr = from !== "" && names.has(from)
      const tr = to !== "" && names.has(to)
      if (fr) rw.fromResolved++
      if (tr) rw.toResolved++
      if (fr && tr) rw.bothResolved++
      if (rw.examples.length < 3) rw.examples.push(`${from} -> ${to}`)
    }
  }
}
const WORKERS = Number(process.env.BB_WORKERS ?? 8)
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

// ------------------------------------------------------------------ grammar inventory (Instrument A)
// Instrument A walks the raw wasm, NOT the pipeline, so it is roughly an order
// of magnitude cheaper than the relationship pass and sweeps the WHOLE admitted
// corpus by default even when the relationship census is sampled. The two
// denominators are therefore different and BOTH are printed: a ruling about
// what the grammar can express is a claim about the corpus, so it gets the
// corpus.
const grammarFiles = process.env.BB_GRAMMAR_SAMPLE ? selected : files
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-php.wasm"))))
const nodeTypes = new Map<string, number>()
for (const f of grammarFiles) {
  const t = parser.parse(f.text)
  if (!t) continue
  const v = (n: any) => {
    nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1)
    for (let i = 0; i < n.childCount; i++) v(n.child(i))
  }
  v(t.rootNode)
  t.delete?.()
}

// ------------------------------------------------------------------ report
const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(1)}%`)
const out: any = {
  generatedAt: new Date().toISOString(), corpusRoot: CR, sampling, workers: WORKERS,
  filesAdmitted: files.length, filesSampled: selected.length, grammarInventoryFiles: grammarFiles.length,
  filesByRepo: Object.fromEntries([...perRepo].sort()), filesWithSymbols, parseFail, parseFailFiles,
  // PUBLISHED, not silently dropped. `fallbackFiles > 0` means parseFile substituted
  // its regex extractor for these files, so every rate below is computed over a corpus
  // smaller than `filesSampled` and the run exits 3.
  fallbackFiles, fallbackFileList,
  // The denominator every rate below is computed over. Equal to filesSampled on a clean
  // run; smaller by exactly the fallback count when BB_ALLOW_FALLBACK=1 published a
  // degraded one, so a reader never has to derive it.
  filesAnalyzed: selected.length - fallbackFiles,
  degradedRunPublished: fallbackFiles > 0,
  symbols,
}
out.relationships = {}
for (const t of [...rows.keys()].sort()) {
  const r = rows.get(t)!
  const heur = [...r.conf].filter(([c]) => c >= 0 && c < 0.7).reduce((a, [, v]) => a + v, 0)
  out.relationships[t] = {
    count: r.n,
    files: r.files.size,
    confHistogram: Object.fromEntries([...r.conf].sort((a, b) => a[0] - b[0])),
    heuristicUnder07: heur,
    heuristicPct: pct(heur, r.n),
    fromResolved: r.fromResolved,
    toResolved: r.toResolved,
    bothResolved: r.bothResolved,
    bothResolvedPct: pct(r.bothResolved, r.n),
    distinctTargets: targetsByType.get(t)?.size ?? 0,
    distinctTargetsResolvingInSample: (() => {
      const ts = targetsByType.get(t)
      if (!ts) return 0
      let ok = 0
      for (const x of ts) if (corpusNames.has(x) || corpusNames.has(targetFirst(x)) || corpusNames.has(targetLast(x))) ok++
      return ok
    })(),
    distinctTargetsResolvingByFirstSegment: (() => {
      const ts = targetsByType.get(t)
      if (!ts) return 0
      let ok = 0
      for (const x of ts) if (corpusNames.has(x) || corpusNames.has(targetFirst(x))) ok++
      return ok
    })(),
    distinctTargetsResolvingByLastSegment: (() => {
      const ts = targetsByType.get(t)
      if (!ts) return 0
      let ok = 0
      for (const x of ts) if (corpusNames.has(x) || corpusNames.has(targetLast(x))) ok++
      return ok
    })(),
    incoming: incomingFor(t, r.edgeTargets),
    evidenceClasses: Object.fromEntries([...r.evidenceClasses].sort((a, b) => b[1] - a[1])),
    metadataFlags: Object.fromEntries([...r.metaFlags].sort((a, b) => b[1] - a[1])),
    examples: r.examples,
  }
}
out.symbolKinds = Object.fromEntries([...kindTally].sort((a, b) => b[1] - a[1]))
out.kindsNotInSymbolKindEnum = [...kindsNotInEnum]
out.emptySymbolNames = { count: emptyNames, examples: emptyNameExamples }
out.unknownEndpoints = { count: unknownEndpoints, examples: unknownEndpointExamples }
out.grammarNodeTypes = { distinct: nodeTypes.size, inventory: Object.fromEntries([...nodeTypes].sort((a, b) => b[1] - a[1])) }
out.allTenTypes = TYPES.map((t) => ({ type: t, emitted: (rows.get(t)?.n ?? 0) > 0 }))

// A degraded run must not be publishable BY DEFAULT. The wasm-temp-path collision made
// `parseFile` substitute a regex extractor SILENTLY, so a mixture of real and regex-derived
// edges reads exactly like a clean census unless it is made fatal — and this guard fired on
// its first real use, on 2 of 4,642 files whose `parser.parse()` throws a wasm
// "memory access out of bounds" and are therefore served by that extractor.
//
// BB_ALLOW_FALLBACK=1 publishes anyway, and the price is that the artifact then records the
// exclusion and every denominator is the ANALYZED count rather than the admitted count. That
// is the only honest way to get a number out of a corpus with unparseable files in it:
// silently dropping them (what this harness used to do) makes a smaller corpus read as a
// complete one, and refusing outright leaves the lane with no figure at all.
const ALLOW_FALLBACK = process.env.BB_ALLOW_FALLBACK === "1"
if (fallbackFiles > 0) {
  const msg =
    `CENSUS DEGRADED — ${fallbackFiles} of ${selected.length} files fell back to parseFile's regex extractor and were EXCLUDED from every tally above.\n` +
    `  ${fallbackFileList.slice(0, 25).join("\n  ")}\n` +
    `  Every rate above is over ${selected.length - fallbackFiles} files, not ${selected.length}.\n`
  if (!ALLOW_FALLBACK) {
    process.stderr.write(`\n${msg}  Not publishing. Re-run with BB_ALLOW_FALLBACK=1 to publish with the exclusion recorded.\n`)
    process.exit(3)
  }
  process.stderr.write(`\n${msg}  BB_ALLOW_FALLBACK=1 — publishing with filesAnalyzed recorded in the artifact.\n`)
}

if (process.env.BB_JSON) {
  console.log(JSON.stringify(out, null, 2))
} else {
  const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
  console.log(`php ontology census — ${new Date().toISOString()}`)
  console.log(`corpus: ${CR}`)
  console.log(`admitted: ${files.length} files   sampled: ${selected.length}   sampling: ${sampling}`)
  console.log(`files by repo: ${[...perRepo].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ")}`)
  console.log(`parseFile failures: ${parseFail}${parseFail ? ` (${parseFailFiles.slice(0, 3).join(" | ")})` : ""}`)
  console.log(`parseFile FALLBACK (regex extractor substituted, excluded from every tally below): ${fallbackFiles}${fallbackFiles ? ` ${JSON.stringify(fallbackFileList.slice(0, 5))}` : ""}`)
  console.log(`files ANALYZED (the denominator for every rate below): ${selected.length - fallbackFiles} of ${selected.length} admitted`)
  console.log(`workers: ${WORKERS}  (see the header: the 120s parseBomb false-fires under fan-out)`)
  console.log(`symbols: ${symbols}   files with >=1 symbol: ${filesWithSymbols}`)
  console.log(`EMPTY symbol names: ${emptyNames}${emptyNames ? " " + JSON.stringify(emptyNameExamples.slice(0, 3)) : ""}`)
  console.log(`SymbolKind values outside the enum: ${out.kindsNotInSymbolKindEnum.length ? JSON.stringify(out.kindsNotInSymbolKindEnum) : "0"}`)
  console.log(`endpoints === literal "unknown": ${unknownEndpoints}${unknownEndpoints ? " " + JSON.stringify(unknownEndpointExamples.slice(0, 3)) : ""}`)
  console.log("")
  console.log(`${w("type", 14)}${w("count", 10)}${w("files", 8)}${w("heur<0.7", 11)}${w("from res", 10)}${w("to res", 9)}${w("both res", 10)}${w("tgt", 8)}${w("tgt->sample", 12)}confidence histogram`)
  console.log("-".repeat(150))
  for (const t of TYPES) {
    const r = rows.get(t)
    if (!r || r.n === 0) {
      console.log(`${w(t, 14)}${w("0", 10)}${w("-", 8)}${w("-", 11)}${w("-", 10)}${w("-", 9)}${w("-", 10)}${w("-", 8)}${w("-", 12)}NOT EMITTED`)
      continue
    }
    const heur = [...r.conf].filter(([c]) => c >= 0 && c < 0.7).reduce((a, [, v]) => a + v, 0)
    const hist = [...r.conf].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}:${n}`).join(" ")
    const tg = out.relationships[t]
    console.log(`${w(t, 14)}${w(r.n.toLocaleString(), 10)}${w(r.files.size.toLocaleString(), 8)}${w(`${heur} (${pct(heur, r.n)})`, 11)}${w(pct(r.fromResolved, r.n), 10)}${w(pct(r.toResolved, r.n), 9)}${w(pct(r.bothResolved, r.n), 10)}${w(tg.distinctTargets.toLocaleString(), 8)}${w(`${tg.distinctTargetsResolvingInSample} (${pct(tg.distinctTargetsResolvingInSample, tg.distinctTargets)})`, 12)}${hist}`)
  }
  console.log("-".repeat(150))
  console.log("`tgt` = DISTINCT targets, `tgt->sample` = distinct targets that name a symbol declared somewhere in the sample.")
  console.log("")
  console.log("INCOMING — what the reverse walk meets. `1 / 2+ / 0` is the PUBLISHED DECLARATION COUNT a target reaches.")
  console.log("A target matching 2+ declarations is attributed to ONE of them by a rule nobody chose, so it is counted separately from a clean resolution.")
  console.log("")
  console.log(`${w("type", 14)}${w("tier exact/leaf/root/none", 25)}${w("tgt 1/2+/0", 20)}${w("edges 1/2+/0", 22)}${w("unres root/ns/leaf/path", 24)}${w("leaf >=2repos", 18)}`)
  console.log("-".repeat(150))
  for (const t of TYPES) {
    const tg = out.relationships[t]
    if (!tg) continue
    const i = tg.incoming
    const dt = i.byDistinctTarget
    const be = i.byEdge
    const u = i.unresolvedSplit
    const ti = i.tiers
    console.log(`${w(t, 14)}${w(`${ti.exact}/${ti.leaf}/${ti.rootOnly}/${ti.none}`, 25)}${w(`${dt.one}/${dt.ambiguous}/${dt.none}`, 20)}${w(`${be.one}/${be.ambiguous}/${be.none}`, 22)}${w(`${u.rootOnly}/${u.qualifiedUndeclaredRoot}/${u.bareLeafUndeclared}/${u.pathShaped}`, 24)}${w(`${i.bareLeafUndeclaredBySpread.seenIn2PlusRepos} vs ${i.bareLeafUndeclaredBySpread.seenIn1RepoOnly}`, 18)}`)
  }
  console.log("-".repeat(150))
  console.log("tier = how a target matched a published declaration: exact | leaf (php names classes and functions by leaf)")
  console.log("       | rootOnly (only the namespace root matches — NOT a resolution) | none.")
  console.log("unres root = rootOnly; ns = namespace-qualified with an undeclared root (external package);")
  console.log("path = the target names a file;")
  console.log("leaf = a leaf nothing in the sample declares, split by how many repos CALL it without declaring it.")
  console.log("The last two columns are a BOUNDARY, not a solution: nothing in the graph tells an unvendored external")
  console.log("from a declaration this analyzer failed to publish. `leaf in >=2 repos` is the external-consistent side.")
  for (const t of TYPES) {
    const tg = out.relationships[t]
    if (!tg) continue
    if (tg.incoming.ambiguousSamples.length) console.log(`  most-declared ${t} targets: ${tg.incoming.ambiguousSamples.slice(0, 6).map((a) => `${a.target}(${a.declarations} decls/${a.repos} repos)`).join("  ")}`)
  }
  console.log(`distinct symbol names in the sample: ${corpusNames.size}`)
  console.log(`symbol kinds: ${Object.entries(out.symbolKinds).map(([k, v]) => `${k}=${v}`).join("  ")}`)
  console.log("")
  console.log(`grammar inventory (Instrument A): ${nodeTypes.size} distinct node types across ${grammarFiles.length} admitted files`)
  for (const t of TYPES) {
    const r = rows.get(t)
    if (r && r.n > 0) continue
    console.log(`  NOT EMITTED: ${t}`)
  }
  console.log("")
  console.log("node types that would express an EXPORT-like construct, and their observed counts:")
  for (const n of ["export_statement", "export_declaration", "export_list", "module_exports", "public_export", "export_specifier", "expose", "export_clause", "export_from_clause", "re_export"]) {
    const c = nodeTypes.get(n) ?? 0
    console.log(`  ${w(n, 24)}${c}${c ? "  <-- PRESENT" : ""}`)
  }
  console.log("")
  console.log("node types that DO express import-like constructs, for contrast:")
  for (const n of ["namespace_use_declaration", "namespace_use_clause", "namespace_use_group", "require_expression", "include_expression"]) {
    console.log(`  ${w(n, 28)}${nodeTypes.get(n) ?? 0}`)
  }
  console.log("")
  console.log("full node-type inventory:")
  console.log(Object.entries(out.grammarNodeTypes.inventory).map(([k, v]) => `${k}:${v}`).join(" "))
}
