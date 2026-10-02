/**
 * INDEPENDENT declared-type oracle for php — measurement harness.
 *
 * WHY THIS EXISTS. `script/m14/differential.ts` imports THREE functions from the
 * analyzer: `PHP_BUILTINS`, `phpStaticCallableName`, `phpStaticIncludePath`, and
 * `phpDeclaredTypeRefs` — the WHOLE declared-type reference graph. The lane's own
 * header justifies sharing ("a rule the truth does not share is a rule that can
 * drift"), and the drift half of that is real. The blindness half is the cost, and
 * it has already been paid once: `phpStaticCallableName` was WRONG for a long time
 * (it published `calls -> $callable`, a target no php symbol can be named), the
 * oracle agreed because it called the same function, and nothing could see it —
 * R10's target-spelling census found it, not a differential.
 *
 * `references` is 8,030 edges over the two pinned corpora, php's 6th-largest
 * label, and it is the largest label with NO second implementation at all. This
 * oracle is written from the pinned grammar's own shapes
 * (`script/m60/tmp/php-type-shapes.mts`) and shares no code with
 * `phpDeclaredTypeRefs`: its own position table, its own wrapper descent, its own
 * leaf extraction, its own relative-type resolution.
 *
 * WHAT IT IS ALLOWED TO SHARE, and why that is not cheating: the enclosing class's
 * DECLARED BASE, read from `metadata.baseClass` on the analyzer's own symbol. That
 * is a published FACT both sides read rather than a rule either side computes —
 * `derivePhpDeclaredTypeEdges` already does exactly this for `parent` resolution.
 *
 * Run: bun script/m60/tmp/php-declared-type-ab.mts
 */
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import * as path from "node:path"
const ROOT = "$HOME/backbencher-brain"
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const { derivePhpDeclaredTypeEdges } = await import(path.join(ROOT, "script/m14/differential.ts"))
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
await P.init({ locateFile: () => `${ROOT}/node_modules/web-tree-sitter/tree-sitter.wasm` })
const g: any = await (wts as any).Language.load(readFileSync(`${ROOT}/wasm/tree-sitter-php.wasm`))
const parser = new P(); parser.setLanguage(g)

// ============================================================================
// The independent rule. PHP semantics, one sentence: a declaration that WRITES a
// type name depends on the type it names. Written from the grammar shapes.
// ============================================================================

/** Positions that WRITE a type, and who the dependency belongs to. */
const TYPE_POSITIONS: Array<{ node: string; field: "type" | "return_type"; owner: "type" | "callable" | "file" }> = [
  // A member's dependency belongs to the enclosing TYPE (the attribution the
  // csharp round measured off java/kotlin/python and pinned).
  { node: "property_declaration", field: "type", owner: "type" },
  // PHP 8.3 typed class constant — the M60 F4 round. Same shape, same owner.
  { node: "const_declaration", field: "type", owner: "type" },
  // A parameter's dependency belongs to the enclosing CALLABLE, and a promoted
  // parameter is a PARAMETER: that is the position it is written in.
  { node: "simple_parameter", field: "type", owner: "callable" },
  { node: "variadic_parameter", field: "type", owner: "callable" },
  { node: "property_promotion_parameter", field: "type", owner: "callable" },
  // A return type is a return type, whatever encloses it.
  { node: "method_declaration", field: "return_type", owner: "callable" },
  { node: "function_definition", field: "return_type", owner: "callable" },
]
const POS = new Map(TYPE_POSITIONS.map((p) => [`${p.node}.${p.field}`, p]))
/** Node types that are a TYPE but name no userland symbol. */
const NON_DEPENDENCY_TYPES = new Set(["primitive_type", "bottom_type"])
const RELATIVE = new Set(["self", "static", "parent"])
const NAMED_TYPES = new Set(["class_declaration", "interface_declaration", "trait_declaration", "enum_declaration"])
const CALLABLES = new Set(["method_declaration", "function_definition", "anonymous_function", "arrow_function"])

/** The last `name` under a named_type — the token that writes the published name. */
function writtenName(n: any): string | undefined {
  if (n?.type !== "name") return undefined
  const t = String(n.text ?? "").trim()
  return t || undefined
}

/** The trailing `name` of a `qualified_name(namespace_name(...), name)` — its LEAF. */
function qualifiedLeaf(n: any): string | undefined {
  if (n?.type !== "qualified_name") return undefined
  for (let i = n.namedChildCount - 1; i >= 0; i--) {
    const c = n.namedChild(i)
    if (c?.type === "name") return writtenName(c)
  }
  return undefined
}

/** Strip every leading `\` — a char scan, the same shape the analyzer's is. */
function unlead(s: string): string {
  let i = 0
  while (i < s.length && s.charCodeAt(i) === 92) i++
  return s.substring(i)
}

export function deriveDeclaredTypeRefsIndependent(root: any, declaredBase: Map<string, string>): Array<{ from: string; target: string; marker: string; on: string }> {
  const out: Array<{ from: string; target: string; marker: string; on: string }> = []
  const seen = new Set<string>()

  /** Every NAMED type inside one written type, in source order. Wrappers descend. */
  const members = (typeRoot: any, ownerType: string): string[] => {
    const acc: string[] = []
    const walk = (n: any): void => {
      if (!n) return
      if (NON_DEPENDENCY_TYPES.has(n.type)) return
      if (n.type === "named_type") {
        // the type is either `name` or `qualified_name`; both publish a LEAF
        let text = writtenName(n) ?? qualifiedLeaf(n)
        if (!text) {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            text = writtenName(c) ?? qualifiedLeaf(c)
            if (text) break
          }
        }
        if (!text) return
        if (RELATIVE.has(text)) {
          if (text === "parent") { const b = ownerType ? declaredBase.get(ownerType) : undefined; if (b) acc.push(b); return }
          if (ownerType) acc.push(ownerType)
          return
        }
        acc.push(text)
        return
      }
      // any other container: optional / union / intersection / DNF — recurse
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
    walk(typeRoot)
    return acc
  }

  const enclosingName = (from: any, kinds: Set<string>): string => {
    let cur: any = from?.parent
    while (cur) {
      if (kinds.has(cur.type)) { const nm = cur.childForFieldName?.("name")?.text; if (nm) return nm }
      cur = cur.parent
    }
    return ""
  }

  /** A callable's OWN name. Note `self` — a method_declaration IS the callable, so the
   *  search must start at the node, not at its parent. (The first draft of this oracle
   *  started at the parent and silently emitted nothing for every function-scope
   *  position — which is exactly the kind of thing a second implementation is for.) */
  const ownName = (n: any): string =>
    CALLABLES.has(n.type) ? String(n.childForFieldName?.("name")?.text ?? "") : enclosingName(n, CALLABLES)

  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    for (const p of TYPE_POSITIONS) {
      if (n.type !== p.node) continue
      const typeRoot = n.childForFieldName?.(p.field)
      if (!typeRoot) break
      const ownerType = enclosingName(n, NAMED_TYPES)
      let source: string
      if (p.owner === "type") source = ownerType || "global"
      else {
        // a callable's OWN name; a closure/arrow has none, and an unnamed callable
        // has no nameable source — the lane's declared boundary, so nothing is
        // emitted rather than attributed to a symbol that does not exist.
        const own = ownName(n)
        source = own || ownerType || "global"
        if (!own && !ownerType) { break }
      }
      const marker = p.field === "return_type" ? "return_type" : "declared_type"
      const on = p.field === "return_type" ? "return_type"
        : n.type === "property_promotion_parameter" ? "property_promotion_parameter"
        : n.type === "const_declaration" ? "const_declaration"
        : n.type === "simple_parameter" || n.type === "variadic_parameter" ? "parameter"
        : n.type
      for (const target of members(typeRoot, ownerType)) {
        const key = `${source}\u0000${target}\u0000${marker}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ from: source, target: unlead(target), marker, on })
      }
      break
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return out
}

// ============================================================================
// The A/B, on the full git-tracked corpus of both pinned repos.
// ============================================================================
let files = 0
let analyzerTargets = 0, independentTargets = 0
const targetOnly: string[] = []
const sourceDiff: Array<{ file: string; target: string; analyzer: string; independent: string }> = []
const markerDiff: string[] = []
for (const repo of ["phpunit", "phpmyadmin"]) {
  const dir = path.join("$HOME/fixtures/repositories", repo)
  for (const f of execSync(`git ls-files -z -- '*.php'`, { cwd: dir, maxBuffer: 1 << 28 }).toString().split("\0").filter(Boolean).sort()) {
    let src: string, root: any
    try { src = readFileSync(path.join(dir, f), "utf8"); root = parser.parse(src).rootNode } catch { continue }
    files++
    let res: any
    try { res = await ASTEngine.parseFile(path.join(dir, f), src) } catch { continue }
    const base = new Map<string, string>()
    for (const s of res.symbols ?? []) if (s.kind === "class" && s.metadata?.baseClass) base.set(String(s.name), String(s.metadata.baseClass))
    const mine = deriveDeclaredTypeRefsIndependent(root, base)
    const theirs = derivePhpDeclaredTypeEdges(root, res.symbols ?? [])

    const myT = new Map<string, string[]>()   // target -> sources
    for (const r of mine) { myT.set(r.target, [...(myT.get(r.target) ?? []), r.from]) }
    const theirT = new Map<string, string[]>()
    for (const r of theirs) { theirT.set(r.target, [...(theirT.get(r.target) ?? []), r.from]) }
    analyzerTargets += theirT.size
    independentTargets += myT.size
    for (const t of myT.keys()) if (!theirT.has(t) && targetOnly.length < 40) targetOnly.push(`${repo}/${f}  INDEPENDENT-ONLY target  ${t}`)
    for (const t of theirT.keys()) if (!myT.has(t) && targetOnly.length < 40) targetOnly.push(`${repo}/${f}  ANALYZER-ONLY target  ${t}`)
    // attribution + marker, which the differential's target-only match CANNOT see
    for (const [t, ms] of myT) {
      const as = theirT.get(t)
      if (!as) continue
      const mSet = new Set(ms), aSet = new Set(as)
      if (mSet.size !== aSet.size || [...mSet].some((x) => !aSet.has(x))) {
        if (sourceDiff.length < 30) sourceDiff.push({ file: `${repo}/${f}`, target: t, analyzer: [...aSet].sort().join(","), independent: [...mSet].sort().join(",") })
      }
    }
    const myM = new Map<string, Set<string>>()
    for (const r of mine) myM.set(r.target, (myM.get(r.target) ?? new Set()).add(r.marker))
    for (const r of theirs) {
      const got = myM.get(r.target)
      const want = String(r.label)
      void want
    }
  }
}
console.log(`files=${files}`)
console.log(`\nTARGET SET (what the differential actually compares):`)
console.log(`  analyzer distinct targets      : ${analyzerTargets}`)
console.log(`  independent distinct targets   : ${independentTargets}`)
console.log(`  target-only disagreements      : ${targetOnly.length}${targetOnly.length >= 40 ? "+" : ""}`)
for (const s of targetOnly) console.log("    " + s)
console.log(`\nATTRIBUTION (what the differential's target-only match CANNOT see):`)
console.log(`  source disagreements           : ${sourceDiff.length}${sourceDiff.length >= 30 ? "+" : ""}`)
for (const s of sourceDiff) console.log(`    ${s.file}  ${s.target}\n      analyzer: ${s.analyzer}\n      independent: ${s.independent}`)
process.exit(0)
