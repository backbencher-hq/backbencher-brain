/**
 * REGEX-FREE CHECK FOR LANE INSTRUMENTS — the tree-sitter way, because
 * `script/m14/no-regex-gate.sh` does not reach these files.
 *
 * ## The coverage gap this closes for THIS lane
 *
 * `no-regex-gate.sh` defaults its scope to `src/ast` and then filters the census
 * to files matching `real-*-analyzer.ts`
 * (`no-regex-gate.sh:73`, `glob(os.path.join(scope, "real-*-analyzer.ts"))`).
 * So the four instruments this lane owns —
 *
 *     validation/m14/instruments/typescript/ambiguity-census.ts
 *     validation/m14/instruments/typescript/construct-probe.ts
 *     validation/m14/instruments/typescript/overrides-endpoint-shape.ts
 *     validation/m14/instruments/typescript/module-source-endpoint-probe.ts
 *     validation/m14/instruments/typescript/declared-construct-probe.ts
 *     validation/m14/instruments/typescript/type-only-import-coverage.ts
 *     validation/m14/instruments/typescript/regex-free-check.ts
 *
 * They lived under `validation/m14/fixtures/typescript/` until this run, and
 * `run-fixtures.ts` reported all of them as FAILING FIXTURES with the message
 * "these are honest defect findings". They were not: that runner feeds every
 * `.ts` in the fixture directory to the analyzer, and an instrument is not an
 * analyzer input. Three of the seven predate this session. A gate that reports
 * a defect where there is none is worse than a gate that is silent, because
 * its readers learn to skip it. The instruments moved to
 * `validation/m14/instruments/typescript/` — same directory depth, so their
 * relative imports to `src/ast` are unchanged. Placement reported to master:
 * `script/m14/` is where the DERIV_TS lane put its instruments, and that path
 * is master-owned, so the lane did not follow the precedent.
 *
 * are inside NO regex gate, even though rule 1 of this programme names "your
 * analyzer, census scripts, or oracle" as the subject. Measured: the gate run at
 * `src/ast` reports 4 regexes, all in `real-svelte-analyzer.ts`, and 0 of them
 * are in a file this lane owns.
 *
 * ## Why this check is a tree walk and not a text scan
 *
 * The gate's own header records what a text scan gets wrong: it counted 187
 * regexes where the AST census found 5, because a `/` inside a comment or a
 * `.split(` call looks like a regex and a regex-looking line inside a block
 * comment does not stop being one. So this file counts `regex` NODES from the
 * TypeScript grammar — `tree-sitter-typescript` names a regex literal `regex`,
 * exactly as `script/m12/regex-census.ts` does — and additionally reports
 * `template_string` nodes, whose interpolations are the other way a pattern can
 * hide in an instrument.
 *
 * ## Two populations, derived not hand-listed
 *
 * The first run of this check reported 2 regexes across 96 files and both were
 * in `complexity-parity.ts` and `taint-sink-receiver.ts` — which are analyzer
 * INPUT fixtures carrying a regex literal as deliberate test data, not
 * instruments. A check that convicts them trains its readers to ignore it, which
 * is the failure `no-regex-gate.sh`'s own header documents (it once reported 187
 * where the truth was 5).
 *
 * So this check splits the population by what it can DERIVE from the tree: a
 * file is an INSTRUMENT when it carries an `import ... from "<...analyzer|engine
 * ...>"` — it reaches the parser or the analyzer, so it is code that MAKES
 * measurements. Everything else in the directory is INPUT, a corpus of
 * TypeScript handed to the analyzer, where a regex literal is the subject
 * matter. The rule is a `node.type` walk plus string identity on an import
 * source; the file list itself comes from `readdirSync`.
 *
 * ## No regex, in the checker as well
 *
 * The walk is `node.type` + `namedChildCount`/`namedChild`. The file list is
 * derived from the filesystem, never written down: a hand-written list rots
 * silently and the checker keeps reporting its number with total confidence.
 *
 * ## Usage
 *
 *   bun validation/m14/instruments/typescript/regex-free-check.ts [dir ...]
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { getParser } from "../../../../src/ast/engine"

const DIRS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["validation/m14/instruments/typescript"]

/** An instrument imports the analyzer or the engine. String identity on the
 *  import SOURCE, read off the tree — not a pattern over the file text. */
const INSTRUMENT_IMPORT_SUBSTRINGS = ["real-typescript-analyzer", "/engine", "/ast/engine"]

/** Node types that are, or contain, a pattern. `regex` is the grammar's own name
 *  for a regex literal. `template_string` is reported separately rather than
 *  counted as a violation: `${}` interpolation is legitimate, so a template
 *  string is a place to LOOK, not a finding. */
const PATTERN_NODES = new Set(["regex"])
const LOOK_NODES = new Set(["template_string"])

function tsFilesIn(dir: string, out: string[] = []): string[] {
  let ents: string[]
  try {
    ents = readdirSync(dir)
  } catch {
    return out
  }
  for (const e of ents) {
    const p = join(dir, e)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) tsFilesIn(p, out)
    else if (e.endsWith(".ts") || e.endsWith(".mts") || e.endsWith(".mjs")) out.push(p)
  }
  return out
}

const parser = await getParser("typescript")

/** Does this file import the analyzer or the engine? Read off the tree: every
 *  `import_statement`, its `source` FIELD, compared by string identity.
 *
 *  `childForFieldName("source")`, not `namedChild(0)`: on
 *  `import { a } from "x"` the first named child is `import_clause`, so a
 *  positional read returns `{ a }` and the classifier silently classifies every
 *  file as INPUT — which is what the first run of this check did, printing
 *  `0 INSTRUMENTS` and a PASS over an empty population. A vacuous pass is worse
 *  than a failure, and the shape of this bug is the one the workstream keeps
 *  naming: an instrument reporting a number about a population it never
 *  measured. The guard below refuses to print PASS on 0 instruments. */
function isInstrument(root: any): boolean {
  let found = false
  const visit = (n: any): void => {
    if (found) return
    if (n.type === "import_statement") {
      const src = typeof n.childForFieldName === "function" ? n.childForFieldName("source") : null
      const text = src ? String(src.text) : ""
      for (const s of INSTRUMENT_IMPORT_SUBSTRINGS) {
        if (text.includes(s)) {
          found = true
          return
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) visit(n.namedChild(i))
  }
  visit(root)
  return found
}

type Row = { file: string; regex: number; templates: number; nodes: number; instrument: boolean }
const rows: Row[] = []
let bytesScanned = 0

for (const dir of DIRS) {
  for (const f of tsFilesIn(dir).sort()) {
    const src = readFileSync(f, "utf8")
    const tree = await parser.parse(src, f)
    const cur = tree.rootNode.walk()
    let rx = 0
    let tpl = 0
    let nodes = 0
    let done = false
    while (!done) {
      const n = cur.currentNode
      if (n) {
        nodes++
        if (PATTERN_NODES.has(n.type)) rx++
        if (LOOK_NODES.has(n.type)) tpl++
      }
      if (cur.gotoFirstChild()) continue
      while (!cur.gotoNextSibling()) {
        if (!cur.gotoParent()) {
          done = true
          break
        }
      }
    }
    bytesScanned += src.length
    rows.push({ file: f, regex: rx, templates: tpl, nodes, instrument: isInstrument(tree.rootNode) })
  }
}

const instruments = rows.filter((r) => r.instrument)
const inputs = rows.filter((r) => !r.instrument)
const instrumentRegex = instruments.reduce((a, r) => a + r.regex, 0)
const inputRegex = inputs.reduce((a, r) => a + r.regex, 0)
const instrumentTemplates = instruments.reduce((a, r) => a + r.templates, 0)

console.log(`regex-free check (tree-sitter node census, no text scan)`)
console.log(`  scope requested : ${DIRS.join(" ")}`)
console.log(`  POPULATION      : ${rows.length} files, ${bytesScanned} bytes — derived from readdirSync`)
console.log(
  `  split           : ${instruments.length} INSTRUMENTS (import the analyzer/engine), ${inputs.length} analyzer INPUTS`,
)
console.log("")
console.log(`  INSTRUMENTS  regex nodes: ${instrumentRegex}   template_string: ${instrumentTemplates}`)
for (const r of instruments) {
  console.log(`    ${r.regex === 0 ? "ok  " : "FAIL"} ${r.file}  regex=${r.regex} templates=${r.templates} nodes=${r.nodes}`)
}
console.log("")
console.log(
  `  INPUTS       regex nodes: ${inputRegex}  — a regex literal in an input fixture is TEST DATA, not a defect.`,
)
for (const r of inputs) {
  if (r.regex > 0) console.log(`    data ${r.file}  regex=${r.regex} (input fixture, subject matter)`)
}
console.log("")
// A count of zero over an EMPTY population is not a claim, it is a mistake, and
// it is the exact failure mode docs/M14-HONESTY-CONTRACT.md was written about.
// The first run of this file did precisely that: `namedChild(0)` on an
// import_statement returns `import_clause`, every instrument was misfiled as an
// input, and the summary printed `PASS - 0 regex literals across 0 of 0
// instrument files`. Say so loudly instead.
if (instruments.length === 0) {
  console.log(`FAIL — 0 INSTRUMENTS classified out of ${rows.length} files. An empty population is NOT a pass.`)
  console.log(`  Either the scope argument is wrong, or isInstrument() stopped matching (it reads the`)
  console.log(`  import_statement "source" FIELD; a positional read returns import_clause and files every`)
  console.log(`  instrument as an input).`)
  process.exit(2)
}
console.log(
  instrumentRegex === 0
    ? `PASS — 0 regex literals across ${instruments.length} of ${instruments.length} instrument files scanned (of ${rows.length} files in scope)`
    : `FAIL — ${instrumentRegex} regex literal nodes across ${instruments.length} instrument files scanned`,
)
process.exit(instrumentRegex === 0 ? 0 : 1)
