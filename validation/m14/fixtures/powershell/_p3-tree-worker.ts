/**
 * Shard worker for the TREE half of `pass3-probes.ts`.
 *
 * Reads a newline-separated file list, parses each file with the SAME pinned wasm the
 * engine loads (`getParser("powershell")` from `src/ast/engine.ts`), and writes the
 * per-file facts the pass-3 probes need.
 *
 * ## What pass 3 added and why this worker exists separately from `_adv-tree-worker.ts`
 *
 * Pass 2's tree worker answers questions about CLASSES: members, modifiers, header
 * shapes. Pass 3's questions are about SCOPES and about INHERITANCE DEPTH, which need a
 * different traversal: a declaration's owner is not a property of its node but of its
 * ANCESTORS, so the worker walks parents and records the nearest owner-bearing ancestor
 * under two DIFFERENT rules.
 *
 * The two rules are the whole of probe P12, so they are named here rather than being
 * two `if`s in a probe:
 *
 *   ANALYZER_OWNER_NODES — the node types `real-powershell-analyzer.ts` pushes a frame
 *     on. `frames.push` appears at seven sites (function_statement, class_statement,
 *     enum_statement, class_method_definition, and three DSC/interface sites), and
 *     `addContains` reads `top().owner`. So these four node types ARE the analyzer's
 *     definition of "owner", derived from the source rather than assumed.
 *
 *   LANGUAGE_SCOPE_NODES — the node types that are a SCOPE in PowerShell. `named_block`
 *     is the one the analyzer's set is missing: `begin` / `process` / `end` /
 *     `dynamicparam` each run in their OWN scope, so a variable assigned in `process` is
 *     not visible in `end` without `$script:`. The corpus is asked how much that costs.
 *
 * Why a worker: `parser.parse()` is synchronous WASM and cannot be interrupted from the
 * event loop, so one pathological file hangs a single process forever. The census found
 * the file that does it (`fsharp/eng/release/scripts/GetAssemblyVersions.ps1`, `memory
 * access out of bounds`), and this worker reads the tree directly with no engine timer
 * above it. Sharding keeps that blast radius to one shard and the driver reports shard
 * failures rather than dropping them.
 */
import { readFileSync, writeFileSync } from "node:fs"
import type { Node } from "web-tree-sitter"
import { getParser } from "../../../../src/ast/engine"

const [listFile, outFile] = process.argv.slice(2)
const files = readFileSync(listFile, "utf8").split("\n").filter(Boolean)

const parser = await getParser("powershell")
if (parser.parse("class A { }").rootNode.type !== "program") {
  console.error("[P3-TREE] the parser did not load — every tree number below would be a false zero")
  process.exit(2)
}

/** The node types `real-powershell-analyzer.ts` pushes an owner frame on. */
const ANALYZER_OWNER_NODES = new Set([
  "function_statement", "class_statement", "enum_statement", "class_method_definition",
])

const firstChildOfType = (n: Node, type: string): Node | null => {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && c.type === type) return c
  }
  return null
}
/** The first `type` in the subtree, in document order. Not the first in DFS order:
 *  a stack walk that pushes children in reverse returns the DEEPEST-left match, and
 *  `left_assignment_expression` can carry several `variable` descendants through nested
 *  expression nodes. */
const firstDescendantOfType = (n: Node, type: string): Node | null => {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (!c) continue
    if (c.type === type) return c
    const inner = firstDescendantOfType(c, type)
    if (inner) return inner
  }
  return null
}
const childTexts = (n: Node, type: string): string[] => {
  const out: string[] = []
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && c.type === type) out.push(c.text)
  }
  return out
}
const walk = (root: Node, types: Set<string>, visit: (n: Node) => void): void => {
  const stack: Node[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (types.has(n.type)) visit(n)
    for (let i = n.childCount - 1; i >= 0; i--) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
}

/** The name the analyzer would use for an owner-bearing ancestor, or "" for file scope. */
const ownerNameOf = (n: Node): string => {
  if (n.type === "function_statement") return childTexts(n, "function_name")[0] ?? ""
  if (n.type === "enum_statement" || n.type === "class_statement") return childTexts(n, "simple_name")[0] ?? ""
  if (n.type === "class_method_definition") return childTexts(n, "simple_name")[0] ?? ""
  return ""
}

/** Nearest ancestor of one of `types`, or null. */
const nearest = (n: Node, types: Set<string>): Node | null => {
  let cur = n.parent
  while (cur) {
    if (types.has(cur.type)) return cur
    cur = cur.parent
  }
  return null
}

/**
 * The nearest ancestor in `types` that lies BETWEEN `n` and `stop` — i.e. strictly
 * inside `stop`, exclusive of it.
 *
 * ## Why this exists, and what the first version got wrong
 *
 * The first version asked for the nearest `named_block` ancestor with no lower bound, so
 * it walked PAST the owner. A class declared inside a `process` block therefore reported
 * every one of its properties as "inside a named block", and the probe printed 89
 * property rows that cannot exist — PowerShell has no property declaration inside a
 * `begin`/`process`/`end` block. That is the same failure pass 2 recorded against its own
 * first tree probe: an instrument that does not model the rule it is auditing measures a
 * different rule and the number reads as a finding.
 *
 * The question P12 actually asks is "does a `named_block` sit between this declaration and
 * the owner the analyzer will attribute it to", so the owner is the lower bound and the
 * answer is only counted when the block is strictly inside it.
 */
const nearestBelow = (n: Node, types: Set<string>, stop: Node | null): Node | null => {
  let cur = n.parent
  while (cur && cur !== stop) {
    if (types.has(cur.type)) return cur
    if (stop && cur.startIndex < stop.startIndex) return null
    cur = cur.parent
  }
  return null
}

type DeclRec = {
  name: string
  line: number
  /** what kind of declaration this is, so a probe can separate them */
  via: "assignment" | "foreach" | "scriptParameter" | "methodParameter" | "property"
  /** the name the analyzer's own frame stack would attribute this declaration to */
  analyzerOwner: string
  /** the block_name of the nearest enclosing `named_block`, or "" */
  namedBlock: string
  /** 1 when the declaration sits inside a `& { … }` script-block invocation (a CHILD scope) */
  childScopeInvoke: number
  /** 1 when the declaration sits inside a `. { … }` script-block dot-invocation (the SAME scope) */
  sameScopeInvoke: number
}

type ClassRec = {
  name: string
  base: string
  line: number
  /** base-chain hop count: 1 when a base is declared in this file, 0 otherwise */
  chainDepth: number
  members: { name: string; line: number }[]
}

const out: {
  file: string
  decls: DeclRec[]
  blockNames: Record<string, number>
  namedBlockNodes: number
  errorNodes: number
  /** ERROR nodes whose text carries the `clean` keyword: the PS-P17 limit */
  errorsMentioningClean: number
  classes: ClassRec[]
  /** same-name derived/base member pairs whose matching base member is 2+ hops up */
  transitiveOverridePairs: { derived: string; base: string; member: string; hops: number; line: number }[]
  /** same-name pairs the chain resolves at hop 1 — the analyzer's first-match-wins population */
  directPairs: { derived: string; base: string; member: string; hops: number; line: number }[]
}[] = []

for (const f of files) {
  let tree: ReturnType<Parser["parse"]> = null
  try {
    tree = parser.parse(readFileSync(f, "utf8"))
  } catch (e) {
    console.error(`[P3-TREE-ERR] ${f}: ${String(e).slice(0, 200)}`)
    continue
  }
  if (!tree) continue

  // ---- block-name inventory + ERROR census
  const blockNames: Record<string, number> = Object.create(null)
  let namedBlockNodes = 0
  walk(tree.rootNode, new Set(["named_block"]), (n) => {
    namedBlockNodes++
    const bn = firstChildOfType(n, "block_name")
    const k = bn ? bn.text : "(no block_name)"
    blockNames[k] = (blockNames[k] ?? 0) + 1
  })
  let errorNodes = 0
  let errorsMentioningClean = 0
  walk(tree.rootNode, new Set(["ERROR"]), (n) => {
    errorNodes++
    if (n.text.includes("clean")) errorsMentioningClean++
  })

  // ---- declarations, with BOTH owner rules
  const decls: DeclRec[] = []
  const record = (v: Node, via: DeclRec["via"]) => {
    const raw = v.text
    const name = raw.startsWith("$") ? raw.slice(1) : raw
    if (!name) return
    const ownerNode = nearest(v, ANALYZER_OWNER_NODES)
    // The owner is the LOWER BOUND: a `named_block` counts only when it sits strictly
    // inside the owner the analyzer will attribute this declaration to.
    const nb = nearestBelow(v, new Set(["named_block"]), ownerNode)
    // Same bound for the invocation-operator test: a `command` ABOVE the owner is a
    // different command, and `& { … }` enclosing a whole function is not a child scope
    // of anything the function declares.
    let childScopeInvoke = 0
    let sameScopeInvoke = 0
    let cur: Node | null = v.parent
    while (cur && cur !== ownerNode) {
      if (cur.type === "command") {
        const op = firstChildOfType(cur, "command_invokation_operator")
        if (op) {
          if (op.text === "&") childScopeInvoke = 1
          else if (op.text === ".") sameScopeInvoke = 1
        }
        break
      }
      cur = cur.parent
    }
    decls.push({
      name,
      line: v.startPosition.row + 1,
      via,
      analyzerOwner: ownerNode ? ownerNameOf(ownerNode) : "",
      namedBlock: nb ? (firstChildOfType(nb, "block_name")?.text ?? "(none)") : "",
      childScopeInvoke,
      sameScopeInvoke,
    })
  }

  // Assignment LHS: `left_assignment_expression` holds the target. The shape the pinned
  // wasm produces is
  //
  //   assignment_expression
  //     left_assignment_expression
  //       logical_expression -> … -> variable
  //
  // so the `variable` is a DESCENDANT of the LHS node, not an ancestor. The first version
  // of this walk looked UPWARD and therefore found no assignment declarations at all —
  // 0 of them, on a corpus where `$x = 1` is the most common declaration in the language.
  // A zero on the dominant shape of the construct is the instrument reporting on itself
  // rather than on the corpus, so it is worth stating: the count it produced was 0 and
  // `declarationSitesByKind` had no `assignment` key at all.
  walk(tree.rootNode, new Set(["left_assignment_expression"]), (n) => {
    const v = firstDescendantOfType(n, "variable")
    if (v) record(v, "assignment")
  })
  // `foreach ($x in …)`
  walk(tree.rootNode, new Set(["foreach_statement"]), (n) => {
    const v = firstChildOfType(n, "variable")
    if (v) record(v, "foreach")
  })
  // Script-level parameters
  walk(tree.rootNode, new Set(["script_parameter"]), (n) => {
    const v = firstChildOfType(n, "variable")
    if (v) record(v, "scriptParameter")
  })
  // Class properties are OWNED by the class under both rules, so they are recorded to
  // show the control, not the effect: a property never sits in a named_block.
  walk(tree.rootNode, new Set(["class_property_definition"]), (n) => {
    const v = firstChildOfType(n, "variable")
    if (v) record(v, "property")
  })

  // ---- classes and inheritance depth (P15)
  const classes: ClassRec[] = []
  walk(tree.rootNode, new Set(["class_statement"]), (n) => {
    const names = childTexts(n, "simple_name")
    classes.push({
      name: names[0] ?? "",
      base: names.length > 1 ? names[1] : "",
      line: n.startPosition.row + 1,
      chainDepth: 0,
      members: [],
    })
  })
  // LAST-wins per name, matching the analyzer's own `classMembers` accumulation and
  // `baseClassByClass` (which is set inside `if (base)`, so a base-less redeclaration
  // leaves the earlier base in place — the asymmetry PS28 recorded).
  const byName = new Map<string, ClassRec>()
  for (const c of classes) if (c.name) byName.set(c.name, c)
  for (const c of byName.values()) {
    let base = c.base
    let hops = 0
    let guard = 0
    while (base && guard++ < 8) {
      hops++
      const b = byName.get(base)
      if (!b) break
      base = b.base
    }
    c.chainDepth = hops
  }
  walk(tree.rootNode, new Set(["class_method_definition"]), (n) => {
    const owner = nearest(n, new Set(["class_statement"]))
    const ownerName = owner ? childTexts(owner, "simple_name")[0] ?? "" : ""
    const rec = byName.get(ownerName)
    if (!rec) return
    const nm = childTexts(n, "simple_name")[0]
    if (!nm || nm === ownerName) return
    rec.members.push({ name: nm, line: n.startPosition.row + 1 })
  })

  // Override pairs, at the FIRST hop that declares the member.
  //
  // ## The first version of this walk was a false positive, and the reason is the rule
  //
  // It recorded a pair at EVERY hop where the member matched, so `class D : C : A` with
  // `GetName` declared on both C and A produced `D -> A` at hop 2, the join found no such
  // edge, and the probe printed `WRONG (under-firing) — 1 of 1 transitive pairs are in the
  // tree and not in the output`. The analyzer had published `D -> C` and was RIGHT: it
  // breaks at the first hop that declares the member (real-powershell-analyzer.ts:2482),
  // and PowerShell resolves `D.GetName` to the nearest declaration in the chain, which is
  // C's.
  //
  // So the walk has to model first-match-wins, which is the same failure pass 2 recorded
  // twice against its own probes: an instrument that does not model the rule it is
  // auditing measures a different rule. A pair is TRANSITIVE only when the chain from the
  // derived class up to the matching base contains NO earlier declaration of the member.
  type Pair = { derived: string; base: string; member: string; hops: number; line: number }
  const firstMatchPairs: Pair[] = []
  for (const c of classes) {
    if (!c.name) continue
    for (const m of c.members) {
      let base = c.base
      let hops = 0
      let guard = 0
      while (base && guard++ < 8) {
        hops++
        const brec = byName.get(base)
        if (!brec) break
        const hit = brec.members.find((x) => x.name.toLowerCase() === m.name.toLowerCase())
        if (hit) { firstMatchPairs.push({ derived: c.name, base, member: m.name, hops, line: c.line }); break }
        base = brec.base
      }
    }
  }
  const directPairs = firstMatchPairs.filter((p) => p.hops === 1)
  const transitiveOverridePairs = firstMatchPairs.filter((p) => p.hops >= 2)

  out.push({ file: f, decls, blockNames, namedBlockNodes, errorNodes, errorsMentioningClean, classes, transitiveOverridePairs, directPairs })
}

writeFileSync(outFile, JSON.stringify(out), "utf8")