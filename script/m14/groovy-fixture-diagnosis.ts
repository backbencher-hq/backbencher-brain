/**
 * script/m14/groovy-fixture-diagnosis.ts
 *
 * THE GROOVY LANE'S OWN DIAGNOSIS INSTRUMENT.
 *
 * WHY. The groovy lane's fixture allowance is 21 FAILING FIXTURES, ALLOWED 21 — a measured,
 * named, current debt. Before a single one of them is fixed, every failure must be classified:
 * is it GRAMMAR-side (the construct does not reach the analyzer as a real node, so the remedy is
 * the LADDER — R1 bump / R2 clone+patch+generate+build / R3 implement with an existing node type)
 * or ANALYZER-side (the node IS there and the analyzer does not publish the edge)?
 *
 * A failure that is misclassified costs the lane a whole round: a grammar rebuild for an
 * analyzer bug, or an analyzer patch for a grammar gap. So this instrument prints, per failing
 * fixture: the ERROR/MISSING node census over the SERVED grammar, the symbol list, and the
 * relationship list — the three facts a classification is made from.
 *
 * THE GRAMMAR SIDE IS MEASURED THROUGH THE SERVED BUILD, NOT THROUGH A PATH. The wasm is loaded
 * from `wasm/tree-sitter-groovy.wasm` — the same file the production registry serves — and its
 * sha256 is printed, because L-11 measured that the engine's own "language parser loaded" log
 * prints a path that is NOT the file the bytes came from.
 *
 * Usage:
 *   bun script/m14/groovy-fixture-diagnosis.ts                 # every failing fixture
 *   bun script/m14/groovy-fixture-diagnosis.ts --only=lines-825 # one fixture
 *   bun script/m14/groovy-fixture-diagnosis.ts --tree           # also print the parse tree
 */
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? "."), "..", "..")
const FIXTURES = path.join(ROOT, "validation", "m14", "fixtures", "groovy")
const WASM = path.join(ROOT, "wasm", "tree-sitter-groovy.wasm")

function argOf(flag: string): string | null {
  const argv = process.argv.slice(2)
  const i = argv.indexOf(flag)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null
}
const has = (f: string) => process.argv.includes(f)

const FAILING: string[] = [
  "anonymous-body-overrides",
  "as-cast",
  "attribution-visibility",
  "cast-types",
  "class-body-dot-continuation-841",
  "ctor-field-split-lines",
  "ctor-identity",
  "duplicate-parse-field",
  "exports-publication",
  "fq-annotations",
  "grammar-rebuild-constructs",
  "imports-dependency-edge",
  "lambda-expression",
  "lines-825",
  "method-refs",
  "multicatch-and-varargs",
  "parameters-payload",
  "pattern-refs",
  "scoped-type-recovery-refusal",
  "scoped-type-references",
  "type-usage-graph",
]

function dumpTree(node: any, depth = 0, out: string[] = []): string[] {
  const pad = "  ".repeat(depth)
  const field = node.parent ? "" : ""
  out.push(`${pad}${node.type}${node.isMissing ? " [MISSING]" : ""}${node.isNamed ? "" : " (anon)"}  "${String(node.text ?? "").slice(0, 60).replace(/\n/g, "\\n")}"`)
  if (depth < 40) for (const c of node.children) dumpTree(c, depth + 1, out)
  return out
}

async function main() {
  const only = argOf("--only")
  const targets = only ? [only] : FAILING

  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const wasmBytes = readFileSync(WASM)
  const grammar = await Language.load(wasmBytes)
  const parser = new ParserClass()
  parser.setLanguage(grammar)

  const mod: any = await import("../../src/ast/real-groovy-analyzer")
  const analyzer = new mod.RealGroovyAnalyzer()
  const ctor: any = analyzer?.constructor
  if (typeof ctor?.setGrammar === "function") {
    try {
      ctor.setGrammar((parser as any).language, (parser as any).constructor)
    } catch {
      console.log("  (grammar handoff unavailable: the analyzer keeps its main pass only)")
    }
  }

  console.log(`SERVED GRAMMAR  wasm/tree-sitter-groovy.wasm`)
  console.log(`  bytes     ${wasmBytes.length}`)
  console.log(`  sha256    ${createHash("sha256").update(wasmBytes).digest("hex")}`)
  console.log(`  fixtures  ${targets.length}`)
  console.log("")

  for (const name of targets) {
    const src = path.join(FIXTURES, `${name}.groovy`)
    if (!existsSync(src)) { console.log(`### ${name}: NO SOURCE`); continue }
    const content = readFileSync(src, "utf8")
    const tree = parser.parse(content)
    const root = tree.rootNode

    let errorNodes = 0
    let missingNodes = 0
    const errTypes: string[] = []
    const walk = (n: any) => {
      if (n.type === "ERROR") { errorNodes++; errTypes.push(`ERROR@${n.startPosition.row + 1}`) }
      if (n.isMissing) { missingNodes++; errTypes.push(`MISSING:${n.type}@${n.startPosition.row + 1}`) }
      for (const c of n.children) walk(c)
    }
    walk(root)

    const result = await analyzer.analyze(root, content, `fixtures/groovy/${name}.groovy`)

    console.log(`### ${name}`)
    console.log(`  GRAMMAR: hasError=${root.hasError} ERROR=${errorNodes} MISSING=${missingNodes} ${errTypes.join(" ")}`)
    const syms = (result.symbols ?? []).map((s: any) => `${s.kind}:${s.name}${s.ownerName ? `@${s.ownerName}` : ""}@${s.range?.startLine ?? "?"}`)
    console.log(`  SYMBOLS (${syms.length}): ${syms.join("  ")}`)
    const rels = (result.relationships ?? []).map((r: any) =>
      `${r.type}[${r.source ?? r.from}->${r.target ?? r.to}]@${r.line_number ?? "?"}${r.metadata ? "{" + Object.entries(r.metadata).map(([k, v]) => `${k}=${v}`).join(",") + "}" : ""}`)
    console.log(`  RELATIONSHIPS (${rels.length}):`)
    for (const r of rels) console.log(`    ${r}`)
    if (has("--tree")) {
      console.log("  TREE:")
      for (const l of dumpTree(root)) console.log(`    ${l}`)
    }
    console.log("")
    tree.delete()
  }
}

main()
