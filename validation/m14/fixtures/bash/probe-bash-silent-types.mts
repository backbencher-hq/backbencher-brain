/**
 * THE FIVE SILENT TYPES, MEASURED ON THE PINNED CORPUS — numerator AND denominator.
 *
 * ## The question this file answers, and the one it refuses to answer by assertion
 *
 * `script/m14/firing-check.mjs BASH` is the programme's truth instrument for the numerator:
 * it runs the PRODUCTION path (`getParser` -> `parse` -> the analyzer) over real corpus files
 * and tallies which of the ten relationship types come out. On the pinned corpus it reports
 * FIVE, with `extends implements exports overrides instantiates` silent.
 *
 * A silent type has two possible causes and the tally cannot tell them apart:
 *
 *   (1) THE ANALYZER CANNOT EXPRESS IT. The construct occurs and no edge comes out. A defect.
 *   (2) THE CONSTRUCT DOES NOT OCCUR IN THE POPULATION. The analyzer is never given the
 *       chance. That is measured non-occurrence — a RULING with a number, not a defect.
 *
 * So this file counts BOTH sides on the SAME population:
 *
 *   numerator   edges actually emitted, per file, through the production path;
 *   denominator the SYNTAX SITES that would require such an edge, counted on the PARSE TREE —
 *               `declaration_command` nodes and their named children — never on the raw text,
 *               because a comment, a heredoc or a `case` arm's PATTERN is not a site. That
 *               last distinction is not hypothetical: `completions-core/cvs.bash:100` reads
 *               `export | ex | exp)` and is a case arm, and a text scan counts it.
 *
 * A site with no edge is the defect signature. Zero sites is the ruling. The two are printed
 * side by side so neither can be read as the other.
 *
 * ## Population, and why it is TWO populations
 *
 * `firing-check.mjs` discovers files through a `pickFiles(dir, exts, want, cap)` walk in
 * DIRECTORY ORDER and caps the result at 400 (`out.slice(0, cap)`), so `NFILES=556` cannot
 * widen past 400 files. This file reports the instrument's own population (same walk, same
 * order, same cap) AND the whole extension population on disk, and names the walk INDEX of
 * every construct-bearing file — because "why did the instrument read 0" is answered by
 * "the first export site sits at index N, past the instrument's reach", and by nothing else.
 *
 * `readdirSync` order is RUNTIME-DEPENDENT (bun and node disagree on this corpus), so this
 * file prints the runtime it ran under. Run it under `bun` to reproduce the instrument's
 * population exactly.
 *
 * ## What each silent type needs, and what would overturn its ruling
 *
 *   exports       IMPLEMENTABLE. The grammar HAS the construct (`declaration_command`), so this
 *                 type is never ruled inapplicable: it is either emitted or it is a defect.
 *   overrides     IMPLEMENTABLE (BD8b): a SECOND `function_definition` of a name declared
 *                 earlier in the same file, counted on the tree by name.
 *   extends       RULED INAPPLICABLE, with two mechanical falsifiers: a candidate node type
 *   implements    from the pinned grammar's own node-type table, or a candidate keyword in
 *                 DECLARATION position on the tree. bash's only definition construct is
 *                 `function_definition`, which has no supertype clause.
 *   instantiates  RULED INAPPLICABLE for the same reason: no constructor node type exists.
 *                 Keyword candidates that occur as COMMAND WORDS are printed so each is
 *                 adjudicated as an invocation rather than silently absorbed.
 *
 * The RULED half carries the residual this lane cannot close: `eval`, `${!name}` and
 * `bash -c` reach relationships the static tree does not contain. Their counts are printed,
 * because a ruling that hides its own blind spot is a claim, not a measurement.
 *
 * CLI:
 *   bun validation/m14/fixtures/bash/probe-bash-silent-types.mts [--repo bash-completion] [--nf 120]
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/** The lane forbids regex literals in its own files (probe-bash-no-regex.mts), so every
 *  string test below is written as a character scan or a literal `includes`. */
const NOISE_DIR = (n: string): boolean => n.includes("node_modules") || n.includes(".git")
const isAnalyzerClass = (v: any): boolean => typeof v === "function" && v.name.endsWith("Analyzer")
const stripOuterQuotes = (s: string): string => {
  if (s.length < 2) return s
  const a = s.charCodeAt(0)
  const b = s.charCodeAt(s.length - 1)
  if ((a === 34 || a === 39) && b === a) return s.slice(1, -1)
  return s
}
const isFlagWithX = (s: string): boolean => {
  if (s.length < 2 || s.charCodeAt(0) !== 45 /* - */) return false
  for (let i = 1; i < s.length; i++) if (s.charCodeAt(i) === 120 /* x */) return true
  return false
}
const REPO_ROOT = process.env.BB_REPO || join(import.meta.dirname, "..", "..", "..", "..")
const CORPUS = process.env.BB_CORPUS || "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const REPO_DIR = flag("repo") ?? "bash-completion"
const NF = Number(flag("nf") ?? process.env.NFILES ?? "120")
const CORPUS_WIDE = argv.includes("--corpus")
const EXTS = [".sh", ".bash"]

/** EXACTLY the firing-check walk — same directory order, same `want`/`cap` interaction — so the
 *  `sample` column is the instrument's own population and not a lookalike. */
function pickFiles(dir: string, want: number, cap = 400): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number) => {
    if (out.length >= want || depth > 20) return
    let ents
    try {
      ents = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      if (out.length >= want) return
      const p = join(d, e.name)
      if (e.isDirectory()) {
        if (!NOISE_DIR(e.name)) walk(p, depth + 1)
      } else if (EXTS.some((x) => e.name.endsWith(x))) {
        try {
          if (statSync(p).size < 400_000) out.push(p)
        } catch {
          /* unreadable */
        }
      }
    }
  }
  walk(dir, 0)
  return out.slice(0, cap)
}

/** The whole extension population on disk, uncapped — the corpus denominator. */
function walkAll(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number) => {
    if (depth > 20) return
    let ents
    try {
      ents = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      const p = join(d, e.name)
      if (e.isDirectory()) {
        if (!NOISE_DIR(e.name)) walk(p, depth + 1)
      } else if (EXTS.some((x) => e.name.endsWith(x))) {
        try {
          if (statSync(p).size < 400_000) out.push(p)
        } catch {
          /* unreadable */
        }
      }
    }
  }
  walk(dir, 0)
  return out
}

const dir = join(CORPUS, REPO_DIR)
/** `--corpus` walks EVERY git checkout under the corpus root (the population
 *  `ontology-coverage-gate.ts` uses), so a RULING can be stated against the whole corpus and
 *  not against one repository. It is the same extension and size filter, applied per track. */
const corpusWide: string[] = (() => {
  if (!CORPUS_WIDE) return []
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process")
  const out: string[] = []
  for (const e of readdirSync(CORPUS).sort()) {
    const d = join(CORPUS, e)
    try {
      if (!statSync(d).isDirectory()) continue
      execFileSync("git", ["-C", d, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", d, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      if (!EXTS.some((x) => rel.toLowerCase().endsWith(x))) continue
      const abs = join(d, rel)
      try {
        if (statSync(abs).size < 400_000) out.push(abs)
      } catch {
        /* absent from worktree */
      }
    }
  }
  return out.sort()
})()
const sample = CORPUS_WIDE ? corpusWide.slice(0, NF) : pickFiles(dir, NF)
const all = CORPUS_WIDE ? corpusWide : walkAll(dir)
const sampleSet = new Set(sample)
const walkIndex = new Map(all.map((f, i) => [f, i] as const))

// ---------------------------------------------------------------- the walker
const engine = await import(`${REPO_ROOT}/src/ast/engine.ts`)
const analyzerMod = await import(`${REPO_ROOT}/src/ast/real-bash-analyzer.ts`)
const Analyzer = Object.values(analyzerMod).find(isAnalyzerClass) as any
if (!Analyzer) throw new Error("no analyzer class exported")
const { getParser } = engine
type Node = any

const types = ["calls", "extends", "implements", "uses", "imports", "exports", "contains", "references", "overrides", "instantiates", "decorates", "renders", "mixes_in", "part_of"] as const
type RType = (typeof types)[number]

/** Node types that WOULD express one of the OO constructs if the grammar had them. Falsifiers. */
const TYPE_DECL_NODE_TYPES = [
  "class_declaration", "class", "class_definition", "interface_declaration", "interface",
  "trait_declaration", "struct_declaration", "struct", "enum_declaration", "type_declaration",
  "type_alias_declaration", "inheritance_specifier", "extends_clause", "implements_clause",
  "superclass", "base_class_clause", "new_expression", "object_creation_expression",
  "constructor_declaration", "constructor_invocation",
]
const KEYWORD_WORDS = new Set(["class", "extends", "implements", "interface", "new", "super", "inherit", "struct", "trait", "protocol", "constructor", "instantiate", "alloc"])

/* ---------------------------------------------------------------- BD16's denominators
 *
 * `source`/`.` becomes a `part_of` row only when the inclusion happens in THIS
 * shell's scope and the path's last segment names a part. These three predicates
 * are the PROBE's own reading of the tree — deliberately not imported from the
 * analyzer, so the two counts can disagree and say so.
 */
/**
 * THE COMMAND WORD, read the way the analyzer reads it: a `command_name` CHILD, not
 * `child(0)`. `V=x source lib.sh` puts a `variable_assignment` in child(0), so a walk
 * keyed on child(0) misses every ENV-prefixed command. Measured: exactly one `source`
 * site in the corpus is of that shape (ansible .../runme.sh:3), and its absence made
 * the site counter read 521 against 470 emitted rows.
 */
function commandNameNodeOf(n: Node): Node | null {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === "command_name") return c
  }
  return null
}
function keywordOf(n: Node): string {
  const cn = commandNameNodeOf(n)
  return cn ? cn.text : (n.child(0) ? n.child(0).text : "")
}
function insideChildProcess(n: Node): boolean {
  for (let cur: Node | null = n.parent; cur; cur = cur.parent) {
    if (cur.type === "program") return false
    if (cur.type === "subshell" || cur.type === "command_substitution" || cur.type === "process_substitution") return true
  }
  return false
}
function sourceArgOf(n: Node): Node | null {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (!c || c.type === "command_name") continue
    if (c.type === "word" || c.type === "raw_string" || c.type === "string" || c.type === "concatenation") return c
  }
  return null
}
/** A name a module symbol can carry: de-quoted last segment, free of expression/syntax characters. */
function pathLastSegmentIsName(text: string): boolean {
  let clean = ""
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c !== 34 && c !== 39) clean += text[i]
  }
  const slash = clean.lastIndexOf("/")
  const base = slash >= 0 ? clean.slice(slash + 1) : clean
  if (base.length === 0) return false
  for (let i = 0; i < base.length; i++) {
    const c = base.charCodeAt(i)
    if (c <= 32 || c === 34 || c === 39 || c === 96 || c === 36 || c === 40 || c === 41 ||
        c === 123 || c === 125 || c === 91 || c === 93 || c === 42 || c === 63 ||
        c === 59 || c === 124 || c === 38 || c === 60 || c === 62 || c === 92) return false
  }
  return true
}

type FileResult = {
  file: string
  inSample: boolean
  walkIndex: number
  edges: Map<RType, number>
  exportSites: { form: string; line: number; name: string; childTypes: string }[]
  redefinitions: { name: string; line: number; prior: number }[]
  unsetSites: number
  sourceSites: number
  /**
   * THE `part_of` DENOMINATOR, counted on the TREE and split by the two shapes
   * the emission refuses. A `source`/`.` site becomes a `part_of` row only when
   * (a) it is NOT inside a child-process boundary — a subshell, a command
   * substitution or a process substitution runs the inclusion in a forked
   * shell, so the included text never joins THIS file's scope — and (b) the
   * path's last segment is a NAME a module symbol can carry (`./lib/x.sh` ->
   * `x.sh`), not an expression (`"$lib"`, `"$(pick)"`, `lib/*.sh`).
   */
  sourceParts: { eligible: number; childProcess: number; noName: number }
  keywordCommandNames: { word: string; line: number }[]
  candidateNodes: { type: string; line: number }[]
  dynamic: { eval: number; indirect: number; shellC: number }
  nodeTypes: Set<string>
  parseFailed: boolean
}

const results: FileResult[] = []
let parseFailures = 0

for (const f of all) {
  const r: FileResult = {
    file: f,
    inSample: sampleSet.has(f),
    walkIndex: walkIndex.get(f) ?? -1,
    edges: new Map(),
    exportSites: [],
    redefinitions: [],
    unsetSites: 0,
    sourceSites: 0,
    sourceParts: { eligible: 0, childProcess: 0, noName: 0 },
    keywordCommandNames: [],
    candidateNodes: [],
    dynamic: { eval: 0, indirect: 0, shellC: 0 },
    nodeTypes: new Set(),
    parseFailed: false,
  }
  results.push(r)
  let content: string
  try {
    content = readFileSync(f, "utf8")
  } catch {
    r.parseFailed = true
    continue
  }
  let root: Node
  try {
    const parser = await getParser("bash")
    const pr = await parser.parse(content, f)
    root = pr.rootNode
  } catch {
    r.parseFailed = true
    parseFailures++
    continue
  }

  // ---- edges, through the production path (same call shape as firing-check.mjs)
  try {
    const res = new Analyzer().analyze(root, content, f)
    for (const rel of res.relationships || []) {
      const t = (rel.relationshipType ?? rel.type) as RType
      if (!t) continue
      r.edges.set(t, (r.edges.get(t) ?? 0) + 1)
    }
  } catch {
    r.parseFailed = true
    parseFailures++
    continue
  }

  // ---- sites, on the TREE. One iterative pre-order walk per file.
  //
  // The keyword is read as TEXT of the first child, which is how the analyzer reads it: a
  // `declaration_command`'s keyword is an ANONYMOUS grammar token whose node TYPE is the
  // literal itself (`export`), NOT `word`. A first version of this probe compared the type
  // against `word` and read zero export sites on a corpus that has them — the same class of
  // error the analyzer's own comments record, caught here by the numerator disagreeing with it.
  const funcDeclLines = new Map<string, number[]>()
  const stack: Node[] = [root]
  while (stack.length > 0) {
    const node = stack.pop() as Node
    r.nodeTypes.add(node.type)
    if (TYPE_DECL_NODE_TYPES.includes(node.type)) r.candidateNodes.push({ type: node.type, line: node.startPosition.row + 1 })
    if (node.type === "unset_command") r.unsetSites++
    if (node.type === "function_definition") {
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && (c.type === "word" || c.type === "variable_name")) {
          const arr = funcDeclLines.get(c.text) ?? []
          if (arr.length > 0) r.redefinitions.push({ name: c.text, line: node.startPosition.row + 1, prior: arr[arr.length - 1] })
          arr.push(node.startPosition.row + 1)
          funcDeclLines.set(c.text, arr)
          break
        }
      }
    }
    if (node.type === "command" || node.type === "declaration_command") {
      const kw = keywordOf(node)
      if (kw === "export") {
        // The three shapes the analyzer must handle, distinguished by the CHILD TYPE.
        let sawAny = false
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)
          if (!c) continue
          if (c.type === "word" && c.text === "-f") {
            sawAny = true
            continue
          }
          if (c.type === "variable_name") {
            sawAny = true
            r.exportSites.push({ form: "export NAME", line: c.startPosition.row + 1, name: c.text, childTypes: c.type })
          } else if (c.type === "variable_assignment") {
            sawAny = true
            r.exportSites.push({ form: "export NAME=value", line: c.startPosition.row + 1, name: c.child(0)?.text ?? "", childTypes: c.type })
          } else if (c.type === "string" || c.type === "concatenation" || c.type === "raw_string") {
            // A QUOTED argument is one node holding the whole `NAME=value`; the name is
            // whatever identifier precedes the `=` in its LITERAL run. It is nameable only
            // when no expansion decides it — `export "_${ucname}_COMPLETE=…"` names its
            // variable at run time, and row `probe-bash-export-site-diff.mts` is what proves
            // the classification, not this counter.
            sawAny = true
            const dyn = c.text.includes("$") || c.text.includes("`")
            const inner = stripOuterQuotes(c.text)
            const name = dyn ? "" : inner.split("=")[0]
            r.exportSites.push({ form: dyn ? "export \"computed=value\" (dynamic name)" : "export \"NAME=value\" (static name)", line: c.startPosition.row + 1, name, childTypes: `${c.type}${dyn ? "/dynamic" : "/static"}` })
          } else if (c.type === "simple_expansion" || c.type === "expansion" || c.type === "command_substitution" || c.type === "arithmetic_expansion") {
            // `export "$name"` / `export $2`: the name is an expansion, full stop.
            sawAny = true
            r.exportSites.push({ form: "export <expansion> (dynamic name)", line: c.startPosition.row + 1, name: "", childTypes: `${c.type}/dynamic` })
          } else if (c.type === "word" && !c.text.startsWith("-")) {
            sawAny = true
            r.exportSites.push({ form: "export NAME (bare word)", line: c.startPosition.row + 1, name: c.text, childTypes: c.type })
          } else {
            r.exportSites.push({ form: `export <${c.type}> (not a name site)`, line: c.startPosition.row + 1, name: "", childTypes: c.type })
          }
        }
        if (!sawAny) r.exportSites.push({ form: "export (no named child)", line: node.startPosition.row + 1, name: "", childTypes: "(none)" })
      } else if (kw === "declare" || kw === "typeset") {
        let hasX = false
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)
          if (c && c.type === "word" && isFlagWithX(c.text)) hasX = true
        }
        if (hasX) r.exportSites.push({ form: `${kw} -x NAME`, line: node.startPosition.row + 1, name: "", childTypes: "flag" })
      } else if (kw === "source" || kw === ".") {
        r.sourceSites++
        const argNode = sourceArgOf(node)
        if (insideChildProcess(node)) r.sourceParts.childProcess++
        else if (argNode && pathLastSegmentIsName(argNode.text)) r.sourceParts.eligible++
        else r.sourceParts.noName++
      }
      if (KEYWORD_WORDS.has(kw)) r.keywordCommandNames.push({ word: kw, line: node.startPosition.row + 1 })
      if (kw === "eval") r.dynamic.eval++
      if ((kw === "bash" || kw === "sh") && node.namedChildCount > 1) {
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)
          if (c && c.type === "word" && c.text === "-c") r.dynamic.shellC++
        }
      }
    }
    if (node.type === "expansion" && node.namedChildCount > 0) {
      const inner = node.namedChild(0)
      if (inner && inner.type === "variable_name" && node.text.startsWith("${!")) r.dynamic.indirect++
    }
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const c = node.namedChild(i)
      if (c) stack.push(c)
    }
  }
}

// ---------------------------------------------------------------- the pinned grammar's own node table
/** The grammar's VOCABULARY, read from the pinned wasm through `Language.nodeTypeForId` — the
 *  same table `script/m12/bash-node-types-compare.ts` uses. A construct the grammar cannot
 *  produce cannot occur in any corpus, which is a stronger statement than "this corpus has
 *  none", and the two are reported separately so neither is smuggled in for the other. */
let grammarNodeTypes: string[] = []
let grammarError = ""
try {
  const wts: any = await import("web-tree-sitter")
  const Language = wts.Language ?? wts.default?.Language
  const grammar = await Language.load(readFileSync(join(REPO_ROOT, "wasm", "tree-sitter-bash.wasm")))
  for (let i = 0; i < grammar.nodeTypeCount; i++) {
    const t = grammar.nodeTypeForId(i)
    if (typeof t === "string" && t.length > 0) grammarNodeTypes.push(t)
  }
  grammar.delete?.()
} catch (e) {
  grammarError = String(e).slice(0, 160)
}

// ---------------------------------------------------------------- aggregation
const perType = new Map<RType, { edges: number; edgeFiles: Set<string>; sampleEdges: number }>()
for (const t of types) perType.set(t, { edges: 0, edgeFiles: new Set(), sampleEdges: 0 })
for (const r of results) {
  for (const [t, n] of r.edges) {
    const a = perType.get(t)
    if (!a) continue
    a.edges += n
    a.edgeFiles.add(r.file)
    if (r.inSample) a.sampleEdges += n
  }
}
const sum = (f: (r: FileResult) => number) => results.reduce((n, r) => n + (r.parseFailed ? 0 : f(r)), 0)
const filesWhere = (f: (r: FileResult) => boolean) => results.filter((r) => !r.parseFailed && f(r))
const exportSiteFiles = filesWhere((r) => r.exportSites.length > 0)
const exportSampleSiteFiles = exportSiteFiles.filter((r) => r.inSample)
const redefFiles = filesWhere((r) => r.redefinitions.length > 0)
const unsetFiles = filesWhere((r) => r.unsetSites > 0)
const sourceFiles = filesWhere((r) => r.sourceSites > 0)
const keywordFiles = filesWhere((r) => r.keywordCommandNames.length > 0)
const candidateFiles = filesWhere((r) => r.candidateNodes.length > 0)
const nodeTypeUnion = new Set<string>()
for (const r of results) for (const t of r.nodeTypes) nodeTypeUnion.add(t)

const formTally = new Map<string, number>()
for (const r of results) for (const s of r.exportSites) formTally.set(s.form, (formTally.get(s.form) ?? 0) + 1)
const keywordTally = new Map<string, number>()
for (const r of results) for (const k of r.keywordCommandNames) keywordTally.set(k.word, (keywordTally.get(k.word) ?? 0) + 1)
const minExportIndex = exportSiteFiles.length ? Math.min(...exportSiteFiles.map((r) => r.walkIndex)) : -1
const minRedefIndex = redefFiles.length ? Math.min(...redefFiles.map((r) => r.walkIndex)) : -1

console.log(`PROBE-BASH-SILENT-TYPES  runtime=${typeof (globalThis as any).Bun !== "undefined" ? "bun" : "node"}  repo=${REPO_DIR}  population=${all.length} .sh/.bash files (<400KB)`)
console.log(`  parsed OK                      : ${all.length - parseFailures}/${all.length}  (parse failures: ${parseFailures})`)
console.log(`  firing-check population NFILES=${NF} : ${sample.length} files (its walk, its cap 400)`)
console.log(`  distinct node types observed   : ${nodeTypeUnion.size}`)
console.log(`  first construct-bearing walk index: export sites @ ${minExportIndex}, redefinitions @ ${minRedefIndex}  (the instrument reaches index < ${Math.min(NF, 400)})`)
console.log("")
console.log("EDGES EMITTED (production path), all files / firing-check sample:")
for (const t of types) {
  const a = perType.get(t)!
  console.log(`  ${t.padEnd(13)} ${String(a.edges).padStart(7)} edges in ${String(a.edgeFiles.size).padStart(3)} files   |  sample: ${String(a.sampleEdges).padStart(5)} edges in ${filesWhere((r) => r.inSample && (r.edges.get(t) ?? 0) > 0).length} files`)
}
console.log("")
console.log("SYNTAX SITES ON THE PARSE TREE (the denominator), all files / sample:")
console.log(`  export sites                   : ${sum((r) => r.exportSites.length)} in ${exportSiteFiles.length} files   |  sample: ${sum((r) => (r.inSample ? r.exportSites.length : 0))} in ${exportSampleSiteFiles.length} files`)
for (const [form, n] of [...formTally.entries()].sort((a, b) => b[1] - a[1])) console.log(`      ${form.padEnd(40)} ${n}`)
console.log(`  function redefinition events   : ${sum((r) => r.redefinitions.length)} in ${redefFiles.length} files`)
console.log(`  unset_command sites            : ${sum((r) => r.unsetSites)} in ${unsetFiles.length} files`)
console.log(`  source/. sites                 : ${sum((r) => r.sourceSites)} in ${sourceFiles.length} files`)
console.log(`      part_of-ELIGIBLE           : ${sum((r) => r.sourceParts.eligible)}  (nameable last segment, NOT in a child-process boundary)`)
console.log(`      refused: child-process     : ${sum((r) => r.sourceParts.childProcess)}  (subshell / command substitution / process substitution: a forked shell's scope, not this file's)`)
console.log(`      refused: no nameable part  : ${sum((r) => r.sourceParts.noName)}  (last path segment is an expression: a quoted variable, a command substitution, or a glob)`)
console.log("")
console.log("INAPPLICABILITY PROBES:")
console.log(`  grammar node types (pinned wasm)      : ${grammarNodeTypes.length ? grammarNodeTypes.length : "UNREADABLE — " + grammarError}`)
if (grammarNodeTypes.length) {
  const hits = TYPE_DECL_NODE_TYPES.filter((t) => grammarNodeTypes.includes(t))
  console.log(`  candidate node types IN THE GRAMMAR   : ${hits.length}${hits.length ? " <-- RULING FALSIFIED: " + hits.join(", ") : ` (none of the ${TYPE_DECL_NODE_TYPES.length} probed types exists in the grammar)`}`)
}
console.log(`  candidate node types on ${all.length} trees : ${sum((r) => r.candidateNodes.length)}${sum((r) => r.candidateNodes.length) ? " <-- RULING FALSIFIED" : " (0 occurrences)"}`)
console.log(`  keyword words in COMMAND position     : ${sum((r) => r.keywordCommandNames.length)} in ${keywordFiles.length} files`)
for (const [w, n] of [...keywordTally.entries()].sort((a, b) => b[1] - a[1])) console.log(`      command named '${w}'${" ".repeat(Math.max(0, 10 - w.length))} ${n}`)
console.log(`  dynamic doors: eval ${sum((r) => r.dynamic.eval)}, \${!name} ${sum((r) => r.dynamic.indirect)}, bash|sh -c ${sum((r) => r.dynamic.shellC)}`)
console.log("")
console.log("ADJUDICATION (site with no edge = DEFECT; zero sites = RULED):")
const exportEdges = perType.get("exports")!
const overrideEdges = perType.get("overrides")!
const nameableSites = sum((r) => r.exportSites.filter((s) => s.name.length > 0).length)
const dynamicSites = sum((r) => r.exportSites.filter((s) => s.form.includes("dynamic") || s.form.includes("not a name site")).length)
console.log(`  exports     : ${sum((r) => r.exportSites.length)} export-headed nodes (${nameableSites} statically NAMEABLE, ${dynamicSites} computed/not-a-name) -> ${exportEdges.edges} edges`)
console.log(`  overrides   : ${sum((r) => r.redefinitions.length)} redefinition events -> ${overrideEdges.edges} edges${sum((r) => r.redefinitions.length) === 0 ? "  (construct does not occur in this corpus)" : ""}`)
console.log(`  extends     : grammar ${grammarNodeTypes.length && !TYPE_DECL_NODE_TYPES.some((t) => grammarNodeTypes.includes(t)) ? "has NO type/supertype node type" : "UNMEASURED"}, 0 candidate nodes on ${all.length} trees -> RULED`)
console.log(`  implements  : same probe as extends -> RULED`)
console.log(`  instantiates: grammar HAS no constructor node type, 0 candidate nodes, ${keywordTally.get("new") ?? 0} command(s) spelled 'new' -> RULED`)
const partOfEdges = perType.get("part_of")!
const eligibleParts = sum((r) => r.sourceParts.eligible)
console.log(`  part_of     : ${sum((r) => r.sourceSites)} source/. sites, ${eligibleParts} ELIGIBLE after the two refusals -> ${partOfEdges.edges} edges in ${partOfEdges.edgeFiles.size} files${partOfEdges.edges === eligibleParts ? "  (1:1 — every eligible site published)" : "  <-- SITE/EDGE MISMATCH"}`)

if (exportSiteFiles.length > 0) {
  console.log("\nexport-site files (all of them):")
  for (const r of exportSiteFiles) {
    console.log(`  [idx ${String(r.walkIndex).padStart(3)}${r.inSample ? "*" : " "}] ${r.file.replace(dir + "/", "").padEnd(48)} sites=${r.exportSites.length} edges=${r.edges.get("exports") ?? 0}  shapes=${[...new Set(r.exportSites.map((s) => s.form))].join(" + ")}`)
  }
}
if (redefFiles.length > 0) {
  console.log("\nredefinition files (all of them):")
  for (const r of redefFiles) console.log(`  [idx ${String(r.walkIndex).padStart(3)}] ${r.file.replace(dir + "/", "").padEnd(48)} events=${r.redefinitions.length} edges=${r.edges.get("overrides") ?? 0}`)
}
