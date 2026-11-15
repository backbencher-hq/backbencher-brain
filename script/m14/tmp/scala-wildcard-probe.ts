// Probe: does the pinned scala grammar accept `*` as a type-argument wildcard,
// and if not, what does the ERROR swallow? (#855 follow-up, TimeT.scala:148)
import * as fs from "fs"
import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const WTS: any = await import("web-tree-sitter")
const P = WTS.default ?? WTS
const { Parser, Language } = P
await (P.init ?? Parser.init).call(P, {
  locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm"),
})
const lang = await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-scala.wasm")))

const src = (star: string) =>
  [
    "object T {",
    `  def fiberize[A](delegate: Fiber[F, E, A]): Fiber[TimeT[F, ${star}], E, A] =`,
    `    new Fiber[TimeT[F, ${star}], E, A] {`,
    "      val cancel =",
    "        Kleisli.liftF(delegate.cancel)",
    "    }",
    "}",
  ].join("\n")

function walk(n: any, d: number, out: string[]): void {
  const bad = n.type === "ERROR" || n.isMissing
  out.push(
    "  ".repeat(d) +
      n.type +
      (n.isMissing ? " MISSING" : "") +
      ` [${n.startPosition.row + 1}:${n.startPosition.column}-${n.endPosition.row + 1}:${n.endPosition.column}]` +
      (bad ? "   <<<<<" : ""),
  )
  for (let i = 0; i < n.childCount; i++) walk(n.child(i), d + 1, out)
}

for (const star of ["*", "_", "?"]) {
  const parser = new Parser()
  parser.setLanguage(lang)
  const tree = parser.parse(src(star))
  const errs: string[] = []
  const collect = (n: any): void => {
    if (n.type === "ERROR" || n.isMissing) {
      errs.push(
        `${n.type}${n.isMissing ? " MISSING" : ""} [${n.startPosition.row + 1}:${n.startPosition.column}-${n.endPosition.row + 1}:${n.endPosition.column}] :: ${JSON.stringify(n.text.slice(0, 60))}`,
      )
    }
    for (let i = 0; i < n.childCount; i++) collect(n.child(i))
  }
  collect(tree.rootNode)
  console.log(`=== star=${JSON.stringify(star)}  hasError=${tree.rootNode.hasError} ===`)
  if (errs.length === 0) console.log("   (no ERROR/MISSING nodes)")
  for (const e of errs) console.log("   " + e)
  const lines: string[] = []
  walk(tree.rootNode, 0, lines)
  console.log(lines.map((l) => "   " + l).join("\n"))
}
