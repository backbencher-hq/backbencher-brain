/**
 * VUE ONTOLOGY CENSUS — the vue lane's instrument for the relationship-type
 * workstream (docs/analyzers/ONTOLOGY-WORKSTREAM.md Part 1 and Part 2).
 *
 * WHY A LANE-OWNED FILE, and why it does not import `differential.ts`.
 * `differential.ts` runs a corpus sweep on import, so an instrument cannot ask it
 * a question without starting a ~40-lane sweep; and it is MASTER-owned. This file
 * drives the PRODUCTION entry (`parseFile` from `src/ast/pool-worker`) itself and
 * computes its own numbers. It writes nothing outside `--out`.
 *
 * WHAT IS ANSWERED HERE, and by which instrument.
 *
 *   q1 EXISTS     source derivation. Not re-measured: `readEmittedTypes` in
 *                 script/m60/rel-type-coverage-gate.ts reads the analyzer's own
 *                 `RelationshipType.X` usages, and the gate prints them.
 *   q2 FIRES      `--emissions`: does production `parseFile` produce the label on
 *                 this corpus, with a count and the files. Derivation cannot see
 *                 a branch that never matches.
 *   q3 CORRECT    NOT claimed. The oracle is a second walker over the SAME
 *                 grammar, so a grammar bug shared by both is invisible to it.
 *                 This file records what the lane's own oracles state; the
 *                 correctness verdict stays with differential.ts.
 *   q4 LABELLED   per-type metadata + confidence + evidenceClass census, so the
 *                 label each site claims can be read against what it emits.
 *   q5 RESOLVED   both endpoints against TWO denominators, because for an SFC
 *                 they answer different questions (see below).
 *   q6 CONFIDENT  confidence histogram + evidenceClass histogram + the count
 *                 below 0.7, which is a heuristic rather than a fact.
 *   R7            empty names, placeholder-literal endpoints (file-writes-it
 *                 test), non-identifier endpoints, and symbols whose name the
 *                 file never writes.
 *
 * THE TWO RESOLUTION DENOMINATORS. This is the one place a vue census differs
 * from a file-scoped family's, and getting it wrong in either direction lies:
 *
 *   FILE-LOCAL   the endpoint is a symbol THIS .vue declares. Correct for the
 *                ownership edges (`contains`) and for a component's own members.
 *   CORPUS-WIDE  the endpoint is a symbol ANY admitted .vue declares. Correct
 *                for the cross-file edges — a template `<Card/>` names a
 *                component in a different file by design, and scoring it against
 *                the file it appears in would report ~0% resolution for the
 *                lane's largest correct edge class. Reporting only the
 *                file-local number would be a false defect; reporting only the
 *                corpus-wide number would hide a dangling `contains`.
 *
 * CONSTRUCT PROBES (Part 2). A ruling needs a measurement, and a measurement
 * needs an instrument chosen by the QUESTION, following ontology-coverage-gate:
 * A grammar inventory for a construct that needs a node type the grammar lacks,
 * a parse-tree semantic count for one expressible through a convention.
 *
 * CLI: npx tsx script/m14/vue-ontology-census.ts [--repo vuejs,element-plus]
 *      [--dir <abs dir override>] [--sample N] [--out <file.json>]
 *      [--shard i/n] [--probes]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const REPOS = (argOf("--repo", "vuejs") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
/** An out-of-tree corpus directory (a shallow sparse clone), because the machine
 *  this ran on had only vuejs/core's 11 SFCs and a ruling measured on 11 files
 *  is not a ruling. Added by this lane; the ontology gate itself reads only
 *  `$BB_CORPUS_ROOT/<repo>`, which is why the gate cannot see this corpus. */
const EXTRA_DIRS = (argOf("--dir", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const SAMPLE = parseInt(argOf("--sample", "0") ?? "0")
const OUT = argOf("--out")
const WANT_PROBES = process.argv.includes("--probes")
const MAX_BYTES = 512 * 1024

// ── corpus ────────────────────────────────────────────────────────────────────
type File = { repo: string; dir: string; rel: string; abs: string; text: string }
const files: File[] = []
const seenAbs = new Set<string>()
for (const e of REPOS) {
  const dir = path.join(process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories", e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > MAX_BYTES) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "vue") continue
    if (seenAbs.has(abs)) continue
    seenAbs.add(abs)
    files.push({ repo: e, dir, rel, abs, text })
  }
}
for (const dir of EXTRA_DIRS) {
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  const repo = path.basename(dir)
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (!rel.endsWith(".vue")) continue; if (statSync(abs).size > MAX_BYTES) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "vue") continue
    if (seenAbs.has(abs)) continue
    seenAbs.add(abs)
    files.push({ repo, dir, rel, abs, text })
  }
}
// Sorted, so a shard is a measurement of NAMED files and two runs agree.
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
const SHARD = process.argv.find((a) => a.startsWith("--shard="))
let draw = files
if (SHARD) {
  const [i, n] = SHARD.slice("--shard=".length).split("/").map(Number)
  draw = files.filter((_, k) => k % n === i)
} else if (SAMPLE > 0) {
  draw = files.slice(0, SAMPLE)
}
const corpusCommit = (() => {
  const out: Record<string, string> = {}
  for (const d of new Set(draw.map((f) => f.dir))) {
    try { out[d] = execFileSync("git", ["-C", d, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { out[d] = "unknown" }
  }
  return out
})()
console.log(`vue ontology census — repos ${[...new Set(draw.map((f) => f.repo))].join(",")}  admitted ${files.length}  drawn ${draw.length}`)
console.log(`corpus commits: ${JSON.stringify(corpusCommit)}`)

// ── 1. PRODUCTION EMISSION CENSUS (parseFile) ────────────────────────────────
type Row = { n: number; files: number; fileSet: Set<string>; sampleFiles: string[]; conf: Map<string, number>; ev: Map<string, number>; md: Map<string, number> }
const perType = new Map<Type, Row>()
for (const t of ALL_TYPES) perType.set(t, { n: 0, files: 0, fileSet: new Set(), sampleFiles: [], conf: new Map(), ev: new Map(), md: new Map() })

/**
 * R7 at runtime, with the register's own rule: a placeholder value is convicted
 * only when THE FILE DOES NOT WRITE IT. Case-folding alone convicted real
 * members in the go lane (`sql.ErrNoRows` is spelled `Unknown` in the crypto and
 * x/net packages). The test that discriminates is whether the value occurs in the
 * file's own text.
 */
const PLACEHOLDER_LITERALS = new Set(["unknown", "undefined", "null", "nil", "n/a", "na", "todo", "fixme", "?", "", "<name>", "unnamed", "anonymous", "symbol", "placeholder", "none", "untitled", "toplevel", "self", "dummy"])
const isPlaceholder = (v: string, fileText: string): boolean => {
  const low = v.trim().toLowerCase()
  if (!PLACEHOLDER_LITERALS.has(low)) return false
  return !fileText.toLowerCase().includes(low)
}
/** A vue symbol name is an identifier, a quoted option key, or — for the
 *  `imports` label's own convention — a `${modulePath}:${item}` composite. A
 *  character outside that set is counted, never excused. */
const isPlainName = (s: string): boolean => {
  if (s.length === 0) return false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const ok = (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) ||
      c === 95 || c === 36 || c === 46 || c === 47 || c === 58 || c === 45 || c === 64
    if (!ok) return false
  }
  return !(s.charCodeAt(0) >= 48 && s.charCodeAt(0) <= 57)
}

type Res = { both: number; sourceOnly: number; targetOnly: number; neither: number }
const resFile = new Map<Type, Res>()
const resCorpus = new Map<Type, Res>()
type Integ = { emptySource: number; emptyTarget: number; placeholderSource: number; placeholderTarget: number; nonIdentSource: number; nonIdentTarget: number; lines: number; noLine: number }
const integ = new Map<Type, Integ>()
for (const t of ALL_TYPES) {
  resFile.set(t, { both: 0, sourceOnly: 0, targetOnly: 0, neither: 0 })
  resCorpus.set(t, { both: 0, sourceOnly: 0, targetOnly: 0, neither: 0 })
  integ.set(t, { emptySource: 0, emptyTarget: 0, placeholderSource: 0, placeholderTarget: 0, nonIdentSource: 0, nonIdentTarget: 0, lines: 0, noLine: 0 })
}

const placeholderSamples: string[] = []
const unresSamples = new Map<Type, string[]>()
for (const t of ALL_TYPES) unresSamples.set(t, [])
/** file-local symbol names, and the same names across the whole draw. */
const corpusSymNames = new Set<string>()
/** Class-kind names = components. A template tag resolves against THIS set. */
const corpusComponentNames = new Set<string>()
type FileRecord = { repo: string; rel: string; symbols: string[]; components: string[] }
const fileRecords: FileRecord[] = []
/** Component member names, keyed by component name — the cross-file probe for
 *  `overrides` (a mixin base whose member the mixing component redeclares). */
const memberIndex = new Map<string, Set<string>>()
const mixinEdges: Array<{ repo: string; rel: string; component: string; base: string; isMixin: boolean }> = []

let fileCount = 0, symbolTotal = 0, relTotal = 0, parseFail = 0, parseErrors = 0
const wall0 = Date.now()
let idx = 0
/**
 * ONE parse per file, retained. The first version of this census walked the
 * corpus THREE times (emissions, then edge records for the exact corpus-wide
 * resolution, then symbols for the R7 pass), which cost 3x the wasm work for
 * three views of one parse. Retaining the stripped result makes the run linear
 * and — more to the point — makes the three views provably the same population:
 * three walks of a corpus whose file list can change mid-run would report three
 * slightly different denominators, which is the exact mistake the doc's
 * "two draws, two totals" note exists to prevent.
 */
type Retained = { fileIdx: number; rel: Array<{ t: Type; s: string; g: string }>; sym: Array<{ n: string; k: string; o?: string; synth?: boolean; decl?: boolean }> }
const retained: Retained[] = []
async function worker() {
  while (true) {
    const i = idx++
    if (i >= draw.length) return
    const f = draw[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { parseFail++; continue }
    fileCount++
    const label = `${f.repo}/${f.rel}`
    const symNames = new Set<string>()
    const compNames: string[] = []
    for (const s of r?.symbols ?? []) {
      if (typeof s?.name === "string" && s.name.length > 0) {
        symNames.add(s.name)
        corpusSymNames.add(s.name)
        if (s.kind === "Class" || s.kind === "class" || s.metadata?.isVueComponent) compNames.push(s.name)
      }
    }
    for (const c of compNames) corpusComponentNames.add(c)
    const members = new Set<string>()
    for (const s of r?.symbols ?? []) {
      if (typeof s?.name === "string" && s.ownerName) members.add(s.name)
      if (s?.metadata?.isMixin || s?.metadata?.inheritedFrom) members.add(s.name)
    }
    fileRecords.push({ repo: f.repo, rel: f.rel, symbols: [...symNames], components: compNames })
    symbolTotal += (r?.symbols ?? []).length
    relTotal += (r?.relationships ?? []).length
    parseErrors += (r?.errors ?? []).length
    // The draw index, carried because the workers finish out of order: the R7 pass
    // below joins retained symbols back to the file's own TEXT, and joining by
    // array position would silently score one file's names against another's.
    const keep: Retained = { fileIdx: i, rel: [], sym: [] }
    for (const s of r?.symbols ?? []) {
      keep.sym.push({
        n: String(s?.name ?? ""),
        k: String(s?.kind ?? ""),
        o: typeof s?.ownerName === "string" && s.ownerName.length > 0 ? s.ownerName : undefined,
        synth: s?.metadata?.synthesized === true,
        decl: s?.metadata?.declared === true,
      })
    }
    for (const x of r?.relationships ?? []) {
      const t = String(x.type ?? x.relationshipType ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      keep.rel.push({ t, s: String(x.source ?? ""), g: String(x.target ?? "") })
    }
    retained.push(keep)
    for (const x of r?.relationships ?? []) {
      const t = String(x.type ?? x.relationshipType ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      if (t === "extends") {
        mixinEdges.push({
          repo: f.repo, rel: f.rel,
          component: String(x.source ?? ""), base: String(x.target ?? ""),
          isMixin: x.metadata?.isMixin === true,
        })
      }
      const row = perType.get(t)!
      row.n++
      // A Set, not `sampleFiles.includes`: the sample list is CAPPED at six, so
      // once it is full the `includes` guard stops de-duplicating WITHIN a file and
      // `files` silently becomes an edge count. The first run of this census
      // reported `calls` in 7,138 files out of a 1,020-file corpus, which is how a
      // counting bug announces itself.
      if (!row.fileSet.has(label)) { row.fileSet.add(label); row.files++ }
      if (row.sampleFiles.length < 6 && !row.sampleFiles.includes(label)) row.sampleFiles.push(label)
      const confKey = String(x.confidence ?? "undefined")
      row.conf.set(confKey, (row.conf.get(confKey) ?? 0) + 1)
      const evKey = String(x.metadata?.evidenceClass ?? "none")
      row.ev.set(evKey, (row.ev.get(evKey) ?? 0) + 1)
      const mk = Object.keys(x.metadata ?? {}).filter((k) => k !== "evidenceClass").sort().join("+") || "(none)"
      row.md.set(mk, (row.md.get(mk) ?? 0) + 1)
      const src = String(x.source ?? "")
      const tgt = String(x.target ?? "")
      const ig = integ.get(t)!
      if (src.length === 0) ig.emptySource++
      if (tgt.length === 0) ig.emptyTarget++
      if (isPlaceholder(src, f.text)) { ig.placeholderSource++; if (placeholderSamples.length < 40) placeholderSamples.push(`${t}: ${label}: src=${JSON.stringify(src)}`) }
      if (isPlaceholder(tgt, f.text)) { ig.placeholderTarget++; if (placeholderSamples.length < 40) placeholderSamples.push(`${t}: ${label}: tgt=${JSON.stringify(tgt)}`) }
      if (!isPlainName(src)) ig.nonIdentSource++
      if (!isPlainName(tgt)) ig.nonIdentTarget++
      if (typeof x.line_number === "number") ig.lines++; else ig.noLine++
      const rf = resFile.get(t)!
      const sbF = symNames.has(src), tbF = symNames.has(tgt)
      if (sbF && tbF) rf.both++; else if (sbF) rf.sourceOnly++; else if (tbF) rf.targetOnly++; else rf.neither++
      const rc = resCorpus.get(t)!
      const sbC = corpusSymNames.has(src) || compNames.length > 0
      // corpus-wide: an endpoint is bound if ANY admitted file declares it. The
      // first pass sees a partial corpus, so the final number is recomputed below
      // from `fileRecords`; this incremental pass only keeps the two-pass cost down.
      const tbC = corpusSymNames.has(tgt) || corpusComponentNames.has(tgt)
      if (sbC && tbC) rc.both++; else if (sbC) rc.sourceOnly++; else if (tbC) rc.targetOnly++; else rc.neither++
      if (!(tbF || tbC) && unresSamples.get(t)!.length < 8) unresSamples.get(t)!.push(`${label}: ${src} -> ${tgt}`)
    }
    if (members.size) memberIndex.set(compNames[0] ?? f.rel, members)
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))
const wallMs = Date.now() - wall0

// ── 1b. CORPUS-WIDE RESOLUTION, recomputed with the complete symbol universe ───
// The incremental pass above cannot know a target declared by a file it has not
// read yet, so its corpus-wide column is an undercount. Recomputing from the
// single retained pass costs one pass over the edge list and is exact.
type EdgeRec = { type: Type; source: string; target: string }
const edgeRecs: EdgeRec[] = []
for (const k of retained) for (const e of k.rel) edgeRecs.push({ type: e.t, source: e.s, target: e.g })

const exactCorpus = new Map<Type, Res>()
for (const t of ALL_TYPES) exactCorpus.set(t, { both: 0, sourceOnly: 0, targetOnly: 0, neither: 0 })
for (const e of edgeRecs) {
  const rc = exactCorpus.get(e.type)!
  const sbC = corpusSymNames.has(e.source)
  const tbC = corpusSymNames.has(e.target)
  if (sbC && tbC) rc.both++; else if (sbC) rc.sourceOnly++; else if (tbC) rc.targetOnly++; else rc.neither++
}

// ── 2. SYMBOL-LEVEL R7: a name the file never writes ─────────────────────────
// The m60 surface audit's rule: `metadata.synthesized` is a DECLARATION that cuts
// the other way from a name allowlist, so an UNDECLARED synthesized name still
// fails. Reported, not suppressed.
//
// The "file never writes it" test is per SYMBOL and needs the file's own text, so
// it is joined by index rather than by a second parse.
let symbolsNeverWritten = 0, symbolsSynthesized = 0, symbolsSynthUndeclared = 0
const neverWrittenSamples: string[] = []
for (const k of retained) {
  const f = draw[k.fileIdx]
  const text = f.text
  for (const s of k.sym) {
    if (s.synth) {
      symbolsSynthesized++
      if (!s.decl && !text.includes(s.n)) symbolsSynthUndeclared++
    }
    if (!s.n) continue
    if (!text.includes(s.n)) {
      symbolsNeverWritten++
      if (neverWrittenSamples.length < 20) neverWrittenSamples.push(`${f.repo}/${f.rel}: ${s.k} ${JSON.stringify(s.n)}`)
    }
  }
}

// ── 3. CONSTRUCT PROBES ──────────────────────────────────────────────────────
// Every verdict needs a number. For each type with no emission, the construct
// that WOULD produce it is counted on the parse tree, through the PRODUCTION
// wasm the engine itself loads.
const probes: Record<string, unknown> = {}
if (WANT_PROBES) {
  const wts: any = await import("web-tree-sitter")
  const WSP = wts.Parser ?? wts.default
  const WSL = wts.Language ?? wts.default?.Language
  await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const wasmDir = path.join(process.cwd(), "wasm")
  const load = async (name: string) => {
    const p = new WSP()
    p.setLanguage(await WSL.load(readFileSync(path.join(wasmDir, name))))
    return p
  }
  const vueP = await load("tree-sitter-vue.wasm")
  const jsP = await load("tree-sitter-javascript.wasm")
  const tsP = await load("tree-sitter-typescript.wasm")

  /** Instrument A: every node type the vue grammar actually produces. */
  const vueNodeTypes = new Map<string, number>()
  for (const f of draw) {
    const t = vueP.parse(f.text)
    if (!t) continue
    const v = (n: any) => { vueNodeTypes.set(n.type, (vueNodeTypes.get(n.type) ?? 0) + 1); for (let i = 0; i < n.childCount; i++) v(n.child(i)) }
    v(t.rootNode); t.delete?.()
  }
  probes.vueGrammarNodeTypes = Object.fromEntries([...vueNodeTypes.entries()].sort((a, b) => b[1] - a[1]))

  /** Instrument B on the SCRIPT subtree, which the engine parses with the JS/TS
   *  grammar. `implements` lives in a `lang="ts"` block and nowhere else, so the
   *  tsx/js/ts grammars are all needed. Counts node types a construct would use. */
  const scriptNodeTypes = new Map<string, number>()
  const implHits: string[] = []
  const classHits: string[] = []
  const newExprHits: string[] = []
  const extendsClauseHits: string[] = []
  for (const f of draw) {
    // Locate every <script> block's body with the vue grammar, exactly as the
    // engine does, then hand each body to the JS/TS grammars.
    const t = vueP.parse(f.text)
    if (!t) continue
    const bodies: Array<{ text: string; lang: string | undefined }> = []
    const stack: any[] = [t.rootNode]
    while (stack.length) {
      const n = stack.pop()
      if (n.type === "script_element") {
        let body: any = null, lang: string | undefined
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c.type === "raw_text") body = c
          if (c.type === "attribute" && c.childForFieldName?.("name")?.text === "lang") {
            lang = String(c.childForFieldName?.("value")?.text ?? "").replace(/^["']|["']$/g, "")
          }
        }
        if (body) bodies.push({ text: body.text, lang })
      }
      for (let i = 0; i < n.childCount; i++) if (n.child(i)) stack.push(n.child(i))
    }
    t.delete?.()
    for (const b of bodies) {
      const isTs = b.lang === "ts" || b.lang === "tsx"
      const p = isTs ? tsP : jsP
      const st = p.parse(b.text)
      if (!st) continue
      const v = (n: any) => {
        scriptNodeTypes.set(n.type, (scriptNodeTypes.get(n.type) ?? 0) + 1)
        if (n.type === "implements_clause") implHits.push(`${f.repo}/${f.rel}`)
        if (n.type === "class_declaration") classHits.push(`${f.repo}/${f.rel}`)
        if (n.type === "new_expression") newExprHits.push(`${f.repo}/${f.rel}`)
        if (n.type === "extends_clause") extendsClauseHits.push(`${f.repo}/${f.rel}`)
        for (let i = 0; i < n.childCount; i++) v(n.child(i))
      }
      v(st.rootNode); st.delete?.()
    }
  }
  probes.scriptNodeTypesOfInterest = {
    implements_clause: scriptNodeTypes.get("implements_clause") ?? 0,
    class_declaration: scriptNodeTypes.get("class_declaration") ?? 0,
    class: scriptNodeTypes.get("class") ?? 0,
    interface_declaration: scriptNodeTypes.get("interface_declaration") ?? 0,
    extends_clause: scriptNodeTypes.get("extends_clause") ?? 0,
    extends: scriptNodeTypes.get("extends") ?? 0,
    new_expression: scriptNodeTypes.get("new_expression") ?? 0,
    method_definition: scriptNodeTypes.get("method_definition") ?? 0,
    function_declaration: scriptNodeTypes.get("function_declaration") ?? 0,
    lexical_declaration: scriptNodeTypes.get("lexical_declaration") ?? 0,
    totalDistinctScriptNodeTypes: scriptNodeTypes.size,
  }
  probes.implementsHits = { occurrences: implHits.length, files: [...new Set(implHits)].slice(0, 8) }
  probes.classDeclarationHits = { occurrences: classHits.length, files: [...new Set(classHits)].slice(0, 8) }
  probes.newExpressionHits = { occurrences: newExprHits.length, files: [...new Set(newExprHits)].slice(0, 8) }
  probes.extendsClauseHits = { occurrences: extendsClauseHits.length, files: [...new Set(extendsClauseHits)].slice(0, 8) }

  /**
   * `overrides` needs a semantic probe, not a grammar one. Vue's option merge is
   * a CONVENTION with no keyword: `mixins: [M]` and `extends: M` merge M's
   * options into this component, and a same-named member declared here REPLACES
   * M's. That is an override in the only sense the language has one, so a grammar
   * inventory is blind to it by construction.
   *
   * Two shapes are counted separately, because conflating them would overstate:
   *   SAME-FILE   `extends: { methods: { save() } }` merges an inline object whose
   *               members are already published as this component's members by
   *               the analyzer — so there is no second DECLARATION to collide.
   *               The real same-file case is a member declared BOTH in the inline
   *               merge object and in the component's own `methods`/`computed`/
   *               `watch` block, which is counted from the analyzer's own symbols.
   *   CROSS-FILE  component X declares `mixins: [M]`/`extends: M`, and some other
   *               admitted file exports a component named M. If X also declares a
   *               member named K and M declares member K, X's K replaces M's K.
   */
  const crossFileOverrides: Array<{ component: string; base: string; member: string; file: string }> = []
  for (const e of mixinEdges) {
    const own = memberIndex.get(e.component)
    if (!own) continue
    const baseMembers = memberIndex.get(e.base)
    if (!baseMembers) continue
    for (const k of own) {
      if (baseMembers.has(k)) crossFileOverrides.push({ component: e.component, base: e.base, member: k, file: `${e.repo}/${e.rel}` })
    }
  }
  const basesResolvable = mixinEdges.filter((e) => memberIndex.has(e.base)).length
  probes.overrides = {
    heritageEdges: mixinEdges.length,
    heritageEdgesWithABaseResolvableInCorpus: basesResolvable,
    heritageExamples: mixinEdges.slice(0, 8),
    crossFileOverrideCandidates: crossFileOverrides.length,
    crossFileOverrideExamples: crossFileOverrides.slice(0, 12),
  }
}

// ── report ────────────────────────────────────────────────────────────────────
const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`)
const table: Record<string, unknown>[] = []
for (const t of ALL_TYPES) {
  const row = perType.get(t)!
  const rf = resFile.get(t)!
  const rc = exactCorpus.get(t)!
  const ig = integ.get(t)!
  const total = row.n
  table.push({
    type: t,
    verdict: total > 0 ? "EMITTED" : "NO-EMISSION",
    count: total,
    files: row.files,
    sampleFiles: row.sampleFiles,
    resolutionFileLocal: { bothEnds: rf.both, sourceOnly: rf.sourceOnly, targetOnly: rf.targetOnly, neither: rf.neither, bothRate: pct(rf.both, total) },
    resolutionCorpusWide: { bothEnds: rc.both, sourceOnly: rc.sourceOnly, targetOnly: rc.targetOnly, neither: rc.neither, bothRate: pct(rc.both, total) },
    integrity: { emptySource: ig.emptySource, emptyTarget: ig.emptyTarget, placeholderSource: ig.placeholderSource, placeholderTarget: ig.placeholderTarget, nonIdentSource: ig.nonIdentSource, nonIdentTarget: ig.nonIdentTarget, withLine: ig.lines, withoutLine: ig.noLine },
    confidence: Object.fromEntries([...row.conf.entries()].sort((a, b) => b[1] - a[1])),
    heuristicBelowPoint7: [...row.conf.entries()].filter(([k]) => k !== "undefined" && Number(k) < 0.7).reduce((a, [, v]) => a + v, 0),
    evidenceClass: Object.fromEntries([...row.ev.entries()].sort((a, b) => b[1] - a[1])),
    metadataShapes: Object.fromEntries([...row.md.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)),
    unresolvedTargetSamples: unresSamples.get(t),
  })
}
console.log("\n" + "=".repeat(110))
console.log("VUE ONTOLOGY CENSUS — per-type verdicts")
console.log("=".repeat(110))
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`${w("type", 14)}${w("verdict", 14)}${w("edges", 9)}${w("files", 7)}${w("res(file)", 11)}${w("res(corp)", 11)}${w("<0.7", 7)}${w("empty tgt", 11)}`)
console.log("-".repeat(110))
for (const r of table as any[]) {
  console.log(`${w(r.type, 14)}${w(r.verdict, 14)}${w(String(r.count), 9)}${w(String(r.files), 7)}${w(r.resolutionFileLocal.bothRate, 11)}${w(r.resolutionCorpusWide.bothRate, 11)}${w(String(r.heuristicBelowPoint7), 7)}${w(String(r.integrity.emptyTarget + r.integrity.placeholderTarget), 11)}`)
}
console.log("-".repeat(110))
console.log(`files ${fileCount}  symbols ${symbolTotal.toLocaleString()}  relationships ${relTotal.toLocaleString()}  parseFail ${parseFail}  parseErrors ${parseErrors}  wall ${(wallMs / 1000).toFixed(1)}s`)
console.log(`symbols whose name the file never writes: ${symbolsNeverWritten} (synthesized ${symbolsSynthesized}, synthesized+undeclared+never-written ${symbolsSynthUndeclared})`)
if (placeholderSamples.length) {
  console.log("\nR7 placeholder-literal endpoints (first 40):")
  for (const s of placeholderSamples) console.log("  " + s)
}
for (const t of ALL_TYPES) {
  const s = unresSamples.get(t)!
  if (s.length && perType.get(t)!.n > 0) {
    console.log(`\n${t}: targets resolving at NEITHER denominator (first 8 of ${unresSamples.get(t)!.length}):`)
    for (const x of s) console.log("  " + x)
  }
}
if (WANT_PROBES) {
  console.log("\n" + "=".repeat(110))
  console.log("CONSTRUCT PROBES")
  console.log("=".repeat(110))
  console.log(JSON.stringify({ scriptNodeTypesOfInterest: (probes as any).scriptNodeTypesOfInterest, implementsHits: (probes as any).implementsHits, classDeclarationHits: (probes as any).classDeclarationHits, newExpressionHits: (probes as any).newExpressionHits, extendsClauseHits: (probes as any).extendsClauseHits, overrides: (probes as any).overrides }, null, 2))
  console.log("\nvue grammar node types observed: " + Object.keys((probes as any).vueGrammarNodeTypes ?? {}).length)
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    schemaVersion: 1,
    at: new Date().toISOString(),
    corpus: { repos: [...new Set(draw.map((f) => f.repo))], admitted: files.length, drawn: draw.length, commits: corpusCommit, rule: "sorted git ls-files, .vue only, <=512KB" },
    runtime: { files: fileCount, symbols: symbolTotal, relationships: relTotal, parseFail, parseErrors, wallMs },
    perType: table,
    symbols: { neverWritten: symbolsNeverWritten, synthesized: symbolsSynthesized, synthesizedUndeclaredNeverWritten: symbolsSynthUndeclared, neverWrittenSamples },
    r7PlaceholderSamples: placeholderSamples,
    probes,
    instrument: "production ASTEngine.parseFile via src/ast/pool-worker",
  }, null, 2))
  console.log(`\nevidence: ${OUT}`)
}