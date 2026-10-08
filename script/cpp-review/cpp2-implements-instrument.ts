/**
 * CPP2 — THE `implements` INSTRUMENT. The falsifiable measurement behind the tenth
 * relationship type's verdict, and the instrument that OVERTURNS batch 1's.
 *
 * WHY THIS FILE EXISTS. `docs/analyzers/real-cpp-analyzer.md` carried
 * `implements | ❌ never emitted | C++ has no separate interface construct`, and two
 * of the three numbers offered as evidence for it were produced by probes that
 * cannot fire:
 *
 *   1. `script/cpp-review/language-shape-census.ts`'s `pure_virtual_in_inherited_class`
 *      reads **0** over the two pinned corpora. It fires on
 *      `n.type === "pure_virtual_clause" || (n.type === "function_declarator" && /\)\s*=\s*0\s*$/.test(n.text))`.
 *      The pinned fork declares `pure_virtual_clause`
 *      (`grammars/tree-sitter-cpp/grammar.js`: `pure_virtual_clause: _ => seq('=', /0/, ';')`)
 *      but reaches it only from `inline_method_definition` and
 *      `constructor_or_destructor_definition`, and the corpus produces **0** of them.
 *      And the `function_declarator`'s own TEXT ends at `)` — the `= 0` lives in the
 *      parent `declaration`'s `init_declarator` — so the second disjunct never matches
 *      either. Both disjuncts are dead. The lane's own second instrument,
 *      `script/cpp-review/pure-virtual-census.ts`, counts the population structurally
 *      and reads **7 sites over 4 files**. Two instruments in one lane, 0 against 7,
 *      and the 0 was load-bearing.
 *   2. The `pure_virtual_in_inherited_class` arm of the same file was written to
 *      answer "is there an abstract base INHERITED?", and it never asked that
 *      question. See `cpp2-abstract-base-probe.ts`'s git history: the first version
 *      of this file reported `P1 = 0` for a walk whose owner was popped BEFORE the
 *      body's children were visited, while the analyzer's own `isAbstract` flag read 3
 *      on the same corpus. The instrument was the thing that failed.
 *
 * So the ruling's evidence is rebuilt here from the tree, with three arms and a
 * self-test that FAILS if the probe cannot find a construct that is definitely
 * there.
 *
 *   ARM A — TREE. Every pure-virtual site in the corpus, its shape, and the class
 *           that owns it. Reads the pinned wasm directly and imports NOTHING from the
 *           analyzer, so a change in the analyzer cannot move Arm A's numbers.
 *   ARM B — PUBLISHED. What a CONSUMER sees: the symbols carrying
 *           `metadata.isPureVirtual` / `metadata.isAbstract`, and the `extends` edges
 *           whose target is one of them, split by whether the base is declared in the
 *           SAME file.
 *   ARM C — SYNTAX INVENTORY. Whether the LANGUAGE has a construct that states the
 *           relation, counted as grammar tokens and as nodes the fork produces.
 *
 * ARM C is what decides the verdict, because a verdict for `implements` is a
 * statement about the language first and the corpus second. ARM A and ARM B decide
 * whether the fact an `implements` edge would carry is being LOST.
 *
 *   SELF-TEST. The lane's own fixture `cpp/pure-virtual-signature-910` declares
 *   `class Base` with three pure virtuals and four classes deriving from it IN THE
 *   SAME FILE. Arm A must find Base's pure virtuals and Arm B must find
 *   `Same -> Base` and `Renamed -> Base` among the same-file abstract-base edges. If
 *   either reads 0 the instrument is broken and the script exits non-zero — the same
 *   discipline `script/cpp-review/defect-register.ts` applies to D7, whose first cut
 *   could not even load against the code it gated.
 *
 *   BB_CORPUS_ROOT=$HOME/fixtures/repositories CPP_REPOS=sqlite,cpp-sample \
 *     bun run script/cpp-review/cpp2-implements-instrument.ts [--out p] [--no-selftest]
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { ASTEngine, parseFile } from "../../src/ast/engine"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = process.env.CPP_OUT ?? "/tmp/opencode/cpp-review"
const SELF_TEST_FIXTURE = path.join(process.cwd(), "validation", "m14", "fixtures", "cpp", "pure-virtual-signature-910.cpp")
const GRAMMAR = path.join(process.cwd(), "grammars", "tree-sitter-cpp", "grammar.js")
const EXTS = new Set([".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx", ".hh", ".h++", ".h", ".ipp", ".tpp"])
const SKIP = new Set([".git", "build", "node_modules", ".github", "cmake-build-debug", "bazel-bin", "CMakeFiles"])

const arg = (f: string): string | undefined => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined }
const label = (f: string): string => `${path.basename(path.dirname(f))}/${path.basename(f)}`

function walkFiles(root: string): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length) {
    const d = stack.pop()!
    let entries: import("node:fs").Dirent[]
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue
      const full = path.join(d, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (EXTS.has(path.extname(e.name))) out.push(full)
    }
  }
  return out.sort()
}

/** The `= 0` INITIALISER, read off the grammar's own fields. Two shapes:
 *   field_declaration [declarator=function_declarator]  + a direct `0` child
 *   declaration [declarator=init_declarator[declarator=function_declarator, value=number_literal]]
 *  The declarator must be a `function_declarator` in both, so `virtual int x = 0;`
 *  (a member with an initialiser) is not counted. */
function pureVirtualMember(node: any): string | null {
  const d = node.childForFieldName?.("declarator")
  if (d?.type === "function_declarator") {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c?.type === "number_literal" && c.text.trim() === "0") return declaratorName(d)
    }
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (!c || c.type !== "init_declarator") continue
    const v = c.childForFieldName?.("value")
    const inner = c.childForFieldName?.("declarator")
    if (v?.type === "number_literal" && v.text.trim() === "0" && inner?.type === "function_declarator") return declaratorName(inner)
  }
  return null
}

function declaratorName(fn: any): string | null {
  let cur: any = fn
  for (let guard = 0; guard < 12 && cur; guard++) {
    if (cur.type === "identifier" || cur.type === "field_identifier") return cur.text.trim()
    const nxt = cur.childForFieldName?.("declarator")
    if (nxt) { cur = nxt; continue }
    let fb: any = null
    for (let i = 0; i < cur.namedChildCount; i++) {
      const c = cur.namedChild(i)
      if (c && (c.type === "identifier" || c.type === "field_identifier" || c.type.endsWith("declarator"))) { fb = c; break }
    }
    if (!fb) return null
    cur = fb
  }
  return null
}

/** Is this identifier a MACRO SPELLING (`/^[A-Z][A-Z0-9_]*$/`)? Restated here, char by
 *  char, rather than imported from the analyzer: an imported copy would make this
 *  instrument report the analyzer's own answer, and the whole point of Arm A is that
 *  it cannot be moved by a change in the analyzer (#916). Where the two disagree, the
 *  disagreement is the finding and is reported as such. */
function isMacroSpelling(s: string): boolean {
  if (s.length < 1) return false
  const a = s.charCodeAt(0)
  if (a < 65 || a > 90) return false
  for (let i = 1; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const up = c >= 65 && c <= 90
    const dg = c >= 48 && c <= 57
    if (!up && !dg && c !== 95) return false
  }
  return true
}

/** The REAL class name of a MACRO-DECORATED head, read off the tree.
 *
 *  `class BENCHMARK_EXPORT BenchmarkReporter { … };` is recovered as
 *
 *    function_definition
 *      class_specifier [name=type_identifier] "class BENCHMARK_EXPORT"
 *      identifier "BenchmarkReporter"          <- the real name, a bare SIBLING
 *      compound_statement "{ … }"              <- the class BODY
 *
 *  so the specifier's `name` field holds the MACRO and the class's own name is a
 *  sibling under the same parent. Two shapes, both in this corpus, and the
 *  inheritance one is the A2 arm:
 *
 *    class BENCHMARK_EXPORT ConsoleReporter : public BenchmarkReporter { … };
 *      class_specifier [name=type_identifier] "class BENCHMARK_EXPORT"
 *      ERROR "ConsoleReporter : public"        <- the NAME is in the ERROR
 *      identifier "BenchmarkReporter"          <- the BASE
 *      compound_statement "{ … }"
 *
 *  Returns null rather than a guess when neither reading is available, so an
 *  unresolvable head is counted and reported instead of being given a name. */
function decoratedHeadName(spec: any): string | null {
  const parent = spec.parent
  if (!parent || parent.type !== "function_definition") return null
  const sibs: any[] = []
  for (let i = 0; i < parent.namedChildCount; i++) {
    const c = parent.namedChild(i)
    if (c && c.startIndex !== spec.startIndex && c.type !== "compound_statement") sibs.push(c)
  }
  // arm 1: an ERROR holding exactly `identifier` then `:` — an inheritance clause
  for (const c of sibs) {
    if (c.type !== "ERROR") continue
    let first: any = null
    for (let k = 0; k < c.namedChildCount; k++) {
      const kc = c.namedChild(k)
      if (kc?.isNamed) { first = kc; break }
    }
    if (first?.type === "identifier") return first.text.trim()
  }
  // arm 2: the first sibling that is a plain name and NOT a macro spelling
  for (const c of sibs) {
    if (c.type !== "identifier" && c.type !== "template_type") continue
    const t = c.text.trim()
    if (t && !isMacroSpelling(t)) return t
  }
  return null
}

/** The class that owns a node, as the TREE states it.
 *
 *  The subtlety that made the first version of this file read 0, twice over:
 *
 *  (1) A MACRO-DECORATED head (`class BENCHMARK_EXPORT BenchmarkReporter {`) is
 *      recovered by the grammar as a `function_definition` whose specifier has NO
 *      `field_declaration_list` and whose PARENT's `compound_statement` is the body.
 *      "Does this specifier have a body" is therefore the wrong test, and it
 *      silently excluded every decorated head — which is precisely where the
 *      corpus's most-inherited abstract bases live.
 *  (2) A class with a body is not necessarily ABSTRACT. The first version pushed a
 *      row for every class it entered, so it reported 224 "abstract classes" over a
 *      corpus that has 7 pure virtuals. A row is now kept only if it owns >= 1 pure
 *      virtual.
 *
 *  An abstract base is then any class that owns >= 1 pure virtual by either reading,
 *  and `via` records which. */
interface Abs { cls: string; pure: string[]; file: string; line: number; via: "body" | "decorated-head" }

async function armA(files: string[]): Promise<{ sites: number; byShape: Record<string, number>; abs: Abs[]; decoratedHeads: number; nodeTypes: Set<string> }> {
  const byShape: Record<string, number> = {}
  const abs: Abs[] = []
  const nodeTypes = new Set<string>()
  let sites = 0
  let decoratedHeads = 0
  for (const f of files) {
    let content: string
    try { content = readFileSync(f, "utf8") } catch { continue }
    if (content.length > 4_000_000) continue
    let tree: any
    try { tree = await ASTEngine.parseTree(f, content) } catch { continue }
    const root = tree?.tree?.rootNode
    if (!root) continue
    // Owner markers live on their OWN stack, popped by an explicit exit token placed
    // on the traversal LIFO — so an owner lives exactly as long as the subtree under it.
    // The first version popped the owner inline, which emptied the stack before any
    // child was visited and made Arm A read 0 pure virtuals.
    type Frame = { node: any; owner: Abs | null; decorated: boolean }
    const owners: Frame[] = []
    const todo: Array<any | { __exit: true } | { __sub: any }> = [root]
    // A decorated head's body is claimed here so the parent's own visit of that same
    // `compound_statement` does not walk it a second time. Without it every pure
    // virtual inside a decorated class is counted TWICE — which is exactly what the
    // first corrected run showed: 6 `init_declarator` sites against the analyzer's 3.
    const claimed = new Set<number>()
    while (todo.length) {
      const raw: any = todo.pop()
      if (raw.__exit) { owners.pop(); continue }
      // `__sub` marks the ONE visit of a decorated head's body that must not be
      // skipped by the claim below. The claim is checked at POP, not at push: the
      // `function_definition`'s children are all pushed before the specifier claims
      // the body, so a push-time check has already passed by then. Both mistakes were
      // made and both were caught by the self-test — the push-time check walked every
      // decorated body zero times, and no check at all walked each of them twice.
      const bypass = raw.__sub !== undefined
      const n: any = bypass ? raw.__sub : raw
      const t = n.type
      if (!bypass && claimed.has(n.startIndex)) continue
      nodeTypes.add(t)
      let pushedOwner = false
      // For a MACRO-DECORATED head the BODY is not a child of the specifier: it is the
      // PARENT function_definition's `compound_statement`, a SIBLING of the specifier.
      // Walking only the specifier's children visits no declaration at all — which is
      // what the first version did, and it is why the self-test could not find
      // `Decorated`'s two pure virtuals on a fixture that plainly has them.
      let extraSubtree: any = null
      if (t === "class_specifier" || t === "struct_specifier" || t === "union_specifier") {
        let hasBody = false
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c?.type === "field_declaration_list") { hasBody = true; break }
        }
        const parent = n.parent
        const isDecorated = !hasBody && parent?.type === "function_definition"
        if (hasBody) {
          const nm = n.childForFieldName?.("name")?.text?.trim()
          if (nm) {
            let row = abs.find((a) => a.cls === nm && a.file === f)
            if (!row) { row = { cls: nm, pure: [], file: f, line: n.startPosition.row + 1, via: "body" }; abs.push(row) }
            owners.push({ node: n, owner: row, decorated: false })
            pushedOwner = true
          }
        } else if (isDecorated) {
          decoratedHeads++
          const real = decoratedHeadName(n)
          let row: Abs | null = null
          if (real) {
            row = abs.find((a) => a.cls === real && a.file === f) ?? null
            if (!row) { row = { cls: real, pure: [], file: f, line: n.startPosition.row + 1, via: "decorated-head" }; abs.push(row) }
          }
          owners.push({ node: n, owner: row, decorated: true })
          pushedOwner = true
          const parent = n.parent
          if (parent) {
            for (let i = 0; i < parent.namedChildCount; i++) {
              const c = parent.namedChild(i)
              if (c?.type === "compound_statement") { extraSubtree = c; claimed.add(c.startIndex); break }
            }
          }
        }
      } else if (t === "field_declaration" || t === "declaration") {
        const pv = pureVirtualMember(n)
        if (pv) {
          sites++
          const shape = n.type === "field_declaration" ? "field_declaration/direct" : "declaration/init_declarator"
          byShape[shape] = (byShape[shape] ?? 0) + 1
          const top = owners.length ? owners[owners.length - 1] : null
          if (top?.owner) {
            if (!top.owner.pure.includes(pv)) top.owner.pure.push(pv)
          } else {
            // inside a macro-decorated head, or outside any class: count the site but
            // attribute it to the DECORATED head's own line so it is visible
            const key = `<decorated-head>${top?.decorated ? `@${owners[owners.length - 1].node.startPosition.row + 1}` : "@file"}`
            let row = abs.find((a) => a.cls === key && a.file === f)
            if (!row) { row = { cls: key, pure: [], file: f, line: top?.decorated ? owners[owners.length - 1].node.startPosition.row + 1 : 0, via: "decorated-head" }; abs.push(row) }
            if (!row.pure.includes(pv)) row.pure.push(pv)
          }
        }
      }
      if (pushedOwner) todo.push({ __exit: true })
      for (let i = n.childCount - 1; i >= 0; i--) { const c = n.child(i); if (c) todo.push(c) }
      // pushed LAST so it is popped FIRST — inside the owner, before the exit
      if (extraSubtree) todo.push({ __sub: extraSubtree })
    }
  }
  // A row survives only if it OWNS a pure virtual: entering a class is not
  // abstractness, and the first version reported 224 "abstract classes" over a
  // corpus with 7 pure virtuals.
  const withVirtuals = abs.filter((x) => x.pure.length > 0)
  return { sites, byShape, abs: withVirtuals, decoratedHeads, nodeTypes }
}

/** ARM C — does the pinned GRAMMAR have a construct that states the relation?
 *  Counted as tokens/rules in the grammar source and as nodes the fork produces.
 *  `grep -c implements grammar.js` is 0 and there is no `interface` token, which is
 *  the strongest form of the argument: not "the corpus has none", but "the language
 *  as this parser models it has no such spelling to find". */
function armC(nodeTypes: Set<string>): Record<string, unknown> {
  let grammar = ""
  try { grammar = readFileSync(GRAMMAR, "utf8") } catch { /* recorded as unreadable below */ }
  const tokenCount = (needle: string): number => {
    if (!grammar) return -1
    let n = 0
    for (const line of grammar.split("\n")) if (line.includes(needle)) n++
    return n
  }
  const conceptNodes = ["concept_definition", "requires_clause", "requires_expression", "requires_parameter_list",
    "constraint_conjunction", "constraint_disjunction", "pure_virtual_clause", "implements_clause", "interface_specifier"]
  const nodeCounts: Record<string, number> = {}
  for (const k of conceptNodes) nodeCounts[k] = nodeTypes.has(k) ? 1 : 0
  return {
    grammarReadable: grammar.length > 0,
    grammarLinesMentioningImplementsToken: tokenCount("'implements'"),
    grammarLinesMentioningDoubleQuotedImplements: tokenCount('"implements"'),
    grammarLinesMentioningInterfaceToken: tokenCount("'interface'"),
    grammarDeclaresPureVirtualClause: grammar.includes("pure_virtual_clause:"),
    grammarDeclaresConceptDefinition: grammar.includes("concept_definition:"),
    grammarDeclaresRequiresClause: grammar.includes("requires_clause:"),
    nodeTypesObservedInCorpus: nodeTypes.size,
    conceptNodesObserved: nodeCounts,
  }
}

async function armB(files: string[]) {
  let symbols = 0
  let relationships = 0
  const abstractClasses = new Set<string>()
  const pureVirtualSymbols: string[] = []
  for (const f of files) {
    let content: string
    try { content = readFileSync(f, "utf8") } catch { continue }
    if (content.length > 4_000_000) continue
    let r: any
    try { r = await parseFile(f, content) } catch { continue }
    if (!r) continue
    symbols += r.symbols.length
    relationships += r.relationships.length
    for (const s of r.symbols) {
      if (s.metadata?.isPureVirtual) pureVirtualSymbols.push(`${s.ownerName ?? "-"}::${s.name}@${label(f)}:${s.metadata?.nameLine ?? s.range?.startLine}`)
      if (s.metadata?.isAbstract) abstractClasses.add(s.name)
    }
  }
  const extendsRows: Array<{ derived: string; base: string; file: string; line: number }> = []
  for (const f of files) {
    let content: string
    try { content = readFileSync(f, "utf8") } catch { continue }
    if (content.length > 4_000_000) continue
    let r: any
    try { r = await parseFile(f, content) } catch { continue }
    if (!r) continue
    for (const e of r.relationships) if (e.type === "extends") extendsRows.push({ derived: e.source, base: e.target, file: f, line: e.line_number ?? 0 })
  }
  return { symbols, relationships, abstractClasses, pureVirtualSymbols, extendsRows }
}

async function runArms(files: string[]) {
  const a = await armA(files)
  const b = await armB(files)
  // Arm A's abstract classes vs the extends edges Arm B collected
  const absNames = new Set(a.abs.map((x) => x.cls))
  const sameFile: typeof b.extendsRows = []
  const otherFile: typeof b.extendsRows = []
  const notAbstract: typeof b.extendsRows = []
  for (const e of b.extendsRows) {
    const absHere = a.abs.some((x) => x.cls === e.base && x.file === e.file)
    if (absHere) sameFile.push(e)
    else if (absNames.has(e.base)) otherFile.push(e)
    else notAbstract.push(e)
  }
  return { a, b, sameFile, otherFile, notAbstract }
}

/** ARM D — THE FAMILY. Does any lane in this repository emit `implements` for a
 *  reason other than a construct the LANGUAGE spells?
 *
 *  This is the leg that decides whether refusing `implements` for C++ makes this
 *  lane an OUTLIER or the consistent member of a family, and it is measured rather
 *  than asserted because the answer decides the verdict: if some lane already infers
 *  "this base is an interface" semantically, C++ should do the same, and if none
 *  does then every one of them is reading a SYNTAX and C++ has none.
 *
 *  The classification is mechanical. For each analyzer that pushes
 *  `RelationshipType.Implements`, the push site is recorded with the node type or
 *  token it reads, and the site is labelled:
 *
 *    declared-kind  — the base's own declaration says `interface`/`protocol`/
 *                     `trait`/`behaviour` (C#, Solidity, Go's `interface_type`)
 *    clause         — a grammar node that exists ONLY for the relation
 *                     (`super_interfaces`, `interfaces`, `ImplementsInterfaces`,
 *                     `implements_member_clause`, …)
 *    positional     — a slot in a heritage list that the language orders, so slot 0
 *                     is `extends` and the rest are `implements`
 *    heuristic      — inferred from a NAME or from an UNRESOLVED declaration
 *
 *  A fourth measurement is the one that settles the double-emission question: does
 *  any lane push BOTH `extends` and `implements` for the SAME (source, target) pair?
 *  `extends` and `implements` are an exclusive partition of one heritage list in
 *  every lane that has both, so a C++ `implements` that duplicated an `extends`
 *  edge would be a shape the family does not have.
 */
function armD(): Record<string, unknown> {
  const dir = path.join(process.cwd(), "src", "ast")
  let files: string[] = []
  try { files = readdirSync(dir).filter((f) => /^real-.*-analyzer\.ts$/.test(f)) } catch { /* recorded below */ }
  const CLAUSE_NODES = ["super_interfaces", "superinterface", "interfaces", "ImplementsInterfaces",
    "implements_member_clause", "protocol", "protocols", "interface_type", "behaviour",
    "protocol_specifiers", "interface_declaration", "reifies", "extendsProtocols"]
  const lanes: Array<Record<string, unknown>> = []
  const bothListLanes: string[] = []
  let heuristicSites = 0
  let unclassifiedSites = 0
  let totalSites = 0
  for (const f of files) {
    let src = ""
    try { src = readFileSync(path.join(dir, f), "utf8") } catch { continue }
    if (!src.includes("RelationshipType.Implements")) continue
    const lines = src.split("\n")
    const sites: Array<Record<string, unknown>> = []
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes("RelationshipType.Implements")) continue
      // The arm is read from the 40 lines before the push and the 10 after it, which
      // is where a lane states the discriminator. A narrower window classifies sites
      // by whatever unrelated word happens to be nearby — the first cut used 24 and
      // put go, rust, typescript, haskell and r in `unclassified` for that reason.
      const ctx = lines.slice(Math.max(0, i - 40), i + 10).join("\n")
      let arm = "unclassified"
      if (/looksLike|\^\[|charCodeAt\(0\) === 73|[Uu]ndecided|[Uu]nresolved/i.test(ctx)) arm = "heuristic"
      else if (/SymbolKind\.Interface|declaredKind|isInterface|interfaceNames|interface_type|interfaceSymbol|InterfaceKind|isTrait|traitNode|protocolNode|behaviour|Reifies|reifies/i.test(ctx)) arm = "declared-kind"
      else if (CLAUSE_NODES.some((n) => ctx.includes(n))) arm = "clause"
      else if (/Extends/.test(ctx) && /i === 0|i > 0|seenInherits < 0|superByClass|first: true|=== 0 \?/.test(ctx)) arm = "positional"
      sites.push({ line: i + 1, arm })
      if (arm === "heuristic") heuristicSites++
      if (arm === "unclassified") unclassifiedSites++
    }
    totalSites += sites.length
    // does this lane emit BOTH labels out of ONE heritage list? a ternary whose two
    // arms are the two labels is the shape; `extends`+`implements` are an EXCLUSIVE
    // partition of a single list in every lane that has both.
    // Both ternary ORDERS occur: csharp/kotlin/solidity write `cond ? Implements :
    // Extends`, scala/swift write `isExtends ? Extends : Implements`. The first regex
    // matched one order and reported 1 lane, which is a number about the regex.
    const sameListTernary = [
      /type:\s*\w+\s*\?[^"'\n]*RelationshipType\.Implements[^"'\n]*:\s*[^"'\n]*RelationshipType\.Extends/,
      /type:\s*\w+\s*\?[^"'\n]*RelationshipType\.Extends[^"'\n]*:\s*[^"'\n]*RelationshipType\.Implements/,
      /\?[^"'\n]*RelationshipType\.Implements[^"'\n]*:[^"'\n]*RelationshipType\.Extends/,
      /\?[^"'\n]*RelationshipType\.Extends[^"'\n]*:[^"'\n]*RelationshipType\.Implements/,
    ].some((re) => re.test(src))
    if (sameListTernary) bothListLanes.push(f.replace(/^real-|-analyzer\.ts$/g, ""))
    lanes.push({
      lane: f.replace(/^real-|-analyzer\.ts$/g, ""),
      sites: sites.length,
      arms: [...new Set(sites.map((x) => x.arm))].sort(),
      emitsBothLabelsFromOneList: sameListTernary,
      siteDetail: sites.slice(0, 8),
    })
  }
  lanes.sort((a, b) => String(a.lane).localeCompare(String(b.lane)))
  return {
    lanesEmittingImplements: lanes.length,
    totalSites,
    unclassifiedSites,
    heuristicSites,
    lanesEmittingBothLabelsFromOneHeritageList: bothListLanes.length,
    lanesEmittingBothLabels: bothListLanes,
    lanes: lanes.map((l) => `${l.lane}: ${l.arms.join("/")}${l.emitsBothLabelsFromOneList ? "  [one list, both labels]" : ""}`),
    siteDetail: lanes,
    note: "An arm of `heuristic` or `unclassified` is a lane reading the relation WITHOUT a language construct naming it, and is listed so a reader can check it rather than take the classification on trust. `declared-kind`, `clause` and `positional` each require the language to SAY the relation.",
  }
}


async function main() {
  const repoNames = (process.env.CPP_REPOS ?? "sqlite,cpp-sample").split(",").map((s) => s.trim()).filter(Boolean)
  const files: string[] = []
  for (const r of repoNames) files.push(...walkFiles(path.join(CORPUS, r)))

  const { a, b, sameFile, otherFile, notAbstract } = await runArms(files)
  const c = armC(a.nodeTypes)

  // ---- SELF-TEST: the instrument must FIND a construct that is definitely there.
  let selfTest = { ran: false, pass: false, detail: [] as string[] }
  if (!process.argv.includes("--no-selftest")) {
    const detail: string[] = []
    let pass = true
    try {
      const r = await runArms([SELF_TEST_FIXTURE])
      const base = r.a.abs.find((x) => x.cls === "Base")
      if (!base || base.pure.length < 3) { pass = false; detail.push(`Arm A: expected Base to own >= 3 pure virtuals, got ${base ? base.pure.length : "no Base row"}`) }
      else detail.push(`Arm A: Base owns ${base.pure.length} pure virtuals (${base.pure.join(", ")})`)
      const derived = r.sameFile.filter((e) => e.base === "Base").map((e) => e.derived)
      if (derived.length < 2) { pass = false; detail.push(`Arm B: expected >= 2 same-file extends edges into Base, got ${derived.length}`) }
      else detail.push(`Arm B: same-file extends into Base: ${derived.join(", ")}`)
      if (!r.b.abstractClasses.has("Base")) { pass = false; detail.push("Arm B: analyzer did not publish Base as abstract") }
      else detail.push("Arm B: analyzer published Base with metadata.isAbstract")
      const decorated = r.a.abs.find((x) => x.via === "decorated-head" && x.cls === "Decorated")
      if (!decorated || decorated.pure.length < 2) { pass = false; detail.push(`Arm A: expected the macro-decorated head 'Decorated' to own >= 2 pure virtuals, got ${decorated ? decorated.pure.length : "no row"})`) }
      else detail.push(`Arm A: macro-decorated head 'Decorated' owns ${decorated.pure.length} (${decorated.pure.join(", ")}) — the arm batch 1's probe could not see`)
    } catch (e) {
      pass = false
      detail.push(`self-test threw: ${e instanceof Error ? e.message : String(e)}`)
    }
    selfTest = { ran: true, pass, detail }
  }

  const out = {
    at: new Date().toISOString(),
    corpus: CORPUS,
    repos: repoNames,
    filesWalked: files.length,
    armA_tree: {
      pureVirtualSites: a.sites,
      byShape: a.byShape,
      macroDecoratedHeads: a.decoratedHeads,
      abstractClassesNamed: a.abs.filter((x) => x.via === "body").length,
      abstractClassesFromDecoratedHeads: a.abs.filter((x) => x.via === "decorated-head").length,
      abstractClassList: a.abs.map((x) => ({ cls: x.cls, via: x.via, pureVirtuals: x.pure.length, file: label(x.file), line: x.line, members: x.pure.slice(0, 4) })),
    },
    armB_published: {
      symbols: b.symbols,
      relationships: b.relationships,
      symbolsWithIsPureVirtual: b.pureVirtualSymbols.length,
      isPureVirtualSites: b.pureVirtualSymbols.slice(0, 30),
      classesWithIsAbstract: b.abstractClasses.size,
      isAbstractNames: [...b.abstractClasses].sort(),
      extendsTotal: b.extendsRows.length,
      extendsIntoAbstractBaseSameFile: sameFile.length,
      extendsIntoAbstractBaseSameFileRows: sameFile.slice(0, 25).map((e) => `${e.derived} -> ${e.base}  ${label(e.file)}:${e.line}`),
      extendsIntoAbstractBaseOtherFile: otherFile.length,
      extendsIntoAbstractBaseOtherFileRows: otherFile.slice(0, 25).map((e) => `${e.derived} -> ${e.base}  ${label(e.file)}:${e.line}`),
      extendsIntoNonAbstractBase: notAbstract.length,
    },
    armC_syntax: c,
    armD_family: armD(),
    selfTest,
  }
  const outPath = arg("--out") ?? path.join(OUT, "cpp2-implements-instrument.json")
  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(out, null, 2))

  console.log(`corpus files ${files.length}`)
  console.log(`ARM A (tree)   pure-virtual sites ${a.sites} ${JSON.stringify(a.byShape)} | macro-decorated heads ${a.decoratedHeads} | abstract classes with a body ${out.armA_tree.abstractClassesNamed} | abstract classes recovered from a decorated head ${out.armA_tree.abstractClassesFromDecoratedHeads}`)
  console.log(`ARM B (pub.)   isPureVirtual symbols ${b.pureVirtualSymbols.length} | isAbstract classes ${b.abstractClasses.size} [${[...b.abstractClasses].sort().join(", ")}]`)
  console.log(`ARM B extends  total ${b.extendsRows.length} | into an abstract base, SAME file ${sameFile.length} | OTHER file ${otherFile.length} | into a non-abstract base ${notAbstract.length}`)
  for (const e of otherFile.slice(0, 25)) console.log(`     other-file  ${e.derived} -> ${e.base}  ${label(e.file)}:${e.line}`)
  console.log(`ARM C (syntax) grammar mentions 'implements' token: ${c.grammarLinesMentioningImplementsToken} | 'interface' token: ${c.grammarLinesMentioningInterfaceToken} | declares pure_virtual_clause: ${c.grammarDeclaresPureVirtualClause} | declares concept_definition: ${c.grammarDeclaresConceptDefinition} | declares requires_clause: ${c.grammarDeclaresRequiresClause}`)
  console.log(`ARM C nodes    distinct node types observed ${c.nodeTypesObservedInCorpus} | concept/implements nodes: ${JSON.stringify(c.conceptNodesObserved)}`)
  const d = out.armD_family as any
  console.log(`ARM D (family) lanes emitting \`implements\`: ${d.lanesEmittingImplements} | push sites ${d.totalSites} | heuristic ${d.heuristicSites} | unclassified ${d.unclassifiedSites} | lanes whose ONE heritage list yields BOTH labels: ${d.lanesEmittingBothLabelsFromOneHeritageList} ${JSON.stringify(d.lanesEmittingBothLabels)}`)
  for (const l of d.lanes) console.log(`     ${l}`)
  console.log(`SELF-TEST      ${selfTest.ran ? (selfTest.pass ? "PASS" : "FAIL") : "skipped"}`)
  for (const d of selfTest.detail) console.log(`     ${d.startsWith("Arm") ? "" : "!! "}${d}`)
  console.log(`evidence: ${outPath}`)
  if (selfTest.ran && !selfTest.pass) { console.error("SELF-TEST FAILED: the instrument cannot find a construct that is present, so its zeros prove nothing"); process.exit(1) }
}

await main()
