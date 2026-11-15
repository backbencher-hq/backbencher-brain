// CLJ-DEEP · INSTRUMENT 8 — the DEFINITION-FORM CENSUS.
//
// THE DEFECT THIS FOUND. `uses`/`contains` had no oracle for three waves, so no
// gate could see that `defcurried` — a real `clojure.core` macro that defines a
// var — was unhandled. All 8 of its top-level definitions in clojure/core/reducers.clj
// produced NO symbol, NO `contains` edge and NO export. The F1 node-type census
// could not see it either, because `(defcurried map …)` parses as an ordinary
// `list_lit`: the form is a CALL until the analyzer decides otherwise, so an
// unrecognized def form is invisible to a census of node TYPES. It is only
// visible to a census of top-level HEADS.
//
// So this instrument enumerates every head that appears in top-level `def`
// position across the whole corpus and diffs it against the forms the analyzer
// actually dispatches on. The residual is the CLASS of definition forms that
// define a name the analyzer never records — a missed symbol, a missed
// containment and a missed export in one row, on every occurrence.
//
// AST is not needed for this one: the question is about the TEXTUAL shape of a
// top-level head, so this is a line scan of column-0 `(` forms. That is a
// deliberate exception, and it is scoped to lines that begin at column 0 — the
// one position where "top level" is unambiguous without a parse. The analyzer
// itself stays regex-free; this is a census of the corpus, not of the analyzer.
//
//   --repos=clojure,clj-kondo,core.async   scope
//   --out=<path>                           where to write the JSON
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const argOf = (f: string): string | undefined => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined }

function listFiles(repo: string): string[] {
  const dir = path.join(CORPUS_ROOT, repo)
  if (!existsSync(dir)) return []
  let tracked: string[] = []
  try { tracked = execSync(`git -C ${JSON.stringify(dir)} ls-files`, { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean) } catch { tracked = [] }
  if (tracked.length === 0) {
    const walk = (d: string, acc: string[] = []): string[] => {
      for (const e of readdirSync(d)) {
        if (e === ".git" || e === "target" || e === "node_modules") continue
        const p = path.join(d, e); const st = statSync(p)
        if (st.isDirectory()) walk(p, acc); else if (/\.(clj|cljc|cljs)$/i.test(e)) acc.push(p)
      }
      return acc
    }
    return walk(dir).sort()
  }
  return tracked.filter(f => /\.(clj|cljc|cljs)$/i.test(f)).map(f => path.join(dir, f)).sort()
}

// The heads the analyzer dispatches a DEFINITION for. Read off the dispatch
// chain in real-clojure-analyzer.ts; anything a `def`-position head can be and
// is not here defines a name the analyzer never records.
const HANDLED = new Set([
  "def", "defn", "defn-", "defmacro", "defonce", "deftest", "defprotocol", "defrecord",
  "deftype", "definterface", "defmulti", "defmethod", "defstruct", "declare",
  // spec forms (the analyzer routes these to a spec symbol, not a plain def)
  "s/def", "fdef", "defrecord+", "spec/def",
  // not definitions, but they legitimately appear in def position and the
  // analyzer handles them explicitly, so they are not residual
  "alter-var-root", "def-alias", "intern", "ns", "in-ns", "extend-type", "extend-protocol", "reify", "proxy",
])

// Does this head DEFINE a name? A head that starts with `def` is a definition
// form by Clojure's own naming, whatever we have or have not implemented — which
// is exactly the point: the class is "a def-prefixed form we do not handle", and
// it is detectable from the head alone, before anyone decides the semantics.
function isDefLike(head: string): boolean {
  return head === "def" || head.startsWith("def-") || head.startsWith("def_")
    || (head.startsWith("def") && head.length > 3 && !head.startsWith("default") && !head.startsWith("define"))
}

function main() {
  const repos = (argOf("--repos") ?? "clojure,clj-kondo,core.async").split(",")
  const outPath = argOf("--out") ?? "/tmp/opencode/clj-defforms.json"
  const heads: Record<string, number> = {}
  const sites: Record<string, string[]> = {}
  const filesScanned: Record<string, number> = {}

  for (const repo of repos) {
    let n = 0
    for (const file of listFiles(repo)) {
      let content: string
      try { content = readFileSync(file, "utf8") } catch { continue }
      n++
      const rel = path.relative(CORPUS_ROOT, file)
      // Column-0 `(` starts a top-level form. Split on newlines; a top-level
      // form's head is the first token after `(`. This is the one place a
      // textual scan is exact, and it is a census of the CORPUS, not of the
      // analyzer's source.
      for (const line of content.split("\n")) {
        if (!line.startsWith("(")) continue
        const after = line.slice(1)
        let i = 0
        while (i < after.length && !(after[i] === " " || after[i] === "\t" || after[i] === "\n")) i++
        const head = after.slice(0, i)
        if (!head) continue
        if (!isDefLike(head)) continue
        heads[head] = (heads[head] ?? 0) + 1
        ;(sites[head] ??= []).push(rel)
      }
    }
    filesScanned[repo] = n
  }

  const residual = Object.fromEntries(Object.entries(heads).filter(([h]) => !HANDLED.has(h)).sort((a, b) => b[1] - a[1]))
  writeFileSync(outPath, JSON.stringify({ repos, filesScanned, heads, residual, sites }, null, 1))

  console.log(`files scanned: ${Object.entries(filesScanned).map(([r, n]) => `${r}=${n}`).join(" ")}`)
  console.log(`\ntop-level def-family HEADS found (name = count):`)
  for (const [h, c] of Object.entries(heads).sort((a, b) => b[1] - a[1])) {
    const mark = HANDLED.has(h) ? "handled" : "RESIDUAL"
    console.log(`  ${String(c).padStart(6)}  ${h.padEnd(20)} ${mark}`)
  }
  const totalResidual = Object.values(residual).reduce((a, b) => a + b, 0)
  console.log(`\n  RESIDUAL heads: ${Object.keys(residual).length} · RESIDUAL sites: ${totalResidual}`)
  for (const [h, c] of Object.entries(residual)) console.log(`    ${h}: ${c}   e.g. ${sites[h]?.[0]}`)
  console.log(`\nwritten ${outPath}`)
}
main()
