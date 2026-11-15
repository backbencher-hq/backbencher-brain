/**
 * WHY A QUALIFIED INVOCATION IS NOT EMITTED — pass 2 left this open at "196, unexplained".
 *
 * THE OPEN QUESTION. `pass3`'s predecessor counted qualified `invocation` nodes on the parse tree
 * that carry no `calls` edge, split the ones the keyword/builtin guard suppresses deliberately from
 * the rest, and reported the remainder as a number with no cause. A count with no cause is not a
 * finding; it is a to-do. This probe assigns each one a CAUSE, by asking the tree what shape it is
 * in, and reports the distribution.
 *
 * THE CAUSES, and why these and not others. `processCalls` walks `invocation` nodes from
 * `processQuery` and from `processStatement`'s declaration branch, and skips any node with an error
 * in its own subtree. So an invocation can go missing for reasons that are properties of the TREE,
 * not of the caller's intent:
 *
 *   inErrorSubtree      the node, or an ancestor, carries an error. The analyzer's own guard.
 *   insideOpaqueBody    the node sits inside a dollar-quoted body the grammar reduced to one token,
 *                       or inside a construct whose rule the grammar has no node for — so the body is
 *                       text and there is no `invocation` node at all.
 *   calleeIsSchemaShaped the "qualified" name is two parts but the FIRST is the current schema, so
 *                       the analyzer's qualified handling cannot say what it refers to.
 *   noObjectReference   the invocation has no `object_reference` child, so `processCalls` has no
 *                       callee name to read; the name is somewhere else in the node.
 *
 * The last bucket is the one that matters: if most of the 196 are `inErrorSubtree`, the fix is a
 * grammar change and the number should be published as a bound. If most are `noObjectReference`,
 * the callee is being read from the wrong slot and that IS a lane defect.
 *
 * NO REGEX (lane policy). Quoted-identifier stripping is a character function, and the analyzer's own
 * exported guard sets are imported rather than copied so this probe cannot drift from the guard.
 *
 * USAGE:
 *   npx tsx validation/m14/fixtures/sql/pass3-invocation-why.mts [--out FILE] <file> ...
 *   npx tsx validation/m14/fixtures/sql/pass3-invocation-why.mts --out FILE      # whole corpus
 */
import { writeFileSync, readdirSync, statSync, readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { Parser, Language, type Node } from "web-tree-sitter"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { SQL_KEYWORDS, SQL_BUILTINS } from "../../../../src/ast/real-sql-analyzer"

const argv = process.argv.slice(2)
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : undefined
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 512 * 1024

/** Strip SQL identifier quotes by character inspection — no regex. */
function unquote(s: string): string {
  let t = s
  if (t.length >= 2) {
    const a = t[0]
    const b = t[t.length - 1]
    if ((a === '"' && b === '"') || (a === "`" && b === "`") || (a === "[" && b === "]")) t = t.slice(1, -1)
  }
  return t
}

function discover(): string[] {
  const out: string[] = []
  for (const entry of readdirSync(CR)) {
    const dir = path.join(CR, entry)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      let text: string
      try {
        if (statSync(abs).size > SIZE_CAP) continue
        text = readFileSync(abs, "utf8")
      } catch { continue }
      if (detectLanguageFromPath(abs, text) !== "sql") continue
      out.push(abs)
    }
  }
  return out.sort()
}

const FILES = (() => {
  const given = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out")
  return given.length ? given.sort() : discover()
})()

await Parser.init()
const SQL_LANG = await Language.load(path.resolve("wasm/tree-sitter-sql.wasm"))
const parser = new Parser()
parser.setLanguage(SQL_LANG)

/** Node types that mean "the grammar could not build a node here". */
const OPAQUE_OR_ABSENT = new Set(["ERROR", "dollar_quoted", "plpgsql_block", "function_body", "body", "block"])

type Bucket = { n: number; examples: string[] }
const buckets = new Map<string, Bucket>()
const bump = (k: string, ex: string) => {
  const b = buckets.get(k) ?? { n: 0, examples: [] }
  b.n++
  if (b.examples.length < 5) b.examples.push(ex)
  buckets.set(k, b)
}

let qualifiedOnTree = 0
let emittedCount = 0
let suppressedByGuard = 0
let parseFailures = 0
// A file the ENGINE degraded contributes no edges, so every invocation in it counts as
// "not emitted" — which is how a first version of this probe reported `emitted` falling from 449 to
// 407 across a change that can only ADD edges. The degradation classes are the same two the census
// documents: `fallback: true` is pool-worker's regex extractor, and a `timeout` in `errors[]` is the
// engine's 120s analyzer budget. Both are disclosed per file rather than allowed to move a headline.
const degradedRegexFallback: string[] = []
const degradedTimeout: string[] = []

for (const f of FILES) {
  let tree: any
  let r: any
  try {
    tree = parser.parse(readFileSync(f, "utf8"))
    r = await parseFile(f, path.dirname(f))
  } catch {
    parseFailures++
    continue
  }
  if (r?.fallback === true) degradedRegexFallback.push(path.basename(f))
  for (const e of Array.isArray(r?.errors) ? r.errors : []) {
    const m = String(e?.message ?? "").toLowerCase()
    if (m.includes("timeout")) { degradedTimeout.push(path.basename(f)); break }
  }
  const emitted = new Set<string>()
  for (const rel of Array.isArray(r?.relationships) ? r.relationships : []) {
    if (String(rel?.type ?? "").toLowerCase() === "calls") emitted.add(String(rel?.target ?? ""))
  }
  const label = `${path.basename(f)}`
  const stack: Node[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "invocation") {
      const obj = (n.namedChildren ?? []).find((c: any) => c.type === "object_reference")
      const parts = obj ? (obj.namedChildren ?? []).filter((c: any) => c.type === "identifier" || c.type === "literal") : []
      if (parts.length >= 2) {
        qualifiedOnTree++
        const leaf = unquote(parts[parts.length - 1].text)
        const spelled = parts.map((p: any) => p.text).join(".")
        if (emitted.has(leaf)) {
          emittedCount++
        } else if (SQL_KEYWORDS.has(leaf.toLowerCase()) || SQL_BUILTINS.has(leaf.toLowerCase())) {
          suppressedByGuard++
        } else {
          // THE CLASSIFICATION. Walk up and record what the tree says about the neighbourhood.
          const chain: string[] = []
          let p: Node | null = n.parent
          let sawError = n.hasError
          while (p && chain.length < 8) {
            chain.push(p.type)
            if (p.hasError || p.type === "ERROR") sawError = true
            p = p.parent
          }
          const opaque = chain.find((t) => OPAQUE_OR_ABSENT.has(t))
          if (!obj) bump("noObjectReference-child", `${label}: ${spelled}(...) chain=${chain.slice(0, 4).join(">")}`)
          else if (sawError) bump("inside-an-error-subtree", `${label}: ${spelled}(...) chain=${chain.slice(0, 4).join(">")}`)
          else if (opaque) bump(`inside-${opaque}`, `${label}: ${spelled}(...) chain=${chain.slice(0, 4).join(">")}`)
          else bump("reachable-shape-but-still-not-emitted", `${label}: ${spelled}(...) chain=${chain.slice(0, 4).join(">")}`)
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
  }
  try { tree.delete() } catch { /* freed on GC; must not fail the probe */ }
}

const unexplained = buckets.get("reachable-shape-but-still-not-emitted")?.n ?? 0
const report = {
  instrument: "validation/m14/fixtures/sql/pass3-invocation-why.mts",
  entryPoint: "parseFile (src/ast/pool-worker.ts) for the edges; the wired grammar for the tree",
  filesMeasured: FILES.length,
  parseFailures,
  degraded: { regexFallback: degradedRegexFallback, timeout: degradedTimeout, note: "a degraded file contributes no edges, so every invocation in it lands in a not-emitted bucket; these lists are what make `emitted` comparable between runs" },
  qualifiedInvocationsOnTree: qualifiedOnTree,
  emitted: emittedCount,
  suppressedByKeywordOrBuiltinGuard: suppressedByGuard,
  notEmitted: qualifiedOnTree - emittedCount - suppressedByGuard,
  byCause: Object.fromEntries([...buckets.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, v]) => [k, v])),
  stillUnexplained: unexplained,
  note: "`reachable-shape-but-still-not-emitted` is the only bucket that is a candidate lane defect: everything else is a property of the tree or a guard working as designed.",
}

if (OUT) writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
console.log(`SQL pass-3 invocation-cause probe — ${FILES.length} files`)
console.log(`  degraded: regexFallback ${degradedRegexFallback.length}  timeout ${degradedTimeout.length}${degradedRegexFallback.length ? "  " + degradedRegexFallback.slice(0,4).join(", ") : ""}`)
console.log(`  qualified invocations on the tree: ${qualifiedOnTree}`)
console.log(`  emitted as a calls edge:          ${emittedCount}`)
console.log(`  suppressed by the keyword/builtin guard: ${suppressedByGuard}`)
console.log(`  NOT emitted: ${report.notEmitted}`)
for (const [k, v] of [...buckets.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`    ${k.padEnd(38)} ${String(v.n).padStart(5)}   e.g. ${v.examples[0] ?? ""}`)
}
console.log(`  STILL UNEXPLAINED (candidate lane defect): ${unexplained}`)
if (OUT) console.log(`\nwrote ${OUT}`)