/**
 * PHP REASON CENSUS — every endpoint of every edge, in a NAMED class, with a count.
 *
 * ## Why this is an instrument and not a session result
 *
 * The lane's claim is that no edge is *unexplained*: each endpoint either names exactly one
 * published declaration or names a reason the language makes unavoidable (a local variable, a
 * PHP internal, a name outside the admitted population, a path, a keyword). That claim was
 * measured, and the run that measured it lived in a gitignored scratch file — so "unexplained
 * = 0" was a statement about one session on one checkout, not an artifact anyone could re-run.
 * This is that measurement, committed, and it is the authority for the claim:
 *
 *   bun validation/m14/fixtures/php/reason-census.mts --out validation/m60/php/reason-census.json
 *
 * ## What it classifies
 *
 * BOTH ENDPOINTS. The audit that found the lane's two store-vs-analyzer defects classified
 * targets only, and that was a scope hole with a real consequence: `WebauthnLibServer.php`
 * emits `references findAllForUserEntity -> PublicKeyCredentialUserEntity` whose SOURCE is a
 * method no store row holds, because it is declared on an anonymous class. A target-only census
 * cannot see it. So each edge contributes one target classification and one source
 * classification, and both sides have their own unexplained class.
 *
 * TARGET classes, in the order the ladder asks them (the order is load-bearing — see the note on
 * parameters below), with the resolution rule first because a resolved edge needs no reason:
 *
 *   resolved:unique                     exactly one published declaration matches, by the
 *                                       type's own identity: `contains` and `overrides` through
 *                                       the (owner, name) key the publisher writes, everything
 *                                       else through the bare name, its leaf, or
 *                                       `metadata.owner` when the analyzer supplied one.
 *   ambiguous:multiple-declarations     N > 1 — priced, never explained away. This is the lane's
 *                                       actual remaining work and the number the incoming/scope
 *                                       round has to move.
 *   declared-on-anonymous-class         the only declaration is on an anonymous class, which
 *                                       M37.13 rules unpublishable (`new class { … }` has no
 *                                       nameable symbol). NAMED reason, not a defect.
 *   variable-in-this-file               a local or a PARAMETER of this file: there is no
 *                                       declaration site to publish, and PHP gives none.
 *   placeholder:language-keyword        a keyword the grammar handed back as an endpoint
 *                                       (`list`, `array`, …) — no declaration can carry it.
 *   declared-in-tree-not-published      THE DEFECT CLASS: the tree declares this name as a
 *                                       declaration node in this very file and no store row
 *                                       holds it. Must be 0. (This class is what the round's two
 *                                       fixes emptied: 248 -> 24 -> 5, then 5 -> 2 anonymous-class
 *                                       + 3 parameters, reclassified by this census.)
 *   member-published-under-another-owner  the name IS published as a member, under a different
 *                                       owner — inherited or foreign, needs owner resolution.
 *   external:php-internal-{function,constant,class}  PHP's own symbols, by the lane's own
 *                                       `phpInternalKind()`, not a hand-written name set.
 *   no-declaration:dynamic-callee       `$var()` / `$obj->$m()`: the callee is a value.
 *   no-declaration:file-path            an include/require path, not a name.
 *   external:namespace-outside-population  a qualified name whose namespace is admitted nowhere.
 *   external:bare-name-outside-population  a bare name no admitted file declares (WordPress's
 *                                       `__`, Prophecy's `reveal`, …) — the population's
 *                                       boundary, named and counted rather than hidden.
 *   unexplained                         nothing above applies. Exit 1 and print the rows.
 *
 * SOURCE classes: `source:global` (the lane's file-level pseudo-source), `source:published`
 * (unique or ambiguous, counted), `source:declared-on-anonymous-class`, `source:variable-in-this
 * -file`, `source:declared-in-tree-not-published` (defect class), `source:unexplained`. A
 * declaration a caller can SOURCE an edge at but that no row holds is exactly what those last two
 * classes are for, and the round that published nested named functions is what emptied them.
 *
 * The `overrides` type is the one whose endpoints are spelled `Owner.member`, on BOTH sides: the
 * target ladder asks for the (owner, name) key, and the source ladder now does too, because the
 * first whole-population run reported its last two unexplained endpoints as exactly that shape
 * (`A.foo`, `SkipConstruct.__construct`) — the lane's only two `overrides` edges, each fully
 * resolvable, filed against the instrument's own omission.
 *
 * ORDER IS LOAD-BEARING, and the measured reason is why: an earlier ladder asked "is this name a
 * variable in this file?" BEFORE asking "does the tree declare it as a declaration?". A method
 * that the store had lost while the file also had a local of the same name would then be filed
 * as a local — a defect class silently absorbed by a benign one. Declaration-shaped names are
 * therefore asked FIRST (class/interface/trait/enum/function/method/enum_case/const_element/
 * property_element), and PARAMETERS are deliberately NOT in that set: `simple_parameter`,
 * `variadic_parameter` and `property_promotion_parameter` are bindings with no declaration site,
 * so a read of one is a variable-in-this-file and never a lost declaration. Three of the five
 * edges the round left in the old bucket were exactly that, mis-filed by the old label.
 *
 * ## Controls, because a zero that cannot fire is not a measurement
 *
 * The SELF-TEST runs the classifier itself over synthetic inputs BEFORE the corpus is walked,
 * and refuses to report if any probe lands in the wrong class — including one probe that MUST
 * land in `unexplained`, because a classifier that cannot produce the defect class would report
 * `unexplained = 0` for everything. After the walk, the run exits 3 unless it saw edges, all ten
 * relationship types, published symbols, and at least one resolved AND one ambiguous target —
 * the last two are what make the reason classes below them meaningful rather than an artifact of
 * the ladder never descending.
 *
 * ## Population
 *
 * Every git-tracked file under `BB_CORPUS_ROOT` (default /home/ishaq2321/bb_tests/repositories)
 * that `detectLanguageFromPath` admits as `php`, over `git ls-files` so build output is excluded
 * by construction and the population is the repository's own. `--files N` samples with the same
 * deterministic stride the lane's other census uses and PRINTS that it sampled; the DEFAULT is
 * the whole admitted population, because "every edge" is not a sample's claim.
 *
 * Entry point is production `parseFile` (`src/ast/pool-worker.ts`) — the projection, not the
 * analyzer, since the defects this census exists to find were exactly the ones the projection
 * introduced.
 *
 * ## The ambiguity levers, priced before anything is implemented
 *
 * The largest class the table reports is `ambiguous:multiple-declarations` — 126,342 endpoints, 36%
 * of the lane. Counting it is not the same as knowing whether it can be closed, so the same run
 * prints WHICH STAGE would leave exactly one candidate for each of those endpoints, under a stated
 * order: the SOUND filters first (the `metadata.owner` channel, then the type's own
 * callable/type-kind rule), then the PREFERENCES (same file, then the file's own namespace).
 *
 * The measured result (2026-10-07, whole population) is deliberately unflattering and that is its
 * value: 80,539 of the 126,342 (63.75%) stay ambiguous after EVERY lever, 16,484 are resolved only
 * by the same-file preference and 8,183 only by the namespace preference, 3,172 fall to the sound
 * filters, and 17,964 are not resolutions at all — 15,791 are EMPTIED BY OWNER (the edge says which
 * owner's member it names and no candidate carries that owner, i.e. inherited or foreign members)
 * and 2,173 are EMPTIED BY KIND (the name is published, but not as anything the type can point at).
 *
 * `emptied-by-*` is counted apart from the resolutions on purpose: a preference that picks one of
 * two real candidates CHANGES a resolution, and an owner/kind filter that empties the set turns an
 * ambiguity into an unresolved endpoint — three different findings that a single "closed" number
 * would blend. Nothing here is a rule this lane has adopted; it is a ceiling, and the artifact
 * carries that caveat in the data rather than only in this comment.
 *
 * Exit codes: 0 clean · 1 unexplained endpoints exist · 2 usage · 3 a control failed.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { phpInternalKind } from "../../../../src/ast/php-internal-symbols"
import { ASTEngine } from "../../../../src/ast/engine"

const argv = process.argv.slice(2)
const fail = (m: string): never => {
  console.error(`reason-census: ${m}`)
  process.exit(2)
}
const argOf = (f: string) => {
  const i = argv.indexOf(f)
  if (i < 0) return undefined
  const v = argv[i + 1]
  if (v == null || v.startsWith("--")) fail(`\`${f}\` has no value`)
  return v
}
const OUT = argOf("--out")
const N = Number(argOf("--files") ?? 0)
if (!Number.isInteger(N) || N < 0) fail(`--files must be a non-negative integer, got \`${argOf("--files")}\``)
const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 512 * 1024

const TYPES = ["calls", "uses", "contains", "imports", "instantiates", "references", "extends", "implements", "exports", "overrides"] as const
const KEYWORDS = new Set(["parent", "self", "static", "this", "list", "array", "echo", "print", "isset", "empty", "unset", "eval", "include", "require", "class", "new", "clone"])

/** Declaration-shaped node types. Parameters are deliberately ABSENT — see the header. */
const DECL_NODES = new Set([
  "class_declaration", "interface_declaration", "trait_declaration", "enum_declaration",
  "function_definition", "method_declaration", "enum_case", "const_element", "property_element",
])
const PARAM_NODES = new Set(["simple_parameter", "variadic_parameter", "property_promotion_parameter"])

// ------------------------------------------------------------------ the classifier

type FileSignals = {
  /** names declared by a declaration node in this file (parameters excluded) */
  declared: Set<string>
  /** the subset of `declared` that sits inside an anonymous class */
  declaredOnAnonymousClass: Set<string>
  /** every `variable_name` in the file (locals and parameters) */
  variables: Set<string>
}

type Index = {
  /** bare name -> how many symbols publish it */
  pubName: Map<string, number>
  /** `owner\u0000name` -> how many symbols publish that member pair */
  pubMember: Map<string, number>
  /** bare member name -> how many (owner, name) pairs carry it, under ANY owner */
  memberNames: Map<string, number>
  /**
   * bare name -> the candidate declarations themselves, for the AMBIGUITY LEVERS section. Without
   * the candidates an ambiguity can only be COUNTED; with them it can be asked which
   * disambiguation rule would leave exactly one, which is the number the lane's next round needs
   * and the one nothing in the repo measures.
   */
  cand: Map<string, Cand[]>
}

type Cand = { name: string; owner: string | null; kind: string; file: string; ns: string | null }

/** One ambiguous target endpoint, kept for the lever analysis. */
type AmbRow = { t: string; target: string; owner: string | null; fileNs: string | null; file: string }

/** Every edge, kept in its minimal form for the INCOMING section. */
type EdgeRow = AmbRow & { cls: string; source: string }

/**
 * The declaration identity an edge reaches, or null when no single declaration is reached.
 *
 * Two lookups, in the order the resolver itself uses: the endpoint's own name, then its LEAF (a
 * qualified endpoint `App\One\A` names the declaration `A`). When more than one candidate carries
 * the name, the edge's OWNER channel narrows it — the same (owner, name) key the publisher writes.
 * `null` is not a failure here: it is the honest answer for an edge that reaches no single
 * declaration, and the INCOMING section counts those edges under the class the target ladder
 * already gave them rather than inventing an identity for them.
 */
function identityOf(row: AmbRow, idx: Index): string | null {
  const leaf = leafOf(row.target)
  const direct = idx.cand.get(row.target)
  const cands = direct && direct.length ? direct : leaf ? idx.cand.get(leaf) ?? [] : []
  if (cands.length === 1) return candKey(cands[0])
  if (cands.length === 0) return null
  if (row.owner) {
    const narrowed = cands.filter((c) => c.owner === row.owner)
    if (narrowed.length === 1) return candKey(narrowed[0])
  }
  return null
}

/**
 * A declaration's IDENTITY, as an edge can reach it: the file it lives in, its owner, its kind and
 * its name. All four, because a class may legitimately publish `foo` twice — once as `foo()` and
 * once as `$foo`, which the publisher writes as the same (owner, name) with a different kind — and
 * an identity that dropped the kind would merge them and make the incoming count a mixture.
 */
const candKey = (c: Cand): string => `${c.file}\u0000${c.owner ?? ""}\u0000${c.kind}\u0000${c.name}`

/**
 * THE DISAMBIGUATION RULES, AS HYPOTHESES. Two kinds, and the distinction is the whole of the
 * analysis below:
 *
 *   FILTERS narrow soundly — a `calls` target must be callable, and an edge that carries
 *   `metadata.owner` says which owner's member it names. A filter is only applied when it has a
 *   value, so a `calls` with no owner is not narrowed by the owner filter.
 *
 *   PREFERENCES order without narrowing — among the candidates that survive the filters, the one
 *   in the same file, or in the file's own namespace, is the likelier reading. A preference can
 *   never be reported as a resolution on its own; it is reported as "would resolve UNDER this
 *   ordering", which is why the section prints each stage's count and not a total.
 *
 * NEITHER IS A RULE THIS LANE HAS ADOPTED. They are the levers whose CEILING the next round needs,
 * and the table exists to price them before anything is implemented — the lane's discipline, after
 * a fix that looked like +225 resolved edges and was really a cross-repo collision.
 */
const FILTER_KINDS: Record<string, Set<string>> = {
  calls: new Set(["function", "method", "constructor"]),
  instantiates: new Set(["class", "enum", "trait", "struct"]),
  extends: new Set(["class", "interface", "enum"]),
  implements: new Set(["interface"]),
  overrides: new Set(["method", "constructor"]),
  contains: new Set(["method", "property", "constant", "enum_member", "constructor"]),
  exports: new Set(["constant"]),
  imports: new Set(["class", "interface", "trait", "enum", "function", "constant"]),
  references: new Set(["class", "interface", "trait", "enum", "type", "constant", "property"]),
  uses: new Set(["function", "method", "property", "constant", "enum_member", "variable"]),
}

const RESOLVED = "resolved:unique"
const AMBIGUOUS = "ambiguous:multiple-declarations"
const ANON = "declared-on-anonymous-class"
const VAR = "variable-in-this-file"
const KEYWORD = "placeholder:language-keyword"
const DEFECT = "declared-in-tree-not-published"
const OTHER_OWNER = "member-published-under-another-owner"
const DYNAMIC = "no-declaration:dynamic-callee"
const PATHY = "no-declaration:file-path"
const NS_OUTSIDE = "external:namespace-outside-population"
const BARE_OUTSIDE = "external:bare-name-outside-population"
const UNEXPLAINED = "unexplained"

const leafOf = (t: string) => (t.includes("\\") ? t.slice(t.lastIndexOf("\\") + 1) : null)

/**
 * The target ladder. Pure: (type, target, owner, file signals, indexes) in, class out — so the
 * self-test can drive it with synthetic inputs and the corpus walk cannot quietly disagree with
 * the tested behaviour.
 */
function classifyTarget(edge: { type: string; target: string; owner: string | null }, sig: FileSignals, idx: Index): string {
  const t = edge.target
  if (!t) return UNEXPLAINED
  const leaf = leafOf(t)

  if (edge.type === "contains") {
    const keyed = idx.pubMember.get(`${edge.owner ?? ""}\u0000${t}`) ?? 0
    if (edge.owner === null) {
      const bare = idx.pubName.get(t) ?? 0
      if (bare === 1) return RESOLVED
      if (bare > 1) return AMBIGUOUS
    }
    if (keyed === 1) return RESOLVED
    if (keyed > 1) return AMBIGUOUS
    return reasonLadder(t, leaf, sig, idx)
  }

  if (edge.type === "overrides") {
    const dot = t.lastIndexOf(".")
    const keyed = dot > 0 ? idx.pubMember.get(`${t.slice(0, dot)}\u0000${t.slice(dot + 1)}`) ?? 0 : 0
    if (keyed >= 1) return RESOLVED
    return reasonLadder(t, leaf, sig, idx)
  }

  const pub = idx.pubName.get(t) ?? 0
  const pubLeaf = leaf ? idx.pubName.get(leaf) ?? 0 : 0
  const ownerHit = edge.owner ? idx.pubMember.get(`${edge.owner}\u0000${t}`) ?? 0 : 0
  const ownerLeafHit = edge.owner && leaf ? idx.pubMember.get(`${edge.owner}\u0000${leaf}`) ?? 0 : 0
  if (pub === 1 || pubLeaf === 1 || ownerHit === 1 || ownerLeafHit === 1) return RESOLVED
  if (pub > 1 || pubLeaf > 1 || ownerHit > 1 || ownerLeafHit > 1) return AMBIGUOUS
  return reasonLadder(t, leaf, sig, idx)
}

/** Everything below `ambiguous`, asked in the order the header justifies. */
function reasonLadder(t: string, leaf: string | null, sig: FileSignals, idx: Index): string {
  const names = [t, leaf].filter((x): x is string => !!x)
  // Declaration-shaped first: a lost declaration must never be absorbed by a benign class.
  for (const n of names) {
    if (sig.declaredOnAnonymousClass.has(n)) return ANON
  }
  for (const n of names) {
    if (sig.declared.has(n)) return DEFECT
  }
  if (sig.variables.has(t)) return VAR
  if (KEYWORDS.has(leaf ?? t)) return KEYWORD
  for (const n of names) {
    if ((idx.memberNames.get(n) ?? 0) > 0) return OTHER_OWNER
  }
  // `phpInternalKind` returns the prefixed kind itself (`php-internal-function`,
  // `php-language-construct`, …), so the class is `external:` + that — the same spelling the
  // lane's committed ambiguity-split artifact uses, and the reason a second prefix here would
  // read `external:php-internal-php-internal-function` (measured, by the self-test, on the first
  // run of this file: a doubled prefix is exactly the kind of defect a classifier can carry for
  // months while every count still adds up).
  for (const n of names) {
    const ik = phpInternalKind(n)
    if (ik) return `external:${ik}`
  }
  if (t.startsWith("$")) return DYNAMIC
  if (t.includes("/") || t.endsWith(".php")) return PATHY
  if (t.includes("\\")) return NS_OUTSIDE
  // THE TWO ENDS OF THE LADDER, and the distinction is the whole point of the class list:
  // a name that is syntactically a PHP identifier but that no admitted file declares is the
  // POPULATION's boundary (`external:bare-name-outside-population` — WordPress's `__`,
  // Prophecy's `reveal`), while an endpoint that is not a name at all — whitespace, quotes,
  // brackets, an operator, an empty string — is a FABRICATED endpoint and has no reason this
  // census can state. Only the second is `unexplained`; collapsing them would let a fabricated
  // endpoint hide behind the population's boundary, which is the failure mode the class list
  // exists to prevent.
  return isNameShaped(t) ? BARE_OUTSIDE : UNEXPLAINED
}

/** A string that could be a PHP identifier (optionally qualified). */
function isNameShaped(t: string): boolean {
  return /^\\?[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*(\\[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)*$/.test(t)
}

/**
 * The source ladder: a source is a declaration in this lane, a file-level pseudo-source, or a name.
 *
 * RESOLUTION IS ASKED FIRST, exactly as the target ladder asks it, and this is not tidiness — the
 * first run of this instrument filed **3,568 of 3,689** edges of `markdown.php` as
 * `source:declared-in-tree-not-published` because it asked "does this file's tree declare the
 * name?" before "did anything publish it?". Every source of an edge *inside a declaration* is by
 * construction a name this file declares (`Markdown`, `mdwp_add_p`, `Markdown_Parser`), so the
 * reversed ladder reported the defect class for the entire file while the store held all of those
 * symbols. A classifier that cannot see its own resolution cannot be trusted about its defect
 * class — the probe list below now carries the both-declared-AND-published case so the order
 * cannot silently invert again.
 */
type LeverStage =
  | "filters"
  | "owner+inherited"
  | "filters+same-file"
  | "filters+namespace"
  | "emptied-by-owner"
  | "emptied-by-kind"
  | "still-ambiguous"
  | "candidate-set-not-ambiguous"

/**
 * WHICH STAGE WOULD RESOLVE THIS AMBIGUOUS ENDPOINT — the ceiling of the disambiguation levers,
 * priced per endpoint before anything is implemented. Pure, and driven by the self-test below.
 *
 * The order is stated because the number depends on it: the SOUND filters first (the owner channel,
 * then the callable/type-kind rule), then the PREFERENCES (same file, then the file's own
 * namespace). The stage reported is the FIRST that leaves exactly one candidate. `emptied-by-*` is
 * not a resolution: it is an endpoint whose candidate set holds nothing the type can legally point
 * at (`calls` to a name published only as a `property`), which is a DIFFERENT finding from an
 * ambiguity and is counted apart from it rather than folded in.
 */
function leverStage(idx: Index, row: AmbRow, ancestors: Map<string, string[]> = new Map()): LeverStage {
  const leaf = leafOf(row.target)
  const direct = idx.cand.get(row.target)
  const cands = direct && direct.length ? direct : leaf ? idx.cand.get(leaf) ?? [] : []
  if (cands.length <= 1) return "candidate-set-not-ambiguous"
  const afterOwner = row.owner ? cands.filter((c) => c.owner === row.owner) : cands
  if (afterOwner.length === 0) {
    // THE OWNER CHANNEL WALKING THE CLASS'S ANCESTORS — the largest SOUND lever, and the reason it
    // is asked before the preferences: `$this->persist($record)` written in a subclass whose parent
    // declares `persist` is not a guess about which of N candidates was meant, it is PHP's own
    // method resolution. The ancestors come from the store's OWN `extends`/`implements` edges, so
    // nothing is inferred about a class the graph does not connect — and a class whose parent is
    // outside the population stays emptied rather than being resolved to a stranger.
    //
    // TRAIT USE IS NOT COUNTED HERE, deliberately: `uses` is also how every ordinary value read is
    // spelled (`save -> record`), so a heritage map that accepted it would be mostly noise, and the
    // two edges that ARE trait flattens cannot be told apart from the rest at this level. The
    // number below is therefore a LOWER BOUND on the inheritance lever.
    if (row.owner) {
      const anc = ancestors.get(row.owner) ?? []
      if (anc.length) {
        const narrowed = cands.filter((c) => c.owner !== null && anc.includes(c.owner))
        const allowedInherited = FILTER_KINDS[row.t] ? narrowed.filter((c) => FILTER_KINDS[row.t].has(c.kind)) : narrowed
        if (allowedInherited.length === 1) return "owner+inherited"
      }
    }
    return "emptied-by-owner"
  }
  const allowed = FILTER_KINDS[row.t]
  const afterKind = allowed ? afterOwner.filter((c) => allowed.has(c.kind)) : afterOwner
  if (afterKind.length === 0) return "emptied-by-kind"
  if (afterKind.length === 1) return "filters"
  if (afterKind.filter((c) => c.file === row.file).length === 1) return "filters+same-file"
  if (row.fileNs && afterKind.filter((c) => c.ns === row.fileNs).length === 1) return "filters+namespace"
  return "still-ambiguous"
}

function classifySource(source: string, sig: FileSignals, idx: Index, type?: string): string {
  if (!source) return "source:unexplained"
  if (source === "global") return "source:global"
  // `overrides` is the one type whose endpoints are written `Owner.member`, and the TARGET ladder
  // already asks for them that way — the SOURCE side did not, and the omission is what the first
  // whole-population run reported as the lane's last two unexplained endpoints (`A.foo` and
  // `SkipConstruct.__construct`, the sources of the only two `overrides` edges in 350,367). A
  // classifier that resolves a dotted target by its (owner, name) key and then looks up the same
  // dotted string as a BARE NAME is not measuring the store; it is measuring its own gap.
  if (type === "overrides") {
    const dot = source.lastIndexOf(".")
    const keyed = dot > 0 ? idx.pubMember.get(`${source.slice(0, dot)}\u0000${source.slice(dot + 1)}`) ?? 0 : 0
    if (keyed === 1) return "source:published:unique"
    if (keyed > 1) return "source:published:ambiguous"
  }
  const leaf = leafOf(source)
  const names = [source, ...(leaf ? [leaf] : [])]
  const pub = idx.pubName.get(source) ?? 0
  const pubLeaf = leaf ? idx.pubName.get(leaf) ?? 0 : 0
  if (pub === 1 || pubLeaf === 1) return "source:published:unique"
  if (pub > 1 || pubLeaf > 1) return "source:published:ambiguous"
  for (const n of names) {
    if (sig.declaredOnAnonymousClass.has(n)) return "source:declared-on-anonymous-class"
  }
  for (const n of names) {
    if (sig.declared.has(n)) return "source:declared-in-tree-not-published"
  }
  if (sig.variables.has(source)) return "source:variable-in-this-file"
  return "source:unexplained"
}

// ------------------------------------------------------------------ the self-test

{
  const sig: FileSignals = {
    // `inBoth` is declared here AND published: THE case the source ladder got wrong on its first
    // run, so it is a probe rather than an assumption.
    declared: new Set(["lostMethod", "LostClass", "inBoth"]),
    declaredOnAnonymousClass: new Set(["anonMember"]),
    variables: new Set(["s", "offset"]),
  }
  const idx: Index = {
    pubName: new Map([["kept", 1], ["twice", 2], ["inBoth", 1], ["strlen", 0], ["unused", 0]]),
    pubMember: new Map([["Holder\u0000parent", 1], ["Absent\u0000gone", 0], ["A\u0000foo", 1]]),
    memberNames: new Map([["render", 7]]),
    cand: new Map([
      ["render", [
        { name: "render", owner: "Alpha", kind: "method", file: "a.php", ns: "App" },
        { name: "render", owner: "Beta", kind: "method", file: "b.php", ns: "Other" },
      ]],
      ["Widget", [
        { name: "Widget", owner: null, kind: "class", file: "a.php", ns: "App" },
        { name: "Widget", owner: null, kind: "property", file: "c.php", ns: "App" },
      ]],
    ]),
  }
  const probes: [any, string][] = [
    [{ type: "calls", target: "kept", owner: null }, RESOLVED],
    [{ type: "calls", target: "twice", owner: null }, AMBIGUOUS],
    [{ type: "calls", target: "lostMethod", owner: null }, DEFECT],
    [{ type: "calls", target: "inBoth", owner: null }, RESOLVED],
    [{ type: "calls", target: "anonMember", owner: null }, ANON],
    [{ type: "calls", target: "offset", owner: null }, VAR],
    [{ type: "uses", target: "strlen", owner: null }, "external:php-internal-function"],
    [{ type: "calls", target: "$cb", owner: null }, DYNAMIC],
    [{ type: "imports", target: "__DIR__/x.php", owner: null }, PATHY],
    [{ type: "instantiates", target: "Vendor\\Thing", owner: null }, NS_OUTSIDE],
    [{ type: "calls", target: "__", owner: null }, BARE_OUTSIDE],
    [{ type: "calls", target: "a b", owner: null }, UNEXPLAINED],
    [{ type: "calls", target: "$(shell)", owner: null }, DYNAMIC],
    [{ type: "contains", target: "parent", owner: "Holder" }, RESOLVED],
    // THE CONTROL THAT MATTERS: the defect class must be REACHABLE, or `unexplained = 0` is a
    // property of the classifier rather than of the corpus.
    [{ type: "calls", target: "nothing-declares-me", owner: null }, UNEXPLAINED],
  ]
  const bad: string[] = []
  for (const [edge, want] of probes) {
    const got = classifyTarget(edge, sig, idx)
    if (got !== want) bad.push(`${edge.type} ${edge.target}${edge.owner ? ` owner=${edge.owner}` : ""} -> ${got}, wanted ${want}`)
  }
  // THE LEVER ANALYSIS IS A MEASUREMENT TOO, so it gets probes: without them a stage that never
  // fires and a stage that always fires are indistinguishable in the table.
  // The inheritance lever needs its own probe: `render` is published by Alpha and Beta, the row
  // names owner `Child`, and `Child` extends Alpha — so the ancestor walk leaves exactly one.
  const probeAncestors = new Map<string, string[]>([["Child", ["Alpha"]]])
  const leverProbes: [AmbRow, LeverStage][] = [
    [{ t: "uses", target: "render", owner: "Child", fileNs: "App", file: "a.php" }, "owner+inherited"],
    [{ t: "uses", target: "render", owner: "Alpha", fileNs: "App", file: "a.php" }, "filters"],
    [{ t: "uses", target: "render", owner: null, fileNs: "App", file: "b.php" }, "filters+same-file"],
    [{ t: "uses", target: "render", owner: null, fileNs: "Other", file: "c.php" }, "filters+namespace"],
    [{ t: "calls", target: "Widget", owner: null, fileNs: "App", file: "a.php" }, "emptied-by-kind"],
    [{ t: "uses", target: "Widget", owner: "Nope", fileNs: "App", file: "a.php" }, "emptied-by-owner"],
    [{ t: "kept", target: "kept", owner: null, fileNs: null, file: "a.php" }, "candidate-set-not-ambiguous"],
  ]
  for (const [row, want] of leverProbes) {
    const got = leverStage(idx, row, probeAncestors)
    if (got !== want) bad.push(`lever ${row.t} ${row.target} owner=${row.owner ?? "-"} -> ${got}, wanted ${want}`)
  }

  const srcProbes: [string, string | undefined, string][] = [
    ["global", undefined, "source:global"],
    // The dotted `overrides` source — and the probe that would have caught the omission above: `A`
    // is not a published name and `A.foo` is not either, but the PAIR is published once. Without
    // the type it correctly falls through to the unexplained class, which is what the probe below
    // records, so the pair of rows pins the shape AND the discrimination.
    ["A.foo", "overrides", "source:published:unique"],
    ["A.foo", undefined, "source:unexplained"],
    ["kept", undefined, "source:published:unique"],
    ["inBoth", undefined, "source:published:unique"],
    ["twice", undefined, "source:published:ambiguous"],
    ["anonMember", undefined, "source:declared-on-anonymous-class"],
    ["lostMethod", undefined, "source:declared-in-tree-not-published"],
    ["offset", undefined, "source:variable-in-this-file"],
    ["nothing-declares-me", undefined, "source:unexplained"],
  ]
  for (const [s, type, want] of srcProbes) {
    const got = classifySource(s, sig, idx, type)
    if (got !== want) bad.push(`source ${s} -> ${got}, wanted ${want}`)
  }
  if (bad.length) {
    console.error(`reason-census: SELF-TEST FAILED (${bad.length} of ${probes.length + srcProbes.length + leverProbes.length} probes wrong):`)
    for (const b of bad) console.error(`  ${b}`)
    console.error("Refusing to walk the corpus: a classifier that cannot separate these classes would report zeros for reasons that are not measurements.")
    process.exit(3)
  }
  console.log(`self-test: PASS (${probes.length} target + ${srcProbes.length} source + ${leverProbes.length} lever probes, the SAME functions the walk calls)`)
}

// ------------------------------------------------------------------ population

const admitted: { label: string; abs: string }[] = []
let reposScanned = 0
const tScan = Date.now()
for (const entry of readdirSync(CORPUS)) {
  const dir = path.join(CORPUS, entry)
  let tracked: string[] = []
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    reposScanned++
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    // THE FILE IS READ ONLY WHEN THE PATH CANNOT DECIDE, and this is a measured correction, not a
    // micro-optimisation: reading every candidate to hand `detectLanguageFromPath` its optional
    // `content` argument cost **64.9s of a 91.7s run** (a 600-file sample, with parseFile at 24.2s
    // and the whole tree walk at 1.8s) — the census was spending three quarters of its life
    // deciding which files belong to it. The content argument is consulted only for a file with
    // NO extension (its shebang decides) or a `.h` header (C vs C++, never php), so every other
    // path is routed by extension alone and only the admitted ones are ever read.
    const base = path.basename(abs).toLowerCase()
    const needsContent = base.lastIndexOf(".") < 0
    let text: string | undefined
    try {
      const st = statSync(abs)
      if (st.size > SIZE_CAP) continue
      if (needsContent) text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "php") continue
    admitted.push({ label: `${entry}/${rel}`, abs })
  }
}
admitted.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
const scanMs = Date.now() - tScan
const population = admitted.length
const sampled = N !== 0 && population > N
const picked: typeof admitted = []
if (N === 0 || population <= N) picked.push(...admitted)
else for (let i = 0; i < N; i++) picked.push(admitted[Math.floor((i * population) / N)])

console.log(`php reason census — both endpoints, production parseFile`)
console.log(`corpus root         ${CORPUS}`)
console.log(`repos scanned       ${reposScanned}`)
console.log(`admitted population ${String(population).padStart(8)}`)
console.log(`files measured      ${String(picked.length).padStart(8)}${picked.length < population ? `   SAMPLE of ${population} (--files ${N}${argOf("--files") ? "" : ""}) — the whole-population claim needs --files 0` : "   (the whole admitted population)"}`)
console.log(`source of the list  git ls-files per repo, language 'php' by detectLanguageFromPath on the PATH (content read only for extensionless files), files > ${SIZE_CAP} bytes skipped`)

// ------------------------------------------------------------------ the walk

const idx: Index = { pubName: new Map(), pubMember: new Map(), memberNames: new Map(), cand: new Map() }
const ambiguousRows: AmbRow[] = []
// EVERY edge, minimal form — the incoming direction cannot be measured from the ambiguous rows
// alone, because the question it asks is about the edges that DO resolve.
const edgeRows: EdgeRow[] = []
const targetClasses = new Map<string, number>()
const sourceClasses = new Map<string, number>()
const perType: Record<string, { edges: number; target: Record<string, number>; source: Record<string, number> }> = {}
for (const T of TYPES) perType[T] = { edges: 0, target: {}, source: {} }
const unexplainedRows: any[] = []
const defectRows: any[] = []
const topUnresolved: Record<string, Map<string, number>> = {}
let symbols = 0
let edgesSeen = 0
let analyzed = 0
let parseFailures = 0
let errorFiles = 0
const t0 = Date.now()
// Phase timers. A census that cannot say WHERE its minutes go cannot be made to fit a
// whole-population run, and "it is too slow to re-measure" is how a claim decays into a memory.
const phase = { parse: 0, tree: 0, classify: 0 }

// TWO PASSES, and the reason is not tidiness. A single pass classifies each file against the store
// AS IT STOOD when that file was reached, so a declaration published by a LATER file is invisible
// to an earlier one. The outgoing classes survive that — a name nothing has published yet truly has
// no candidate at that moment — but the INCOMING section does not: it asks which edges REACH a
// declaration, and an edge classified against a partial index reads as "names a declaration and
// arrives from nowhere" when the declaration simply had not been read yet. Measured before the
// split, on a 40-file probe: 119 `variable-in-this-file` and 56
// `external:bare-name-outside-population` edges were counted as NAMING declarations they could not
// have named at the time. PASS 1 builds the COMPLETE publication index and keeps every edge in
// minimal form; PASS 2 walks the trees and classifies against that complete index.
type EdgeInput = { t: string; source: string; target: string; owner: string | null; line: number | null }
type FileRecord = { label: string; abs: string; ns: string | null; edges: EdgeInput[] }
const records: FileRecord[] = []

// ---------------- PASS 1: parse every file, index its symbols, keep its edges
for (const f of picked) {
  let r: any
  const tParse = Date.now()
  try {
    r = await parseFile(f.abs, "php")
  } catch {
    parseFailures++
    continue
  } finally {
    phase.parse += Date.now() - tParse
  }
  if (!r?.success) {
    parseFailures++
    continue
  }
  analyzed++
  if ((r.errors ?? []).length > 0) errorFiles++

  // The file's namespace as THIS lane resolves it: the namespace symbol the analyzer itself
  // published for the file. Asked of the store rather than re-derived from the tree, because a
  // lever that used a second implementation of the namespace rule could disagree with the analyzer
  // and the disagreement would read as an ambiguity.
  const fileNs = String((r.symbols ?? []).find((s: any) => String(s?.kind) === "namespace")?.name ?? "") || null
  for (const s of r.symbols ?? []) {
    const n = String(s?.name ?? "")
    if (!n) continue
    symbols++
    idx.pubName.set(n, (idx.pubName.get(n) ?? 0) + 1)
    const owner = s.ownerName ?? s.metadata?.ownerName
    if (owner) {
      idx.pubMember.set(`${owner}\u0000${n}`, (idx.pubMember.get(`${owner}\u0000${n}`) ?? 0) + 1)
      idx.memberNames.set(n, (idx.memberNames.get(n) ?? 0) + 1)
    }
    const list = idx.cand.get(n) ?? (idx.cand.set(n, []), idx.cand.get(n)!)
    list.push({ name: n, owner: owner ?? null, kind: String(s.kind ?? ""), file: f.label, ns: fileNs })
  }
  const edges: EdgeInput[] = []
  for (const rel of r.relationships ?? []) {
    const t = String(rel?.type ?? "")
    if (!perType[t]) continue
    // Counted in PASS 1; PASS 2 must classify exactly this many, which is a control below.
    edgesSeen++
    const md = (rel?.metadata ?? {}) as Record<string, unknown>
    edges.push({
      t,
      source: String(rel?.source ?? ""),
      target: String(rel?.target ?? ""),
      owner: (md.owner ?? md.ownerName ?? null) as string | null,
      line: (rel?.line_number ?? null) as number | null,
    })
  }
  records.push({ label: f.label, abs: f.abs, ns: fileNs, edges })
}

// ---------------- PASS 2: the tree signals, then the classification — against the COMPLETE index
let classified = 0
for (const rec of records) {
  const f = rec
  const content = readFileSync(f.abs, "utf8")
  const fileNs = f.ns
  const sig: FileSignals = { declared: new Set(), declaredOnAnonymousClass: new Set(), variables: new Set() }

  // The tree, for the two signals no symbol table can answer: what the file DECLARES (including
  // what the projection did not publish), and which of those declarations sit on an anonymous
  // class. Released in `finally`: a retained tree per file is how a walk over 5,094 files runs
  // the box out of memory, and the failure looks like a corpus that cannot be measured rather
  // than like a leak.
  let tree: any = null
  const tTree = Date.now()
  try {
    const parsed: any = await ASTEngine.parseTree(f.abs, content)
    tree = parsed?.tree ?? null
    const root: any = tree?.rootNode ?? parsed?.rootNode
    if (root) {
      const stack: Array<{ n: any; anon: boolean }> = [{ n: root, anon: false }]
      while (stack.length) {
        const { n, anon } = stack.pop()!
        const t = n.type
        if (t === "variable_name") {
          const txt = String(n.text)
          sig.variables.add(txt.startsWith("$") ? txt.slice(1) : txt)
        }
        // The anonymous class node is `anonymous_class`, a child of `object_creation_expression`
        // — MEASURED against the pinned grammar, and the correction that mattered: the first draft
        // of this walk looked for an `object_creation_expression` with a `class` child, found none
        // in any file, and so filed every member of every anonymous class as
        // `declared-in-tree-not-published` — a defect class reporting a ruling's worth of edges
        // (phpunit's `ExporterTest.php` alone: `export`, `handles`, `__construct`,
        // `$representation`). A walk that cannot see anonymous classes makes M37.13 look like a bug.
        const isAnonClass = t === "anonymous_class"
        if (DECL_NODES.has(t)) {
          let name: string | null = null
          if (t === "property_element") name = n.namedChildren?.find?.((c: any) => c.type === "variable_name")?.text ?? null
          else name = n.childForFieldName?.("name")?.text ?? null
          if (name) {
            const bare = name.startsWith("$") ? name.slice(1) : name
            ;(anon ? sig.declaredOnAnonymousClass : sig.declared).add(bare)
          }
        }
        if (PARAM_NODES.has(t)) {
          const v = n.namedChildren?.find?.((c: any) => c.type === "variable_name")?.text
          if (v) sig.variables.add(String(v).replace(/^\$/, ""))
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const c = n.namedChild(i)
          if (c) stack.push({ n: c, anon: anon || isAnonClass })
        }
      }
    }
  } catch {
    /* a file the lenient index cannot parse keeps its symbol-table signals only */
  } finally {
    phase.tree += Date.now() - tTree
    try {
      tree?.delete?.()
    } catch {
      /* delete() on an already-released tree */
    }
  }

  const tClassify = Date.now()
  for (const rel of rec.edges) {
    const t = rel.t
    const owner = rel.owner
    const target = rel.target
    const source = rel.source
    const acc = perType[t]
    acc.edges++
    classified++

    const tCls = classifyTarget({ type: t, target, owner }, sig, idx)
    const sCls = classifySource(source, sig, idx, t)
    if (tCls === AMBIGUOUS) ambiguousRows.push({ t, target, owner, fileNs, file: f.label })
    edgeRows.push({ t, target, owner, fileNs, file: f.label, cls: tCls, source })
    targetClasses.set(tCls, (targetClasses.get(tCls) ?? 0) + 1)
    sourceClasses.set(sCls, (sourceClasses.get(sCls) ?? 0) + 1)
    acc.target[tCls] = (acc.target[tCls] ?? 0) + 1
    acc.source[sCls] = (acc.source[sCls] ?? 0) + 1

    if (tCls !== RESOLVED && tCls !== AMBIGUOUS) {
      const m = topUnresolved[t] ?? (topUnresolved[t] = new Map())
      m.set(target, (m.get(target) ?? 0) + 1)
    }
    const row = { type: t, source, target, owner, line: rel.line, file: f.label, class: tCls }
    if (tCls === DEFECT) defectRows.push(row)
    if (tCls === UNEXPLAINED || sCls === "source:unexplained" || sCls === "source:declared-in-tree-not-published") {
      if (unexplainedRows.length < 200) unexplainedRows.push({ ...row, sourceClass: sCls })
    }
  }
  phase.classify += Date.now() - tClassify
}

// ------------------------------------------------------------------ the ambiguity levers

// THE HERITAGE GRAPH, built from the store's own `extends`/`implements` edges and nothing else.
// `uses` is deliberately absent: it is also how every ordinary value read is spelled
// (`save -> record`), so a map that accepted it would be mostly noise, and the inlet is documented
// as a lower bound instead of being padded.
const classParents = new Map<string, string[]>()
for (const row of edgeRows) {
  if (row.t !== "extends" && row.t !== "implements") continue
  if (!row.source || !row.target) continue
  const parent = leafOf(row.target) ?? row.target
  const list = classParents.get(row.source) ?? (classParents.set(row.source, []), classParents.get(row.source)!)
  if (!list.includes(parent)) list.push(parent)
}
const ancestorCache = new Map<string, string[]>()
function ancestorsOf(name: string): string[] {
  const hit = ancestorCache.get(name)
  if (hit) return hit
  const out = new Set<string>()
  const stack = [name]
  let guard = 0
  while (stack.length && guard++ < 500) {
    const cur = stack.pop()!
    for (const p of classParents.get(cur) ?? []) {
      if (out.has(p)) continue
      out.add(p)
      stack.push(p)
    }
  }
  const list = [...out]
  ancestorCache.set(name, list)
  return list
}

const leverCounts = new Map<LeverStage, number>()
const stillAmbiguousByType = new Map<string, number>()
const stillAmbiguousNames = new Map<string, number>()
for (const row of ambiguousRows) {
  // `ancestorCache` IS the map `leverStage` reads: `ancestorsOf` fills it lazily per owner, so the
  // closure is computed once per class rather than once per endpoint.
  if (row.owner) ancestorsOf(row.owner)
  const stage = leverStage(idx, row, ancestorCache)
  leverCounts.set(stage, (leverCounts.get(stage) ?? 0) + 1)
  if (stage === "still-ambiguous") {
    stillAmbiguousByType.set(row.t, (stillAmbiguousByType.get(row.t) ?? 0) + 1)
    stillAmbiguousNames.set(row.target, (stillAmbiguousNames.get(row.target) ?? 0) + 1)
  }
}
const lever = (s: LeverStage) => leverCounts.get(s) ?? 0

// ------------------------------------------------------------------ the incoming direction
//
// The mission's standard is BOTH directions, and the outgoing side is not evidence about the
// reverse walk: an edge that does not resolve cannot be traversed from the declaration side either,
// and the ledger's php incoming row came from a 30-file and a 600-file SAMPLER. This is the same
// population and the same classification seen from the declarations, over every edge.
//
// Two numbers per declaration, and the distinction between them is the finding:
//   NAMED BY  — an edge writes this name (any class: resolved, ambiguous, external, keyword...)
//   REACHED BY — an edge RESOLVES to this exact declaration, kind included
// A declaration named by at least one edge and reached by none is the incoming hole: the graph has
// edges pointing at it and not one of them arrives.
const reachedBy = new Map<string, number>()
const namedBy = new Map<string, number>()
let resolvedEdgesWithoutIdentity = 0
// WHICH CLASSES named each declaration, as a first-class + mixed flag rather than a Set and rather
// than a counter. A counter over (edge \u00d7 candidate) pairs answered a different question — one
// ambiguous edge naming 30 candidates incremented 30 times and read as a cause it is not — and a Set
// per declaration allocates 40,000 of them for an answer two fields carry.
const namingCause = new Map<string, { first: string; mixed: boolean }>()
const unreachedByCause = new Map<string, number>()
for (const row of edgeRows) {
  const id = identityOf(row, idx)
  if (row.cls === RESOLVED) {
    // A RESOLVING edge reaches its declaration and NAMES nothing else. This distinction is the
    // difference between the metric and a name-collision count: an owner-channel hit
    // (`$this->foo()` resolving to Alpha::foo) writes the bare name `foo`, which a dozen other
    // classes also carry, and counting those as NAMED read as 295 declarations that edges point at
    // while the edge had in fact arrived somewhere else. An edge that the owner channel
    // disambiguated did not MEAN those declarations, so it does not name them here.
    if (id) reachedBy.set(id, (reachedBy.get(id) ?? 0) + 1)
    else resolvedEdgesWithoutIdentity++
    continue
  }
  const leaf = leafOf(row.target)
  const direct = idx.cand.get(row.target)
  const cands = direct && direct.length ? direct : leaf ? idx.cand.get(leaf) ?? [] : []
  for (const c of cands) {
    const k = candKey(c)
    namedBy.set(k, (namedBy.get(k) ?? 0) + 1)
    const cur = namingCause.get(k)
    if (!cur) namingCause.set(k, { first: row.cls, mixed: false })
    else if (cur.first !== row.cls) cur.mixed = true
  }
}
// FOUR BUCKETS, and they must exhaust the population — reached \u00d7 named, which is why the run
// prints all four and asserts their sum. The two middle ones are the mission's incoming answer:
// a declaration the graph reaches is covered, a declaration named-but-unreached is the HOLE, and a
// declaration nothing writes at all is a different fact (a public symbol this corpus never uses).
let declarations = 0
let namedDeclarations = 0
let reachedDeclarations = 0
let reachedAndNamed = 0
let reachedOnly = 0
let namedButUnreached = 0
let neither = 0
for (const list of idx.cand.values()) {
  for (const c of list) {
    declarations++
    const k = candKey(c)
    const named = namedBy.get(k) ?? 0
    const reached = reachedBy.get(k) ?? 0
    if (named > 0) namedDeclarations++
    if (reached > 0) reachedDeclarations++
    if (reached > 0 && named > 0) reachedAndNamed++
    else if (reached > 0) reachedOnly++
    else if (named > 0) {
      namedButUnreached++
      const cause = namingCause.get(k)
      unreachedByCause.set(
        !cause ? "unnamed" : cause.mixed ? "named by edges in MORE THAN ONE class" : cause.first,
        (unreachedByCause.get(!cause ? "unnamed" : cause.mixed ? "named by edges in MORE THAN ONE class" : cause.first) ?? 0) + 1,
      )
    } else neither++
  }
}

// ------------------------------------------------------------------ controls

const typesSeen = TYPES.filter((T) => perType[T].edges > 0)
const targetResolved = targetClasses.get(RESOLVED) ?? 0
const targetAmbiguous = targetClasses.get(AMBIGUOUS) ?? 0
// The fourth field is whether a false result is FATAL. Two of these controls are properties of
// the POPULATION rather than of the instrument — a 6-file sample can legitimately contain no
// `overrides` edge and no ambiguous name, and failing the run for that would make the instrument
// unusable exactly where it is most needed (a quick probe). They stay visible either way, and
// they are NOT relaxed into silence: a sampled run prints `SAMPLE` and the whole-population run
// fails hard, so the strict reading is always the one attached to a whole-population claim.
const controls: [string, boolean, string, boolean][] = [
  ["edges seen", edgesSeen > 0, String(edgesSeen), true],
  ["all ten relationship types seen", typesSeen.length === TYPES.length, `${typesSeen.length}/10${typesSeen.length < TYPES.length ? ` — missing ${TYPES.filter((T) => !typesSeen.includes(T)).join(", ")}` : ""}`, !sampled],
  ["symbols published", symbols > 0, String(symbols), true],
  ["at least one resolved:unique target", targetResolved > 0, String(targetResolved), true],
  ["at least one ambiguous target", targetAmbiguous > 0, String(targetAmbiguous), !sampled],
  ["no parse failures", parseFailures === 0, String(parseFailures), true],
  // The two-pass split's own control: PASS 1 counts the edges, PASS 2 must classify every one of
  // them. A class table that quietly dropped a file during the re-read would otherwise still add up.
  ["every edge classified once", classified === edgesSeen, `${classified}/${edgesSeen}`, true],
  // The incoming direction needs its own controls for the same reason the classifier does: a
  // REACH count over a population where nothing resolves, and one where everything resolves, would
  // both print a number and mean nothing.
  ["declarations reached by >=1 edge", reachedDeclarations > 0, String(reachedDeclarations), true],
  ["the incoming hole is not the population", namedButUnreached < declarations, `${namedButUnreached}/${declarations}`, true],
  ["the incoming buckets exhaust the declarations", reachedAndNamed + reachedOnly + namedButUnreached + neither === declarations, `${reachedAndNamed + reachedOnly + namedButUnreached + neither}/${declarations}`, true],
]
console.log("")
console.log("--- CONTROLS: a zero below would make the table meaningless ---")
let controlFail = false
for (const [name, ok, detail, strict] of controls) {
  if (!ok && strict) controlFail = true
  console.log(`  ${ok ? "OK  " : strict ? "FAIL" : "SAMPLE"}  ${name.padEnd(38)}${detail}${!ok && !strict ? "   (not fatal: this run is a sample)" : ""}`)
}
if (controlFail) {
  console.error("CONTROL FAILED: the census cannot be believed. Exiting 3.")
  process.exit(3)
}

// ------------------------------------------------------------------ table

const pad = (s: any, n: number) => String(s).padEnd(n)
const share = (n: number) => `${((n / Math.max(1, edgesSeen)) * 100).toFixed(2)}%`
console.log("")
console.log(`files ${analyzed}/${picked.length} analyzed   symbols ${symbols}   edges ${edgesSeen}   parser-error files ${errorFiles}   ${((Date.now() - t0) / 1000).toFixed(1)}s`)
console.log(`phases: parseFile ${(phase.parse / 1000).toFixed(1)}s   tree walk ${(phase.tree / 1000).toFixed(1)}s   classify ${(phase.classify / 1000).toFixed(1)}s   population scan ${(scanMs / 1000).toFixed(1)}s`)
console.log("")
console.log(pad("TARGET CLASS", 44) + pad("EDGES", 10) + "SHARE")
for (const [k, v] of [...targetClasses.entries()].sort((a, b) => b[1] - a[1])) console.log(pad(k, 44) + pad(v, 10) + share(v))
console.log("")
console.log(pad("SOURCE CLASS", 44) + pad("EDGES", 10) + "SHARE")
for (const [k, v] of [...sourceClasses.entries()].sort((a, b) => b[1] - a[1])) console.log(pad(k, 44) + pad(v, 10) + share(v))

console.log("")
console.log("per type (target side):")
console.log("  " + pad("type", 14) + pad("edges", 8) + pad("resolved", 10) + pad("ambiguous", 11) + pad("defect", 8) + pad("anon", 7) + pad("variable", 10) + pad("internal", 10) + pad("outside", 9))
for (const T of TYPES) {
  const a = perType[T]
  const g = (k: string) => a.target[k] ?? 0
  const internal = Object.entries(a.target).filter(([k]) => k.startsWith("external:php-internal-")).reduce((x, [, v]) => x + v, 0)
  const outside = g(BARE_OUTSIDE) + g(NS_OUTSIDE)
  console.log(
    "  " + pad(T, 14) + pad(a.edges, 8) + pad(g(RESOLVED), 10) + pad(g(AMBIGUOUS), 11) + pad(g(DEFECT), 8) + pad(g(ANON), 7) + pad(g(VAR), 10) + pad(internal, 10) + pad(outside, 9),
  )
}

console.log("")
console.log("top unresolved target names per type:")
for (const T of TYPES) {
  const list = [...(topUnresolved[T] ?? new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  if (list.length) console.log(`  ${pad(T, 13)} ${list.map(([n, c]) => `${n}(${c})`).join(" ")}`)
}

if (defectRows.length) {
  console.log("")
  console.log(`DEFECT CLASS — declared in tree, not published: ${defectRows.length} edge(s), first 20:`)
  for (const r of defectRows.slice(0, 20)) console.log(`  ${pad(r.type, 13)} ${pad(r.target, 28)} ${r.file}:${r.line} owner=${r.owner ?? "-"}`)
}
if (unexplainedRows.length) {
  console.log("")
  console.log(`UNEXPLAINED (target or source): ${unexplainedRows.length} edge(s), first 40:`)
  for (const r of unexplainedRows.slice(0, 40)) console.log(`  ${pad(r.type, 13)} ${pad(r.source, 26)} -> ${pad(r.target, 26)} ${r.file}:${r.line} target=${r.class} source=${r.sourceClass}`)
}

console.log("")
console.log(`AMBIGUITY LEVERS — what would resolve the ${ambiguousRows.length} ambiguous target endpoints`)
console.log(`  ${pad(`stage`, 30)}${pad("ENDPOINTS", 12)}SHARE OF AMBIGUOUS    (order: sound filters, then preferences)`)
for (const [k, v] of [...leverCounts.entries()].sort((a, b) => b[1] - a[1])) {
  const label =
    k === "filters" ? "filters (owner + kind)"
    : k === "owner+inherited" ? "owner channel via ANCESTORS (sound)"
    : k === "filters+same-file" ? "+ same-file preference"
    : k === "filters+namespace" ? "+ namespace preference"
    : k
  console.log(`  ${pad(label, 30)}${pad(v, 12)}${((v / Math.max(1, ambiguousRows.length)) * 100).toFixed(2)}%`)
}
const closedByLevers = ambiguousRows.length - lever("still-ambiguous") - lever("candidate-set-not-ambiguous")
console.log(`  of those, ${closedByLevers} would leave exactly one candidate and ${lever("still-ambiguous")} would not`)
console.log(`  no candidate the type can point at: ${lever("emptied-by-kind")} by KIND and ${lever("emptied-by-owner")} by OWNER — endpoints the current resolver calls ambiguous but that a kind-aware one cannot call resolved at all`)
if (lever("still-ambiguous")) {
  console.log(`  still ambiguous by type: ${[...stillAmbiguousByType.entries()].sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}(${c})`).join(" ")}`)
  console.log(`  top names: ${[...stillAmbiguousNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, c]) => `${n}(${c})`).join(" ")}`)
}

console.log("")
console.log("INCOMING — the same edges, read from the declarations")
console.log(`  declarations published                 ${declarations}`)
const pct = (n: number) => `${((n / Math.max(1, declarations)) * 100).toFixed(2)}%`
console.log(`  reached by >=1 resolving edge          ${pad(reachedDeclarations, 8)}${pct(reachedDeclarations)}`)
console.log(`    of them, reached AND named           ${pad(reachedAndNamed, 8)}${pct(reachedAndNamed)}   (an unresolved edge writes its name and another edge arrives)`)
console.log(`    of them, reached and named by none   ${pad(reachedOnly, 8)}${pct(reachedOnly)}   (the graph arrives without any competing writer)`)
console.log(`  NAMED BUT REACHED BY NONE              ${pad(namedButUnreached, 8)}${pct(namedButUnreached)}   <- THE INCOMING HOLE: edges write its name, none arrives`)
console.log(`  neither reached nor named              ${pad(neither, 8)}${pct(neither)}   (published, and no unresolved edge writes its name)`)
console.log(`  the four buckets sum to               ${reachedAndNamed + reachedOnly + namedButUnreached + neither} of ${declarations}`)
if (resolvedEdgesWithoutIdentity > 0) {
  console.log(`  resolved edges with no single identity ${resolvedEdgesWithoutIdentity}   (the overrides keyed-rule accepts >=1 candidate; every other resolver asks for exactly one)`)
}
console.log(`  unreachable declarations, by the cause their naming edges carry:`)
for (const [k, v] of [...unreachedByCause.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`    ${pad(k, 46)}${v}`)
}

const report = {
  instrument: "validation/m14/fixtures/php/reason-census.mts",
  incoming: {
    declarations,
    namedByAtLeastOneUnresolvedEdge: namedDeclarations,
    reachedByAtLeastOneResolvingEdge: reachedDeclarations,
    reachedAndNamed,
    reachedAndNamedByNothing: reachedOnly,
    namedButReachedByNone: namedButUnreached,
    neitherNamedNorReached: neither,
    resolvedEdgesWithoutASingleIdentity: resolvedEdgesWithoutIdentity,
    unreachableDeclarationsByCause: Object.fromEntries([...unreachedByCause.entries()].sort((a, b) => b[1] - a[1])),
    note: "A declaration named by >=1 edge and reached by none is the incoming hole, and the class breakdown says which target classes its naming edges fell into. `resolvedEdgesWithoutASingleIdentity` is a CONSISTENCY metric, not a claim: the `overrides` resolver accepts (owner, name) with one OR MORE publishers while every other resolver asks for exactly one, so a non-zero value is the resolver's looseness showing up here rather than a defect in the store.",
  },
  ambiguityLevers: {
    ambiguousEndpoints: ambiguousRows.length,
    order: "sound filters (owner channel, then the type's callable/kind rule), then preferences (same file, then the file's namespace)",
    stages: Object.fromEntries([...leverCounts.entries()].sort((a, b) => b[1] - a[1])),
    filterKinds: Object.fromEntries(Object.entries(FILTER_KINDS).map(([k, v]) => [k, [...v]])),
    stillAmbiguousByType: Object.fromEntries([...stillAmbiguousByType.entries()].sort((a, b) => b[1] - a[1])),
    topStillAmbiguousNames: Object.fromEntries([...stillAmbiguousNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)),
    caveat: "A CEILING, NOT A RESULT: the stages are rules this lane has NOT adopted, priced before anything is implemented. Every stage that would resolve by PREFERENCE changes a resolution rather than adding one, so each needs the whole-population before/after plus fixtures — and the +225 resolved edges this lane once measured from a bare-name fix were a cross-repo collision, not coverage.",
  },
  entryPoint: "parseFile (src/ast/pool-worker.ts)",
  corpusRoot: CORPUS,
  reposScanned,
  admittedPopulation: population,
  filesMeasured: picked.length,
  sampled,
  requestedFiles: N,
  filesAnalyzed: analyzed,
  parseFailures,
  parserErrorFiles: errorFiles,
  symbolsPublished: symbols,
  edgesSeen,
  typesSeen: typesSeen.length,
  targetClasses: Object.fromEntries([...targetClasses.entries()].sort((a, b) => b[1] - a[1])),
  sourceClasses: Object.fromEntries([...sourceClasses.entries()].sort((a, b) => b[1] - a[1])),
  perType,
  topUnresolvedByType: Object.fromEntries(TYPES.map((T) => [T, [...(topUnresolved[T] ?? new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)])),
  defectRows: defectRows.slice(0, 200),
  unexplainedRows: unexplainedRows.slice(0, 200),
  unexplainedTotal: unexplainedRows.length,
  elapsedSec: (Date.now() - t0) / 1000,
}
if (OUT) {
  mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true })
  writeFileSync(path.resolve(OUT), JSON.stringify(report, null, 2) + "\n")
  console.log(`\nwrote ${OUT}`)
}

const unexplained = (targetClasses.get(UNEXPLAINED) ?? 0) + (sourceClasses.get("source:unexplained") ?? 0) + (sourceClasses.get("source:declared-in-tree-not-published") ?? 0)
console.log("")
if (unexplained > 0) {
  console.log(`FAIL — ${unexplained} endpoint(s) in a class the lane does not explain (target unexplained + source unexplained + source declared-in-tree-not-published)`)
  process.exit(1)
}
console.log(`PASS — every one of ${edgesSeen} edge endpoints is resolved, or names a reason this census can state`)
console.log(`       of them, ${targetClasses.get(DEFECT) ?? 0} target(s) are in the DEFECT class (declared in tree, not published)`)
