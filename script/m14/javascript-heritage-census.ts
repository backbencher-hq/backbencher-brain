/**
 * M14 — JAVASCRIPT HERITAGE CLAUSE CENSUS.
 *
 * ── THE QUESTION ──────────────────────────────────────────────────────────────────────────────────────
 * `src/ast/real-javascript-analyzer.ts` reads a class's supertype with
 *   `this.findChildByType(heritage, "identifier") ?? this.findChildByType(heritage, "member_expression")`
 * and `findChildByType` (:3342-3348) scans the DIRECT named children of the node it is given.
 *
 * A `class_heritage` whose value is a CALL — `class X extends Route.extend(M)` — has exactly one
 * direct named child, the `call_expression`. The `identifier` and the `member_expression` are
 * GRANDCHILDREN of it. So the analyzer's two lookups both MISS, and the class publishes NO edge for
 * its supertype at all.
 *
 * This instrument measures, over the WHOLE admitted population:
 *   (A) the shape of every `class_heritage`'s direct named child, by node type;
 *   (B) for each shape, whether the analyzer's OWN lookup pair would find a supertype name;
 *   (C) for the call-shaped clauses: the callee's shape, the callee member's property name, and the
 *       shapes of the call's arguments — the facts a `mixes_in` rule has to key on;
 *   (D) the same for the PARENTHESIZED shape, because `extends (Base)` has the same structural
 *       problem and the same fix.
 *
 * THE GRAMMAR IS THE PRODUCTION BUILD — the bytes the registry serves (`wasm/tree-sitter-javascript.wasm`),
 * NOT the npm package's, and NOT `node-types.json` (a different artifact) — and its identity is
 * printed by sha256 (L-20).
 *
 *   bun run script/m14/javascript-heritage-census.ts [--corpus=<dir>]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"

const ROOT = process.cwd()
const arg = (n: string, d: string) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const CORPUS = path.resolve(arg("corpus", path.join(ROOT, ".corpus")))
const OUT = path.join(ROOT, "validation/m14/measurements/javascript-heritage-census.json")

const wts: any = await import("web-tree-sitter")
await (wts.Parser ?? wts.default).init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const P = wts.Parser ?? wts.default
const L = wts.Language ?? wts.default?.Language

const PRODUCTION_WASM = path.join(ROOT, "wasm/tree-sitter-javascript.wasm")
const wasmBytes = readFileSync(PRODUCTION_WASM)
const lang = await L.load(wasmBytes)
const parser = new P()
parser.setLanguage(lang)

/** THE ANALYZER'S OWN LOOKUP PAIR, reproduced exactly (`findChildByType` scans DIRECT named children). */
function analyzerSupertype(heritage: any): { found: string | null; shape: string } {
  const direct = (t: string): any => {
    for (let i = 0; i < heritage.namedChildCount; i++) {
      const c = heritage.namedChild(i)
      if (c && c.type === t) return c
    }
    return null
  }
  const id = direct("identifier")
  if (id) return { found: id.text, shape: "identifier" }
  const me = direct("member_expression")
  if (me) {
    const obj = me.childForFieldName("object")
    const prop = me.childForFieldName("property")
    return { found: prop ? prop.text : null, shape: "member_expression" }
  }
  return { found: null, shape: "NONE" }
}

const EXTS = [".js", ".mjs", ".cjs", ".jsx"]
const admitted: string[] = []
{
  const repos = execFileSync("ls", ["-1", CORPUS], { encoding: "utf8" }).split("\n").filter(Boolean).sort()
  for (const name of repos) {
    const dir = path.join(CORPUS, name)
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      if (!EXTS.some((x) => rel.toLowerCase().endsWith(x))) continue
      const abs = path.join(dir, rel)
      try {
        if (readFileSync(abs).length > 1024 * 1024) continue
      } catch {
        continue
      }
      admitted.push(abs)
    }
  }
}
console.log(`admitted ${admitted.length} files under ${CORPUS}`)

const shapeCounts: Record<string, number> = {}
const analyzerFinds: Record<string, { total: number; found: number }> = {}
const callDetails: Record<string, number> = {}
const argShapes: Record<string, number> = {}
const parenthesizedSamples: string[] = []
const callSamples: string[] = []
// THE INNER SHAPE OF A PARENTHESIZED HERITAGE — `extends (Base)` names a base; `extends (f(x))`
// does not. The inner shape decides whether the parenthesized clause is a recoverable supertype.
const parenInner: Record<string, number> = {}
const parenInnerPlain: string[] = []
// THE RECEIVER OF A CALL-SHAPED HERITAGE — `Route.extend(M)` has a receiver that names the base;
// `MixinFn(Base)` has none.
const callReceiver: Record<string, number> = {}
// THE ARGUMENTS OF A CALL-SHAPED HERITAGE, split by whether the argument names a base (an
// identifier) or computes one.
const callArgKinds: Record<string, number> = {}
// THE CALLEE TEXT AND ARITY of every call-shaped heritage — the two facts that separate a
// LIBRARY mixin factory (`ValidationMixin(Core)`, one argument) from TypeScript's EMITTED
// `__extends` helper (`lr(Vn,Mn)`, two arguments, a local minified callee).
const callCalleeText: Record<string, number> = {}
const callArity: Record<string, number> = {}
// THE FILE REPO DISTRIBUTION of each shape — the 726 parenthesized are expected to be ONE
// bundle, and a bundle is a different population fact from a spread of hand-written sources.
const shapeFiles: Record<string, Set<string>> = {}
const shapeRepos: Record<string, Set<string>> = {}
const repoOf = (f: string): string => {
  const rel = path.relative(CORPUS, f)
  return rel.split(path.sep)[0] ?? "?"
}
let heritageClauses = 0
let filesWithHeritage = 0

for (const f of admitted) {
  let src: string
  try {
    src = readFileSync(f, "utf8")
  } catch {
    continue
  }
  let t: any
  try {
    t = parser.parse(src)
  } catch {
    continue
  }
  let sawHeritage = false
  const stack = [t.rootNode]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "class_heritage") {
      sawHeritage = true
      heritageClauses++
      // the heritage's DIRECT named children, by type
      const childTypes: string[] = []
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) childTypes.push(c.type)
      }
      const shape = childTypes.length === 0 ? "EMPTY" : childTypes.join("+")
      shapeCounts[shape] = (shapeCounts[shape] ?? 0) + 1

      const sup = analyzerSupertype(n)
      const bucket = (analyzerFinds[shape] ??= { total: 0, found: 0 })
      bucket.total++
      if (sup.found) bucket.found++

      if (shape.includes("parenthesized_expression")) {
        const par = n.namedChildren.find((c: any) => c.type === "parenthesized_expression")
        if (par) {
          let inner = "EMPTY"
          for (let i = 0; i < par.namedChildCount; i++) {
            const c = par.namedChild(i)
            if (c) {
              inner = c.type
              break
            }
          }
          parenInner[inner] = (parenInner[inner] ?? 0) + 1
          // A plain identifier or member_expression inside the parens NAMES a base.
          if ((inner === "identifier" || inner === "member_expression") && parenthesizedSamples.length < 12) {
            parenthesizedSamples.push(`${path.relative(ROOT, f)} :: ${n.text.replace(/\s+/g, " ").slice(0, 100)} :: inner=${inner}`)
          }
        }
      }
      if (shape.includes("call_expression")) {
        const call = n.namedChildren.find((c: any) => c.type === "call_expression")
        if (call) {
          const fn = call.childForFieldName("function")
          const fnShape = fn ? fn.type : "NONE"
          let propName = "-"
          if (fn && fn.type === "member_expression") {
            const p = fn.childForFieldName("property")
            propName = p ? p.text : "-"
          } else if (fn) {
            propName = fn.text
          }
          callDetails[`${fnShape}/${propName}`] = (callDetails[`${fnShape}/${propName}`] ?? 0) + 1
          // THE RECEIVER — the object of the member call, which is the BASE in `Base.extend(M)`.
          let recv = "NONE"
          if (fn && fn.type === "member_expression") {
            const obj = fn.childForFieldName("object")
            recv = obj ? obj.type : "NONE"
          }
          callReceiver[`${fnShape}/${propName} :: receiver=${recv}`] =
            (callReceiver[`${fnShape}/${propName} :: receiver=${recv}`] ?? 0) + 1
          let nArgs = 0
          for (let i = 0; i < call.namedChildCount; i++) {
            const c = call.namedChild(i)
            if (c && c.type === "arguments") {
              for (let j = 0; j < c.namedChildCount; j++) {
                const a = c.namedChild(j)
                if (a) {
                  nArgs++
                  argShapes[a.type] = (argShapes[a.type] ?? 0) + 1
                  // THE ARGUMENT'S ROLE: an identifier argument NAMES something (a mixin, in the
                  // `Base.extend(M)` idiom); a call argument COMPUTES one.
                  const kind = a.type === "identifier" ? "names(a-mixin?)" : a.type === "call_expression" ? "computes" : a.type
                  callArgKinds[`${fnShape}/${propName} :: ${kind}`] = (callArgKinds[`${fnShape}/${propName} :: ${kind}`] ?? 0) + 1
                }
              }
            }
          }
          if (callSamples.length < 12) {
            const cls = n.parent?.childForFieldName?.("name")?.text ?? "?"
            callSamples.push(`${path.relative(ROOT, f)} :: ${cls} :: ${n.text.replace(/\s+/g, " ").slice(0, 120)} :: args=${nArgs}`)
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  if (sawHeritage) filesWithHeritage++
  t.delete?.()
}

console.log(`\nheritage clauses: ${heritageClauses} across ${filesWithHeritage} files`)
console.log(`\n(A) the DIRECT named children of every class_heritage:`)
for (const [k, v] of Object.entries(shapeCounts).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`)
console.log(`\n(B) DOES THE ANALYZER'S OWN LOOKUP PAIR FIND A SUPERTYPE?`)
for (const [k, v] of Object.entries(analyzerFinds).sort((a, b) => b[1].total - a[1].total)) {
  console.log(`  ${k}: found ${v.found} of ${v.total}  ⇒ ${v.found === v.total ? "OK" : "MISSES " + (v.total - v.found)}`)
}
console.log(`\n(C) the call-shaped clauses, by callee shape / member name:`)
for (const [k, v] of Object.entries(callDetails).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`)
console.log(`\n(C) the RECEIVER of each call-shaped clause:`)
for (const [k, v] of Object.entries(callReceiver).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`)
console.log(`\n(C) the ARGUMENT shapes of those calls:`)
for (const [k, v] of Object.entries(argShapes).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`)
console.log(`\n(C) the ARGUMENT's ROLE:`)
for (const [k, v] of Object.entries(callArgKinds).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`)
console.log(`\n(D) the INNER shape of a parenthesized heritage:`)
for (const [k, v] of Object.entries(parenInner).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`)
console.log(`\n  samples (parenthesized whose inner NAMES a base):`)
for (const s of parenthesizedSamples) console.log(`   ${s}`)
console.log(`\n  samples (call-shaped):`)
for (const s of callSamples) console.log(`   ${s}`)

const out = {
  generated: new Date().toISOString(),
  grammar: {
    wasm: "wasm/tree-sitter-javascript.wasm",
    sha256: createHash("sha256").update(wasmBytes).digest("hex"),
    bytes: wasmBytes.length,
    citationRule: "L-20: a grammar citation is the sha256 of the bytes the REGISTRY SERVES, never a path and never a log line.",
  },
  population: { admittedFiles: admitted.length, filesWithHeritage, heritageClauses },
  heritageDirectChildShapes: shapeCounts,
  analyzerLookupResult: analyzerFinds,
  callCalleeShapes: callDetails,
  callReceiverShapes: callReceiver,
  callArgumentShapes: argShapes,
  callArgumentRoles: callArgKinds,
  parenthesizedInnerShapes: parenInner,
  samples: { calls: callSamples, parenthesized: parenthesizedSamples },
}
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")
console.log(`\nwrote ${path.relative(ROOT, OUT)}`)
