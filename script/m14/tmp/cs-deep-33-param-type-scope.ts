// CS-DEEP-33 — size D8 CORRECTLY. A `parameter`'s TYPE field is published as a bare member read.
//
// cs-deep-31 measured only PRIMARY-CONSTRUCTOR parameter lists and reported 3. cs-deep-32 then
// showed a fourth site that probe could not see: `UpdateExpressionState.cs:450`,
// `TryAnalyzeForeachStatement(SemanticModel semanticModel, ...)` -- a METHOD parameter, same
// shape, attributed to its enclosing method. The two probes disagreed because the second one
// asked "which sites did the method's row come from" and answered with a DIFFERENT site than the
// row's own line_number. Trusting line_number over attribution is the whole lesson, and the
// probe that got it wrong is kept for the same reason cs-deep-9 is.
//
// The condition, stated once: a `parameter` whose `type` field is an identifier naming a
// Property-kind member of an enclosing class resolves as a read, because the inventory holds that
// name and nothing binds it. Method parameters, primary-constructor parameters and record
// positionals are all `parameter` nodes, so all three are the same defect.
//
// CONTROL, and it is the part that makes this a defect rather than a rule: the same file's
// `UpdateExpressionState.cs:25` and `:450` are the SAME NAME read as a type, and neither is a
// read. Meanwhile `:112` and `:202` are the same name read as a value, and both are. The
// analyzer cannot tell them apart; the `type` FIELD can.
import * as fs from "fs"; import * as path from "path"
const ROOT = process.cwd()
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts; const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
const p = new P(); p.setLanguage(g)
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const files = fs.readFileSync(process.argv[2], "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, Number(process.argv[3] ?? 200))
let total = 0
const byShape = new Map<string, number>()
const rows: string[] = []
for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  let res: any, root: any
  try { res = await ASTEngine.parseFile(f, src); root = p.parse(src).rootNode } catch { continue }
  const bare = new Set<string>()
  for (const r of res.relationships ?? []) {
    if ((r.type ?? r.relationshipType) === "uses" && String((r.metadata ?? {}).relationshipType) === "identifier_usage")
      bare.add(`${r.source}|${r.target}|${r.line_number}`)
  }
  // every `parameter` whose type field is an identifier, with the shape of its owner
  const w = (n: any, shape: string): void => {
    let s = shape
    if (/^(class|struct|record|interface)_declaration$/.test(n.type)) s = "primary-constructor"
    if (n.type === "method_declaration" || n.type === "constructor_declaration" || n.type === "local_function_statement" || n.type === "lambda_expression") s = "method-or-lambda"
    if (n.type === "parameter") {
      const tf = n.childForFieldName?.("type")
      // The `type` field IS the identifier when the type is a bare name -- an identifier has NO
      // children, so the first cut of this probe walked `tf`'s children and measured 0 across
      // 200 files, which is not a finding about C# but a finding about a loop. Two probes now
      // disagree on the same rows, and the tie is broken by reading the grammar, not by picking
      // the probe whose number is more convenient.
      const names: any[] = []
      if (tf) {
        if (tf.type === "identifier") names.push(tf)
        else for (let i = 0; i < tf.namedChildCount; i++) { const c = tf.namedChild(i); if (c && c.type === "identifier") names.push(c) }
      }
      for (const c of names) {
        {
        // Match on the LINE, not just the name. The name-only cut of this probe reported 4
        // "hits" after the D8 fix, all of them REAL reads (UpdateExpressionState.cs:112 is a
        // genuine `SemanticModel.GetSymbolInfo(...)`) that got flagged only because some other
        // parameter in the file happens to be of the same type. A name match across a whole file
        // is not evidence about a position; the row's own line_number is.
        const pline = String(n.startPosition.row + 1)
        const hit = [...bare].find((k) => { const parts = k.split("|"); return parts[1] === c.text && parts[2] === pline })
        if (hit) { total++; byShape.set(s, (byShape.get(s) ?? 0) + 1); if (rows.length < 12) rows.push(`${path.basename(f)}  ${hit.replace("|", " -> ")}  [${s}]`) }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const ch = n.namedChild(i); if (ch) w(ch, s) }
  }
  w(root, "other")
}
console.log(`files: ${files.length}`)
console.log(`\nD8  \`parameter\` TYPE field published as a bare member read: ${total}`)
for (const [k, v] of [...byShape.entries()].sort((a, b) => b[1] - a[1])) console.log(`      ${k.padEnd(24)} ${v}`)
for (const r of rows) console.log(`      ${r}`)
console.log(`\n   A bare `+"`identifier_usage`"+` row whose name equals a `+"`parameter`"+`'s type identifier is a`)
console.log(`   published TYPE, not a read: the position carries no value. Same name, same class,`)
console.log(`   same inventory entry -- the only difference is the grammar's \`type\` field.`)
