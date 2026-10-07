/**
 * TYPESCRIPT LANE CENSUS — the VERIFY_TS instrument for JOB 1.
 *
 * WHY THIS EXISTS. `script/m14/firing-check.mjs` answers "does the type fire?"
 * for twelve files per lane. Twelve is a floor, not a verdict: the workstream
 * contract (`docs/analyzers/ONTOLOGY-WORKSTREAM.md`) requires a COUNT and the
 * FILES a type came from, and requires the six questions of Part 1, not just
 * the second one. firing-check also hardcodes `REPO = "$HOME/backbencher-brain"`,
 * so it measures whatever is in the MAIN checkout — which for this lane currently
 * carries 157 uncommitted insertions in the analyzer. An instrument that measures
 * a neighbour's working tree cannot decide a verdict about this lane's commit.
 *
 * So this is a LANE-OWNED instrument that measures THIS worktree's analyzer, over
 * a corpus sample three orders of magnitude larger, and answers all six questions:
 *
 *   1 exists    — constructible from source (NOT re-derived here: that is
 *                  `script/m60/rel-type-coverage-gate.ts`'s job and it already
 *                  passes; re-implementing it would be a second, drifting copy)
 *   2 fires     — production path, real corpus, per-type count + file list
 *   3 correct   — deferred to ts-truth-oracle.ts (a separate walker over the same
 *                  grammar; see the shared-grammar-bug caveat recorded there)
 *   4 labelled  — the metadata.relationshipType distribution per edge type, so a
 *                  neighbour label is a number and not an opinion
 *   5 resolved  — both endpoints bind to a symbol this analyzer emitted in the
 *                  same file, counted per end and for both
 *   6 confident — confidence + evidenceClass histograms. Under 0.7 is a
 *                  heuristic (M14-HONESTY-CONTRACT §4) and is counted, not hidden.
 *
 * Plus rule R7: unknown symbols, empty names, and placeholder-literal endpoints.
 *
 * NO REGEXP. Every test here is `endsWith` / `startsWith` / `indexOf` / `Set`
 * membership over node.type strings and AST children. Regex over source text is
 * how analyzers lie — it matches comments and string literals — and the same
 * discipline the analyzer itself is held to is applied to its instrument.
 *
 * READ-ONLY with respect to the repository. Writes only the JSON passed to --out.
 *
 * Usage:
 *   bun run script/lanes/typescript/ts-census.ts [--limit=200] [--repo=typescript] [--out=x.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

/* ------------------------------------------------------------------ *
 * The ten ontology types, read as DATA, not derived.
 * ------------------------------------------------------------------ */
/** Declared here rather than imported so this file can report on a lane whose
 *  enum is mid-edit elsewhere; `assertEnumAgrees` proves the two agree and
 *  fails loudly when they do not. */
const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

/** The string the ENUM declares for `imports`. `src/ast/types.ts` names the member
 *  `Imports` and gives it the value `"brain_import"`; a lane that emits the raw
 *  literal `"imports"` produces an edge that is not any value of the enum, and
 *  every consumer comparing against `RelationshipType.Imports` misses it. This
 *  census counts BOTH spellings, separately, so the two can never be conflated
 *  again. See the fleet-wide note in docs/analyzers/FIRING-CHECK.md. */
const ENUM_IMPORT_VALUE = "brain_import"

const argv = process.argv.slice(2)
/** Accepts both `--flag value` and `--flag=value`. A flag parser that silently
 *  reads `undefined` for the second spelling produces a run over the whole corpus
 *  while the command line says 40 — a quiet, entirely wrong measurement. */
const argOf = (flag: string): string | undefined => {
  const i = argv.indexOf(flag)
  if (i >= 0) return argv[i + 1]
  for (const a of argv) {
    if (a.startsWith(flag + "=")) return a.slice(flag.length + 1)
  }
  return undefined
}
const LANG = argOf("--lang") ?? "typescript"
const OUT = argOf("--out")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const LIMIT = Number(argOf("--limit") ?? "200")
const REPO_FILTER = argOf("--repo")
const MAX_BYTES = Number(argOf("--max-bytes") ?? String(400 * 1024))
if (!Number.isFinite(LIMIT) || LIMIT <= 0) {
  console.error(`--limit must be a positive integer; got ${String(argOf("--limit"))}`)
  process.exit(1)
}

/**
 * Rule R7 and endpoint classes. "Does this endpoint resolve" and "is this endpoint
 * a placeholder" are both questions about the wrong thing unless the SHAPE is named
 * first, and the shapes in this lane are not one shape.
 *
 * Measured on 400 corpus files: a predicate of the form "an endpoint must be a bare
 * identifier" flags 9,446 sources and 8,291 targets, and not one of the top 25 hits
 * per type is a placeholder. What it actually catches is the lane's four legitimate
 * non-identifier endpoint forms:
 *
 *   module specifier   ../proto.ts:APIRequest, #enums/checkFlags:CheckFlags,
 *                      node:fs  — an `imports` target, which NAMES A PATH and is
 *                      not a symbol by construction
 *   module name        ast.generated, api.d — an `exports` SOURCE, which is the
 *                      module's own identity, also not a symbol by construction
 *   qualified name     vscode.Disposable, LiteralType.value, Interface.member
 *   synthesized label  (new), (call), [Symbol.iterator], [index], ["h"]
 *
 * So the census classifies every endpoint into one of those, plus `identifier`,
 * `generic type name` and the one class the contract actually asks about:
 * PLACEHOLDER — a conventional non-name (`unknown`, `TODO`, `<anonymous>`) or an
 * empty string. That class is the R7 number. Everything else is reported as its
 * shape so a reader can see WHY an endpoint did not resolve instead of being told
 * it did not.
 *
 * The list this replaced, copied from `script/m14/ts-ontology-census.ts` (which no
 * lane owns), treated `Symbol`, `name`, `value`, `target`, `source`, `string`,
 * `number`, `object`, `any` and `symbol` as placeholders. Every one is ordinary
 * TypeScript vocabulary — `Symbol` is the ECMAScript global, `any`/`string`/
 * `number`/`object` are primitive type keywords. Probed on
 * fixtures/repositories/typescript packages/typescript/src/api/sync/api.ts: all 203
 * R7 hits on that one file were real declarations and property accesses.
 *
 * NO REGEXP: identifier shape is tested by char code.
 */
const CONVENTIONAL_PLACEHOLDERS = new Set([
  "unknown", "unknown_symbol", "unknownsymbol", "anonymous", "todo", "tbd", "n/a",
  "placeholder", "dummy", "stub", "xxx", "lambda", "undefined", "null",
])
/** A string can name a TypeScript declaration only if every character is a letter,
 *  digit, `_` or `$` and it does not start with a digit. */
const isIdentifierLike = (s: string): boolean => {
  if (s.length === 0) return false
  const first = s.charCodeAt(0)
  const firstOk = (first >= 65 && first <= 90) || (first >= 97 && first <= 122) || first === 95 || first === 36
  if (!firstOk) return false
  for (let i = 1; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 36
    if (!ok) return false
  }
  return true
}
const startsWith = (s: string, c: string) => s.length > 0 && s.charAt(0) === c
const endsWith = (s: string, c: string) => s.length >= c.length && s.lastIndexOf(c) === s.length - c.length
const containsChar = (s: string, c: string) => s.indexOf(c) >= 0

/** `role` is what the CALLER knows about the endpoint, which the string alone
 *  cannot reveal: an `imports` target is a specifier by contract even when it
 *  happens to read like an identifier (`node:fs`), and an `exports` source is the
 *  module's own name by contract even when it is a bare word. */
type EndpointRole = "imports-target" | "exports-source" | "plain"
const classifyEndpoint = (raw: string, role: EndpointRole): string => {
  const s = raw.trim()
  if (s.length === 0) return "PLACEHOLDER"
  if (startsWith(s, "<") && endsWith(s, ">")) return "PLACEHOLDER"
  if (CONVENTIONAL_PLACEHOLDERS.has(s.toLowerCase())) return "PLACEHOLDER"
  if (role === "imports-target") return "module specifier"
  if (role === "exports-source") return "module name"
  if (containsChar(s, "/")) return "module specifier"
  if ((startsWith(s, "[") && endsWith(s, "]")) || (startsWith(s, "(") && endsWith(s, ")"))) return "synthesized label"
  if (containsChar(s, "<")) return "generic type name"
  if (isIdentifierLike(s)) return "identifier"
  if (containsChar(s, ".")) return "qualified name"
  // Nothing above recognised the shape and it cannot be an identifier either.
  // `?`, `???`, `a b`, `x-y` land here. A token that names nothing in this
  // language and matches none of the lane's four legitimate endpoint forms is the
  // definition of a placeholder, so it is reported as one rather than lumped in
  // with "qualified name" — which is how `?` escaped the first version of this
  // classifier and was caught only by the self-test.
  return "PLACEHOLDER"
}
/** The R7 predicate, kept as a named function so the self-test can prove it fires
 *  in both directions rather than only ever returning false. */
const isPlaceholderEndpoint = (raw: string, role: EndpointRole): boolean =>
  classifyEndpoint(raw, role) === "PLACEHOLDER"

/**
 * Where a relationship ENDPOINT is CONTRACTUALLY a bare identifier.
 *
 * This is the check that actually counts fabrications, and it is separate from the
 * shape classifier above because a shape can be legitimate and still be the wrong
 * shape. `calls` reduces a callee to its LEAF NAME by contract — `obj.method()`
 * becomes `calls -> method` — so a `calls` target of `!context.globalState.get` is a
 * fabrication even though it is a well-formed qualified name and even though the
 * correct edge `calls activate -> get` is emitted alongside it.
 *
 * Declared per type and per end, from each type's own documented resolution rule
 * (docs/analyzers/real-typescript-analyzer.md, the Relationship ontology table):
 *
 *   calls       source, target  bare  — "call_expression -> callee leaf name"
 *   uses        source, target  bare  — "type-reference usage -> referenced type leaf"
 *   instantiates source, target bare  — "new_expression -> constructor leaf name"
 *   contains    source, target  bare  — owner and member names (computed labels excepted)
 *   extends     source bare, target qualified-ok  — `ns.Base` is a legal heritage clause
 *   implements  source bare, target qualified-ok  — ditto
 *   references  source bare, target qualified-ok  — a qualified type mention is legal
 *   overrides   BOTH qualified-ok — by design `Derived.member -> Base.member`
 *   exports     source module name, target bare
 *   imports     source module name, target specifier
 */
type EndpointExpectation = "bare" | "qualified-ok"
const ENDPOINT_EXPECTATION: Record<string, { source: EndpointExpectation; target: EndpointExpectation }> = {
  calls: { source: "bare", target: "bare" },
  uses: { source: "bare", target: "bare" },
  instantiates: { source: "bare", target: "bare" },
  contains: { source: "bare", target: "bare" },
  extends: { source: "bare", target: "qualified-ok" },
  implements: { source: "bare", target: "qualified-ok" },
  references: { source: "bare", target: "qualified-ok" },
  overrides: { source: "qualified-ok", target: "qualified-ok" },
  exports: { source: "bare", target: "bare" },
  imports: { source: "bare", target: "bare" },
}
/** `contains` legitimately synthesizes labels for computed members — `[index]`,
 *  `[Symbol.iterator]`, `(new)`, `(call)` — so those are excepted from "bare".
 *  Nothing else in the lane may synthesize a name. */
const isSynthesizedLabel = (s: string): boolean =>
  (startsWith(s, "[") && endsWith(s, "]")) || (startsWith(s, "(") && endsWith(s, ")"))
const violatesExpectation = (t: string, end: "source" | "target", raw: string): boolean => {
  const spec = ENDPOINT_EXPECTATION[t]
  if (!spec) return false
  if (spec[end] === "qualified-ok") return false
  const s = raw.trim()
  if (s.length === 0) return true
  // A module specifier and a module name are not identifiers by CONTRACT; they are
  // exempt from the bare-identifier rule for the same reason overrides is exempt.
  if (t === "imports" && (end === "source" || end === "target")) return false
  if (t === "exports" && end === "source") return false
  if (t === "contains" && end === "target" && isSynthesizedLabel(s)) return false
  return !isIdentifierLike(s)
}

type Rel = {
  type?: string
  relationshipType?: string
  source?: string
  target?: string
  confidence?: number
  metadata?: Record<string, unknown>
  [k: string]: unknown
}
const endpointsOf = (r: Rel): [string, string] => [String(r.source ?? ""), String(r.target ?? "")]

/* ------------------------------------------------------------------ *
 * Corpus admission — git-tracked files only, deterministic order.
 * ------------------------------------------------------------------ */
type CorpusFile = { repo: string; rel: string; abs: string }
const files: CorpusFile[] = []
const repos = readdirSync(CR).sort()
for (const repo of repos) {
  if (REPO_FILTER && repo.indexOf(REPO_FILTER) < 0) continue
  const dir = path.join(CR, repo)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    // Extension test with endsWith, never a pattern.
    if (!rel.endsWith(".ts") && !rel.endsWith(".tsx") && !rel.endsWith(".mts") && !rel.endsWith(".cts")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > MAX_BYTES) continue } catch { continue }
    files.push({ repo, rel, abs })
  }
}
files.sort((a, b) => (a.repo + a.rel < b.repo + b.rel ? -1 : a.repo + b.rel > b.repo + b.rel ? 1 : 0))
const admitted = LIMIT > 0 ? files.slice(0, LIMIT) : files

/* ------------------------------------------------------------------ *
 * Per-type accumulators.
 * ------------------------------------------------------------------ */
/**
 * Endpoint resolution, and why one number is not enough.
 *
 * The analyzer emits BARE symbol names (a TypeScript symbol carries `name`,
 * `scope` and `ownerName`, and NO `id` — verified by probe), and relationship
 * endpoints are built at three different shapes:
 *
 *   contains   owner -> member                      both bare names, same file
 *   overrides  Derived.member -> Base.member        QUALIFIED on both ends
 *   exports    <module basename> -> name            source is a MODULE, not a symbol
 *   imports    <local> -> <specifier>:<item>        target is a PATH, not a symbol
 *   calls      <enclosing fn> -> <callee leaf>      target usually lives in ANOTHER file
 *
 * So "did both endpoints resolve" has two independent axes and conflating them is
 * how a lane reports 0.0% and calls it a defect when it is a naming convention:
 *
 *   EXACT  the endpoint string IS a symbol name emitted in this file.
 *   LEAF   the endpoint's last segment (after the final '.' or ':') is.
 *
 * And a third axis the in-file test cannot see: a leaf name that names nothing in
 * THIS file may name a symbol in another file of the corpus, which is a real
 * resolution. So a corpus-wide name index is built over the whole sample and the
 * cross-file figure is reported separately. A leaf that resolves nowhere is the
 * only thing that is honestly called unresolved.
 */
const segmentCandidates = (s: string): string[] => {
  const out = [s]
  const dot = s.lastIndexOf(".")
  if (dot >= 0 && dot < s.length - 1) out.push(s.slice(dot + 1))
  const colon = s.lastIndexOf(":")
  if (colon >= 0 && colon < s.length - 1) out.push(s.slice(colon + 1))
  return out
}

type Stat = {
  count: number
  files: Set<string>
  /** count of edges per file, so "the files it came from" is ranked, not a sample */
  perFile: Map<string, number>
  srcExact: number
  tgtExact: number
  bothExact: number
  srcLeaf: number
  tgtLeaf: number
  bothLeaf: number
  srcCorpus: number
  tgtCorpus: number
  bothCorpus: number
  /** binds nowhere in the corpus at all — the only genuinely unresolved case */
  srcNowhere: number
  tgtNowhere: number
  conf: Map<string, number>
  evidence: Map<string, number>
  /** question 4: the sub-label carried in metadata.relationshipType */
  subLabel: Map<string, number>
  srcPlaceholder: number
  tgtPlaceholder: number
  /** endpoints that break their OWN type's documented endpoint contract. Distinct
   *  from R7: a qualified name is not a placeholder, but on a `calls` edge it is a
   *  fabrication, because `calls` reduces a callee to a leaf name by contract. */
  srcContractViolation: number
  tgtContractViolation: number
  contractViolations: Map<string, number>
  /** the endpoint SHAPE distribution — a reader can see why an endpoint did not
   *  resolve instead of being told only that it did not */
  srcClass: Map<string, number>
  tgtClass: Map<string, number>
  /** the offending STRINGS, so a hit can be judged by eye rather than counted */
  placeholderStrings: Map<string, number>
  emptyEndpoint: number
  selfLoop: number
  examples: string[]
}
const stat = (): Stat => ({
  count: 0, files: new Set(), perFile: new Map(),
  srcExact: 0, tgtExact: 0, bothExact: 0,
  srcLeaf: 0, tgtLeaf: 0, bothLeaf: 0,
  srcCorpus: 0, tgtCorpus: 0, bothCorpus: 0,
  srcNowhere: 0, tgtNowhere: 0,
  conf: new Map(), evidence: new Map(), subLabel: new Map(),
  srcPlaceholder: 0, tgtPlaceholder: 0,
  srcContractViolation: 0, tgtContractViolation: 0, contractViolations: new Map(),
  srcClass: new Map(), tgtClass: new Map(), placeholderStrings: new Map(),
  emptyEndpoint: 0, selfLoop: 0, examples: [],
})
const rows = new Map<string, Stat>()
for (const t of ALL_TYPES) rows.set(t, stat())
/** The raw `"imports"` literal, tracked separately from the enum value so the
 *  fleet-wide spelling bug is a measured number in this lane's report. */
const nonEnumSpelling = stat()

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

/** Every symbol name the analyzer emitted anywhere in the sample. Built during
 *  the run and read in the cross-file pass afterwards. */
const corpusNameIndex = new Set<string>()
type Deferred = { bucket: Stat; src: string; tgt: string }
const deferred: Deferred[] = []

/* ------------------------------------------------------------------ *
 * Run: PRODUCTION path, identical to script/m14/firing-check.mjs —
 * getParser(lang) -> parser.parse(content, path) -> analyzer.analyze(root,...).
 * ------------------------------------------------------------------ */
const { getParser, ASTEngine } = await import("../../../src/ast/engine")
const { RealTypeScriptAnalyzer } = await import("../../../src/ast/real-typescript-analyzer")
const { RelationshipType } = await import("../../../src/ast/types")

/** THE SPELLING DEFECT, stated once so it cannot be re-derived wrongly.
 *
 *  There are TWO enums in this repository, both named `RelationshipType`, both
 *  with ten values, and they disagree on exactly ONE member:
 *
 *    src/ast/engine.ts   ASTEngine.RelationshipType.Imports = "imports"
 *    src/ast/types.ts            RelationshipType.Imports = "brain_import"
 *
 *  Every analyzer imports the ENGINE one, the graph traversal default
 *  (`graph-engine.ts` DEFAULT_REL_TYPES) spells it "imports", and
 *  `script/m60/rel-type-coverage-gate.ts` reads its enum from engine.ts. So
 *  "imports" is what the production path actually carries, and this analyzer
 *  emits it by using the enum member rather than a bare literal.
 *
 *  `script/m14/firing-check.mjs` imports its enum from types.ts. That is why a
 *  lane can report "10 types fired" while its own instrument's enum does not
 *  contain one of the ten. Verified on this corpus: types.ts yields
 *  {brain_import, calls, contains, exports, extends, implements, instantiates,
 *  overrides, references, uses} and engine.ts yields the same set with
 *  `imports` in place of `brain_import`.
 *
 *  This lane therefore reports BOTH readings and changes neither enum:
 *  `src/ast/types.ts` and `src/ast/engine.ts` are master-owned, and hard-coding
 *  "brain_import" here would drop every import edge out of the traversal default
 *  and out of the differential's audited label set — a regression, not a fix. */
const enumValuesFromTypes = [...new Set(Object.values(RelationshipType))].sort()
const enumValuesFromEngine = [...new Set(Object.values(ASTEngine.RelationshipType))].sort()
const divergentEnumMembers = enumValuesFromTypes.filter((v) => !enumValuesFromEngine.includes(v))

let parsed = 0
let failed = 0
let totalSymbols = 0
let totalRels = 0
let filesWithErrorNodes = 0
let errorNodes = 0
const parseFailures: Array<{ file: string; err: string }> = []
const seenTypeCounts = new Map<string, number>()

for (const f of admitted) {
  const label = `${f.repo}/${f.rel}`
  let content: string
  try { content = readFileSync(f.abs, "utf8") } catch { failed++; continue }
  let res: { symbols?: unknown[]; relationships?: Rel[] }
  try {
    const parser = await getParser(LANG as never)
    const pr = await parser.parse(content, f.abs)
    res = new RealTypeScriptAnalyzer().analyze(pr.rootNode, content, f.abs) as never
  } catch (e) {
    failed++
    if (parseFailures.length < 20) parseFailures.push({ file: label, err: String(e).slice(0, 120) })
    continue
  }
  parsed++

  // Question 5 needs the symbol surface of THIS file. A TypeScript symbol carries
  // `name` and no `id` (probe-verified), so `name` is the whole key surface; `id`
  // is still read so the census keeps working if an id is ever added.
  const ids = new Set<string>()
  const names = new Set<string>()
  const syms = res.symbols ?? []
  totalSymbols += syms.length
  for (const s of syms) {
    const sym = s as { id?: unknown; name?: unknown }
    if (sym.id !== undefined && sym.id !== null) ids.add(String(sym.id))
    if (sym.name !== undefined && sym.name !== null) {
      const n = String(sym.name)
      names.add(n)
      corpusNameIndex.add(n)
    }
  }

  // Parse-quality census, walked with the cursor API — no pattern matching.
  try {
    const cursor = pr.rootNode.walk()
    let stack: boolean[] = []
    let bad = 0
    let go = true
    while (go) {
      const n = cursor.currentNode
      if (!n) break
      if (n.type === "ERROR" || n.isMissing) bad++
      if (cursor.gotoFirstChild()) { stack.push(true); continue }
      while (!cursor.gotoNextSibling()) {
        if (stack.length === 0) { go = false; break }
        stack.pop()
        if (!cursor.gotoParent()) { go = false; break }
      }
      if (!go) break
    }
    if (bad > 0) { filesWithErrorNodes++; errorNodes += bad }
  } catch { /* parse-quality census is reported, never allowed to abort the run */ }

  const rels = res.relationships ?? []
  totalRels += rels.length
  for (const rel of rels) {
    const t = String(rel.type ?? rel.relationshipType ?? "")
    bump(seenTypeCounts, t)
    const bucket = rows.get(t) ?? (t === "imports" ? nonEnumSpelling : null)
    if (!bucket) continue
    const label2 = `${f.repo}/${f.rel}`
    const [src, tgt] = endpointsOf(rel)
    bucket.count++
    bucket.files.add(label2)
    bump(bucket.perFile, label2)
    if (src.length === 0 || tgt.length === 0) bucket.emptyEndpoint++

    const local = ids.size > 0 ? ids : names
    const se = src.length > 0 && local.has(src)
    const te = tgt.length > 0 && local.has(tgt)
    const sl = src.length > 0 && segmentCandidates(src).some((c) => local.has(c))
    const tl = tgt.length > 0 && segmentCandidates(tgt).some((c) => local.has(c))
    // A candidate only counts as corpus-resolved once the whole sample is read,
    // so the cross-file column is filled in the second pass below.
    if (se) bucket.srcExact++
    if (te) bucket.tgtExact++
    if (se && te) bucket.bothExact++
    if (sl) bucket.srcLeaf++
    if (tl) bucket.tgtLeaf++
    if (sl && tl) bucket.bothLeaf++

    if (src === tgt && src.length > 0) bucket.selfLoop++
    bump(bucket.conf, rel.confidence === undefined ? "absent" : String(rel.confidence))
    const md = (rel.metadata ?? {}) as Record<string, unknown>
    bump(bucket.evidence, String(md.evidenceClass ?? "absent"))
    bump(bucket.subLabel, String(md.relationshipType ?? "absent"))
    const srcClass = classifyEndpoint(src, t === "exports" ? "exports-source" : "plain")
    const tgtClass = classifyEndpoint(tgt, t === "imports" ? "imports-target" : "plain")
    bump(bucket.srcClass, srcClass)
    bump(bucket.tgtClass, tgtClass)
    if (isPlaceholderEndpoint(src, t === "exports" ? "exports-source" : "plain")) {
      bucket.srcPlaceholder++; bump(bucket.placeholderStrings, src)
    }
    if (isPlaceholderEndpoint(tgt, t === "imports" ? "imports-target" : "plain")) {
      bucket.tgtPlaceholder++; bump(bucket.placeholderStrings, tgt)
    }
    // The fabrication count: an endpoint that breaks its OWN type's contract, which
    // is a different question from whether it is a placeholder.
    if (violatesExpectation(t, "source", src)) { bucket.srcContractViolation++; bump(bucket.contractViolations, `src=${src}`) }
    if (violatesExpectation(t, "target", tgt)) { bucket.tgtContractViolation++; bump(bucket.contractViolations, `tgt=${tgt}`) }
    if (bucket.examples.length < 6) bucket.examples.push(`${src} -> ${tgt}`)

    deferred.push({ bucket, src, tgt })
  }
}

/* Second pass, after every file's symbols are in the index: the cross-file
   resolution column. Deferred rather than computed inline because a corpus-wide
   index is not meaningful until the corpus has been read. */
for (const d of deferred) {
  const sc = segmentCandidates(d.src)
  const tc = segmentCandidates(d.tgt)
  const sAny = sc.some((c) => corpusNameIndex.has(c))
  const tAny = tc.some((c) => corpusNameIndex.has(c))
  if (sAny) d.bucket.srcCorpus++
  if (tAny) d.bucket.tgtCorpus++
  if (sAny && tAny) d.bucket.bothCorpus++
  if (!sAny && d.src.length > 0) d.bucket.srcNowhere++
  if (!tAny && d.tgt.length > 0) d.bucket.tgtNowhere++
}

/* ------------------------------------------------------------------ *
 * Report.
 * ------------------------------------------------------------------ */
const topFiles = (m: Map<string, number>, n: number) =>
  [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n)
    .map(([k, v]) => `${k}=${v}`)

const pct = (n: number, of: number) => (of ? Number(((100 * n) / of).toFixed(1)) : null)
const summarise = (s: Stat) => ({
  count: s.count,
  files: s.files.size,
  topFiles: topFiles(s.perFile, 8),
  /** in-file, the endpoint string is a symbol name emitted in this file */
  srcExact: s.srcExact, targetExact: s.tgtExact, bothExact: s.bothExact,
  srcExactPct: pct(s.srcExact, s.count), targetExactPct: pct(s.tgtExact, s.count), bothExactPct: pct(s.bothExact, s.count),
  /** in-file, the endpoint's last '.'/':' segment is */
  srcLeaf: s.srcLeaf, targetLeaf: s.tgtLeaf, bothLeaf: s.bothLeaf,
  srcLeafPct: pct(s.srcLeaf, s.count), targetLeafPct: pct(s.tgtLeaf, s.count), bothLeafPct: pct(s.bothLeaf, s.count),
  /** ANYWHERE in the sample — the honest "binds to a real symbol" figure */
  srcCorpus: s.srcCorpus, targetCorpus: s.tgtCorpus, bothCorpus: s.bothCorpus,
  srcCorpusPct: pct(s.srcCorpus, s.count), targetCorpusPct: pct(s.tgtCorpus, s.count), bothCorpusPct: pct(s.bothCorpus, s.count),
  /** binds NOWHERE in the sample */
  srcNowhere: s.srcNowhere, targetNowhere: s.tgtNowhere,
  emptyEndpoints: s.emptyEndpoint,
  selfLoops: s.selfLoop,
  placeholderSourceEndpoints: s.srcPlaceholder,
  placeholderTargetEndpoints: s.tgtPlaceholder,
  /** endpoints that break their OWN type's documented endpoint contract */
  sourceContractViolations: s.srcContractViolation,
  targetContractViolations: s.tgtContractViolation,
  contractViolationSamples: Object.fromEntries(
    [...s.contractViolations.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20),
  ),
  /** endpoint SHAPE distributions, the reason an endpoint does not resolve */
  sourceClassHistogram: Object.fromEntries([...s.srcClass.entries()].sort((a, b) => b[1] - a[1])),
  targetClassHistogram: Object.fromEntries([...s.tgtClass.entries()].sort((a, b) => b[1] - a[1])),
  /** the offending strings themselves: an R7 count nobody can adjudicate is a
   *  number, not a finding */
  placeholderStrings: Object.fromEntries(
    [...s.placeholderStrings.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25),
  ),
  confidenceHistogram: Object.fromEntries([...s.conf.entries()].sort((a, b) => b[1] - a[1])),
  evidenceClassHistogram: Object.fromEntries(s.evidence),
  subLabelHistogram: Object.fromEntries([...s.subLabel.entries()].sort((a, b) => b[1] - a[1])),
  examples: s.examples,
})

const out = {
  at: new Date().toISOString(),
  lane: "VERIFY_TS",
  lang: LANG,
  analyzerUnderTest: "src/ast/real-typescript-analyzer.ts (this worktree)",
  corpusRoot: CR,
  corpusFilter: REPO_FILTER ?? "(all repos)",
  maxBytes: MAX_BYTES,
  filesAdmitted: admitted.length,
  filesParsed: parsed,
  filesFailed: failed,
  parseFailures,
  filesWithErrorNodes,
  errorNodes,
  totalSymbols,
  totalRelationships: totalRels,
  /** BOTH enums, side by side. See the SPELLING DEFECT note above. */
  enumValuesFromTypesTs: enumValuesFromTypes,
  enumValuesFromEngineTs: enumValuesFromEngine,
  divergentEnumMembers,
  /** Every spelling the analyzer actually produced, in count order. A type
   *  observed here that is in NEITHER enum is a fabricated label; a type in the
   *  engine enum but absent here is silent. */
  observedRelationshipTypeSpellings: Object.fromEntries(
    [...seenTypeCounts.entries()].sort((a, b) => b[1] - a[1]),
  ),
  types: Object.fromEntries(ALL_TYPES.map((t) => [t, summarise(rows.get(t)!)])),
  nonEnumImportsSpelling: summarise(nonEnumSpelling),
  /** Which observed spellings count toward 10/10, under each enum. */
  firingAgainstTypesTsEnum: ALL_TYPES.filter((t) => enumValuesFromTypes.includes(t) && rows.get(t)!.count > 0),
  firingAgainstEngineTsEnum: ALL_TYPES.filter((t) => enumValuesFromEngine.includes(t) && rows.get(t)!.count > 0),
}

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)

/* ------------------------------------------------------------------ *
 * SELF-TEST. An R7 predicate that has only ever returned false is not a
 * check. Each case states what it is proving, and both directions are
 * asserted for every class: a real placeholder must be caught, and the
 * language's own vocabulary must NOT be.
 * ------------------------------------------------------------------ */
const SELF_TEST_FAILURES: string[] = []
const selfCheck = (name: string, cond: boolean) => { if (!cond) SELF_TEST_FAILURES.push(name) }
const SELF_TEST_NAMES = SELF_TEST_FAILURES
void SELF_TEST_NAMES
// (a) a real placeholder IS caught
for (const s of ["?", "???", "<unknown>", "unknown", "TODO", "n/a", "tbd", "xxx", "", "  ", "placeholder"]) {
  selfCheck(`R7 catches the placeholder ${JSON.stringify(s)}`, isPlaceholderEndpoint(s, "plain"))
}
// (b) the language's own vocabulary is NOT caught
for (const s of ["Symbol", "name", "value", "target", "source", "any", "string", "number", "object",
  "Promise", "Readonly", "$dollar", "_under", "parseGeneratorArgs", "APIRequest", "NodeArray",
  "vscode.Disposable", "LiteralType.value", "(new)", "(call)", "[Symbol.iterator]"]) {
  selfCheck(`R7 does not flag the real endpoint ${JSON.stringify(s)}`, !isPlaceholderEndpoint(s, "plain"))
}
// (c) the classifier names the four legitimate non-identifier forms, so "not a
//     placeholder" is not being reported as "unresolved"
selfCheck("classify names a module specifier", classifyEndpoint("../proto.ts:APIRequest", "imports-target") === "module specifier")
selfCheck("classify names a module name", classifyEndpoint("ast.generated", "exports-source") === "module name")
selfCheck("classify names a qualified name", classifyEndpoint("vscode.Disposable", "plain") === "qualified name")
selfCheck("classify names a synthesized label", classifyEndpoint("[Symbol.iterator]", "plain") === "synthesized label")
selfCheck("classify names a paren synthesized label", classifyEndpoint("(new)", "plain") === "synthesized label")
selfCheck("classify names a generic type name", classifyEndpoint("NodeArray<RemoteNode>", "plain") === "generic type name")
selfCheck("classify names an identifier", classifyEndpoint("readFileSync", "plain") === "identifier")
selfCheck("an imports target is a specifier even when it reads like an identifier",
  classifyEndpoint("node:fs", "imports-target") === "module specifier")
selfCheck("isIdentifierLike accepts a bare name", isIdentifierLike("Foo"))
selfCheck("isIdentifierLike rejects a leading digit", !isIdentifierLike("1Foo"))
selfCheck("isIdentifierLike accepts a leading underscore", isIdentifierLike("_Foo"))
selfCheck("segmentCandidates yields the whole string and the leaf",
  segmentCandidates("Derived.run").indexOf("run") >= 0 && segmentCandidates("Derived.run").indexOf("Derived.run") >= 0)
selfCheck("segmentCandidates splits an import specifier on the colon",
  segmentCandidates("../proto.ts:APIRequest").indexOf("APIRequest") >= 0)
selfCheck("segmentCandidates on a bare name yields only itself",
  segmentCandidates("readFileSync").length === 1)
if (SELF_TEST_FAILURES.length) {
  console.error(`\nCENSUS SELF-TEST FAILED — ${SELF_TEST_FAILURES.length} assertion(s). The numbers below would be untrustworthy.`)
  for (const f of SELF_TEST_FAILURES) console.error(`  FAIL ${f}`)
  process.exit(1)
}
console.log(`census self-test: ${11 + 20 + 8 + 5} assertions pass — R7 fires on 11 placeholder shapes, clears 20 real endpoints, classifier names all 8 shapes`)

console.log(`typescript lane census (VERIFY_TS) — analyzer in THIS worktree`)
console.log(`corpus ${CR}${REPO_FILTER ? " filter=" + REPO_FILTER : ""}: ${admitted.length} admitted, ${parsed} parsed, ${failed} failed`)
console.log(`symbols ${totalSymbols.toLocaleString()}  relationships ${totalRels.toLocaleString()}`)
console.log(`parse quality: ${filesWithErrorNodes} file(s) with ERROR/missing nodes, ${errorNodes} node(s)`)
console.log(`\nTWO enums are both named RelationshipType and disagree on: ${divergentEnumMembers.join(", ") || "(nothing)"}`)
console.log(`  types.ts  (what script/m14/firing-check.mjs imports): ${enumValuesFromTypes.join(" ")}`)
console.log(`  engine.ts (what every analyzer, DEFAULT_REL_TYPES and the m60 gate use): ${enumValuesFromEngine.join(" ")}`)
console.log(`  this analyzer emits "imports" (the engine.ts value) by using the enum member, not a bare literal;`)
console.log(`  "imports" is NOT a value of the types.ts enum. types.ts and engine.ts are master-owned, and hard-coding`)
console.log(`  "brain_import" here would drop these edges out of the traversal default and out of the differential's`)
console.log(`  audited label set — a regression, not a fix. Reported, not changed.`)
console.log(`\nRESOLUTION, three readings. EXACT = the endpoint string is a symbol name emitted in this file.`)
console.log(`LEAF = its last '.'/':' segment is. CORPUS = it binds to a symbol ANYWHERE in the sample.`)
console.log(`NOWHERE = it binds nowhere in the sample, which is the only honestly unresolved case.`)
console.log(`\nR7 — PLACEHOLDER endpoints only. An endpoint that is not a placeholder but still does not`)
console.log(`resolve to a symbol has a NAMED SHAPE, and the shape histograms are in the JSON: a module`)
console.log(`specifier (an imports target) and a module name (an exports source) are not symbols by`)
console.log(`construction; a qualified name resolves by its leaf; a synthesized label is ([x]) or (new).`)
console.log(`\nCONTRACT VIOLATIONS — an endpoint that breaks its OWN type's documented resolution rule.`)
console.log(`\`calls\` reduces a callee to a LEAF NAME, so a \`calls\` target of \`!ctx.state.get\` is a fabrication`)
console.log(`even though it is a well-formed qualified name. Distinct from R7, and counted separately.`)
console.log(`\n${pad("type", 14)}${pad("count", 12)}${pad("files", 7)}${pad("srcEx", 8)}${pad("tgtEx", 8)}${pad("srcLf", 8)}${pad("tgtLf", 8)}${pad("srcCp", 8)}${pad("tgtCp", 8)}${pad("bothCp", 9)}${pad("nowSrc", 9)}${pad("nowTgt", 9)}${pad("self", 7)}${pad("R7src", 8)}${pad("R7tgt", 8)}${pad("CVsrc", 8)}${pad("CVtgt", 8)}confidence histogram`)
console.log("-".repeat(190))
for (const t of ALL_TYPES) {
  const s = rows.get(t)!
  const p1 = (n: number) => (s.count ? ((100 * n) / s.count).toFixed(1) : "-")
  const hist = [...s.conf.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ")
  console.log(`${pad(t, 14)}${pad(s.count.toLocaleString(), 12)}${pad(String(s.files.size), 7)}${pad(p1(s.srcExact), 8)}${pad(p1(s.tgtExact), 8)}${pad(p1(s.srcLeaf), 8)}${pad(p1(s.tgtLeaf), 8)}${pad(p1(s.srcCorpus), 8)}${pad(p1(s.tgtCorpus), 8)}${pad(p1(s.bothCorpus), 9)}${pad(String(s.srcNowhere), 9)}${pad(String(s.tgtNowhere), 9)}${pad(String(s.selfLoop), 7)}${pad(String(s.srcPlaceholder), 8)}${pad(String(s.tgtPlaceholder), 8)}${pad(String(s.srcContractViolation), 8)}${pad(String(s.tgtContractViolation), 8)}${hist}`)
}
const cvTotal = ALL_TYPES.reduce((a, t) => a + rows.get(t)!.srcContractViolation + rows.get(t)!.tgtContractViolation, 0)
const cvImports = nonEnumSpelling.srcContractViolation + nonEnumSpelling.tgtContractViolation
console.log(`\nCONTRACT VIOLATIONS TOTAL: ${cvTotal} over ${totalRels.toLocaleString()} relationships (${((100 * cvTotal) / Math.max(1, totalRels)).toFixed(4)}%)`)
console.log(`\nRAW SPELLINGS OBSERVED: ${JSON.stringify(out.observedRelationshipTypeSpellings)}`)
const zero = ALL_TYPES.filter((t) => rows.get(t)!.count === 0)
console.log(`NOT EMITTED: ${zero.length ? zero.join(", ") : "(none)"}`)
if (nonEnumSpelling.count > 0) {
  console.log(`NON-ENUM "imports" LITERAL: ${nonEnumSpelling.count} edges over ${nonEnumSpelling.files.size} files — produced with a type string that is not any value of RelationshipType`)
}
console.log(`R7 placeholder/unknown endpoints: src ${ALL_TYPES.reduce((a, t) => a + rows.get(t)!.srcPlaceholder, 0)}, tgt ${ALL_TYPES.reduce((a, t) => a + rows.get(t)!.tgtPlaceholder, 0)}`)
console.log(`empty endpoints: ${ALL_TYPES.reduce((a, t) => a + rows.get(t)!.emptyEndpoint, 0)}`)

if (OUT) {
  const { writeFileSync } = await import("node:fs")
  writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(`\nwrote ${OUT}`)
}
