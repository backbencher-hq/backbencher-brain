// Shape census over the two Scala corpora (m60).
//
// Purpose: decide, from REAL code, whether a disagreement between the oracle and
// the analyzer is a defect or a rule. A shape found only in a synthetic snippet
// is a hypothesis; a shape with a corpus count is a measurement.
//
// This script reads the grammar ONLY (no analyzer state) — it counts node shapes.

import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "<corpus-root>/bb_tests/repositories"

const repo = process.argv[2] ?? "cats-effect"
const limit = Number(process.argv[3] ?? 400)

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "target" || e.name === "project" && repo !== "scala3") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out)
    else if (e.name.endsWith(".scala")) out.push(p)
  }
  return out
}

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(lang)

  const files = walkFiles(path.join(CORPUS, repo)).sort().slice(0, limit)
  const counters: Record<string, number> = {}
  const examples: Record<string, string> = {}
  const bump = (k: string, f: string): void => {
    counters[k] = (counters[k] ?? 0) + 1
    if (!examples[k]) examples[k] = f
  }
  let parsed = 0
  let errored = 0

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser.parse(src)
    if (tree.rootNode.hasError) errored++
    parsed++
    const rel = path.relative(path.join(CORPUS, repo), f)

    const walk = (n: any): void => {
      const t = n.type
      switch (t) {
        case "given_definition":
          bump("given_definition", rel)
          if (!n.childForFieldName("name")) bump("given_definition ANONYMOUS (no name field)", rel)
          else bump("given_definition NAMED", rel)
          break
        case "extension_definition":
          bump("extension_definition", rel)
          break
        case "type_definition":
          bump("type_definition", rel)
          if (n.parent && (n.parent.type === "function_definition" || n.parent.type === "function_declaration")) {
            bump("type_definition DIRECT in a def body", rel)
          }
          break
        case "enum_definition":
          bump("enum_definition", rel)
          break
        case "with_template_body":
          bump("with_template_body", rel)
          break
        case "enum_body":
          bump("enum_body", rel)
          break
        case "simple_enum_case":
        case "full_enum_case":
          bump(t, rel)
          break
        case "val_declaration":
        case "var_declaration":
          bump(t, rel)
          break
        case "class_definition":
          bump("class_definition", rel)
          if (hasMod(n, "case")) bump("class_definition CASE (all params are fields)", rel)
          break
        case "operator_identifier":
          bump("operator_identifier", rel)
          break
        case "compound_type":
          bump("compound_type", rel)
          break
      }
      // `new T { ... }` with NO supertype at all — the analyzer's
      // `anonymous_object` fallback, whose name is built from SOURCE TEXT.
      if (t === "instance_expression") {
        const hasTpl = !!n.namedChildren.find((c: any) => c.type === "template_body")
        const hasNew = !!n.children.find((c: any) => c.type === "new")
        if (hasTpl && hasNew) {
          bump("instance_expression new+template_body (anon class)", rel)
          const ty = n.namedChild(0)
          if (ty && (ty.type === "type_identifier" || ty.type === "generic_type" || ty.type === "stable_type_identifier")) {
            bump("  anon: plain/generic supertype", rel)
          } else if (ty && ty.type === "compound_type") {
            bump("  anon: compound_type supertype (new A with B)", rel)
          } else {
            bump(`  anon: NO READABLE SUPERTYPE -> anonymous_<source text> [${ty ? ty.type : "none"}]`, rel)
          }
        }
      }
      // val/var under a function (the skip rule) vs not
      if (t === "val_definition" || t === "var_definition") {
        let a = n.parent
        let underFn = false
        while (a) {
          if (a.type === "function_definition" || a.type === "function_declaration") { underFn = true; break }
          a = a.parent
        }
        bump(underFn ? "val/var UNDER a function (skipped by the analyzer)" : "val/var NOT under a function (published)", rel)
      }
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
    walk(tree.rootNode)
  }

  console.log(`# ${repo}: ${parsed} files (${errored} with parse errors)`)
  const rows = Object.entries(counters).sort((a, b) => b[1] - a[1])
  for (const [k, v] of rows) console.log(`${String(v).padStart(7)}  ${k}   e.g. ${examples[k]}`)
}

function hasMod(n: any, m: string): boolean {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c.type === "modifiers" && c.text.includes(m)) return true
  }
  return false
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
