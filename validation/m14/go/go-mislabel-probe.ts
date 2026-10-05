// TWO MISLABELLING FALSIFIERS, for the two `exports` / `instantiates`
// predicates whose implementation disagrees with the rule the lane's own
// documentation states.
//
//   (a) exports      the edge says `exportForm: "capitalized_package_scope_name"`.
//                    Go's spec scopes a name to its PACKAGE. A capitalized name
//                    declared inside a function body is not in package scope and
//                    no importer can bind to it, so the edge is a fabrication
//                    labelled with the fact it contradicts. Counted by walking
//                    the parse tree for every capitalized name declared BELOW
//                    a function/method/func_literal and asking whether an
//                    `exports` edge was published for it anyway.
//
//   (b) instantiates the lane's stated rule is "PascalCase top-level FUNCTION
//                    calls only; methods never instantiate". The implementation
//                    matches a call's LEAF against the file's symbol table by
//                    NAME. `err.Error(...)` therefore instantiates whenever the
//                    file happens to declare a top-level `func Error`, which is
//                    a method dispatch wearing a constructor's label. Counted
//                    by taking every 0.6 `instantiates` edge and asking whether
//                    its callee node was a `selector_expression`.
//
// Both are measured from the tree, so a probe finding zero overturns the
// finding. NO REGEX: node.type, field names, and Set lookups only.

import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"
import { collectAllGoFiles, splitTestAndNonTest, strideSample } from "./go-corpus-files"

const WANT = Number(process.argv[2] || 600)
const CORPUS_ROOT = process.argv[3] || "$HOME/fixtures/repositories/go-stdlib"

function named(n: any): any[] {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) out.push(n.namedChild(i))
  return out
}

function isUpper(c: string): boolean {
  const code = c.charCodeAt(0)
  return code >= 65 && code <= 90
}

/** Package-scope declaration names, read from the grammar: the DIRECT named children of source_file. */
function packageScopeNames(root: any): Set<string> {
  const out = new Set<string>()
  const addFromSpec = (spec: any) => {
    for (const c of named(spec)) {
      if (c.type === "type_identifier" || c.type === "identifier" || c.type === "field_identifier") {
        const t = String(c.text ?? "")
        if (t.length > 0) out.add(t)
      }
    }
  }
  for (const top of named(root)) {
    if (top.type === "function_declaration" || top.type === "method_declaration") {
      const nm = top.childForFieldName("name")
      if (nm) out.add(String(nm.text ?? ""))
    } else if (top.type === "type_declaration" || top.type === "var_declaration" || top.type === "const_declaration") {
      for (const spec of named(top)) {
        if (spec.type === "type_spec" || spec.type === "var_spec" || spec.type === "const_spec") addFromSpec(spec)
      }
    }
  }
  return out
}

/** Capitalized names declared INSIDE a function/method/func_literal body. */
function functionLocalExportedNames(root: any): Map<string, number> {
  const out = new Map<string, number>()
  const visit = (n: any, inBody: boolean): void => {
    const body = inBody || n.type === "function_declaration" || n.type === "method_declaration" || n.type === "func_literal"
    if (body && (n.type === "type_spec" || n.type === "var_spec" || n.type === "const_spec" || n.type === "function_declaration" || n.type === "method_declaration")) {
      let nm = ""
      if (n.type === "type_spec" || n.type === "function_declaration" || n.type === "method_declaration") {
        nm = String(n.childForFieldName("name")?.text ?? "")
      } else {
        for (const c of named(n)) if (c.type === "identifier") nm = String(c.text ?? "")
      }
      if (nm.length > 0 && isUpper(nm.slice(0, 1))) out.set(nm, n.startPosition.row + 1)
    }
    for (const c of named(n)) visit(c, body)
  }
  visit(root, false)
  return out
}

async function main(): Promise<void> {
  const all = collectAllGoFiles(CORPUS_ROOT)
  const { lib, test } = splitTestAndNonTest(all)
  const libWant = Math.max(1, Math.round(WANT * 0.75))
  const sample = [...strideSample(lib, libWant), ...strideSample(test, WANT - libWant)]
  const parser = await ASTEngine.getParser("go")

  let compared = 0
  let crashed = 0
  let exportsTotal = 0
  const bogusExports: Array<{ file: string; target: string; line: number }> = []
  let filesWithBogusExports = 0
  let instSixTotal = 0
  let instSixSelector = 0
  const bogusInst: Array<{ file: string; source: string; target: string; line: number; call: string }> = []
  let filesWithBogusInst = 0
  let sawTopLevelFuncNamedTarget = 0
  let instSixQualifiedOrBare = 0

  for (const f of sample) {
    let content: string
    try {
      content = readFileSync(f.path, "utf8")
    } catch {
      continue
    }
    let tree: any
    try {
      tree = parser.parse(content)
    } catch {
      continue
    }
    let res: any
    try {
      res = await ASTEngine.parseFile(f.path, content)
    } catch {
      crashed++
      continue
    }
    compared++

    const scope = packageScopeNames(tree.rootNode)
    const locals = functionLocalExportedNames(tree.rootNode)
    // top-level function names, for the instantiates falsifier
    const topFuncs = new Set<string>()
    for (const top of named(tree.rootNode)) {
      if (top.type !== "function_declaration") continue
      const nm = String(top.childForFieldName("name")?.text ?? "")
      if (nm.length > 0) topFuncs.add(nm)
    }

    // Import aliases and the package's own name. A package-qualified call
    // `pkg.Fn(...)` is a selector_expression but IS a call to a top-level
    // function, so "the callee was a selector" is too coarse to be a defect
    // test — the first version of this probe reported
    // `instantiates Sign -> Sign  callee "ed25519.Sign"` as a mislabel and it
    // is correct: src/crypto/ed25519/ed25519.go declares top-level `func Sign`
    // and the call `ed25519.Sign` selects it.
    //
    // The discriminator that actually separates the two is the selector's
    // OPERAND: a package name or an import alias names a package, anything else
    // is a receiver, and `err.Error(...)` is a method dispatch no matter what
    // the file happens to call Error.
    const pkgQualifiers = new Set<string>()
    const scanImports = (n: any): void => {
      if (n.type === "import_spec") {
        const alias = n.childForFieldName("name")
        if (alias) pkgQualifiers.add(String(alias.text ?? ""))
        const p2 = String(n.childForFieldName("path")?.text ?? "")
        const last = p2.split("/").pop() ?? ""
        if (last.length > 0) pkgQualifiers.add(last)
      }
      for (const c of named(n)) scanImports(c)
    }
    scanImports(tree.rootNode)
    // (c) The file's OWN package name. A self-qualified call inside a wrapper is
    // ordinary Go (`src/html/template/escape.go:977` is
    // `func HTMLEscape(...) { template.HTMLEscape(w, b) }`) and it does select
    // the top-level function the label claims. Leaving the own name out made
    // the first version of this probe report that edge as a mislabel, which is
    // the probe being wrong rather than the analyzer.
    const pkgClause = named(tree.rootNode).find((c) => c.type === "package_clause")
    if (pkgClause) {
      for (const c of named(pkgClause)) {
        if (c.type === "package_identifier") pkgQualifiers.add(String(c.text ?? ""))
      }
    }

    // (enclosing function name, callee leaf) -> the KINDS of call the file makes
    // there. Edge-level, not line-level: the first version keyed by line and
    // two calls on one line shared a key.
    const callsByLeaf = new Map<string, Set<string>>()
    const scanCalls = (n: any, enclosing: string): void => {
      let ctx = enclosing
      if (n.type === "function_declaration" || n.type === "method_declaration") ctx = String(n.childForFieldName("name")?.text ?? "")
      if (n.type === "call_expression") {
        const fn = n.childForFieldName("function")
        if (fn) {
          let leaf = ""
          let kind = String(fn.type)
          if (fn.type === "selector_expression") {
            leaf = String(fn.childForFieldName("field")?.text ?? "")
            const operand = fn.childForFieldName("operand")
            const opText = operand ? String(operand.text ?? "") : ""
            if (operand && operand.type !== "identifier") kind = "selector:compound-operand"
            else if (operand && opText.length > 0 && !pkgQualifiers.has(opText)) kind = "selector:receiver"
          } else if (fn.type === "identifier") {
            leaf = String(fn.text ?? "")
          } else {
            leaf = String(fn.text ?? "")
          }
          if (leaf.length > 0) {
            const key = `${ctx}\u0000${leaf}`
            let set = callsByLeaf.get(key)
            if (!set) {
              set = new Set()
              callsByLeaf.set(key, set)
            }
            set.add(kind)
          }
        }
      }
      for (const c of named(n)) scanCalls(c, ctx)
    }
    scanCalls(tree.rootNode, "")

    let fileBogusExports = 0
    let fileBogusInst = 0
    for (const r of res.relationships as any[]) {
      const ty = String(r.type ?? r.relationshipType ?? "")
      const dst = typeof r.target === "string" ? r.target : typeof r.to === "string" ? r.to : ""
      if (ty === "exports") {
        exportsTotal++
        if (locals.has(dst) && !scope.has(dst)) {
          fileBogusExports++
          if (bogusExports.length < 40) bogusExports.push({ file: f.rel, target: dst, line: locals.get(dst)! })
        }
      } else if (ty === "instantiates" && r.confidence === 0.6) {
        instSixTotal++
        if (topFuncs.has(dst)) sawTopLevelFuncNamedTarget++
        const kinds0 = callsByLeaf.get(`${String(r.source ?? "")}\u0000${dst}`)
        if (kinds0 && [...kinds0].some((k) => k === "identifier")) instSixQualifiedOrBare++
        const srcName = String(r.source ?? "")
        const kinds = callsByLeaf.get(`${srcName}\u0000${dst}`)
        // The label is wrong only when EVERY call the file makes to this leaf
        // from this function is a receiver selector. A bare identifier call, or
        // a package-qualified one, is the top-level function the label claims.
        if (kinds && kinds.size > 0 && [...kinds].every((k) => k === "selector:receiver" || k === "selector:compound-operand")) {
          instSixSelector++
          fileBogusInst++
          if (bogusInst.length < 40) {
            bogusInst.push({
              file: f.rel,
              source: String(r.source ?? ""),
              target: dst,
              line: Number(r.line_number),
              call: [...kinds].join(","),
            })
          }
        }
      }
    }
    if (fileBogusExports > 0) filesWithBogusExports++
    if (fileBogusInst > 0) filesWithBogusInst++
  }

  const L = (s: string) => process.stderr.write(s + "\n")
  L(`MISLABEL FALSIFIERS over ${compared} files (${WANT} requested), ${crashed} crashed`)
  L("")
  L(`(a) exports`)
  L(`    exports edges published                              ${exportsTotal}`)
  L(`    target declared INSIDE a function body, i.e. NOT     ${bogusExports.length}${filesWithBogusExports ? ` (capped sample; ${filesWithBogusExports} files affected)` : ""}`)
  L(`      exported by Go`)
  for (const e of bogusExports) L(`      ${e.file}:${e.line} exports -> ${e.target}`)
  L("")
  L(`(b) instantiates at confidence 0.6`)
  L(`    edges                                              ${instSixTotal}`)
  L(`    target is a top-level func name in the same file   ${sawTopLevelFuncNamedTarget}`)
  L(`    callee was a selector_expression (a METHOD call)   ${instSixSelector}${filesWithBogusInst ? ` (${filesWithBogusInst} files)` : ""}`)
  for (const e of bogusInst) L(`      ${e.file}:${e.line} instantiates ${e.source} -> ${e.target}   callee "${e.call}"`)
  const out = process.env.GO_MISLABEL_ARTIFACT
  if (out) {
    const { writeFileSync } = await import("node:fs")
    writeFileSync(
      out,
      JSON.stringify(
        { compared, crashed, exportsTotal, bogusExportCount: bogusExports.length, filesWithBogusExports, bogusExports, instSixTotal, instSixSelector, instSixQualifiedOrBare, sawTopLevelFuncNamedTarget, filesWithBogusInst, bogusInst },
        null,
        2,
      ),
    )
    L(`artifact: ${out}`)
  }
}

await main()