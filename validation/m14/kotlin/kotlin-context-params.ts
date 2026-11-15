// VERIFY_KOTLIN — the `Global` call sources, attributed to a CAUSE.
//
// 524 `Global` call edges over a 400-file stratified sample: 496 in Gradle
// `.kts` script bodies, 28 in `.kt` files. The 28 are not a corpus accident —
// they are Kotlin CONTEXT PARAMETERS.
//
//   context(session: FirSession)
//   private fun KotlinTypeFacade.extractValue(...)
//
// is a Kotlin 2.2 declaration form. tree-sitter-kotlin has no node for it: the
// header parses as a top-level `call_expression` whose callee is the soft keyword
// `context`, with an ERROR node standing in for each `: Type` annotation. The
// analyzer's call walk reads the callee, sees a lowercase unqualified name, and
// publishes `Global -> context` at confidence 0.7: a DECLARATION recorded as a
// CALL, with a fabricated source. That is precisely the fabrication class that
// poisons bb_graph and bb_migrate.
//
// This probe measures the population of each shape so a fix can be sized before
// it is written, and so a later claim that the shape is gone is falsifiable.
//
// NO REGEX: shapes are decided by node.type and by walking children.
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
function subtreeHasError(n: Node): boolean {
  const stack: Node[] = [n]
  while (stack.length) {
    const x = stack.pop() as Node
    if (x.type === "ERROR" || x.isMissing) return true
    for (let i = 0; i < x.childCount; i++) { const c = x.child(i); if (c) stack.push(c) }
  }
  return false
}
function firstNamed(n: Node): Node | undefined { return n.namedChildCount > 0 ? (n.namedChild(0) || undefined) : undefined }
function leafOf(callee: Node | undefined): string {
  if (!callee) return ""
  if (callee.type === "simple_identifier") return callee.text
  return ""
}

async function main() {
  const want = Number(process.argv[2] || 400)
  const files = stratify(walkKotlin(KOTLIN_CORPUS, { minBytes: 400 }), want)
  const parser = await getParser("kotlin")

  let ctxTopLevel = 0            // top-level `context(...)` pseudo-calls
  let ctxAnywhere = 0
  let ctxFiles = 0
  let callWithErrorArgs = 0      // any call_expression whose call_suffix holds an ERROR
  let callWithErrorArgsNotCtx = 0
  let scriptTopLevelCalls = 0    // top-level call_expressions in a .kts file
  let scriptFiles = 0
  let errorNodeCallSites = 0     // call_expressions nested INSIDE an ERROR node
  let totalCalls = 0
  const examples: Array<{ file: string; line: number; text: string }> = []

  for (const f of files) {
    let content: string
    try { content = readFileSync(f.path, "utf8") } catch { continue }
    try {
      const pr = await parser.parse(content, f.path)
      let sawCtx = false
      if (f.isScript) scriptFiles++
      const stack: Array<{ n: Node; inError: boolean }> = [{ n: pr.rootNode, inError: false }]
      while (stack.length) {
        const { n, inError } = stack.pop() as any
        if (n.type === "call_expression") {
          totalCalls++
          if (inError) errorNodeCallSites++
          const callee = firstNamed(n)
          const leaf = leafOf(callee)
          const suffix = n.namedChildCount > 1 ? n.namedChild(1) : undefined
          const hasErr = suffix ? subtreeHasError(suffix) : false
          const topLevel = n.parent ? n.parent.type === "source_file" : false
          if (leaf === "context" && hasErr) {
            ctxAnywhere++
            if (topLevel) { ctxTopLevel++; sawCtx = true }
            if (examples.length < 10) examples.push({ file: f.rel, line: n.startPosition.row + 1, text: n.text.slice(0, 70).split("\n")[0] })
          }
          if (hasErr) {
            callWithErrorArgs++
            if (!(leaf === "context")) callWithErrorArgsNotCtx++
          }
          if (topLevel && f.isScript) scriptTopLevelCalls++
        }
        const childInError = inError || n.type === "ERROR"
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push({ n: c, inError: childInError }) }
      }
      if (sawCtx) ctxFiles++
    } catch { /* ignore */ }
  }

  console.log(`sample ${files.length} files (${scriptFiles} .kts)`)
  console.log(`call_expression nodes: ${totalCalls}`)
  console.log(`  top-level \`context(...)\` pseudo-calls:            ${ctxTopLevel} in ${ctxFiles} files`)
  console.log(`  any-position \`context(...)\` pseudo-calls:        ${ctxAnywhere}`)
  console.log(`  call_expressions with an ERROR inside call_suffix: ${callWithErrorArgs}`)
  console.log(`     of which callee is NOT \`context\`:              ${callWithErrorArgsNotCtx}`)
  console.log(`  call_expressions nested inside an ERROR node:     ${errorNodeCallSites}`)
  console.log(`  top-level call_expressions in .kts files:          ${scriptTopLevelCalls}`)
  console.log("\nexamples of the context-parameter shape:")
  for (const e of examples) console.log(`  ${e.file}:${e.line}  ${e.text}`)
  writeFileSync("/tmp/opencode/kotlin-ctx.json", JSON.stringify({
    sample: files.length, scriptFiles, totalCalls, ctxTopLevel, ctxAnywhere, ctxFiles,
    callWithErrorArgs, callWithErrorArgsNotCtx, errorNodeCallSites, scriptTopLevelCalls, examples,
  }, null, 2))
}
main().catch((e) => { console.error(String(e)); process.exit(1) })