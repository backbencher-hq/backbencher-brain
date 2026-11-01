/**
 * The R oracle — LANE-OWNED, written from R's own semantics and the lane's measured conventions,
 * sharing no rule table or resolver with `RealRAnalyzer`.
 *
 * ## What it derives (label → target identity; the differential compares target LEAVES)
 *
 *  - `contains`  — the file scope ("global") contains each name it assigns at top level; an R6/S4/
 *                  R5 class contains the members written in its `public`/`private`/`active` lists or
 *                  its `representation`/`slots`/`fields`/`methods`; `setMethod` and `setGeneric`
 *                  declare the class's method name.
 *  - `extends`   — R6's `inherit =`, S4's `contains =`, R5's `contains =`: the class's superclass name.
 *  - `calls`     — every call's CALLEE name (`name()`, `ns::name()`, `obj$method()`).
 *  - `references`/`imports` — `pkg::` namespace loads, `library(pkg)`/`require(pkg)`, and
 *                  `source("file")` (a file is an import in this lane, measured on F07-imports.R).
 *  - `uses`      — `$`/`@` member READS: the member name is used by the enclosing function.
 *
 * ## What it deliberately does not claim
 *
 * Argument types, default values and evaluation order are not edges. A shape the oracle does not
 * model shows up as an unexplained analyzer row (never as a silent pass), which is how this file's
 * next iteration is decided.
 */
export type REdge = { label: string; from: string; target: string }

const children = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < (n?.namedChildCount ?? 0); i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}
const txt = (n: any): string => (n ? String(n.text ?? "") : "")
const firstOfType = (n: any, type: string): any | undefined => children(n).find((c: any) => c.type === type)
/** Leaf of a dotted/`::`/`$`-qualified name, which is the identity the comparison uses. */
const leaf = (s: string): string => {
  // R quotes non-syntactic names with backticks (`[.rowwise_df`); the identity the lane compares is
  // the name itself, so the quoting is stripped before the leaf is taken. Measured 2026-11-01: three
  // `contains` rows in dplyr R/rowwise.R differed only by the backticks.
  const parts = String(s).replace(/`/g, "").split(/::|\$|@|\./).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : String(s).replace(/`/g, "")
}
const isAssignment = (n: any): boolean => {
  if (n.type !== "binary_operator") return false
  const t = txt(n)
  return /\s(<-|<<-|=|->|->>)\s/.test(` ${t} `) || t.includes("<-") || t.includes("<<-")
}
const stripQuotes = (s: string): string => s.replace(/^['"]|['"]$/g, "")

/** Named arguments of a call: name → value node (unnamed args appear with the arg's own name ""). */
function namedArgs(call: any): { name: string; value: any }[] {
  const argsNode = firstOfType(call, "arguments")
  if (!argsNode) return []
  const out: { name: string; value: any }[] = []
  for (const a of children(argsNode)) {
    if (a.type !== "argument") continue
    const kids = children(a)
    if (kids.length >= 2 && kids[0].type === "identifier") out.push({ name: txt(kids[0]), value: kids[1] })
    else out.push({ name: "", value: kids[0] ?? a })
  }
  return out
}
/** Argument nodes of a call in positional order. */
function positionalArgs(call: any): any[] {
  const argsNode = firstOfType(call, "arguments")
  if (!argsNode) return []
  return children(argsNode).filter((c: any) => c.type === "argument").map((a: any) => children(a)[0] ?? a)
}
/** The member names declared by a `list(...)`-shaped argument (R6 public/private/active). */
function listMemberNames(value: any): string[] {
  const out: string[] = []
  const call = value?.type === "call" ? value : children(value ?? {}).find((c: any) => c.type === "call")
  if (!call) return out
  for (const a of namedArgs(call)) if (a.name) out.push(a.name)
  return out
}

export function deriveRTruth(root: any): REdge[] {
  const edges: REdge[] = []
  const push = (label: string, from: string, target: string) => {
    if (target) edges.push({ label, from, target })
  }

  // ── one walk of the whole tree for calls / uses / namespaces / library() / source() ───────────
  // `calls` are derived only INSIDE a function definition: the lane's resolution unit is the
  // function, and a call written in a top-level expression (a `test_that(...)` wrapper's body, say)
  // is not published by the analyzer. Measured 2026-11-01 on tests/testthat/test-locale.R: the oracle
  // emitted 15 calls the analyzer does not, all inside `test_that()` bodies — over-derivation that
  // reads as MISSING. The unit is stated here rather than the analyzer's silence being mirrored
  // silently: a function body is where this lane resolves calls.
  const calleeNodes = new Set<any>()
  const markCallees = (n: any) => {
    for (const c of children(n)) {
      if (c.type === "call") {
        const first = children(c)[0]
        if (first) calleeNodes.add(first)
      }
      markCallees(c)
    }
  }
  markCallees(root)
  const isCallCallee = (node: any) => calleeNodes.has(node)
  const walkAll = (n: any, inFunction: boolean) => {
    for (const c of children(n)) {
      const nextInFunction = inFunction || c.type === "function_definition"
      if (c.type === "extract_operator" || c.type === "extract_operator_ns") {
        // `cnd$x`: the RECEIVER is the first identifier and the MEMBER is the last one; the uses
        // row names the member (measured 2026-11-01 on dplyr R/vctrs.R: the analyzer's four uses
        // rows are `common_handler -> x`, `-> x_arg`, `-> y`, `-> y_arg`, one per member read).
        // A `obj$method(...)` callee is a CALL, not a member READ — measured 2026-11-01 on
        // `cli$format_code(...)`: deriving it as `uses` was the only over-derivation left in that file.
        const ids = children(c).filter((x: any) => x.type === "identifier")
        // A member READ is published only inside a function body, exactly like `calls`: the lane's
        // resolution unit is the function, and a `df$x` written in a top-level `test_that(...)` body
        // is not published. Measured 2026-11-01 on dplyr tests/: 293 over-derived `uses` rows, all
        // outside any function body — the single largest MISSING class before this bound.
        if (inFunction && ids.length && !isCallCallee(c)) push("uses", "", leaf(txt(ids[ids.length - 1])))
      }
      if (c.type === "call") {
        // The callee may be an identifier, a `pkg::name` qualification, a `obj$method` extraction,
        // or a KEYWORD call like `return(...)` — all four are published by the lane (measured
        // 2026-11-01: `calls -> return` and `calls -> cli$format_code` were unexplained rows).
        const calleeNode = children(c).find((x: any) =>
          x.type === "identifier" || x.type === "namespace_operator" ||
          x.type === "extract_operator" || x.type === "extract_operator_ns")
        const keyword = children(c)[0] && !calleeNode ? children(c)[0] : undefined
        if (calleeNode || keyword) {
          const callee = txt(calleeNode ?? keyword)
          if (inFunction) {
            // A method call is published with the receiver: the comparison's normalization splits
            // `.`/`::`, NOT `$`, so `cli$format_code` must be emitted whole. Measured 2026-11-01:
            // the largest remaining unexplained class was exactly these rows.
            const isExtract = calleeNode?.type === "extract_operator" || calleeNode?.type === "extract_operator_ns"
            const target = isExtract ? stripQuotes(txt(calleeNode)) : leaf(callee)
            if (/^[A-Za-z_.$][A-Za-z0-9_.$]*$/.test(target)) push("calls", "", target)
          }
          if (calleeNode?.type === "namespace_operator") {
            // `pkg::name` loads the package: both an imports and a references row in this lane,
            // wherever it is written (a top-level `rlang::abort()` in a test file loads rlang).
            const pkg = children(calleeNode)[0]
            const pkgName = leaf(txt(pkg))
            if (pkgName) {
              push("imports", "global", pkgName)
              push("references", "global", pkgName)
            }
          }
          if (/^(library|require|requireNamespace|loadNamespace)$/.test(leaf(callee))) {
            const a0 = positionalArgs(c)[0]
            if (a0) push("imports", "global", leaf(stripQuotes(txt(a0))))
          }
          if (/^source$/.test(leaf(callee))) {
            const a0 = positionalArgs(c)[0]
            const file = leaf(stripQuotes(txt(a0)))
            if (file) {
              push("imports", "global", file)
              push("references", "global", file)
            }
          }
        }
      }
      walkAll(c, nextInFunction)
    }
  }
  walkAll(root, false)

  // ── top level: assignments, classes, setMethod/setGeneric ───────────────────────────────────
  const top = root.type === "program" ? root : children(root).find((c: any) => c.type === "program") ?? root
  // File-scope assignments: the lane flattens an assignment written inside a top-level EXPRESSION
  // (a `test_that(...)` body) to `global`, and does not descend into a function body. Measured
  // 2026-11-01 on tests/testthat/test-by.R: `contains global -> df` inside a test_that block.
  const collectScope = (n: any, inFunction: boolean): void => {
    for (const c of children(n)) {
      const nextInFunction = inFunction || c.type === "function_definition"
      if (!inFunction && isAssignment(c)) {
        const lhs = children(c)[0]
        if (lhs && lhs.type === "identifier") {
          const name = txt(lhs)
          push("contains", "global", name)
          // S3 dispatch spelling: `generic.class <- function(...)` implements the generic. Measured
          // 2026-11-01 on dplyr R/compute-collect.R: `implements collect.data.frame -> collect`.
          if (name.replace(/`/g, "").includes(".") && !name.endsWith(".")) {
            // `filter_bullets.dplyr:::filter_incompatible_type <- ...` still implements the first
            // dot-segment's generic. Measured 2026-11-01 on dplyr R/filter.R.
            const generic = name.replace(/`/g, "").split(".")[0]
            if (generic && /^[A-Za-z_][A-Za-z0-9_]*$/.test(generic)) push("implements", name, generic)
          }
        }
        const rhs = children(c)[1]
        if (rhs && rhs.type === "call") emitClass(rhs, lhs ? txt(lhs) : "")
        continue
      }
      if (!inFunction && c.type === "call") emitClass(c, "")
      collectScope(c, nextInFunction)
    }
  }
  collectScope(top, false)

  function emitClass(call: any, className: string): void {
    const calleeNode = children(call).find((x: any) => x.type === "identifier" || x.type === "namespace_operator")
    const callee = calleeNode ? leaf(txt(calleeNode)) : ""
    const isR6 = callee === "R6Class" || callee === "R6"
    const isS4 = callee === "setClass"
    const isR5 = callee === "setRefClass"
    const isMethod = callee === "setMethod"
    const isGeneric = callee === "setGeneric"
    if (!isR6 && !isS4 && !isR5 && !isMethod && !isGeneric) return
    if (isMethod) {
      const positional = positionalArgs(call).map((a: any) => stripQuotes(txt(a)))
      const methodName = positional[0] ? leaf(positional[0]) : ""
      const cls = positional[1] ? leaf(positional[1]) : ""
      if (methodName) push("contains", cls || "global", methodName)
      return
    }
    if (isGeneric) {
      const positional = positionalArgs(call).map((a: any) => stripQuotes(txt(a)))
      if (positional[0]) push("contains", "global", leaf(positional[0]))
      return
    }
    // a class call: the class NAME is its first positional string (S4/R5) or its first named arg (R6)
    let name = className
    if (!name) {
      const positional = positionalArgs(call).map((a: any) => stripQuotes(txt(a)))
      name = positional[0] ? leaf(positional[0]) : ""
    }
    if (name) push("contains", "global", name)
    for (const a of namedArgs(call)) {
      const key = a.name.toLowerCase()
      if (key === "inherit" || key === "contains") {
        const base = leaf(stripQuotes(txt(a.value)))
        if (base && name) push("extends", name, base)
      } else if (key === "public" || key === "private" || key === "active" || key === "fields" || key === "methods" || key === "representation" || key === "slots") {
        for (const m of listMemberNames(a.value)) push("contains", name, m)
        // S4 `representation(slot = type)` is a call, not a list: read its named args too
        if (a.value?.type === "call") for (const m of namedArgs(a.value)) if (m.name) push("contains", name, m.name)
      }
    }
  }
  return edges
}
