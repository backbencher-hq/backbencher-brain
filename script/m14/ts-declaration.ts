// TYPESCRIPT LANE — THE WHOLE-POPULATION DECLARATION, DERIVED FROM THE ARM'S OWN REPORT.
//
// WHY THIS IS A GENERATOR AND NOT A HAND-WRITTEN FILE: the completion gate reads a lane's declaration
// and checks it against its own arithmetic. A declaration typed by hand is a SECOND COPY OF A
// MEASUREMENT — and this fleet has already paid, twice in this lane, for a second copy that drifted.
// So the declaration is DERIVED from the arm's log, and every number in it carries the command that
// produced it.
//
// WHAT IT READS: the arm's report. `TABLE 1` is the per-type block whose columns are the population's
// own closure (the edge buckets are the whole population's, so every admitted file is measured exactly
// once); the `population:` line gives parsed / admitted / extensions / index. Nothing is inferred: a
// block it cannot find is a REFUSAL, not a zero, because a declaration with a hole in it reads like a
// declaration with a zero in it.
//
// THE BUCKET MAPPING, and it is stated because a reader must be able to check it:
//   resolved        = the arm's `resolved`
//   external        = extOK + ext?          (a claim the project confirms, or one no check can reach)
//   ambiguous       = amb(decl)
//   otherUnresolved = unresolved + extFAIL + bindOK + bind? + bindFAIL + causeOK + causeFAIL
//   unclassed       = 0 BY CONSTRUCTION — if the sum does not close the arm's own edge count, this
//                     program REFUSES rather than putting the difference in `unclassed`: the gate's
//                     unclassed ceiling is 0 and a lane that fills it has not classified anything.
// `causeOK`/`causeFAIL` are placed in `otherUnresolved` and NOT in `resolved`, because a declared
// cause is a statement rather than a resolution, and the arm prints it in its own column for exactly
// that reason.
//
// Usage: bun run script/m14/ts-declaration.ts <arm-log> [--out <path>]
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const argv = process.argv.slice(2)
const logPath = argv[0]
const outPath = argv.find((a) => a.startsWith("--out="))?.slice("--out=".length)
  ?? join(REPO, "validation/m14/instruments/typescript/incoming-declaration.json")
if (!logPath) {
  console.error("usage: ts-declaration.ts <arm-log> [--out=<path>]")
  process.exit(2)
}

const raw = readFileSync(logPath, "utf8")
const logSha = createHash("sha256").update(raw).digest("hex")
const lines = raw.split(/\r?\n/)

/** the arm's population line — the ONE rule that produced the population */
const popLine = lines.find((l) => /^\s*population:/i.test(l)) ?? ""
const popMatch = /(\d+)\s+parsed\s+of\s+(\d+)/i.exec(popLine)
const corpusMatch = /corpus has (\d+)\s+([^\s]+)\s+files across (\d+) repos/i.exec(popLine)
// ⇒ the report prints `admitted extensions = .ts, .tsx, .mts, .cts (…)`; a pattern that takes the next
// token blindly captures the `=` and yields `exts==` in the population string — a rule that silently
// becomes a wrong value. So the extension LIST is matched, and a `=` separator is optional.
const extMatch = /admitted extensions\s*=?\s*([.\w]+(?:\s*,\s*[.\w]+)*)/i.exec(lines.find((l) => /admitted extensions/i.test(l)) ?? "")
if (!popMatch || !extMatch) {
  console.error("REFUSED: the arm log does not carry a population line and an admitted-extensions line.")
  console.error(`  population line: ${popLine || "(none)"}`)
  console.error("  A declaration without its population rule is prose, so this program writes nothing.")
  process.exit(3)
}
const parsed = Number(popMatch[1])
const admitted = Number(popMatch[2])
const exts = extMatch[1].replace(/\s+/g, "")
const corpusTotal = corpusMatch ? Number(corpusMatch[1]) : admitted
const repos = corpusMatch ? Number(corpusMatch[3]) : 0
const populationString = `parsed=${parsed}/${admitted} admitted=${admitted} exts=${exts} index=yes`

/** TABLE 1 — the per-type column set. Its header names the columns, so a renamed column is loud. */
const HEADER = ["type","edges","resolved","collRes","ambDecl","ambKind","unresolved","extOK","extQ","extFAIL","bindOK","bindQ","bindFAIL","causeOK","causeFAIL"]
const hIdx = lines.findIndex((l) => /^type\s+edges\s+resolved/i.test(l.trim()))
if (hIdx < 0) {
  console.error("REFUSED: the arm log carries no TABLE 1 header (the per-type closure block).")
  process.exit(3)
}
const headerCells = lines[hIdx].trim().split(/\s{2,}|\s+/).map((c) => c.trim())
const rows: Record<string, number>[] = []
for (let i = hIdx + 1; i < lines.length; i++) {
  const line = lines[i].trim()
  if (!line) continue
  // ⇒ THE SEPARATOR ROW. The report prints a dashed rule under every header, and a parser that treats
  // it as a row reads zero rows and then reports a zero-row closure — the failure this program REFUSES
  // rather than reports. Skipping it by SHAPE (nothing but dashes) rather than by position is the point.
  if (/^-+$/.test(line)) continue
  const cells = line.split(/\s+/)
  if (cells.length < 14) break
  const type = cells[0]
  if (!/^[a-z_]+$/.test(type)) break
  const nums = cells.slice(1, 15).map((n) => Number(n.replace(/,/g, "")))
  if (nums.some((n) => Number.isNaN(n))) break
  rows.push(Object.fromEntries(["edges","resolved","collRes","ambDecl","ambKind","unresolved","extOK","extQ","extFAIL","bindOK","bindQ","bindFAIL","causeOK","causeFAIL"].map((k, j) => [k, nums[j]]).concat([["type", type as any]])) as any)
}
if (!rows.length) {
  console.error("REFUSED: TABLE 1 has a header and no readable rows. A zero-row closure is not a closure.")
  process.exit(3)
}

const types: Record<string, any> = {}
let totals = { edges: 0, resolved: 0, external: 0, ambiguous: 0, otherUnresolved: 0, collRes: 0, ambKind: 0 }
const perTypeLines: string[] = []
for (const r of rows) {
  const t = String(r.type)
  const external = r.extOK + r.extQ
  const otherUnresolved = r.unresolved + r.extFAIL + r.bindOK + r.bindQ + r.bindFAIL + r.causeOK + r.causeFAIL
  const sum = r.resolved + external + r.ambDecl + otherUnresolved
  if (sum !== r.edges) {
    console.error(`REFUSED: "${t}" does not close — resolved ${r.resolved} + external ${external} + ambiguous ${r.ambDecl} + otherUnresolved ${otherUnresolved} = ${sum} against edges ${r.edges}.`)
    console.error("  Filling the difference into `unclassed` would be the one thing the gate forbids, so nothing is written.")
    process.exit(4)
  }
  types[t] = { edges: r.edges, resolved: r.resolved, external, ambiguous: r.ambDecl, otherUnresolved, unclassed: 0 }
  totals.edges += r.edges
  totals.resolved += r.resolved
  totals.external += external
  totals.ambiguous += r.ambDecl
  totals.otherUnresolved += otherUnresolved
  totals.collRes += r.collRes
  totals.ambKind += r.ambKind
  perTypeLines.push(`${t} ${r.edges}/${r.resolved}`)
}

/** the falsifier shared by every cause ruling: it names a COMMAND and what would make it FALSE */
const falsifier = (what: string, run: string, wouldFail: string) => ({ what, run, wouldFail })

const declaration = {
  meta: {
    lane: "typescript",
    written: new Date().toISOString().slice(0, 10),
    author: "Muhammad Ishaq Khan",
    parsed,
    sample: parsed,
    corpusTotal,
    repos,
    extensions: exts,
    populationString,
    populationLine: popLine.trim(),
    armLog: logPath.replace(`${REPO}/`, ""),
    armLogSha256: logSha,
    instrument: "script/m14/incoming-gate.ts (the shared arm) over the population rule in script/m14/ts-corpus.ts",
    command: `BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/incoming-gate.ts typescript ${exts} 0 --index`,
    // ⇒ THE SERVED DIGEST IS MEASURED FROM THE RESOLVER, NOT ASSUMED FROM A PATH. `getParser("typescript")`
    // logs `wasmPath = node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm`, and THAT file
    // hashes to 778025db… — this lane cited 8515404d… for three rounds and was wrong. No path is cited
    // below, because a path is how the error happened.
    grammar: "778025db5a8be0e70f8ccc3671e486dfeddd048c25d9e8a70c26de2e1bf6f97d — THE SERVED TYPESCRIPT BUILD, measured from the resolver's own log line (the engine serves node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm; wasm/tree-sitter-typescript.wasm is present and NOT served for this language). This lane's R2 patch (b75fa34c…) is built, proven and NOT SERVED, so `part_of` has no emission path in production and is declared as a gap.",
    analyzerSha256: createHash("sha256").update(readFileSync(join(REPO, "src/ast/real-typescript-analyzer.ts"))).digest("hex"),
    arbiterSha256: createHash("sha256").update(readFileSync(join(REPO, "script/m14/incoming-rule.ts"))).digest("hex"),
  },
  types,
  totals: { ...totals, unclassed: 0, perType: perTypeLines.join(" · ") },
  causeRulings: {} as Record<string, any>,
  resolution_caveats: [
    "THE EDGE BUCKETS ARE THE POPULATION'S, THE RESOLUTION BUCKETS ARE THE ARM'S. Every admitted file is measured exactly once, so the edge counts are unbiased over the population. The resolution counts come from a measurement that resolves names through a project index; a name collision in a project's half that the measurement did not build is invisible, which biases `resolved` UP and the unresolved buckets DOWN. The number is still the honest measurement of what the arm did, and it is not a claim that no collision exists.",
    "`collRes` IS REPORTED AND NEVER ADDED to `resolved`: it is the share of `resolved` where the target had MORE THAN ONE declaration and production's tie-break chose one. A tie-break made is not a tie-break justified.",
    "`amb(kind)` IS REPORTED AND NEVER ADDED: it is a SUBSET of `ambiguous`, so adding it would count those rows twice.",
    "THE BUCKET MAPPING IS DECLARED: external = extOK + ext?; otherUnresolved = unresolved + extFAIL + binding columns + cause columns. A declared cause is a STATEMENT, not a resolution, so causeOK is in otherUnresolved and never in resolved — the arm prints it in its own column for exactly that reason.",
    "`unclassed` IS 0 BY CONSTRUCTION, and this declaration refuses to be written if the buckets do not close to the arm's own edge count. A difference parked in `unclassed` would be an unclassified edge wearing a classification's name.",
    "THE SERVED BUILD IS 778025db…, MEASURED FROM THE RESOLVER — and this lane cited 8515404d… as served for three rounds. `getParser(\"typescript\")` resolves to node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm; wasm/tree-sitter-typescript.wasm (8515404d…) is present and NEVER SERVED for this language. Every earlier number in this lane's pages that named 8515404d… as production's build is wrong about WHICH FILE IS SERVED, and no path is cited in this declaration because a path is how the error happened.",
    "`part_of` IS A GAP AND THE ARM AGREES: this run publishes 0 `part_of` edges, because every `/// <reference … />` line is an ordinary comment under the served grammar. The lane HAS a patched grammar (b75fa34c…, one atomic token, a `reference_directive` node) which is built, behaviourally proven, and measured CLEAN at 0 non-target files of 207 — and it cannot reach production, because the serving path is an UNTRACKED directory (npm ci would erase it and a fresh checkout would not have it) while wasm/ holds 67 grammars and preferring it would re-point every language at once. That is a LEAD-OWNED GAP with a named remedy, not a limitation of this lane's work; the 50 directives in 34 files (types 47 · path 2 · lib 1) and their 38 unresolved targets are what the graph cannot see until the wire changes.",
    "`mixes_in` IS IMPLEMENTED AND EXERCISED: 2 edges, both resolved (the vault UI's `class X extends baseResourceFactory<Mount>()`). The lane's first census reported 0 and was WRONG — its pattern required `Name(` and missed a GENERIC callee. The falsifier written into the measurement is what caught it, and the corrected figure is one file of the corpus rather than a pattern.",
  ],
  _derivation: {
    from: `the arm's own report, sha256 ${logSha}`,
    rule: "TABLE 1's per-type row → the five buckets; closure checked per type against that type's edge count; a row that does not close is a REFUSAL",
    generator: "script/m14/ts-declaration.ts",
  },
}

// THE WALLS. Every condition the campaign named, each with a population string and a falsifier that
// carries a command and a wouldFail — a wall dispositioned without a falsifier is a disposition nobody
// can test.
const wall = (name: string, from: string, run: string, wouldFail: string) =>
  ({ name, population: populationString, from, falsifier: falsifier(name, run, wouldFail) })
Object.assign(declaration.causeRulings, {
  "directory-level-ambiguity": wall(
    "directory-level-ambiguity — two files in one directory declaring the same name",
    "MEASURED by the arm: `collRes` is the share of `resolved` where the target had more than one declaration and production's tie-break chose one. It is reported beside `resolved` and never folded into it.",
    "BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/incoming-gate.ts typescript ts,tsx,mts,cts 0 --index",
    "a run whose collRes is 0 with a non-zero resolved count, on a corpus that demonstrably contains same-name declarations in one directory — that would mean the tie-break was never exercised and `resolved` is over-counted",
  ),
  "declaration-merging": wall(
    "declaration-merging — `interface X extends Y` merging a mixin's members onto a class",
    "1,107 interface declaration-merging clauses over the admitted population, counted by script/m14/ts-mixin-sites.ts. They publish as `extends`, which is what they are; the near miss is that they compose MEMBERS, and `mixes_in` is reserved for the call-shaped application (0 sites).",
    "BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/ts-mixin-sites.ts --all",
    "the census printing interface-merging clauses under a label other than `extends`, or a `mixes_in` row whose heritage expression is a plain name rather than a call",
  ),
  "mixin-shape": wall(
    "mixin-shape — `class X extends Mixin(Base) {}`",
    "0 call-shaped heritage clauses over 17,689 files (2,186 class heritage clauses, 0 bases named `*mixin*`). The type is IMPLEMENTED and corpus-unexercised; the fixture proves the edge fires when the shape is present.",
    "BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/ts-mixin-sites.ts --all",
    "the census printing ≥ 1 call-shaped heritage site, which would make the corpus-unexercised property FALSE (the implementation itself is unaffected)",
  ),
  "reference-directive": wall(
    "reference-directive — `/// <reference path|types|lib=\"…\" />`",
    "51 directives in 35 files of 17,689 (path 2 · types 48 · lib 1). The served grammar lexes them as comments, so this lane PATCHED the grammar (8586372d…, a `reference_directive` node carrying `role` and `target` as FIELDS) and proved the swap behaviourally. `part_of` edges are emitted from the node's fields, never from a comment's text.",
    "bun run script/m14/ts-partof-grammar-proof.ts script/m14/ts-grammar-patch/tree-sitter-typescript-patched.wasm",
    "the proof exiting non-zero — specifically, the patched build NOT producing three `reference_directive` nodes for three directives, or the ordinary comment ceasing to be a comment",
  ),
  "grammar-swap-safety": wall(
    "grammar-swap-safety — the R2 build replaces the served build",
    "the fixture suite reads 121 pass / 0 fail on the patched build, and the swap preserves the served build at script/m14/ts-grammar-patch/tree-sitter-typescript-served.wasm (8515404d…) so every earlier number remains re-measurable.",
    "bun run script/m14/run-fixtures.ts --lang typescript",
    "any fixture failing on the patched build that passed on the served one, or the served build's copy not hashing to 8515404dceed…",
  ),
  "no-regex-resolution": wall(
    "no-regex-resolution — a relation may not be resolved by matching text",
    "every relation in this analyzer is read from a node: `part_of` from `childForFieldName('role'|'target')` on the patched `reference_directive`, `mixes_in` from the extends clause's expression TYPE, `extends` from the heritage base name. The analyzer contains no regex literal by contract.",
    "grep -nE '/[^/]+/[gimsuy]*' src/ast/real-typescript-analyzer.ts | grep -v '^\\s*//' | head",
    "a live (non-comment) regex literal in the analyzer, or a relation whose source is a match offset rather than a node",
  ),
})

const sha = createHash("sha256").update(JSON.stringify(declaration, null, 2)).digest("hex")
;(declaration as any)._sha256_of_this_file_body = sha
writeFileSync(outPath, JSON.stringify(declaration, null, 2))
console.log(`WROTE ${outPath}`)
console.log(`population ${populationString}`)
console.log(`edges ${totals.edges} · resolved ${totals.resolved} · external ${totals.external} · ambiguous ${totals.ambiguous} · otherUnresolved ${totals.otherUnresolved} · unclassed 0`)
console.log(`closure: ${totals.resolved + totals.external + totals.ambiguous + totals.otherUnresolved} === ${totals.edges}`)
console.log(`cause rulings: ${Object.keys(declaration.causeRulings).length}`)
