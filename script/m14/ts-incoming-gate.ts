/**
 * TS INCOMING COMPLETION GATE — the lane's answer to "is the incoming side done?"
 *
 * ## Why this file exists, and why the fleet gate was not enough
 *
 * `script/m14/incoming-gate.ts` is the fleet arbiter and it is correct about what it
 * measures. Two things stop it from answering this lane's question:
 *
 *   1. **It counts a target's candidates as DECLARATIONS (one per symbol), not as
 *      declaring FILES.** The lane corrected that rule on 2026-10-09:
 *      `script/m14/incoming-check.ts` now counts distinct declaring files, treats a
 *      type plus its runtime binding in one file as ONE declaration (TypeScript
 *      declaration merging), and consults `metadata.isAugmentation` declarations
 *      only when no non-augmentation declaration of that name exists anywhere in
 *      the pool. Under the old symbol-counting rule `Observable` was ambiguous
 *      against its own 95 `declare global` augmentations (510 `instantiates`
 *      edges) while `subscribe` — a method name 51 files legitimately declare —
 *      counted RESOLVED whenever all 51 agreed on the kind. Both readings are
 *      wrong in opposite directions and the corrected rule is the one this lane
 *      stands behind.
 *   2. **It has no way to accept a class that cannot resolve BY DESIGN.** A module
 *      URI is not a symbol, so `imports`/`exports` resolve at 0% forever; and a
 *      member call whose receiver is a local variable is not provable from the
 *      file. Under a verdict that only counts `ambiguous + unresolved == 0` as a
 *      pass, this lane can never pass — and a gate that can never pass is one
 *      nobody reads, which is the failure mode this programme has hit before.
 *
 * So this gate changes the QUESTION from "is every edge resolved" to:
 *
 *   **is every emitted edge in a DECLARED class, and is every declared class
 *   inside its recorded ceiling?**
 *
 * ## What a PASS means, exactly, and what it refuses to mean
 *
 * PASS means: every edge this analyzer emits falls into one of the classes below,
 * every nonzero class carries a written disposition in
 * `validation/m14/instruments/typescript/incoming-baseline.json`, and no class is
 * larger than the number recorded there. The classes are:
 *
 *   resolved            the edge names ONE declaration, by one of FOUR rules, each
 *                       printed with its own count:
 *                         leaf-unique        one declaring file publishes the target
 *                         qualified-endpoint `<source>.<target>` is a qualifiedName the
 *                                            pool publishes IN THIS FILE — the owner the
 *                                            edge names is the owner the pool has
 *                         lexical-local      the file itself declares the name, and the
 *                                            reference is a BARE name (never `x.foo`)
 *                         lexical-import     the file binds the name to ONE relative
 *                                            module, and that module declares it
 *                       The last three are properties of the EDGE'S OWN FILE, not of the
 *                       pool, and that is the point: `subscribe` declared by 294 files is
 *                       not ambiguous to `subject.ts`, which declares its own.
 *   external            the target is outside the corpus and the edge SAYS SO, with
 *                       a machine-readable `metadata.externalReason`
 *   ambiguous           N declaring files and nothing in this file's scope picks one —
 *                       the reverse walk would pick by a rule nobody chose
 *   unresolved          the target names nothing the pool publishes
 *   selfLoop            source === target (legitimate: a recursive call)
 *   targetless          the edge carries no target string at all
 *   externalUnreasoned  marked external with no reason recorded — a claim nobody can
 *                       audit, and the one class this lane requires to be ZERO
 *
 * The lexical rules REPLACED a pool-wide-only rule that called 4,234 bindable edges
 * ambiguous and 17 more wrongly bindable. Both directions were measured before the
 * change (`/tmp/ts-done-probe.mts`): bare-vs-member SHAPE is what makes
 * `lexical-local` sound (`import { join } from "node:path"` says nothing about
 * `[1,2].join`, and 17 `calls` edges on this pool have exactly that shape), and
 * `uses`/`contains` are EXCLUDED from it because a member name declared in the file
 * is not proof the edge's source owns it — they bind by the qualified endpoint or not
 * at all.
 *
 * PASS does NOT mean the graph is complete or correct. An edge can resolve to the
 * WRONG declaration (`script/m14/differential.ts` and the mutation suite own that
 * question), and the ambiguous/unresolved columns are a BACKLOG, declared with a
 * size and a named lever, not a set of exemptions that hides them. The verdict line
 * prints the backlog so a reader never has to open the JSON to see it.
 *
 * ## The positive control
 *
 * Two functions decide the verdict — the edge classifier and the ratchet — and both
 * are self-tested before a corpus is read, exactly as the fleet gate's control is.
 * The control plants one edge of every class and asserts each lands where it
 * belongs, and it plants a ceiling BELOW a measured count and asserts the ratchet
 * reports an overrun. A probe that cannot fail returns the same number as a clean
 * lane, so if the control does not fire this exits 3 and reports no lane.
 *
 * ## Usage
 *
 *   npx tsx script/m14/ts-incoming-gate.ts                 # full pool
 *   npx tsx script/m14/ts-incoming-gate.ts 200             # stride sample
 *   npx tsx script/m14/ts-incoming-gate.ts --json
 *   npx tsx script/m14/ts-incoming-gate.ts --update-baseline
 *
 * `--update-baseline` moves a ceiling to today's measurement and REFUSES to invent a
 * disposition for a class that has none: a new nonzero class must be given a rule by
 * hand, because a ceiling written by the same run that produced the number ratifies
 * whatever that run did.
 *
 * READ-ONLY with respect to the corpus. Exit 0 pass · 1 fail · 2 usage/population ·
 * 3 the instrument's own control did not fire.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../src/ast/pool-worker"

const REPO = path.resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO_NAME = process.env.BB_TS_REPO ?? "rxjs"
// `BB_TS_BASELINE` exists so a proposed ceiling can be tested WITHOUT editing the
// recorded one: point the gate at a copy, and the ratchet's fail path is exercised end
// to end rather than only in the self-test.
const BASELINE = process.env.BB_TS_BASELINE ?? path.join(REPO, "validation/m14/instruments/typescript/incoming-baseline.json")
const ANALYZER = path.join(REPO, "src/ast/real-typescript-analyzer.ts")

/** The ten ontology names, as the STORE spells them on a relationship row. Both
 *  `imports` spellings are accepted (`src/ast/types.ts` says `brain_import`,
 *  `src/ast/engine.ts` says `imports`) — a table keyed on one of them reads 0 in
 *  every language while the edges are emitted. */
const TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof TYPES)[number]

const LABEL_ALIASES: Record<string, string> = {
  calls: "calls", call: "calls",
  uses: "uses",
  contains: "contains", composition: "contains", part_of: "contains",
  imports: "imports", brain_import: "imports",
  references: "references", depends_on: "references", related: "references",
  exports: "exports", provides: "exports",
  extends: "extends", inheritance: "extends",
  implements: "implements", implementation: "implements",
  overrides: "overrides", override: "overrides",
  instantiates: "instantiates",
}
const ontologyName = (raw: string): Type | null => (LABEL_ALIASES[raw] as Type) ?? null

/**
 * The declared-external marker keys, VERBATIM from `script/m14/incoming-gate.ts:105`.
 * One vocabulary fleet-wide: a lane that invents its own key is a lane the gate
 * cannot hear, and this file must not be a second vocabulary either.
 */
const EXTERNAL_KEYS = [
  "zigExternalRef",
  "nimStdlibModule",
  "isExternal",
  "isExternalTarget",
  "external",
  "externalRef",
  "isStdlib",
  "stdlibModule",
  "moduleNamingEdges",
  "markAsExternal",
]

/** Marker present at the edge's top level or in its metadata; arrays count when non-empty. */
function externalMarker(rel: any): { marked: boolean; reason: string | null } {
  const md = rel?.metadata && typeof rel.metadata === "object" ? rel.metadata : {}
  let marked = false
  for (const key of EXTERNAL_KEYS) {
    for (const holder of [rel, md]) {
      const v = holder?.[key]
      if (v === true) marked = true
      else if (Array.isArray(v) && v.length > 0) marked = true
    }
  }
  const r = md.externalReason ?? rel?.externalReason
  return { marked, reason: typeof r === "string" && r.length > 0 ? r : null }
}

type Outcome =
  | "resolved" | "external" | "externalUnreasoned"
  | "ambiguous" | "unresolved" | "targetless"

/**
 * `source === target` is COUNTED, never used as a class. This instrument's first
 * version made it a class and that was wrong in a way worth recording, because it
 * both invented a defect and hid a correct classification:
 *
 *   - on `exports` it read **64 self-loops** — and the shape is
 *     `packages/rxjs/src/filter.ts` emitting `filter -> filter`, one export per file
 *     named after the file's leaf, 64 of 64 files. Two different node KINDS (a module
 *     and a named export) sharing a leaf name is the family's leaf-identity convention,
 *     not a cycle.
 *   - on `calls`/`references`/`instantiates` it read **236 self-loops**, and a probe
 *     over the rows shows they are mostly name coincidence, not recursion: only 2 of
 *     236 have the source equal to the file's module leaf, and 31 of 236 occur in a
 *     file that publishes the target name more than once
 *     (`references` `TreeNode -> TreeNode` inside `interfaces.ts`,
 *     `calls` `replace -> replace` where the enclosing method and a member name agree).
 *     Whether such an edge binds to the source's OWN declaration is exactly the
 *     question a qualified spelling answers, so excluding them from the accounting
 *     would have removed 236 edges from the resolution question and called that a
 *     disposition.
 *
 * So a same-leaf edge is classified by its TARGET, like every other edge — the same
 * thing `script/m14/incoming-gate.ts` does, which keeps this gate's numbers comparable
 * to the fleet's — and the count is printed as a column so the reader can see it
 * rather than having it silently reshaped. Measured effect of the correction: `exports`
 * 64 of those edges reclassified into `resolved` 22 / `ambiguous` 41 / `unresolved` 1.
 */

/** What a nonzero class has to declare about itself before this lane may pass. */
type Disposition = {
  kind: "by-design" | "not-provable-from-a-single-file" | "backlog"
  rule: string
  ceiling: number
}

/** Candidate declarations for a target = distinct declaring FILES. Augmentations are
 *  consulted only when the pool has no non-augmentation declaration of that name,
 *  because an augmentation extends a declaration rather than competing with it. */
function candidatesFor(name: string, real: Map<string, Set<string>>, aug: Map<string, Set<string>>): number {
  const r = real.get(name)
  if (r && r.size > 0) return r.size
  return aug.get(name)?.size ?? 0
}

/**
 * THE INDEX the classifier reads: the pool-wide keys, plus the two facts that are
 * properties of the EDGE'S OWN FILE — what that file declares, and what it binds by
 * import. A pool-wide index alone cannot answer a question the language answers
 * lexically, which is what made this instrument call a file's own `getComponent`
 * ambiguous against a stranger's. `poolFiles` is the admitted set, so a relative
 * specifier is only followed to a file this run actually measured.
 */
type Index = {
  real: Map<string, Set<string>>
  aug: Map<string, Set<string>>
  qualified: Map<string, Set<string>>
  localDecl: Map<string, Set<string>>
  importBindings: Map<string, Map<string, Set<string>>>
  poolFiles: Set<string>
}

/**
 * A reference's SHAPE, read from the edge's own metadata. Only a BARE name can be
 * bound by an import or by the file's own declaration: `import { join } from
 * "node:path"` says nothing about `array.join`, and measuring the lever WITHOUT this
 * guard over-counted it by 17 `calls` edges on this pool before the guard existed.
 */
function referenceShape(rel: any, target: string): "bare" | "member" | "unknown" {
  const md = rel?.metadata && typeof rel.metadata === "object" ? rel.metadata : {}
  const callee = String(md.calleeExpression ?? md.fieldAccessExpression ?? md.memberExpression ?? "")
  if (callee.length === 0) return target.includes(".") ? "member" : "unknown"
  return callee === target ? "bare" : "member"
}

/** The extension shapes a relative specifier can name, longest first so `.d.ts` wins. */
const RELATIVE_EXTS = [".d.ts", ".ts", ".tsx", ".mts", ".cts"]

/** A relative specifier -> the admitted file it names, or null when it names none. */
function resolveRelative(fromFile: string, specifier: string, pool: Set<string>): string | null {
  if (!specifier.startsWith(".")) return null
  let base = path.resolve(path.dirname(fromFile), specifier)
  for (const ext of [".js", ".jsx", ".mjs", ".cjs"]) {
    if (base.endsWith(ext)) { base = base.slice(0, -ext.length); break }
  }
  const cands = [base, ...RELATIVE_EXTS.map((e) => base + e), ...RELATIVE_EXTS.map((e) => path.join(base, "index" + e))]
  for (const c of cands) if (pool.has(c)) return c
  return null
}

/**
 * The types whose target is a NAME this file can bind lexically. `uses` and `contains`
 * are deliberately absent: their target is a MEMBER name, and "this file declares a
 * member called `values`" does not say the edge's source owns it. Those two bind by
 * the qualified endpoint or not at all.
 */
const LEXICAL_LOCAL_TYPES = new Set<Type>(["calls", "references", "exports", "instantiates", "extends", "implements"])

/**
 * THE CLASSIFIER. Pure: it reads the edge, the index and the edge's file and returns
 * the class plus WHICH RULE earned it. Self-tested below before any corpus is read,
 * because this function IS the verdict.
 */
function classifyEdge(rel: any, type: Type, idx: Index, file: string): { outcome: Outcome; cands: number; rule: string } {
  const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
  if (tgt.length === 0) return { outcome: "targetless", cands: 0, rule: "" }
  const marker = externalMarker(rel)
  if (marker.marked) {
    return { outcome: marker.reason ? "external" : "externalUnreasoned", cands: 0, rule: "marker" }
  }

  // 1. QUALIFIED ENDPOINT JOIN. The edge's own endpoints spell a key the pool
  //    publishes, IN THIS FILE. `AppComponent -> currentDocument` is proven by a
  //    symbol whose qualifiedName is exactly `AppComponent.currentDocument` in the
  //    same file: the owner the edge names is the owner the pool has. Requiring the
  //    same file is what keeps two `index.ts` from binding each other's members.
  const src = String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? "")
  if (src.length > 0) {
    const q = idx.qualified.get(`${src}.${tgt}`)
    if (q && q.size === 1 && q.has(file)) return { outcome: "resolved", cands: 1, rule: "qualified-endpoint" }
  }

  const cands = candidatesFor(tgt, idx.real, idx.aug)
  if (cands === 0) return { outcome: "unresolved", cands, rule: "" }
  if (cands === 1) return { outcome: "resolved", cands: 1, rule: "leaf-unique" }

  // 2. LEXICAL LOCAL — a name the file itself declares, referenced as a NAME.
  const shape = referenceShape(rel, tgt)
  const bareShape = type === "calls" ? shape === "bare" : shape !== "member"
  if (LEXICAL_LOCAL_TYPES.has(type) && bareShape && idx.localDecl.get(file)?.has(tgt)) {
    return { outcome: "resolved", cands, rule: "lexical-local" }
  }

  // 3. LEXICAL IMPORT — the file binds the name to ONE relative module, and that
  //    module is one of the files that declares it. A bare specifier names a module
  //    this run did not admit, so it narrows nothing.
  if (bareShape) {
    const specs = idx.importBindings.get(file)?.get(tgt)
    if (specs && specs.size === 1) {
      const r = resolveRelative(file, [...specs][0], idx.poolFiles)
      if (r !== null && (idx.real.get(tgt)?.has(r) || idx.aug.get(tgt)?.has(r))) {
        return { outcome: "resolved", cands, rule: "lexical-import" }
      }
    }
  }

  return { outcome: "ambiguous", cands, rule: "" }
}

type Baseline = { meta: Record<string, unknown>; classes: Record<string, Disposition> }

/** THE RATCHET. Also pure, also self-tested: it is the second half of the verdict. */
function ratchet(
  counts: Map<string, number>,
  baseline: Baseline,
): { violations: string[]; declared: { key: string; count: number; d: Disposition }[] } {
  const violations: string[] = []
  const declared: { key: string; count: number; d: Disposition }[] = []
  for (const [key, count] of counts) {
    if (count === 0) continue
    // RESOLUTION needs no disposition: it is the outcome the gate exists to maximize,
    // and a fall in it cannot hide — it reappears as a RISE in `ambiguous` or
    // `unresolved`, both of which are ratcheted.
    if (key.endsWith(":resolved")) continue
    const d = baseline.classes[key]
    if (!d) {
      violations.push(`UNDECLARED CLASS ${key} = ${count} — it has no disposition in the baseline`)
      continue
    }
    if (typeof d.rule !== "string" || d.rule.trim().length === 0) {
      violations.push(`CLASS WITHOUT A RULE ${key} — the disposition must state why it is allowed`)
      continue
    }
    if (!["by-design", "not-provable-from-a-single-file", "backlog"].includes(d.kind)) {
      violations.push(`CLASS WITH AN UNKNOWN KIND ${key} — '${String(d.kind)}' is not a disposition`)
      continue
    }
    declared.push({ key, count, d })
    if (count > d.ceiling) {
      violations.push(`OVER CEILING ${key} = ${count}, recorded ceiling ${d.ceiling} (+${count - d.ceiling})`)
    }
  }
  return { violations, declared }
}

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = []
  const real = new Map<string, Set<string>>([
    ["one", new Set(["a.ts"])],
    ["two", new Set(["a.ts", "b.ts"])],
    ["merged", new Set(["a.ts"])],
    ["augmented", new Set(["a.ts"])],
    ["helper", new Set(["/pool/a.ts", "/pool/b.ts"])],
    ["legacy", new Set(["/pool/legacy.ts", "/pool/other.ts"])],
    ["values", new Set(["/pool/a.ts", "/pool/b.ts"])],
    ["bare", new Set(["/pool/a.ts", "/pool/b.ts"])],
    ["missing", new Set(["/pool/a.ts", "/pool/b.ts"])],
    ["join", new Set(["/pool/a.ts", "/pool/b.ts"])],
  ])
  const aug = new Map<string, Set<string>>([
    ["merged", new Set(["b.ts", "c.ts"])], // must NOT compete: a real declaration exists
    ["augmented", new Set(["a.ts"])],
    ["only-aug", new Set(["d.ts"])], // consulted, because nothing real declares it
  ])
  const AT = "/pool/a.ts"
  const idx: Index = {
    real,
    aug,
    qualified: new Map<string, Set<string>>([
      ["Owner.member", new Set([AT])],
      ["AppComponent.values", new Set([AT])],
      ["Elsewhere.member", new Set(["/pool/b.ts"])], // published, but NOT in this file
    ]),
    localDecl: new Map<string, Set<string>>([[AT, new Set(["helper"])]]),
    importBindings: new Map<string, Map<string, Set<string>>>([
      [AT, new Map<string, Set<string>>([
        ["legacy", new Set(["./legacy"])], // one relative specifier, resolves to a declaring file
        ["bare", new Set(["pkg"])], // a bare specifier narrows nothing
        ["missing", new Set(["./nope"])], // resolves to no admitted file
        ["join", new Set(["./legacy"])], // the MEMBER-shape trap
      ])],
    ]),
    poolFiles: new Set([AT, "/pool/b.ts", "/pool/legacy.ts"]),
  }
  const cases: [any, Type, Outcome, string][] = [
    [{ source: "s", target: "one" }, "calls", "resolved", "one declaring file"],
    [{ source: "s", target: "two" }, "calls", "ambiguous", "two declaring files"],
    [{ source: "s", target: "merged" }, "references", "resolved", "a type + its value binding in one file is ONE declaration"],
    [{ source: "s", target: "augmented" }, "instantiates", "resolved", "augmentations do not compete with a real declaration"],
    [{ source: "s", target: "only-aug" }, "instantiates", "resolved", "an augmentation-only name is still one declaring file"],
    [{ source: "s", target: "nothing-declares-this" }, "calls", "unresolved", "published nowhere"],
    [{ source: "s", target: "x", metadata: { isExternalTarget: true, externalReason: "builtin-module" } }, "calls", "external", "marked with a reason"],
    [{ source: "s", target: "x", metadata: { isExternalTarget: true } }, "calls", "externalUnreasoned", "marked with NO reason"],
    [{ source: "s", target: "s" }, "calls", "unresolved", "a same-leaf edge classifies by its TARGET, like every other edge"],
    // MODULE ENDPOINTS: `packages/rxjs/src/filter.ts` emits `filter -> filter` because the
    // module leaf and the exported name agree. That is NOT a self-loop, and the real shape
    // (64 of 64 files) must classify on its merits, not on name equality.
    [{ source: "one", target: "one" }, "exports", "resolved", "module endpoint: name equality is a convention, not a cycle"],
    [{ source: "one", target: "one" }, "imports", "resolved", "module endpoint: same, and the target does resolve here"],
    [{ source: "m", target: "vitest:describe" }, "imports", "unresolved", "module endpoint: a `<module>:<name>` URI is not a symbol name"],
    [{ source: "s" }, "calls", "targetless", "no target string"],
    // THE FOUR RESOLUTION RULES, each with the negative control that keeps it honest.
    [{ source: "Owner", target: "member" }, "calls", "resolved", "qualified endpoint published in THIS file"],
    [{ source: "Elsewhere", target: "member" }, "calls", "unresolved", "a qualified key in ANOTHER file proves nothing in this one"],
    [{ source: "m", target: "helper", metadata: { calleeExpression: "helper" } }, "calls", "resolved", "lexical-local: a BARE name the file declares"],
    [{ source: "m", target: "helper", metadata: { calleeExpression: "arr.helper" } }, "calls", "ambiguous", "lexical-local must NOT fire on a member shape"],
    [{ source: "m", target: "legacy", metadata: { calleeExpression: "legacy" } }, "calls", "resolved", "lexical-import: one relative import names a declaring file"],
    [{ source: "m", target: "bare", metadata: { calleeExpression: "bare" } }, "calls", "ambiguous", "a bare specifier narrows nothing"],
    [{ source: "m", target: "missing", metadata: { calleeExpression: "missing" } }, "calls", "ambiguous", "a relative specifier that resolves to no admitted file narrows nothing"],
    [{ source: "m", target: "join", metadata: { calleeExpression: "arr.join" } }, "calls", "ambiguous", "the member-shape trap: an import of the leaf name is irrelevant"],
    [{ source: "AppComponent", target: "values" }, "contains", "resolved", "contains binds by the qualified endpoint"],
    [{ source: "m", target: "values" }, "contains", "ambiguous", "contains has NO lexical-local rule: a declared member is not proof of ownership"],
    [{ source: "m", target: "values" }, "uses", "ambiguous", "uses has NO lexical-local rule either"],
  ]
  for (const [rel, type, want, why] of cases) {
    const got = classifyEdge(rel, type, idx, AT).outcome
    if (got !== want) failures.push(`classifier: ${why} — want ${want}, got ${got}`)
  }
  if (classifyEdge({ source: "s", target: "two" }, "calls", idx, AT).cands !== 2) {
    failures.push("classifier: candidate count for `two` should be 2")
  }
  if (classifyEdge({ source: "m", target: "legacy", metadata: { calleeExpression: "legacy" } }, "calls", idx, AT).rule !== "lexical-import") {
    failures.push("classifier: the import rule must RECORD which rule earned the resolution")
  }
  // THE RATCHET MUST BE ABLE TO FAIL. A ceiling below the count is an overrun, and an
  // undeclared nonzero class is a violation — asserted, not assumed.
  const counts = new Map<string, number>([["calls:ambiguous", 10], ["imports:unresolved", 4], ["calls:resolved", 99]])
  const okBase: Baseline = {
    meta: {},
    classes: {
      "calls:ambiguous": { kind: "backlog", rule: "because", ceiling: 10 },
      "imports:unresolved": { kind: "by-design", rule: "because", ceiling: 4 },
    },
  }
  if (ratchet(counts, okBase).violations.length !== 0) failures.push("ratchet: an at-ceiling class must not violate")
  const tight: Baseline = {
    meta: {},
    classes: {
      "calls:ambiguous": { kind: "backlog", rule: "because", ceiling: 9 },
      "imports:unresolved": { kind: "by-design", rule: "because", ceiling: 4 },
    },
  }
  const over = ratchet(counts, tight).violations
  if (!over.some((v) => v.startsWith("OVER CEILING calls:ambiguous"))) {
    failures.push("ratchet: a count above its ceiling MUST violate")
  }
  const undeclared = ratchet(counts, { meta: {}, classes: {} }).violations
  if (!undeclared.some((v) => v.startsWith("UNDECLARED CLASS"))) {
    failures.push("ratchet: a nonzero class with no disposition MUST violate")
  }
  return { ok: failures.length === 0, failures }
}

type Measured = {
  pool: string
  files: number
  found: number
  parsed: number
  failed: number
  degraded: number
  symbols: number
  qualifiedAliases: number
  counts: Map<string, number>
  perType: Map<Type, Map<Outcome, number>>
  edges: Map<Type, number>
  ambiguousNames: Map<string, { edges: number; cands: number; types: Set<string> }>
  unresolvedNames: Map<string, { edges: number; types: Set<string> }>
  reasons: Map<string, number>
  /** edges whose source and target share a leaf name — informational, not a class */
  sameLeaf: Map<Type, number>
  maxCands: { name: string; cands: number }
  /** class key -> up to 5 target names, so a count is never a number nobody can trace
   *  back to the edges it counted. */
  classSamples: Map<string, string[]>
  /** resolution rule -> RESOLVED edges it earned, printed so a rising bind% can be
   *  read as WHICH claim produced it, not just that the number moved. */
  ruleCounts: Map<string, number>
}

/** Discover the pool from the corpus root at run time. Nothing is hard-coded: a
 *  `FILES = [...]` array is a defect the moment a file is added beside it. */
function discover(maxFiles: number): { files: string[]; found: number } {
  const dir = path.join(CORPUS, REPO_NAME)
  if (!existsSync(dir)) return { files: [], found: 0 }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch {
    return { files: [], found: 0 }
  }
  const found: string[] = []
  for (const rel of tracked) {
    const lower = rel.toLowerCase()
    if (!lower.endsWith(".ts") && !lower.endsWith(".tsx")) continue
    if (lower.endsWith(".d.ts")) {
      // A declaration-only file is part of the pool: `jsx.d.ts` and the ambient
      // fixtures are where global augmentations live, and excluding them would
      // measure a corpus the analyzer does not see.
    }
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size > 512 * 1024) continue
    } catch {
      continue
    }
    found.push(abs)
  }
  found.sort()
  const total = found.length
  if (total <= maxFiles) return { files: found, found: total }
  const stride = Math.max(1, Math.floor(total / maxFiles))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < maxFiles; i += stride) picked.push(found[i])
  return { files: picked, found: total }
}

async function measure(maxFiles: number): Promise<Measured> {
  const { files, found } = discover(maxFiles)
  const real = new Map<string, Set<string>>()
  const aug = new Map<string, Set<string>>()
  const qualified = new Map<string, Set<string>>()
  const localDecl = new Map<string, Set<string>>()
  const importBindings = new Map<string, Map<string, Set<string>>>()
  const poolFiles = new Set(files)
  const ruleCounts = new Map<string, number>()
  const counts = new Map<string, number>()
  const perType = new Map<Type, Map<Outcome, number>>()
  const edges = new Map<Type, number>()
  for (const t of TYPES) {
    perType.set(t, new Map<Outcome, number>())
    edges.set(t, 0)
  }
  const ambiguousNames = new Map<string, { edges: number; cands: number; types: Set<string> }>()
  const unresolvedNames = new Map<string, { edges: number; types: Set<string> }>()
  const reasons = new Map<string, number>()
  const sameLeaf = new Map<Type, number>()
  const classSamples = new Map<string, string[]>()
  let maxCands = { name: "", cands: 0 }
  let parsed = 0
  let failed = 0
  let degraded = 0
  let symbols = 0
  let qualifiedAliases = 0
  const fileRels: { rel: any; file: string }[] = []
  const add = (key: string, n = 1) => counts.set(key, (counts.get(key) ?? 0) + n)

  for (const f of files) {
    let r: any
    try {
      r = await parseFile(f, path.dirname(f))
    } catch {
      failed++
      continue
    }
    if (!r) {
      failed++
      continue
    }
    parsed++
    if (r.fallback === true) degraded++

    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (name.length === 0) continue
      symbols++
      const isAug = s?.metadata?.isAugmentation === true
      const holder = isAug ? aug : real
      const q = String(s?.qualifiedName ?? "")
      const keys = q.length > 0 && q !== name ? [name, q] : [name]
      if (q.length > 0 && q !== name) qualifiedAliases++
      // Both keys map to the SAME declaring file, so one symbol can never inflate
      // its own candidate count: a name and its qualified alias share one Set entry
      // per file. That is the whole reason candidates are FILES and not symbols.
      for (const key of keys) {
        const set = holder.get(key) ?? new Set<string>()
        set.add(f)
        holder.set(key, set)
      }
      if (q.length > 0 && q !== name) {
        const qset = qualified.get(q) ?? new Set<string>()
        qset.add(f)
        qualified.set(q, qset)
      }
      const decl = localDecl.get(f) ?? new Set<string>()
      decl.add(name)
      localDecl.set(f, decl)
    }
    // WHAT THIS FILE BINDS BY IMPORT, by LOCAL name (`import { a as b }` binds b):
    // the import edge's target is `<specifier>:<imported name>` and metadata.alias
    // carries the local name when they differ. No other reader of these edges needs
    // this map, which is why it is built here instead of changing the emission.
    const bindings = new Map<string, Set<string>>()
    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      fileRels.push({ rel, file: f })
      const rtype = String(rel?.type ?? rel?.relationshipType ?? "")
      if (rtype !== "imports" && rtype !== "brain_import") continue
      const t = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
      const colon = t.lastIndexOf(":")
      if (colon <= 0) continue
      const specifier = t.slice(0, colon)
      const imported = t.slice(colon + 1)
      const md = rel?.metadata && typeof rel.metadata === "object" ? rel.metadata : {}
      const local = typeof md.alias === "string" && md.alias.length > 0 ? md.alias : (imported === "*" ? "" : imported)
      if (local.length === 0) continue
      const set = bindings.get(local) ?? new Set<string>()
      set.add(specifier)
      bindings.set(local, set)
    }
    importBindings.set(f, bindings)
  }

  const idx: Index = { real, aug, qualified, localDecl, importBindings, poolFiles }
  for (const { rel, file } of fileRels) {
    const label = ontologyName(String(rel?.type ?? rel?.relationshipType ?? ""))
    if (!label) continue
    edges.set(label, (edges.get(label) ?? 0) + 1)
    const src = String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? "")
    const tgtOf = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    if (tgtOf.length > 0 && src === tgtOf) sameLeaf.set(label, (sameLeaf.get(label) ?? 0) + 1)
    const { outcome, cands, rule } = classifyEdge(rel, label, idx, file)
    if (outcome === "resolved") ruleCounts.set(rule, (ruleCounts.get(rule) ?? 0) + 1)
    const row = perType.get(label)!
    row.set(outcome, (row.get(outcome) ?? 0) + 1)
    const key = `${label}:${outcome}`
    add(key)
    if (outcome !== "resolved") {
      const tgtSample = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "(no target)")
      const list = classSamples.get(key) ?? []
      if (!list.includes(tgtSample) && list.length < 5) {
        list.push(tgtSample)
        classSamples.set(key, list)
      }
    }
    if (outcome === "external") {
      const reason = externalMarker(rel).reason ?? "unrecorded"
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
      continue
    }
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    if (outcome === "ambiguous") {
      const e = ambiguousNames.get(tgt) ?? { edges: 0, cands, types: new Set<string>() }
      e.edges++
      e.cands = Math.max(e.cands, cands)
      e.types.add(label)
      ambiguousNames.set(tgt, e)
      if (cands > maxCands.cands) maxCands = { name: tgt, cands }
    } else if (outcome === "unresolved" && tgt.length > 0) {
      const e = unresolvedNames.get(tgt) ?? { edges: 0, types: new Set<string>() }
      e.edges++
      e.types.add(label)
      unresolvedNames.set(tgt, e)
    }
  }

  return {
    pool: REPO_NAME, files: files.length, found, parsed, failed, degraded, symbols,
    qualifiedAliases, counts, perType, edges, ambiguousNames, unresolvedNames, reasons, sameLeaf,
    maxCands, classSamples, ruleCounts,
  }
}

const w = (s: string | number, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
const OUTCOMES: Outcome[] = ["resolved", "external", "ambiguous", "unresolved", "targetless", "externalUnreasoned"]

function report(m: Measured, baseline: Baseline | null, violations: string[], declared: { key: string; count: number; d: Disposition }[]) {
  const digest = existsSync(ANALYZER)
    ? createHash("sha1").update(readFileSync(ANALYZER)).digest("hex").slice(0, 12)
    : "absent"
  console.log(`ts incoming gate — pool '${m.pool}', analyzer ${digest}`)
  console.log(
    `population: ${m.parsed} parsed of ${m.files} sampled (corpus has ${m.found} `.concat(
      `.ts/.tsx files); parse failures ${m.failed}, degraded (regex fallback) ${m.degraded}`,
    ),
  )
  console.log(
    `declarations: ${m.symbols} symbols, ${m.qualifiedAliases} qualifiedName alias(es). ` +
    `Candidates are DECLARING FILES, augmentations consulted last (module-worker carries ` +
    `metadata.isAugmentation), never distinct kinds. An edge resolves when the pool ` +
    `publishes ONE declaration AND this file's scope can name it: unique leaf, a ` +
    `qualified endpoint, a bare name the file declares, or a single relative import.`,
  )
  console.log()
  console.log(
    w("type", 14) + w("edges", 9) + w("resolved", 10) + w("external", 10) +
    w("ambiguous", 11) + w("unresolved", 12) + w("sameLeaf", 10) + w("noTarget", 10) + "bind%  bind+ext%",
  )
  console.log("-".repeat(112))
  let tot = 0, totRes = 0, totExt = 0, totSame = 0
  for (const t of TYPES) {
    const row = m.perType.get(t)!
    const e = m.edges.get(t) ?? 0
    const res = row.get("resolved") ?? 0
    const ext = row.get("external") ?? 0
    const same = m.sameLeaf.get(t) ?? 0
    tot += e
    totRes += res
    totExt += ext
    totSame += same
    console.log(
      w(t, 14) + w(e, 9) + w(res, 10) + w(ext, 10) +
      w(row.get("ambiguous") ?? 0, 11) + w(row.get("unresolved") ?? 0, 12) +
      w(same, 10) + w(row.get("targetless") ?? 0, 10) +
      w(e > 0 ? ((100 * res) / e).toFixed(1) : "0.0", 7) +
      (e > 0 ? (((100 * (res + ext)) / e).toFixed(1)) : "0.0"),
    )
  }
  console.log("-".repeat(112))
  console.log(
    w("TOTAL", 14) + w(tot, 9) + w(totRes, 10) + w(totExt, 10) + w("", 11) + w("", 12) + w(totSame, 10) + w("", 10) +
    w(tot > 0 ? ((100 * totRes) / tot).toFixed(1) : "0.0", 7) +
    (tot > 0 ? ((100 * (totRes + totExt)) / tot).toFixed(1) : "0.0"),
  )
  console.log(`sameLeaf ${totSame}: edges whose source and target share a leaf name. INFORMATIONAL — each is`)
  console.log(`classified by its target above, as the fleet arbiter classifies it, not excluded as a cycle.`)
  console.log()
  console.log(`bind-to-one-declaring-file is ${tot > 0 ? ((100 * totRes) / tot).toFixed(1) : "0.0"}% of ${tot} edges, and ` +
    `bind-to-one OR declared-external is ${tot > 0 ? ((100 * (totRes + totExt)) / tot).toFixed(1) : "0.0"}%. ` +
    `That second number is the honest one; every point below it is a declared class, not a rounding.`)
  console.log()
  if (m.ruleCounts.size > 0) {
    console.log("resolution provenance — how each RESOLVED edge earned it:")
    for (const r of ["leaf-unique", "qualified-endpoint", "lexical-local", "lexical-import"]) {
      const n = m.ruleCounts.get(r) ?? 0
      if (n > 0) console.log(`  ${w(r, 24)} ${n}`)
    }
    console.log()
  }
  if (m.reasons.size > 0) {
    console.log("declared-external reasons:")
    for (const [reason, n] of [...m.reasons.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${w(reason, 24)} ${n}`)
    }
    console.log()
  }
  if (m.ambiguousNames.size > 0) {
    const top = [...m.ambiguousNames.entries()].sort((a, b) => b[1].edges - a[1].edges).slice(0, 12)
    console.log(`AMBIGUOUS (${m.ambiguousNames.size} distinct target names, top 12 by edges) — the backlog:`)
    for (const [name, e] of top) console.log(`  ${w(name, 30)} ${w(e.edges, 8)} edges  ${e.cands} declaring files  [${[...e.types].sort().join(",")}]`)
    console.log(`  widest name: '${m.maxCands.name}' with ${m.maxCands.cands} declaring files`)
    console.log()
  }
  if (m.unresolvedNames.size > 0) {
    const top = [...m.unresolvedNames.entries()].sort((a, b) => b[1].edges - a[1].edges).slice(0, 12)
    console.log(`UNRESOLVED (${m.unresolvedNames.size} distinct target names, top 12 by edges):`)
    for (const [name, e] of top) console.log(`  ${w(name, 30)} ${w(e.edges, 8)} edges  [${[...e.types].sort().join(",")}]`)
    console.log()
  }
  if (declared.length > 0) {
    console.log("DECLARED CLASSES (the baseline IS the declaration):")
    for (const { key, count, d } of declared.sort((a, b) => b.count - a.count)) {
      const head = d.ceiling - count
      console.log(`  ${w(key, 28)} ${w(count, 9)} ceiling ${w(d.ceiling, 9)} headroom ${w(head, 9)} [${d.kind}]`)
      console.log(`      ${d.rule}`)
    }
    console.log()
  }
  if (baseline) {
    console.log(`baseline written ${String(baseline.meta?.written ?? "?")} against ${String(baseline.meta?.files ?? "?")} files ` +
      `(analyzer ${String(baseline.meta?.analyzerSha1 ?? "?")})`)
    console.log()
  }
  if (violations.length > 0) {
    console.log(`VERDICT: FAIL — ${violations.length} violation(s)`)
    for (const v of violations) console.log(`  ${v}`)
  } else {
    console.log("VERDICT: PASS — every edge is in a class declared in the baseline, and no class is over its ceiling.")
    console.log("This is NOT 100% resolution: the declared classes above ARE the backlog, with their sizes printed.")
  }
  console.log()
  console.log("Scope of a PASS: this pool, this analyzer digest, edge classification only. It does NOT say an")
  console.log("edge points at the RIGHT declaration — script/m14/differential.ts and the mutation suite own that.")
}

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes("--json")
const UPDATE = argv.includes("--update-baseline")
const rest = argv.filter((a) => !a.startsWith("--"))
const MAX = Number(rest[0] ?? 100000)

const control = selfTest()
if (!control.ok) {
  console.error("FATAL: this gate's own control did not fire.")
  for (const f of control.failures) console.error(`  ${f}`)
  console.error("Refusing to report a lane: a probe that cannot fail returns the same number as a clean one.")
  process.exit(3)
}

const m = await measure(MAX)
if (m.parsed === 0) {
  console.error(`no corpus admitted from ${path.join(CORPUS, REPO_NAME)} — UNMEASURED is not a pass`)
  process.exit(2)
}

let baseline: Baseline | null = null
if (existsSync(BASELINE)) {
  try {
    baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Baseline
  } catch (e) {
    console.error(`baseline unreadable: ${(e as Error).message}`)
    process.exit(2)
  }
}

if (UPDATE) {
  if (!baseline) {
    console.error(`no baseline at ${BASELINE} — write the dispositions by hand first. A ceiling produced by the same run that measured it ratifies whatever that run did.`)
    process.exit(1)
  }
  const undeclared: string[] = []
  for (const [key, count] of m.counts) {
    if (count === 0) continue
    // The same rule the ratchet applies: RESOLUTION needs no disposition, so it must
    // not be demanded here either. The first version of this flag demanded one and
    // refused to record anything on a clean lane, which is the kind of inconsistency
    // that only shows up when the documented path is actually run.
    if (key.endsWith(":resolved")) continue
    if (!baseline.classes[key]) undeclared.push(`${key} = ${count}`)
  }
  if (undeclared.length > 0) {
    console.error("refusing to record a ceiling for a class with no disposition:")
    for (const u of undeclared) console.error(`  ${u}`)
    console.error("Add the class to the baseline by hand, with a kind and the sentence that justifies it.")
    process.exit(1)
  }
  for (const [key, count] of m.counts) {
    const d = baseline.classes[key]
    if (d) d.ceiling = count
  }
  baseline.meta = {
    ...baseline.meta,
    written: new Date().toISOString().slice(0, 10),
    pool: m.pool,
    files: m.parsed,
    analyzerSha1: existsSync(ANALYZER) ? createHash("sha1").update(readFileSync(ANALYZER)).digest("hex").slice(0, 12) : "absent",
  }
  writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + "\n")
  console.log(`baseline updated: ${Object.keys(baseline.classes).length} classes over ${m.parsed} files`)
}

const { violations, declared } = baseline
  ? ratchet(m.counts, baseline)
  : { violations: ["NO BASELINE — no disposition exists for any class, so nothing can be declared done"], declared: [] }

if (JSON_OUT) {
  console.log(JSON.stringify({
    pool: m.pool, parsed: m.parsed, sampled: m.files, corpusFiles: m.found,
    failed: m.failed, degraded: m.degraded, symbols: m.symbols,
    classes: Object.fromEntries([...m.counts.entries()].filter(([, v]) => v > 0).sort()),
    classSamples: Object.fromEntries([...m.classSamples.entries()].sort()),
    resolutionProvenance: Object.fromEntries([...m.ruleCounts.entries()].sort()),
    edgesPerType: Object.fromEntries(TYPES.map((t) => [t, m.edges.get(t) ?? 0])),
    declaredExternalReasons: Object.fromEntries([...m.reasons.entries()].sort()),
    widestName: m.maxCands,
    verdict: violations.length === 0 ? "PASS" : "FAIL",
    violations,
    instrumentSelfTest: control,
  }, null, 2))
} else {
  report(m, baseline, violations, declared)
}

process.exit(violations.length > 0 ? 1 : 0)
