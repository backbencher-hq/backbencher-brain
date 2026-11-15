/**
 * MAKE CORPUS DIFFERENTIAL — the analyzer against an INDEPENDENT oracle.
 *
 * The oracle must not be a second copy of the analyzer's logic, or agreement
 * between them proves nothing. So the two sides derive the same facts by
 * deliberately different routes:
 *
 *   ANALYZER  reads a reference's name from its CHILD `word` node, and an
 *             assignment's name from the first `word` child with the operator
 *             trimmed by character code.
 *   ORACLE    reads a reference's name from the node's OWN TEXT with the
 *             delimiters stripped, and an assignment's name from the line up to
 *             the first `=`/`:=`/`?=`/`+=`/`!=` with a regex.
 *
 * A regex is fine here and forbidden in the analyzer: the probe is allowed to be
 * sloppy as long as it is INDEPENDENT, because the point is that the two
 * derivations fail differently. If they agree, the name is right for two
 * unrelated reasons; if they disagree, the disagreement is reported with both
 * sides rather than averaged away.
 *
 * Comparison is site-agnostic (source, label, target — never the line), because
 * the two sides number lines independently and a line is not the claim under
 * test. Line agreement is measured separately and reported.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { Parser, Language } from "web-tree-sitter"
import { ASTEngine } from "/home/ishaq2321/backbencher-brain/src/ast/engine"

const REPO = "/home/ishaq2321/backbencher-brain"
const OUT = "/home/ishaq2321/bb_tests/make/out"
const REPOS = "/home/ishaq2321/bb_tests/repositories"
const MAN = JSON.parse(readFileSync(`${OUT}/corpus-manifest.json`, "utf8"))

await Parser.init()
const parser = new Parser()
parser.setLanguage(await Language.load(`${REPO}/wasm/tree-sitter-make.wasm`))

const BUILTIN_FUNCTIONS = new Set([
  "subst", "patsubst", "strip", "findstring", "filter", "filter-out", "sort", "word", "wordlist",
  "words", "firstword", "lastword", "dir", "notdir", "suffix", "basename", "addsuffix", "addprefix",
  "join", "wildcard", "realpath", "abspath", "if", "or", "and", "foreach", "file", "call", "value",
  "eval", "origin", "flavor", "shell", "error", "warning", "info",
])
const KEYWORDS = new Set([
  "export", "unexport", "override", "private", "define", "endef", "include", "-include",
  "sinclude", "vpath", "undefine", "ifeq", "ifneq", "ifdef", "ifndef", "else", "endif",
])

/** The oracle's own name reader: strip the delimiters off the node's TEXT. */
function nameFromDelimitedText(text: string): string {
  const t = text.trim()
  // A `$(` that does not close at the END of the node is a glued path
  // (`$(git-dir)/hooks/pre-push`), not a reference. Stripping the leading `$`
  // invents `(git-dir)/hooks/pre-push`, a name nothing declares.
  if (t.startsWith("$(") && !t.endsWith(")")) return t
  if (t.startsWith("${") && !t.endsWith("}")) return t
  if ((t.startsWith("$(") && t.endsWith(")")) || (t.startsWith("${") && t.endsWith("}"))) return t.slice(2, -1).trim()
  if (t.startsWith("$")) return t.slice(1).trim()
  return t
}
/** The oracle's own assignment-name reader: a regex, which the analyzer may not use. */
function nameFromAssignmentText(text: string): string {
  const m = /^[\s]*([A-Za-z0-9_.${}()\-/]+?)\s*(::=|:=|\?=|\+=|!=|=)/.exec(text)
  return m ? m[1].trim() : ""
}
/**
 * ORACLE WEAKNESS, recorded rather than hidden. On the TARGET-SCOPED shape
 * `build: BUILD_TAGS+=ui` the grammar parses the whole line as ONE
 * variable_assignment, so a regex anchored at the start cannot see past the
 * leading `build:` and returns nothing — while the analyzer's child-node route
 * finds `BUILD_TAGS+` and trims it. The oracle therefore falls back to the
 * `word` child when the text route finds no name. This narrows the oracle's
 * independence on ASSIGNMENT NAMES only; the reference extraction, which is the
 * part under test, still runs by the independent text-delimiter route.
 */
function oracleAssignmentName(node: any): string {
  const byText = nameFromAssignmentText(node.text ?? "")
  if (byText && !KEYWORDS.has(byText)) return byText
  const w = (node.namedChildren ?? []).find((c: any) => c.type === "word")
  const nm = (w?.text ?? "").trim().replace(/[?!+:]+$/, "")
  return nm && !KEYWORDS.has(nm) ? nm : ""
}
const isAllDigits = (s: string) => s.length > 0 && [...s].every((c) => c >= "0" && c <= "9")

interface Truth { label: string; source: string; target: string; line: number }
interface Analyzed { label: string; source: string; target: string; line: number }

let truthTotal = 0, covered = 0, analyzerEdges = 0, explained = 0
const missing: Truth[] = [], spurious: Analyzed[] = []
let lineAgree = 0, lineChecked = 0
let totalSymbols = 0, totalRels = 0, totalNodes = 0
const perFile: { file: string; truth: number; covered: number; analyzer: number; explained: number }[] = []

for (const f of MAN.fileList) {
  const abs = `${REPOS}/${f.repo}/${f.rel}`
  const rel = `${f.repo}/${f.rel}`
  const content = readFileSync(abs, "utf8")
  const tree = parser.parse(content)!
  totalNodes += tree.rootNode.descendantCount + 1

  // ---------------- ORACLE side ----------------
  const declared = new Set<string>()
  const targets = new Set<string>()
  const exported = new Set<string>()
  const truth: Truth[] = []
  const module = f.rel.split("/").pop()!

  const addTruth = (label: string, source: string, target: string, line: number) => {
    if (!source || !target || source === target) return
    truth.push({ label, source, target, line })
  }

  // ---- pass 1: declarations only (no labels decided) ----
  {
    const dstack: any[] = [tree.rootNode]
    while (dstack.length) {
      const n = dstack.pop()
      if (n.type === "variable_assignment" || n.type === "shell_assignment") {
        const nm = oracleAssignmentName(n)
        if (nm && !KEYWORDS.has(nm)) declared.add(nm)
      } else if (n.type === "define_directive") {
        const w = n.namedChildren.find((c: any) => c.type === "word")
        const nm = (w?.text ?? "").trim().replace(/[?!+:]+$/, "")
        if (nm) declared.add(nm)
      } else if (n.type === "rule") {
        const tg = n.namedChildren.find((c: any) => c.type === "targets")
        if (tg) {
          for (const c of tg.namedChildren) {
            const t = c.text.trim()
            if (c.type === "word" && t && !KEYWORDS.has(t) && !t.startsWith(".")) { targets.add(t); declared.add(t) }
          }
        }
      } else if (n.type === "export_directive") {
        const li = n.namedChildren.find((c: any) => c.type === "list")
        if (li) for (const c of li.namedChildren) { const t = c.text.trim().replace(/[?!+:]+$/, ""); if (t && !KEYWORDS.has(t)) { declared.add(t); exported.add(t) } }
        else {
          const asg = n.namedChildren.find((c: any) => c.type === "variable_assignment" || c.type === "shell_assignment")
          const nm = asg ? oracleAssignmentName(asg) : ""
          if (nm && !KEYWORDS.has(nm)) { declared.add(nm); exported.add(nm) }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) dstack.push(c) }
    }
  }

  // Owner travels WITH the frame. A single mutable `owner` across a LIFO stack
  // leaks attribution between sibling subtrees: a rule whose target is an
  // EXPRESSION (`$(archive) : $(objects)`, 6 files in this corpus) declares no
  // literal target, so without a per-frame owner the recipe that follows is
  // credited to whatever rule the stack happened to visit before it. That is a
  // traversal bug in the oracle, not a finding about the analyzer.
  const stack: { n: any; owner: string }[] = [{ n: tree.rootNode, owner: module }]
  while (stack.length) {
    const { n, owner } = stack.pop()!
    // The oracle does not model the grammar's partial recovery inside an ERROR
    // node, so anything the analyzer finds there is out of ITS model. Recorded
    // as an explicit exclusion rather than left to show up as a phantom
    // difference in both directions.
    if (n.type === "ERROR") continue
    const line = n.startPosition.row + 1
    if (n.type === "variable_assignment" || n.type === "shell_assignment") {
      // ownership is carried by the frame (see below)
    } else if (n.type === "define_directive") {
      const w = n.namedChildren.find((c: any) => c.type === "word")
    } else if (n.type === "rule") {
      const tg = n.namedChildren.find((c: any) => c.type === "targets")
      const lits: string[] = []
      if (tg) {
        for (const c of tg.namedChildren) {
          const t = c.text.trim()
          if (c.type === "word" && t && !KEYWORDS.has(t) && !t.startsWith(".")) lits.push(t)
          else if (c.type === "variable_reference" || c.type === "substitution_reference" || c.type === "function_call") {
            const nm = nameFromDelimitedText(c.text)
            if (nm && !isAllDigits(nm)) addTruth(declared.has(nm) ? "references" : "uses", module, nm, c.startPosition.row + 1)
          }
        }
      }
      // A rule whose target is an EXPRESSION (`$(BIN): $(OBJS) | builddir`) has
      // no literal name, so the owner falls back to the module — the same
      // fallback the analyzer makes, and the same one the M12 contract probe
      // forced. Without it the oracle silently derived NO prereq edge for such a
      // rule, and every one of the analyzer's such edges read as spurious — which
      // is how a correct fix looks exactly like a regression.
      const owners = lits.length ? lits : [module]
      for (const c of n.namedChildren) {
        if (c.type !== "prerequisites") continue
        for (const pc of c.namedChildren) {
          const raw = pc.text.trim()
          if (!raw) continue
          const nm = nameFromDelimitedText(raw)
          if (!nm || KEYWORDS.has(nm)) continue
          for (const t of owners) addTruth(declared.has(nm) ? "references" : "uses", t, nm, pc.startPosition.row + 1)
        }
      }
    } else if (n.type === "include_directive") {
      const li = n.namedChildren.find((c: any) => c.type === "list")
      const kids = li ? li.namedChildren : n.namedChildren.slice(1)
      for (const c of kids) {
        const t = c.text.trim()
        if (t && !KEYWORDS.has(t)) addTruth("imports", module, t, c.startPosition.row + 1)
      }
    } else if (n.type === "variable_reference" || n.type === "substitution_reference") {
      const par = n.parent ? n.parent.type : ""
      if (par !== "prerequisites" && par !== "targets" && !n.text.startsWith("$$")) {
        // For a SUBSTITUTION the name is the first `word` child; the
        // `:pattern=replacement` tail is the substitution spec and is not part
        // of any name. Text-stripping produced `sources:.c=.o` here.
        const firstWord = n.type === "substitution_reference"
          ? ((n.namedChildren ?? []).find((c: any) => c.type === "word")?.text ?? "").trim()
          : ""
        const nm = firstWord || nameFromDelimitedText(n.text)
        if (nm && !isAllDigits(nm)) addTruth(declared.has(nm) ? "references" : "uses", owner, nm, line)
      }
    } else if (n.type === "automatic_variable") {
      addTruth("uses", owner, n.text.trim(), line)
    } else if (n.type === "function_call") {
      const head = nameFromDelimitedText(n.text).split(/[\s,(]/)[0]
      const args = n.namedChildren.find((c: any) => c.type === "arguments")
      if (head === "call") {
        const callee = (args?.text ?? "").split(",")[0]?.trim() ?? ""
        if (callee && !BUILTIN_FUNCTIONS.has(callee) && !isAllDigits(callee)) addTruth("calls", owner, callee, line)
      } else if (head && !BUILTIN_FUNCTIONS.has(head)) {
        addTruth(declared.has(head) ? "references" : "uses", owner, head, line)
      }
    }
    const childOwner = (() => {
      if (n.type === "variable_assignment" || n.type === "shell_assignment") { const nm = oracleAssignmentName(n); return nm && !KEYWORDS.has(nm) ? nm : owner }
      if (n.type === "define_directive") { const w = n.namedChildren.find((c: any) => c.type === "word"); const nm = (w?.text ?? "").trim().replace(/[?!+:]+$/, ""); return nm || owner }
      if (n.type === "rule") {
        const tg = n.namedChildren.find((c: any) => c.type === "targets")
        const lits: string[] = []
        if (tg) for (const c of tg.namedChildren) { const t = c.text.trim(); if (c.type === "word" && t && !KEYWORDS.has(t) && !t.startsWith(".")) lits.push(t) }
        return lits.length ? lits[0] : owner
      }
      return owner
    })()
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push({ n: c, owner: childOwner })
    }
  }
  // module containment + target exports, which the oracle also derives
  for (const d of declared) addTruth("contains", module, d, 0)
  for (const t of targets) addTruth("exports", module, t, 0)
  for (const e of exported) addTruth("exports", module, e, 0)

  // ---------------- ANALYZER side ----------------
  const r: any = await ASTEngine.parseFile(abs, content)
  totalSymbols += r.symbols.length
  totalRels += r.relationships.length
  const seen = new Set<string>()
  const edges: Analyzed[] = []
  for (const x of r.relationships) {
    const k = `${x.type}|${x.source}|${x.target}`
    if (seen.has(k)) continue          // site-agnostic: collapse per-site duplicates
    seen.add(k)
    edges.push({ label: x.type, source: x.source, target: x.target, line: x.line_number })
  }

  // ---------------- COMPARE ----------------
  const tKeys = new Map<string, Truth>()
  for (const t of truth) if (!tKeys.has(`${t.label}|${t.source}|${t.target}`)) tKeys.set(`${t.label}|${t.source}|${t.target}`, t)
  const aKeys = new Map<string, Analyzed>()
  for (const a of edges) if (!aKeys.has(`${a.label}|${a.source}|${a.target}`)) aKeys.set(`${a.label}|${a.source}|${a.target}`, a)

  let fCovered = 0, fExplained = 0
  for (const [k, t] of tKeys) {
    truthTotal++
    const a = aKeys.get(k)
    if (a) {
      covered++; fCovered++
      if (t.line > 0) { lineChecked++; if (a.line === t.line) lineAgree++ }
    } else if (missing.length < 60) missing.push(t)
  }
  for (const [k, a] of aKeys) {
    analyzerEdges++
    if (tKeys.has(k)) { explained++; fExplained++ }
    else if (spurious.length < 60) spurious.push(a)
  }
  perFile.push({ file: rel, truth: tKeys.size, covered: fCovered, analyzer: aKeys.size, explained: fExplained })
}

const report = {
  lane: "make",
  corpus: { files: MAN.files, repositories: MAN.repositories, lines: MAN.totalLines, fileSetHash: MAN.fileSetHash },
  totalNodes, totalSymbols, totalRels,
  truth: { edges: truthTotal, covered, recall: truthTotal ? Number((covered / truthTotal).toFixed(6)) : 1, lineChecked, lineAgree, lineAgreement: lineChecked ? Number((lineAgree / lineChecked).toFixed(6)) : null },
  analyzer: { edges: analyzerEdges, explained, precision: analyzerEdges ? Number((explained / analyzerEdges).toFixed(6)) : 1 },
  missing, spurious,
  perFile: perFile.sort((a, b) => (a.covered - a.truth) - (b.covered - b.truth)).slice(0, 15),
}
writeFileSync(`${OUT}/corpus-differential.json`, JSON.stringify(report, null, 2) + "\n")

console.log(`files ${MAN.files}  nodes ${totalNodes}  symbols ${totalSymbols}  relationships ${totalRels}`)
console.log(`TRUTH edges ${truthTotal}  covered ${covered}  recall ${report.truth.recall}`)
console.log(`ANALYZER edges ${analyzerEdges}  explained ${explained}  precision ${report.analyzer.precision}`)
console.log(`missing ${missing.length}  spurious ${spurious.length}`)
console.log(`line agreement: ${lineAgree}/${lineChecked} = ${report.truth.lineAgreement}`)
console.log("\nworst files:")
for (const p of report.perFile) console.log(`  ${p.file.padEnd(58)} truth ${String(p.truth).padStart(4)} cov ${String(p.covered).padStart(4)} | an ${String(p.analyzer).padStart(4)} exp ${String(p.explained).padStart(4)}`)
if (missing.length) { console.log("\nmissing samples:"); for (const m of missing.slice(0, 8)) console.log(`  ${m.label} ${m.source} -> ${m.target} (L${m.line})`) }
if (spurious.length) { console.log("\nspurious samples:"); for (const s of spurious.slice(0, 8)) console.log(`  ${s.label} ${s.source} -> ${s.target} (L${s.line})`) }
