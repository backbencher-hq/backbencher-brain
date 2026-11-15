// CS-DEEP-4 — per-declaration-node-type SYMBOL COVERAGE, measured from the tree.
//
// The deep census's flat "declaration with no symbol" list was dominated by two
// BY-DESIGN families (accessor_declaration is not a symbol; a `declaration_list`
// member is a variable_declaration that the enum pass publishes under a different
// node). This instrument groups by node TYPE so a real dropped construct is visible
// as a rate, and prints an example line for every type whose coverage is not total.
//
//   coverage for node type T = (# instances of T whose written name appears in the
//   analyzer's published symbol table for that file) / (# instances of T)
//
// A type at 0.000 over a large count is a dropped construct. A type at a middling
// rate is where the interesting cases are: the shapes that resolve, and the shapes
// that do not.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

async function main() {
  const listFile = arg("--list")
  if (!listFile) { console.error("usage: cs-deep-4-symbol-coverage.ts --list <paths> [limit]"); process.exit(2) }
  const limit = Number(arg("--limit") ?? 400)
  const files = fs.readFileSync(listFile, "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, limit)

  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  const total = new Map<string, number>()
  const covered = new Map<string, number>()
  const misses = new Map<string, string[]>()

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser.parse(src)
    const insts: Array<{ type: string; name: string; line: number }> = []
    const walk = (n: any): void => {
      if (n.type.endsWith("_declaration")) {
        const name = n.childForFieldName?.("name")?.text
          ?? n.namedChildren?.find((c: any) => c.type === "identifier")?.text
        if (name) insts.push({ type: n.type, name, line: n.startPosition.row + 1 })
      }
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
    walk(tree.rootNode)
    if (insts.length === 0) continue

    let res: any
    try { res = await ASTEngine.parseFile(f, src) } catch { continue }
    const symNames = new Set<string>()
    for (const s of res.symbols ?? []) { symNames.add(s.name); if (s.ownerName) symNames.add(`${s.ownerName}.${s.name}`) }

    for (const inst of insts) {
      total.set(inst.type, (total.get(inst.type) ?? 0) + 1)
      if (symNames.has(inst.name)) covered.set(inst.type, (covered.get(inst.type) ?? 0) + 1)
      else {
        const arr = misses.get(inst.type) ?? []
        if (arr.length < 8) arr.push(`${path.basename(f)}:${inst.line} ${inst.name}`)
        misses.set(inst.type, arr)
      }
    }
  }

  const rows = [...total.keys()].sort()
  console.log(`files: ${files.length}\n`)
  console.log("node type                          total   covered   rate    examples of uncovered")
  for (const t of rows) {
    const tt = total.get(t)!
    const cc = covered.get(t) ?? 0
    const rate = cc / tt
    if (rate === 1) continue
    const ex = (misses.get(t) ?? []).join(" | ")
    console.log(`  ${t.padEnd(32)} ${String(tt).padStart(6)} ${String(cc).padStart(8)}  ${(rate * 100).toFixed(1).padStart(6)}%  ${ex}`)
  }
  console.log("\nfully covered:")
  for (const t of rows) if ((covered.get(t) ?? 0) === total.get(t)) console.log(`  ${t.padEnd(32)} ${String(total.get(t)).padStart(6)}  100.0%`)
}

if (import.meta.main) await main()
