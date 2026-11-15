// script/m14/tmp/py-module-unknown-probe.ts — the R7 python site
// `module: moduleName || "<unknown>"` (real-python-analyzer.ts, register key
// `module`): is it REACHABLE, and on which shape?
//
// The branch is the `import_from_statement` handler, where `moduleName` is taken
// from the first `relative_import` / `dotted_name` child. A well-formed statement
// always has one, so the interesting shapes are the damaged ones — measured, not
// assumed (the php lane's two markers were unreachable markers that no corpus file
// takes, and this is the same question).
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

const SHAPES: Array<[string, string]> = [
  ["plain", `from a.b import c\n`],
  ["relative", `from . import c\n`],
  ["relative with module", `from .pkg import c\n`],
  ["parent relative", `from .. import c\n`],
  ["wildcard", `from a import *\n`],
  ["parenthesised list", `from a import (c, d)\n`],
  ["aliased", `from a import c as d\n`],
  ["newline after from", `from\nimport c\n`],
  ["missing module", `from import c\n`],
  ["comma-only", `from , import c\n`],
  ["comment between", `from a # c\nimport d\n`],
  ["nested relative", `from ....pkg import c\n`],
  // The shapes that could leave `moduleName` EMPTY: an import_from_statement
  // with no named child at all before the item. If none of these reaches the
  // fallback, the site is unreachable and the paydown is provable by probe.
  ["from only", `from\n`],
  ["from with nothing", `from import\n`],
  ["from dot only", `from .\n`],
  ["from dot import nothing", `from . import\n`],
  ["from paren only", `from (\n`],
  ["from star only", `from *\n`],
  ["from space import", `from  import\n`],
]

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const tmp = path.join(ROOT, "script/m14/tmp/_probe-py-module.py")
  for (const [label, src] of SHAPES) {
    fs.writeFileSync(tmp, src)
    let res: any
    try {
      res = await ASTEngine.parseFile(tmp, src)
    } catch (e: any) {
      console.log(`${label.padEnd(20)} THREW ${String(e?.message).slice(0, 70)}`)
      continue
    }
    const errs = (res.errors ?? []).length
    const mods = (res.imports ?? []).map((i: any) => JSON.stringify(i.module))
    console.log(`${label.padEnd(20)} modules=[${mods.join(", ")}] imports=${(res.imports ?? []).length} errors=${errs}  << ${JSON.stringify(src.trim())}`)
  }
  fs.unlinkSync(tmp)
}

main()
