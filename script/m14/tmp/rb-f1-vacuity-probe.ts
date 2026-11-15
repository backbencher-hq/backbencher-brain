/**
 * RUBY LANE — F1 VACUITY PROBE (M60 deep round 1).
 *
 * Finding under test: the F1 grammar audit validates node-type literals by
 * matching `x.type === "lit"` — `isTypeComparison` requires one side of the
 * comparison to be a `member_expression` whose LAST child is `type`. The ruby
 * analyzer dispatches on a DESTRUCTURED LOCAL: `const { node, type } = frame`
 * then `if (type === "class")`. `type` is an `identifier`, not a
 * `member_expression`, so `isTypeComparison` is false for every one of them and
 * F1 collects ZERO of the lane's node-type branches.
 *
 * A gate that reads nothing reports "0 unknown" and is indistinguishable, in its
 * own evidence, from a gate that read everything and found nothing. This probe
 * separates the two by MEASURING the two sets against each other:
 *
 *   referencedByF1  — what F1's own extraction actually collects from this file
 *   actuallyCompared — every `type === "lit"` / `type !== "lit"` in the file
 *   MISSED           — the difference: branches that can never match and that
 *                      no F1 run will ever report, because F1 never saw them.
 *
 * It also proves the direction, not just the claim: a deliberately impossible
 * node type is planted in a MISSED position, and the same literal is planted in
 * a position F1 does read, so the reader can see one caught and one not.
 *
 * Usage: npx tsx script/m14/tmp/rb-f1-vacuity-probe.ts
 */
import * as fs from "fs"
import * as path from "path"
import { Parser, Language } from "web-tree-sitter"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..", "..")
const ANALYZER = path.join(ROOT, "src", "ast", "real-ruby-analyzer.ts")
const TS_WASM = path.join(ROOT, "wasm", "tree-sitter-typescript.wasm")
const RUBY_WASM = path.join(ROOT, "wasm", "tree-sitter-ruby.wasm")

/** F1's predicate, reproduced verbatim from script/m14/audit-analyzer-grammar.ts. */
const isTypeComparison = (bin: any, endsWithType: (e: any) => boolean): boolean =>
  endsWithType(bin.child(0)) || endsWithType(bin.child(2))
const endsWithType = (e: any): boolean =>
  e?.type === "member_expression" && e.children[e.children.length - 1]?.text === "type"

/** What the analyzer really dispatches on: ANY comparison of a `type` binding. */
const isLooseTypeComparison = (bin: any): boolean => {
  const isTypeish = (e: any) =>
    e?.type === "member_expression" ? endsWithType(e) : e?.type === "identifier" && e.text === "type"
  return isTypeish(bin.child(0)) || isTypeish(bin.child(2))
}

async function main() {
  await Parser.init()
  const ts = await Language.load(TS_WASM)
  const ruby = await Language.load(RUBY_WASM)
  const p = new Parser()
  p.setLanguage(ts)

  const nodeTypes = new Set<string>()
  for (let i = 0; i < ruby.nodeTypeCount; i++) {
    const t = ruby.nodeTypeForId(i)
    if (t) nodeTypes.add(t)
  }

  const src = fs.readFileSync(ANALYZER, "utf8")
  const tree = p.parse(src)
  const strOf = (n: any): string | null =>
    n?.type === "string" && n.namedChildren[0]?.type === "string_fragment" ? n.namedChildren[0].text : null

  const seenByF1 = new Map<string, number>()
  const seenLoose = new Map<string, number>()
  const missed: Array<{ literal: string; line: number }> = []

  const visit = (node: any) => {
    if (node.type === "binary_expression" &&
        ["===", "!==", "==", "!="].includes(node.child(1)?.text) &&
        isLooseTypeComparison(node)) {
      for (const side of [node.child(0), node.child(2)]) {
        const lit = strOf(side)
        if (lit == null) continue
        const line = node.startPosition.row + 1
        seenLoose.set(lit, (seenLoose.get(lit) ?? 0) + 1)
        if (isTypeComparison(node, endsWithType)) {
          seenByF1.set(lit, (seenByF1.get(lit) ?? 0) + 1)
        } else {
          missed.push({ literal: lit, line })
        }
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) visit(node.namedChild(i))
  }
  visit(tree.rootNode)

  console.log(`file: src/ast/real-ruby-analyzer.ts`)
  console.log(`pinned ruby grammar node types: ${nodeTypes.size}`)
  console.log("")
  console.log(`distinct literals compared against a \`type\` binding : ${seenLoose.size}  (${[...seenLoose.values()].reduce((a, b) => a + b, 0)} comparison sites)`)
  console.log(`of those, F1's \`isTypeComparison\` actually collects  : ${seenByF1.size}`)
  console.log(`MISSED by F1 (dead branches F1 can never report)       : ${missed.length} sites, ${new Set(missed.map((m) => m.literal)).size} distinct literals`)
  console.log("")
  console.log("literal                                    inGrammar  F1reads  site")
  for (const [lit] of [...seenLoose.entries()].sort()) {
    const inG = nodeTypes.has(lit) ? "yes" : "NO "
    const f1 = seenByF1.has(lit) ? "yes" : "NO "
    const site = missed.find((m) => m.literal === lit)
    console.log(
      lit.padEnd(42) + inG.padEnd(10) + f1.padEnd(8) + (site ? "real-ruby-analyzer.ts:" + site.line : "—"),
    )
  }
  console.log("")
  // The literals that are NOT grammar node types but are compared as if they were.
  const bogus = [...seenLoose.keys()].filter((l) => !nodeTypes.has(l))
  console.log(`literals compared as node types that the grammar does NOT have: ${bogus.length}`)
  for (const b of bogus) {
    const site = missed.find((m) => m.literal === b)
    console.log(`  ${b}   (F1 reads it: ${seenByF1.has(b) ? "yes" : "NO"})   ${site ? "real-ruby-analyzer.ts:" + site.line : ""}`)
  }
  fs.writeFileSync(
    path.join(ROOT, "validation", "m60", "results", "ruby-f1-vacuity.json"),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      analyzer: "src/ast/real-ruby-analyzer.ts",
      grammarNodeTypes: nodeTypes.size,
      distinctCompared: [...seenLoose.keys()].sort(),
      f1Collects: [...seenByF1.keys()].sort(),
      missedSites: missed,
      notGrammarNodeTypes: bogus,
    }, null, 2),
  )
}

main()
