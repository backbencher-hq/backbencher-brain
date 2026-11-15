// #881 follow-up probe. `executionHead` skips comment / dis_expr / meta_lit.
// Wiring it into formNameOf fixes the discard case, but line 451 of the
// analyzer emits `calls[activeFunction -> formName]` whenever formName is
// truthy, so skipping meta_lit could WIDEN call emission for a meta-headed
// list — a behavior change beyond #881. Measure it instead of reasoning.
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

const CASES: Array<{ name: string; src: string }> = [
  { name: "A: discard head (the #881 fix)", src: `(defn dh []\n  (#_ignored quote (trivia-ghost))\n  (live))` },
  { name: "B: metadata head", src: `(defn mh []\n  (^:probe metacalled)\n  (live))` },
  { name: "C: comment head", src: `(defn ch []\n  (#_(c) commentedcalled)\n  (live))` },
]

async function main() {
  const engine: any = await import(path.join(ROOT, "src/ast/engine.ts"))
  const parser = await engine.ASTEngine.getParser("clojure")
  const mod: any = await import(path.join(ROOT, "src/ast/real-clojure-analyzer.ts"))
  const analyzer = new mod.RealClojureAnalyzer()

  for (const c of CASES) {
    const tree = parser.parse(c.src)
    // the statement list inside the fn body: last-but-one named child of the defn body
    const body = tree.rootNode.namedChild(0)?.namedChild(2)
    const stmt = body?.namedChild(1)
    const children: string[] = []
    if (stmt) for (let i = 0; i < stmt.namedChildCount; i++) children.push(`${i}:${stmt.namedChild(i).type}(${JSON.stringify(stmt.namedChild(i).text)})`)

    const res = await analyzer.analyze(tree.rootNode, c.src, `probe/${c.name}.clj`)
    const calls = (res.relationships ?? []).filter((r: any) => r.type === "calls").map((r: any) => `${r.source}->${r.target}@${r.confidence}`)
    const uses = (res.relationships ?? []).filter((r: any) => r.type === "uses").map((r: any) => `${r.source}->${r.target}`)

    console.log(`\n=== ${c.name} ===`)
    console.log(`  statement node: ${stmt?.type ?? "(none)"}  children: ${children.join("  ") || "(none)"}`)
    console.log(`  calls: ${calls.join(", ") || "(none)"}`)
    console.log(`  uses : ${uses.join(", ") || "(none)"}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
