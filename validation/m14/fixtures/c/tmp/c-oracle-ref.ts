/**
 * C-ORACLE — the second walker, and what it is and is not able to convict.
 *
 * ## Why this file exists
 *
 * `validation/m60/rel-type-coverage-baseline.json` carries two open DERIVATION
 * findings for this lane:
 *
 *   DERIVATION|c|emits `contains` but the differential audits
 *               ["calls","extends","implements","imports","instantiates",
 *                "overrides","references","uses"] -- the type is stored and
 *               compared against nothing
 *   DERIVATION|c|emits `exports`  but ... -- the type is stored and compared
 *               against nothing
 *
 * and a DERIVATION finding is defined by the workstream as "a type an analyzer EMITS
 * that the differential NEVER audits: stored and compared against nothing ... an
 * unverified edge ships a bug invisibly". `overrides` becomes a THIRD the moment it
 * fires on this corpus, which #989 did.
 *
 * `contains` is already covered here by a better instrument than a second walker could
 * be: `c-audit/contains-vs-clang.ts` judges it against **clang 14**, a different parser
 * with a different recovery strategy, so agreement is evidence rather than a tautology.
 * That measurement is reported, not reproduced.
 *
 * This file therefore covers `exports` and `overrides`, and its limitation is stated
 * where it can be read rather than left to be inferred:
 *
 *   IT IS A SEPARATE WALKER OVER THE SAME GRAMMAR. So a defect in the GRAMMAR is
 *   invisible to it, exactly as it is invisible to the differential. What it CAN
 *   convict is a disagreement between two INDEPENDENT IMPLEMENTATIONS of the rule --
 *   a different traversal order, a different name read, a different set of node types
 *   consulted. `calls`, `uses`, `references` and `imports` already have that for C in
 *   `script/m14/differential.ts`'s `deriveCCalls`; these two did not, and this is the
 *   per-lane oracle the ruby lane moved out of the shared differential for the same
 *   reason (`ruby-truth.ts`, `RUBY_ORACLE_LABELS`).
 *
 * ## The comparison
 *
 * Per file, per label, on the (source, target) PAIR and the LINE, in BOTH directions:
 *
 *   MISSING      the oracle derives it and the payload has none
 *   UNEXPLAINED  the payload emits it and the oracle derives none
 *
 * Superset oracles are a trap the workstream names: a superset trades a fabrication for
 * an unexplained edge. So each label's oracle states what it REFUSES, and every refusal
 * below is a refusal the oracle makes by the same rule the analyzer uses -- if the two
 * disagree about a refusal, that disagreement is the finding.
 *
 * ## No regex
 * Node types, `childForFieldName`, `namedChild`, ancestor walks, character scans over
 * node text already extracted. The `#undef` keyword test is the same `startsWith` on a
 * directive token the analyzer uses, written out rather than imported so the oracle does
 * not import the code under test.
 *
 * ## Reproduce
 *   bun run script/m14/tmp/c-audit/c-oracle.ts \
 *     --repos /home/ishaq2321/bb_tests/repositories/sqlite
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..", "..", "..")
const argv = process.argv.slice(2)
const arg = (name: string, dflt: string): string => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const REPOS = arg("repos", "/home/ishaq2321/bb_tests/repositories/sqlite").split(",").map((s) => s.trim()).filter(Boolean)
const OUT = arg("out", path.join(ROOT, "script/m14/tmp/c-audit/c-oracle.json"))
const EXTS = [".c", ".h"]

const { detectLanguageFromPath } = await import(path.join(ROOT, "src/ast/language-detection.ts"))
const { getParser } = await import(path.join(ROOT, "src/ast/engine.ts"))
const parser: any = await getParser("c")
const poolWorker: any = await import(path.join(ROOT, "src/ast/pool-worker.ts"))

// ---------------------------------------------------------------- oracle primitives
function firstWord(text: string): string {
  let i = 0
  const ws = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r"
  while (i < text.length && ws(text[i])) i++
  const s = i
  while (i < text.length && !ws(text[i])) i++
  return text.slice(s, i)
}
function isBareIdentifier(s: string): boolean {
  if (s.length === 0) return false
  const word = (c: string) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_"
  if (!word(s[0]) || (s[0] >= "0" && s[0] <= "9")) return false
  for (let i = 1; i < s.length; i++) if (!word(s[i])) return false
  return true
}
function undefNameOf(call: any): string | null {
  const d = call.childForFieldName?.("directive")
  if (!d) return null
  let t = d.text
  if (t.length === 0 || t[0] !== "#") return null
  t = t.slice(1)
  let i = 0
  while (i < t.length && (t[i] === " " || t[i] === "\t")) i++
  if (!t.startsWith("undef", i)) return null
  const arg = call.childForFieldName?.("argument")
  return isBareIdentifier(arg ? arg.text.trim() : "") ? arg.text.trim() : null
}
function conditionalsOf(node: any): Map<number, number> {
  const out = new Map<number, number>()
  let arm = 0
  let p = node.parent
  while (p) {
    if (p.type === "preproc_elif" || p.type === "preproc_else") { arm++; p = p.parent; continue }
    if (p.type === "preproc_if" || p.type === "preproc_ifdef") { out.set(p.startIndex, arm); arm = 0 }
    p = p.parent
  }
  return out
}
function exclusiveArm(a: Map<number, number>, b: Map<number, number>): boolean {
  for (const [k, v] of a) { const w = b.get(k); if (w !== undefined && w !== v) return true }
  return false
}
function firstMacroName(spec: any): string {
  for (let i = 0; i < spec.namedChildCount; i++) {
    const c = spec.namedChild(i)
    if (c && (c.type === "macro_specifier" || c.type === "identifier")) return c.text.trim()
  }
  return ""
}
/** The identifier a declarator chain names, or null. Stops at the first one, and SKIPS an
 *  ERROR subtree -- the #990 rule, re-derived here rather than imported, because an
 *  oracle that imports the analyzer's rule cannot convict the analyzer of a wrong one. */
function declaratorName(node: any): any {
  const st: any[] = [node]
  while (st.length) {
    const c = st.pop()!
    if (c.type === "identifier" || c.type === "field_identifier") return c
    for (let i = c.namedChildCount - 1; i >= 0; i--) {
      const cc = c.namedChild(i)
      if (cc && !cc.isError && !cc.isMissing) st.push(cc)
    }
  }
  return null
}
const C_KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "return", "sizeof", "goto",
  "break", "continue", "default", "auto", "register", "restrict", "volatile",
  "int", "char", "void", "static", "const", "struct", "union", "enum", "typedef",
  "unsigned", "signed", "long", "short", "float", "double", "extern", "inline",
])
/** #963's fixed five-name list, transcribed. The oracle must hold the analyzer to BOTH
 *  halves of the marker rule, so it needs the list too -- and transcribing it is what
 *  keeps "the oracle agrees" from meaning "the oracle shares a constant". */
const KNOWN_MARKERS = ["EXPORT_SYMBOL", "EXPORT_SYMBOL_GPL", "CURL_EXTERN", "REDISMODULE_API", "GIT_EXTERN"]

// ---------------------------------------------------------------- discovery
function discover(): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    let ents: fs.Dirent[]
    try { ents = fs.readdirSync(d, { withFileTypes: true }) as any } catch { return }
    for (const e of ents.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name === ".git" || e.name === "node_modules") continue
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (EXTS.some((x) => e.name.endsWith(x))) out.push(full)
    }
  }
  for (const r of REPOS) walk(r)
  out.sort()
  return out
}
const all = discover()
const baseDir = REPOS[0]
const rel = (f: string) => path.relative(baseDir, f)

interface Edge { source: string; target: string; line: number; note: string }
const oracle: Record<string, Edge[]> = { exports: [], overrides: [] }
interface OracleEdge extends Edge { file?: string }
const payload: Record<string, Edge[]> = { exports: [], overrides: [] }
let skippedByRouter = 0
let skippedHuge = 0
const reachGaps: Array<Record<string, number | string>> = []
const payloadOverridesExcluded: Array<Record<string, string | number>> = []
const overridesExcluded = new Set<string>()
const examples: Record<string, { missing: string[]; unexplained: string[] }> = {
  exports: { missing: [], unexplained: [] },
  overrides: { missing: [], unexplained: [] },
}

for (const f of all) {
  const src = fs.readFileSync(f, "utf8")
  if (String(detectLanguageFromPath(f, src) ?? "") !== "c") { skippedByRouter++; continue }
  if (src.length > 1024 * 1024) { skippedHuge++; continue }
  const r = rel(f)
  let tree: any
  try { tree = parser.parse(src) } catch { continue }
  if (!tree) continue

  // ---------------------------------------------------------------- the ORACLE pass
  // PRE-ORDER, not the analyzer's stack-drain order, so a traversal difference is one
  // of the things being tested rather than one of the things being assumed.
  const linkageExtern = new Set<string>()
  const linkageEmpty = new Set<string>()
  const markerOrder: Array<{ name: string; row: number; idx: number; undef: boolean }> = []
  const fnDefs = new Map<string, any[]>()
  const condSeen = new Set<string>()
  const walked: string[] = []
  const visit = (n: any): void => {
    walked.push(n.type)
    if (n.type === "preproc_def" || n.type === "preproc_function_def") {
      const nm = n.childForFieldName("name")
      if (nm) {
        // #991, re-derived: an ERROR child BEFORE the name means the grammar lost the
        // macro name, so there is no declared name to read.
        let errorBefore = false
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (!c) continue
          if (c.id === nm.id) break
          if (c.isError || c.isMissing) { errorBefore = true; break }
        }
        if (!errorBefore) {
          let hasValue = false
          for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && c.type === "preproc_arg") hasValue = true }
          if (!hasValue) linkageEmpty.add(nm.text)
          else {
            const args: any[] = []
            const st: any[] = [n]
            while (st.length) {
              const c = st.pop()!
              if (c.type === "preproc_arg") args.push(c)
              for (let i = 0; i < c.namedChildCount; i++) { const cc = c.namedChild(i); if (cc) st.push(cc) }
            }
            if (firstWord(args[0] ? args[0].text : "") === "extern") linkageExtern.add(nm.text)
            markerOrder.push({ name: nm.text, row: n.startPosition.row + 1, idx: n.startIndex, undef: false })
          }
        }
      }
    } else if (n.type === "preproc_call") {
      const u = undefNameOf(n)
      if (u) markerOrder.push({ name: u, row: n.startPosition.row + 1, idx: n.startIndex, undef: true })
    } else if (n.type === "function_definition") {
      const d = n.childForFieldName("declarator")
      if (d) {
        // the plain route first, then the macro-wrapped TYPED heading
        let id = declaratorName(d)
        if (!id || C_KEYWORDS.has(id.text)) {
          // `CMPP__EXPORT(void *, f)(...)` puts the parameter list in the declarator slot
          for (let i = 0; i < d.namedChildCount; i++) {
            const c = d.namedChild(i)
            if (c && c.type === "parenthesized_type_identifier") { id = declaratorName(c); break }
          }
        }
        if (id && isBareIdentifier(id.text) && !C_KEYWORDS.has(id.text)) {
          const arr = fnDefs.get(id.text) ?? []
          arr.push({ node: n, id })
          fnDefs.set(id.text, arr)
        }
      }
    } else if (n.type === "declaration") {
      const t = n.childForFieldName("type")
      const marker = t && (t.type === "macro_prefixed_type_specifier" || t.type === "macro_type_specifier")
        ? firstMacroName(t)
        : t && t.type === "identifier" ? t.text.trim() : ""
      const isMarker = marker !== "" && (KNOWN_MARKERS.includes(marker) || linkageExtern.has(marker))
      if (isMarker) {
        const d = n.childForFieldName("declarator")
        if (d) {
          const id = declaratorName(d)
          // an exported name can never BE the marker (the recovery-split self-reference)
          if (id && id.text.trim() !== "" && id.text.trim() !== marker) {
            // LINE ON THE NAME NODE, not on the declaration. This is the M59.A7 / #921
            // contract ("the line that NAMES it") and the oracle's first version used
            // `n.startPosition.row`, which is the DECLARATION's line -- and disagreed
            // with the payload by exactly one row on
            // `ext/wasm/libcmpp.c:764 CMPP_EXPORT` / `:765 void cmpp_outputer_set(...)`,
            // where the marker sits on a line of its own. The oracle was the wrong side
            // of that row and is re-aimed here rather than the payload moved.
            oracle.exports.push({ source: id.text.trim(), target: marker, line: id.startPosition.row + 1, note: "", file: r })
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c) }
  }
  visit(tree.rootNode)

  // -- `overrides`, shape 1: two definitions in different arms of one conditional
  for (const [name, defs] of fnDefs) {
    if (defs.length < 2) continue
    for (let i = 1; i < defs.length; i++) {
      if (exclusiveArm(conditionalsOf(defs[0].node), conditionalsOf(defs[i].node))) {
        const k = `${name}::cond::${defs[i].id.startPosition.row + 1}`
        // ONE EDGE PER (name, arm), the dedup #963 established for the pair: an
        // amalgamated build declares the same exported name twice and that is one fact.
        // Without it the oracle is a strict SUPERSET on that shape -- which the
        // workstream calls a trap, because a superset trades a fabrication for an
        // unexplained edge.
        if (!condSeen.has(k)) { condSeen.add(k); oracle.overrides.push({ source: name, target: name, line: defs[i].id.startPosition.row + 1, note: "conditional-redefinition", file: r }) }
      }
    }
  }
  // -- shape 2: #undef then #define of one macro
  {
    markerOrder.sort((a, b) => a.idx - b.idx)
    const undefed = new Set<string>()
    const lastDef = new Map<string, number>()
    const seen = new Set<string>()
    for (const m of markerOrder) {
      if (m.undef) { undefed.add(m.name); continue }
      const prior = lastDef.get(m.name)
      if (prior !== undefined && undefed.has(m.name)) {
        const k = `${m.name}::${m.row}`
        if (!seen.has(k)) {
          seen.add(k)
          oracle.overrides.push({ source: m.name, target: m.name, line: m.row, note: "undef-redefine", file: r })
        }
      }
      lastDef.set(m.name, m.row)
      undefed.delete(m.name)
    }
  }

  // ---------------------------------------------------------------- CONTAINMENT
  //
  // This lane already records the failure this guards: a `#define` the grammar absorbs
  // produces NO node, so a walker that reads only nodes is blind in a region the payload
  // still covers through #934's line-anchored inventory. It is real and it is measured
  // here -- sqlite `src/btree.c:168/201/202` puts `#define SHARED_LOCK_TRACE`, `#undef
  // SHARED_LOCK_TRACE` and `#define SHARED_LOCK_TRACE` inside an `#if 0` that also holds
  // a function DEFINITION, and the walk sees fewer preproc nodes than the file has
  // directive lines.
  //
  // So the oracle COUNTS what the file's own lines carry (a line whose first non-space
  // character is `#` introduces a directive -- the one shape a C lexer defines unaided,
  // and the same definition #934 uses) and compares that with the nodes it reached. A
  // file where the two disagree is EXCLUDED from the `overrides` comparison with the
  // reason recorded, because an instrument that cannot see a region must not testify
  // about it. It is not excluded from `exports`, which reads declarations rather than
  // directives; the two are counted separately and the counts are printed.
  const directiveLines: string[] = []
  {
    let start = 0
    while (start <= src.length) {
      let end = src.indexOf("\n", start)
      if (end < 0) end = src.length
      const line = src.slice(start, end)
      let k = 0
      while (k < line.length && (line[k] === " " || line[k] === "\t")) k++
      if (k < line.length && line[k] === "#") directiveLines.push(`${end + 1}:${line.slice(k, k + 10).trim()}`)
      start = end + 1
      if (end >= src.length) break
    }
  }
  let preprocNodesSeen = 0
  {
    const st: any[] = [tree.rootNode]
    while (st.length) {
      const c = st.pop()!
      if (c.type.startsWith("preproc_")) preprocNodesSeen++
      for (let i = 0; i < c.childCount; i++) { const cc = c.child(i); if (cc) st.push(cc) }
    }
  }
  const directiveNode = preprocNodesSeen
  const oracleSeesAllDirectives = directiveNode >= directiveLines.length
  if (!oracleSeesAllDirectives) {
    reachGaps.push({ file: r, directiveLines: directiveLines.length, preprocNodes: directiveNode, missed: directiveLines.length - directiveNode })
    // drop this file's ORACLE `overrides` rows too, so the two sides describe the same population
    oracle.overrides = oracle.overrides.filter((e) => !(e.note === "conditional-redefinition" && e.file === r) && !(e.note === "undef-redefine" && e.file === r))
  }

  // ---------------------------------------------------------------- the PAYLOAD pass
  let pr: any
  try { pr = await poolWorker.parseFile(f, baseDir) } catch { pr = { relationships: [] } }
  for (const e of pr.relationships ?? []) {
    const t = String(e.type ?? "")
    if (t !== "exports" && t !== "overrides") continue
    // A file whose directives the walk could not account for is excluded from
    // `overrides` on BOTH sides -- excluded, not excused: the rows are counted and
    // printed, so the reader can see what the exclusion cost.
    if (t === "overrides" && !oracleSeesAllDirectives) { if (!overridesExcluded.has(r)) { overridesExcluded.add(r); payloadOverridesExcluded.push({ source: String(e.source), target: String(e.target), line: Number(e.line_number ?? -1), note: "file excluded: the walk cannot account for its directives" }) } continue }
    payload[t].push({ source: String(e.source), target: String(e.target), line: Number(e.line_number ?? -1), note: String((e.metadata ?? {}).shape ?? "") })
  }

  try { tree.delete?.() } catch {}
}

// ---------------------------------------------------------------- dedup, #963's contract
//
// `exports` is ONE EDGE PER (name, marker): the same name declared twice is one fact.
// sqlite `autosetup/jimsh0.c` declares `JIM_EXPORT int Jim_CreateCommand(...)` at BOTH
// :937 and :949 -- an amalgamated-build artefact -- and the payload publishes one edge at
// :937. Without this dedup the oracle is a strict SUPERSET on that row, which the
// workstream names as a trap: a superset trades a fabrication for an unexplained edge.
// Deduped on (source,target), keeping the LOWEST line, so the oracle reads the
// declaration order the way a file-scope pass does.
{
  const best = new Map<string, { line: number; file?: string; note: string }>()
  for (const e of oracle.exports) {
    const k = `${e.source}|${e.target}`
    const cur = best.get(k)
    if (!cur || e.line < cur.line) best.set(k, { line: e.line, file: e.file, note: e.note })
  }
  oracle.exports = [...best.entries()].map(([k, v]) => {
    const parts = k.split("|")
    return { source: parts[0], target: parts[1], line: v.line, note: v.note, file: v.file as string | undefined }
  })
}

// ---------------------------------------------------------------- compare
function key(e: Edge): string {
  return `${e.source}|${e.target}|${e.line}`
}
interface Cmp { missing: number; unexplained: number; rows: string[] }
function compare(label: string): Cmp {
  const a = new Map<string, Edge>()
  for (const e of oracle[label]) a.set(key(e), e)
  const b = new Map<string, Edge>()
  for (const e of payload[label]) b.set(key(e), e)
  const rows: string[] = []
  let missing = 0
  let unexplained = 0
  for (const [k, e] of a) if (!b.has(k)) { missing++; if (rows.length < 20) rows.push(`MISSING      ${k}  ${e.note}`) }
  for (const [k, e] of b) if (!a.has(k)) { unexplained++; if (rows.length < 40) rows.push(`UNEXPLAINED  ${k}  ${e.note}`) }
  return { missing, unexplained, rows }
}

const res: Record<string, Cmp> = { exports: compare("exports"), overrides: compare("overrides") }
const out = {
  schemaVersion: 1,
  instrument: "script/m14/tmp/c-audit/c-oracle.ts",
  measuredAt: new Date().toISOString(),
  population: {
    repos: REPOS,
    ext: EXTS,
    derivedFiles: all.length,
    cRoutedFiles: all.length - skippedByRouter,
    excludedByRouter: skippedByRouter,
    excludedOver1MiB: skippedHuge,
    entry: "oracle: engine getParser('c') over the file's own text (the ANALYZER's content masking is not applied -- the two walkers must see the same tree, and this file's comparison is about the RULE, not about the masking). payload: pool-worker.parseFile.",
    note: "A file over 1 MiB is excluded from BOTH sides rather than measured on one, so the two counts describe the same population.",
  },
  limitation: "A SECOND WALKER OVER THE SAME GRAMMAR. It convicts a disagreement between two independent implementations of a rule; it cannot see a defect in the grammar, because both read the same parse. The only independent reference this lane has is clang 14 (contains-vs-clang.ts, layout-vs-clang.ts), and that covers `contains`, not these two.",
  derivationDebt: {
    closed: ["contains"],
    closedHow: "contains-vs-clang.ts against clang 14 -- a different parser with a different recovery strategy. Re-measured on this corpus at 421/421 = 100.00% members agreed over 33 records (was 414/421 = 98.34% before #990).",
    addressedHere: ["exports", "overrides"],
    stillUnaudited: ["exports (no independent-PARSER oracle exists; this file is a second walker over the same grammar)"],
  },
  reach: {
    filesWhereTheWalkCannotAccountForEveryDirective: reachGaps.length,
    excludedFromOverridesComparison: [...overridesExcluded],
    payloadOverridesRowsExcluded: payloadOverridesExcluded,
    gaps: reachGaps,
    rule: "A file whose `#`-lines outnumber its preproc_* nodes is EXCLUDED from the `overrides` comparison on BOTH sides. An instrument that cannot see a region must not testify about it; the excluded rows are counted rather than dropped quietly.",
  },
  oracleEdges: { exports: oracle.exports.length, overrides: oracle.overrides.length },
  payloadEdges: { exports: payload.exports.length, overrides: payload.overrides.length },
  comparison: res,
}
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n")

console.log(`reach: ${reachGaps.length} file(s) excluded from the \`overrides\` comparison (walk cannot account for every \`#\` line) -- ${reachGaps.slice(0, 8).map((g) => `${g.file} (${g.missed} of ${g.directiveLines})`).join("; ")}`)
console.log(`population: ${out.population.cRoutedFiles} C-routed files of ${all.length} derived (${skippedByRouter} excluded by the router, ${skippedHuge} over 1 MiB)\n`)
for (const label of ["exports", "overrides"]) {
  const c = res[label]
  console.log(`${label}: oracle ${out.oracleEdges[label]} edges, payload ${out.payloadEdges[label]} edges`)
  console.log(`   MISSING (oracle says, payload silent)     ${c.missing}`)
  console.log(`   UNEXPLAINED (payload emits, oracle blind) ${c.unexplained}`)
  for (const r of c.rows) console.log(`     ${r}`)
  console.log("")
}
console.log(out.limitation)
console.log(`\nwrote ${OUT}`)