/**
 * DOES EVERY `@import` ON THE TREE BECOME AN `imports` EDGE? — the delta the ontology probe
 * printed and nobody had chased: 250 `import_statement` nodes, 243 `imports` edges.
 *
 * ## Why this file exists
 *
 * Pass 10 re-ran `css-ontology-probe.ts` and it reproduced byte-for-byte, including one row the
 * verdict tables never had to reconcile because `imports` was EMITTED and therefore never
 * audited against the grammar:
 *
 *     imports   A:grammar-inventory  250  -  an `@import` statement node
 *
 * The `imports` verdict says EMITTED with 243 edges. Those two numbers are about the same
 * construct, from two instruments, and they differ by 7. A lane that reports EMITTED without
 * reconciling the count against the grammar is asserting coverage it has not measured, which is
 * the failure mode this workstream exists to catch — the `extends` row was wrong the same way in
 * pass 6 (a ruling that claimed a corpus which writes the construct 46 times).
 *
 * ## The seven can only be three things, and they have different consequences
 *
 *   1. the analyzer published two edges the store key (source, type, target, line) collapsed into
 *      one — a REPRESENTATION limit, unrepresentable, and the tree count stays higher;
 *   2. the tree carries an `import_statement` the analyzer's own branch cannot reach — a
 *      DEAD BRANCH, and the edge is a real GAP this lane owes;
 *   3. `import_statement` nodes that are not CSS `@import` at all (an ERROR node's recovery
 *      shape, or a grammar production reused for a Sass `@use`), in which case the tree count is
 *      counting something the `imports` row does not claim.
 *
 * `processImport` reads ONE thing: a DIRECT child of type `string_value` or `call_expression`
 * (`real-css-analyzer.ts:1917-1918`, `findChild` is direct-children-only at :1302-1308). An
 * `import_statement` with neither child produces no edge and no diagnostic — the silent case,
 * and the only one of the three that is a defect. So this file enumerates every
 * `import_statement` on every admitted tree, records its direct child node types, and buckets it.
 *
 * ## Instrument
 *
 * B: parse-tree count plus production `parseFile`, so the two sides are counted by DIFFERENT
 * code paths and the comparison is not a tautology. Node-type and named-child navigation only;
 * there is not one regular expression here, because a pattern over raw text cannot tell the
 * statement `@import "a.css"` from the word "import" in a comment, in a class name or in a
 * `content:` value, and this lane has already had that argument settled three times.
 *
 * ## Admission rule
 *
 * Transcribed character-for-character from `css-extend-lexability.ts`, which is
 * character-for-character `css-ontology-probe.ts`'s. Do NOT tidy it into a `withFileTypes` walk
 * with an extension pre-filter: that drift has happened three times in this lane and each time
 * the printed file count is what caught it. Compare the count below against the arbiter's 1,255
 * before believing anything else on this page.
 *
 * ## READ-ONLY
 *
 * Writes nothing unless `--json <path>` is given. Prints a report.
 *
 * Run: npx tsx validation/m14/census/css-import-coverage.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const jsonAt = argv.indexOf("--json")
const WASM = path.join(process.cwd(), "wasm", "tree-sitter-css.wasm")

// ------------------------------------------------------------------ corpus (transcribed)
const files: { repo: string; rel: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "css") continue
    files.push({ repo: e, rel, abs, text })
  }
}
files.sort((a, b) => (a.repo + a.rel < b.repo + b.rel ? -1 : 1))
const repos = new Set(files.map((f) => f.repo))

// ---------------------------------------------------------------------------- parser
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({
  locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(WASM)))

/**
 * The two child types `processImport` accepts, named here rather than imported: the analyzer
 * binds those names as string literals in a `findChild` predicate, and importing the function
 * would test the analyzer against itself.
 */
const ACCEPTED = new Set(["string_value", "call_expression"])

type Bucket = {
  childShape: string
  n: number
  files: Set<string>
  examples: string[]
  inError: number
  /** How many occurrences of this shape the analyzer's `@import`-keyword-ROW rule reaches. */
  byRowRule: number
  /**
   * For a shape the analyzer cannot read: the full descendant node list of each occurrence, with
   * its start LINE, so a reader can see whether a `string_value` exists under the statement at
   * all and — the question that decides the fix — whether it sits on the `@import` line or on a
   * LATER line the grammar's ERROR recovery swallowed into the node.
   */
  subtrees: string[]
}

const buckets = new Map<string, Bucket>()
let statements = 0
let statementFiles = 0
let directAccepted = 0
/** Reachable by the analyzer's SECOND rule: a name node on the `@import` keyword's own row, at any depth. */
let reachableByRowRule = 0

/** file -> the import edges production parseFile actually published, keyed the way the store keys them. */
const published = new Map<string, Set<string>>()

const bucketOf = (childShape: string): Bucket => {
  const b = buckets.get(childShape) ?? { childShape, n: 0, files: new Set<string>(), examples: [], inError: 0, byRowRule: 0, subtrees: [] }
  buckets.set(childShape, b)
  return b
}

/** Every descendant of `n`, root-most last, as `type@line`, so line membership is readable. */
const subtreeTypes = (n: any): string[] => {
  const out: string[] = []
  const walk = (x: any) => {
    out.push(`${x.type}@${x.startPosition.row + 1}`)
    for (let i = 0; i < x.childCount; i++) {
      const c = x.child(i)
      if (c) walk(c)
    }
  }
  walk(n)
  return out
}

for (const f of files) {
  const label = `${f.repo}/${f.rel}`
  const t = parser.parse(f.text)
  if (!t) continue
  let saw = false

  const walk = (n: any, inError: boolean): void => {
    if (n.type === "import_statement") {
      statements++
      saw = true
      const childTypes: string[] = []
      let accepted: string | null = null
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (!c) continue
        childTypes.push(c.type)
        if (!accepted && ACCEPTED.has(c.type)) accepted = c.type
      }
      if (accepted) directAccepted++
      // The analyzer's SECOND rule, reimplemented here so the two sides of the comparison are
      // counted independently: any `string_value` / `call_expression` at ANY depth whose row
      // equals the `@import` keyword's own row. Mirrors `findImportNameNode` in the analyzer,
      // and the published-edge count below is what says whether the two agree.
      {
        let kwRow = n.startPosition.row
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c && c.type === "@import") {
            kwRow = c.startPosition.row
            break
          }
        }
        let hit = false
        const scan = (x: any) => {
          if (hit) return
          if (x.startPosition.row === kwRow && ACCEPTED.has(x.type)) {
            hit = true
            return
          }
          for (let i = 0; i < x.childCount; i++) {
            const c = x.child(i)
            if (c) scan(c)
          }
        }
        scan(n)
        if (hit) reachableByRowRule++
      }
      // The shape is the SORTED direct-child type list, so two `@import` forms that differ only
      // in child ORDER land in one bucket and a form that differs in KIND does not.
      const shape = childTypes.slice().sort().join("+") || "(no children)"
      const b = bucketOf(shape)
      b.n++
      b.files.add(label)
      if (inError) b.inError++
      // (the row-rule hit for this occurrence is recomputed here rather than carried out of the
      // block above, so the per-shape tally and the corpus total cannot drift from each other)
      {
        let kwRow = n.startPosition.row
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c && c.type === "@import") {
            kwRow = c.startPosition.row
            break
          }
        }
        const scan = (x: any): boolean => {
          if (x.startPosition.row === kwRow && ACCEPTED.has(x.type)) return true
          for (let i = 0; i < x.childCount; i++) {
            const c = x.child(i)
            if (c && scan(c)) return true
          }
          return false
        }
        if (scan(n)) b.byRowRule++
      }
      if (b.examples.length < 4) {
        b.examples.push(`L${n.startPosition.row + 1} ${label}  children=[${childTypes.join(", ")}]  ${JSON.stringify(n.text.slice(0, 90))}`)
      }
      if (!ACCEPTED.has(accepted ?? "") && b.subtrees.length < 2) {
        const atLine = (() => {
          for (let i = 0; i < n.childCount; i++) {
            const c = n.child(i)
            if (c && c.type === "@import") return c.startPosition.row + 1
          }
          return n.startPosition.row + 1
        })()
        const cand: string[] = []
        const collect = (x: any) => {
          if (ACCEPTED.has(x.type)) cand.push(`${x.type}@L${x.startPosition.row + 1} ${JSON.stringify(x.text.slice(0, 60))}`)
          for (let i = 0; i < x.childCount; i++) {
            const c = x.child(i)
            if (c) collect(c)
          }
        }
        collect(n)
        b.subtrees.push(
          `L${n.startPosition.row + 1} ${label}  @import keyword on L${atLine}; ` +
            `node spans L${n.startPosition.row + 1}..L${n.endPosition.row + 1}\n` +
            `      subtree: ${subtreeTypes(n).join(" ")}\n` +
            `      accepted-shaped DESCENDANTS: ${cand.length === 0 ? "(none — the name is not a node at all)" : cand.join(" | ")}\n` +
            `      on the @import line itself: ${cand.filter((c) => c.includes(`L${atLine} `)).length === 0 ? "NONE" : cand.filter((c) => c.includes(`L${atLine} `)).join(" | ")}`,
        )
      }
    }
    const childError = inError || n.type === "ERROR"
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) walk(c, childError)
    }
  }
  walk(t.rootNode, false)
  if (saw) statementFiles++

  // Production side: what parseFile published. Keyed (target, line) because the css analyzer sets
  // the edge's line to the string_value / call_expression node, which is the SAME node the
  // tree walk above accepts — so the two sides are joined on the node they both name.
  try {
    const r = await parseFile(f.abs, f.text, "css")
    const set = new Set<string>()
    for (const rel of r.relationships ?? []) {
      if ((rel as any).type !== "imports") continue
      const md = (rel as any).metadata as Record<string, unknown> | undefined
      if (md?.isSassModuleImport === true) continue
      set.add(JSON.stringify([(rel as any).target, (rel as any).line_number ?? (rel as any).line ?? null]))
    }
    published.set(label, set)
  } catch {
    published.set(label, new Set())
  }
}

// Count the edges production published, once per file, so a store-key collapse inside one file
// is visible as a published-count < emittable-count difference rather than silently absorbed.
let publishedEdges = 0
for (const s of published.values()) publishedEdges += s.size

// ------------------------------------------------------------------------------ report
const report = {
  tool: "css-import-coverage",
  corpusRoot: CR,
  corpusTotal: files.length,
  reposInCorpus: repos.size,
  importStatementNodes: statements,
  filesWithImportStatement: statementFiles,
  emittableByDirectChildRule: directAccepted,
  reachableByImportKeywordRowRule: reachableByRowRule,
  publishedImportEdges: publishedEdges,
  deltaStatementsMinusPublished: statements - publishedEdges,
  buckets: [...buckets.values()]
    .map((b) => ({
      childShape: b.childShape,
      occurrences: b.n,
      files: b.files.size,
      insideErrorNode: b.inError,
      byDirectChildRule: b.childShape.split("+").some((c) => ACCEPTED.has(c)),
      byImportKeywordRowRule: b.byRowRule,
      examples: b.examples,
      subtrees: b.subtrees,
    }))
    .sort((a, b) => b.occurrences - a.occurrences),
}

console.log("css @import coverage — tree statements vs production `imports` edges")
console.log(`corpus: ${files.length} admitted files across ${repos.size} repositories`)
console.log(`\nimport_statement NODES on the tree:               ${statements} in ${statementFiles} files`)
console.log(`  reachable by the DIRECT-CHILD rule:            ${directAccepted}  (a direct string_value or call_expression child)`)
console.log(`  reachable by the @import-KEYWORD-ROW rule:     ${reachableByRowRule}  (a name node at any depth, on the keyword's own row)`)
console.log(`production parseFile PUBLISHED imports edges:    ${publishedEdges}`)
console.log(`DELTA (nodes - published):                      ${statements - publishedEdges}`)

console.log("\nBY DIRECT-CHILD SHAPE (the shape is what the direct-child rule sees; the row rule sees past it):")
console.log(
  "direct child types".padEnd(46) + "occ".padStart(6) + "files".padStart(7) + "inERR".padStart(7) + "direct".padStart(8) + "rowRule".padStart(9),
)
console.log("-".repeat(83))
for (const b of report.buckets) {
  console.log(
    b.childShape.padEnd(46) +
      String(b.occurrences).padStart(6) +
      String(b.files).padStart(7) +
      String(b.insideErrorNode).padStart(7) +
      (b.byDirectChildRule ? "     yes" : "      NO").padStart(8) +
      String(b.byImportKeywordRowRule).padStart(9),
  )
}

const missedByRowRule = report.buckets.filter((b) => b.byImportKeywordRowRule === 0)
const missedN = missedByRowRule.reduce((a, b) => a + b.occurrences, 0)
if (missedByRowRule.length > 0) {
  console.log("\nSHAPES THE ROW RULE ALSO MISSES (a real gap, whatever the rule):")
  for (const b of missedByRowRule) {
    console.log(`\n  shape [${b.childShape}] — ${b.occurrences} occurrence(s) in ${b.files} file(s)`)
    for (const ex of b.examples) console.log(`    ${ex}`)
    for (const st of b.subtrees) console.log(`    SUBTREE  ${st}`)
  }
} else {
  console.log("\nSHAPES THE ROW RULE ALSO MISSES: none — every import_statement node carries a name node on the @import line.")
}

console.log("\nREAD:")
if (missedN === 0 && statements === publishedEdges) {
  console.log(
    `  ${statements} import_statement nodes, ${publishedEdges} published \`imports\` edges, delta 0. Every node's\n` +
      `  specifier is a node the grammar produced, on the @import keyword's own row, so the published\n` +
      `  count is not one name short of the tree and not one name the tree cannot vouch for.`,
  )
} else if (missedN === 0) {
  console.log(
    `  every one of the ${statements} import_statement nodes carries a name node on the @import keyword's\n` +
      `  row, so no branch is dead, and ${statements - publishedEdges} node(s) did not become a distinct\n` +
      `  published edge — the STORE KEY, not a dead branch.`,
  )
} else {
  console.log(
    `  ${missedN} import_statement node(s) carry NO string_value or call_expression on the @import\n` +
      `  keyword's row at any depth, so processImport returns without pushing an edge and without a\n` +
      `  diagnostic. That is a DEAD BRANCH the corpus reaches, and an \`imports\` GAP this lane owes.\n` +
      `  The shapes above are the evidence.`,
  )
}

if (jsonAt !== -1 && argv[jsonAt + 1]) writeFileSync(argv[jsonAt + 1], JSON.stringify(report, null, 2) + "\n")