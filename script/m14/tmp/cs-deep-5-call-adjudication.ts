// CS-DEEP-5 — every call the analyzer did not emit, WITH ITS SOURCE LINE, minus the
// classes already ruled. The rule this round works by: a count is a question, a
// printed line is an adjudication.
//
//   The deep census reported "325 distinct call leaves with no emitted edge" over 400
//   roslyn files. That number is not a defect count. Most of it is three known things:
//   `nameof` (CS-B2 suppresses it on purpose), the Object builtins (ToString/Equals/
//   GetHashCode/GetType, the C# equivalent of Java's Object methods), and the
//   instrument's own mismatch with the analyzer's source attribution (a call in a
//   class-scope initializer is attributed to the CLASS by the analyzer and to
//   "global" by a naive climb). This instrument therefore (a) subtracts the ruled
//   classes, and (b) prints the LINE so every remaining row can be read and ruled or
//   convicted by hand — which is the only way "0 unexplained" becomes a fact rather
//   than a threshold nobody looked at.
//
// Every row printed is a claim this round is accountable for.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

const RULED_TARGETS = new Set([
  "nameof", "typeof", "ToString", "GetHashCode", "Equals", "GetType", "ReferenceEquals",
  "WriteLine", "Write", "WriteAsync",
])

async function main() {
  const listFile = arg("--list")
  if (!listFile) { console.error("usage: cs-deep-5-call-adjudication.ts --list <paths> [limit]"); process.exit(2) }
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

  let rows = 0
  let ruled = 0
  const byKind = new Map<string, number>()
  const shown = new Set<string>()

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const lines = src.split("\n")
    const tree = parser.parse(src)
    let res: any
    try { res = await ASTEngine.parseFile(f, src) } catch { continue }
    const emitted = new Set<string>()
    for (const r of res.relationships ?? []) {
      const t = r.type ?? r.relationshipType
      if (t === "calls" || t === "uses" || t === "instantiates") emitted.add(`${r.source}->${r.target}`)
    }
    // The analyzer's own source attribution, mirrored: walk the tree with the same
    // scope discipline the analyzer uses (a method/ctor/dtor/property pushes a
    // scope; a class/struct/interface also accepts calls; everything else inherits).
    const sourceOf = (n: any): string => {
      let cur: any = n.parent
      while (cur) {
        const t = cur.type
        if (t === "method_declaration") return cur.childForFieldName("name")?.text ?? "?"
        if (t === "constructor_declaration") return "constructor"
        if (t === "destructor_declaration") return "Finalize"
        if (t === "property_declaration") return cur.childForFieldName("name")?.text ?? "?"
        if (t === "indexer_declaration") return "this"
        if (t === "class_declaration" || t === "struct_declaration" || t === "interface_declaration" || t === "record_declaration") {
          return cur.childForFieldName("name")?.text ?? "?"
        }
        cur = cur.parent
      }
      return "global"
    }
    const calleeLeaf = (inv: any): string | null => {
      const fn = inv.childForFieldName("function")
      if (!fn) return null
      if (fn.type === "member_access_expression") {
        const nm = fn.childForFieldName("name")
        if (!nm) return null
        return nm.type === "generic_name" ? nm.childForFieldName("name")?.text ?? nm.text.split("<")[0] : nm.text
      }
      if (fn.type === "generic_name") return fn.childForFieldName("name")?.text ?? fn.text.split("<")[0]
      if (fn.type === "conditional_access_expression" || fn.type === "member_binding_expression") {
        const b = fn.type === "member_binding_expression" ? fn : fn.namedChildren.find((c: any) => c.type === "member_binding_expression")
        if (!b) return null
        for (let i = b.childCount - 1; i >= 0; i--) {
          const c = b.child(i)
          if (c && c.type === "identifier") return c.text
        }
        return null
      }
      if (fn.type === "identifier") return fn.text
      return null
    }
    // Pattern-position invocations are a documented skip (CS-B1/positional-pattern).
    const inPattern = (inv: any): boolean => {
      let q: any = inv.parent
      while (q) {
        const t: string = q.type
        if (t === "constant_pattern" || t === "is_pattern_expression") return true
        if (t === "invocation_expression" || t.includes("statement") || t.includes("declaration") ||
            t.includes("block") || t.includes("function") || t === "lambda_expression" ||
            t === "query_expression") return false
        q = q.parent
      }
      return false
    }
    const walk = (n: any): void => {
      if (n.type === "invocation_expression") {
        const leaf = calleeLeaf(n)
        if (leaf && !inPattern(n)) {
          const key = `${sourceOf(n)}->${leaf.split("<")[0]}`
          if (!emitted.has(key)) {
            if (RULED_TARGETS.has(leaf.split("<")[0])) {
              ruled++
            } else {
              rows++
              // Classify by the grammar shape of the CALL SITE, which is what decides
              // whether the skip is a documented rule or a defect.
              const line = n.startPosition.row
              const text = (lines[line] ?? "").trim().slice(0, 110)
              let kind = "ordinary-call"
              if (n.hasError) kind = "call-in-ERROR-subtree"
              let q: any = n.parent
              while (q) {
                const t: string = q.type
                if (t === "operator_declaration" || t === "conversion_operator_declaration" || t === "delegate_declaration" || t === "event_declaration" || t === "event_field_declaration") { kind = `inside-${t}`; break }
                if (t === "local_function_statement") { kind = "inside-local-function"; break }
                if (t === "lambda_expression") { kind = "inside-lambda"; break }
                if (t === "query_expression") { kind = "inside-query"; break }
                if (t === "accessor_declaration") { kind = "inside-accessor"; break }
                if (t === "method_declaration" || t === "constructor_declaration" || t === "destructor_declaration" || t === "property_declaration" || t === "class_declaration" || t === "block") break
                q = q.parent
              }
              byKind.set(kind, (byKind.get(kind) ?? 0) + 1)
              const sig = `${kind} ${key}`
              if (!shown.has(sig) && shown.size < 120) {
                shown.add(sig)
                console.log(`${path.basename(f)}:${line + 1}  ${sig}\n      ${text}`)
              }
            }
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
    walk(tree.rootNode)
  }

  console.log(`\nruled (nameof / Object builtins / console): ${ruled}`)
  console.log(`unruled rows: ${rows}`)
  console.log(`by grammar shape: ${JSON.stringify(Object.fromEntries([...byKind.entries()].sort((a, b) => b[1] - a[1])), null, 1)}`)
}

if (import.meta.main) await main()
