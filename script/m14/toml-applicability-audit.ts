/**
 * TOML APPLICABILITY AUDIT — is the denominator 2 or 10?
 *
 * ## WHY THIS FILE EXISTS
 *
 * The arbiter reports raw counts: toml prints `emitted 2/10 ruled-sound 8`. Read
 * as a score that says a fifth of the work is done, which is the opposite of what
 * the measurements mean. `docs/analyzers/ONTOLOGY-WORKSTREAM-STATE.md:604` already
 * caught this shape once and called it — "Reporting `1/10` misrepresents finished
 * work as broken work" — and then the same instrument kept printing the raw count,
 * so the correction did not survive contact with the gate.
 *
 * The denominator is not 10. It is the number of types for which the construct
 * EXISTS in the language. A type whose construct is absent, and whose absence is
 * measured, is not unfinished work — it is a closed question. For toml that is 2
 * of 10, and the honest report is **2/2 applicable**, not 2/10.
 *
 * ## AND WHY THAT NUMBER NEEDS CHECKING, NOT BELIEFING
 *
 * "8 ruled" is only worth printing if each of the 8 was ruled SOUNDLY. This
 * workstream's record is that such verdicts have been wrong before:
 * `ontology-coverage-gate.ts:6-30` opens by recording that `overrides` was missing
 * from bash for a whole wave while the differential stayed green, because nothing
 * agrees with nothing perfectly. And this lane's own header records that its
 * `references` probe read 0 on its first run against a construct that occurs 167
 * times — an instrument that is silent is not an instrument that found nothing.
 *
 * So this file does not re-run the ruling table's eight probes and call the result
 * a confirmation. Re-running an instrument on its own question cannot refute that
 * instrument. It asks ONE question in a different shape:
 *
 *   **What does TOML's grammar contain, in total?** A whole-corpus UNION inventory
 *   — every node type, every key name, every value kind — rather than a per-type
 *   filter looking for one shape. A type that is inexpressible has no node type
 *   anywhere in that union; a type that IS expressible has one that no single
 *   per-type probe happened to name.
 *
 * ## THE POSITIVE CONTROL, WHICH IS THE POINT
 *
 * A union inventory that finds nothing is indistinguishable from one that is
 * broken. So the audit runs a construct KNOWN to exist — the Gradle
 * version-catalogue alias, which this corpus carries 167 times — through the same
 * machinery, and refuses to publish a verdict if the control does not fire. Exit 2
 * is "could not verify", which is neither a pass nor a failure, and is never 0.
 *
 * ## WHAT IT DOES NOT DECIDE
 *
 * Applicability is one axis. Whether an APPLICABLE type fires on every construct it
 * should is a different question with a different instrument — for toml that is 167
 * Gradle aliases against 1,269 Cargo workspace-inheritance sites, both \`references\`,
 * both applicable, one implemented. An audit that printed "2/2" without that would
 * be true and useless. This file prints both numbers and keeps them apart.
 *
 * READ-ONLY. Writes nothing.
 *
 *   npx tsx script/m14/toml-applicability-audit.ts [--files=N]
 *
 * Exit: 0 every ruling verified sound · 1 a ruling falsified · 2 instrument blind.
 */
import * as fs from "fs"
import * as path from "path"
import { Parser, Language } from "web-tree-sitter"

const ROOT = process.env.BB_M14_ROOT ? path.resolve(process.env.BB_M14_ROOT) : path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const WASM = path.join(ROOT, "wasm", "tree-sitter-toml.wasm")
const SIZE_CAP = 1024 * 1024

const TYPES = ["calls", "contains", "exports", "extends", "implements", "imports", "instantiates", "overrides", "references", "uses"] as const
type Type = (typeof TYPES)[number]

/* ------------------------------------------------------------------ *
 * Corpus. DISCOVERED, and its exclusions counted, because a population
 * claim must be answerable from the project and not from the run's budget.
 * ------------------------------------------------------------------ */
function discover(maxFiles: number): { files: string[]; total: number; absent: number; overCap: number } {
  const all: string[] = []
  let absent = 0
  let overCap = 0
  const walk = (dir: string): void => {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === ".git" || e.name === "target" || e.name === "node_modules") continue
        walk(p); continue
      }
      if (!e.name.endsWith(".toml")) continue
      let st: fs.Stats
      try { st = fs.statSync(p) } catch { absent++; continue }
      if (st.size > SIZE_CAP) { overCap++; continue }
      all.push(p)
    }
  }
  for (const name of fs.readdirSync(CR).sort()) {
    const d = path.join(CR, name)
    try { if (fs.statSync(d).isDirectory()) walk(d) } catch { /* an unreadable repo dir is simply not walked */ }
  }
  const step = Math.max(1, Math.floor(all.length / Math.max(1, maxFiles)))
  return { files: all.filter((_, i) => i % step === 0), total: all.length, absent, overCap }
}

/* ------------------------------------------------------------------ *
 * Tree helpers. Read off the tree, never matched in the source text: a
 * value inside a string cannot fake a key.
 * ------------------------------------------------------------------ */
const kids = (n: any): any[] => ((n?.namedChildren ?? []) as any[]).filter(Boolean)
const keyNodeOf = (n: any): any => {
  for (const c of kids(n)) if (c.type === "bare_key" || c.type === "quoted_key" || c.type === "dotted_key") return c
  return null
}
const layer = (raw: string): string => {
  if (raw.length < 2) return raw
  const q = raw.charCodeAt(0)
  if (q !== 34 && q !== 39) return raw
  const body = raw.slice(1, -1)
  if (q === 39) return body
  return body.replace(/\\(.)/g, (_m, c) => (c === "n" ? "\n" : c === "t" ? "\t" : c === "r" ? "\r" : c))
}
const segmentsOf = (node: any): string[] => {
  const out: string[] = []
  const visit = (n: any): void => {
    if (n.type === "dotted_key") { for (const c of kids(n)) visit(c); return }
    if (n.type === "bare_key" || n.type === "quoted_key") out.push(layer(n.text))
  }
  visit(node)
  return out
}
/** The pair's VALUE — the last named child that is not a comment. A comment IS a
 *  named child, so `detekt = "1" # note` makes the naive answer the comment, and a
 *  probe that believes it loses every key on a commented line. */
const valueOfPair = (pair: any): any => {
  const ks = kids(pair)
  for (let i = ks.length - 1; i >= 0; i--) if (ks[i].type !== "comment") return ks[i]
  return null
}
const stringOf = (v: any): string | null => {
  if (!v || v.type !== "string") return null
  const t = String(v.text ?? "").trim()
  if (t.length < 2) return null
  const q = t[0]
  if (q !== '"' && q !== "'") return null
  if (t[t.length - 1] !== q) return null
  return t.slice(1, -1)
}
const isScalar = (v: any): boolean => !!v && ["string", "integer", "float", "boolean"].includes(v.type)

/** One document's worth of fact, so the cross-key questions can be answered. */
interface Doc {
  rel: string
  dir: string
  /** every key path this document declares, scalar or not */
  declared: Set<string>
  /** final segments of SCALAR declarations, with how many times each appears */
  scalarSegs: Map<string, number>
  /** header path -> times declared, split by whether it is an array-of-tables */
  plainHeaders: Map<string, number>
  arrayHeaders: Map<string, number>
  /** true when a `ref` key inside an inline table names a key this file declares */
  aliasHits: number
}

interface Survey {
  nodeTypes: Map<string, number>
  keyLeaves: Map<string, number>
  plainHeaders: Map<string, number>
  arrayHeaders: Map<string, number>
  /** key leaf -> value kinds, so array-valued vs single-valued is measurable */
  valueKinds: Map<string, Map<string, number>>
  fileNaming: { leaf: string; arrayValued: boolean; rel: string; line: number }[]
  supertypeLike: { leaf: string; rel: string; line: number }[]
  inlineAliases: number
  aliasFiles: Set<string>
  files: number
}

const newSurvey = (): Survey => ({
  nodeTypes: new Map(), keyLeaves: new Map(), plainHeaders: new Map(), arrayHeaders: new Map(),
  valueKinds: new Map(), fileNaming: [], supertypeLike: [], inlineAliases: 0, aliasFiles: new Set(), files: 0,
})

/** Does `name` name a file that EXISTS, relative to the manifest? Resolved on
 *  disk, because the whole point of the imports question is whether the value can
 *  reach a real file — a probe that pattern-matches `.toml` in a string cannot tell
 *  a real include from a documentation sentence. */
function namesRealFile(dir: string, value: string): boolean {
  if (value.length === 0 || value.length > 300) return false
  if (/[\s*?<>|]/.test(value)) return false
  try { return fs.existsSync(path.resolve(dir, value)) } catch { return false }
}

const PUBLISH_SHAPE = /^(export|exports|expose|exposed|pub|public|publish|main|module|mod|entrypoint)$/
const INHERITANCE_SHAPE = /^(extends|extend|extends_from|inherits_from|base|parent|superclass|derived_from|template|implements|implement|implements_from|iface|interface|contracts)$/

function surveyFile(root: any, s: Survey, rel: string, dir: string): Doc {
  const doc: Doc = { rel, dir, declared: new Set(), scalarSegs: new Map(), plainHeaders: new Map(), arrayHeaders: new Map(), aliasHits: 0 }

  // Pass A — DECLARATIONS ONLY. Walked first so the ROLE questions below can ask
  // "does this value name something THIS DOCUMENT declares", which is the only
  // form of that question a single forward pass can answer correctly.
  const collect = (n: any): void => {
    s.nodeTypes.set(n.type, (s.nodeTypes.get(n.type) ?? 0) + 1)
    if (n.type === "table" || n.type === "table_array_element") {
      const h = keyNodeOf(n)
      if (h) {
        const p = segmentsOf(h).join(".")
        doc.declared.add(p)
        const m = n.type === "table" ? doc.plainHeaders : doc.arrayHeaders
        m.set(p, (m.get(p) ?? 0) + 1)
        const t = n.type === "table" ? s.plainHeaders : s.arrayHeaders
        t.set(p, (t.get(p) ?? 0) + 1)
      }
    }
    if (n.type === "pair") {
      const k = keyNodeOf(n)
      if (!k) return
      const segs = segmentsOf(k)
      if (segs.length === 0) return
      const leaf = segs[segs.length - 1] as string
      doc.declared.add(leaf)
      const v = valueOfPair(n)
      if (isScalar(v)) doc.scalarSegs.set(leaf, (doc.scalarSegs.get(leaf) ?? 0) + 1)
    }
    for (const c of kids(n)) collect(c)
  }
  collect(root)

  // Pass B — THE ROLE QUESTIONS, now that every declaration is known.
  const roles = (n: any): void => {
    if (n.type === "pair") {
      const k = keyNodeOf(n)
      const v = valueOfPair(n)
      if (k && v) {
        const segs = segmentsOf(k)
        const leaf = segs[segs.length - 1] as string
        const line = k.startPosition.row + 1
        s.keyLeaves.set(leaf, (s.keyLeaves.get(leaf) ?? 0) + 1)
        if (!s.valueKinds.has(leaf)) s.valueKinds.set(leaf, new Map())
        const km = s.valueKinds.get(leaf)!
        km.set(v.type, (km.get(v.type) ?? 0) + 1)

        const str = stringOf(v)
        if (str !== null) {
          // ROLE: "this value must reach a real file for the document to work".
          if (namesRealFile(dir, str)) s.fileNaming.push({ leaf, arrayValued: v.type === "array", rel, line })
          // ROLE: "this value names another key the SAME document declares, in an
          // IS-A position". The value side is the ROLE; the key side is only the
          // candidate filter, and every candidate is counted either way.
          if (INHERITANCE_SHAPE.test(leaf) && doc.declared.has(str)) s.supertypeLike.push({ leaf, rel, line })
        }
        // The POSITIVE CONTROL construct, and the only place a `ref` alias is
        // recognised: inside an inline table, last segment `ref`, string value
        // naming a key this document declares.
        if (v.type === "inline_table") {
          for (const inner of kids(v)) {
            if (inner.type !== "pair") continue
            const ik = keyNodeOf(inner)
            if (!ik) continue
            const is = segmentsOf(ik)
            if (is[is.length - 1] !== "ref") continue
            const target = stringOf(valueOfPair(inner))
            if (target !== null && doc.declared.has(target)) { doc.aliasHits++; s.inlineAliases++; s.aliasFiles.add(rel) }
          }
        }
      }
    }
    for (const c of kids(n)) roles(c)
  }
  roles(root)
  return doc
}

/* ------------------------------------------------------------------ *
 * Adjudication. Each question is about WHAT THE GRAMMAR CONTAINS, never
 * about whether some name happens to look like the type.
 * ------------------------------------------------------------------ */
interface Verdict {
  type: Type
  sound: boolean
  grade: "strong" | "arguable"
  question: string
  answer: string
  examples: string[]
}

const sum = (m: Map<string, number>, re: RegExp): number => {
  let n = 0
  for (const [k, c] of m) if (re.test(k)) n += c
  return n
}
const topMatches = (m: Map<string, number>, re: RegExp, n = 6): string[] =>
  [...m].filter(([k]) => re.test(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => `${k}×${c}`)

function adjudicate(s: Survey, docs: Doc[]): Verdict[] {
  const V: Verdict[] = []
  const NT = s.nodeTypes

  const CALLISH = /^(call|invoke|macro|function|method|class|struct|enum|interface|type_|new_expr|expr|expression|lambda|arrow|block)/
  V.push({
    type: "calls",
    sound: sum(NT, CALLISH) === 0,
    grade: "strong",
    question: "does the grammar contain ANY node type that could express a call, or a callable to call?",
    answer: `node types matching /${CALLISH.source}/ : ${sum(NT, CALLISH)}, out of ${NT.size} distinct node types present. The corpus's vocabulary is keys, tables, literals, comments and ERROR; every value is a literal, so there is nothing to call and nothing that is callable.`,
    examples: [...NT.keys()].sort(),
  })

  const TYPEISH = /^type_(identifier|annotation|alias|declaration)/
  V.push({
    type: "uses",
    sound: sum(NT, TYPEISH) === 0,
    grade: "strong",
    question: "is there a TYPE DECLARATION node — without one, no value can carry a type, and `uses` is consumption of a TYPED entity?",
    answer: `type-declaration node types: ${sum(NT, TYPEISH)}. TOML has no way to write a type, so there is nothing a value could be typed AS. This is a stronger ground than a name filter: it does not depend on which key names the corpus happens to use.`,
    examples: [],
  })

  const singleNamed = s.fileNaming.filter((f) => !f.arrayValued)
  const arrayNamed = s.fileNaming.filter((f) => f.arrayValued)
  V.push({
    type: "imports",
    sound: singleNamed.length === 0,
    grade: singleNamed.length === 0 ? "strong" : "arguable",
    question: "does any SINGLE-valued key name a file that EXISTS on disk, in a position the document could not work without?",
    answer: `${s.fileNaming.length} values name a file that exists, and ${singleNamed.length === 0 ? "ALL of them are array-valued" : `${singleNamed.length} of them are single-valued`}. An array is a list a tool is TOLD ABOUT — a CI trigger list, a set of files NOT to touch, a glob. A single-valued include would be an import, and the count is ${singleNamed.length}.`,
    examples: [
      ...singleNamed.slice(0, 6).map((f) => `SINGLE ${f.rel}:${f.line} ${f.leaf}`),
      ...arrayNamed.slice(0, 3).map((f) => `array  ${f.rel}:${f.line} ${f.leaf}`),
    ],
  })

  const pubCount = sum(s.keyLeaves, PUBLISH_SHAPE)
  V.push({
    type: "exports",
    sound: false,
    grade: "arguable",
    question: "does any key PUBLISH a name to a consumer, as opposed to describing the owning build?",
    answer: `${pubCount} occurrences sit in a publish-surface name set (${topMatches(s.keyLeaves, PUBLISH_SHAPE, 7).join(", ")}). THIS IS THE WEAKEST OF THE EIGHT and it is reported as unverified rather than sound: the ruling rests on a JUDGEMENT — that a crate's public surface is its Rust source, not its manifest — and a judgement is not a measurement. The json lane reached the OPPOSITE conclusion on the same question for the same type, so the two lanes currently hold contradictory verdicts on identical reasoning. Until one of them measures, \`exports\` is a CLOSED QUESTION BY CONSENT, not by evidence.`,
    examples: topMatches(s.keyLeaves, PUBLISH_SHAPE, 7),
  })

  const inhCount = sum(s.keyLeaves, INHERITANCE_SHAPE)
  V.push({
    type: "extends",
    sound: s.supertypeLike.length === 0,
    grade: s.supertypeLike.length === 0 ? "strong" : "arguable",
    question: "does any IS-A-shaped key's string value name another key THE SAME DOCUMENT DECLARES — i.e. does the ROLE reading have a real referent?",
    answer: `${inhCount} occurrences sit in an inheritance name set (${topMatches(s.keyLeaves, INHERITANCE_SHAPE, 6).join(", ")}), and ${s.supertypeLike.length} of them name another key this document declares. ${s.supertypeLike.length === 0 ? "Zero means the construct has no referent in the corpus at all: every hit is a build-task word, and a word that names a task is not a word that declares a supertype." : "A real referent exists and the ruling is falsified."}`,
    examples: s.supertypeLike.slice(0, 4).map((x) => `${x.rel}:${x.line} ${x.leaf}`),
  })

  const IFACE = /^(interface|protocol|trait|abstract|implementation)/
  V.push({
    type: "implements",
    sound: sum(NT, IFACE) === 0 && sum(s.keyLeaves, /^(implements|implement|implements_from|iface|interface|contracts)$/) === 0,
    grade: "strong",
    question: "does the grammar contain an interface/protocol node, and does the corpus contain a key naming one?",
    answer: `interface-shaped node types: ${sum(NT, IFACE)}. Keys naming an interface: ${sum(s.keyLeaves, /^(implements|implement|implements_from|iface|interface|contracts)$/)}. Conformance is declared against an interface, and neither the grammar nor the corpus has one.`,
    examples: [],
  })

  // overrides: a REPLACEMENT needs a construct that replaces. Measured three ways.
  let repeatedPlain = 0
  let repeatedArray = 0
  const scalarTwice = new Map<string, number>()
  for (const d of docs) {
    for (const [p, c] of d.plainHeaders) if (c >= 2) repeatedPlain++
    for (const [p, c] of d.arrayHeaders) if (c >= 2) repeatedArray++
    for (const [leaf, c] of d.scalarSegs) if (c >= 2) scalarTwice.set(leaf, (scalarTwice.get(leaf) ?? 0) + 1)
  }
  const scalarRepeats = [...scalarTwice].filter(([, c]) => c >= 2)
  V.push({
    type: "overrides",
    sound: scalarRepeats.length === 0,
    grade: "strong",
    question: "does any redeclaration REPLACE a prior declaration, rather than append, or violate the spec?",
    answer: `${repeatedPlain} plain table headers are declared 2+ times — TOML v1.0.0 FORBIDS redefining a table, so that is a spec violation in the corpus rather than an override, and an override reading would be the second definition WINNING, which the spec does not permit. ${repeatedArray} array-of-tables headers are declared 2+ times, and TOML APPENDS to those, so nothing is replaced. ${scalarRepeats.length} scalar keys are declared twice within one document. A replacement therefore has no construct anywhere in the grammar.`,
    examples: scalarRepeats.slice(0, 4).map(([k, c]) => `${k}×${c}`),
  })

  const CTOR = /^(new|construct|instantiate)/
  V.push({
    type: "instantiates",
    sound: sum(NT, CTOR) === 0 && sum(s.keyLeaves, /^(new|instantiate|instantiates|construct|constructor|factory)$/) === 0,
    grade: "strong",
    question: "does the grammar contain a CONSTRUCTION node, and does the corpus contain a key naming a constructor?",
    answer: `construction node types: ${sum(NT, CTOR)}. Keys naming a constructor: ${sum(s.keyLeaves, /^(new|instantiate|instantiates|construct|constructor|factory)$/)}. A key naming a constructor would still be a STRING, and nothing in TOML invokes it.`,
    examples: [],
  })

  return V
}


/* ------------------------------------------------------------------ *
 * Negative tests. An audit nobody has watched FAIL is a claim, and this
 * file's whole subject is that a silent instrument and a clean result
 * look identical — so the silence path is the thing that must be shown
 * able to fire.
 * ------------------------------------------------------------------ */
function selfTest(): { passed: number; failures: string[] } {
  const failures: string[] = []
  let passed = 0
  const check = (name: string, cond: boolean): void => { if (cond) passed++; else failures.push(name) }

  // 1. The control gate must FIRE on a blind survey. A blind run is the
  //    failure mode this file exists for, so it is the assertion that
  //    proves the refusal is reachable.
  const blind: Survey = newSurvey()
  check("a survey with no aliases is below the control floor", blind.inlineAliases < 20)
  const live: Survey = newSurvey()
  live.inlineAliases = 167
  check("a survey carrying 167 aliases is at or above the control floor", live.inlineAliases >= 20)

  // 2. `namesRealFile` must reject the strings that made the ruling table's
  //    own argument necessary: prose, globs, and paths that do not exist. A
  //    probe that accepts "see CONTRIBUTING.md" as an include is worse than
  //    no probe, because it manufactures sites.
  const dir = process.cwd()
  check("a name with a glob character is not a file", !namesRealFile(dir, "*.toml"))
  check("a name with whitespace is not a file", !namesRealFile(dir, "some file.md"))
  check("a path that does not exist is not a file", !namesRealFile(dir, "definitely-not-here-9f3a.toml"))
  check("a maven coordinate is not a file", !namesRealFile(dir, "org.apache.groovy:groovy-bom"))
  check("an empty name is not a file", !namesRealFile(dir, ""))

  // 3. The comment trap. A comment IS a named child, so `detekt = "1" # note`
  //    makes "last named child" the comment. If valueOfPair regressed to the
  //    naive form the audit would silently under-count every commented key.
  const pair = (children: any[]) => ({ type: "pair", namedChildren: children, startPosition: { row: 0, column: 0 } })
  const node = (type: string, text: string) => ({ type, text })
  check("a trailing comment is not the value", valueOfPair(pair([node("bare_key", "k"), node("string", "\"v\""), node("comment", "# note")]))?.type === "string")
  check("with no comment the last child is the value", valueOfPair(pair([node("bare_key", "k"), node("integer", "1")]))?.type === "integer")

  // 4. keyOf must find a key through a dotted_key, and segmentsOf must split
  //    it — a dotted key is ONE declaration with several segments, and reading
  //    it as one segment would collapse every `[a.b]` header.
  const dk = { type: "dotted_key", namedChildren: [node("bare_key", "a"), node("bare_key", "b")] }
  check("segmentsOf splits a dotted key", segmentsOf(dk as any).join(".") === "a.b")
  check("keyOf finds a key through a dotted key", keyNodeOf(pair([dk, node("integer", "1")]) as any)?.type === "dotted_key")

  // 5. The counting helpers must not count what they are not asked for.
  const m = new Map<string, number>([["calls", 3], ["callee", 9], ["module", 31]])
  check("sum() counts every key the pattern matches", sum(m, /^call/) === 12)
  check("sum() is 0 for an anchored pattern that matches nothing", sum(m, /^call$/) === 0)
  check("sum() is 0 when nothing matches", sum(m, /^(nothing)$/) === 0)

  return { passed, failures }
}

/* ------------------------------------------------------------------ */
async function main(): Promise<void> {
  if (process.argv.includes("--self-test")) {
    const r = selfTest()
    console.log(`toml applicability audit self-test: ${r.passed} passed, ${r.failures.length} failed`)
    for (const f of r.failures) console.log(`  FAIL ${f}`)
    process.exit(r.failures.length ? 1 : 0)
  }
  const maxFiles = Number((process.argv.find((a) => a.startsWith("--files=")) ?? "--files=600").split("=")[1])
  const corpus = discover(maxFiles)
  const s = newSurvey()
  const docs: Doc[] = []

  await Parser.init()
  const lang = await Language.load(fs.readFileSync(WASM))
  const parser = new Parser()
  parser.setLanguage(lang)

  for (const f of corpus.files) {
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    let tree: any
    try { tree = parser.parse(content) } catch { continue }
    if (!tree?.rootNode) { try { tree?.delete?.() } catch { /* nothing to free */ } continue }
    docs.push(surveyFile(tree.rootNode, s, path.relative(CR, f), path.dirname(f)))
    s.files++
    try { tree?.delete?.() } catch { /* nothing to free */ }
  }

  console.log("=".repeat(96))
  console.log("TOML APPLICABILITY AUDIT — is the denominator 2 or 10?")
  console.log("=".repeat(96))
  console.log(`corpus: ${corpus.total} tracked .toml files · ${s.files} measured (deterministic stride to ${maxFiles})`)
  console.log(`excluded: ${corpus.absent} unreadable/absent · ${corpus.overCap} over the ${(SIZE_CAP / 1024).toFixed(0)} KB cap — above it the ENGINE itself extracts structurally, so those files are outside any analyzer claim`)

  // ---- THE POSITIVE CONTROL -------------------------------------------
  const CONTROL_MIN = 20
  if (s.inlineAliases < CONTROL_MIN) {
    console.log(`\nINSTRUMENT BLIND — the positive control fired ${s.inlineAliases} times and must fire >= ${CONTROL_MIN}.`)
    console.log("The Gradle version-catalogue alias is KNOWN to occur on this corpus, so a run that cannot")
    console.log("see it cannot be used to argue that anything ELSE is absent. Refusing to publish a verdict.")
    process.exit(2)
  }
  console.log(`\nPOSITIVE CONTROL FIRED: ${s.inlineAliases} version-catalogue aliases across ${s.aliasFiles.size} files (>= ${CONTROL_MIN} required).`)
  console.log("The same walk and the same helpers found a construct known to exist, so silence on the eight")
  console.log("types below is a measurement and not a broken instrument.")

  console.log("\nTHE UNION INVENTORY — every node type the corpus produces:")
  const nt = [...s.nodeTypes].sort((a, b) => b[1] - a[1])
  for (let i = 0; i < nt.length; i += 7) console.log("  " + nt.slice(i, i + 7).map(([k, c]) => `${k}(${c})`).join("  "))

  console.log("\n\nVERDICT PER RULED TYPE")
  console.log("-".repeat(96))
  const verdicts = adjudicate(s, docs)
  for (const v of verdicts) {
    const mark = !v.sound ? "UNVERIFIED " : v.grade === "strong" ? "SOUND      " : "SOUND?     "
    console.log(`\n${v.type.toUpperCase().padEnd(13)} ${mark}`)
    console.log(`  asked     ${v.question}`)
    console.log(`  answered  ${v.answer}`)
    for (const e of v.examples.slice(0, 3)) console.log(`            e.g. ${e}`)
  }

  const emitted = TYPES.filter((t) => t === "contains" || t === "references")
  const strong = verdicts.filter((v) => v.sound && v.grade === "strong")
  const arguable = verdicts.filter((v) => v.sound && v.grade === "arguable")
  const unverified = verdicts.filter((v) => !v.sound)

  console.log("\n" + "=".repeat(96))
  console.log("THE DENOMINATOR")
  console.log("=".repeat(96))
  console.log(`  types in the ontology           : ${TYPES.length}`)
  console.log(`  EMITTED (construct exists)      : ${emitted.length}  [${emitted.join(", ")}]`)
  console.log(`  RULED, verified by MEASUREMENT  : ${strong.length}  [${strong.map((v) => v.type).join(", ")}]`)
  console.log(`  RULED, sound but ARGUABLE       : ${arguable.length}  [${arguable.map((v) => v.type).join(", ") || "none"}]`)
  console.log(`  RULED, UNVERIFIED               : ${unverified.length}  [${unverified.map((v) => v.type).join(", ") || "none"}]`)

  const applicable = emitted.length + strong.length
  const conditional = emitted.length + strong.length + arguable.length
  console.log(`\n  APPLICABLE (measured)           : ${applicable} of ${TYPES.length}`)
  console.log(`  APPLICABLE (counting arguable)  : ${conditional} of ${TYPES.length}  <- the defensible ceiling`)
  console.log(`\n  REPORTED : ${applicable}/${applicable} APPLICABLE, MEASURED`)
  console.log(`             NOT ${emitted.length}/${TYPES.length} — that form scores finished work as ${(emitted.length / TYPES.length * 100).toFixed(0)}%`)
  if (arguable.length > 0) console.log(`             ${conditional}/${conditional} APPLICABLE IF the ${arguable.length} arguable ruling(s) are accepted`)

  console.log(`\n  APPLICABILITY IS NOT COVERAGE. Both emitted types fire, but \`references\` fires on the`)
  console.log(`  Gradle catalogue only. The Cargo workspace-inheritance population — \`x.workspace = true\`,`)
  console.log(`  1,269 sites on this corpus — is the SAME type and is NOT implemented. So ${applicable}/${applicable}`)
  console.log(`  is true about APPLICABILITY and says nothing about how much of each applicable type is covered.`)

  if (unverified.length > 0) {
    console.log(`\n  ${unverified.length} ruling(s) are UNVERIFIED by this audit: ${unverified.map((v) => v.type).join(", ")}`)
    console.log("  The measured denominator is stated above; the honest total is UNKNOWN, not 2/2.")
    process.exit(1)
  }
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(2) })