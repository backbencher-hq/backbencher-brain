// CS-DEEP-1 — the csharp lane's deep corpus census (M12/M14/M37/M49/M60).
//
// WHAT IT MEASURES, and why a census is the instrument (not the differential):
//
//   The F5 differential answers "does every edge the ANALYZER emits have a
//   derivable counterpart, and does every derivable edge have an emitted
//   one". It is a two-sided comparison over ONE edge family per label. An
//   ABSENT capability emits nothing, so it is invisible to both sides: an
//   analyzer that never names a construct cannot miss an edge for it. That
//   is the same blind spot the R9 declared-type round was built on, and it
//   is why a census — grammar-truth over real code vs the analyzer's own
//   vocabulary — is the other half of the work.
//
//   Four questions, each answered from the TREE (never from the analyzer's
//   own output, so a defect cannot vouch for itself):
//
//     1. NODE COVERAGE. Every node type the shipped grammar produces over a
//        real corpus, split by whether the analyzer NAMES it (a string
//        literal or a dispatch arm in real-csharp-analyzer.ts). Unnamed
//        types are the census's candidate set: either a container the
//        analyzer correctly ignores, or a construct it silently drops.
//     2. SYMBOL COVERAGE. Every DECLARATION-shaped node (the grammar's own
//        declaration family) compared against what the analyzer published:
//        a declaration that produces no symbol at all is a dropped symbol.
//     3. CALL COVERAGE. Every invocation_expression's callee leaf compared
//        against the `calls` edges emitted, per (source, target) — this is
//        the differential's truth side, run over a corpus the lane has never
//        drawn, so a MISSING is a lane finding and not a baseline row.
//     4. RELATIONSHIP SHAPE. Every emitted relationship's target examined
//        for the classes the lane has already ruled (identifier shape,
//        literal/keyword, punctuation, layout text) — the R10 classes, run
//        on a corpus no R10 draw has read.
//
// Usage (from the repo root):
//   bun script/m14/tmp/cs-deep-census.ts --list <file-of-paths> [limit]
//   bun script/m14/tmp/cs-deep-census.ts --out <file-of-paths> <limit>
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

function arg(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}

async function main() {
  const listFile = arg("--list") ?? arg("--out")
  if (!listFile) {
    console.error("usage: cs-deep-census.ts --list <paths-file> [limit]")
    process.exit(2)
  }
  const limit = Number(process.argv[process.argv.indexOf(listFile) + 1] ?? 400)
  const files = fs.readFileSync(listFile, "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, limit)

  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  // The analyzer's own vocabulary: every string literal that could be a node
  // type or a node-type predicate fragment. Deliberately crude — a FALSE
  // "named" verdict only ever hides a candidate, and the reading step below
  // re-derives the survivors by hand.
  const analyzerSrc = fs.readFileSync(path.join(ROOT, "src/ast/real-csharp-analyzer.ts"), "utf8")
  const literals = new Set<string>()
  for (const m of analyzerSrc.matchAll(/"([a-z_][a-z0-9_]{2,})"/g)) literals.add(m[1])
  const namesNodeType = (t: string): boolean => literals.has(t)

  const nodeCounts = new Map<string, number>()
  const declNodeTypes = new Set<string>()
  const declNoSymbol: string[] = []
  const callMisses = new Map<string, number>()
  const callMissSamples: string[] = []
  const shapeConvictions = new Map<string, number>()
  const shapeSamples = new Map<string, string[]>()
  const parseErrorFiles: string[] = []

  let filesRead = 0
  let symbols = 0
  let relationships = 0

  // The declaration family, straight from the grammar's own naming rule
  // (`*_declaration`, plus the two shapes the grammar spells without it).
  const isDeclNode = (t: string): boolean =>
    t.endsWith("_declaration") || t.endsWith("_declarations") || t === "constructor_initializer"

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser.parse(src)
    if (tree.rootNode.hasError) parseErrorFiles.push(f)
    const counts = new Map<string, number>()
    const walk = (n: any): void => {
      counts.set(n.type, (counts.get(n.type) ?? 0) + 1)
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
    walk(tree.rootNode)
    for (const [t, c] of counts) nodeCounts.set(t, (nodeCounts.get(t) ?? 0) + c)

    let res: any
    try {
      res = await ASTEngine.parseFile(f, src)
    } catch {
      continue
    }
    filesRead++
    symbols += res.symbols?.length ?? 0
    relationships += res.relationships?.length ?? 0

    // --- 2. SYMBOL COVERAGE -------------------------------------------------
    const symNames = new Set<string>()
    for (const s of res.symbols ?? []) {
      symNames.add(s.name)
      symNames.add(`${s.ownerName ?? ""}.${s.name}`)
    }
    const declWalk = (n: any): void => {
      if (isDeclNode(n.type)) {
        declNodeTypes.add(n.type)
        const name = n.childForFieldName?.("name")?.text
          ?? n.namedChildren?.find((c: any) => c.type === "identifier")?.text
        if (name && !symNames.has(name) && declNoSymbol.length < 400) {
          declNoSymbol.push(`${path.basename(f)}:${n.startPosition.row + 1} ${n.type} ${name}`)
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) declWalk(n.namedChild(i))
    }
    declWalk(tree.rootNode)

    // --- 3. CALL COVERAGE --------------------------------------------------
    const emitted = new Set<string>()
    for (const r of res.relationships ?? []) {
      if ((r.type ?? r.relationshipType) === "calls") emitted.add(`${r.source}->${r.target}`)
      if ((r.type ?? r.relationshipType) === "uses") emitted.add(`${r.source}->${r.target}`)
    }
    const calleeLeaf = (inv: any): string | null => {
      const fn = inv.childForFieldName("function")
      if (!fn) return null
      if (fn.type === "member_access_expression") {
        const nm = fn.childForFieldName("name")
        if (!nm) return null
        return nm.type === "generic_name" ? nm.childForFieldName("name")?.text ?? nm.text.split("<")[0] : nm.text
      }
      if (fn.type === "generic_name") return fn.childForFieldName("name")?.text ?? fn.text.split("<")[0]
      if (fn.type === "conditional_access_expression" || fn.type === "member_binding_expression") {
        const binding = fn.type === "member_binding_expression" ? fn : fn.namedChildren.find((c: any) => c.type === "member_binding_expression")
        if (!binding) return null
        for (let i = binding.childCount - 1; i >= 0; i--) {
          const c = binding.child(i)
          if (c && (c.type === "identifier" || c.type === "generic_name")) return c.type === "generic_name" ? c.childForFieldName("name")?.text ?? c.text : c.text
        }
        return null
      }
      if (fn.type === "identifier") return fn.text
      return null
    }
    const enclosingName = (n: any): string => {
      let cur: any = n.parent
      while (cur) {
        if (cur.type === "method_declaration" || cur.type === "constructor_declaration" || cur.type === "destructor_declaration") {
          if (cur.type === "constructor_declaration") return "constructor"
          if (cur.type === "destructor_declaration") return "Finalize"
          return cur.childForFieldName("name")?.text ?? "?"
        }
        if (cur.type === "property_declaration" || cur.type === "indexer_declaration") {
          return cur.type === "indexer_declaration" ? "this" : cur.childForFieldName("name")?.text ?? "?"
        }
        cur = cur.parent
      }
      return "global"
    }
    const invWalk = (n: any): void => {
      if (n.type === "invocation_expression") {
        const leaf = calleeLeaf(n)
        if (leaf) {
          const key = `${enclosingName(n)}->${leaf.split("<")[0]}`
          if (!emitted.has(key)) {
            callMisses.set(key, (callMisses.get(key) ?? 0) + 1)
            if (callMissSamples.length < 200) callMissSamples.push(`${path.basename(f)}:${n.startPosition.row + 1} ${key}`)
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) invWalk(n.namedChild(i))
    }
    invWalk(tree.rootNode)

    // --- 4. RELATIONSHIP SHAPE --------------------------------------------
    for (const r of res.relationships ?? []) {
      const t = r.target ?? ""
      let cls: string | null = null
      if (t.length === 0) cls = "empty"
      else if (!/^[A-Za-z_~][A-Za-z0-9_.\-+<>\[\]?]*$/.test(t)) cls = "non-identifier-characters"
      if (cls) {
        shapeConvictions.set(cls, (shapeConvictions.get(cls) ?? 0) + 1)
        const arr = shapeSamples.get(cls) ?? []
        if (arr.length < 12) arr.push(`${path.basename(f)} ${r.source} -[${(r.type ?? r.relationshipType)}]-> ${JSON.stringify(t)}`)
        shapeSamples.set(cls, arr)
      }
    }
  }

  const top = (m: Map<string, number>, n: number): Array<[string, number]> =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)

  console.log(`files read: ${filesRead}  symbols: ${symbols}  relationships: ${relationships}`)
  console.log(`files with a grammar error: ${parseErrorFiles.length}${parseErrorFiles.length ? ` (e.g. ${parseErrorFiles.slice(0, 5).map((p) => path.basename(p)).join(", ")})` : ""}`)
  console.log(`\n== distinct node types seen: ${nodeCounts.size}`)
  console.log("\n== top node types")
  for (const [t, c] of top(nodeCounts, 40)) console.log(`   ${String(c).padStart(8)}  ${t}${namesNodeType(t) ? "" : "   <-- NOT NAMED BY THE ANALYZER"}`)

  const unnamed = [...nodeCounts.entries()].filter(([t, c]) => !namesNodeType(t) && c > 0).sort((a, b) => b[1] - a[1])
  console.log(`\n== node types the analyzer never names (${unnamed.length} of ${nodeCounts.size}, ${unnamed.reduce((a, b) => a + b[1], 0)} occurrences)`)
  for (const [t, c] of unnamed) console.log(`   ${String(c).padStart(8)}  ${t}`)

  console.log(`\n== declaration nodes with no published symbol (${declNoSymbol.length} shown)`)
  for (const l of declNoSymbol.slice(0, 60)) console.log(`   ${l}`)

  console.log(`\n== call leaves the analyzer emitted no call/use for (${callMisses.size} distinct)`)
  for (const [k, c] of top(callMisses, 60)) console.log(`   ${String(c).padStart(6)}  ${k}`)

  console.log(`\n== relationship target shape convictions`)
  for (const [cls, c] of top(shapeConvictions, 20)) {
    console.log(`   ${String(c).padStart(8)}  ${cls}`)
    for (const s of shapeSamples.get(cls) ?? []) console.log(`       ${s}`)
  }
}

if (import.meta.main) await main()
