// CS-DEEP-3 — the SIZE of the alias-generic-module class, measured over real corpora.
//
// The deep census (cs-deep-census.ts) convicted 3 of 4 shape findings on 400 roslyn
// files, and the probe (cs-deep-probe-2.ts) showed all of them are ONE defect: a
// `using` ALIAS whose target is a GENERIC type publishes the whole generic spelling —
// type arguments, tuple element NAMES, nullability markers — as the module name and
// the `references` target.
//
// The contract this breaks is the lane's own: everywhere else, a name position
// publishes a NAME (`using System.Collections.Generic;` -> the path; `class D :
// Base<int>;` -> `Base`; `new List<int>();` -> `List`; a declared-type ref publishes
// the leaf). The alias form is the one position that never passed through the
// generic-stripping that `csharpCleanTypeLeaf` performs everywhere else.
//
// This measures: how many files, how many edges, and which arg shapes occur, over a
// caller-supplied list of .cs files. It reads the TREE (grammar truth) to find the
// alias directives, then asks the production analyzer what it published for each —
// so a defect cannot vouch for itself.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

async function main() {
  const listFile = arg("--list")
  if (!listFile) { console.error("usage: cs-deep-3-alias-generic.ts --list <paths> [limit]"); process.exit(2) }
  const limit = Number(arg("--limit") ?? 1000)
  const files = fs.readFileSync(listFile, "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, limit)

  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  let aliasDirectives = 0
  let aliasWithGeneric = 0
  let tupleArgFiles = 0
  let affectedFiles = 0
  let edges = 0
  const rows: string[] = []
  const argShapes = new Map<string, number>()

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser.parse(src)
    const aliases: Array<{ line: number; text: string; hasGeneric: boolean; hasTuple: boolean }> = []
    const walk = (n: any): void => {
      if (n.type === "using_directive") {
        let hasEq = false
        for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && c.type === "=") { hasEq = true; break } }
        if (hasEq) {
          aliasDirectives++
          const hasGeneric = n.text.indexOf("<") >= 0
          const hasTuple = n.text.indexOf("(") >= 0
          if (hasGeneric) {
            aliasWithGeneric++
            if (hasTuple) tupleArgFiles++
            aliases.push({ line: n.startPosition.row + 1, text: n.text, hasGeneric, hasTuple })
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
    walk(tree.rootNode)
    if (aliases.length === 0) continue
    affectedFiles++

    let res: any
    try { res = await ASTEngine.parseFile(f, src) } catch { continue }
    const modules = new Set<string>((res.imports ?? []).map((i: any) => i.module))
    for (const a of aliases) {
      const hit = [...modules].filter((m) => m.indexOf("<") >= 0)
      for (const h of hit) {
        edges++
        if (rows.length < 40) rows.push(`${path.basename(f)}:${a.line}\n     src:   ${a.text.trim()}\n     module: ${JSON.stringify(h)}`)
        // classify the argument shapes present
        const lt = h.indexOf("<")
        if (lt > 0) {
          let depth = 0
          let cur = ""
          const args: string[] = []
          for (let i = lt + 1; i < h.length; i++) {
            const ch = h[i]
            if (ch === "<") depth++
            if (ch === ">") { if (depth === 0) break; depth-- }
            if (ch === "," && depth === 0) { args.push(cur); cur = ""; continue }
            cur += ch
          }
          args.push(cur)
          for (const x of args) {
            const s = x.trim()
            let shape = "simple"
            if (s.includes("(")) shape = "tuple-with-element-names"
            else if (s.endsWith("?")) shape = "nullable"
            else if (s.indexOf(".") >= 0) shape = "qualified"
            else if (s === "string" || s === "int" || s === "bool" || s === "object" || s === "byte") shape = "predefined"
            argShapes.set(shape, (argShapes.get(shape) ?? 0) + 1)
          }
        }
      }
    }
  }

  console.log(`files read: ${files.length}   files carrying an alias using: ${affectedFiles}`)
  console.log(`alias using directives: ${aliasDirectives}   of which the target is GENERIC: ${aliasWithGeneric}   (${tupleArgFiles} carry a tuple argument)`)
  console.log(`module names published that are generic spellings: ${edges}`)
  console.log(`argument shapes: ${JSON.stringify(Object.fromEntries([...argShapes.entries()].sort((a, b) => b[1] - a[1])))}`)
  console.log(`\nrows (${rows.length} shown):`)
  for (const r of rows) console.log("   " + r)
}

if (import.meta.main) await main()
