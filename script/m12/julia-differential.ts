// script/m12/julia-differential.ts — Julia's OWN parser as the ground-truth arbiter.
//
// WHY THIS LANE CAN HAVE A REAL DIFFERENTIAL, AND WHY objc's could not
// -------------------------------------------------------------------
// A differential is worth the name only when the oracle is an INDEPENDENT implementation. This
// repo's own standard, applied to yaml, is that a truth file authored by the same hand as the
// analyzer is a MIRROR — eleven lanes' hand-authored truth files were rejected on that ground,
// and the Objective-C lane's F5 oracle walks the SAME TREE the grammar produced, so it cannot
// tell a removed phantom from a lost edge and therefore cannot referee a grammar change at all.
//
// Julia is the first lane here with a genuine second opinion available: **the language's own
// parser**, Julia 1.11.3, reached through `Meta.parseall`. It shares no code, no grammar, no
// parse table and no data model with tree-sitter-julia. If the two disagree about whether a file
// is valid, tree-sitter is wrong and Julia is right, and that is a decidable question rather
// than a matter of taste.
//
// WHAT IT IS ASKED, AND WHAT IT IS NOT
// -----------------------------------
// Asked, and answered per file: does Julia's parser accept this file? And if tree-sitter
// disagrees, where exactly, and what is the source text at that point? That single question
// turned up the lane's first real defect — `+%` and `-%`, Julia's wrapping add and subtract,
// which are valid infix operators in a toplevel parse and absent from tree-sitter-julia's
// operator table. Verified: `base/array.jl` parses in Julia with 400 toplevel expressions, and
// tree-sitter puts 2 ERROR nodes on it, both on the `+%`/`-%` line.
//
// The subtlety that makes this more than a yes/no, and which a naive harness gets exactly
// wrong: **`+%` is valid only in a toplevel parse.** `Meta.parse("f(a,b) = a +% b")` is a
// ParseError; `Meta.parseall("f(a,b) = a +% b")` is not, because Julia's operator resolution
// scope accumulates definitions across a toplevel sequence. So the oracle must be `parseall`,
// never `parse`, and an earlier version of a Julia probe that used `parse` concluded the
// construct was invalid when the language accepts it. That is the same class of error as
// objc's edge audit calling a block parameter an unresolved target: the instrument's model,
// reported as a fact about the product.
//
// NOT asked: whether the analyzer's SYMBOLS and RELATIONSHIPS are right. There is no analyzer
// yet, and when there is one, a symbol the analyzer misses is invisible to a parser-level
// oracle. This instrument's scope is grammar validity, and it says so.
//
// Usage:
//   bun run script/m12/julia-differential.ts [--per-file=N] [--julia=<path>]
// Writes: validation/m12/results/julia-differential.json
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs"
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { ASTEngine } from "../../src/ast/engine"
import { loadWebTreeSitter } from "../../src/util/wasm"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const OUT = path.join(ROOT, "validation/m12/results/julia-differential.json")
const CORPUS_ROOT = "$HOME/fixtures/repositories"
const WASM = path.join(ROOT, "wasm/tree-sitter-julia.wasm")
/**
 * `--wasm=<path>` compares an ALTERNATIVE wasm against the same Julia oracle, which is how a
 * grammar patch is landed rather than argued for. The three columns that matter are:
 * defects fixed, defects INTRODUCED, and files that flipped from clean to broken — a grammar
 * change that fixes 91 files and breaks 2 is a different proposition from one that fixes 91 and
 * breaks 0, and only a full-corpus A/B against an independent parser tells them apart.
 */

const REPOS = [
  { dir: "julia", rev: "63912639992190c6f56ad13286f292186513ab19" },
  { dir: "json_jl", rev: "a69c082" },
]
const juliaOk0 = (m: Map<string, any>) => { let n = 0; for (const v of m.values()) if ((v as any).parses === true) n++; return n }
const arg = (f: string, d?: string) => { const a = process.argv.find((x) => x.startsWith(`--${f}=`)); return a ? a.slice(f.length + 3) : d }
const WASM_ALT = arg("wasm")
const argPerFile = Number(arg("per-file", "0")!)
/**
 * `--constructs=<dir>` compares a directory of MINIMAL snippets instead of the corpus.
 *
 * The corpus answers "how many files"; it does not answer "which construct". This mode is how
 * a construct is named: write the smallest valid Julia that exercises it, and ask both parsers.
 * Every construct in this lane's defect inventory was named this way, and the two shapes that
 * looked like bugs and were not were also eliminated this way.
 *
 * It reuses this file's child rather than a second one, which is the whole point: the first
 * version of the probe carried its own child, used `eachline(STDIN)` — and `STDIN` is not bound
 * in Main under `julia -e`, so the child died with UndefVarError, emitted nothing, and the
 * probe read all 32 snippets as "Julia rejects them". Thirty-two fabricated defects, reported
 * with a table and a count. One working child, reused, is worth more than a second one.
 */
const CONSTRUCTS = arg("constructs")
const JULIA = arg("julia", "/tmp/opencode/julia-1.11.3/bin/julia")!

/**
 * One Julia process for the whole corpus, not one per file.
 *
 * A Julia start-up is ~200ms, so a per-file oracle would spend most of the run on start-up and
 * would make the harness look slower than the thing it measures. The child reads a JSON list of
 * paths on stdin, parses each with `Meta.parseall`, and writes one JSON line per file — and it
 * uses `Meta.parseall`, never `Meta.parse`, for the reason in the header: `parse` resolves
 * operators in a single-expression scope and rejects `+%`, which the language accepts.
 */
const CHILD = `
# No JSON, no encoding, no packages.
#
# The second version asked for \`using JSON\` and died with UndefVarError, because a stock Julia
# install has no JSON package in Main and installing one would make the oracle depend on the
# package manager — i.e. on the network, at differential time. A tab-delimited line is enough
# for three fields, filesystem paths contain no tabs, and the error text is stripped of them.
const T = '\t'
const paths = String[]
while !eof(stdin)
  line = readline(stdin)
  isempty(line) && continue
  push!(paths, line)
end
for p in paths
  try
    src = read(p, String)
    tl = Meta.parseall(src)
    println(stdout, "OK", T, p, T, string(length(getfield(tl, :args))))
  catch e
    msg = replace(first(sprint(showerror, e), 200), T => " ")
    println(stdout, "ERR", T, p, T, replace(msg, "\n" => " | "))
  end
end
`

async function main() {
  await ASTEngine.getParser("objective-c")
  const mod = await loadWebTreeSitter()
  const parser = new mod.Parser()
  parser.setLanguage(await mod.Language.load(WASM))
  let altParser: any = null
  if (WASM_ALT) { altParser = new mod.Parser(); altParser.setLanguage(await mod.Language.load(WASM_ALT)) }

  // ---- the inputs: a corpus, or a directory of minimal constructs ----
  const targets: { repo: string; rel: string; abs: string; bytes: number }[] = []
  if (CONSTRUCTS) {
    const d = path.resolve(CONSTRUCTS)
    for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".jl")).sort()) {
      const abs = path.join(d, f)
      targets.push({ repo: "constructs", rel: f, abs, bytes: statSync(abs).size })
    }
  } else
  if (!CONSTRUCTS) for (const r of REPOS) {
    const dir = path.join(CORPUS_ROOT, r.dir)
    if (!fs.existsSync(dir)) { console.log(`  (absent: ${r.dir})`); continue }
    let ls = ""
    try { ls = execSync("git ls-files '*.jl'", { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }) } catch { continue }
    for (const f of ls.split("\n").filter((x) => x.trim())) {
      const abs = path.join(dir, f)
      let bytes = 0
      try { bytes = statSync(abs).size } catch { continue }
      targets.push({ repo: r.dir, rel: f, abs, bytes })
    }
  }
  // The non-Julia IR dumps are excluded by CONTENT, measured and declared by julia-census.ts.
  const isIRDump = (abs: string) => { try { return /^\s*\d+\s+\(/m.test(readFileSync(abs, "utf8")) } catch { return false } }
  const juliaFiles = CONSTRUCTS ? targets : targets.filter((t) => !isIRDump(t.abs))
  const skippedNonJulia = targets.length - juliaFiles.length
  const chosen = argPerFile > 0 && juliaFiles.length > argPerFile
    ? Array.from({ length: argPerFile }, (_, i) => juliaFiles[Math.floor((i * juliaFiles.length) / argPerFile)]!)
    : juliaFiles

  if (!fs.existsSync(JULIA)) {
    console.error(`julia binary not found at ${JULIA} — pass --julia=<path>. This instrument has no other oracle: a mirror would not be a differential.`)
    process.exit(2)
  }

  // ---- one Julia process, fed every path ----
  const child = Bun.spawn([JULIA, "-e", CHILD], { stdin: "pipe", stdout: "pipe", stderr: "pipe" })
  const enc = new TextEncoder()
  for (const t of chosen) child.stdin.write(enc.encode(t.abs + "\n"))
  child.stdin.end()
  const outBuf = await new Response(child.stdout).text()
  const errBuf = await new Response(child.stderr).text()
  child.kill()
  const verdict = new Map<string, any>()
  let unparsedLines = 0
  for (const line of outBuf.split("\n").filter((x) => x.trim())) {
    const parts = line.split("\t")
    if (parts.length < 3) { unparsedLines++; continue }
    const [tag, file, rest] = parts
    if (tag === "OK") verdict.set(file!, { parses: true, toplevelExprs: Number(rest) })
    else if (tag === "ERR") verdict.set(file!, { parses: false, error: rest })
    else unparsedLines++
  }

  // A DIFFERENTIAL THAT GOES GREEN BECAUSE ITS ORACLE IS DEAD IS THE WORST FAILURE MODE THIS
  // TOOL COULD HAVE, so it is checked before anything is reported: the first version of this
  // harness "agreed" on 949 files while the oracle had returned nothing at all, because a
  // verdict of `parses: false` for every file is indistinguishable from a genuine sweep
  // unless the oracle's own coverage is counted. `no verdict from the oracle` is a LOUD
  // failure, not a default.
  const oracleDead = verdict.size === 0 || unparsedLines > 0 || (juliaOk0(verdict) === 0 && chosen.length > 0)
  if (oracleDead) {
    console.error(`ORACLE DEAD: ${verdict.size} verdict(s) for ${chosen.length} file(s), ${unparsedLines} unparsed line(s).`)
    console.error(`  julia: ${JULIA}`)
    if (errBuf.trim()) console.error(`  child stderr: ${errBuf.trim().slice(0, 600)}`)
    console.error("  A differential with no oracle is not a differential. Fix the oracle; do not read the verdict.")
    process.exit(3)
  }

  // ---- the disagreement ----
  const rows: any[] = []
  let juliaOk = 0, juliaFail = 0, tsClean = 0, tsError = 0, missingVerdicts = 0
  const tsRejectsValidJulia: any[] = []   // the lane's real defects
  const juliaRejectsWhatTsAccepts: any[] = []
  const bothError: any[] = []
  let bothClean = 0

  for (const t of chosen) {
    const src = readFileSync(t.abs, "utf8")
    const tree = parser.parse(src)
    let errs = 0
    const firstErr: any = { row: -1, text: "" }
    const st: any[] = [tree.rootNode]
    while (st.length) {
      const n = st.pop()!
      if (n.type === "ERROR") {
        errs++
        if (firstErr.row < 0) firstErr.row = n.startPosition.row
      }
      for (let i = n.childCount - 1; i >= 0; i--) st.push(n.child(i))
    }
    let altErrs: number | null = null
    if (altParser) {
      const at = altParser.parse(src)
      altErrs = 0
      const ast: any[] = [at.rootNode]
      while (ast.length) { const n = ast.pop()!; if (n.type === "ERROR" || n.type === "MISSING") altErrs++; for (let i = n.childCount - 1; i >= 0; i--) ast.push(n.child(i)) }
    }
    const v = verdict.get(t.abs)
    if (!v) { missingVerdicts++; continue }
    const v2: any = v
    const jOk = v2.parses === true
    const lines = src.split("\n")
    if (jOk) juliaOk++; else juliaFail++
    if (errs > 0) tsError++; else tsClean++

    const row = {
      repo: t.repo, file: t.rel, bytes: t.bytes,
      julia: { parses: jOk, toplevelExprs: v2.toplevelExprs ?? null, error: v2.error ?? null },
      treeSitter: { errorNodes: errs, firstErrorLine: firstErr.row >= 0 ? firstErr.row + 1 : null, firstErrorText: firstErr.row >= 0 ? (lines[firstErr.row] ?? "").trim().slice(0, 140) : null },
    }
    if (altErrs !== null) row.treeSitterAlt = { errorNodes: altErrs }
    if (jOk && errs > 0) { row.classification = "TS REJECTS VALID JULIA — a grammar defect"; tsRejectsValidJulia.push(row) }
    else if (!jOk && errs === 0) { row.classification = "julia rejects, tree-sitter accepts — likely a Julia-side limit, not a tree-sitter defect"; juliaRejectsWhatTsAccepts.push(row) }
    else if (!jOk && errs > 0) { row.classification = "both report an error"; bothError.push(row) }
    else { row.classification = "both clean"; bothClean++ }
    rows.push(row)
  }

  const payload = {
    schemaVersion: 1,
    milestone: "M12",
    rule: "Julia grammar validity vs Julia's own parser",
    generatedAt: new Date().toISOString(),
    oracle: {
      kind: "the language's own parser — an independent implementation",
      julia: JULIA,
      version: execSync(`${JULIA} --version`, { encoding: "utf8" }).trim(),
      entryPoint: "Meta.parseall",
      whyParseallNotParse: "`Meta.parse` resolves operators in a single-expression scope and REJECTS `a +% b`; `Meta.parseall` accepts it, because Julia accumulates operator definitions across a toplevel sequence. An oracle built on `parse` would have reported the language's own wrapping-add operator as invalid — the same class of error as objc's edge audit calling a block parameter an unresolved target: the instrument's model reported as a fact about the product.",
      independence: "shares no code, no grammar, no parse table and no data model with tree-sitter-julia. A truth file authored by the analyzer's own hand is a MIRROR by this repo's standard, which is why the yaml lane used PyYAML and why objc's F5 oracle cannot referee a grammar change at all.",
    },
    scope: "GRAMMAR VALIDITY ONLY. This is not a symbol or relationship differential — there is no analyzer yet, and a missing symbol is invisible to a parser-level oracle. It is stated here so the number is not read as more than it is.",
    oracleHealth: { verdictsReturned: verdict.size, filesCompared: chosen.length, unparsedChildLines: unparsedLines, filesWithNoVerdict: missingVerdicts, childStderr: errBuf.trim().slice(0, 400) || null },
    corpus: { repos: REPOS.map((r) => r.dir), tracked: targets.length, skippedNonJuliaIRDumps: skippedNonJulia, compared: chosen.length, sampled: argPerFile > 0 },
    totals: {
      juliaAccepts: juliaOk, juliaRejects: juliaFail,
      treeSitterClean: tsClean, treeSitterWithErrors: tsError,
      bothClean, tsRejectsValidJulia: tsRejectsValidJulia.length,
      juliaRejectsWhatTsAccepts: juliaRejectsWhatTsAccepts.length,
      bothError: bothError.length,
      agreementPct: chosen.length ? +(100 * (bothClean + bothError.length) / chosen.length).toFixed(2) : null,
    },
    defectClass: tsRejectsValidJulia,
    notes: juliaRejectsWhatTsAccepts,
    rows,
    alternateWasm: WASM_ALT ? { path: WASM_ALT, bytes: statSync(WASM_ALT).size } : null,
    aB: WASM_ALT ? (() => {
      let altClean = 0, altErrFiles = 0, fixed = 0, broke = 0, same = 0
      for (const r of rows) {
        const now = r.treeSitter.errorNodes > 0
        const alt = (r.treeSitterAlt?.errorNodes ?? 0) > 0
        if (alt) altErrFiles++; else altClean++
        if (now && !alt) fixed++
        else if (!now && alt) broke++
        else same++
      }
      return { baselineErrorFiles: rows.filter((r: any) => r.treeSitter.errorNodes > 0).length, altErrorFiles: altErrFiles, altClean, fixed, broke, unchanged: same,
        verdict: broke === 0 ? `ALT fixes ${fixed} file(s), breaks 0, ${same} unchanged` : `ALT fixes ${fixed} but BREAKS ${broke}` }
    })() : null,
    verdict:
      tsRejectsValidJulia.length === 0
        ? `AGREEMENT: tree-sitter accepts every file Julia accepts and rejects nothing valid. ${bothClean} files both clean, ${bothError.length} both in error.`
        : `${tsRejectsValidJulia.length} file(s) that JULIA ACCEPTS are rejected by tree-sitter — grammar defects, not corpus noise. ` +
          `${bothClean} files both clean, ${bothError.length} both in error. ${juliaRejectsWhatTsAccepts.length} file(s) Julia rejects that tree-sitter accepts.`,
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n")

  console.log(`oracle: ${payload.oracle.version}  entry ${payload.oracle.entryPoint}`)
  console.log(`corpus: ${chosen.length} files compared (${skippedNonJulia} non-Julia IR dumps skipped)${argPerFile > 0 ? ` SAMPLED ${argPerFile}` : ""}\n`)
  console.log(`  julia accepts   ${juliaOk}`)
  console.log(`  julia rejects   ${juliaFail}`)
  console.log(`  tree-sitter clean ${tsClean}   with errors ${tsError}`)
  console.log(`  both clean ${bothClean}   both error ${bothError.length}   julia rejects what ts accepts ${juliaRejectsWhatTsAccepts.length}\n`)
  console.log(`  *** TS REJECTS VALID JULIA: ${tsRejectsValidJulia.length} file(s) — GRAMMAR DEFECTS ***`)
  for (const r of tsRejectsValidJulia.slice(0, 14))
    console.log(`    ${String(r.treeSitter.errorNodes).padStart(4)}E  ${r.file}:${r.treeSitter.firstErrorLine}  ${r.treeSitter.firstErrorText}`)
  if (tsRejectsValidJulia.length > 14) console.log(`    … and ${tsRejectsValidJulia.length - 14} more`)
  if (payload.aB) { console.log(`\n  A/B vs ${WASM_ALT.split("/").pop()}: ${payload.aB.verdict}`); console.log(`     error files ${payload.aB.baselineErrorFiles} -> ${payload.aB.altErrorFiles}`) }
  console.log(`\nVERDICT: ${payload.verdict}`)
  console.log(`-> ${path.relative(ROOT, OUT)}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
