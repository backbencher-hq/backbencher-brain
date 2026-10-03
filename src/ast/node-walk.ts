/**
 * Shared AST tree-walk helpers.
 *
 * These exist because the same walk was written out three times and each copy
 * carried the same defect. The JS analyzer's `inDecoratorPosition` walked the
 * ancestor chain once per node to return an answer it already had; profiling
 * found it at 44.6% + 15.0% of CPU on a minified file, and the identical
 * predicate in the TypeScript analyzer — copy-pasted, comments and all — was
 * measured at 32.1% there. A defect that is copied is a defect that is fixed
 * twice and diagnosed twice.
 *
 * Keep the ANSWERS here and keep the per-lane POLICY (which node types count as a
 * boundary differs per grammar: the TS variant also stops at
 * `abstract_class_declaration`) in each analyzer. What belongs here is the
 * traversal and the cheap preconditions that make it affordable.
 */

/**
 * Does this tree contain a node of `type`?
 *
 * Iterative, with an early exit, and the only allocation is the stack. One such
 * traversal is dramatically cheaper than one ancestor walk per node, which is
 * what it replaces: a walk that can only answer `true` when a node of `type` is
 * an ANCESTOR can be short-circuited on "there are none", and establishing that
 * costs one pass.
 *
 * TypeScript note: the parameter shadows the global `type`, which is deliberate
 * and harmless inside this function.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function treeContainsNodeType(root: any, type: string): boolean {
  // A null/undefined root cannot contain anything, and answering "no" is the
  // correct answer. Without this the first `n.type` read threw
  // `TypeError: Cannot read properties of null`.
  //
  // The two current call sites both pass a non-null `rootNode: Node`, so this is
  // not reachable today — but this helper is typed `any`, so the compiler enforces
  // nothing, and it is on the path of every traversal in every analyzer. A guard
  // that costs one comparison is worth more than a crash found by a user.
  if (!root) return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stack: any[] = [root]
  while (stack.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = stack.pop()!
    if (!n) continue
    if (n.type === type) return true
    for (let i = 0; i < n.namedChildCount; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return false
}

/**
 * Is `n` inside any of `spans`?
 *
 * `spans` are half-open-free byte ranges, as `{ startIndex, endIndex }`. The
 * containment is the node itself OR any ancestor — a superseding span can start
 * above the node — so the ancestor walk is load-bearing whenever `spans` is
 * non-empty.
 *
 * The empty-list short-circuit is not an optimisation, it is the whole fix for
 * the common case: with no spans there is nothing to be inside, so the walk
 * cannot change the answer and must not be paid for. Every file without a
 * superseded duplicate body has no spans, and was walking to the tree root once
 * per node to return `false`.
 */
export function isNodeInSpans(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spans: { startIndex: number; endIndex: number }[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  n: any,
): boolean {
  if (spans.length === 0) return false
  // Same reasoning as `treeContainsNodeType`: a null node is not inside any span.
  // The `while (p)` loop already handled a null `n` (it never entered), so this
  // is belt-and-braces for a caller passing something falsy that is not null.
  if (!n) return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let p: any = n
  while (p) {
    for (const d of spans) {
      if (d.startIndex <= p.startIndex && p.endIndex <= d.endIndex) return true
    }
    p = p.parent
  }
  return false
}