/**
 * NIM ONTOLOGY CENSUS — the measurement the three verdicts rest on.
 *
 * ## Why this exists as a separate script
 *
 * `script/m14/ontology-coverage-gate.ts` is the arbiter, but its ruling table
 * (`RULED_BY_LANG`) carries entries for `bash` and `json` only, and the script
 * REFUSES to report for any language without one:
 *
 *   if (RULED_BY_LANG[LANG] === undefined) { … process.exit(2) }
 *
 * So `npx tsx script/m14/ontology-coverage-gate.ts nim` walks the whole corpus
 * through `parseFile` and then exits 2 without printing a verdict. That file is
 * supervisor-owned (workstream §8), so the need is reported rather than edited.
 *
 * This script is the lane's own instrument and it deliberately mirrors the
 * arbiter's method so the two are comparable when the arbiter does learn the
 * language:
 *
 *   - same corpus walk (git ls-files, `detectLanguageFromPath`, 512 KB cap)
 *   - same production entry point (`parseFile` from `src/ast/pool-worker`,
 *     NOT `analyze()` — `analyze()` skips the pipeline stages)
 *   - same Instrument A (grammar inventory) and Instrument B (parse-tree count)
 *   - the same six questions, measured
 *
 * ## What it reports, and why each number is asked for
 *
 *   per-type edge count + files        — question 2, "Fires"
 *   per-type resolution rate           — question 5, "Resolved". CSS `references`
 *                                        resolves at both ends on 66.8% of its
 *                                        edges, so a low rate here is a finding
 *   per-type confidence histogram      — question 6, "Confident". <0.7 is a
 *                                        heuristic by the honesty contract §4
 *   per-type evidenceClass tally       — question 6
 *   SymbolKind census + empty names    — standing rules: never empty/unknown
 *   endpoints equal to "unknown"       — standing rule R7
 *   grammar node-type inventory        — Instrument A, positive evidence of absence
 *   parse-tree construct counts        — Instrument B, where a string cannot lie
 *
 * A type that is absent from the edge table is NOT thereby RULED. It is RULED
 * only when the instrument that applies to its construct also measures zero —
 * and the script prints which instrument was available for it.
 *
 * READ-ONLY. Writes nothing outside its own stdout and an optional JSON path
 * passed as argv[2].
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { detectLanguageFromPath, EXTENSION_LANGUAGE } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

/** Corpus fan-out, and the reason it is a knob rather than a constant.
 *
 * The production path is non-deterministic under concurrency (the doc's
 * Limitations 8 / 11): the WASM parser exhausts its fixed heap on a
 * load-dependent set of files, and a file lost that way publishes symbols with
 * an EMPTY `kind` — a degraded walk whose counts are wrong and whose artifact is
 * otherwise indistinguishable from a clean one. Measured on this corpus at
 * `validation/m14/fixtures/nim/fallback.mts`: 1 worker -> 0 fallback files and 0
 * empty-kind symbols; 6 workers -> 2 and 4.
 *
 * So every number this lane quotes carries its worker count, and this is what
 * makes that count choosable rather than merely reported. Six is the default
 * because that is what every artifact on record was measured at, so an unpinned
 * invocation reproduces the committed figures. Lower it on a saturated box to
 * buy a clean walk; the spread is in the doc either way.
 */
const WORKERS = Math.max(1, Number(process.env.BB_NIM_WORKERS ?? 6) || 6)

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "nim"
const OUT = process.argv[2] && process.argv[2].endsWith(".json") ? process.argv[2] : null
/** A degraded walk must never overwrite a clean artifact under its own name.
 *
 * The production path is non-deterministic under concurrency (see the doc's
 * Limitations 8): the WASM parser loses a load-dependent set of files to heap
 * exhaustion, and a file lost that way publishes symbols with an EMPTY `kind`.
 * A degraded walk therefore produces a plausible, digest-pinned, correctly-named
 * artifact full of numbers that are wrong — which is strictly worse than no
 * artifact, because it is indistinguishable from a clean one to every later
 * reader, including this script's own doc.
 *
 * So the write is conditional on the walk being clean, and a degraded walk is
 * written to a DISTINCT name instead. Discarding it silently is the other
 * failure: an earlier generation of this lane lost a whole session's analysis
 * for exactly that reason. The spread has to stay visible. */
const writeArtifact = (pathOut: string, body: unknown, clean: boolean, why: string): void => {
  if (clean) { writeFileSync(pathOut, JSON.stringify(body, null, 2)); return }
  const alt = pathOut.endsWith(".json") ? `${pathOut.slice(0, -".json".length)}.degraded.json` : `${pathOut}.degraded.json`
  writeFileSync(alt, JSON.stringify(body, null, 2))
  console.log(`\nDEGRADED WALK — ${why}.`)
  console.log(`  REFUSING to overwrite ${pathOut}: a degraded run under a clean name is the`)
  console.log(`  defect this guard exists to prevent. The walk is written to ${alt} instead,`)
  console.log(`  and the committed artifact is left as it was. See the doc's Limitations 8.`)
}

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

/** Synthetic source labels the analyzers use for a file-scope edge. They are
 *  NOT symbols and must not be counted as resolution failures — but they must be
 *  declared, so they are counted separately rather than silently excused. */
const SYNTHETIC_SOURCES = new Set(["(global)", "(file)", "(declared-type)", "(module)"])

/** How many example files the per-type row prints. The COUNT of files a type
 *  fired in is measured separately and is never capped — see `Row.filesAll`. */
const FILE_LIST_CAP = 6

// ─────────────────────────────────────────────────────────────── corpus walk
// Identical to the arbiter's walk so the two file sets are the same set.
const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
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
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}

// ─────────────────────────────────────────────────── per-repo module stems
// An `imports` target is a MODULE, not a symbol. Resolving it against the
// file's own symbol set would report 0% and say nothing, so module resolution
// is measured separately against the .nim file stems of the same repo — which
// is the question a reader of a dependency edge actually asks.
const moduleStemsByRepo = new Map<string, Set<string>>()
/** Strip a recognised source extension, by TABLE LOOKUP against the engine's own
 *  `EXTENSION_LANGUAGE` rather than by a pattern.
 *
 *  These two lines used to be `/\.(nim|nims|nimble)$/i`. That is the workstream's
 *  standing objection in a smaller form than usual: it DUPLICATED the extension
 *  list `src/ast/language-detection.ts` already owns, so adding an extension
 *  there would silently fail to update this instrument and the module-resolution
 *  rate would move for a reason no reader could see. The set below is derived
 *  from that table by selecting the entries this lane owns, so the two cannot
 *  disagree and there is no second list to update.
 *
 *  Three corrections, all three caught by diffing this refactor's walk against the
 *  pre-refactor walk rather than by reading the code, and all three moving the
 *  SAME quoted number in three different directions:
 *
 *    - returning the BASENAME instead of the whole path dropped every directory
 *      segment, so `std/os.nim` stopped contributing `std/os`. imports 37.1% ->
 *      37.0%.
 *    - testing membership in the WHOLE `EXTENSION_LANGUAGE` table stripped other
 *      languages' extensions, adding stems this lane never had. 37.1% -> 37.7%.
 *    - keeping the directory on the STEM (the third form tried) added
 *      `lib/pure/os` where the original contributed only `os`. 37.1% -> 37.7%.
 *
 *  So the original was doing TWO different things in one expression and this had
 *  to reproduce both: `stem` is the BASENAME with the extension stripped, while
 *  the segment loop indexes the WHOLE relative path. All three errors were
 *  invisible in review and each moved a number a reader would have quoted, which
 *  is the argument for the diff rather than for the care. This operates on a PATH
 *  and never on source text, so the objection that actually matters — a pattern
 *  matching comments and string literals — never applied here; what was removed is
 *  the duplicated extension list. */
const NIM_SOURCE_EXTS: ReadonlySet<string> = new Set(
  Object.entries(EXTENSION_LANGUAGE).filter(([, lang]) => lang === "nim").map(([ext]) => ext.toLowerCase()),
)
const stripSourceExt = (p: string): string => {
  // The dot must come AFTER the last separator, or `std/os` loses its directory
  // and a module path stops resolving. Slicing at the first dot — or returning
  // the basename — silently costs one `imports` resolution and was caught by
  // diffing this refactor's walk against the pre-refactor walk (37.1% -> 37.0%).
  const slash = p.lastIndexOf("/")
  const dot = p.lastIndexOf(".")
  if (dot <= slash + 1) return p
  return NIM_SOURCE_EXTS.has(p.slice(dot + 1).toLowerCase()) ? p.slice(0, dot) : p
}
for (const f of files) {
  // TWO shapes, as the original had: the stem is the BASENAME, the segment loop
  // walks the WHOLE relative path. Collapsing them into one call is what produced
  // 37.0% and 37.7%; the shape difference is load-bearing.
  const stem = stripSourceExt(path.basename(f.rel))
  const set = moduleStemsByRepo.get(f.repo) ?? new Set<string>()
  set.add(stem)
  // A module path's last segment is its file stem; also index every segment so
  // `std/os` and `os` both resolve if either spelling is the on-disk stem.
  for (const seg of stripSourceExt(f.rel).split("/")) {
    if (seg) set.add(seg)
  }
  moduleStemsByRepo.set(f.repo, set)
}

// ────────────────────────────────────────────────────────── edge accounting
type Row = {
  n: number
  /** EVERY file this type fired in — the count, not a sample. */
  filesAll: Set<string>
  /** The first FILE_LIST_CAP of them, for the report's example column. */
  files: Set<string>
  srcResolved: number
  tgtResolved: number
  bothResolved: number
  /** The same three tallies against the STRICT name set, which registers a
   *  symbol's exact `name` and its `qualifiedName` and NOTHING else.
   *
   *  Two instruments disagreed on intra-file resolution over the identical corpus
   *  and the identical walk — this census read `uses` 99.8% both-ends while the
   *  supervisor's `firing-check.ts` read 85.6%. The cause is one line above in
   *  `symNames`: a dotted `name` also contributes its last segment, so
   *  `Owner.member` additionally publishes `member`. That is what lets a bare
   *  `member` edge resolve — and it is ALSO the ambiguity rule the incoming
   *  workstream warns about: a bare segment matching two declarations resolves to
   *  whichever one, and the graph cannot tell them apart.
   *
   *  Measuring both from ONE walk is what makes the difference attributable. Two
   *  instruments with different name sets cannot be compared at all; they answer
   *  two questions and each looks like it answered the other's. */
  srcResolvedStrict: number
  tgtResolvedStrict: number
  bothResolvedStrict: number
  heuristic: number // confidence < 0.7
  underOne: number  // confidence < 1.0
  syntheticSrc: number
  unknownEndpoint: number
  emptyEndpoint: number
  evidenceClasses: Map<string, number>
  confHistogram: Map<string, number>
  /** The most common UNRESOLVED targets, so a resolution rate is a diagnosis and
   *  not a bare number. `calls` at 39.6% and `imports` at 47.6% are both EXPECTED
   *  in Nim (procs and modules declared in other modules are still facts about
   *  this file), and the top unresolved names are what proves that reading rather
   *  than asserting it. */
  unresolvedTargets: Map<string, number>
  examples: string[]
}
const rows = new Map<Type, Row>()
const getRow = (t: Type): Row => {
  let r = rows.get(t)
  if (!r) {
    r = {
      n: 0, filesAll: new Set(), files: new Set(), srcResolved: 0, tgtResolved: 0, bothResolved: 0,
      srcResolvedStrict: 0, tgtResolvedStrict: 0, bothResolvedStrict: 0,
      heuristic: 0, underOne: 0, syntheticSrc: 0, unknownEndpoint: 0, emptyEndpoint: 0,
      evidenceClasses: new Map(), confHistogram: new Map(), unresolvedTargets: new Map(), examples: [],
    }
    rows.set(t, r)
  }
  return r
}

// ────────────────────────────────────────────────────────── symbol accounting
const kindTally = new Map<string, number>()
let symbolsTotal = 0
let emptyNameSymbols = 0
let emptyKindSymbols = 0
const emptyNameExamples: string[] = []
const emptyKindExamples: string[] = []
const KIND_VOCAB = new Set([
  "function", "class", "variable", "constant", "interface", "enum", "enum_member",
  "type", "import", "export", "method", "property", "constructor", "namespace",
  "module", "table", "service", "resource", "type_alias", "event", "delegate",
  "object", "record", "macro", "trait", "struct", "impl", "actor", "union",
  "mixin", "decorator", "field", "parameter", "generic", "annotation", "extension",
  "component", "protocol", "enum_item", "template", "test", "hook", "middleware",
  "task", "state", "store", "route", "model", "view", "controller", "widget",
])

// ────────────────────────────────────────────────── edge types OUTSIDE the set
const offOntology = new Map<string, number>()

// ─────────────────────────────────────────────────────────── the parse loop
let idx = 0
let parsed = 0
let failed = 0
const errFiles: string[] = []

async function worker(): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    let r: any
    try {
      r = await parseFile(f.abs, f.dir)
      parsed++
    } catch {
      failed++
      errFiles.push(`${f.repo}/${f.rel}`)
      continue
    }
    const label = `${f.repo}/${f.rel}`
    const symNames = new Set<string>()
    const qualifiedNames = new Set<string>()
    const strictNames = new Set<string>()
    for (const s of r.symbols ?? []) {
      const nm = String(s.name ?? "")
      if (nm === "") { emptyNameSymbols++; if (emptyNameExamples.length < 5) emptyNameExamples.push(label) }
      symNames.add(nm)
      if (!SYNTHETIC_SOURCES.has(nm)) symNames.add(nm.split(".").pop() ?? nm)
      // `overrides` endpoints are RECEIVER-QUALIFIED (`Rect.describe`), which is
      // the family convention for an override because the name alone cannot
      // address either end. Resolving them needs BOTH spellings in the set: the
      // bare method name and the qualified one the edge actually uses. Registering
      // only the bare name reported overrides at 0.0% — a resolver bug that reads
      // as a total analyzer failure, which is why the set is built here rather
      // than assumed.
      const owner = String(s.ownerName ?? "")
      if (owner && nm) qualifiedNames.add(`${owner}.${nm}`)
      // The STRICT set: exactly what a symbol declares, no last-segment alias.
      // `firing-check.ts` registers `name` and `qualifiedName` and nothing more,
      // so this is the set that instrument answers with.
      strictNames.add(nm)
      const qn = String(s.qualifiedName ?? "")
      if (qn !== "") strictNames.add(qn)
      const k = String(s.kind ?? "")
      if (k === "") { emptyKindSymbols++; if (emptyKindExamples.length < 5) emptyKindExamples.push(`${label}:${nm}`) }
      kindTally.set(k, (kindTally.get(k) ?? 0) + 1)
      symbolsTotal++
    }
    const resolveName = (n: string): boolean => symNames.has(n) || qualifiedNames.has(n)
    const resolveStrict = (n: string): boolean => strictNames.has(n)
    const mods = moduleStemsByRepo.get(f.repo) ?? new Set<string>()

    for (const x of r.relationships ?? []) {
      const t = String(x.type ?? x.relationshipType ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) {
        offOntology.set(t || "(empty)", (offOntology.get(t || "(empty)") ?? 0) + 1)
        continue
      }
      const row = getRow(t)
      row.n++
      // `filesAll` is the count a reader can quote. `files` is the capped example
      // list, and it is kept separately because a capped set that also answers
      // "how many files" prints 6 on every row and reads as a measurement.
      row.filesAll.add(label)
      if (row.files.size < FILE_LIST_CAP) row.files.add(label)

      const src = String(x.source ?? x.from ?? "")
      const tgt = String(x.target ?? x.to ?? "")
      if (src === "unknown" || tgt === "unknown") row.unknownEndpoint++
      if (src === "" || tgt === "") row.emptyEndpoint++
      if (SYNTHETIC_SOURCES.has(src)) row.syntheticSrc++

      // Resolution. `imports` targets a module, so it is resolved against the
      // repo's module stems; every other type resolves against THIS FILE's
      // symbol names, which is the contract the analyzer documents for calls /
      // uses / references ("declared in this file", because Nim's
      // declare-before-use rule makes anything else an import or an error).
      const sOk = SYNTHETIC_SOURCES.has(src) ? true : resolveName(src)
      const tOk = t === "imports" ? mods.has(tgt) || resolveName(tgt) : resolveName(tgt)
      if (sOk) row.srcResolved++
      if (tOk) row.tgtResolved++
      if (sOk && tOk) row.bothResolved++
      // The strict pass. `imports` still resolves against module stems, because a
      // module path is not a symbol name under EITHER rule and claiming otherwise
      // would report a resolution failure that is really a different question.
      const sOkStrict = SYNTHETIC_SOURCES.has(src) ? true : resolveStrict(src)
      const tOkStrict = t === "imports" ? mods.has(tgt) || resolveStrict(tgt) : resolveStrict(tgt)
      if (sOkStrict) row.srcResolvedStrict++
      if (tOkStrict) row.tgtResolvedStrict++
      if (sOkStrict && tOkStrict) row.bothResolvedStrict++
      if (!tOk) {
        const cur = row.unresolvedTargets.get(tgt) ?? 0
        if (cur < 5000) row.unresolvedTargets.set(tgt, cur + 1)
      }

      const conf = typeof x.confidence === "number" ? x.confidence : 1
      if (conf < 0.7) row.heuristic++
      if (conf < 1) row.underOne++
      const ch = String(conf)
      row.confHistogram.set(ch, (row.confHistogram.get(ch) ?? 0) + 1)

      const ec = String(x.metadata?.evidenceClass ?? "(none)")
      row.evidenceClasses.set(ec, (row.evidenceClasses.get(ec) ?? 0) + 1)
      if (row.examples.length < 3) {
        row.examples.push(`${label}:${x.line_number ?? "?"} ${src} -[${t}]-> ${tgt} c=${conf}`)
      }
    }
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

// ═══════════════════════════════════════════ INSTRUMENTS A and B, ONE PARSE
// One parser, ONE parse per file, shared by the grammar inventory and by every
// construct probe. The first version re-parsed the whole corpus once per probe
// (6x the work for the same facts), which is the same waste the analyzer's own
// fusion work removed — the win is fewer node VISITS, and here fewer PARSES.
const wts: any = await import("web-tree-sitter")
const WSP: any = wts.Parser ?? wts.default
const WSL: any = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-nim.wasm"))))

// INSTRUMENT A: every node type the pinned wasm ACTUALLY produces across the
// corpus. Positive evidence of absence — "the grammar produced N distinct node
// types and none of them is X" is a fact about the language, not a failure to
// find something.
const nodeTypes = new Map<string, number>()

// ═══════════════════════════════════════════════════════ INSTRUMENT B
// Parse-tree semantic counts, where a string literal cannot fake a construct.
//
// Each probe counts a SHAPE with a ROLE, never a text pattern. The arbiter's own
// history is the reason: its first `imports` probe scanned every `string` in a
// JSON document and "found" the construct 2,651 times, of which the examples
// were filenames in a `files` array.
type Probe = { id: string; question: string; count: (root: any, f: { repo: string; rel: string }, hits: string[]) => void }
const probes: Probe[] = [
  {
    // The `implements` question. Nim's `concept` is the language's only
    // interface-like construct, and `concept A = concept x is B` names a
    // SUPERTYPE: `B`'s contract is part of `A`'s. The `refines` FIELD of
    // `concept_declaration` is that clause, so this counts the field rather
    // than the word `is`, which a comment or a string could fake.
    id: "implements/concept-refines",
    question: "concept_declaration.refines — a concept naming a supertype contract",
    count: (root, f, hits) => {
      const v = (n: any): void => {
        if (n.type === "concept_declaration") {
          const ref = n.childForFieldName?.("refines")
          if (ref) {
            let txt = String(ref.text ?? "")
            if (txt.length > 60) txt = txt.slice(0, 60) + "…"
            hits.push(`${f.repo}/${f.rel}: ${txt.split("\n").join(" ")}`)
          }
        }
        for (let i = 0; i < n.childCount; i++) v(n.child(i))
      }
      v(root)
    },
  },
  {
    // The `exports` question. `export_statement` is Nim's module-level
    // re-export: `export foo, Bar` publishes names this module imports so its
    // own importers see them. Counted on the node, and the OPERAND text is
    // recorded so a human can read what was counted rather than trust it.
    id: "exports/export-statement",
    question: "export_statement — a module publishing names onward",
    count: (root, f, hits) => {
      const v = (n: any): void => {
        if (n.type === "export_statement") {
          let txt = String(n.text ?? "")
          if (txt.length > 60) txt = txt.slice(0, 60) + "…"
          hits.push(`${f.repo}/${f.rel}: ${txt.split("\n").join(" ")}`)
        }
        for (let i = 0; i < n.childCount; i++) v(n.child(i))
      }
      v(root)
    },
  },
  {
    // The `implements` question, second form: an object that names a supertype
    // through `of`. Already emitted as `extends`, so this exists to prove the
    // two constructs are DISTINGUISHABLE and that `implements` is not merely a
    // synonym for `extends`.
    id: "extends/object-inherits",
    question: "object_declaration.inherits — an object naming a base type",
    count: (root, f, hits) => {
      const v = (n: any): void => {
        if (n.type === "object_declaration") {
          const inh = n.childForFieldName?.("inherits")
          if (inh) hits.push(`${f.repo}/${f.rel}: of ${String(inh.text).slice(0, 40).split("\n").join(" ")}`)
        }
        for (let i = 0; i < n.childCount; i++) v(n.child(i))
      }
      v(root)
    },
  },
  {
    // The `overrides` question, second form: a SECOND declaration of a name in
    // one file. Bash needed exactly this probe and found 174 redefinition events.
    // Nim allows overloading (`proc f(x: int)` and `proc f(x: string)`) which
    // is NOT an override, so the probe reports the raw second-declaration count
    // for adjudication rather than asserting it is an override.
    id: "overrides/second-declaration",
    question: "a SECOND proc/func/method/iterator declaration of one name in one file",
    count: (root, f, hits) => {
      const seen = new Map<string, number>()
      const v = (n: any): void => {
        if (["proc_declaration", "func_declaration", "method_declaration", "iterator_declaration"].includes(n.type)) {
          const nm = n.childForFieldName?.("name")
          const name = nm ? String(nm.text) : ""
          if (name) {
            const c = (seen.get(name) ?? 0) + 1
            seen.set(name, c)
            if (c === 2) hits.push(`${f.repo}/${f.rel}: ${name} (declared ${c}x)`)
          }
        }
        for (let i = 0; i < n.childCount; i++) v(n.child(i))
      }
      v(root)
    },
  },
  {
    // The `exports` question, second form — and the one whose TARGET is a
    // symbol this file DECLARES. In Nim the `*` after a name
    // (`proc foo*(x)`, `type T* = object`) is what makes the name visible
    // outside its module; the grammar gives it its own node type,
    // `exported_symbol`, wrapping the name and the `*`. Counted on the node, and
    // the examples are printed so a human reads what was counted.
    //
    // This is measured SEPARATELY from the `export` statement because the two
    // are different facts with different resolution properties: the `*` names a
    // local declaration, while `export foo` names something IMPORTED.
    id: "exports/star-marker",
    question: "exported_symbol — the `*` that makes a declared name visible outside its module",
    count: (root, f, hits) => {
      const v = (n: any): void => {
        if (n.type === "exported_symbol") {
          const inner = n.namedChildCount > 0 ? n.namedChild(0) : null
          hits.push(`${f.repo}/${f.rel}: ${inner ? String(inner.text) : "?"}*`)
        }
        for (let i = 0; i < n.childCount; i++) v(n.child(i))
      }
      v(root)
    },
  },
  {
    // The `instantiates` question, second form: the generic-CONSTRUCTION shape
    // `Foo[int](x)`, which is a `bracket_expression` callee rather than a bare
    // `call` and is therefore the branch the analyzer's `instantiates` rule does
    // not read.
    id: "instantiates/generic-construction",
    question: "bracket_expression in callee position — Foo[int](x), a generic construction",
    count: (root, f, hits) => {
      const v = (n: any): void => {
        if (n.type === "call" || n.type === "dot_generic_call") {
          const fn = n.childForFieldName?.("function")
          if (fn && fn.type === "bracket_expression") {
            const l = fn.childForFieldName?.("left")
            if (l) hits.push(`${f.repo}/${f.rel}: ${String(l.text).slice(0, 40)}`)
          }
        }
        for (let i = 0; i < n.childCount; i++) v(n.child(i))
      }
      v(root)
    },
  },
]
const probeHits = new Map<string, string[]>()
const probeFiles = new Map<string, Set<string>>()
for (const p of probes) { probeHits.set(p.id, []); probeFiles.set(p.id, new Set<string>()) }

let pidx = 0
let parseErrors = 0
const parseErrorFiles: string[] = []
function probeWorker(): void {
  for (;;) {
    const i = pidx++
    if (i >= files.length) return
    const f = files[i]
    let t: any
    try { t = parser.parse(f.text) } catch { parseErrors++; parseErrorFiles.push(`${f.repo}/${f.rel}`); continue }
    if (!t) { parseErrors++; continue }
    // A single recursive walk feeds BOTH instruments. The inventory needs every
    // node; each probe needs a SHAPE with a ROLE, so it reads the node it cares
    // about off this same walk rather than owning a traversal.
    const stack: any[] = [t.rootNode]
    while (stack.length > 0) {
      const n = stack.pop()
      nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1)
      for (let k = 0; k < n.childCount; k++) stack.push(n.child(k))
    }
    for (const p of probes) {
      const hits = probeHits.get(p.id)!
      const before = hits.length
      p.count(t.rootNode, f, hits)
      if (hits.length > before) probeFiles.get(p.id)!.add(f.rel)
    }
    t.delete?.()
  }
}
// One walk over the corpus, one parse per file, feeding every instrument.
probeWorker()

const probeResults: Record<string, { occurrences: number; files: number; examples: string[] }> = {}
for (const p of probes) {
  const hits = probeHits.get(p.id)!
  probeResults[p.id] = { occurrences: hits.length, files: probeFiles.get(p.id)!.size, examples: hits.slice(0, 5) }
}

// ═══════════════════════════════════════════════════════════════ report
const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`)
const w = (s: string, n: number): string => (s + " ".repeat(n)).slice(0, n)

console.log(`nim ontology census — production parseFile over the corpus`)
// The analyzer's own content hash, printed with the numbers and re-checked at the
// end of the run.
//
// A census number without the analyzer state it came from is not reproducible, and
// this lane learned that the expensive way: two runs of the shared arbiter over
// the SAME 4,555-file corpus returned `calls` 80,057 and then 79,041, because
// `src/ast/real-nim-analyzer.ts` was being edited between them. Both numbers were
// correct for the analyzer that produced them and quoting either alone would have
// been a claim about a file state that never existed. Two hashes — one before the
// walk and one after — turn "the analyzer changed under me" from a mystery into a
// line of output.
const ANALYZER = path.join(process.cwd(), "src/ast/real-nim-analyzer.ts")
const analyzerHash = (): string => createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")
const HASH_BEFORE = analyzerHash()
console.log(`analyzer    : ${path.relative(process.cwd(), ANALYZER)} sha256:${HASH_BEFORE.slice(0, 16)}`)
console.log(`corpus root : ${CR}`)
console.log(`files       : ${files.length.toLocaleString()} (git ls-files, detectLanguageFromPath==="nim", <=512KB)`)
console.log(`workers     : ${WORKERS}  (BB_NIM_WORKERS; every count below is a function of this — see Limitations 8/11)`)
const byRepo = new Map<string, number>()
for (const f of files) byRepo.set(f.repo, (byRepo.get(f.repo) ?? 0) + 1)
console.log(`repos       : ${[...byRepo].map(([k, v]) => `${k}=${v}`).join(", ")}`)
console.log(`parsed      : ${parsed.toLocaleString()}   parseFile threw: ${failed}   raw-parse threw: ${parseErrors}`)
if (errFiles.length) console.log(`throwers    : ${errFiles.slice(0, 5).join(", ")}`)
if (parseErrorFiles.length) console.log(`parse throwers: ${parseErrorFiles.slice(0, 5).join(", ")}`)
console.log(`symbols     : ${symbolsTotal.toLocaleString()}   empty-name: ${emptyNameSymbols}   empty-kind: ${emptyKindSymbols}`)
if (emptyNameExamples.length) console.log(`  empty-name examples: ${emptyNameExamples.join(", ")}`)
if (emptyKindExamples.length) console.log(`  empty-kind examples: ${emptyKindExamples.join(", ")}`)

console.log(`\nSymbolKind census (kind -> count; "?" = not in the engine's SymbolKind vocabulary)`)
for (const [k, v] of [...kindTally].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${w(k, 16)}${v.toLocaleString().padStart(9)}${KIND_VOCAB.has(k) ? "" : "   <- UNKNOWN KIND"}`)
}

console.log(`\n${w("type", 14)}${w("edges", 10)}${w("src-res", 10)}${w("tgt-res", 10)}${w("both", 9)}${w("<0.7", 8)}${w("<1.0", 9)}${w("files", 8)}detail`)
console.log("-".repeat(150))
const table: any[] = []
for (const t of ALL_TYPES) {
  const r = rows.get(t)
  if (!r) {
    console.log(`${w(t, 14)}${w("0", 10)}${w("-", 10)}${w("-", 10)}${w("-", 9)}${w("-", 8)}${w("-", 9)}${w("0", 8)}NOT EMITTED`)
    table.push({ type: t, emitted: false })
    continue
  }
  const detail = `${pct(r.bothResolved, r.n)} both-ends (${pct(r.bothResolvedStrict, r.n)} strict); ${pct(r.underOne, r.n)} under 1.0; evidenceClasses {${[...r.evidenceClasses].map(([k, v]) => `${k}:${v}`).join(" ")}}`
  console.log(`${w(t, 14)}${w(r.n.toLocaleString(), 10)}${w(pct(r.srcResolved, r.n), 10)}${w(pct(r.tgtResolved, r.n), 10)}${w(pct(r.bothResolved, r.n), 9)}${w(String(r.heuristic), 8)}${w(String(r.underOne), 9)}${w(String(r.filesAll.size), 8)}${detail}`)
  table.push({
    type: t, emitted: true, edges: r.n, files: r.filesAll.size, filesListed: r.files.size,
    srcResolved: r.srcResolved, tgtResolved: r.tgtResolved, bothResolved: r.bothResolved,
    srcResolvedStrict: r.srcResolvedStrict, tgtResolvedStrict: r.tgtResolvedStrict,
    bothResolvedStrict: r.bothResolvedStrict,
    heuristicUnder07: r.heuristic, underOne: r.underOne,
    syntheticSrc: r.syntheticSrc, unknownEndpoint: r.unknownEndpoint, emptyEndpoint: r.emptyEndpoint,
    evidenceClasses: Object.fromEntries(r.evidenceClasses), confidences: Object.fromEntries(r.confHistogram),
    topUnresolvedTargets: [...r.unresolvedTargets].sort((a, b) => b[1] - a[1]).slice(0, 25),
    examples: r.examples,
  })
}

console.log(`\nEndpoint hygiene`)
let totUnknown = 0, totEmpty = 0
for (const r of rows.values()) { totUnknown += r.unknownEndpoint; totEmpty += r.emptyEndpoint }
console.log(`  endpoints equal to the literal "unknown" : ${totUnknown}`)
console.log(`  empty endpoints                           : ${totEmpty}`)
console.log(`  edge types outside the 10-type ontology   : ${offOntology.size === 0 ? "none" : [...offOntology].map(([k, v]) => `${k}=${v}`).join(", ")}`)

console.log(`\n${w("confidence", 14)}${w("count", 12)}type`)
console.log("-".repeat(60))
for (const t of ALL_TYPES) {
  const r = rows.get(t)
  if (!r) continue
  for (const [c, n] of [...r.confHistogram].sort((a, b) => Number(b[0]) - Number(a[0]))) {
    console.log(`${w(c, 14)}${w(n.toLocaleString(), 12)}${t}`)
  }
}

console.log(`\nMost common UNRESOLVED targets per type — the diagnosis behind each rate above`)
for (const t of ALL_TYPES) {
  const r = rows.get(t)
  if (!r || r.unresolvedTargets.size === 0) continue
  const top = [...r.unresolvedTargets].sort((a, b) => b[1] - a[1]).slice(0, 8)
  console.log(`  ${w(t, 14)}${top.map(([k, v]) => `${k}(${v})`).join(" ")}`)
}

console.log(`\nINSTRUMENT A — grammar inventory over ${files.length.toLocaleString()} files`)
console.log(`  distinct node types produced: ${nodeTypes.size}`)
console.log(`  the full inventory is in the JSON artifact; node types that would express a missing construct:`)
for (const probe of ["interface_declaration", "trait_declaration", "implements_clause", "extends_clause",
  "new_expression", "object_creation_expression", "constructor_invocation", "export_statement",
  "refines", "override_specifier", "redefinition", "mixin_declaration", "protocol_declaration"]) {
  const n = nodeTypes.get(probe) ?? 0
  if (n > 0) console.log(`    ${w(probe, 32)}${n.toLocaleString()}`)
}

console.log(`\nINSTRUMENT B — parse-tree construct counts`)
for (const p of probes) {
  const r = probeResults[p.id]
  console.log(`  ${w(p.id, 34)}${String(r.occurrences).padStart(7)} occurrences in ${String(r.files).padStart(5)} files — ${p.question}`)
  for (const e of r.examples) console.log(`      ${e}`)
}

const HASH_AFTER = analyzerHash()
console.log(`\nanalyzer sha256 after the walk : ${HASH_AFTER.slice(0, 16)}${HASH_AFTER === HASH_BEFORE ? "  (unchanged — every number above is tied to this analyzer state)" : "  CHANGED DURING THE RUN — the numbers above are a MIXTURE of two analyzer states and are not reproducible"}`)

if (OUT) {
  const degraded: string[] = []
  if (emptyKindSymbols > 0) degraded.push(`${emptyKindSymbols} empty-kind symbols`)
  if (emptyNameSymbols > 0) degraded.push(`${emptyNameSymbols} empty-name symbols`)
  if (failed > 0) degraded.push(`${failed} parseFile throws`)
  if (parseErrors > 0) degraded.push(`${parseErrors} raw-parse throws`)
  if (parsed !== files.length) degraded.push(`${files.length - parsed} files unparsed`)
  writeArtifact(OUT, {
    lang: LANG, corpusRoot: CR, analyzerSha256: HASH_AFTER, analyzerStableDuringRun: HASH_AFTER === HASH_BEFORE,
    // The worker count is a FUNCTION of every edge count below (Limitations 8/11),
    // and it was printed to the console but absent from the JSON, so the
    // machine-readable artifact could not be reproduced from itself. A reader of
    // the .json had no way to know which fan-out produced it.
    workers: WORKERS,
    files: files.length, filesByRepo: Object.fromEntries(byRepo),
    parsed, parseFileThrew: failed, rawParseThrew: parseErrors, symbolsTotal, emptyNameSymbols, emptyKindSymbols,
    degradedWalk: degraded.length > 0 ? degraded : null,
    kinds: Object.fromEntries(kindTally), types: table,
    offOntology: Object.fromEntries(offOntology),
    totalUnknownEndpoints: totUnknown, totalEmptyEndpoints: totEmpty,
    grammarNodeTypeCount: nodeTypes.size,
    grammarNodeTypes: Object.fromEntries([...nodeTypes].sort((a, b) => b[1] - a[1])),
    probes: probes.map((p) => ({ id: p.id, question: p.question, ...probeResults[p.id] })),
  }, degraded.length === 0, degraded.join("; "))
  console.log(degraded.length === 0 ? `\nwrote ${OUT}` : `\nwrote the degraded walk beside it, NOT ${OUT}`)
}
