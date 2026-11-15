/**
 * RUBY LANE — node-type coverage census (M60 deep round 1, instrument).
 *
 * The question this answers is NOT "does the analyzer contain a dead string
 * literal" (that is F1, and it passes). It is the converse and much stronger
 * question: **for every node type the pinned tree-sitter-ruby grammar can
 * produce, does the analyzer reference it at all, and how often does that node
 * type actually occur in real Ruby?**
 *
 * A node type that never occurs is a non-finding. A node type that occurs
 * thousands of times in three heavy Rails corpora and that the analyzer never
 * names is a hole the F1 gate structurally cannot see, because F1 audits the
 * analyzer's literals against the grammar and has no notion of the reverse
 * direction.
 *
 * The corpus sweep is what turns "unreferenced" into a measured claim: every
 * count here is occurrences in real .rb files, not a guess.
 *
 * Usage:
 *   npx tsx script/m14/tmp/rb-node-coverage.ts <corpus-root> [more roots...]
 *   npx tsx script/m14/tmp/rb-node-coverage.ts /home/sano/ishaq/bb_tests/repositories
 */
import * as fs from "fs"
import * as path from "path"
import { Parser, Language } from "web-tree-sitter"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..", "..")
const WASM = path.join(ROOT, "wasm", "tree-sitter-ruby.wasm")
const ANALYZER = path.join(ROOT, "src", "ast", "real-ruby-analyzer.ts")

function listRubyFiles(root: string): string[] {
  const out: string[] = []
  const skip = new Set([".git", "node_modules", "vendor", "tmp", "log"])
  const walk = (d: string) => {
    let ents: fs.Dirent[]
    try {
      ents = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      if (e.name.startsWith(".") && e.name !== ".") continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (skip.has(e.name)) continue
        walk(p)
      } else if (e.isFile() && e.name.endsWith(".rb")) {
        out.push(p)
      }
    }
  }
  walk(root)
  return out
}

async function main() {
  await Parser.init()
  const lang = await Language.load(WASM)
  const parser = new Parser()
  parser.setLanguage(lang)

  // --- 1. Grammar inventory: every node type the grammar can produce ---
  const grammarTypes = new Set<string>()
  for (let i = 0; i < lang.nodeTypeCount; i++) {
    const t = lang.nodeTypeForId(i)
    if (t) grammarTypes.add(t)
  }
  const grammarFields = new Set<string>()
  for (let i = 0; i < lang.fieldCount; i++) {
    const f = lang.fieldNameForId(i)
    if (f) grammarFields.add(f)
  }

  // --- 2. Analyzer literals ---
  const src = fs.readFileSync(ANALYZER, "utf8")
  const literals = new Set<string>()
  const litRe = /"([^"\\\n]*)"|'([^'\\\n]*)'/g
  let m: RegExpExecArray | null
  while ((m = litRe.exec(src)) !== null) literals.add(m[1] ?? m[2] ?? "")

  const nodeTypeLiterals = new Set<string>()
  for (const t of grammarTypes) if (literals.has(t)) nodeTypeLiterals.add(t)
  const deadBranches = [...literals].filter((l) => /^[a-z][a-z0-9_]*$/.test(l) && !grammarTypes.has(l) && !grammarFields.has(l))
    .filter((l) => !["ruby", "Global", "GraphQL", "application/json"].includes(l))

  // --- 3. Corpus sweep: occurrence count per node type ---
  const roots = process.argv.slice(2)
  if (roots.length === 0) {
    console.error("usage: rb-node-coverage.ts <corpus-root>...")
    process.exit(2)
  }
  let files: string[] = []
  for (const r of roots) files = files.concat(listRubyFiles(path.resolve(r)))
  files = files.sort()

  const counts = new Map<string, number>()
  const errFiles: string[] = []
  // Which UNREFERENCED type appears where — the actionable pairing.
  const unref = new Set([...grammarTypes].filter((t) => !nodeTypeLiterals.has(t) && !/^[A-Z_]+$/.test(t)))
  const unrefExamples = new Map<string, { file: string; line: number; text: string }>()
  let nodeTotal = 0

  for (const f of files) {
    let content: string
    try {
      content = fs.readFileSync(f, "utf8")
    } catch {
      continue
    }
    let tree: any
    try {
      tree = parser.parse(content)
    } catch {
      errFiles.push(f)
      continue
    }
    if (tree?.rootNode?.hasError) errFiles.push(f)
    const stack: any[] = [tree.rootNode]
    while (stack.length > 0) {
      const n = stack.pop()
      nodeTotal++
      const t = n.type
      counts.set(t, (counts.get(t) ?? 0) + 1)
      if (unref.has(t) && !unrefExamples.has(t)) {
        unrefExamples.set(t, {
          file: path.relative(roots[0], f),
          line: n.startPosition.row + 1,
          text: (content.slice(n.startIndex, Math.min(n.endIndex, n.startIndex + 70)) || "").replace(/\n/g, "\\n"),
        })
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  // --- 4. Report ---
  const unrefSorted = [...unref].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
  console.log(`corpus: ${files.length} .rb files, ${nodeTotal.toLocaleString()} named nodes, ${errFiles.length} files with parse error`)
  console.log(`grammar: ${grammarTypes.size} node types, ${grammarFields.size} fields`)
  console.log(`analyzer references ${nodeTypeLiterals.size} grammar node types; dead-branch literals: ${deadBranches.length}`)
  if (deadBranches.length) console.log("  dead:", deadBranches.join(", "))
  console.log("")
  console.log(`UNREFERENCED node types that actually occur in the corpus: ${unrefSorted.filter((t) => (counts.get(t) ?? 0) > 0).length}`)
  console.log("rank  occurrences  type                    first occurrence")
  for (const t of unrefSorted.slice(0, 60)) {
    const c = counts.get(t) ?? 0
    if (c === 0) break
    const ex = unrefExamples.get(t)!
    console.log(
      String(c).padStart(9) + "  " + t.padEnd(22) + " " + ex.file + ":" + ex.line + "  " + ex.text,
    )
  }
  console.log("")
  console.log("unreferenced types with ZERO corpus occurrences: " +
    unrefSorted.filter((t) => (counts.get(t) ?? 0) === 0).length)
  fs.writeFileSync(
    path.join(ROOT, "validation", "m60", "results", "ruby-node-coverage.json"),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      corpus: roots,
      files: files.length,
      nodes: nodeTotal,
      filesWithParseError: errFiles.length,
      grammarNodeTypes: grammarTypes.size,
      referencedNodeTypes: [...nodeTypeLiterals].sort(),
      deadBranchLiterals: deadBranches,
      unreferencedWithOccurrences: unrefSorted
        .filter((t) => (counts.get(t) ?? 0) > 0)
        .map((t) => ({ type: t, occurrences: counts.get(t) ?? 0, example: unrefExamples.get(t) })),
      unreferencedZeroOccurrence: unrefSorted.filter((t) => (counts.get(t) ?? 0) === 0),
    }, null, 2),
  )
}

main()
