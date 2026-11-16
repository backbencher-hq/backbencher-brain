/**
 * JAVASCRIPT SOURCE-ATTRIBUTION CENSUS — does an edge name the callable its own site sits in?
 *
 * WHY THIS GAP EXISTS. The lane measures targets heavily (the R7 census: 70,157 rows, 0 invalid
 * endpoints) and sources only for the NULL class (`verify-js-source-attribution.ts` asserts the
 * outgoing classification of rows whose source did not resolve). But `script/m14/differential.ts`
 * matches on `label + normTarget` and **never on source** — its own header says so. A row whose
 * TARGET is right and whose SOURCE names the wrong symbol is therefore invisible to every instrument
 * this lane owns. This closes that gap.
 *
 * THE RULE IT CHECKS IS THE ANALYZER'S OWN, replayed from the grammar rather than restated.
 * `extractCallRelationships.resolveCurrent` sets the row's actor as the walk descends:
 *
 *   function_declaration / generator_function_declaration / method_definition /
 *   function_expression with a name            -> that name
 *   variable_declarator whose value is an arrow/function and whose name is an identifier
 *                                              -> that identifier (a LOCAL callable)
 *   class_declaration                          -> the class name (static blocks, field inits)
 *   X.prototype.m = function () {}             -> `m`
 *   otherwise                                  -> unchanged, and at module level `moduleName`
 *
 * The `uses` walk uses `method || owner || moduleName`, so an ENCLOSING CLASS is also a legitimate
 * source there. This instrument derives, per LINE, the set of names that rule could produce at that
 * line and asks whether the published source is in it. It does not re-decide the rule; it replays it.
 *
 * WHAT THIS DELIBERATELY DOES NOT CALL A DEFECT:
 *   - a source that is a LOCAL callable the symbol table does not publish (`const f = () => …` inside
 *     a method). The analyzer names the declarator and that name is not a symbol. Attributed.
 *   - `overrides` sources, which are `Owner.member` by the lane's documented contract.
 *
 * A NOTE ON ITS OWN FIRST VERSION, because the corrections are the substance. The first cut compared
 * against the INNERMOST SYMBOL SPAN and produced 676 "unattributed" rows on svelte (20.7%) — every one
 * of them the module name on a line that happened to fall inside a top-level `const`'s span, or a
 * local arrow function the symbol table does not carry. Both are the analyzer being right and the
 * instrument being wrong: a `const UNKNOWN = Symbol('unknown')` at line 19 is a MODULE-LEVEL call, and
 * a `const SvelteFragment = (node, …) => {…}` inside `create_scopes` is a LOCAL CALLABLE the walk
 * legitimately names. Replaying the analyzer's own rule instead of inventing a symbol-proximity test
 * is what made those rows attribute.
 *
 * READ-ONLY. Writes one artifact under validation/m14/tmp/.
 *
 *   bun run script/m14/javascript-source-attribution-census.ts --repo=<dir> [--sample=120]
 *                                                            [--examples=25] [--json=<out>]
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { ASTEngine, getParser } from "../../src/ast/engine"

const SIZE_CAP = 512 * 1024

function argOf(flag: string): string | null {
  const argv = process.argv.slice(2)
  const i = argv.indexOf(flag)
  if (i >= 0) return argv[i + 1] ?? null
  const hit = argv.find((a) => a.startsWith(flag + "="))
  return hit ? hit.slice(flag.length + 1) : null
}

const REPO = argOf("--repo") ?? "<corpus-root>/bb_tests/repositories/svelte"
if (!existsSync(REPO)) {
  console.error(`source-attribution: corpus not found at ${REPO} (pass --repo=<dir>)`)
  process.exit(2)
}
const SAMPLE = Number(argOf("--sample") ?? 120)
const EXAMPLE_CAP = Number(argOf("--examples") ?? 25)
const JSON_OUT = argOf("--json")

/** THE ANALYZER'S OWN RULE, verbatim in behaviour: the name `resolveCurrent` would answer with. */
function currentNameAt(n: any, current: string | null): string | null {
  const fnName = n.childForFieldName?.("name")?.text
  if (
    (n.type === "function_declaration" || n.type === "generator_function_declaration" ||
      n.type === "method_definition" || n.type === "function_expression") &&
    fnName
  ) {
    return fnName
  }
  if (n.type === "variable_declarator") {
    const nameNode = n.childForFieldName("name")
    const valueNode = n.childForFieldName("value")
    if (nameNode && nameNode.type === "identifier" &&
      valueNode && (valueNode.type === "arrow_function" || valueNode.type === "function_expression")) {
      return nameNode.text
    }
  }
  if (n.type === "class_declaration") {
    const nm = n.childForFieldName("name")?.text
    if (nm) return nm
  }
  if (n.type === "assignment_expression") {
    const left = n.childForFieldName("left")
    const right = n.childForFieldName("right")
    if (left && right &&
      (right.type === "function_expression" || right.type === "arrow_function") &&
      left.type === "member_expression") {
      const obj = left.childForFieldName("object")
      const prop = left.childForFieldName("property")
      if (obj && obj.type === "member_expression") {
        const protoProp = obj.childForFieldName("property")
        if (protoProp && protoProp.text === "prototype" && prop) return prop.text
      }
    }
  }
  return current
}

/**
 * THE `owner` HALF OF `method || owner || moduleName`: `containerOwnerName` in the analyzer names an
 * object literal or class EXPRESSION by the BINDING it is initialised to (`const binary = { … }` ->
 * `binary`, `SvelteElement = class extends HTMLElement {…}` -> `SvelteElement`). A property arrow
 * inside that literal therefore emits rows sourced `binary`, which no name-only walk over function
 * declarations can predict. This replays that rule.
 */
function containerBindingAt(n: any): string | null {
  for (let p = n.parent; p; p = p.parent) {
    if (p.type === "object" || p.type === "class") {
      // the binding is the pattern of the declarator / assignment holding this literal
      for (let q = p.parent; q; q = q.parent) {
        if (q.type === "variable_declarator") {
          const nm = q.childForFieldName("name")
          return nm && nm.type === "identifier" ? nm.text : null
        }
        if (q.type === "assignment_expression") {
          const left = q.childForFieldName("left")
          if (left && left.type === "identifier") return left.text
          if (left && left.type === "member_expression") {
            const prop = left.childForFieldName("property")
            return prop ? prop.text : null
          }
          return null
        }
        if (q.type === "pair" || q.type === "pair_pattern") return null
        if (q.type === "function_declaration" || q.type === "function_expression" ||
            q.type === "arrow_function" || q.type === "method_definition" ||
            q.type === "return_statement" || q.type === "call_expression" ||
            q.type === "array" || q.type === "program") return null
      }
      return null
    }
    if (p.type === "function_declaration" || p.type === "function_expression" ||
        p.type === "generator_function_declaration" || p.type === "generator_function") return null
  }
  return null
}

/** the enclosing class DECLARATION's name, for the `uses` walk's `method || owner || moduleName` */
function enclosingOwnerClass(n: any): string | null {
  for (let p = n.parent; p; p = p.parent) {
    if (p.type === "class_declaration") return p.childForFieldName("name")?.text ?? null
    if (p.type === "function_declaration" || p.type === "function_expression" ||
        p.type === "generator_function_declaration" || p.type === "generator_function") return null
  }
  return null
}

const tracked: string[] = execFileSync("git", ["-C", REPO, "ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 512 * 1024 * 1024,
}).split("\0").filter(Boolean)

const admitted: string[] = []
for (const rel of tracked) {
  const abs = path.join(REPO, rel)
  try {
    if (statSync(abs).size > SIZE_CAP) continue
    if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "javascript") continue
  } catch {
    continue
  }
  admitted.push(rel)
}
admitted.sort()
const stride = Math.max(1, Math.floor(admitted.length / SAMPLE))
const sample: string[] = []
for (let i = 0; i < admitted.length && sample.length < SAMPLE; i += stride) sample.push(admitted[i])

const parser = await getParser("javascript")

const counts = {
  files: 0,
  rows: 0,
  withLine: 0,
  attributed: 0,
  attributedModule: 0,
  attributedLocalCallable: 0,
  /** rows in labels this census does not cover, named rather than silently dropped */
  outOfScope: 0,
  /** the only real class this census reports */
  unattributed: 0,
}
const examples: Array<Record<string, unknown>> = []

for (const rel of sample) {
  let src: string
  try {
    src = readFileSync(path.join(REPO, rel), "utf8")
  } catch {
    continue
  }
  let root: any
  try {
    root = parser.parse(src)?.rootNode
  } catch {
    continue
  }
  if (!root || root.hasError) continue
  counts.files++

  const moduleName = path.basename(rel, path.extname(rel))

  // ── REPLAY resolveCurrent OVER THE TREE: line -> the names a row's actor may legitimately be.
  const expectedAtLine = new Map<number, Set<string>>()
  const localsAtLine = new Map<number, Set<string>>()
  const add = (map: Map<number, Set<string>>, line: number, name: string): void => {
    const set = map.get(line) ?? new Set<string>()
    set.add(name)
    map.set(line, set)
  }
  {
    const stack: Array<{ node: any; current: string | null }> = [{ node: root, current: null }]
    while (stack.length > 0) {
      const item = stack.pop()!
      const current = currentNameAt(item.node, item.current)
      const line = item.node.startPosition.row + 1
      // the actor a row emitted at this node carries: the current callable, or the module at top level
      add(expectedAtLine, line, current ?? moduleName)
      // the `uses` walk also accepts the enclosing class
      const owner = enclosingOwnerClass(item.node)
      if (owner) add(expectedAtLine, line, owner)
      const containerBinding = containerBindingAt(item.node)
      if (containerBinding) add(expectedAtLine, line, containerBinding)
      // A NAMED CLASS EXPRESSION'S HERITAGE READ is sourced to the class's OWN name, and the
      // analyzer says so explicitly where it emits the edge (`ownName = node.childForFieldName
      // ("name")?.text ?? bindingNameAbove(node)`). Measured: `TokenVerificationError: class
      // TokenVerificationError extends Error {}` in an object literal emits `uses
      // TokenVerificationError -> Error`, whose source is neither the module nor the object's
      // binding — it is the class's own name. Added at the class's START LINE only, which is where
      // the heritage lives, so a member read deeper in the body is not laundered by this arm.
      if (item.node.type === "class") {
        const ownName = item.node.childForFieldName("name")?.text
        if (ownName) add(expectedAtLine, line, ownName)
      }
      // a LOCAL callable is a name the symbol table does not publish but the walk still names
      if (current !== null && current !== moduleName) add(localsAtLine, line, current)
      for (let i = item.node.namedChildCount - 1; i >= 0; i--) {
        const c = item.node.namedChild(i)
        if (c) stack.push({ node: c, current })
      }
    }
  }

  let res: any
  try {
    res = await ASTEngine.parseFile(path.join(REPO, rel), src)
  } catch {
    continue
  }

  for (const r of res.relationships ?? []) {
    const label = String(r.type ?? "")
    if (label === "") continue
    // SCOPE, DECLARED RATHER THAN ASSUMED. This instrument replays the rule of the two WALKS that
    // attach a callable source: `resolveCurrent` (calls) and `method || owner || moduleName` (uses).
    // `contains` is emitted by the containment pass, whose source is the member's OWNER by a
    // different rule (`X.prototype.m = function(){}` -> `X`), and the lane already gates that family
    // with `census-js-containment-contract`. Judging `contains` here would report the correct
    // prototype rule as a defect — measured: all 14 residual lodash rows were
    // `Ut.prototype[n] = function(){}`, `TestClass.prototype.assertTrue = function(){}` and
    // `Date.prototype.toJSON = function(){}`, every one of which is the documented behaviour.
    if (label !== "calls" && label !== "uses") {
      counts.outOfScope++
      continue
    }
    counts.rows++
    const ln = r.line_number
    const source = String(r.source ?? "")
    if (typeof ln !== "number" || ln <= 0) continue
    counts.withLine++

    // `(file)` IS A DOCUMENTED MODULE-LEVEL ACTOR, not a symbol: an `exports` row is the module's
    // own public surface and is sourced `(file)` by the family sentinel. Measured: without this
    // allowance all 176 remaining "unattributed" rows on svelte were `exports -> (file)`.
    if (source === "(file)") {
      counts.attributedModule++
      counts.attributed++
      continue
    }

    // A LOCAL-BINDING CLAIM IS SELF-CONSISTENT BY CONSTRUCTION: the row spells
    // `<callable>\0<binding>` and the store verifies the pair with its own `bindOK` challenge
    // (`javascript-local-binding-contract.md`) instead of resolving the source as a symbol name. When
    // the target begins with `source + BINDING_SEP`, the source IS the claim's subject — no name
    // lookup applies, so it is not a mis-attribution.
    const BINDING_SEP = "\u0000"
    if (String(r.target ?? "").startsWith(`${source}${BINDING_SEP}`)) {
      counts.attributedLocalCallable++
      counts.attributed++
      continue
    }

    const expected = expectedAtLine.get(ln)
    if (expected && expected.has(source)) {
      counts.attributed++
      if (source === moduleName) counts.attributedModule++
      continue
    }

    // a local callable named on this line: a legitimate actor of the enclosing site, and not a symbol
    // the store could verify either way
    const locals = localsAtLine.get(ln)
    if (locals && locals.has(source)) {
      counts.attributedLocalCallable++
      continue
    }

    counts.unattributed++
    if (examples.length < EXAMPLE_CAP) {
      examples.push({
        file: rel,
        line: ln,
        label,
        source,
        expected: expected ? [...expected].slice(0, 6) : null,
        why: expected
          ? "source is not one of the names the analyzer's own rule can produce at this line"
          : "no tree node starts on this line, so the row cannot be attributed by line",
      })
    }
  }
}

const pct = counts.withLine > 0 ? (100 * counts.unattributed) / counts.withLine : 0
console.log(`source-attribution census — ${path.basename(REPO)}`)
console.log(`  admitted ${admitted.length}   sampled ${sample.length}   parsed ${counts.files}`)
console.log(`  rows (calls+uses) ${counts.rows}   with a line ${counts.withLine}`)
console.log(`  out of scope (other labels, e.g. contains) ${counts.outOfScope}`)
console.log(`  attributed (rule)             ${counts.attributed}`)
console.log(`    of which module level       ${counts.attributedModule}`)
console.log(`  attributed (local callable)   ${counts.attributedLocalCallable}`)
console.log(`  UNATTRIBUTED                  ${counts.unattributed}   (${pct.toFixed(2)}%)`)
if (examples.length > 0) {
  console.log(`\n  examples (${examples.length} of ${EXAMPLE_CAP} max):`)
  for (const e of examples) console.log(`    ${JSON.stringify(e)}`)
}

if (JSON_OUT) {
  mkdirSync(path.dirname(JSON_OUT), { recursive: true })
  writeFileSync(
    JSON_OUT,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        repo: REPO,
        admittedFiles: admitted.length,
        sampledFiles: sample.length,
        parseCleanFiles: counts.files,
        totals: counts,
        note:
          "Checks the one dimension no other instrument covers: the differential matches label + normTarget and never source, and verify-js-source-attribution.ts asserts only NULL sources. Expected sources are REPLAYED from the analyzer's own resolveCurrent rule over the tree (function names, method names, local `const f = () =>` declarators, class names for static blocks/field inits, X.prototype.m, the enclosing class for the uses walk, and the module name at top level).",
        examples,
      },
      null,
      2,
    ),
  )
  console.log(`  artifact: ${JSON_OUT}`)
}