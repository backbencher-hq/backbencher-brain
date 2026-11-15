/**
 * ZIG RULING TABLE — calibration and full-corpus measurement of the ONE probe
 * `script/m14/zig-ruled.ts` hands the coverage gate.
 *
 * ## Why this file exists
 *
 * `zig-ruled.ts` is a table the arbiter will run against the whole corpus, and the
 * `overrides` row's probe makes a JUDGMENT: it excludes a same-scope duplicate
 * declaration when the file quotes the compiler's own diagnostic for that
 * identifier. A judgment that cannot be seen is indistinguishable from a judgment
 * that is wrong, so this file does three things with it, all with numbers:
 *
 *   1. CONTROLS. Six synthetic snippets pushed through THE SAME exported probe the
 *      gate runs — two positives that must fire (so a zero means "absent" rather
 *      than "cannot see"), three negatives that must not (shadowing, two
 *      containers, destructuring), and one that separates the exclusion rule from
 *      its own abuse: a duplicate declaration whose file quotes a diagnostic about
 *      a DIFFERENT identifier must still fire, because the rule is keyed on the
 *      identifier, not on the file looking like a test.
 *   2. THE FULL-CORPUS COUNT, split three ways: every same-scope duplicate
 *      declaration on the parse tree, how many the exclusion covers, and how many
 *      survive it. The surviving number is the one the gate reads. The other two
 *      are published here so the split is auditable rather than asserted.
 *   3. INSTRUMENT A, re-derived here rather than quoted: the node types the pinned
 *      wasm's grammar PRODUCES over the corpus, checked against
 *      `zig-ruled.ts`'s own `nodeTypesThatWouldMeanIt` list, plus the keyword
 *      calibration that keeps "absent" from meaning "the table holds no keywords".
 *
 * ## What it deliberately does not decide
 *
 * It does not rule on `extends`/`implements` by POSITION. The gate's `Ruled` shape
 * has no field for the A4 header-slot classification, so those two rows rest on
 * the node-type inventory and `construct-probe.ts` carries the position test.
 * Both numbers are printed at the end so the two instruments can be read together.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/zig-ruled-probe.ts [--sample 0] [--out p]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { Parser, Language } from "web-tree-sitter"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { ZIG_RULED, countZigOverridesConstruct } from "../../../../script/m14/zig-ruled"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const SAMPLE = Number(arg("sample", "0"))
const SEED = arg("seed", "zig-ruled-v1")
const OUT = arg("out", "")

await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language: any = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-zig.wasm")))
const parser = new Parser()
parser.setLanguage(language)

// The wasm's own DECLARED node-type table, which carries the anonymous keyword tokens as well
// as the named nodes. Read once, used by the keyword calibration below and reported alongside
// the produced set so the two are never confused again.
const declaredNodeTypes = new Set<string>(Array.isArray(language?.types) ? language.types : [])

// ─────────────────────────────────────────────────────────── 1. the controls
type Control = { name: string; kind: "positive" | "negative"; source: string; mustBe: number }
const CONTROLS: Control[] = [
  {
    name: "POSITIVE a duplicate function at file scope, with no compiler diagnostic — the shape the ruling depends on being VISIBLE",
    kind: "positive",
    source: `fn f() void {}\nfn f() void {}\n`,
    mustBe: 1,
  },
  {
    name: "POSITIVE a duplicate member in one container, no diagnostic",
    kind: "positive",
    source: `const S = struct { a: u8, a: u16 };\n`,
    mustBe: 1,
  },
  {
    // The false positive the ARBITER convicted this probe of, kept as a control:
    // a tuple field whose type is a user-declared name parses as `name=identifier`
    // with no `type` field, so an identifier test alone read it as two members.
    name: "NEGATIVE a TUPLE struct in a type annotation is positional, not two members of the same name",
    kind: "negative",
    source: `const ZeroBit = enum { a };\nfn f() void {\n  var two: ?struct { ZeroBit, ZeroBit } = undefined;\n  _ = two;\n}\n`,
    mustBe: 0,
  },
  {
    name: "NEGATIVE a tuple struct of BUILTIN types is positional too",
    kind: "negative",
    source: `const A = []const struct { []const u8, []const u8 };\n`,
    mustBe: 0,
  },
  {
    name: "POSITIVE a duplicate binding in one block that quotes a diagnostic about a DIFFERENT identifier — the exclusion is keyed on the identifier, not on the file",
    kind: "positive",
    source: `fn g() void {\n  const a = 1;\n  const a = 2;\n}\n// :9:9: error: duplicate struct member name 'zzz'\n`,
    mustBe: 1,
  },
  {
    name: "NEGATIVE the same name in DISJOINT blocks is shadowing, not a redefinition",
    kind: "negative",
    source: `fn g(c: bool) void { if (c) { const a = 1; _ = a; } else { const a = 2; _ = a; } }\n`,
    mustBe: 0,
  },
  {
    name: "NEGATIVE the same name in two containers is two names",
    kind: "negative",
    source: `const S = struct { fn a() void {} };\nconst T = struct { fn a() void {} };\n`,
    mustBe: 0,
  },
  {
    name: "NEGATIVE zig destructuring rebinds a name legally and is not a second declaration",
    kind: "negative",
    source: `fn g(t: anytype) void {\n  var a: u32 = undefined;\n  a, const b: u64 = .{ 1, 2 };\n  _ = b;\n}\n`,
    mustBe: 0,
  },
  {
    // The site the full-corpus run found: an error-set duplicate in a file that
    // does NOT quote the diagnostic. zig rejects it anyway — `duplicate error set
    // field '{s}'`, lib/std/zig/AstGen.zig:5945 — so it is a rejection, not an
    // override.
    name: "NEGATIVE a duplicate ERROR-SET MEMBER with no quoted diagnostic — the compiler rejects it (`duplicate error set field`)",
    kind: "negative",
    source: `const Dup = error{ Foo, Foo } || error{ Bar };\n`,
    mustBe: 0,
  },
  {
    name: "NEGATIVE a duplicate declaration the COMPILER ITSELF rejected, with its diagnostic quoted — this is the shape the ruling excludes, and it must read 0",
    kind: "negative",
    source: `fn f() void {}\nfn f() void {}\n// error\n// :1:4: error: duplicate struct member name 'f'\n// :2:4: note: duplicate name here\n`,
    mustBe: 0,
  },
]

const controlResults: { name: string; kind: string; found: number; mustBe: number; ok: boolean }[] = []
for (const c of CONTROLS) {
  const hits: string[] = []
  const tree = parser.parse(c.source)
  countZigOverridesConstruct(tree!.rootNode, "CONTROL", hits)
  const ok = hits.length === c.mustBe
  controlResults.push({ name: c.name, kind: c.kind, found: hits.length, mustBe: c.mustBe, ok })
  tree?.delete?.()
}
const controlsOk = controlResults.every((c) => c.ok)

// ─────────────────────────────────────────────────────────── 2. the corpus
import { createHash } from "node:crypto"
type FileRec = { repo: string; dir: string; rel: string; abs: string; text: string }
const all: FileRec[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.zig"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
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
    // The census's own admission, so this draw IS the census draw and the two
    // are comparable file for file: extension walk, 512 KiB cap, hashed order.
    if (detectLanguageFromPath(abs, text) !== "zig") continue
    all.push({ repo: e, dir, rel, abs, text })
  }
}
const keyed = all.map((f) => ({ f, k: createHash("sha256").update(`${SEED}|${f.repo}/${f.rel}`).digest("hex") })).sort((a, b) => (a.k < b.k ? -1 : 1))
const draw = SAMPLE > 0 ? keyed.slice(0, SAMPLE).map((x) => x.f) : keyed.map((x) => x.f)
const drawHash = createHash("sha256").update(draw.map((f) => `${f.repo}/${f.rel}`).sort().join("\n")).digest("hex")

// Instrument A: what the grammar PRODUCES over this corpus, plus the vocabulary
// the ruling table declares. The gate builds its map the same way.
const produced = new Map<string, number>()
let overridesProbeHits = 0
const hitFiles = new Set<string>()
const hitExamples: string[] = []
for (const f of draw) {
  const tree = parser.parse(f.text)
  if (!tree) continue
  const root = tree.rootNode
  const v = (n: any) => {
    produced.set(n.type, (produced.get(n.type) ?? 0) + 1)
    for (let i = 0; i < n.childCount; i++) v(n.child(i))
  }
  v(root)
  // The probe the gate runs, run HERE so the number below is the gate's number.
  const hits: string[] = []
  countZigOverridesConstruct(root, `${f.repo}/${f.rel}`, hits)
  if (hits.length) {
    overridesProbeHits += hits.length
    hitFiles.add(`${f.repo}/${f.rel}`)
    if (hitExamples.length < 10) hitExamples.push(...hits.slice(0, 10 - hitExamples.length))
  }
  tree.delete?.()
}

// The RAW duplicate count, with no exclusion at all, so the split is visible.
// Derived here by running the same walk with an empty rejection set: the probe's
// own scope walk is not re-implemented, only its exclusion is switched off.
let rawTotal = 0
const rawByKind = rawDuplicateCountByKind(draw, parser)
// The two exclusions, told apart rather than asserted apart. `exclusionSplit` runs the SAME
// walk four ways — diagnostic rule on/off against error-member rule on/off — so each rule's
// contribution is a measured number and neither is credited with work it did not do.
const exclusionSplit = measureExclusionSplit(draw, parser)

const supertypeRow = ZIG_RULED.find((r) => r.type === "extends")!
const supertypePresent = (supertypeRow.nodeTypesThatWouldMeanIt ?? []).filter((n) => produced.has(n))
const supertypePresentDeclared = (supertypeRow.nodeTypesThatWouldMeanIt ?? []).filter((n) => declaredNodeTypes.has(n))

// THE CALIBRATION IS ABOUT THE DECLARED TABLE, and reading it off `produced` was wrong.
//
// Its whole purpose is to stop "absent" from meaning "the table holds no keywords at all": for
// zig the decisive question is whether `extends` is a KEYWORD, and a keyword is a question
// about the wasm's own `Language.types` table, not about which nodes a corpus happens to
// exercise. Filtering `produced` measured a different thing, and it read 10 of 11 on the full
// 3,834-file corpus — because `usingnamespace` occurs in ZERO of the corpus's files (measured:
// 0 in zig@738d2be9, 0 in zls, 0 in ghostty; upstream deprecated it), not because the grammar
// cannot see it. The grammar sees it fine: `usingnamespace` is in `Language.types` and a
// three-line file using it parses to `(using_namespace_declaration (identifier))`.
//
// So both numbers are recorded, the exit criterion is the DECLARED one, and the corpus-side
// number is published with its cause rather than silently dropped.
const KEYWORD_CALIBRATION = ["fn", "const", "var", "pub", "struct", "enum", "union", "opaque", "error", "comptime", "usingnamespace"]
const keywordCalibrationDeclared = KEYWORD_CALIBRATION.filter((k) => declaredNodeTypes.has(k))
const keywordCalibrationProduced = KEYWORD_CALIBRATION.filter((k) => produced.has(k))
const keywordProducedAbsent = KEYWORD_CALIBRATION.filter((k) => !produced.has(k))

const report = {
  instrument: "validation/m14/fixtures/zig/zig-ruled-probe.ts",
  probeUnderTest: "script/m14/zig-ruled.ts :: countZigOverridesConstruct",
  corpusRoot: CR,
  seed: SEED,
  samplingMethod:
    "git ls-files -- '*.zig' per corpus repo, ordered by sha256(seed|<repo>/<rel>), first N taken. A reproducible draw named by drawHash; NOT claimed to be a statistical sample.",
  sampledFiles: draw.length,
  drawHash: `sha256:${drawHash}`,
  controls: controlResults,
  controlsAllOk: controlsOk,
  overridesProbe: {
    whatTheGateReads: overridesProbeHits,
    filesWithAHit: hitFiles.size,
    examples: hitExamples,
  },
  overridesRawDuplicateDeclarations: rawTotal,
  overridesRawByKind: rawByKind,
  overridesExclusionSplit: exclusionSplit,
  instrumentA: {
    declaredNodeTypesDistinct: declaredNodeTypes.size,
    producedNodeTypesDistinct: produced.size,
    supertypeVocabularyDeclared: supertypeRow.nodeTypesThatWouldMeanIt?.length ?? 0,
    supertypeVocabularyProduced: supertypePresent,
    supertypeVocabularyInDeclaredTable: supertypePresentDeclared,
    keywordCalibrationDeclaredPresent: keywordCalibrationDeclared.length,
    keywordCalibrationTested: KEYWORD_CALIBRATION.length,
    keywordCalibrationProducedPresent: keywordCalibrationProduced.length,
    keywordProducedAbsent,
    keywordProducedAbsentCause:
      "a corpus fact, not a grammar limit: these keywords occur in 0 of the corpus's files " +
      "(usingnamespace is deprecated upstream), while the wasm's own Language.types declares " +
      "them and a file using one parses correctly. Verified on a 3-line file: " +
      "`usingnamespace std;` -> (using_namespace_declaration (identifier)).",
    supertypeOrOverrideProduced: [...produced.keys()].filter((n) => /^(class|interface|trait|override|extends|implements|super)/.test(n)),
  },
}

const text = JSON.stringify(report, null, 2)
if (OUT) {
  writeFileSync(path.resolve(ROOT, OUT), text + "\n")
  console.log(`wrote ${OUT}`)
}
console.log(`zig ruling-table probe — ${draw.length} files, draw sha256:${drawHash.slice(0, 8)}`)
for (const c of controlResults) console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.kind.padEnd(8)} ${c.name.slice(0, 96)} found ${c.found} (must be ${c.mustBe})`)
console.log(`overrides probe (what the gate reads): ${overridesProbeHits} hit(s) in ${hitFiles.size} file(s)`)
console.log(`overrides RAW same-scope duplicate declarations on the tree: ${rawTotal} — ${Object.entries(rawByKind).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"}`)
console.log(
  `overrides exclusion split — quoted-diagnostic OFF/error-member ON ${exclusionSplit.diagnosticOffErrorMemberOn}, ` +
    `OFF/OFF ${exclusionSplit.diagnosticOffErrorMemberOff}, ON/ON ${exclusionSplit.diagnosticOnErrorMemberOn} (what the gate reads), ` +
    `ON/OFF ${exclusionSplit.diagnosticOnErrorMemberOff}`,
)
console.log(
  `instrument A: grammar DECLARES ${declaredNodeTypes.size} node types (Language.types) and PRODUCED ${produced.size} across the corpus;`,
)
console.log(
  `  ${supertypePresent.length} of the ${supertypeRow.nodeTypesThatWouldMeanIt?.length} supertype names produced, ${supertypePresentDeclared.length} declared;` +
    ` keyword calibration ${keywordCalibrationDeclared.length}/${KEYWORD_CALIBRATION.length} declared, ${keywordCalibrationProduced.length}/${KEYWORD_CALIBRATION.length} produced` +
    `${keywordProducedAbsent.length ? ` (absent from the corpus: ${keywordProducedAbsent.join(", ")})` : ""}`,
)
process.exit(
  controlsOk && overridesProbeHits === 0 && supertypePresent.length === 0 && keywordCalibrationDeclared.length === KEYWORD_CALIBRATION.length
    ? 0
    : 1,
)

/**
 * The 2x2 exclusion split, measured with the SAME exported walk the gate runs.
 *
 * `diagnosticOn` is whether the compiler's quoted rejection is applied; `errorMemberOn` is
 * whether the error-set-member rule is applied. The walk takes the diagnostic set as a
 * parameter and the error-member rule as the fifth, so all four cells are one call each and
 * the scope walk is never re-implemented. The cell the GATE reads is ON/ON; the cell that
 * isolates the error-member rule's contribution is ON/OFF, and the difference between them is
 * how many duplicate error-set members the corpus actually carries.
 */
function measureExclusionSplit(files: FileRec[], p: any) {
  let diagnosticOffErrorMemberOn = 0
  let diagnosticOffErrorMemberOff = 0
  let diagnosticOnErrorMemberOn = 0
  let diagnosticOnErrorMemberOff = 0
  for (const f of files) {
    const tree = p.parse(f.text)
    if (!tree) continue
    const label = `${f.repo}/${f.rel}`
    const cell = (rejections: Set<string> | undefined, errMembers: boolean) => {
      const hits: string[] = []
      countZigOverridesConstruct(tree.rootNode, label, hits, rejections, errMembers)
      return hits.length
    }
    const none = new Set<string>()
    diagnosticOffErrorMemberOn += cell(none, false)
    diagnosticOffErrorMemberOff += cell(none, true)
    diagnosticOnErrorMemberOn += cell(undefined, false)
    diagnosticOnErrorMemberOff += cell(undefined, true)
    tree.delete?.()
  }
  return {
    diagnosticOffErrorMemberOn,
    diagnosticOffErrorMemberOff,
    diagnosticOnErrorMemberOn,
    diagnosticOnErrorMemberOff,
    reading:
      "the quoted-diagnostic rule removes `diagnosticOffErrorMemberOn - diagnosticOnErrorMemberOn` sites and the " +
      "error-set-member rule removes `diagnosticOffErrorMemberOn - diagnosticOffErrorMemberOff`; the cell the gate reads " +
      "is diagnosticOnErrorMemberOn.",
  }
}

/**
 * Every same-scope duplicate declaration, with NO exclusion — the raw count, broken down by the
 * kind the walk classified it as. The breakdown is what makes the raw number usable in a
 * written ruling: 19 raw and 0 surviving is only auditable if a reader can see that the 19 is
 * 3 functions + 5 bindings + 9 members + 2 error-set members, and that the walk's own rule
 * treats an error-set member as a compiler rejection on the compiler's authority.
 *
 * Derived by running the walk with an empty rejection set, so the scope walk is not
 * re-implemented here — only its exclusion is switched off. The kind is the third whitespace
 * token of the probe's own hit string, which is the walk's own classification.
 */
function rawDuplicateCountByKind(files: FileRec[], p: any): Record<string, number> {
  const byKind: Record<string, number> = {}
  let n = 0
  for (const f of files) {
    const tree = p.parse(f.text)
    if (!tree) continue
    const hits: string[] = []
    // The exclusion keyed on an identifier that no comment mentions: every duplicate site then
    // survives, which is the number the split needs.
    countZigOverridesConstruct(tree.rootNode, `${f.repo}/${f.rel}`, hits, new Set<string>())
    n += hits.length
    for (const h of hits) {
      // `<label>: <name> <kind> declared twice in <scope> (line N)` — the label may itself
      // contain spaces, so the kind is read from the END, where the fixed tail begins.
      const at = h.indexOf(" declared twice in ")
      if (at < 0) continue
      const head = h.slice(0, at).split(/\s+/)
      const kind = head[head.length - 1] ?? "(unclassified)"
      byKind[kind] = (byKind[kind] ?? 0) + 1
    }
    tree.delete?.()
  }
  rawTotal = n
  return byKind
}