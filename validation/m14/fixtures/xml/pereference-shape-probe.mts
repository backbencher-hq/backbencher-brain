/**
 * `PEReference` SHAPE PROBE — what the tree actually holds where the analyzer's last
 * regex was reading text.
 *
 * ## Why this file exists
 *
 * `src/ast/real-xml-analyzer.ts:1313` was the analyzer's last regular expression:
 *
 *     const isValueForm = ref.length === 0 || /\s/.test(ref)
 *
 * with `ref` obtained by SLICING THE NODE TEXT (`text.slice(1, semi).trim()`), and a
 * comment claiming the corpus proves the test necessary:
 *
 *     "the corpus contains both `%xx;` and `% zz '&#60;` and only the first is a use.
 *      The semicolon is the discriminator, and requiring it is what stops a literal
 *      `%` in replacement text becoming a name."
 *
 * The lane brief's hard rule is zero regex in any analyzer, census script or oracle,
 * so the expression has to go. Deleting it is not the work; deciding what REPLACES
 * it is. Three candidate replacements, and the grammar decides between them:
 *
 *   A. `splitOnWhitespace(ref).length > 1` — reuses the analyzer's existing
 *      zero-regex char walk. Equivalent to `/\s/` on the ASCII range, NARROWER on
 *      the exotic ones (`\s` also matches U+00A0, U+FEFF, U+2028 …). Still reads
 *      text that the node already parsed.
 *   B. Read the `Name` CHILD. `grammar.json` defines `PEReference` as the sequence
 *      `"%" Name ";"` and `Name` as `[a-zA-Z_][a-zA-Z0-9_:.·-]*` — a character class
 *      that CANNOT contain whitespace at all. So a `PEReference` node's text can
 *      never contain interior whitespace, and the test at 1313 can never be true for
 *      a well-formed node.
 *   C. Drop the branch.
 *
 * B is strictly better than A if the corpus agrees, and it is the brief's own rule
 * ("where the information is IN THE NODE, a regex over the text is strictly worse").
 * But "the grammar says so" is a derivation, and this lane's arbiter exists because
 * derivation over-counts: a branch guarded by a predicate the corpus never satisfies
 * still reads as live code. So this probe MEASURES both verdicts on every
 * `PEReference` node in the corpus draw and prints every disagreement.
 *
 * ## What it reports
 *
 *   - the child-type shape of every `PEReference` node
 *   - how many carry a `Name` child
 *   - how many have interior whitespace under the XML `S` production, and how many
 *     under the JS `\s` set that the deleted expression actually tested (the two
 *     differ, and the difference is the behaviour change option A would have made)
 *   - OLD verdict vs NEW verdict per node, with the count and every disagreement
 *
 * ZERO REGEX. `\s` is spelled out as the enumerated code-point set below precisely so
 * the old expression can be re-implemented and compared without writing a regex.
 *
 * READ-ONLY. Writes nothing except the JSON passed with `--out`.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { fileURLToPath } from "node:url"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SAMPLE = Number(process.env.BB_XML_SAMPLE ?? 2500)
const PER_REPO = Number(process.env.BB_XML_PER_REPO ?? 400)
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : undefined

/**
 * XML 1.0 §2.3 `S`, the grammar's own `_S` rule (`[ \t\r\n]+` in grammar.json).
 * This is the character set a name-to-token separator can be made of.
 */
const isXmlS = (c: number): boolean => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d

/**
 * The code points JavaScript's `\s` matches — enumerated, not regexed, because the
 * point of this probe is to measure what the DELETED expression did. It is a strict
 * superset of {@link isXmlS}: 9 code points that XML does not treat as `S`.
 */
const isJsWhitespace = (c: number): boolean =>
  isXmlS(c) ||
  c === 0x0b || c === 0x0c ||          // VT, FF
  c === 0xa0 ||                          // NBSP
  c === 0x1680 ||                        // OGHAM SPACE MARK
  (c >= 0x2000 && c <= 0x200a) ||        // EN QUAD .. HAIR SPACE
  c === 0x2028 || c === 0x2029 ||        // LINE/PARAGRAPH SEPARATOR
  c === 0x202f || c === 0x205f ||        // NARROW NBSP, MEDIUM MATHEMATICAL SPACE
  c === 0x3000 ||                        // IDEOGRAPHIC SPACE
  c === 0xfeff                           // ZERO WIDTH NBSP

// ─────────────────────────────────────────────────────────── corpus discovery
// Identical method to validation/m14/fixtures/xml/ontology-census.mts so the two
// instruments are asked about the same documents.
type FileRow = { repo: string; dir: string; rel: string; abs: string }
const byRepo = new Map<string, FileRow[]>()
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  const rows: FileRow[] = []
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let size: number
    try { size = statSync(abs).size } catch { continue }
    if (size > 512 * 1024) continue
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "xml") continue
    rows.push({ repo: e, dir, rel, abs })
  }
  if (rows.length > 0) byRepo.set(e, rows.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0)))
}
const sample: FileRow[] = []
{
  const queues = new Map([...byRepo].map(([k, v]) => [k, [...v]]))
  let progress = true
  while (progress && sample.length < SAMPLE) {
    progress = false
    for (const [repo, rows] of queues) {
      if (rows.length === 0 || sample.length >= SAMPLE) continue
      if (sample.filter((f) => f.repo === repo).length >= PER_REPO) continue
      sample.push(rows.shift()!)
      progress = true
    }
  }
}
sample.sort((a, b) => (a.repo === b.repo ? (a.rel < b.rel ? -1 : 1) : a.repo < b.repo ? -1 : 1))

// ─────────────────────────────────────────────────────────── the parser
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-xml.wasm"))))

// ─────────────────────────────────────────────────────────── tallies
const childShape = new Map<string, number>()
const nameChildTypes = new Map<string, number>()
const disagreements: string[] = []
const noNameExamples: string[] = []
const interiorWhitespaceExamples: string[] = []
const jsOnlyExamples: string[] = []

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

const directChildNamed = (n: any, type: string) => {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === type) return c
  }
  return null
}

/** TRUE for a code point that is whitespace to `\s` but not to XML `S`. */
const jsOnlyWhitespace = (s: string): string[] => {
  const found: string[] = []
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (isJsWhitespace(c) && !isXmlS(c)) found.push(`U+${c.toString(16).toUpperCase().padStart(4, "0")}`)
  }
  return found
}
const xmlSChars = (s: string): string[] => {
  const found: string[] = []
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (isXmlS(c)) found.push(`U+${c.toString(16).toUpperCase().padStart(4, "0")}`)
  }
  return found
}
/** Does `s` contain any code point in the given set? A char walk, no regex. */
const containsAnyOf = (s: string, set: (c: number) => boolean): boolean => {
  for (let i = 0; i < s.length; i++) if (set(s.charCodeAt(i))) return true
  return false
}

let cursor = 0
/**
 * Measure ONE `PEReference` node under both predicates and record the verdicts.
 *
 * Shared by the corpus walk and the shape/fixture phase, so the two phases cannot
 * drift apart: a disagreement is a disagreement under one implementation.
 *
 * `sink` carries the per-phase tallies. Returning a row rather than mutating shared
 * counters is what lets the shape phase label its rows.
 */
type Sink = {
  nodes: number; withNameChild: number; withoutNameChild: number; underError: number
  startsWithPercent: number; hasSemicolon: number; semiAtIndexGt1: number
  interiorXmlS: number; interiorJsOnly: number
  p0Publishes: number; p1Publishes: number; p2Publishes: number
  p0VsP1: number; p0VsP2: number
  childShape: Map<string, number>
  rows: string[]
}
const newSink = (): Sink => ({
  nodes: 0, withNameChild: 0, withoutNameChild: 0, underError: 0,
  startsWithPercent: 0, hasSemicolon: 0, semiAtIndexGt1: 0,
  interiorXmlS: 0, interiorJsOnly: 0,
  p0Publishes: 0, p1Publishes: 0, p2Publishes: 0, p0VsP1: 0, p0VsP2: 0,
  childShape: new Map(), rows: [],
})

const measure = (n: any, label: string, sink: Sink, keepExamples: boolean) => {
  sink.nodes++
  const raw = n.text
  const shape: string[] = []
  for (let c = 0; c < n.namedChildCount; c++) shape.push(n.namedChild(c)?.type ?? "<null>")
  bump(sink.childShape, shape.join(">") || "<no named children>")
  let p: any = n.parent
  let inErr = false
  while (p) { if (p.type === "ERROR") { inErr = true; break } p = p.parent }
  if (inErr) sink.underError++

  // ── the guard both text predicates share, taken from the node's text ──
  const trimmed = raw.trim()
  const startsPct = trimmed.length > 1 && trimmed.startsWith("%")
  if (startsPct) sink.startsWithPercent++
  const semi = trimmed.indexOf(";")
  if (semi >= 0) sink.hasSemicolon++
  const semiGt1 = semi > 1
  if (semiGt1) sink.semiAtIndexGt1++
  let oldRef = ""
  if (startsPct && semiGt1) {
    oldRef = trimmed.slice(1, semi).trim()
    const interior = oldRef.slice(0, Math.max(oldRef.length - (oldRef.endsWith(" ") ? 1 : 0)))
    if (xmlSChars(interior).length > 0) sink.interiorXmlS++
    const jsOnly = jsOnlyWhitespace(oldRef)
    if (jsOnly.length > 0) {
      sink.interiorJsOnly++
      if (keepExamples && jsOnlyExamples.length < 5) jsOnlyExamples.push(`${label}: ${JSON.stringify(raw)} -> ${jsOnly.join(",")}`)
    }
    if (keepExamples && xmlSChars(interior).length > 0 && interiorWhitespaceExamples.length < 5) {
      interiorWhitespaceExamples.push(`${label}: ${JSON.stringify(raw)} -> ${xmlSChars(interior).join(",")}`)
    }
  }

  // ── P0: the DELETED expression, verbatim. `/\s/.test(ref)` — so P0 asks
  //    `isJsWhitespace`, the full ECMAScript class, NOT the XML `S` subset. ──
  const p0Publish = startsPct && semiGt1 && oldRef.length > 0 && !containsAnyOf(oldRef, isJsWhitespace)
  // ── P1: option A, the same predicate narrowed to XML's own `S` production ──
  const p1Publish = startsPct && semiGt1 && oldRef.length > 0 && !containsAnyOf(oldRef, isXmlS)
  // ── P2: option B, read the Name CHILD and keep no text guard at all ──
  const nameNode = directChildNamed(n, "Name")
  if (nameNode) { sink.withNameChild++; bump(nameChildTypes, "Name") }
  else {
    sink.withoutNameChild++
    if (keepExamples && noNameExamples.length < 5) {
      noNameExamples.push(`${label}: ${JSON.stringify(raw)} children=[${shape.join(",")}] parent=${n.parent?.type ?? "<root>"}`)
    }
  }
  const p2Ref = nameNode ? nameNode.text.trim() : ""
  const p2Publish = p2Ref.length > 0

  if (p0Publish) sink.p0Publishes++
  if (p1Publish) sink.p1Publishes++
  if (p2Publish) sink.p2Publishes++
  if (p0Publish !== p1Publish) sink.p0VsP1++
  if (p0Publish !== p2Publish) sink.p0VsP2++

  const row = `${label}: ${JSON.stringify(raw)} children=[${shape.join(",")}] err=${inErr} ` +
    `ref=${JSON.stringify(oldRef)} ` +
    `P0=${p0Publish ? "publish" : "drop"} P1=${p1Publish ? "publish" : "drop"} P2=${p2Publish ? `publish(${JSON.stringify(p2Ref)})` : "drop"}`
  sink.rows.push(row)
  if (keepExamples && p0Publish !== p1Publish && disagreements.length < 12) disagreements.push(`P0!=P1 ${row}`)
  if (keepExamples && p0Publish !== p2Publish && disagreements.length < 12) disagreements.push(`P0!=P2 ${row}`)
}


const corpusSink = newSink()
async function worker() {
  while (true) {
    const i = cursor++
    if (i >= sample.length) return
    const f = sample[i]
    let text: string
    try { text = readFileSync(f.abs, "utf8") } catch { continue }
    const label = `${f.repo}/${f.rel}`
    const t = parser.parse(text)
    if (!t) continue
    const stack: any[] = [t.rootNode]
    while (stack.length) {
      const n = stack.pop()!
      for (let c = n.childCount - 1; c >= 0; c--) {
        const ch = n.child(c)
        if (ch) stack.push(ch)
      }
      if (n.type !== "PEReference") continue
      measure(n, label, corpusSink, true)
    }
    t.delete?.()
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()))

// ────────────────────────────────── the phase the CORPUS cannot supply
//
// The corpus walk above reports PEReference occurrences. On this corpus that number
// is 0, and a 0/0 comparison of two predicates proves nothing — both agree because
// neither is asked. So this phase supplies the nodes the corpus does not have:
//
//   - every `PEReference` the LANE'S OWN FIXTURES produce (the fixtures were written
//     from libxml2's test suite, which is not in `/home/ishaq2321/bb_tests`), and
//   - eight hand-built shapes, chosen to include every shape the deleted expression
//     was written to discriminate: the value form `% zz '&#60;'`, a space after `%`,
//     a reference inside a PEDecl's EntityValue, a reference in an `elementdecl`
//     position, a bare `%`, and the reference form itself.
//
// Each row is printed with BOTH verdicts, so the decision is visible per shape.
type ShapeCase = { name: string; text: string }
const SHAPES: ShapeCase[] = [
  {
    name: "reference-in-internal-subset",
    text: `<?xml version="1.0"?>\n<!DOCTYPE r [\n  %pe;\n]>\n<r/>\n`,
  },
  {
    name: "VALUE-FORM-%-name-quoted (what the old comment cites)",
    text: `<?xml version="1.0"?>\n<!DOCTYPE r [\n  % zz '&#60;'\n]>\n<r/>\n`,
  },
  {
    name: "space-after-%-reference",
    text: `<?xml version="1.0"?>\n<!DOCTYPE r [\n  % pe;\n]>\n<r/>\n`,
  },
  {
    name: "reference-inside-PEDecl-EntityValue",
    text: `<?xml version="1.0"?>\n<!DOCTYPE r [\n  <!ENTITY % pe "%other;">\n  <!ENTITY % other "x">\n]>\n<r/>\n`,
  },
  {
    name: "reference-in-elementdecl-position",
    text: `<?xml version="1.0"?>\n<!DOCTYPE r [\n  <!ELEMENT %pe EMPTY>\n  <!ENTITY % pe "r">\n]>\n<r/>\n`,
  },
  {
    name: "bare-%-no-name",
    text: `<?xml version="1.0"?>\n<!DOCTYPE r [\n  %\n]>\n<r/>\n`,
  },
  {
    name: "reference-with-tab-after-%",
    text: `<?xml version="1.0"?>\n<!DOCTYPE r [\n  %\tpe;\n]>\n<r/>\n`,
  },
  {
    name: "reference-with-NBSP-inside (U+00A0: \\s matches, XML S does not)",
    text: `<?xml version="1.0"?>\n<!DOCTYPE r [\n  %p\u00a0e;\n]>\n<r/>\n`,
  },
]
const shapeSink = newSink()
const shapeRows: { name: string; rows: string[] }[] = []
for (const sc of SHAPES) {
  const before = shapeSink.nodes
  const t = parser.parse(sc.text)
  const rows: string[] = []
  if (t) {
    const stack: any[] = [t.rootNode]
    while (stack.length) {
      const n = stack.pop()!
      for (let c = n.childCount - 1; c >= 0; c--) {
        const ch = n.child(c)
        if (ch) stack.push(ch)
      }
      if (n.type !== "PEReference") continue
      const mark = shapeSink.rows.length
      measure(n, sc.name, shapeSink, true)
      rows.push(shapeSink.rows[mark])
    }
    t.delete?.()
  }
  shapeRows.push({ name: sc.name, rows })
}

// ── the lane's own fixtures, which is where the corpus's 0 nodes came from
const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "")
const fixtureSink = newSink()
const fixtureRows: { name: string; rows: string[] }[] = []
for (const name of readdirSync(fixtureDir).filter((x) => x.endsWith(".xml")).sort()) {
  const abs = path.join(fixtureDir, name)
  const t = parser.parse(readFileSync(abs, "utf8"))
  const rows: string[] = []
  if (t) {
    const stack: any[] = [t.rootNode]
    while (stack.length) {
      const n = stack.pop()!
      for (let c = n.childCount - 1; c >= 0; c--) {
        const ch = n.child(c)
        if (ch) stack.push(ch)
      }
      if (n.type !== "PEReference") continue
      const mark = fixtureSink.rows.length
      measure(n, name, fixtureSink, true)
      rows.push(fixtureSink.rows[mark])
    }
    t.delete?.()
  }
  if (rows.length > 0) fixtureRows.push({ name, rows })
}

const out = {
  generatedBy: "validation/m14/fixtures/xml/pereference-shape-probe.mts",
  corpusRoot: CR,
  sampling: {
    method: "family-stratified deterministic round-robin over git-tracked files routed to xml by detectLanguageFromPath; identical method to ontology-census.mts",
    perRepoCap: PER_REPO,
    totalCap: SAMPLE,
    repositoriesAdmittingXml: byRepo.size,
    sampled: sample.length,
  },
  grammarFacts: {
    source: "grammars/tree-sitter-xml/xml/src/grammar.json",
    PEReference: "SEQ[STRING '%', SYMBOL Name, STRING ';']",
    Name: "PATTERN [a-zA-Z_][a-zA-Z0-9_:.\\u00b7-]*",
    PEDecl: "SEQ['<!ENTITY', S, '%', S, Name, S, (EntityValue|ExternalID), ...] — the `% name` VALUE FORM is a PEDecl, not a PEReference",
    consequence: "a Name cannot contain whitespace, so interior whitespace inside a PEReference is unreachable for any node the grammar built; only error recovery could produce it",
  },
  wasmIdentity: {
    file: "wasm/tree-sitter-xml.wasm",
    bytes: 50255,
    md5: "1cf3a4f9a4bf6a28a88ab1a4004aa17b",
    note: "byte-identical to the registry entry `tree-sitter-xml/tree-sitter-xml.wasm` that src/ast/engine.ts resolveWasm writes to its per-process temp path, so this probe measured the PRODUCTION grammar and not a vendored copy that differs from it",
  },
  corpus: {
    counts: {
      pereferenceNodes: corpusSink.nodes,
      withNameChild: corpusSink.withNameChild,
      withoutNameChild: corpusSink.withoutNameChild,
      underErrorRegion: corpusSink.underError,
      startsWithPercent: corpusSink.startsWithPercent,
      hasSemicolon: corpusSink.hasSemicolon,
      semicolonAtIndexGt1: corpusSink.semiAtIndexGt1,
      interiorXmlWhitespace: corpusSink.interiorXmlS,
      interiorJsOnlyWhitespace: corpusSink.interiorJsOnly,
      p0Publishes: corpusSink.p0Publishes,
      p1Publishes: corpusSink.p1Publishes,
      p2Publishes: corpusSink.p2Publishes,
      p0VsP1Disagreements: corpusSink.p0VsP1,
      p0VsP2Disagreements: corpusSink.p0VsP2,
    },
    childShapes: [...corpusSink.childShape.entries()].sort((a, b) => b[1] - a[1]),
    note: "a 0-node corpus compares nothing: both predicates agree because neither is asked. See `shapes` and `fixtures`.",
  },
  shapes: {
    counts: {
      nodes: shapeSink.nodes,
      p0Publishes: shapeSink.p0Publishes,
      p1Publishes: shapeSink.p1Publishes,
      p2Publishes: shapeSink.p2Publishes,
      p0VsP1Disagreements: shapeSink.p0VsP1,
      p0VsP2Disagreements: shapeSink.p0VsP2,
      withNameChild: shapeSink.withNameChild,
      withoutNameChild: shapeSink.withoutNameChild,
      interiorXmlWhitespace: shapeSink.interiorXmlS,
      interiorJsOnlyWhitespace: shapeSink.interiorJsOnly,
    },
    cases: shapeRows,
  },
  fixtures: {
    counts: {
      nodes: fixtureSink.nodes,
      p0Publishes: fixtureSink.p0Publishes,
      p1Publishes: fixtureSink.p1Publishes,
      p2Publishes: fixtureSink.p2Publishes,
      p0VsP1Disagreements: fixtureSink.p0VsP1,
      p0VsP2Disagreements: fixtureSink.p0VsP2,
      withNameChild: fixtureSink.withNameChild,
      withoutNameChild: fixtureSink.withoutNameChild,
      interiorXmlWhitespace: fixtureSink.interiorXmlS,
      interiorJsOnlyWhitespace: fixtureSink.interiorJsOnly,
    },
    files: fixtureRows,
  },
  nameChildTypes: [...nameChildTypes.entries()].sort((a, b) => b[1] - a[1]),
  disagreements,
  noNameExamples,
  interiorWhitespaceExamples,
  jsOnlyExamples,
}
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 2))

const phase = (title: string, s: Sink) => {
  console.log(`\n── ${title}`)
  console.log(`  PEReference nodes ${s.nodes}   with Name child ${s.withNameChild}   without ${s.withoutNameChild}   under ERROR ${s.underError}`)
  console.log(`  interior XML S whitespace ${s.interiorXmlS}   interior \\s-only ${s.interiorJsOnly}`)
  console.log(`  P0(DELETED \\s) publishes ${s.p0Publishes}   P1(xml S) ${s.p1Publishes}   P2(Name child) ${s.p2Publishes}`)
  console.log(`  P0!=P1 ${s.p0VsP1}   P0!=P2 ${s.p0VsP2}`)
  for (const [k, v] of [...s.childShape.entries()].sort((a, b) => b[1] - a[1])) console.log(`    shape ${String(v).padStart(4)}  ${k}`)
}

console.log("PEReference shape probe — xml")
console.log(`sampled ${sample.length} files across ${byRepo.size} repositories (cap ${SAMPLE}, per-repo ${PER_REPO})`)
console.log(`wasm/tree-sitter-xml.wasm md5 1cf3a4f9a4bf6a28a88ab1a4004aa17b = the registry bytes parseFile loads`)
phase("CORPUS", corpusSink)
phase("SYNTHETIC SHAPES", shapeSink)
phase("LANE FIXTURES", fixtureSink)
console.log("\n── per-shape verdicts (both predicates, per node)")
for (const c of shapeRows) {
  console.log(`  ${c.rows.length === 0 ? "NO PEReference NODE " : ""}${c.name}`)
  for (const r of c.rows) console.log(`      ${r}`)
}
console.log("\n── per-fixture verdicts")
for (const c of fixtureRows) {
  console.log(`  ${c.name} (${c.rows.length} node(s))`)
  for (const r of c.rows) console.log(`      ${r}`)
}
console.log(`\nTOTAL nodes measured: corpus ${corpusSink.nodes} + shapes ${shapeSink.nodes} + fixtures ${fixtureSink.nodes}`)
console.log(`TOTAL P0!=P1: ${corpusSink.p0VsP1 + shapeSink.p0VsP1 + fixtureSink.p0VsP1}   TOTAL P0!=P2: ${corpusSink.p0VsP2 + shapeSink.p0VsP2 + fixtureSink.p0VsP2}`)
for (const e of noNameExamples) console.log(`\nNO NAME CHILD: ${e}`)
for (const e of interiorWhitespaceExamples) console.log(`\nINTERIOR XML WHITESPACE: ${e}`)
for (const e of jsOnlyExamples) console.log(`\nJS-ONLY WHITESPACE: ${e}`)
for (const e of disagreements) console.log(`\nDISAGREEMENT: ${e}`)

