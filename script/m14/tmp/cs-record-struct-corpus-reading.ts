// The third-corpus reading for the record-struct fix.
//
// `record struct` does not occur in either of csharp's TWO PINNED corpora
// (powershell, fsharp — grep: 0 each), which is why five depth draws and every
// canonical draw missed it. It is live in /home/ishaq2321/roslyn (1278 occurrences
// under src/). This is a SCOPED reading, not a differential draw: roslyn is not a
// pinned corpus for this lane, so no claim about it is made beyond what is printed.
//
// Method: for every selected file, walk the tree for `record_declaration` nodes, split
// them by the GRAMMAR TRUTH (an unnamed `struct` token child = record struct, a `class`
// token = record class), and compare against what the analyzer PUBLISHED for that
// declaration's name. Mismatches are printed with file, line and both values.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()
const LIST = process.argv[2]
const LIMIT = Number(process.argv[3] ?? 150)

async function main() {
  const files = fs.readFileSync(LIST, "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, LIMIT)
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  let decls = 0, structDecls = 0, classDecls = 0, publishedStruct = 0, publishedClassOnStruct = 0
  let publishedOther = 0, parseErrorFiles = 0, noSymbol = 0
  const mismatches: string[] = []

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser.parse(src)
    if (tree.rootNode.hasError) parseErrorFiles++
    const found: Array<{ line: number; name: string; isStruct: boolean }> = []
    const walk = (n: any) => {
      if (n.type === "record_declaration") {
        let isStruct = false
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c && !c.isNamed && c.type === "struct") isStruct = true
        }
        const name = n.childForFieldName("name")?.text ?? n.namedChildren.find((c: any) => c.type === "identifier")?.text ?? "?"
        found.push({ line: n.startPosition.row + 1, name, isStruct })
      }
      for (const c of n.namedChildren) walk(c)
    }
    walk(tree.rootNode)
    if (found.length === 0) continue

    const res: any = await ASTEngine.parseFile(f, src)
    const kinds = new Map<string, string>()
    for (const s of res.symbols ?? []) if (!kinds.has(s.name)) kinds.set(s.name, s.kind)

    for (const d of found) {
      decls++
      if (d.isStruct) structDecls++; else classDecls++
      const kind = kinds.get(d.name)
      if (kind === undefined) { noSymbol++; mismatches.push(`${path.basename(f)}:${d.line} ${d.name} grammar=${d.isStruct ? "record struct" : "record class"} but NO symbol published`); continue }
      if (d.isStruct) {
        if (kind === "struct") publishedStruct++
        else if (kind === "class") { publishedClassOnStruct++; mismatches.push(`${path.basename(f)}:${d.line} ${d.name} grammar=record struct but published kind=${kind}`) }
        else publishedOther++
      } else if (kind !== "class") {
        publishedOther++
        mismatches.push(`${path.basename(f)}:${d.line} ${d.name} grammar=record class but published kind=${kind}`)
      }
    }
    tree.delete?.()
  }

  console.log(`files read:              ${files.length}`)
  console.log(`record declarations:     ${decls}  (record struct ${structDecls} / record class ${classDecls})`)
  console.log(`  record struct published struct:  ${publishedStruct}`)
  console.log(`  record struct published class:   ${publishedClassOnStruct}   <- the defect class; must be 0`)
  console.log(`  other/unexpected kinds:          ${publishedOther}`)
  console.log(`  declarations with no symbol:     ${noSymbol}`)
  console.log(`files with parse errors: ${parseErrorFiles}`)
  if (mismatches.length) {
    console.log(`\nMISMATCHES (${mismatches.length}), first 12:`)
    for (const m of mismatches.slice(0, 12)) console.log("  " + m)
  } else {
    console.log("\nno mismatches: every record declaration's published kind matches the grammar token")
  }
}
main()
