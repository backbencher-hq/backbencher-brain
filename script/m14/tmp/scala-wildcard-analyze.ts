// Redo of the wildcard comparison with distinct paths and COMPLETE output
// (the first attempt inferred from a `tail -20` cut, which is not evidence).
import * as fs from "fs"
import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

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

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

for (const [star, file] of [
  ["*", "/tmp/scala-star.scala"],
  ["_", "/tmp/scala-underscore.scala"],
] as const) {
  const text = src(star)
  fs.writeFileSync(file, text)
  const res: any = await ASTEngine.parseFile(file, text)
  const rels = (res.relationships ?? []).slice().sort((a: any, b: any) =>
    String(a.type).localeCompare(String(b.type)) ||
    (a.line_number ?? 0) - (b.line_number ?? 0) ||
    String(a.target).localeCompare(String(b.target)),
  )
  console.log(`\n===== star=${JSON.stringify(star)}  file=${file}  n=${rels.length} =====`)
  for (const r of rels)
    console.log(
      `   ${String(r.type).padEnd(12)} ${String(r.source).padEnd(18)} -> ${String(r.target).padEnd(18)} @ ${r.line_number}`,
    )
}
