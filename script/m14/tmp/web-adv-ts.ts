// Adversarial deep-dive (web closure, #841 style): minimal reconstructions of
// the 5 TS census residual sites + corpus-absent construct probes. For each
// case: does the GRAMMAR error, and does the ANALYZER (production parseFile)
// lose the symbols a correct parse would surface? Parse error without
// extraction loss is a different verdict than extraction loss.
//
// Run: bun script/m14/tmp/web-adv-ts.ts
import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { parseFile } from "../../../src/ast/pool-worker"

const CASES: Array<[string, string, string[]]> = [
  // --- census residual reconstructions (the 4 TS families) ---
  ["census:import()-in-return-annotation", `import type * as fs from "fs"\nexport function statSync(path: string): import("fs").Stats | undefined {\n  return undefined\n}\n`, ["statSync"]],
  ["census:import()-in-var-annotation", `let failedTestReporter: import("./x.cjs") | undefined\nexport {}\n`, []],
  ["census:variance-in-out", `export interface LexicalEnvironment<in out TEnvData, TPrivateEnvData, TPrivateEntry> {\n  a: TEnvData\n}\n`, ["LexicalEnvironment"]],
  ["census:tuple-labels", `export type TrackedSymbol = [symbol: Symbol, enclosingDeclaration: Node | undefined, meaning: Symbol]\n`, []],
  // --- corpus-absent probes (would the census miss these?) ---
  ["absent:satisfies-operator", `const config = {\n  port: 3000,\n} satisfies Record<string, number>\nexport const p = config.port\n`, ["config", "p"]],
  ["absent:const-type-params", `function f<const T extends readonly string[]>(args: T): T {\n  return args\n}\nexport const x = f(["a"])\n`, ["f", "x"]],
  ["absent:template-literal-types", `type Greeting = \`hello \${string}\`\nexport function greet(g: Greeting) { return g }\n`, ["greet"]],
  ["absent:decorator-on-method", `function deco(t: any, k: string, d: any) {}\nclass C {\n  @deco\n  m(): number { return 1 }\n}\nexport { C }\n`, ["C", "m", "deco"]],
  ["absent:abstract-construct-signature", `export abstract class A {\n  abstract new (x: number): object\n}\n`, ["A"]],
  ["absent:unique-symbol-typeof", `const s = Symbol("k")\nexport const o: unique symbol = s\n`, ["s", "o"]],
]

async function main() {
  const rows: any[] = []
  for (const [name, src, expected] of CASES) {
    const dir = join(tmpdir(), `web-adv-${name.replace(/[^a-z0-9-]/gi, "_")}.ts`)
    writeFileSync(dir, src)
    let treeErr = 0
    try {
      const parser = await ASTEngine.getParser("typescript")
      const tree = parser.parse(src)
      if ((tree.rootNode as any).hasError) {
        const stack = [tree.rootNode]
        while (stack.length) {
          const n = stack.pop()!
          if (n.type === "ERROR" || n.isMissing) treeErr++
          for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push(c) }
        }
      }
    } catch (e) { treeErr = -1 }
    let symbols: any[] = []
    let pipelineErr = 0
    let analyzeErr = ""
    try {
      const parsed = await parseFile(dir, process.cwd())
      symbols = parsed.symbols ?? []
      pipelineErr = (parsed.errors ?? []).length
    } catch (e: any) { analyzeErr = String(e?.message ?? e).slice(0, 80) }
    const names = new Set(symbols.map((s: any) => s.name))
    const missing = expected.filter((n) => !names.has(n))
    rows.push({
      case: name,
      grammarErrNodes: treeErr,
      pipelineErrors: pipelineErr,
      symbolsFound: symbols.length,
      expectedSymbols: expected.length,
      MISSING: missing.length ? missing.join(",") : "none",
    })
    console.log(
      `${name.padEnd(42)} grammarErr=${String(treeErr).padStart(3)} pipeErr=${pipelineErr} ` +
      `syms=${symbols.length}/${expected.length} ${missing.length ? "MISSING:" + missing.join(",") : "all-found"} ${analyzeErr}`,
    )
  }
  console.log(JSON.stringify(rows, null, 1))
}
main().catch((e) => { console.error(e); process.exit(1) })
