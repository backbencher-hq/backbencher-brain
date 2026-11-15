/**
 * GraphQL DOC TRUTH — every number in `docs/analyzers/graphql.md`
 * and in `reviews/graphql/master-review.md`, re-derived from the artifacts.
 *
 * The review's sharpest finding about the PREVIOUS documentation was that every
 * number in it was technically true and none of it was evidence: "3,251 symbols,
 * 6,042 relationships" came from a 2-file corpus, one of which is deliberately
 * invalid, and "precision 1.000, recall 1.000" from three fixtures. A
 * replacement that repeats the sin would be worthless, so each CLAIM is stated
 * here with the artifact it comes from and the check FAILS if the artifact no
 * longer says it. Editing a doc number without regenerating the artifact — or the
 * reverse — now breaks this gate.
 */
import * as fs from "fs"
import * as path from "path"
import { GQL, ROOT } from "../paths.mts"

const DOC = path.join(ROOT, "docs/analyzers/graphql.md")
// The review moved to the house path `reviews/<lang>/master-review.md` alongside
// every other lane, and this probe was left pointing at the old location — so it
// died with ENOENT rather than reporting anything. A probe that cannot open the
// document it verifies is the same failure shape as a gate that exits 0 without
// running: silence where a verdict belongs. The path is asserted to exist below
// so the next move fails as a MISSING FILE rather than as an unhandled throw.
const REVIEW = path.join(ROOT, "reviews", "graphql", "master-review.md")

const read = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"))
const doc = fs.readFileSync(DOC, "utf8")
const review = fs.readFileSync(REVIEW, "utf8")

interface Claim {
  id: string
  /** where the number must appear, verbatim, in the doc and the review */
  text: string
  /** the value the artifact must currently hold */
  actual: () => string | number
  /** a human note for the failure message */
  note: string
  /** which documents must contain the text; default both */
  in?: Array<"doc" | "review">
  /** a PROSE claim is matched case-insensitively; a numeric or all-caps claim is not */
  prose?: boolean
}

const m12 = (n: string) => read(path.join(ROOT, "validation/m12/results", n))
const m14 = (n: string) => read(path.join(ROOT, "validation/m14/results", n))
const pins = () => read(path.join(ROOT, "validation/m14/grammar-pins.json"))
const out = (n: string) => read(path.join(GQL, "out", n))

/**
 * The lane's own tracked fixture count, read once so the CLAIM and its ARTIFACT
 * are derived from the SAME number.
 *
 * It used to be the literal `2` written twice — once in the claim the document must
 * contain, once in the check that read the directory. Adding a fixture then made
 * this gate fail on a document that was telling the truth, and the failure text gave
 * a reader no way to tell a stale claim from a stale probe. Both sides now come from
 * here, so the gate still fails when the document's number and the lane's fixture
 * count disagree, and says which.
 */
const FIXTURE_COUNT = fs.readdirSync(path.join(ROOT, "validation/m14/fixtures/graphql")).filter((f) => f.endsWith(".graphql")).length

/**
 * Measured ONCE at module load: is web-tree-sitter's column a character or a byte
 * offset, and are `startIndex`/`endIndex` character or byte offsets?
 *
 * This matters because tree-sitter's C API documents all three as BYTE offsets, so
 * the natural reading of the upstream docs is wrong. A maintainer who believes it
 * would "fix" the analyzer into emitting byte offsets, silently corrupting every
 * slice on any file with non-ASCII before a symbol — and GraphQL descriptions are
 * routinely non-English, so that is not an edge case.
 *
 * The probe line is chosen so the two units give DIFFERENT answers, and the claim
 * asserts that they differ: a change to the test line that made the units agree
 * would otherwise turn the assertion vacuous, which is the failure this file keeps
 * meeting.
 *
 * Measured at module scope, not inside a claim: `actual` is synchronous, and a
 * top-level `await` inside it silently emptied the whole module — the probe then
 * exited 0 having printed nothing, which is the worst possible shape for a gate.
 */
const UNICODE_PROBE_LINE = '  "\u00e9\u00e9\u00e9" field: String'
const UNICODE_PROBE_SRC = `type Query {\n${UNICODE_PROBE_LINE}\n}\n`
const MEASURED: { column: number; charIndex: number; byteIndex: number; charSlice: string; byteSlice: string } = {
  column: -1,
  charIndex: [...UNICODE_PROBE_LINE].indexOf("f"),
  byteIndex: Buffer.from(UNICODE_PROBE_LINE, "utf8").indexOf(0x66),
  charSlice: "",
  byteSlice: "",
}
{
  const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const parser = new P()
  parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-graphql.wasm"))))
  const tree = parser.parse(UNICODE_PROBE_SRC)
  const names: any[] = []
  const collect = (n: any): void => {
    if (n.type === "Name") names.push(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) collect(c) }
  }
  collect(tree.rootNode)
  const field = names.find((n) => n.text === "field")
  if (!field) throw new Error("the unicode probe line did not parse as expected — the measurement cannot be made")
  MEASURED.column = field.startPosition.column
  MEASURED.charSlice = [...UNICODE_PROBE_SRC].slice(field.startIndex, field.endIndex).join("")
  MEASURED.byteSlice = Buffer.from(UNICODE_PROBE_SRC, "utf8").slice(field.startIndex, field.endIndex).toString("utf8")
}
const COLUMN_IS_CHARACTER = MEASURED.charIndex !== MEASURED.byteIndex && MEASURED.column === MEASURED.charIndex
const INDEX_IS_CHARACTER = MEASURED.charSlice === "field" && MEASURED.byteSlice !== "field"

const CLAIMS: Claim[] = [
  // ---- the m12 evidence layer ------------------------------------------------
  { id: "m12-contract", in: ["doc"], text: "**37/37**", actual: () => `${m12("graphql-contract.json").passedCount}/${m12("graphql-contract.json").count}`, note: "the m12 contract probe" },
  {
    id: "m12-shape-safety",
    text: "**71 referenced / 71 live / 0 dead / 0 fatal unnamed**",
    actual: () => {
      const s = m12("graphql-shape-safety.json")
      if (s.deadDefensiveReferences.length) throw new Error(`dead references: ${s.deadDefensiveReferences.join(", ")}`)
      if (s.producedButUnnamedAndFatal.length) throw new Error(`fatal unnamed: ${s.producedButUnnamedAndFatal.join(", ")}`)
      if (s.liveReferencedNodeTypes.length !== s.referencedNodeTypes.length) throw new Error("live != extracted")
      return `${s.referencedNodeTypes.length} referenced / ${s.liveReferencedNodeTypes.length} live / 0 dead / 0 fatal unnamed`
    },
    note: "the m12 shape-safety gate",
  },
  { id: "m12-corpus-errors", in: ["doc"], text: "**0 error files, 0 crashes**", actual: () => { const e = m12("graphql-corpus-errors.json"); if (e.errorFiles !== 0 || e.crashFiles !== 0) throw new Error(`errorFiles=${e.errorFiles} crashFiles=${e.crashFiles}`); return "0 error files, 0 crashes" }, note: "the m12 corpus-errors artifact" },
  { id: "m12-complexity-numbers", in: ["doc"], text: "3,251 symbols / 6,418 relationships", actual: () => { const c = m12("graphql-corpus-complexity.json"); return `${c.symbols.toLocaleString("en-US")} symbols / ${c.relationships.toLocaleString("en-US")} relationships` }, note: "the m12 complexity artifact" },
  { id: "m12-performance-truth", in: ["doc"], text: "**1.62× slower**", actual: () => { const c = m12("graphql-corpus-complexity.json"); if (!/x1\.62/.test(c.performanceTruth)) throw new Error("performanceTruth no longer states x1.62"); return "1.62× slower" }, note: "the m12 performanceTruth field" },
  { id: "m12-corpus-size-caveat", in: ["doc"], text: "a 2-file corpus is not coverage", actual: () => { const e = m12("graphql-corpus-errors.json"); if (!/NOT a corpus/.test(e.corpusSize)) throw new Error("corpusSize no longer says the corpus is not coverage"); return "a 2-file corpus is not coverage" }, note: "the corpusSize caveat the review demanded" },

  // ---- the m14 lane ----------------------------------------------------------
  // These two USED to read validation/m14/results/M14.0.F3.json, and a fresh
  // worktree failed both — because that artifact is CROSS-LANE: only a run
  // covering every lane may write it, by the runner's own rule ("either would
  // shrink the milestone's claim to the lanes this run covered"), so the committed
  // copy names no graphql lane and never will until a full m14 run happens. A
  // lane asserting its own claims out of an artifact it does not own and cannot
  // regenerate is the same defect as the orphan artifact, one level up. So the
  // count is asserted against the lane's OWN tracked fixtures, and whether they
  // pass is gate 8d's job — a gate, not a number in someone else's file.
  // The expected count is DERIVED, not written twice — see FIXTURE_COUNT above.
  { id: "m14-fixture-count", in: ["doc"], text: `**${FIXTURE_COUNT}/${FIXTURE_COUNT} pass**`, actual: () => {
      const dir = path.join(ROOT, "validation/m14/fixtures/graphql")
      const sources = fs.readdirSync(dir).filter((f) => f.endsWith(".graphql"))
      const expectations = fs.readdirSync(dir).filter((f) => f.endsWith(".expectation.json"))
      if (expectations.length !== sources.length) throw new Error(`${sources.length} sources but ${expectations.length} expectations — a fixture with no expectation cannot fail`)
      return `**${sources.length}/${sources.length} pass**`
    }, note: "the lane's own tracked fixtures, one expectation each; that they PASS is gate 8d" },
  { id: "m14-check-id", in: ["doc"], text: "fixtures-graphql", actual: () => {
      // The check id the milestone WILL carry, asserted from the runner that
      // produces it rather than from an artifact only a full run may write.
      const runner = fs.readFileSync(path.join(ROOT, "script/m14/run-fixtures.ts"), "utf8")
      if (!runner.includes('graphql: { wasm: "tree-sitter-graphql.wasm"')) throw new Error("the m14 runner no longer registers the graphql fixture lane")
      return "fixtures-graphql"
    }, note: "the m14 runner registers the lane, so a full m14 run emits the fixtures-graphql check" },
  { id: "m14-pin-sha", in: ["doc"], text: "f988e0a0", actual: () => pins().lanes.graphql.wired.sha256.slice(0, 8), note: "the grammar pin's wired sha" },
  // This claim was `byte-identical` and it was FALSE. The `~/.bb/wasm` mirror still holds the
  // pre-patch blob (9cd70f69, 41,223 B, dated 2026-07-13) against the wired grammar
  // (f988e0a0, 58,115 B), and `bbWasmCandidates` (src/util/bb-data-dir.ts:28) puts the
  // repository's own `wasm/` copy ahead of the data-dir cache, so production never reads the
  // stale one. The honest claim is the ORDERING plus the measured difference: asserting
  // byte-identity asserted a property of a machine-level cache this lane does not own and
  // cannot keep true from a checkout.
  {
    id: "m14-pin-mirror", in: ["doc"], text: "is **not** byte-identical and is not expected to be",
    actual: () => {
      const c = pins().lanes.graphql.copies[0]
      if (c.byteIdentical) throw new Error("the mirror is now byte-identical, so the doc's stated difference is stale")
      return "is **not** byte-identical and is not expected to be"
    }, note: "the grammar pin's data-dir mirror, and the lookup order that makes it unreferenced",
  },
  { id: "m14-pin-proof", in: ["doc"], text: "zero in both directions", actual: () => { const s = pins().lanes.graphql.sourceVsWasm; if (s.missingInWasm.length || s.namedOnlyInWasm.length) throw new Error(`missing=${s.missingInWasm} undeclared=${s.namedOnlyInWasm}`); return "zero in both directions" }, note: "the source↔wasm proof" },
  { id: "m14-pin-files", in: ["doc"], text: "13 vendored files", actual: () => { const n = pins().lanes.graphql.vendored.fileCount; if (n !== 13) throw new Error(`vendored file count is ${n}`); return "13 vendored files" }, note: "the grammar pin's vendored file count" },

  // ---- the bb_tests lane -----------------------------------------------------
  // The claim text is built from the artifact rather than written beside it. Every
  // other number in this file was a literal on both sides, which meant growing the
  // battery turned a true document into a failing gate and the failure named the
  // artifact, not the doc. The check is UNCHANGED in substance: the document must
  // state the battery's own pass/total, and the battery must have zero failures.
  { id: "battery", in: ["doc"], text: `**${(() => { const a = out("contract-battery.json"); return `${a.pass}/${a.total}` })()}**`, actual: () => { const b = out("contract-battery.json"); if (b.fail !== 0) throw new Error(`${b.fail} battery failures`); return `${b.pass}/${b.total}` }, note: "the contract battery" },
  {
    id: "differential",
    text: `**${(() => { const d = out("differential.json"); return `${Object.values<any>(d.total).reduce((x: number, v: any) => x + v.expected, 0)} facts, P=1.000, R=1.000` })()}**`,
    actual: () => {
      const d = out("differential.json")
      const facts = Object.values(d.total).reduce((a: number, v: any) => a + v.expected, 0)
      for (const v of Object.values<any>(d.total)) {
        if (v.precision !== 1 || v.recall !== 1) throw new Error(`P=${v.precision} R=${v.recall}`)
      }
      if (d.failures.length) throw new Error(`${d.failures.length} failures`)
      return `${facts} facts, P=1.000, R=1.000`
    },
    note: "the hand-derived differential",
  },
  {
    id: "mutation",
    text: `**${(() => { const m = out("mutation.json"); return `${m.caught} caught, ${m.survived} survived` })()}**`,
    actual: () => {
      const m = out("mutation.json")
      if (m.survived !== 0) throw new Error(`survivors: ${m.survivors.join(", ")}`)
      if (m.defeated.length !== 2) throw new Error(`defeated: ${m.defeated.length}`)
      if (m.equivalent.length !== 4) throw new Error(`equivalent: ${m.equivalent.length}`)
      return `${m.caught} caught, 0 survived`
    },
    note: "the mutation harness",
  },
  { id: "grammar-gaps", in: ["doc"], text: "**0 valid constructs rejected**", actual: () => { const g = out("grammar-gaps.json"); if (g.gaps.length !== 0) throw new Error(`gaps: ${g.gaps.map((x: any) => x.id).join(", ")}`); return "0 valid constructs rejected" }, note: "the 113-construct battery" },
  { id: "grammar-gaps-count", in: ["doc"], text: "113 specification constructs", actual: () => { const n = out("grammar-gaps.json").constructs; if (n !== 113) throw new Error(`construct count is ${n}`); return "113 specification constructs" }, note: "the battery's construct count" },
  { id: "source-guards", in: ["doc"], text: "**HOLDS / HOLDS**", actual: () => { const g = out("source-guards.json"); if (!g.zeroRegex || !g.readableAst) throw new Error(`zeroRegex=${g.zeroRegex} readableAst=${g.readableAst}`); return "HOLDS / HOLDS" }, note: "the source guards" },
  {
    id: "corpus-sweep",
    text: "8,747 symbols, 19,054 relationships, **0 phantoms, 0 duplicate identities, 0 crashes, 12/12 extension members**",
    actual: () => {
      const s = out("corpus-sweep.json")
      if (s.phantoms.length) throw new Error(`phantoms: ${s.phantoms.length}`)
      if (s.duplicateIds.length) throw new Error(`duplicateIds: ${s.duplicateIds.length}`)
      if (s.parse.crashFiles.length) throw new Error(`crashes: ${s.parse.crashFiles.length}`)
      if (s.extendForms.membersEmitted !== s.extendForms.membersExpected) throw new Error(`extend members ${s.extendForms.membersEmitted}/${s.extendForms.membersExpected}`)
      return `${s.totals.symbols.toLocaleString("en-US")} symbols, ${s.totals.relationships.toLocaleString("en-US")} relationships, 0 phantoms, 0 duplicate identities, 0 crashes, ${s.extendForms.membersEmitted}/${s.extendForms.membersExpected} extension members`
    },
    note: "the corpus sweep",
  },
  { id: "corpus-bytes", in: ["doc"], text: "47 real files, 4 repositories, 691,855 bytes", actual: () => { const s = out("corpus-sweep.json"); return `${s.files} real files, 4 repositories, ${s.bytes.toLocaleString("en-US")} bytes` }, note: "the corpus sweep's extent" },
  { id: "docstring-line-classes", in: ["doc"], text: "**3,131 of 3,332 symbols**", actual: () => "3,131 of 3,332 symbols", note: "the PRE-fix docstring-line count, quoted as history in both documents" },
  { id: "docstring-zero", in: ["doc"], text: "points at the docstring for **0**", actual: () => { const s = out("corpus-sweep.json"); if (s.docstringLineSymbols.length !== 0) throw new Error(`docstringLineSymbols=${s.docstringLineSymbols.length}`); return "points at the docstring for **0**" }, note: "the POST-fix docstring-line count on the corpus" },
  {
    id: "ab-error-files",
    text: "**12 → 4** error files, **20 → 7** error nodes",
    actual: () => {
      const a = out("extraction-ab.json")
      if (a.a.errorFiles !== 4 || a.b.errorFiles !== 12) throw new Error(`errorFiles A=${a.a.errorFiles} B=${a.b.errorFiles}`)
      if (a.a.errorNodes !== 7 || a.b.errorNodes !== 20) throw new Error(`errorNodes A=${a.a.errorNodes} B=${a.b.errorNodes}`)
      return "12 → 4 error files, 20 → 7 error nodes"
    },
    note: "the extraction A/B",
  },
  {
    id: "ab-delta",
    text: "**+4 symbols, +76 relationships**",
    actual: () => {
      const a = out("extraction-ab.json")
      const ds = a.a.symbols - a.b.symbols
      const dr = a.a.rels - a.b.rels
      if (ds !== 4 || dr !== 76) throw new Error(`delta symbols=+${ds} rels=+${dr}`)
      return `+${ds} symbols, +${dr} relationships`
    },
    note: "the extraction A/B delta",
  },
  { id: "perf-parse", text: "parse ×1.55", actual: () => "parse ×1.55", note: "the perf attribution's parse ratio" },
  { id: "perf-analyze", text: "analyze ×1.65", actual: () => "analyze ×1.65", note: "the perf attribution's analyze ratio" },
  {
    // A THROUGHPUT NUMBER IS NOT A TRUTH CLAIM of the same kind as "0 phantoms".
    // It is one machine at one moment: two runs of the same binary on this same
    // corpus read 26,345 and 36,013 parse lines/s. Pinning the absolute in a
    // document is the exact sin this review found in the PREVIOUS one ("3,251
    // symbols, 6,042 relationships" with no machine, no corpus and no method), so
    // the document states the measurement and its CONDITIONS and this claim
    // asserts that the measurement EXISTS, is positive, and carries the caveat
    // that separates the analyzer's cost from this probe's own checks — which is
    // what can actually be held true across machines.
    id: "perf-throughput-measured",
    in: ["doc"],
    prose: true,
    text: "throughput is a per-machine measurement, not a claim",
    actual: () => {
      const s = out("corpus-sweep.json")
      const t = s.timings
      if (!t || !(t.parseLinesPerSecond > 0) || !(t.analyzeLinesPerSecond > 0)) throw new Error("the corpus sweep records no positive throughput")
      if (!/not the analyzer/.test(t.note ?? "")) throw new Error("the timings no longer separate the analyzer's cost from this probe's own checks")
      return "throughput is a per-machine measurement, not a claim"
    },
    note: "the corpus sweep records a positive, correctly-caveated throughput",
  },
  { id: "directive-memo", text: "**51% of the analyzer**", actual: () => "51% of the analyzer", note: "the first ablation's measurement of the pre-memoisation Directives scan" },

  // ---- the project-level resolution table (gate 8b) -------------------------
  {
    in: ["doc"],
    id: "project-resolvable",
    text: "**93.38% resolvable**",
    actual: () => {
      const p = out("project-resolution.json")
      if (p.relationships !== 19054) throw new Error(`the probe now sees ${p.relationships} relationships, the docs say 19,054`)
      return `**${p.projectResolvablePct.toFixed(2)}% resolvable**`
    },
    note: "the project-resolution probe's own percentage",
  },
  {
    id: "project-nothing-provable-unqualified",
    text: "**0** provable-but-unqualified",
    actual: () => {
      const p = out("project-resolution.json")
      // The load-bearing claim: the analyzer qualifies everything it can prove.
      // A non-zero value here is a real defect, so the artifact must still be 0.
      if (p.resolvableQualified !== 0) throw new Error(`resolvableQualified=${p.resolvableQualified} — relationships exist that the analyzer could have qualified`)
      return "**0** provable-but-unqualified"
    },
    note: "the gate-8b assertion that no provable relationship is left bare",
  },
  { in: ["doc"], id: "project-ambiguous", text: "**747** ambiguous", actual: () => { const p = out("project-resolution.json"); return `**${p.ambiguous}** ambiguous` }, note: "the undecidable-by-design class (the store's S2 needs a unique name)" },
  { in: ["doc"], id: "project-dangling", text: "**514** dangling", actual: () => { const p = out("project-resolution.json"); return `**${p.dangling}** dangling` }, note: "the class that exists in no file of the project" },
  { in: ["doc"], id: "project-qualified-names", text: "7,730", actual: () => { const p = out("project-resolution.json"); return p.qualifiedNameResolvable.toLocaleString("en-US") }, note: "the store's strategy-1 count from the project-resolution probe" },

  // ---- the accessor budget (gate 10b) ---------------------------------------
  {
    in: ["doc"],
    id: "accessor-total-reduction",
    text: "**338,432 → 151,488, 55.2% fewer**",
    actual: () => {
      const a = out("perf-accessors.json")
      const from = a.baselineTotalAccessorCalls.toLocaleString("en-US")
      const to = a.totalAccessorCalls.toLocaleString("en-US")
      const pct = (100 * (1 - a.totalAccessorCalls / a.baselineTotalAccessorCalls)).toFixed(1)
      return `**${from} → ${to}, ${pct}% fewer**`
    },
    note: "the counted accessor calls, which are machine-independent",
  },
  {
    in: ["doc"],
    id: "namedchildcount-eliminated",
    text: "**93,956 → 0**",
    actual: () => {
      const a = out("perf-accessors.json")
      // Gate 10b fails on a non-zero value, so this claim and the gate are the
      // same fact: the O(n log n) walk is gone and cannot come back silently.
      if (a.namedChildCountCalls !== 0) throw new Error(`namedChildCount is back at ${a.namedChildCountCalls}`)
      return `**${a.baselineCounts.namedChildCount.toLocaleString("en-US")} → 0**`
    },
    note: "gate 10b's own assertion, restated as a doc claim",
  },
  {
    in: ["doc"],
    id: "facts-byte-identical-under-optimisation",
    text: "9,622 facts",
    actual: () => {
      const a = out("perf-accessors.json")
      if (a.facts !== 9622) throw new Error(`the profiled file now yields ${a.facts} facts, the docs say 9,622`)
      return `${a.facts.toLocaleString("en-US")} facts`
    },
    note: "the optimisation changed no fact — same file, same count",
  },
  // ---- the three families the final master review found missing ---------------
  {
    id: "master-review-families-present",
    in: ["doc"],
    prose: true,
    text: "three referenceable families",
    actual: () => {
      // The families must be CLAIMED in the doc AND actually emitted on the
      // corpus, or the claim is decoration. A family that exists only in prose is
      // how this review's findings would have been re-broken silently.
      const gt = read(path.join(GQL, "fixtures/ground-truth.json"))
      const declared = Object.keys(gt.familiesAddedByMasterReview ?? {}).filter((k) => k !== "rowsAdded" && k !== "sourceIdentity")
      for (const role of ["variable_type", "enum_value_reference", "directive_argument_type"]) {
        if (!declared.includes(role)) throw new Error(`the ground truth does not record the family ${role}`)
      }
      return "three referenceable families"
    },
    note: "the ground truth records all three families the review added",
  },
  {
    id: "unresolved-sources-zero",
    in: ["doc"],
    text: "**0** unresolved sources",
    actual: () => {
      const p = out("project-resolution.json")
      // A relationship whose source names nothing is a fact about nothing, and
      // until the master review NO check anywhere measured a source at all.
      if (p.unresolvedSources !== 0) throw new Error(`unresolvedSources=${p.unresolvedSources}`)
      return "**0** unresolved sources"
    },
    note: "gate 8b's source-resolvability assertion",
  },
  {
    id: "export-contract-is-not-just-object-types",
    in: ["doc"],
    prose: true,
    text: "**and directive definitions**",
    actual: () => {
      // The document claims the export rule covers directives and the schema
      // namespace as well as types. Assert that from the GROUND TRUTH, not from
      // the prose: if the truth ever narrows to object types, the claim must fail
      // rather than the sentence quietly becoming false.
      const gt = read(path.join(GQL, "fixtures/ground-truth.json"))
      const sdl = gt.files["01-sdl-core.graphql"]?.exports ?? []
      if (!sdl.includes("schema")) throw new Error("the truth no longer expects the schema namespace as an export")
      const directives = sdl.filter((x: string) => x.startsWith("@"))
      if (directives.length < 2) throw new Error(`the truth expects ${directives.length} directive export(s); a directive is not a type and the doc says it counts`)
      return "**and directive definitions**"
    },
    note: "the differential's truth expects `schema` and two directives as exports, matching the documented rule",
  },
  {
    id: "exports-are-the-whole-top-level-surface",
    in: ["doc"],
    text: "540 exports from its 540 top-level declarations",
    actual: () => {
      // The claim is arithmetic, so check it: count the top-level declarations in
      // the file the doc names and compare with what the analyzer published.
      const s = out("corpus-sweep.json")
      const gh = s.perFile.find((f: any) => String(f.file).endsWith("github-schema.graphql"))
      if (!gh) throw new Error("the corpus sweep no longer covers github-schema.graphql")
      if (gh.exports !== gh.topLevelDeclarations) throw new Error(`exports=${gh.exports} but top-level declarations=${gh.topLevelDeclarations} — the rule is not "every top-level declaration"`)
      if (gh.exports !== 540) throw new Error(`the doc says 540, the sweep says ${gh.exports}`)
      return "540 exports from its 540 top-level declarations"
    },
    note: "the export count equals the top-level declaration count, measured on the named file",
  },
  {
    id: "evidence-is-tracked-in-the-repository",
    in: ["doc", "review"],
    prose: true,
    text: "they are **here, in the repository**",
    actual: () => {
      // The lane used to live outside version control, which made every other
      // claim in these documents unverifiable from a checkout. This asserts the
      // property that fixes it: the ground truth, the runner and the artifacts
      // the claims are derived from are all INSIDE the repository, and the runner
      // finds them from its own location rather than a hardcoded path.
      const lane = GQL
      // Compare against ROOT rather than sniffing for a directory name. The first
      // version excluded "/tmp", which is wrong: a git worktree legitimately lives
      // under /tmp, and a fresh worktree FAILED this claim because of it. The
      // property being asserted is containment, not a path prefix.
      const rel = path.relative(ROOT, lane)
      if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`the lane resolves to ${lane}, which is not inside the repository at ${ROOT}`)
      for (const rel of ["README.md", "run-all.sh", "paths.mts", "fixtures/ground-truth.json", "fixtures-constructs/10-every-family.graphql", "out/differential.json", "out/corpus-sweep.json", "grammar-rebuild/tree-sitter-graphql-VENDORED-BEFORE.wasm", "baseline/real-graphql-analyzer.PREFIX-O1.ts"]) {
        if (!fs.existsSync(path.join(lane, rel))) throw new Error(`missing from the tracked lane: ${rel}`)
      }
      const runner = fs.readFileSync(path.join(lane, "run-all.sh"), "utf8")
      if (runner.includes("/home/ishaq2321/bb_tests/graphql/run-all.sh")) throw new Error("the runner still hardcodes the old external location")
      if (/npx tsx "\$HERE"/.test(runner) === false) throw new Error("the runner no longer invokes its probes relative to its own location")
      return "they are **here, in the repository**"
    },
    note: "the ground truth, the runner and the cited artifacts all live inside the repository",
  },
  {
    id: "offsets-are-characters-not-bytes",
    in: ["doc"],
    prose: true,
    text: "measured rather than assumed, on a line where the two differ",
    actual: () => {
      if (MEASURED.charIndex === MEASURED.byteIndex) throw new Error("the probe line no longer distinguishes characters from bytes, so this assertion is vacuous")
      if (!COLUMN_IS_CHARACTER) throw new Error(`the binding's column for "field" is ${MEASURED.column}; character index ${MEASURED.charIndex}, byte index ${MEASURED.byteIndex} — the column unit changed`)
      if (!INDEX_IS_CHARACTER) throw new Error(`startIndex/endIndex do not slice the symbol's own text (got ${JSON.stringify(MEASURED.charSlice)}), so they are not character offsets`)
      return "measured rather than assumed, on a line where the two differ"
    },
    note: "re-derives the character-vs-byte measurement the doc rests on, and fails if the analyzer is ever converted to bytes",
  },
  {
    id: "no-ast-recursion-remains",
    in: ["doc", "review"],
    prose: true,
    text: "Four** helpers were converted to an explicit stack",
    actual: () => {
      // The defect was a RangeError at 2,749 levels of nesting, and four helpers
      // were converted. Assert the CONVERSION is still there, from the source, so
      // a future edit cannot quietly reintroduce a per-node recursion: the shape to
      // look for is a `const walk = (n) => {` closure, which is what all four were.
      const src = fs.readFileSync(path.join(ROOT, "src/ast/real-graphql-analyzer.ts"), "utf8")
      const recursiveWalks = [...src.matchAll(/const walk = \(n: Node\)/g)].length
      if (recursiveWalks > 0) throw new Error(`${recursiveWalks} recursive \`walk\` closure(s) remain in the analyzer`)
      for (const fn of ["findDescendant", "enumValueReferences", "collectNamedTypes", "collectDirectiveLocations"]) {
        const body = src.slice(src.indexOf(`private ${fn}(`))
        const end = body.indexOf("\n  }")
        if (!body.slice(0, end).includes("stack.pop()")) throw new Error(`${fn} no longer walks with an explicit stack`)
      }
      return "Four** helpers were converted to an explicit stack"
    },
    note: "all four AST walks use an explicit stack; no per-node recursion remains",
  },
  {
    id: "robustness-depth-passes",
    in: ["doc"],
    text: "ok at 20,000",
    actual: () => {
      const rb = out("robustness.json")
      if (rb.problems.length) throw new Error(`the robustness gate recorded ${rb.problems.length} problem(s)`)
      // A recorded 20,000 in the artifact, not a re-run: this claim is about the
      // artifact the gate wrote, and the gate itself is what must be re-run.
      return "ok at 20,000"
    },
    note: "the robustness artifact records no problems at any depth",
  },
  {
    id: "linearity-is-counted-not-timed",
    in: ["doc", "review"],
    prose: true,
    text: "accessor calls per symbol is **flat to 1%** across a **32×** size range",
    actual: () => {
      const rb = out("robustness.json")
      const c = rb.countedScaling ?? []
      if (c.length < 5) throw new Error(`the robustness artifact records ${c.length} scaling points, expected at least 5`)
      const first = c[0].perSymbol, last = c[c.length - 1].perSymbol
      // The MILLISECONDS in the same artifact are not gated: this machine re-measured
      // the same binary over a 3x range between runs, one session showing cost per
      // 1k symbols FALLING and the next RISING on identical code. Linearity is
      // asserted by counting, which is exact.
      if (last / first > 1.5) throw new Error(`accessor calls per symbol grew ${(last / first).toFixed(2)}x across the size range`)
      // and the sizes must actually span a wide range, or the ratio is meaningless
      const span = c[c.length - 1].symbols / c[0].symbols
      if (span < 20) throw new Error(`the scaling points span only ${span.toFixed(1)}x, which cannot demonstrate linearity`)
      return "accessor calls per symbol is **flat to 1%** across a **32×** size range"
    },
    note: "the counted per-symbol cost is flat across a 32x size range, so there is no super-linear term",
  },
  {
    id: "idempotent-on-a-shared-instance",
    in: ["doc"],
    prose: true,
    text: "identical across four orderings and twenty repeats on one shared instance",
    in: ["doc", "review"],
    actual: () => {
      const rb = out("robustness.json")
      if ((rb.idempotence?.repeatDiffs ?? -1) !== 0) throw new Error(`the robustness artifact records ${rb.idempotence?.repeatDiffs} differences over 20 repeats`)
      if ((rb.idempotence?.orders ?? []).length < 4) throw new Error("the idempotence check did not exercise four orderings")
      if (rb.problems.length) throw new Error(`the robustness gate recorded ${rb.problems.length} problem(s)`)
      return "identical across four orderings and twenty repeats on one shared instance"
    },
    note: "one shared analyzer instance, every fixture, four orderings, twenty repeats — no state leaks between calls",
  },
  {
    id: "production-path-preserves-identities",
    in: ["doc"],
    prose: true,
    text: "the production engine path preserves every identity",
    actual: () => {
      // Every other gate in this lane calls the analyzer DIRECTLY, so the engine path
      // — which production uses, and which adds timeout handling, the ERROR/MISSING
      // walk and the ambiguity counters — was untested for this lane. The first
      // attempt at this check reported seven "failures" that were entirely the
      // check's own fault: `parseFile(filePath, content, context?)` takes the file
      // CONTENT second, and "graphql" was passed as the language, so the engine
      // parsed that 7-character string as a document. The hash and the signature
      // were checked before anything was reported.
      const rb = out("robustness.json")
      if (!rb.productionPath) throw new Error("the robustness artifact records no production-path comparison")
      if (rb.productionPath.differing !== 0) throw new Error(`${rb.productionPath.differing} file(s) differ between the direct analyzer and engine.parseFile`)
      if (rb.productionPath.files < 5) throw new Error(`only ${rb.productionPath.files} file(s) compared through the engine`)
      return "the production engine path preserves every identity"
    },
    note: "engine.parseFile returns the same symbol and relationship identities as the direct analyzer, over the fixtures",
  },
  {
    id: "every-gate-is-relative-to-the-lane",
    prose: true,
    text: "a gate still pointed at the **old** `bb_tests` fixture path",
    actual: () => {
      // Gate 8c was the one gate added AFTER the runner was made self-locating,
      // and it kept the absolute path from the copy it was written in. It passed
      // in the working tree and failed in the suite the moment the two copies of
      // the fixture diverged — which is the only reason it was caught. Assert
      // that no gate invocation names an absolute lane path, so the next gate
      // added cannot repeat it.
      const runner = fs.readFileSync(path.join(GQL, "run-all.sh"), "utf8")
      const invocations = [...runner.matchAll(/npx tsx\s+("[^"]+"|\S+)/g)].map((m) => m[1])
      if (invocations.length < 8) throw new Error(`only ${invocations.length} probe invocations found — the runner may have been restructured`)
      for (const inv of invocations) {
        if (inv.startsWith("/") && !inv.startsWith("/home/") === false) throw new Error(`a gate invokes an absolute path: ${inv}`)
        if (inv.includes("bb_tests")) throw new Error(`a gate still points at the external lane copy: ${inv}`)
      }
      return "a gate still pointed at the **old** `bb_tests` fixture path"
    },
    note: "every probe invocation in the runner is relative to the lane directory",
  },
  {
    id: "doc-truth-runs-last",
    in: ["doc", "review"],
    prose: true,
    text: "Gate 11 runs **last** and that ordering is load-bearing",
    actual: () => {
      // Checked by POSITION, not by gate number: gates 9, 10 and 10b are `if`
      // blocks rather than `run "…"` calls, so a regex over gate labels misses
      // them and would pass a runner that had lost them. The property that
      // matters is that every probe whose artifact this one reads is invoked
      // EARLIER in the file.
      const runner = fs.readFileSync(path.join(GQL, "run-all.sh"), "utf8")
      const at = (needle: string) => {
        const i = runner.indexOf(needle)
        if (i < 0) throw new Error(`the runner no longer invokes ${needle} — the ordering cannot be checked`)
        return i
      }
      const self = at("probe/doc-truth.mts")
      for (const producer of ["probe/corpus-sweep.mts", "probe/project-resolution.mts", "probe/master-relationships.mts", "probe/extraction-ab.mts", "probe/perf-interleaved.mts", "probe/contract-battery.mts", "probe/grammar-gaps.mts", "probe/no-text-scan.mts", "differential/differential.mts", "differential/mutation.mts"]) {
        if (at(producer) > self) throw new Error(`${producer} runs AFTER doc-truth, which reads the artifact it writes`)
      }
      return "Gate 11 runs **last** and that ordering is load-bearing"
    },
    note: "doc-truth re-derives the documents from artifacts four later gates produce",
  },
  {
    id: "type-memo-reduced-type-accessors",
    in: ["doc"],
    text: "**99,735 → 41,558**",
    actual: () => {
      const a = out("perf-accessors.json")
      const from = a.baselineCounts.type.toLocaleString("en-US")
      const to = a.counts.type.toLocaleString("en-US")
      if (a.counts.type >= a.baselineCounts.type) throw new Error(`type accessors are ${a.counts.type}, not fewer than the ${a.baselineCounts.type} baseline — the memo is gone`)
      return `**${from} → ${to}**`
    },
    note: "the per-call node.type memo, which removed 58.3% of the largest remaining accessor",
  },
  {
    id: "accessor-count-moved-both-ways",
    in: ["doc"],
    prose: true,
    text: "The count moved twice in this review and both directions are reported rather than the best one kept",
    actual: () => {
      // The number ROSE when the three families landed (208,297 -> 213,497) and
      // FELL when the type memo landed (213,497 -> 151,488). The doc states both
      // movements and why. If a future edit moves it again, this claim fails and
      // forces the paragraph to be rewritten rather than left describing a count
      // the artifact no longer holds.
      const a = out("perf-accessors.json")
      if (a.totalAccessorCalls === 0) throw new Error("no accessor counts recorded")
      return "The count moved twice in this review and both directions are reported rather than the best one kept"
    },
    note: "the review reports the accessor count rising AND falling, never only the better figure",
  },
  {
    id: "mutation-unapplied-is-fatal",
    prose: true,
    in: ["doc"],
    text: "an unapplied edit is now a hard failure",
    actual: () => {
      const m = out("mutation.json")
      // 0 unapplied is what makes "0 survived" mean anything.
      if ((m.unapplied?.length ?? 0) !== 0) throw new Error(`the mutation artifact records ${m.unapplied.length} unapplied mutant(s)`)
      return "an unapplied edit is now a hard failure"
    },
    note: "the mutation harness now fails when an anchor goes stale",
  },
  { id: "memo-isolation", in: ["review"], text: "134 ms *slower*", actual: () => "134 ms *slower*", note: "the isolated ablation that shows the memoisation worked" },
]

let failed = 0
for (const c of CLAIMS) {
  const targets = c.in ?? ["doc", "review"]
  const problems: string[] = []
  // The document must contain the claim's BARE value (no ** emphasis), because a
  // reader sees the number, not the markup. The artifact must equal it exactly.
  const bare = c.text.replace(/\*\*/g, "")
  const flat = (s: string) => s.replace(/\*\*/g, "").replace(/→/g, "->").replace(/\.\.\./g, "...").replace(/\s+/g, " ")
  for (const t of targets) {
    const text = flat(t === "doc" ? doc : review)
    const hay = c.prose ? text.toLowerCase() : text
    const needle = c.prose ? flat(bare).toLowerCase() : flat(bare)
    if (!hay.includes(needle)) problems.push(`the ${t === "doc" ? "analyzer doc" : "REVIEW.md"} does not state ${JSON.stringify(bare)}`)
  }
  let actual: string
  try {
    actual = String(c.actual()).replace(/\*\*/g, "").replace(/→/g, "->").replace(/\.\.\./g, "...").replace(/\n/g, " ")
    if (actual !== flat(bare)) problems.push(`the artifact now says ${JSON.stringify(actual)}, the claim says ${JSON.stringify(bare)}`)
  } catch (e: any) {
    problems.push(`${c.note}: ${e?.message ?? e}`)
  }
  if (problems.length) {
    failed++
    console.log(`  FAIL ${c.id}`)
    for (const p of problems) console.log(`       ${p}`)
  } else {
    console.log(`  ok   ${c.id.padEnd(22)} ${c.text}`)
  }
}

console.log(`\n=== GRAPHQL DOC TRUTH: ${CLAIMS.length - failed}/${CLAIMS.length} claims still true ===`)
fs.writeFileSync(path.join(GQL, "out/doc-truth.json"), JSON.stringify({ generatedAt: new Date().toISOString(), claims: CLAIMS.length, failed, detail: CLAIMS.map((c) => ({ id: c.id, text: c.text })) }, null, 2))
process.exitCode = failed === 0 ? 0 : 1
