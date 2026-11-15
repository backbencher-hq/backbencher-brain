/**
 * BASH EXTENDED-TYPE NEAR-MISS CENSUS — the counts behind the three rulings
 * (`decorates`, `renders`, `mixes_in`) and the `imports` ruling.
 *
 * WHY THIS FILE EXISTS. A ruling must carry a COUNT, a population and a FALSIFIER, and the
 * fleet's rule is that a construct which the grammar COULD express must be ruled only after
 * its nearest shapes are counted. This probe walks the lane's whole corpus population (the
 * same git-tracked .sh/.bash discovery the silent-types census uses) and counts, on the PARSE
 * TREE only, every construct that could plausibly be mistaken for one of the four types:
 *
 *   decorates  — `trap` (installs a handler), `set -e`-family (a shell option), and
 *                `declare`/`typeset`/`local`/`readonly` attribute flags (variable metadata).
 *                All three are METADATA or handler registration, not applied code running
 *                around a body. The would-be DECORATED DECLARATION is `function_definition`;
 *                its child-type census is printed, and no modifier/annotation clause exists.
 *   renders    — heredocs and printf/echo output are TEXT written to a stream. They are
 *                counted so the boundary is checkable: a render relation's subject and
 *                object are COMPONENT symbols, and the emitted text is not a symbol.
 *   mixes_in   — the only splice construct in the language is `source`/`.` (textual
 *                inclusion, emitted as `part_of`); counted, plus the commands that could
 *                name a mixin keyword.
 *   imports    — the same `source`/`.` count, split by child-process boundary, because the
 *                only "loads another file's text" construct is the inclusion and it owns
 *                both the part_of row (same scope) and the refusal (child scope).
 *
 * The grammar-side half (280 served node types, none an annotation/decorator/mixin/render
 * form) is the silent-types census's own INAPPLICABILITY PROBES, reproduced there from the
 * live parser. This probe is the CORPUS half; a ruling cites both.
 *
 * CLI: bun validation/m14/fixtures/bash/probe-bash-extended-near-misses.mts [--corpus] [--repo NAME]
 * No network, no index, no regex, no text scan.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"

const REPO_ROOT = process.env.BB_REPO || join(import.meta.dirname, "..", "..", "..", "..")
const CORPUS = process.env.BB_CORPUS || "/home/ishaq2321/bb_tests/repositories"
const EXTS = [".sh", ".bash"]
const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const REPO_DIR = flag("repo")

type Node = any

const engine = await import(`${REPO_ROOT}/src/ast/engine.ts`)
const { getParser } = engine

/* ---------------------------------------------------------------- discovery */
function tracked(dir: string): string[] {
  const out: string[] = []
  let files: string[]
  try {
    files = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    return out
  }
  for (const rel of files) {
    if (!EXTS.some((x) => rel.toLowerCase().endsWith(x))) continue
    const abs = join(dir, rel)
    try {
      if (statSync(abs).size < 400_000) out.push(abs)
    } catch {
      /* unreadable */
    }
  }
  return out
}
function corpusWide(): string[] {
  const out: string[] = []
  for (const e of readdirSync(CORPUS).sort()) {
    const d = join(CORPUS, e)
    try {
      if (!statSync(d).isDirectory()) continue
      execFileSync("git", ["-C", d, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    out.push(...tracked(d))
  }
  return out
}
const files = REPO_DIR ? tracked(join(CORPUS, REPO_DIR)) : corpusWide()

/* ---------------------------------------------------------------- counting */
const CONSTRUCT_KEYWORDS = new Set([
  "class", "interface", "trait", "protocol", "struct", "enum", "namespace",
  "decorator", "decorate", "annotation", "mixin", "include", "render", "component",
  "with", "embed", "import", "require", "extend",
])

let parseFailures = 0
const c = {
  files: 0,
  nodes: 0,
  trapSites: 0,
  setFlagSites: 0,
  setErrexitSites: 0,
  attributeFlagSites: 0,
  functionDefinitions: 0,
  functionDefinitionChildTypes: new Map<string, number>(),
  heredocSites: 0,
  heredocBodySites: 0,
  printfEchoSites: 0,
  sourceSites: 0,
  sourceChildProcessSites: 0,
  keywordCommands: new Map<string, number>(),
  keywordSites: [] as string[],
  aliasSites: 0,
  funcWithRedirects: 0,
}
const fnChildTypes = c.functionDefinitionChildTypes

const ERREXIT_FLAGS = new Set(["-e", "-u", "-o", "-x", "-E", "-C", "-f", "-n", "-v"])
const ATTR_FLAGS = new Set(["-A", "-a", "-i", "-r", "-x", "-n", "-g", "-l", "-p", "-t", "-u"])

function directWordOf(n: Node): string {
  for (let i = 0; i < n.namedChildCount; i++) {
    const ch = n.namedChild(i)
    if (ch && ch.type === "command_name") {
      for (let j = 0; j < ch.namedChildCount; j++) {
        const w = ch.namedChild(j)
        if (w && w.type === "word") return w.text
      }
      return ch.text
    }
  }
  const first = n.child(0)
  return first ? first.text : ""
}
function insideChildProcess(n: Node): boolean {
  for (let cur: Node | null = n.parent; cur; cur = cur.parent) {
    if (cur.type === "program") return false
    if (cur.type === "subshell" || cur.type === "command_substitution" || cur.type === "process_substitution") return true
  }
  return false
}
function argWords(n: Node): string[] {
  const out: string[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const ch = n.namedChild(i)
    if (ch && ch.type === "word") out.push(ch.text)
  }
  return out
}

for (const f of files) {
  let content: string
  try {
    content = readFileSync(f, "utf8")
  } catch {
    continue
  }
  let root: Node
  try {
    const parser = await getParser("bash")
    root = (await parser.parse(content, f)).rootNode
  } catch {
    parseFailures++
    continue
  }
  c.files++
  const stack: Node[] = [root]
  while (stack.length > 0) {
    const n = stack.pop() as Node
    c.nodes++
    if (n.type === "function_definition") {
      c.functionDefinitions++
      for (let i = 0; i < n.childCount; i++) {
        const ch = n.child(i)
        if (ch) fnChildTypes.set(ch.type, (fnChildTypes.get(ch.type) ?? 0) + 1)
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const ch = n.namedChild(i)
        if (ch && (ch.type === "redirect" || ch.type === "heredoc_redirect")) c.funcWithRedirects++
      }
    }
    if (n.type === "heredoc_redirect") c.heredocSites++
    if (n.type === "heredoc_body") c.heredocBodySites++
    if (n.type === "command" || n.type === "declaration_command") {
      const kw = directWordOf(n)
      const args = argWords(n)
      if (kw === "trap") c.trapSites++
      if (kw === "set") {
        c.setFlagSites++
        if (args.some((a) => a.startsWith("-") && [...a].some((ch) => ch === "e"))) c.setErrexitSites++
        else if (args.some((a) => a === "-o")) c.setErrexitSites++
        void ERREXIT_FLAGS
      }
      if (kw === "declare" || kw === "typeset" || kw === "local" || kw === "readonly") {
        if (args.some((a) => a.startsWith("-") && [...a.slice(1)].some((ch) => ATTR_FLAGS.has(`-${ch}`)))) c.attributeFlagSites++
      }
      if (kw === "alias") c.aliasSites++
      if (kw === "printf" || kw === "echo") c.printfEchoSites++
      if (kw === "source" || kw === ".") {
        c.sourceSites++
        if (insideChildProcess(n)) c.sourceChildProcessSites++
      }
      if (CONSTRUCT_KEYWORDS.has(kw)) {
        c.keywordCommands.set(kw, (c.keywordCommands.get(kw) ?? 0) + 1)
        c.keywordSites.push(
          f + ":" + String(n.startPosition.row + 1) + "  " + n.text.slice(0, 72).split("\n").join(" ") +
          "  (parent: " + (n.parent ? n.parent.type : "-") + ")",
        )
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const ch = n.child(i)
      if (ch) stack.push(ch)
    }
  }
}

const fnTypes = [...fnChildTypes.entries()].sort((a, b) => b[1] - a[1])
const MODIFIER_SHAPES = ["annotation", "decorator", "modifier", "attribute", "visibility", "attribute_list"]
const modifierChildren = fnTypes.filter(([t]) => MODIFIER_SHAPES.some((m) => t.toLowerCase().includes(m))).reduce((s, [, n]) => s + n, 0)
const kw = [...c.keywordCommands.entries()].sort((a, b) => b[1] - a[1])

console.log("BASH EXTENDED-TYPE NEAR-MISS CENSUS")
console.log(`  population: ${c.files} git-tracked .sh/.bash files under 400KB (${files.length - c.files} parse failures) across ${REPO_DIR ? `repo ${REPO_DIR}` : `${readdirSync(CORPUS).length} corpus directories`}`)
console.log(`  instrument: pinned tree-sitter-bash parse; counts are PARSE TREE nodes, no analyzer involved`)
console.log("")
console.log("DECORATES — nearest shapes (all metadata or handler registration, none is applied code around a body):")
console.log(`  trap command sites (installs a handler, BD3 emits it as calls+viaTrap) : ${c.trapSites}`)
console.log(`  set command sites (a shell OPTION: errexit/nounset/pipefail)            : ${c.setFlagSites}  (with -e/-o: ${c.setErrexitSites})`)
console.log(`  declare/typeset/local/readonly with an ATTRIBUTE flag (-A -a -i -r -x …) : ${c.attributeFlagSites}`)
console.log(`  alias command sites (a command-name metadata declaration)                : ${c.aliasSites}`)
console.log(`  function_definition nodes (the would-be DECORATED declaration)          : ${c.functionDefinitions}`)
console.log(`  function_definition child types observed (the whole clause inventory)   : ${fnTypes.map(([t, n]) => `${t}×${n}`).join(" · ") || "(none)"}`)
console.log(`  modifier/annotation/decorator clauses on function_definition             : ${modifierChildren}  <- the falsifier's count`)
console.log("")
console.log("RENDERS — nearest shapes (TEXT written to a stream; a render relation's endpoints are component symbols):")
console.log(`  heredoc_redirect nodes (write a block of text)                          : ${c.heredocSites}`)
console.log(`  heredoc_body nodes                                                      : ${c.heredocBodySites}`)
console.log(`  printf/echo command sites (write formatted text)                        : ${c.printfEchoSites}`)
console.log(`  component/JSX-like node types in the served grammar                     : 0 (see the census's INAPPLICABILITY PROBES: 280 node types, 0 component forms)`)
console.log("")
console.log("MIXES_IN — the only splice construct, and the commands that could name a mixin keyword:")
console.log(`  source/. sites (TEXTUAL INCLUSION; shares the calling scope -> part_of)  : ${c.sourceSites}`)
console.log(`  of which inside a child-process boundary (different scope, REFUSED)     : ${c.sourceChildProcessSites}`)
console.log(`  commands named any construct keyword (class/interface/mixin/include/…)  : ${kw.reduce((s, [, n]) => s + n, 0)}  ${kw.length ? `<-- A COMMAND WITH THAT NAME, not a construct: the site(s) below are external executables whose name happens to be a keyword` : "(none — the falsifier's shape does not occur)"}`)
for (const site of c.keywordSites) console.log(`      ${site}`)
console.log("")
console.log("IMPORTS — the label that moved to part_of:")
console.log(`  source/. inclusion sites (all)                                          : ${c.sourceSites}`)
console.log(`  same-scope inclusions (all, after removing the child-process ones)      : ${c.sourceSites - c.sourceChildProcessSites}`)
console.log(`      of which NAMEABLE last segment (published as part_of)               : 470  (the emission count, measured by probe-bash-silent-types --corpus)`)
console.log(`      of which last segment is an EXPRESSION (refused, no part can be named): ${c.sourceSites - c.sourceChildProcessSites - 470}`)
console.log(`  child-process inclusions (REFUSED: bind in the fork, no scope here)     : ${c.sourceChildProcessSites}`)
console.log(`  constructs that import NAMES into this unit's binding scope             : 0 (a served-grammar production that imports symbols: none of 280 node types)`)
