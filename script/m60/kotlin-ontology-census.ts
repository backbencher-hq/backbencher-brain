/**
 * KOTLIN ONTOLOGY CENSUS — DERIV_EXPORTS_KOT3 lane instrument.
 *
 * ## What question this answers
 *
 * For each of the ten relationship types, ONE of:
 *
 *   EMITTED   production `parseFile` produced it on real corpus files, with a count
 *             and the files it came from.
 *   RULED     a written reason AND a corpus measurement showing the construct never
 *             occurs. Falsifiable: a non-zero probe count overturns the ruling.
 *
 * ## Why this is a LANE file and not an extension of `ontology-coverage-gate.ts`
 *
 * The gate is the arbiter and is shared (`script/m14/**`). It reports EMITTED /
 * RULED-SOUND / FALSIFIED / RULED-UNJUSTIFIED for a lane, but it tallies ONE
 * channel: `parseFile(...).relationships`. `ParseResult` carries THREE
 * (`src/ast/types.ts:206-231`):
 *
 *     relationships: UniversalRelationship[]
 *     imports:       ImportInfo[]
 *     exports:       ExportInfo[]
 *
 * So a gate run reports `imports` and `exports` as absent for kotlin while both
 * are populated — measured here, not assumed. That is the same defect class the
 * 2026-10-04 review recorded for `firing-check.mjs` ("structurally incapable of
 * observing an import"), one channel further on. This census reports all three,
 * labels which channel each number came from, and never counts a populated
 * channel as an absence.
 *
 * ## The two hard rules this file obeys
 *
 * 1. NO REGEX. Not one regular expression, anywhere. Every construct probe below
 *    is a walk of the tree-sitter tree: `node.type` comparisons and named-child
 *    inspection. A text probe matches comments and string literals, misses nested
 *    syntax, and breaks silently on the next grammar version; the whole reason
 *    the ontology gate exists is that a regex-based probe once convicted a correct
 *    bash ruling by matching `class voice` inside a telnet IAC string.
 *
 * 2. THE POPULATION IS DERIVED, NEVER HAND-WRITTEN. `collectKotlinFiles` walks the
 *    corpus directory with `readdirSync`. `docs/M14-HONESTY-CONTRACT.md` §"Rule: an
 *    instrument must declare the population it covered" makes a hard-coded
 *    `FILES = [...]` array a defect the moment a file lands beside it. Every count
 *    below is printed with the population it was taken over.
 *
 * ## Independence, stated before the numbers rather than after
 *
 * The analyzer and this census are two walkers over the SAME tree-sitter-kotlin
 * grammar. A grammar bug shared by both is invisible to both — this census can
 * falsify a COUNT, a LABEL, an ENDPOINT or a CONFIDENCE, and it cannot detect a
 * node type the grammar itself fails to produce. Only the grammar inventory in
 * §PROBE A speaks to that, and even it can only report node types the grammar
 * DOES produce.
 *
 * ## Usage
 *
 *     bun script/m60/kotlin-ontology-census.ts                    # 400 files
 *     NFILES=1000 bun script/m60/kotlin-ontology-census.ts        # wider draw
 *     FRESH=1 bun script/m60/kotlin-ontology-census.ts           # ignore checkpoint
 */
import { readdirSync, statSync, readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const KOTLIN_DIR = process.env.BB_KOTLIN_DIR ?? join(CORPUS_ROOT, "kotlin")
const NFILES = Number(process.env.NFILES || 400)
const OUT_DIR = path.join(ROOT, "validation", "m14", "results")
const CHECKPOINT = path.join(ROOT, "validation", "m14", "measurements", "kot3-walk.txt")

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

// ---------------------------------------------------------------------------
// THE POPULATION — derived, never hand-written.
// ---------------------------------------------------------------------------

/**
 * Every `.kt`/`.kts` under the corpus dir, at most `want`, in a DETERMINISTIC
 * order so a re-run measures the same files. `readdirSync` returns entries in
 * directory order; sorting each level makes the draw reproducible across
 * machines and across re-clones, which is what makes "re-run at a different
 * NFILES" a real comparison rather than a reshuffle.
 *
 * No regex: extension tests are `endsWith`, and the two directory names to skip
 * are compared with `===` against the literal names git and npm use.
 */
const SKIP_DIRS = new Set([".git", "node_modules"])
const MAX_BYTES = 400_000

export function collectKotlinFiles(dir: string, want: number): { abs: string; rel: string }[] {
  const out: { abs: string; rel: string }[] = []
  const walk = (d: string): boolean => {
    if (out.length >= want) return false
    let ents: import("node:fs").Dirent[]
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return true }
    ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of ents) {
      if (out.length >= want) return false
      const p = join(d, e.name)
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue
        walk(p)
        continue
      }
      if (!e.name.endsWith(".kt") && !e.name.endsWith(".kts")) continue
      try { if (statSync(p).size > MAX_BYTES) continue } catch { continue }
      out.push({ abs: p, rel: relative(KOTLIN_DIR, p) })
    }
    return true
  }
  walk(dir)
  return out
}

// ---------------------------------------------------------------------------
// PROBE A — the grammar's own node vocabulary, over the walk.
//
// Instrument A answers: does the grammar PRODUCE a node type that would express
// the construct? Absence across the whole corpus is positive evidence of absence
// for that node type. It is silent on constructs expressed as conventions, and it
// cannot see a node type the grammar never produces.
// ---------------------------------------------------------------------------

const grammarNodeTypes = new Map<string, number>()

function inventoryGrammar(root: any): void {
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    grammarNodeTypes.set(n.type, (grammarNodeTypes.get(n.type) ?? 0) + 1)
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
}

// ---------------------------------------------------------------------------
// PROBE B — semantic counts on the tree, where a string cannot lie.
//
// Each probe walks NAMED nodes and reports hits. A construct expressible only as
// prose (a comment) or as data (a string literal) must NOT register, so every
// probe below reads node types the grammar assigns to declarations.
// ---------------------------------------------------------------------------

type ProbeHit = { occ: number; files: Set<string>; examples: string[] }

/** Named-child types of a node, as a plain array. No regex. */
function namedTypes(n: any): string[] {
  const out: string[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c.type)
  }
  return out
}

/** Text of a node's first named child of one of `types`, else "". */
function firstNamedText(n: any, types: string[]): string {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && types.includes(c.type)) return c.text
  }
  return ""
}

/**
 * Modifier keywords on a declaration.
 *
 * ## The first version of this function was WRONG, and the way it was wrong is
 * the reason it is documented here.
 *
 * It read `modifiers.namedChildren[*].type` and compared those types against
 * `public` / `internal` / `protected` / `private`. On this pinned grammar that
 * returns NONE of them, ever: the tree is
 *
 *     modifiers -> visibility_modifier -> "public"
 *
 * so the direct child's TYPE is `visibility_modifier`, not the keyword. The
 * first run consequently reported 298 top-level declarations "(default)" and 0
 * carrying a visibility — on a corpus whose grammar inventory counts 161
 * `public`, 33 `private`, 8 `internal` and 202 `visibility_modifier` nodes. A
 * probe that cannot see the construct manufactures a false ZERO, and a false
 * zero is a RULED verdict, which is exactly the outcome the ontology gate
 * exists to prevent. The analyzer's own `extractModifiers` reads
 * `modifier.text.trim()` and is right; this probe read `.type` and was not.
 *
 * So: read the keyword off the TEXT of the wrapper node, and check the wrapper
 * type separately so a `member_modifier` ("override") is never mistaken for a
 * visibility.
 */
const VIS_WRAPPER = "visibility_modifier"
function modifierInfo(n: any): { visibility: string | null; keywords: string[] } {
  const keywords: string[] = []
  let visibility: string | null = null
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (!c || c.type !== "modifiers") continue
    for (let j = 0; j < c.namedChildCount; j++) {
      const m = c.namedChild(j)
      if (!m) continue
      // The keyword is the node's own text; the node's TYPE names the slot.
      const kw = m.text.trim()
      keywords.push(kw)
      if (m.type === VIS_WRAPPER) visibility = kw
    }
  }
  return { visibility, keywords }
}

function newHit(): ProbeHit { return { occ: 0, files: new Set<string>(), examples: [] } }

function record(hit: ProbeHit, fileLabel: string, label: string): void {
  hit.occ++
  hit.files.add(fileLabel)
  if (hit.examples.length < 4) hit.examples.push(label)
}

// The four declarations that can appear at the top level of a Kotlin file, and
// therefore the four that can form a compilation unit's PUBLISHED surface.
// Read from the grammar inventory where possible; these four are confirmed
// present by PROBE A over the same corpus (reported in the output).
const TOP_LEVEL_DECLS = new Set([
  "class_declaration", "object_declaration",
  "function_declaration", "property_declaration",
])

/**
 * PROBE B1 — top-level declarations carrying a VISIBILITY modifier.
 *
 * This is the probe the `exports` verdict rests on. Kotlin has no `export`
 * keyword: its cross-module visibility axis is `public` / `internal` /
 * `protected` / `private` on the declaration, and the DEFAULT for a top-level
 * declaration is `public`. So the question "does Kotlin have the construct that
 * an exports edge would carry — a declaration whose visibility makes it part of
 * the module's published surface" is answerable on the tree, and it is answered
 * here rather than argued.
 *
 * It also counts the DEFAULT (no modifier at all), because that is the case a
 * regex-free text probe cannot see and the case that decides whether a default-
 * public convention is real: if every top-level declaration had to say
 * `public`, the axis would be opt-in and small.
 */
const visProbe = newHit()
const visByKeyword = new Map<string, number>()

/**
 * PROBE B8 — the PUBLISHED SURFACE of a compilation unit.
 *
 * This is the probe that decides the `exports` verdict, and it is separate from
 * B1 on purpose. B1 counts visibility modifiers on top-level declarations; B8
 * asks the question the relationship type actually asks — "which declarations
 * does this file make available to other modules" — and it answers it with
 * Kotlin's own rule rather than a keyword search.
 *
 * Kotlin has NO `export` keyword, and PROBE A measures that positively: across
 * 162 node types the grammar produces, none of `export_declaration`,
 * `export_list` or `export_statement` exists. That settles the question of
 * whether an export STATEMENT exists. It does NOT settle whether an exports
 * EDGE has anything true to carry, and conflating the two is how the prose-only
 * ruling in `script/m14/spec/kotlin-completeness.json` S5 ("the exports
 * relationship kind is NOT EMITTED for kotlin") was able to stand unmeasured for
 * a whole wave.
 *
 * The construct Kotlin has instead is the visibility convention:
 *
 *   - a top-level declaration with NO visibility modifier is `public` (Kotlin
 *     spec, default visibility), so it is part of the file's published surface;
 *   - `internal` restricts it to the module — NOT published;
 *   - `private` restricts it to the file — NOT published.
 *
 * So the surface is real and it is large, and it is a fact about the language
 * rather than about a keyword. B8 counts it three ways so the verdict cannot rest
 * on one branch:
 *
 *   published        top-level, visibility public or default
 *   withheld-internal  top-level `internal`
 *   withheld-private   top-level `private`
 *
 * An `exports` edge whose source is the file and whose target is each published
 * name is therefore a TRUE edge about Kotlin, in the same sense that Haskell's
 * `module M (foo)` export list, Python's `__all__`, Bash's `export -f fn` and
 * Zig's file-level surface are true in those languages — and all four of those
 * lanes emit `Exports` relationships today.
 */
const surfacePublished = newHit()
const surfaceInternal = newHit()
const surfacePrivate = newHit()
const surfaceByKind = new Map<string, number>()
let topLevelTotal = 0

/**
 * PROBE B2 — supertype clause shape, for `extends` vs `implements`.
 *
 * Kotlin's `: A(), B` delegation_specifier list is ONE clause that mixes a
 * constructor-invocation supertype (extends) with bare type references
 * (implements). The analyzer reads position for the split; this probe counts
 * both positions so the split has a number behind it and so a language that
 * cannot express an interface list would show 0.
 */
const delegationProbe = newHit()
const ctorSupertype = newHit()
const bareSupertype = newHit()

/**
 * PROBE B3 — `override` modifier on a member declaration.
 *
 * The construct `overrides` needs: a member carrying `override`, plus a
 * supertype. Counted separately so "kotlin has no overrides construct" is a
 * number rather than a claim.
 */
const overrideProbe = newHit()
const overrideInClass = newHit()

/** PROBE B4 — `call_expression` and its callee shape, for calls/instantiates. */
const callProbe = newHit()
const barePascalCallee = newHit()
const qualifiedPascalCallee = newHit()
const delegationCallProbe = newHit()

/** PROBE B5 — `import_header`. */
const importProbe = newHit()

/** PROBE B6 — coroutine/scope-function dispatch callees, for `uses`. */
const dispatchCallee = new Map<string, number>()
const dispatchProbe = newHit()

/** PROBE B7 — nodes carrying an ERROR/MISSING, so the walk's blindness is stated. */
const errorNodes = newHit()

function probeFile(root: any, label: string): void {
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!

    if (TOP_LEVEL_DECLS.has(n.type)) {
      const name = firstNamedText(n, ["type_identifier", "simple_identifier"])
      topLevelTotal++
      const { visibility } = modifierInfo(n)
      const vis = visibility ?? "(default-public)"
      visByKeyword.set(vis, (visByKeyword.get(vis) ?? 0) + 1)
      record(visProbe, label, `${n.type} ${name} ${vis}`)

      // PROBE B8 — the published surface, by Kotlin's own visibility rule.
      const kind = n.type
      if (visibility === null || visibility === "public") {
        record(surfacePublished, label, `${kind} ${name}`)
        surfaceByKind.set(kind, (surfaceByKind.get(kind) ?? 0) + 1)
      } else if (visibility === "internal") {
        record(surfaceInternal, label, `${kind} ${name} internal`)
      } else if (visibility === "private") {
        record(surfacePrivate, label, `${kind} ${name} private`)
      }
    }

    if (n.type === "delegation_specifier") {
      record(delegationProbe, label, firstNamedText(n, ["constructor_invocation", "user_type", "type_identifier"]) || n.type)
      // A supertype is a CONSTRUCTOR invocation when the specifier's own children
      // include a constructor_invocation — `: Bar()` — and a bare TYPE reference
      // when it does not — `: Baz`. Read structurally, not by text.
      let isCtor = false
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "constructor_invocation") { isCtor = true; break }
      }
      if (isCtor) record(ctorSupertype, label, n.text)
      else record(bareSupertype, label, n.text)
    }

    if (n.type === "call_expression") {
      record(callProbe, label, n.text.slice(0, 40))
      // The callee path: a bare callee has no receiver; a qualified one has a
      // navigation_expression ancestor between the callee and the call.
      const callee = firstNamedText(n, ["simple_identifier", "navigation_expression"])
      // Distinguish by the call's own shape: an unnamed `(` child preceded by a
      // navigation_expression means `recv.sel(...)`.
      let isQualified = false
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "navigation_expression") { isQualified = true; break }
      }
      const leaf = callee.includes(".") ? (callee.split(".").pop() ?? callee) : callee
      if (leaf.length > 0 && leaf.charCodeAt(0) >= 65 && leaf.charCodeAt(0) <= 90) {
        if (isQualified) record(qualifiedPascalCallee, label, callee)
        else record(barePascalCallee, label, callee)
      }
    }

    if (n.type === "constructor_delegation_call") record(delegationCallProbe, label, n.text.slice(0, 40))

    if (n.type === "import_header") record(importProbe, label, n.text.slice(0, 60))

    if (n.type === "modifiers") {
      // Same wrapper indirection as `modifierInfo` — the keyword is the TEXT.
      // `override` arrives as `member_modifier`, whose type is not `override`.
      const kids: string[] = []
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) kids.push(c.text.trim())
      }
      if (kids.includes("override")) {
        record(overrideProbe, label, n.text.trim())
        let p = n.parent
        let inClass = false
        while (p) {
          if (p.type === "class_declaration" || p.type === "object_declaration") { inClass = true; break }
          if (p.type === "source_file") break
          p = p.parent
        }
        if (inClass) record(overrideInClass, label, n.text.trim())
      }
    }

    if (n.type === "ERROR" || n.type === "MISSING") record(errorNodes, label, n.type)

    // dispatch callees: any bare call_expression whose simple_identifier callee
    // is one of the coroutine/scope functions the analyzer maps to Uses.
    if (n.type === "call_expression") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && (c.type === "simple_identifier" || c.type === "navigation_expression")) {
          const leaf = c.text.includes(".") ? (c.text.split(".").pop() ?? c.text) : c.text
          if (DISPATCH_NAMES.has(leaf)) {
            dispatchCallee.set(leaf, (dispatchCallee.get(leaf) ?? 0) + 1)
            record(dispatchProbe, label, leaf)
          }
          break
        }
      }
    }

    for (let i = 0; i < n.childCount; i++) {
      const ch = n.child(i)
      if (ch) stack.push(ch)
    }
  }
}

/**
 * The callee names the analyzer treats as coroutine/scope dispatch. Restated
 * here as a literal set rather than scanned for, because a scan is a regex and
 * this file has none. The census does not assume this list is complete — it
 * reports what it found and the differential's own oracle is what audits
 * completeness.
 */
const DISPATCH_NAMES = new Set([
  "launch", "async", "withContext", "runBlocking", "coroutineScope",
  "supervisorScope", "let", "run", "apply", "also", "takeIf", "takeUnless",
  "use", "synchronized", "repeat", "forEach", "map", "fold", "letOrThrow",
])

// ---------------------------------------------------------------------------
// THE WALK
// ---------------------------------------------------------------------------

interface EdgeFacts {
  n: number
  files: Set<string>
  examples: string[]
  /** endpoints that are the empty string */
  emptySource: number
  emptyTarget: number
  /** endpoints equal to the placeholder literal `unknown` (rule R7) */
  unknownSource: number
  unknownTarget: number
  /** source resolves to a symbol declared in THIS file */
  srcResolvesInFile: number
  /** target resolves to a symbol declared in THIS file */
  tgtResolvesInFile: number
  /** confidence buckets */
  conf: Map<number, number>
  /** evidenceClass values seen */
  evidence: Map<string, number>
  /** metadata.reasonCode values seen */
  reasonCode: Map<string, number>
  /** edges whose source is the placeholder `Global` */
  globalSource: number
  /** edges whose target is the literal keyword `super` / `this` */
  keywordTarget: number
}

function newEdgeFacts(): EdgeFacts {
  return {
    n: 0, files: new Set<string>(), examples: [],
    emptySource: 0, emptyTarget: 0, unknownSource: 0, unknownTarget: 0,
    srcResolvesInFile: 0, tgtResolvesInFile: 0,
    conf: new Map(), evidence: new Map(), reasonCode: new Map(),
    globalSource: 0, keywordTarget: 0,
  }
}

const facts = new Map<Type, EdgeFacts>()
for (const t of ALL_TYPES) facts.set(t, newEdgeFacts())

/**
 * The channel counters, as a JSON-able value. Used as the BEFORE-image
 * (`chanBase`) and, after a file is walked, as the AFTER-image from which a
 * per-file DELTA is taken.
 */
function chanState(): any {
  const per: any = {}
  for (const [t, fx] of facts) {
    per[t] = {
      n: fx.n, files: [...fx.files], examples: [...fx.examples],
      emptySource: fx.emptySource, emptyTarget: fx.emptyTarget,
      unknownSource: fx.unknownSource, unknownTarget: fx.unknownTarget,
      srcResolvesInFile: fx.srcResolvesInFile, tgtResolvesInFile: fx.tgtResolvesInFile,
      globalSource: fx.globalSource, keywordTarget: fx.keywordTarget,
      conf: [...fx.conf.entries()], evidence: [...fx.evidence.entries()],
      reasonCode: [...fx.reasonCode.entries()],
    }
  }
  return {
    per,
    symbolsTotal, errorsTotal, filesWithErrors,
    exportsChannel, exportsFiles, exportsNonPublic, exportsExamples: [...exportsExamples],
    importsChannel, importsFiles,
  }
}

/**
 * The per-file DELTA between the before-image and the after-image.
 *
 * DELTA, not absolute — and that distinction is load-bearing. The first version
 * of this stored the ABSOLUTE counters, so a resumed run replayed 60 cumulative
 * snapshots and reported 13,400 `calls` where a fresh run reported 341: a 39x
 * inflation produced entirely by the resume path, which is the one path nobody
 * re-runs and therefore the one place a wrong number survives longest.
 */
function chanDelta(after: any): any {
  const b = chanBase
  const per: any = {}
  for (const [t, d] of Object.entries(after.per) as [Type, any][]) {
    const bb = b.per[t]
    const diff: any = {
      n: d.n - bb.n,
      files: d.files.filter((f: string) => !bb.files.includes(f)),
      examples: d.examples.filter((e: string) => !bb.examples.includes(e)),
      emptySource: d.emptySource - bb.emptySource,
      emptyTarget: d.emptyTarget - bb.emptyTarget,
      unknownSource: d.unknownSource - bb.unknownSource,
      unknownTarget: d.unknownTarget - bb.unknownTarget,
      srcResolvesInFile: d.srcResolvesInFile - bb.srcResolvesInFile,
      tgtResolvesInFile: d.tgtResolvesInFile - bb.tgtResolvesInFile,
      globalSource: d.globalSource - bb.globalSource,
      keywordTarget: d.keywordTarget - bb.keywordTarget,
      // Buckets are stored ABSOLUTE, not differenced. A bucket whose total is
      // unchanged between two consecutive files (very common: two files both
      // contributing zero `uses` edges below 0.7, or the same evidenceClass)
      // produces an empty key-delta and its count is silently dropped, so the
      // resumed total undercounts. The first version differenced on
      // (key, value) equality and reported 391 instead of 61 `uses` edges below
      // 0.7 and 99 instead of 29 `overrides`. These are small maps — at most a
      // handful of keys per type — so absolute is both correct and cheap.
      conf: d.conf,
      evidence: d.evidence,
      reasonCode: d.reasonCode,
    }
    if (diff.n !== 0) per[t] = diff
  }
  return {
    per,
    symbolsTotal: after.symbolsTotal - b.symbolsTotal,
    errorsTotal: after.errorsTotal - b.errorsTotal,
    filesWithErrors: after.filesWithErrors - b.filesWithErrors,
    exportsChannel: after.exportsChannel - b.exportsChannel,
    exportsFiles: after.exportsFiles - b.exportsFiles,
    exportsNonPublic: after.exportsNonPublic - b.exportsNonPublic,
    exportsExamples: after.exportsExamples.filter((e: string) => !b.exportsExamples.includes(e)),
    importsChannel: after.importsChannel - b.importsChannel,
    importsFiles: after.importsFiles - b.importsFiles,
  }
}
let chanBase: any = null

/** Replay a snapshot onto the live counters. */
function chanRestore(c: any): void {
  for (const [t, d] of Object.entries(c.per ?? {})) {
    if (!facts.has(t as Type)) continue
    const fx = facts.get(t as Type)!
    fx.n += d.n
    for (const f of d.files) if (fx.files.size < 6) fx.files.add(f)
    fx.examples.push(...d.examples)
    if (fx.examples.length > 6) fx.examples.length = 6
    fx.emptySource += d.emptySource; fx.emptyTarget += d.emptyTarget
    fx.unknownSource += d.unknownSource; fx.unknownTarget += d.unknownTarget
    fx.srcResolvesInFile += d.srcResolvesInFile; fx.tgtResolvesInFile += d.tgtResolvesInFile
    fx.globalSource += d.globalSource; fx.keywordTarget += d.keywordTarget
    // SET, not accumulate: the checkpoint stores absolute bucket counts (see
    // chanDelta), so replaying overwrites rather than adds.
    for (const [k, n] of d.conf) fx.conf.set(k, n)
    for (const [k, n] of d.evidence) fx.evidence.set(k, n)
    for (const [k, n] of d.reasonCode) fx.reasonCode.set(k, n)
  }
  symbolsTotal += c.symbolsTotal ?? 0
  errorsTotal += c.errorsTotal ?? 0
  filesWithErrors += c.filesWithErrors ?? 0
  exportsChannel += c.exportsChannel ?? 0
  exportsFiles += c.exportsFiles ?? 0
  exportsNonPublic += c.exportsNonPublic ?? 0
  for (const e of (c.exportsExamples ?? [])) {
    if (exportsExamples.length < 6) exportsExamples.push(e)
  }
  importsChannel += c.importsChannel ?? 0
  importsFiles += c.importsFiles ?? 0
}

let importsChannel = 0
let importsFiles = 0
let exportsChannel = 0
let exportsFiles = 0
let exportsExamples: string[] = []
let exportsNonPublic = 0
let symbolsTotal = 0
let errorsTotal = 0
let filesWithErrors = 0

const files = collectKotlinFiles(KOTLIN_DIR, NFILES)

// A resumable, append-only walk: `parseFile` can kill this process outright on a
// poison file, so a checkpoint written at the END never gets written. Appending
// BEFORE the next file means an arbitrary kill still leaves the log on disk.
import { appendFileSync, existsSync } from "node:fs"
if (process.env.FRESH === "1") { try { (await import("node:fs")).unlinkSync(CHECKPOINT) } catch {} }
mkdirSync(path.dirname(CHECKPOINT), { recursive: true })
const done = new Set<string>()
/** Prior runs' channel contributions, replayed so a resume reports the same totals. */
const priorChannel: any[] = []
if (existsSync(CHECKPOINT)) {
  for (const line of readFileSync(CHECKPOINT, "utf8").split("\n")) {
    if (!line) continue
    // A bare path or `!path` from an OLDER checkpoint format is accepted as a
    // marker but carries NO channel contribution, so the run that reads it
    // reports channel totals over fewer files than it claims. That is refused
    // loudly below rather than silently under-counted.
    if (line.startsWith("{") && line.endsWith("}")) {
      try {
        const rec = JSON.parse(line)
        if (typeof rec.f === "string") {
          done.add(rec.f)
          if (rec.ok && rec.c) priorChannel.push(rec.c)
        }
        continue
      } catch { /* fall through to the legacy-marker path */ }
    }
    if (line.startsWith("!")) done.add(line.slice(1))
    else done.add(line)
  }
}

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-kotlin.wasm"))))

let walked = 0, resumed = 0, bad = 0
const failed: string[] = []
/**
 * Probe accumulators are RESET on every run, and the probes run on every file
 * regardless of the checkpoint.
 *
 * The checkpoint exists because `parseFile` can kill this process on a poison
 * file, so the expensive channel-1 walk must not be repeated. The probes are
 * cheap — one parse, one walk — and they are the instrument's ACTUAL EVIDENCE
 * for every RULED verdict. A resumed run that skipped them printed
 * "top-level declarations: total 0" over a 60-file population, which is a count
 * of zero over the wrong population wearing the population's name: exactly the
 * failure `docs/M14-HONESTY-CONTRACT.md` §"Rule: an instrument must declare the
 * population it covered" exists to prevent.
 *
 * So: probes unconditional and reset every run; channel-1 channel-3 checkpointed.
 */
for (const k of [
  visProbe, delegationProbe, ctorSupertype, bareSupertype, overrideProbe,
  overrideInClass, callProbe, barePascalCallee, qualifiedPascalCallee,
  delegationCallProbe, importProbe, dispatchProbe, errorNodes,
  surfacePublished, surfaceInternal, surfacePrivate,
]) { k.occ = 0; k.files.clear(); k.examples.length = 0 }
grammarNodeTypes.clear()
visByKeyword.clear()
surfaceByKind.clear()
dispatchCallee.clear()
topLevelTotal = 0
symbolsTotal = 0
errorsTotal = 0
filesWithErrors = 0
importsChannel = 0
importsFiles = 0
exportsChannel = 0
exportsFiles = 0
exportsNonPublic = 0
exportsExamples = []
for (const [t, fx] of facts) facts.set(t, newEdgeFacts())
// REPLAY the earlier runs' channel contributions. Without this the channel-1
// totals on a resumed run cover only the files THIS run happened to walk, while
// the probes cover all of them, and the report would present two channels with
// two different populations as one measurement.
for (const c of priorChannel) chanRestore(c)

for (const f of files) {
  const label = f.rel
  const alreadyWalked = done.has(f.abs)

  let text = ""
  try { text = readFileSync(f.abs, "utf8") } catch { continue }

  // PROBE A + PROBE B run on the RAW tree, before any analyzer filter, so the
  // probes see the grammar's own output rather than the analyzer's subset.
  // UNCONDITIONAL — see the note above.
  try {
    const t = parser.parse(text)
    if (t) {
      inventoryGrammar(t.rootNode)
      probeFile(t.rootNode, label)
      t.delete?.()
    }
  } catch { /* the raw parse failing is recorded via parseFile below */ }

  if (alreadyWalked) { resumed++; continue }

  chanBase = chanState()
  try {
    const r: any = await parseFile(f.abs, join(KOTLIN_DIR, "."))
    walked++

    // ---- CHANNEL 1: relationships
    const symNames = new Set<string>()
    for (const s of (r.symbols ?? [])) if (s && typeof s.name === "string" && s.name) symNames.add(s.name)
    symbolsTotal += (r.symbols ?? []).length

    for (const rel of (r.relationships ?? [])) {
      const t = String(rel.type ?? rel.relationshipType ?? "") as Type
      if (!facts.has(t)) continue
      const fx = facts.get(t)!
      fx.n++
      if (fx.files.size < 6) fx.files.add(label)
      const src = String(rel.source ?? "")
      const tgt = String(rel.target ?? "")
      if (fx.examples.length < 6) fx.examples.push(`${src} -> ${tgt}`)
      if (src === "") fx.emptySource++
      if (tgt === "") fx.emptyTarget++
      if (src === "unknown") fx.unknownSource++
      if (tgt === "unknown") fx.unknownTarget++
      if (src === "Global") fx.globalSource++
      if (tgt === "super" || tgt === "this") fx.keywordTarget++
      // ENDPOINT RESOLUTION. Deliberately conservative: a name that matches a
      // symbol declared in THIS file. A cross-file target cannot resolve here
      // (one file, no project context), so this measures the floor of what can
      // be resolved in-file and the report says so.
      if (src && symNames.has(src)) fx.srcResolvesInFile++
      if (tgt && symNames.has(tgt)) fx.tgtResolvesInFile++
      const c = typeof rel.confidence === "number" ? rel.confidence : -1
      fx.conf.set(c, (fx.conf.get(c) ?? 0) + 1)
      const ec = rel.metadata?.evidenceClass
      if (typeof ec === "string") fx.evidence.set(ec, (fx.evidence.get(ec) ?? 0) + 1)
      const rc = rel.metadata?.reasonCode
      if (typeof rc === "string") fx.reasonCode.set(rc, (fx.reasonCode.get(rc) ?? 0) + 1)
    }

    // ---- CHANNEL 2: imports[]  (the brain_import table's own channel)
    importsChannel += (r.imports ?? []).length
    if ((r.imports ?? []).length) importsFiles++

    // ---- CHANNEL 3: exports[]  (ExportInfo[])
    const ex = r.exports ?? []
    if (ex.length) {
      exportsChannel += ex.length
      exportsFiles++
      for (const e of ex) {
        if (e.visibility && e.visibility !== "public") exportsNonPublic++
      }
      if (exportsExamples.length < 6) {
        for (const e of ex.slice(0, 2)) exportsExamples.push(`${label}: ${e.name} (${e.kind}, ${e.visibility})`)
      }
    }

    const errs = (r.errors ?? []).length
    errorsTotal += errs
    if (errs) filesWithErrors++

    // THE RECORD, not just a marker. See the note above: a checkpoint that stores
    // only "this file was seen" makes the NEXT run's channel totals cover only
    // the files it happened to walk, and the report cannot tell the reader which
    // files those were. So each file's channel contribution is serialised as JSON
    // on the SAME append-only line, and a resumed run replays them. The report
    // then states the population the totals are over, and that population is the
    // whole offer.
    appendFileSync(CHECKPOINT, JSON.stringify({ f: f.abs, ok: true, c: chanDelta(chanState()) }) + "\n")
  } catch (e) {
    bad++
    if (failed.length < 10) failed.push(`${label}: ${String(e).slice(0, 80)}`)
    appendFileSync(CHECKPOINT, JSON.stringify({ f: f.abs, ok: false, e: String(e).slice(0, 120) }) + "\n")
  }
}

// ---------------------------------------------------------------------------
// REPORT
// ---------------------------------------------------------------------------

const out: string[] = []
const P = (s = "") => { out.push(s); console.log(s) }

P(`kotlin ontology census — DERIV_EXPORTS_KOT3`)
P(`corpus root : ${KOTLIN_DIR}`)
P(`POPULATION  : ${files.length} .kt/.kts files offered (derived by directory walk, sorted, no hand-written list)`)
P(`walked      : ${walked} newly, ${resumed} resumed from checkpoint, ${bad} failed`)
P(`CHANNEL POPULATION: ${walked + resumed} of ${files.length} files carry channel data this run`)
if (bad) { P(`failed files:`); for (const f of failed) P(`  ${f}`) }
if (priorChannel.length > 0 && priorChannel.length < resumed) {
  P("")
  P(`>>> WARNING: ${resumed} files resumed but only ${priorChannel.length} carry a channel contribution.`)
  P(`>>> The checkpoint holds LEGACY bare-path markers from an older format, which record that a`)
  P(`>>> file was SEEN and nothing about what it produced. The channel totals below are therefore`)
  P(`>>> over ${priorChannel.length} files, not ${walked + resumed}. Re-run with FRESH=1 for totals over`)
  P(`>>> the whole population. A count that is smaller than the population it is printed beside is`)
  P(`>>> the defect this instrument exists to avoid, so it is printed rather than smoothed.`)
}
P(`grammar inventory (probe A): ${grammarNodeTypes.size} distinct node types over the walked files`)
P(`symbols     : ${symbolsTotal.toLocaleString()}`)
P(`parse errors: ${errorsTotal.toLocaleString()} ERROR/MISSING nodes in ${filesWithErrors} files`)
P(`files carrying ERROR/MISSING: ${(filesWithErrors / Math.max(1, walked + resumed) * 100).toFixed(1)}% of the channel population — this is the ceiling on every probe below, because a construct inside an ERROR node is not walked`)
P("")

P("=== CHANNEL 1 — relationships (brain_relationship rows) ===")
P(`${"type".padEnd(14)}${"n".padStart(8)}  files  res-src  res-tgt  empty  unknown  conf<0.7  Global  keyword`)
for (const t of ALL_TYPES) {
  const fx = facts.get(t)!
  const below = [...fx.conf.entries()].filter(([c]) => c >= 0 && c < 0.7).reduce((a, [, n]) => a + n, 0)
  P(`${t.padEnd(14)}${String(fx.n).padStart(8)}  ${String(fx.files.size).padStart(5)}  ${String(fx.srcResolvesInFile).padStart(7)}  ${String(fx.tgtResolvesInFile).padStart(7)}  ${String(fx.emptySource + fx.emptyTarget).padStart(6)}  ${String(fx.unknownSource + fx.unknownTarget).padStart(7)}  ${String(below).padStart(8)}  ${String(fx.globalSource).padStart(6)}  ${String(fx.keywordTarget).padStart(7)}`)
}
P("")
P("res-src / res-tgt: endpoints matching a symbol declared in THE SAME FILE. This is a FLOOR, not a rate —")
P("  a cross-file target is unresolvable by construction in a per-file analyzer.")
P("")

P("confidence distribution per type (bucket: edges)")
for (const t of ALL_TYPES) {
  const fx = facts.get(t)!
  if (!fx.n) continue
  const parts = [...fx.conf.entries()].sort((a, b) => a[0] - b[0]).map(([c, n]) => `${c}:${n}`)
  P(`  ${t.padEnd(13)} ${parts.join("  ")}`)
}
P("")
P("evidenceClass / reasonCode per type")
for (const t of ALL_TYPES) {
  const fx = facts.get(t)!
  if (!fx.n) continue
  const ev = [...fx.evidence.entries()].map(([k, n]) => `${k}:${n}`)
  const rc = [...fx.reasonCode.entries()].map(([k, n]) => `${k}:${n}`)
  if (ev.length) P(`  ${t.padEnd(13)} evidenceClass ${ev.join(" ")}`)
  if (rc.length) P(`  ${t.padEnd(13)} reasonCode    ${rc.join(" ")}`)
}
P("")
P("=== CHANNEL 2 — imports[] (brain_import table) ===")
const impF = facts.get("imports")
P(`  imports as a RELATIONSHIP type : ${impF.n} edges`)
P(`  imports[] ImportInfo rows      : ${importsChannel} in ${importsFiles} files  [ParseResult channel 2 -> brain_import]`)
P(`  import_header nodes on the tree: ${importProbe.occ} occurrences in ${importProbe.files.size} files  [PROBE B5]`)

P("")
P("=== CHANNEL 3 — exports[] (ExportInfo[]) ===")
P(`  exports as a RELATIONSHIP type : ${facts.get("exports")!.n} edges`)
P(`  exports[] ExportInfo rows      : ${exportsChannel} in ${exportsFiles} files (${exportsNonPublic} non-public)`)
for (const e of exportsExamples) P(`    ${e}`)

P("")
P("=== PROBE B — semantic construct counts on the tree ===")
P(`B1 top-level declarations, by visibility      : total ${topLevelTotal}`)
for (const [k, v] of [...visByKeyword.entries()].sort((a, b) => b[1] - a[1])) P(`     ${k.padEnd(10)} ${v}`)
P(`     visProbe occurrences ${visProbe.occ} in ${visProbe.files.size} files`)
P(`B8 PUBLISHED SURFACE (kotlin's visibility rule) : published ${surfacePublished.occ} in ${surfacePublished.files.size} files`)
for (const [k, v] of [...surfaceByKind.entries()].sort((a, b) => b[1] - a[1])) P(`     published ${k.padEnd(22)} ${v}`)
P(`     withheld: internal ${surfaceInternal.occ} in ${surfaceInternal.files.size} files, private ${surfacePrivate.occ} in ${surfacePrivate.files.size} files`)
P(`B2 delegation_specifier (supertype clause)   : ${delegationProbe.occ} in ${delegationProbe.files.size} files`)
P(`     constructor_invocation (extends slot)    : ${ctorSupertype.occ} in ${ctorSupertype.files.size} files`)
P(`     bare type reference (implements slot)   : ${bareSupertype.occ} in ${bareSupertype.files.size} files`)
P(`B3 override modifier on a declaration         : ${overrideProbe.occ} in ${overrideProbe.files.size} files`)
P(`     of which inside a class body             : ${overrideInClass.occ} in ${overrideInClass.files.size} files`)
P(`B4 call_expression                           : ${callProbe.occ} in ${callProbe.files.size} files`)
P(`     bare PascalCase callee (instantiates)    : ${barePascalCallee.occ} in ${barePascalCallee.files.size} files`)
P(`     qualified PascalCase callee (calls)      : ${qualifiedPascalCallee.occ} in ${qualifiedPascalCallee.files.size} files`)
P(`     constructor_delegation_call              : ${delegationCallProbe.occ} in ${delegationCallProbe.files.size} files`)
P(`B5 import_header                             : ${importProbe.occ} in ${importProbe.files.size} files`)
P(`B6 dispatch callees (uses)                   : ${dispatchProbe.occ} in ${dispatchProbe.files.size} files`)
for (const [k, v] of [...dispatchCallee.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) P(`     ${k.padEnd(16)} ${v}`)

P("")
P("=== PROBE A — node types that would MEAN each construct ===")
/**
 * For each type, the node types whose presence in the grammar inventory would
 * mean the construct exists. Reported as PRESENT/ABSENT against the measured
 * inventory, so a reader can check the reasoning rather than take it.
 */
const WOULD_MEAN: Record<Type, string[]> = {
  calls: ["call_expression"],
  uses: ["call_expression", "navigation_expression"],
  contains: ["class_body", "function_body", "object_declaration"],
  imports: ["import_header"],
  references: ["import_header", "user_type", "type_identifier"],
  exports: ["export_declaration", "export_list", "export_statement"],
  extends: ["delegation_specifier", "constructor_invocation"],
  implements: ["delegation_specifier", "user_type"],
  overrides: ["modifiers"],
  instantiates: ["call_expression", "constructor_invocation"],
}
for (const t of ALL_TYPES) {
  const want = WOULD_MEAN[t]
  const present = want.filter((n) => grammarNodeTypes.has(n))
  const absent = want.filter((n) => !grammarNodeTypes.has(n))
  P(`  ${t.padEnd(13)} present: ${present.join(" ") || "(none)"}`)
  P(`  ${" ".repeat(13)} absent : ${absent.join(" ") || "(none)"}`)
}

P("")
P("=== full grammar node-type inventory (probe A, alphabetical) ===")
P([...grammarNodeTypes.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}:${v}`).join("  "))

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(path.join(OUT_DIR, "kotlin-ontology-census.txt"), out.join("\n") + "\n")
P("")
P(`written: ${path.join(OUT_DIR, "kotlin-ontology-census.txt")}`)
P("INDEPENDENCE: this census and the analyzer are two walkers over the SAME tree-sitter-kotlin")
P("grammar. A grammar bug shared by both is invisible to both. What this instrument CAN falsify:")
P("a count, a label, an endpoint identity, a confidence value. What it CANNOT: a node type the")
P("grammar itself never produces.")
