// VERIFY_KOTLIN — why are 223 call edges sourced `Global`?
//
// The firing census counts `Global` as a rule-R7 placeholder endpoint. This
// attributes every one of them to a CAUSE, because the two candidate causes
// need opposite answers:
//
//   A. a Gradle `.kts` script body, which is not inside any declaration at all
//   B. a tree-sitter MIS-PARSE that moves the class body out from under the
//      call, in which case no parent-walk can reach a declaration
//
// For (B) this probe minimises the trigger. The trigger found is an ANNOTATION
// on a delegation specifier: `class J(...) : @Suppress("X") Super<T>(args) {`
// makes tree-sitter-kotlin emit the annotation as `receiver_type > type_modifiers
// > annotation`, drop the supertype's value_arguments, and re-root the rest of
// the class as a `call_expression` DIRECTLY UNDER source_file — so the enclosing
// class_declaration becomes a SIBLING of the calls, not their ancestor.
//
// NO REGEX. Attribute by node ancestry and by extension, nothing else.
import { readFileSync, writeFileSync } from "node:fs"
import type { Node } from "web-tree-sitter"
import { getParser } from "../../../src/ast/engine"
import { RealKotlinAnalyzer } from "../../../src/ast/real-kotlin-analyzer"
import { walkKotlin, stratify, KOTLIN_CORPUS, KOTLIN_CORPUS_PIN } from "./kotlin-corpus"

function namedKids(n: Node): Node[] {
  const out: Node[] = []
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) out.push(c) }
  return out
}
function ancestors(n: Node): string[] {
  const out: string[] = []
  let p = n.parent
  while (p) { out.push(p.type); p = p.parent }
  return out
}
/** Does this file contain an annotation directly on a delegation specifier? */
function annotatedDelegation(root: Node): number {
  let n = 0
  const stack: Node[] = [root]
  while (stack.length) {
    const nd = stack.pop() as Node
    if (nd.type === "delegation_specifier") {
      const m = nd.namedChild(0)
      if (m && m.type === "modifiers") n++
    }
    for (const c of namedKids(nd)) stack.push(c)
  }
  return n
}
/** A call_expression whose first named child is a string_literal: the recovery shape. */
function stringCalleeCalls(root: Node): number {
  let n = 0
  const stack: Node[] = [root]
  while (stack.length) {
    const nd = stack.pop() as Node
    if (nd.type === "call_expression") {
      const first = nd.namedChild(0)
      if (first && first.type === "string_literal") n++
    }
    for (const c of namedKids(nd)) stack.push(c)
  }
  return n
}
function hasErrorNode(root: Node): boolean {
  const stack: Node[] = [root]
  while (stack.length) {
    const n = stack.pop() as Node
    if (n.type === "ERROR" || n.isMissing) return true
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push(c) }
  }
  return false
}

async function main() {
  const want = Number(process.argv[2] || 400)
  const files = stratify(walkKotlin(KOTLIN_CORPUS, { minBytes: 400 }), want)
  const parser = await getParser("kotlin")
  let globals = 0, globalFiles = 0, parsed = 0
  let gKts = 0, gKt = 0
  let filesWithAnnotatedDelegation = 0, filesWithStringCallee = 0
  let errorFiles = 0
  // for .kt (non-script) Global edges, record whether the file ALSO shows the
  // recovery shape — the discriminator between cause A and cause B
  const ktGlobals: Array<{ file: string; line?: number; target: string; stringCallee: number; err: boolean; annotatedDelegation: number }> = []

  for (const f of files) {
    let content: string
    try { content = readFileSync(f.path, "utf8") } catch { continue }
    try {
      const pr = await parser.parse(content, f.path)
      const res = new RealKotlinAnalyzer().analyze(pr.rootNode, content, f.path)
      parsed++
      const ad = annotatedDelegation(pr.rootNode)
      const sc = stringCalleeCalls(pr.rootNode)
      const en = hasErrorNode(pr.rootNode)
      if (ad > 0) filesWithAnnotatedDelegation++
      if (sc > 0) filesWithStringCallee++
      if (en) errorFiles++
      let g = 0
      for (const r of res.relationships || []) {
        if (String(r.type) !== "calls") continue
        if (String(r.source) !== "Global") continue
        g++
        if (f.isScript) gKts++; else { gKt++; ktGlobals.push({ file: f.rel, line: (r as any).line_number, target: String(r.target), stringCallee: sc, err: en, annotatedDelegation: ad }) }
      }
      if (g > 0) globalFiles++
      globals += g
    } catch { /* ignore */ }
  }

  console.log(`sample ${files.length}, parsed ${parsed}`)
  console.log(`\`Global\` call edges: ${globals} in ${globalFiles} files  (scripts ${gKts}, non-script ${gKt})`)
  console.log(`files with an annotation on a delegation specifier: ${filesWithAnnotatedDelegation}`)
  console.log(`files with the recovery shape (call_expression on a string_literal callee): ${filesWithStringCallee}`)
  console.log(`files with a reachable ERROR/MISSING node: ${errorFiles}`)
  console.log("\nnon-script `Global` edges, with the discriminator columns:")
  for (const g of ktGlobals) console.log(`  ${g.file}:${g.line} -> ${g.target}   stringCalleeCalls=${g.stringCallee} errorNode=${g.err} annotatedDelegation=${g.annotatedDelegation}`)
  writeFileSync("/tmp/opencode/kotlin-globals.json", JSON.stringify({ sample: files.length, globals, globalFiles, gKts, gKt, filesWithAnnotatedDelegation, filesWithStringCallee, errorFiles, ktGlobals }, null, 2))
}
main().catch((e) => { console.error(String(e)); process.exit(1) })