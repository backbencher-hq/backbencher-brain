/**
 * OWNER-ATTRIBUTION PROBE — why a declaration's owner can be ITSELF.
 *
 * Round 3's P1/P2 found 10 `contains` edges and 10 symbols whose `ownerName`
 * equals their own `name`, e.g.
 *
 *   ohmyzsh/lib/clipboard.zsh:67  function clipcopy  scope=clipcopy  range 67-67
 *   consul/build-support/functions/10-util.sh:612  local ui_version  scope=ui_version
 *
 * The analyzer attributes a declaration to `enclosingFunction() || scriptName`,
 * and `enclosingFunction()` is the top of a stack pushed on ENTER of a
 * `function_definition` and popped on EXIT. A declaration owning ITSELF means
 * the stack was already wrong when the declaration was reached.
 *
 * There are exactly two ways that happens in this code, and this probe tells
 * them apart rather than guessing:
 *
 *   (a) POP WITHOUT PUSH — `extractFunction` returns early when `functionName`
 *       is empty, but the EXIT branch pops unconditionally. A nameless
 *       `function_definition` therefore shrinks the stack by one.
 *   (b) PUSH WITHOUT POP — the dispatch only pushes when `name` is non-empty;
 *       the EXIT branch always pops. So a push always has a pop, and (b) cannot
 *       come from that pair.
 *
 * So (b) must come from somewhere else: a `function_definition` whose body the
 * grammar nests INSIDE another one, which makes the inner definition's owner the
 * outer definition's name. When that happens the inner name equals the outer
 * name only if the grammar re-reads the same `function NAME` header — which is
 * exactly what the `clipcopy` rows show.
 *
 * This probe prints the stack at every `function_definition` enter/exit and every
 * declaration, plus a push/pop balance check, so the cause is a number and a
 * stack trace rather than a reading of the source.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/probe-bash-owner-stack.mts <file>...
 */

import { ASTEngine } from "../../../../src/ast/engine"
import { readFileSync } from "node:fs"

const parser = await ASTEngine.getParser("bash")

/** The analyzer's own name rule, reproduced so the probe measures the analyzer. */
const functionName = (node: any): string => {
  const named = node.childForFieldName?.("name")
  if (named && named.text) return named.text
  let prev: any = null
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (!child) continue
    if (child.type === "compound_statement" && prev && prev.type === "word") return prev.text
    prev = child
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (child && child.type === "word" && child.text !== "function") return child.text
  }
  return ""
}

for (const abs of process.argv.slice(2)) {
  const text = readFileSync(abs, "utf8")
  const lines = text.split("\n")
  const tree = parser!.parse(text)
  console.log(`\n=== ${abs} ===`)
  const stack: { name: string; line: number }[] = []
  let pushes = 0
  let pops = 0
  let nameless = 0
  let selfOwned = 0
  let depthOutside = 0

  const walk = (n: any): void => {
    if (n.type === "function_definition") {
      const name = functionName(n)
      const owner = stack.length > 0 ? stack[stack.length - 1].name : "(script)"
      if (name.length === 0) nameless++
      else {
        pushes++
        if (name === owner) {
          selfOwned++
          console.log(`  SELF-OWNED DECL @${n.startPosition.row + 1} name=${name} owner=${owner} :: ${(lines[n.startPosition.row] ?? "").trim().slice(0, 80)}`)
        }
        stack.push({ name, line: n.startPosition.row + 1 })
      }
      if (stack.length === 0 && name.length === 0) depthOutside++
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) walk(c)
      }
      // the analyzer's EXIT branch pops UNCONDITIONALLY
      pops++
      stack.pop()
      return
    }
    if (n.type === "declaration_command") {
      const kw = n.child(0)?.text ?? ""
      const owner = stack.length > 0 ? stack[stack.length - 1].name : "(script)"
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "variable_name" && c.text === owner) {
          console.log(`  SELF-OWNED LOCAL @${n.startPosition.row + 1} keyword=${kw} name=${c.text} owner=${owner} :: ${(lines[n.startPosition.row] ?? "").trim().slice(0, 80)}`)
          selfOwned++
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) walk(c)
    }
  }
  walk(tree.rootNode)
  console.log(`  function_definition nodes: pushes=${pushes} pops=${pops} nameless=${nameless} stackDepthAtEnd=${stack.length}`)
  console.log(`  self-owned declarations: ${selfOwned}`)
  tree.delete?.()
}