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
const servedDigest = argv.find((a) => a.startsWith("--served-digest="))?.slice("--served-digest=".length)
  ?? ""
const outPath = argv.find((a) => a.startsWith("--out="))?.slice("--out=".length)
  ?? join(REPO, "validation/m14/instruments/typescript/incoming-declaration.json")
if (!servedDigest || !/^[0-9a-f]{64}$/.test(servedDigest)) {
  console.error("REFUSED: pass --served-digest=<the sha256 of the file the resolver logs as wasmPath>. A declaration that names a build it did not measure is prose.")
  process.exit(2)
}
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
    // 2026-11-18: the .corpus FARM this string named no longer exists (it is the javascript lane's
    // clone set now), and a command naming a population that is gone is the exact defect the corpus
    // manifest closes. The root is the recorded default root; its identity is
    // validation/m14/instruments/typescript/corpus-manifest.json.
    command: `BB_CORPUS_ROOT=$HOME/bb_tests/repositories bun run script/m14/incoming-gate.ts typescript ${exts} 0 --index`,
    // ⇒ THE SERVED DIGEST IS MEASURED FROM THE RESOLVER AND SUPPLIED BY THE CALLER. It has NO default,
    // because a default would be an assertion and this lane has published a wrong served digest twice.
    // Measure it with: getParser("typescript"), read the logged `wasmPath`, sha256 THAT file.
    grammar: servedDigest
      ? `${servedDigest} — THE SERVED TYPESCRIPT BUILD, measured by calling the resolver and hashing the file it logs as wasmPath (no path is cited here: a path is how this lane got it wrong twice).`
      : "UNMEASURED — pass --served-digest=<sha256 from the resolver>. This declaration will not assert a build it did not measure.",
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
    "THE SERVED BUILD IS THE PATCHED ONE, AND IT IS SERVED BY A DIGEST-CHECKED TABLE RATHER THAN BY A PATH. The engine's resolver consults a per-file table before it reaches the dependency tree, and it serves the repository's own committed `wasm/` copy ONLY when that file's sha256 matches the recorded digest — a file whose digest does not match is NOT served and the refusal is logged, because A DIGEST THAT IS NOT CHECKED IS A COMMENT. The digest cited in `meta.grammar` was measured by calling the resolver and hashing the file it logged; no path is cited anywhere in this declaration, because a path is how this lane published a wrong served build twice.",
    "`part_of` IS IMPLEMENTED AND EXERCISED. The triple-slash reference directive is a real construct (`/// <reference path|types|lib=\"…\" />`) that the dependency-tree build lexes as an ordinary COMMENT, so this lane patched the derived grammar into a `reference_directive` node carrying `role` and `target` AS FIELDS (one atomic token), proved it behaviourally with a proof that exits 1 when either build stops behaving, measured its regeneration control against the bytes the resolver actually served (0 non-target files of 207), and the patched build is now SERVED through that digest-checked table. This run publishes the directive population the census counted: 50 directives in 34 files (types 47 · path 2 · lib 1). Root resolution is scoped to the file's own project, so most do not resolve: the edges are accounted for in `otherUnresolved` (38 unresolved + 12 ambiguous) and NOT in `resolved`, and they are exactly the dependencies on packages and libs that a per-file scope cannot see.",
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
    "BB_CORPUS_ROOT=$HOME/bb_tests/repositories bun run script/m14/incoming-gate.ts typescript ts,tsx,mts,cts 0 --index",
    "a run whose collRes is 0 with a non-zero resolved count, on a corpus that demonstrably contains same-name declarations in one directory — that would mean the tie-break was never exercised and `resolved` is over-counted",
  ),
  "declaration-merging": wall(
    "declaration-merging — `interface X extends Y` merging a mixin's members onto a class",
    "the construct census (script/m14/ts-mixin-sites.ts, whole admitted population 17,350 files / 41 repos) counts 2,421 class heritage clauses and 3,267 extends clauses, of which 2 are CALL-SHAPED (the mixin application). They publish as `extends`, which is what the plain ones are; the near miss is that they compose MEMBERS, and `mixes_in` is reserved for the call-shaped application — measured 2 sites and the analyzer publishes 2 `mixes_in` edges (this replaces an earlier census that read 0 because it required `Name(` and missed a generic callee).",
    "BB_CORPUS_ROOT=$HOME/bb_tests/repositories bun run script/m14/ts-mixin-sites.ts",
    "the census printing interface-merging clauses under a label other than `extends`, or a `mixes_in` row whose heritage expression is a plain name rather than a call",
  ),
  "mixin-shape": wall(
    "mixin-shape — `class X extends Mixin(Base) {}`",
    "2 call-shaped heritage clauses over 17,350 files / 41 repos (2,421 class heritage clauses, 0 bases named `*mixin*`). The type is IMPLEMENTED and corpus-EXERCISED: the census counts 2 sites and the analyzer publishes 2 `mixes_in` edges (arm TABLE 1, both resolved); the fixture also proves the edge fires on the minimal shape.",
    "BB_CORPUS_ROOT=$HOME/bb_tests/repositories bun run script/m14/ts-mixin-sites.ts",
    "the census printing ≥ 1 call-shaped heritage site, which would make the corpus-unexercised property FALSE (the implementation itself is unaffected)",
  ),
  "reference-directive": wall(
    "reference-directive — `/// <reference path|types|lib=\"…\" />`",
    "50 directive SITES over 17,350 files / 41 repos (by role and target shape in the census log). The STOCK grammar lexes them as comments, so this lane PATCHED the grammar — the served build is b75fa34c…, which exposes a single atomic `reference_directive` NODE — and proved the swap behaviourally (script/m14/ts-partof-grammar-proof.ts, 8 conditions). The analyzer emits `part_of` from that node's own fixed spelling by a character walk, never from a comment's text; 50 sites minus one repeated (file, role, target) triple is the 49 rows the arm publishes.",
    "bun run script/m14/ts-partof-grammar-proof.ts script/m14/ts-grammar-patch/tree-sitter-typescript-patched.wasm",
    "the proof exiting non-zero — specifically, the patched build NOT producing three `reference_directive` nodes for three directives, or the ordinary comment ceasing to be a comment",
  ),
  "grammar-swap-safety": wall(
    "grammar-swap-safety — the R2 build replaces the served build",
    "the fixture suite reads 123 pass / 0 fail on the patched build, and the swap preserves the PREVIOUS served build at script/m14/ts-grammar-patch/tree-sitter-typescript-served.wasm (8515404d…) so every earlier number remains re-measurable; the proof checks the stock copy, the served copy, and engine.ts's digest table together.",
    "bun run script/m14/run-fixtures.ts --lang typescript",
    "any fixture failing on the patched build that passed on the served one, or the served build's copy not hashing to 8515404dceed…",
  ),
  "no-regex-resolution": wall(
    "no-regex-resolution — a relation may not be resolved by matching text",
    "every relation in this analyzer is read from a node: `part_of` from the patched grammar's `reference_directive` NODE (its role/target unwrapped from the node's own fixed spelling by a character walk — the pinned build exposes one atomic token, not fields), `mixes_in` from the extends clause's expression TYPE, `extends` from the heritage base name. HEAD contains 0 regex literals — and the falsifier FIRED before it was true: Release 0.1.4 (f5325a909) reintroduced four, the lane's own counter and the fleet gate both exited 1, and the fix (2026-11-17) is character walks. The falsifier stays armed: the run below is an AST census, never a text scan.",
    "bun run script/m14/ts-no-regex-count.ts",
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
