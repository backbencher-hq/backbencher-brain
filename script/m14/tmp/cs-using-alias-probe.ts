// script/m14/tmp/cs-using-alias-probe.ts — what does the csharp analyzer publish
// for each `using` shape? The alias regex at real-csharp-analyzer.ts:437 is being
// replaced by the grammar's own `name` field, and the replacement must be measured
// rather than assumed: the ALIAS is the `name` field, the TARGET is the
// qualified_name, and the two can be told apart now — including the case the old
// regex could never see, `using Alias = Plain;` where the target is a bare
// identifier and the first-identifier fallback is the ALIAS.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

const SHAPES: Array<[string, string]> = [
  ["plain dotted", `using System.Text;\n`],
  ["plain identifier", `using Json;\n`],
  ["alias to qualified", `using Config = System.Text.Json.JsonSerializerOptions;\n`],
  ["alias to BARE identifier", `using Alias = Plain;\n`],
  ["alias to dotted two", `using C = A.B;\n`],
  ["alias to generic target", `using G = A.B.C<D>;\n`],
  ["alias WRAPPED before =", `using A\n    = B.C;\n`],
  ["static import", `using static System.Math;\n`],
  ["global using", `global using System.Text;\n`],
  ["global alias", `global using G = System.Text;\n`],
  ["global:: target", `using P = global::System.Text;\n`],
]

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const tmp = path.join(ROOT, "script/m14/tmp/_probe-using.cs")
  for (const [label, src] of SHAPES) {
    fs.writeFileSync(tmp, src)
    let res: any
    try { res = await ASTEngine.parseFile(tmp, src) } catch (e: any) { console.log(`${label.padEnd(26)} THREW ${String(e?.message).slice(0, 60)}`); continue }
    const rows = (res.imports ?? []).map((i: any) => `module=${JSON.stringify(i.module)} alias=${JSON.stringify(i.metadata?.usingAlias ?? null)} isAlias=${Boolean(i.metadata?.isUsingAlias)}`)
    const rels = (res.relationships ?? []).map((r: any) => `${r.type}:${r.target}@${r.line_number}`)
    console.log(`${label.padEnd(26)} ${rows.join(" | ") || "(no import)"}    rels=[${rels.join(", ")}]`)
  }
  fs.unlinkSync(tmp)
}

main()
