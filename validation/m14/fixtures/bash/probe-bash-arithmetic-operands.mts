/**
 * ARITHMETIC OPERANDS IN `(( … ))` — predict the edge delta BEFORE changing the analyzer.
 *
 * ## The gap
 *
 * `docs/analyzers/bash.md` limitation 7 records that the dispatch
 * routes `simple_expansion`, `expansion`, `arithmetic_expansion`,
 * `postfix_expression` and `c_style_for_statement` to `emitVariableUses`, and that
 * `compound_statement` is NOT among them — so `((i < 5))` names `i` and `n` and the
 * graph never mentions either, while `((i++))` does produce a `uses` edge because its
 * operand happens to be a `postfix_expression`. The asymmetry is a grammar-shape
 * accident, not a fact about bash.
 *
 * ## Why this file exists rather than a line of arithmetic on the census output
 *
 * Because the census counts what WAS published, so it can only tell you the delta
 * after the change. This file derives the delta from the TREE and the currently
 * published edge set, BEFORE the analyzer is touched, so the after-run can be
 * checked against a prediction instead of being believed. A change that is measured
 * only after the fact has no way to distinguish "closed the gap I named" from
 * "moved the count for some other reason".
 *
 * The prediction is exact, not an estimate, because `addRel`'s dedupe key is
 * `${source}\u0000${type}\u0000${target}\u0000${line}` and the candidate set here is
 * reduced by exactly that key against the edges production `parseFile` already
 * returned for the same file.
 *
 * ## The predicate, and why it is a node-shape test rather than a text search
 *
 * A `compound_statement` is NOT always arithmetic: `if …; then <block> fi` and
 * `do <body> done` both hold one, and a block's commands carry `simple_expansion`
 * nodes that are ALREADY dispatched. So the predicate is the node's own text
 * opening `((` and closing `))` — the same POSIX fact `isArithmeticOperandCommand`
 * already reads, and the same char-code test rather than a regex (this lane holds
 * zero regex literals, and `script/m12/verify-regex-census.ts` asserts it).
 *
 * ## What is counted
 *
 *   arithmeticCompoundStatements — `compound_statement` nodes that pass the predicate
 *   operands                    — `variable_name` / `special_variable_name` nodes under them
 *   alreadyPublished            — operand (target, line) pairs the analyzer emits today
 *   predictedNewEdges           — the difference, with names and files, printed in full
 *
 * Also printed: how many of the predicted edges name a name this file DECLARES, so
 * a reader can see the payload is real reads rather than environment names.
 *
 * ## NO REGEX
 *
 * Names come from node text and `charCodeAt`; nothing here matches source text.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/probe-bash-arithmetic-operands.mts [--sample 400] [--repo NAME]
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const SAMPLE = Number(flag("sample") ?? "400")
const REPO = flag("repo")

const opensWithDoubleParen = (text: string): boolean =>
  text.length >= 2 && text.charCodeAt(0) === 40 && text.charCodeAt(1) === 40
const endsWithDoubleParen = (text: string): boolean => {
  const t = text.trim()
  return t.length >= 2 && t.charCodeAt(t.length - 2) === 41 && t.charCodeAt(t.length - 1) === 41
}
const isArithmeticCompound = (text: string): boolean =>
  opensWithDoubleParen(text) && endsWithDoubleParen(text)

/** `$@ $* $? $$ $# $! $_` — shell bookkeeping, published as punctuation by the
 *  analyzer's own rule (SPECIAL_VAR_PUNCTUATION). Copied rather than imported; the
 *  probe asserts nothing about drift because a divergence here can only ADD or
 *  REMOVE a predicted edge, never change a published one. */
const SPECIAL_VAR_PUNCTUATION = new Set(["@", "*", "?", "$", "#", "!", "_"])
const isAllDigits = (s: string): boolean => {
  if (s.length === 0) return false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 48 || c > 57) return false
  }
  return true
}

// --------------------------------------------------------------- corpus walk
type Admitted = { repo: string; dir: string; rel: string; abs: string; text: string }
const admitted: Admitted[] = []
let scanned = 0
for (const e of readdirSync(CR)) {
  if (REPO && e !== REPO) continue
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
    try {
      if (statSync(abs).size > 512 * 1024) continue
    } catch {
      continue
    }
    let text: string
    try {
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    scanned++
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    admitted.push({ repo: e, dir, rel, abs, text })
  }
}
const byHash = (a: Admitted, b: Admitted): number => {
  const ha = createHash("sha256").update(`${a.repo}/${a.rel}`).digest("hex")
  const hb = createHash("sha256").update(`${b.repo}/${b.rel}`).digest("hex")
  return ha < hb ? -1 : ha > hb ? 1 : 0
}
admitted.sort(byHash)
const files = admitted.slice(0, SAMPLE)
console.log(
  `corpus      : ${CR}\nadmitted    : ${admitted.length} files routed to bash\nsample      : ${files.length} files, hash order\nrepositories: ${new Set(files.map((f) => f.repo)).size}\ntracked     : ${scanned}`,
)

// A PRIVATE parser instance, not `ASTEngine.getParser("bash")`.
//
// This line is the whole of round 8's wrong table. This probe used to borrow the
// engine's shared bash parser and then interleave two users of that one handle —
// production `parseFile` parsing and deleting its own trees through it, and this
// probe parsing directly and keeping its trees. That combination reads exactly
// 499 files and no more: at `--sample 900` it reported 401 unparsed, and at
// `--sample 4400` it reported 3,634, and 900-401 and 4,133-3,634 are both 499. A
// constant, not a function of corpus size, which is the signature of a fixed
// capacity in the INSTRUMENT rather than a property of the corpus.
//
// Three measurements place it outside the corpus and outside the wasm:
//   - production `parseFile` alone over every admitted file: 4,131 of 4,133 read
//     with the grammar, 2 answered by `extractFallback`, 0 relationships from them
//     (census-bash-ontology.ts --all);
//   - instrument A, which builds its own parser exactly as below, over every
//     admitted file: 4,133 parsed, 0 threw (probe-bash-grammar-inventory.mts);
//   - a private parser with no `tree.delete()` at all over 2,500 files: 0 threw,
//     rss flat at 239 MB (probe-bash-wasm-tree-lifetime.mts), so the missing
//     `delete()` was a real omission in this file and is NOT the cause — the
//     shared handle is.
//
// Kept deliberately identical in shape to `probe-bash-grammar-inventory.mts`,
// which is the instrument the three RULED verdicts rest on, so the two probes
// cannot drift apart on how they obtain a grammar.
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
const REPO_ROOT = path.resolve(process.cwd())
await WSP.init({ locateFile: () => path.join(REPO_ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(REPO_ROOT, "wasm", "tree-sitter-bash.wasm"))))

let arithmeticCompounds = 0
let nonArithmeticCompounds = 0
let opensOnlyCompounds = 0
// Round 9: the ROWS, not just the count. Limitation 24 called this population
// empty on a 400-file sample and therefore unmutatable; over the whole corpus it
// is 5, and a fixture cannot be written for a count nobody can see the text of.
const opensOnlyRows: string[] = []
let opensOnlyWithOperand = 0
let opensOnlyWithoutOperand = 0
let opensOnlyDamaged = 0
let operands = 0
let alreadyPublished = 0
let filesWithArithmetic = 0
const predicted = new Map<string, { count: number; files: Set<string> }>()
let unparsed = 0
let predictedDeclaredInFile = 0
let alreadyDeclaredInFile = 0
const shapeRows = new Map<string, number>()

for (const f of files) {
  const parsed = await parseFile(f.abs, f.text)
  const publishedUses = new Set<string>()
  const declaredNames = new Set<string>()
  for (const s of parsed.symbols ?? []) {
    if (s.name) declaredNames.add(s.name)
  }
  for (const r of parsed.relationships ?? []) {
    const type = String(r.type)
    if (!type.endsWith("uses") && !type.endsWith("Uses")) continue
    publishedUses.add(`${r.target}\u0000${(r as { line_number?: number }).line_number ?? 0}`)
  }

  const tree = (() => {
    // This probe asks the parser DIRECTLY, because `parseFile` CATCHES the wasm's
    // abort and substitutes a degraded result — so only a direct call can tell a
    // file the grammar could not read from one the analyzer declined.
    //
    // The comment this replaced claimed the pinned wasm "aborts with `memory
    // access out of bounds` on some corpus files" and read the resulting 3,634
    // failures as a property of the corpus. It is a property of THIS PROBE. Every
    // tree this loop created was dropped without `delete()`, and a web-tree-sitter
    // tree lives in the wasm heap until it is deleted — so the heap grew by one
    // whole parse tree per file, exhausted itself at roughly file 500, and every
    // parse after that point threw. The probe therefore reported its own leak as
    // 87.9% of the language being unparseable, and round 8 published that number.
    //
    // Two measurements place it. `tree.delete()` at the end of each iteration makes
    // the failure count 0 over the whole corpus (this probe, re-run), and
    // production `parseFile` over every admitted file returns `fallback: true` on
    // ZERO of them (census-whole-corpus-bash.mts) — so the corpus was never the
    // problem and neither was the wasm.
    try {
      return parser!.parse(f.text)
    } catch {
      unparsed++
      return null
    }
  })()
  if (!tree) continue
  const fileHasArithmetic = { hit: false }
  // Dedupe is PER FILE, not per statement, because `addRel`'s key carries no
  // statement identity: `(( i++ )); (( i-- ))` on ONE line is one edge, and a
  // per-statement set counted it twice. That was a real 72-vs-70 discrepancy in
  // the first run of this probe — the candidate count over-counted by the number
  // of same-line same-name operand pairs, and the census delta was right.
  const fileSeen = new Set<string>()
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "compound_statement" && !isArithmeticCompound(n.text)) {
      // What the predicate EXCLUDES. If `opensWithDoubleParen` alone were the
      // test, the `opensButDoesNotEnd` row below is the population that would
      // change behaviour — so this pair of counters is what decides whether the
      // closing-paren half of the predicate is observable at all.
      nonArithmeticCompounds++
      if (opensWithDoubleParen(n.text)) {
        opensOnlyCompounds++
        // WHY these 5 exist. A `compound_statement` that opens `((` without closing
        // `))` is not a shape bash wrote — it is a shape the pinned grammar FAILED
        // to read, and the question that decides whether an analyzer should publish
        // reads inside it is whether an operand node exists to read. These two
        // counters answer that per node instead of per assumption.
        let hasVariableName = false
        let hasError = false
        const scan = (m: any): void => {
          if (m.type === "variable_name" || m.type === "special_variable_name") hasVariableName = true
          if (m.type === "ERROR" || m.isMissing) hasError = true
          for (let j = 0; j < m.namedChildCount; j++) {
            const c = m.namedChild(j)
            if (c) scan(c)
          }
        }
        for (let j = 0; j < n.namedChildCount; j++) {
          const c = n.namedChild(j)
          if (c) scan(c)
        }
        if (hasVariableName) opensOnlyWithOperand++
        else opensOnlyWithoutOperand++
        if (hasError) opensOnlyDamaged++
        if (opensOnlyRows.length < 10) {
          const t = n.text.split("\n")[0]?.slice(0, 100) ?? ""
          opensOnlyRows.push(
            `${f.repo}/${f.rel}:${n.startPosition.row + 1}  operand-node=${hasVariableName ? "YES" : "none"}  ERROR/MISSING=${hasError ? "yes" : "no"}  ${t}`,
          )
        }
      }
    }
    if (n.type === "compound_statement" && isArithmeticCompound(n.text)) {
      arithmeticCompounds++
      fileHasArithmetic.hit = true
      // the operand shapes this grammar actually produces under an arithmetic
      // compound_statement, so the doc names them rather than guessing
      shapeRows.set(`${n.namedChild(0)?.type ?? "(none)"}`, (shapeRows.get(`${n.namedChild(0)?.type ?? "(none)"}`) ?? 0) + 1)
      const operandsHere: { name: string; line: number }[] = []
      const visit = (m: any): void => {
        if (m.type === "variable_name" || m.type === "special_variable_name") {
          const t = m.text
          if (t.length > 0) operandsHere.push({ name: t, line: m.startPosition.row + 1 })
          return
        }
        if (m.type === "subscript") {
          for (let j = 0; j < m.namedChildCount; j++) {
            const c = m.namedChild(j)
            if (c) visit(c)
          }
          return
        }
        for (let i = 0; i < m.namedChildCount; i++) {
          const c = m.namedChild(i)
          if (c) visit(c)
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) visit(c)
      }
      for (const { name, line } of operandsHere) {
        operands++
        const trimmed = name.trim()
        if (trimmed.length === 0) continue
        if (isAllDigits(trimmed)) continue
        if (SPECIAL_VAR_PUNCTUATION.has(trimmed)) continue
        const key = `${trimmed}\u0000${line}`
        if (fileSeen.has(key)) continue
        fileSeen.add(key)
        if (publishedUses.has(key)) {
          alreadyPublished++
          if (declaredNames.has(trimmed)) alreadyDeclaredInFile++
          continue
        }
        const row = predicted.get(trimmed) ?? { count: 0, files: new Set<string>() }
        row.count++
        row.files.add(`${f.repo}/${f.rel}`)
        predicted.set(trimmed, row)
        if (declaredNames.has(trimmed)) predictedDeclaredInFile++
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
  // RELEASE THE TREE. See the note at the `parser.parse` call above: omitting this
  // one line is what made this probe report 3,634 of 4,133 corpus files as
  // unparseable by the pinned wasm. The 400-file sample sits under the ~500-file
  // exhaustion point, which is why every sample-based figure this probe produced
  // was correct and only the whole-corpus run broke.
  tree.delete?.()
  if (fileHasArithmetic.hit) filesWithArithmetic++
}

const predictedEdges = [...predicted.entries()].reduce((a, [, v]) => a + v.count, 0)
console.log(`\n--- arithmetic (( ... )) in the sample ---`)
console.log(`files the pinned wasm could not parse (excluded)  : ${unparsed}`)
console.log(`files with at least one arithmetic compound_statement : ${filesWithArithmetic}`)
console.log(`arithmetic compound_statements                       : ${arithmeticCompounds}`)
console.log(`compound_statements the predicate EXCLUDES           : ${nonArithmeticCompounds}`)
console.log(`  …of those, opening (( but NOT ending ))            : ${opensOnlyCompounds}  <- the closing-paren test's whole population`)
for (const r of opensOnlyRows) console.log(`      ${r}`)
console.log(`      …of those, containing a variable_name operand : ${opensOnlyWithOperand}`)
console.log(`      …of those, containing NO operand node at all   : ${opensOnlyWithoutOperand}`)
console.log(`      …of those, containing an ERROR or MISSING node: ${opensOnlyDamaged}`)
console.log(`operand name nodes under them                        : ${operands}`)
console.log(`  … already published as a uses edge (today)          : ${alreadyPublished}`)
console.log(`  … PREDICTED NEW uses edges                          : ${predictedEdges}`)
console.log(`    of those, target declared in the same file        : ${predictedDeclaredInFile}`)
console.log(`    already-published ones whose target is declared    : ${alreadyDeclaredInFile}`)
console.log(`\nfirst named child node type under an arithmetic compound_statement:`)
for (const [k, v] of [...shapeRows.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(5)}  ${k}`)
}
console.log(`\n--- predicted new edges by target name (all of them) ---`)
for (const [name, v] of [...predicted.entries()].sort((a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1))) {
  const where = [...v.files].slice(0, 2).join(", ")
  console.log(
    `  ${String(v.count).padStart(3)}  ${name.padEnd(28)} ${v.files.size} file(s)  ${where}${v.files.size > 2 ? ", …" : ""}`,
  )
}
console.log(
  `\nDELTA PREDICTION: uses ${alreadyPublished} + ${predictedEdges} = ${alreadyPublished + predictedEdges}; no other type is touched by this change.`,
)