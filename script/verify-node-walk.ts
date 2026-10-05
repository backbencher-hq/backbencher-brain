/**
 * Shared AST traversal helpers must not crash on degenerate trees.
 *
 * `src/ast/node-walk.ts` is on the path of EVERY traversal in EVERY analyzer —
 * `treeContainsNodeType` is the one-pass decorator pre-pass in the JS and TS
 * analyzers, and `isNodeInSpans` decides whether a node sits in a superseded
 * body. Both were typed `any`, so nothing enforced their preconditions.
 *
 * `treeContainsNodeType(null, "x")` threw
 * `TypeError: Cannot read properties of null (reading 'type')` on the first
 * dereference. Not reachable from today's two call sites (both pass a non-null
 * `rootNode: Node`), which is exactly why it survived — but a helper every
 * analyzer depends on should answer "no" for an empty tree, not throw.
 *
 * These assertions use synthetic trees, so they are deterministic and need no
 * grammar, wasm, or fixture project.
 */

import { treeContainsNodeType, isNodeInSpans } from "../src/ast/node-walk"

let failures = 0
function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ok: ${name}`)
  } else {
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`)
    failures++
  }
}

/** A minimal tree-sitter-shaped node. */
function node(type: string, children: any[] = []): any {
  return {
    type,
    startIndex: 0,
    endIndex: 0,
    namedChildCount: children.length,
    namedChild: (i: number) => children[i] ?? null,
  }
}

console.log("treeContainsNodeType")
{
  // The exact crash: a null root.
  let threw: any = null
  let result: boolean | undefined
  try {
    result = treeContainsNodeType(null, "decorator")
  } catch (e) {
    threw = e
  }
  ok("a null root returns false instead of throwing", threw === null, threw ? String(threw.message) : "")
  ok("a null root answers false", threw === null && result === false, `got ${String(result)}`)

  threw = null
  try {
    treeContainsNodeType(undefined, "decorator")
  } catch (e) {
    threw = e
  }
  ok("an undefined root returns false instead of throwing", threw === null, threw ? String(threw.message) : "")

  // A child that is null must not be pushed and then dereferenced.
  threw = null
  let r2: boolean | undefined
  try {
    r2 = treeContainsNodeType({ type: "root", namedChildCount: 2, namedChild: (i: number) => (i === 0 ? null : node("target")) }, "target")
  } catch (e) {
    threw = e
  }
  ok(
    "a null child does not crash the walk, and later siblings are still visited",
    threw === null && r2 === true,
    threw ? String(threw.message) : `got ${String(r2)}`,
  )

  // The positive and negative answers must still be right — a guard that always
  // returned false would pass the crash checks above.
  ok("finds a node type that IS present", treeContainsNodeType(node("root", [node("a", [node("decorator")])]), "decorator") === true)
  ok("returns false for a type that is absent", treeContainsNodeType(node("root", [node("a"), node("b")]), "decorator") === false)
  ok("a leaf node with no children is handled", treeContainsNodeType(node("leaf"), "decorator") === false)
  ok("a leaf node matching its own type is found", treeContainsNodeType(node("leaf"), "leaf") === true)
}

console.log("\nisNodeInSpans")
{
  const spans = [{ startIndex: 0, endIndex: 100 }]
  const inside = { startIndex: 10, endIndex: 20, parent: null }
  const outside = { startIndex: 200, endIndex: 300, parent: null }
  const nested = { startIndex: 10, endIndex: 20, parent: { startIndex: 0, endIndex: 50, parent: null } }

  ok("no spans means not inside any span", isNodeInSpans([], inside) === false)
  ok("a node within a span is inside it", isNodeInSpans(spans, inside) === true)
  ok("a node outside every span is not", isNodeInSpans(spans, outside) === false)
  ok("containment includes an ANCESTOR (a superseding span)", isNodeInSpans(spans, nested) === true)

  let threw: any = null
  try {
    isNodeInSpans(spans, null)
  } catch (e) {
    threw = e
  }
  ok("a null node does not throw", threw === null, threw ? String(threw.message) : "")
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s)`} — node-walk robustness`)
if (failures > 0) process.exitCode = 1
