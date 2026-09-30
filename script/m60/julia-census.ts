// script/m60/julia-census.ts — grammar health over the Julia corpus, BEFORE an analyzer exists.
//
// THE ORDER IS THE POINT
// ---------------------
// Every lane in this repo was written first and measured afterwards, and the measurement is
// what found the defects: the Objective-C lane carried two reviews and a CLOSED marker over a
// corpus instrument that was reading 7 of the 329 files the router admits, and its
// `grammarErrorFiles: 0` was backed by an artifact recording 49 crashes counted as 49 clean
// parses. Julia is the chance to do this in the right order, and the order is: grammar health
// first, because an analyzer written against an unmeasured grammar inherits every defect the
// grammar has and then debugs itself for a day.
//
// So this tool exists before src/ast/real-julia-analyzer.ts does, and it is deliberately the
// only thing in the lane so far. Its questions are the grammar's, not the analyzer's:
//
//   1. DOES IT PARSE.  ERROR / MISSING node counts per file, from the wired wasm directly.
//   2. WHAT IS THE SURFACE. Every named node type the grammar declares, how often each occurs,
//      and — the one that finds real bugs — which declared types NEVER occur in 950 real
//      files, because a node type that never fires is either dead grammar or a construct the
//      corpus does not contain, and the two are indistinguishable without saying so.
//   3. WHAT IS MISSING FROM THE SURFACE. Node types the tree actually PRODUCES that the
//      grammar's own node-types.json does not declare. That direction finds a stale or
//      hand-edited node-types.json, which is the failure the source<->wasm pin exists to catch.
//   4. ARE THE EXTERNAL SCANNER'S OUTPUTS HONOURED. Julia's grammar ships a `scanner.c` — an
//      external scanner for string interpolation and other lexical states a context-free
//      grammar cannot decide. A scanner whose tokens are silently not produced shows up as
//      ERROR nodes far from their cause, so the scanner's token names are compared against
//      what the tree actually contains.
//
// Provenance, because it decides what every number here means: the wired bytes are
// tree-sitter-julia@0.23.1's OWN published wasm from the npm tarball, byte-identical, with
// src/grammar.json and src/node-types.json shipped in the same tarball. That is the
// `byte-identical-to-npm-tarball` kind — the strongest in the registry, and unlike the
// Objective-C lane this one can be pinned from pristine bytes with nothing patched.
//
// Usage: bun run script/m60/julia-census.ts [--per-repo=0] [--max-bytes=N]
// Writes: validation/m60/results/julia-census.json
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs"
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { createHash } from "node:crypto"
import { ASTEngine } from "../../src/ast/engine"
import { loadWebTreeSitter } from "../../src/util/wasm"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const OUT = path.join(ROOT, "validation/m60/results/julia-census.json")
const CORPUS_ROOT = "$HOME/fixtures/repositories"
const WASM = path.join(ROOT, "wasm/tree-sitter-julia.wasm")
const GRAMMAR_DIR = path.join(ROOT, "grammars/tree-sitter-julia")
const PKG = "tree-sitter-julia@0.23.1"

const REPOS = [
  { dir: "julia", rev: "63912639992190c6f56ad13286f292186513ab19", role: "the language itself — stdlib, Compiler, base, test" },
  { dir: "json_jl", rev: "a69c082", role: "a real downstream package, for a second opinion" },
]

const argNum = (f: string, d: number) => { const a = process.argv.find((x) => x.startsWith(`--${f}=`)); return a ? Number(a.slice(f.length + 3)) : d }
const argPerRepo = argNum("per-repo", 0)
const argMaxBytes = argNum("max-bytes", 0)

/** The external scanner's token names, read from the vendored scanner.c. */
function scannerExternals(): string[] {
  const p = path.join(GRAMMAR_DIR, "scanner.c")
  if (!fs.existsSync(p)) return []
  const src = readFileSync(p, "utf8")
  const out = new Set<string>()
  for (const m of src.matchAll(/\[\s*sym_([A-Za-z0-9_]+)\s*\]/g)) out.add(m[1]!)
  return [...out].sort()
}

async function main() {
  await ASTEngine.getParser("objective-c")
  const mod = await loadWebTreeSitter()
  const lang = await mod.Language.load(WASM)

  const declaredNames = new Set<string>()
  const declaredSupertypes: string[] = []
  const nodeTypesPath = path.join(GRAMMAR_DIR, "src/node-types.json")
  if (fs.existsSync(nodeTypesPath)) {
    for (const t of JSON.parse(readFileSync(nodeTypesPath, "utf8"))) {
      if (t.named) declaredNames.add(t.type)
      if (t.subtypes) declaredSupertypes.push(t.type)
    }
  }

  const typeOccurrences = new Map<string, number>()
  const filesByType = new Map<string, Set<string>>()
  const producedNames = new Set<string>()
  const scannerSeen = new Set<string>()
  const scannerTotal = new Map<string, number>()
  const externals = scannerExternals()
  for (const e of externals) scannerTotal.set(e, 0)

  let scanned = 0, skippedBig = 0, parseFailed = 0
  let excludedFiles = 0, excludedErrorNodes = 0, excludedMissingNodes = 0
  let errorNodes = 0, missingNodes = 0, errorFiles = 0
  const perRepo: any[] = []
  const errorFileRows: any[] = []
  let totalBytes = 0
  const errorShapes = new Map<string, { n: number; files: Set<string>; example: string }>()

  for (const r of REPOS) {
    const dir = path.join(CORPUS_ROOT, r.dir)
    if (!fs.existsSync(dir)) { console.log(`  (absent: ${r.dir})`); continue }
    let ls = ""
    try { ls = execSync("git ls-files '*.jl'", { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }) } catch { continue }
    let files = ls.split("\n").filter((x) => x.trim())
    if (argPerRepo > 0 && files.length > argPerRepo)
      files = Array.from({ length: argPerRepo }, (_, i) => files[Math.floor((i * files.length) / argPerRepo)]!)
    const rStat: any = { repo: r.dir, rev: r.rev, role: r.role, files: 0, bytes: 0, errorFiles: 0, errorNodes: 0, missingNodes: 0, irDumpFiles: 0, dirs: new Map<string, any>() }
    for (const f of files) {
      const abs = path.join(dir, f)
      let bytes = 0
      try { bytes = statSync(abs).size } catch { continue }
      if (argMaxBytes > 0 && bytes > argMaxBytes) { skippedBig++; continue }
      let src: string
      try { src = readFileSync(abs, "utf8") } catch { continue }
      let tree: any
      try { const p = new mod.Parser(); p.setLanguage(lang); tree = p.parse(src) } catch { parseFailed++; continue }
      scanned++; rStat.files++; rStat.bytes += bytes; totalBytes += bytes

      let fErr = 0, fMiss = 0
      const stack: any[] = [tree.rootNode]
      while (stack.length) {
        const n = stack.pop()
        if (n.type === "ERROR") fErr++
        else if (n.type === "MISSING") fMiss++
        if (n.isNamed) {
          producedNames.add(n.type)
          typeOccurrences.set(n.type, (typeOccurrences.get(n.type) ?? 0) + 1)
          if (!filesByType.has(n.type)) filesByType.set(n.type, new Set())
          filesByType.get(n.type)!.add(f)
          const base = n.type.replace(/_\d+$/, "")
          if (scannerTotal.has(base)) { scannerTotal.set(base, (scannerTotal.get(base) ?? 0) + 1); scannerSeen.add(base) }
        }
        for (let i = n.childCount - 1; i >= 0; i--) { const c = n.child(i); if (c) stack.push(c) }
      }
      // The IR-test dumps are not Julia. `git ls-files '*.jl'` returns them because they carry
      // the extension, and a sparse checkout cannot tell a language file from a textual dump of
      // that language's COMPILER OUTPUT. They are identified by CONTENT, not by directory name,
      // because a name-based exclusion is cherry-picking and would hide a real defect if the
      // grammar ever broke on a file that happened to sit in that directory:
      //
      //     1   (call core.declare_global TestMod :f false)
      //     6   (return %₅)
      //
      // i.e. numbered steps in a Lisp-like s-expression notation. The count is measured both
      // ways and reported both ways, never silently dropped.
      const isIRDump = /^\s*\d+\s+\(/m.test(src)
      const dirKey = path.dirname(f).split("/").slice(0, 2).join("/")
      let dk = rStat.dirs.get(dirKey)
      if (!dk) { dk = { files: 0, errorFiles: 0, errorNodes: 0, irDumpFiles: 0 }; rStat.dirs.set(dirKey, dk) }
      dk.files++
      if (isIRDump) { dk.irDumpFiles++; rStat.irDumpFiles++; excludedFiles++; excludedErrorNodes += fErr; excludedMissingNodes += fMiss }
      if (fErr || fMiss) { dk.errorFiles++; dk.errorNodes += fErr }

      // Parenthesised deliberately: `fErr || fMiss && !isIRDump` parses as
      // `fErr || (fMiss && !isIRDump)`, so a file with ERROR nodes counted regardless
      // of the exclusion and the 20.91% rate never moved. The corpus is not uniform
      // and the headline number has to be the one that excludes non-Julia.
      if ((fErr || fMiss) && !isIRDump) {
        errorFiles++; errorNodes += fErr; missingNodes += fMiss
        rStat.errorFiles++; rStat.errorNodes += fErr; rStat.missingNodes += fMiss
        // the first error's own text, which is what names a SHAPE
        const st2: any[] = [tree.rootNode]
        let first: any = null
        while (st2.length && !first) { const n = st2.pop(); if (n.type === "ERROR") { first = n; break } for (let i = n.childCount - 1; i >= 0; i--) { const c = n.child(i); if (c) st2.push(c) } }
        if (first) {
          // The first version of this took the ERROR's own first LINE and reported
          // `# This file is a part of Julia. License is MIT` as the single most common error
          // shape, across 34 files — which reads like a comment-parsing bug and is not one.
          // A deep error's span can START at a comment or a blank line, so the shape was
          // describing where the wreckage BEGAN, not what broke. The shape is now the first
          // line with actual token content, and a span wider than 4 lines is labelled as a
          // region rather than quoted, because quoting one line of a 2,915-node error is
          // quoting an arbitrary choice.
          const raw = src.slice(first.startIndex, first.endIndex)
          const spanLines = raw.split("\n").length
          const own = (raw.split("\n").find((l) => /\S/.test(l)) ?? "").trim().slice(0, 60)
          const shape = spanLines > 4 ? `(region of ${spanLines} lines)` : own || "(empty)"
          if (!errorShapes.has(shape)) errorShapes.set(shape, { n: 0, files: new Set(), example: `${f}:${first.startPosition.row + 1}` })
          const g = errorShapes.get(shape)!
          g.n++; g.files.add(f)
        }
        errorFileRows.push({ file: f, repo: r.dir, bytes, errorNodes: fErr, missingNodes: fMiss })
      }
    }
    perRepo.push(rStat)
  }

  // A SUPERTYPE is declared and never produced BY DESIGN — it names a category, not a node.
  // `ERROR` is tree-sitter's own built-in, not something the grammar declares. The first
  // version of this check reported both as findings, which is how a clean surface reads as
  // having four problems.
  const supertypeSet = new Set(declaredSupertypes)
  const BUILTIN = new Set(["ERROR", "MISSING"])
  const declaredNotProduced = [...declaredNames].filter((n) => !producedNames.has(n) && !supertypeSet.has(n)).sort()
  const producedNotDeclared = [...producedNames].filter((n) => !declaredNames.has(n) && !BUILTIN.has(n)).sort()
  const declaredSupertypesNeverNamed = [...supertypeSet].filter((n) => !producedNames.has(n)).sort()
  const corpusNeverFires = [...producedNames].filter((n) => (typeOccurrences.get(n) ?? 0) === 0)

  const rows = [...producedNames].map((n) => ({ type: n, occurrences: typeOccurrences.get(n) ?? 0, files: filesByType.get(n)?.size ?? 0, declared: declaredNames.has(n) })).sort((a, b) => b.occurrences - a.occurrences)

  const payload = {
    schemaVersion: 1,
    milestone: "M60",
    rule: "Julia grammar health over the corpus, before any analyzer exists",
    generatedAt: new Date().toISOString(),
    why:
      "every lane in this repo was written first and measured afterwards, and the measurement is what found the " +
      "defects — the Objective-C lane was CLOSED over an instrument reading 7 of 329 files whose '0 grammar errors' " +
      "was 49 crashes counted as 49 clean parses. This tool exists before the analyzer does, so the analyzer is " +
      "written against a MEASURED grammar instead of inheriting its defects and debugging itself for a day.",
    provenance: {
      wasm: path.relative(ROOT, WASM),
      bytes: fs.existsSync(WASM) ? statSync(WASM).size : null,
      sha256: fs.existsSync(WASM) ? createHash("sha256").update(readFileSync(WASM)).digest("hex") : null,
      package: PKG,
      kind: "byte-identical-to-npm-tarball",
      note: "the tarball ships its OWN wasm, and src/grammar.json + src/node-types.json + scanner.c, so this lane is pinnable from pristine published bytes with nothing patched — the strongest provenance kind in the registry, and unlike objective-c there is no local rebuild to justify",
    },
    repos: REPOS.map((r) => r.dir),
    files: perRepo.map((r: any) => ({ ...r, dirs: Object.fromEntries([...r.dirs.entries()].sort((a: any, b: any) => b[1].errorNodes - a[1].errorNodes)) })),
    nonJuliaIRDumpFiles: excludedFiles,
    corpusNote: "the headline grammar-health figures EXCLUDE the measured non-Julia IR test dumps, identified by CONTENT (numbered steps in an s-expression notation) rather than by directory name, because a name-based exclusion is cherry-picking and would hide a real defect if the grammar broke on a file that happened to sit there. The excluded count and its error nodes are stated, not dropped.",
    scanned, parseFailed, skippedBig,
    totalBytes,
    grammarHealth: {
      errorNodes, missingNodes, errorFiles,
      filesConsidered: scanned - perRepo.reduce((n: number, r: any) => n + r.irDumpFiles, 0),
      irDumpFilesExcluded: perRepo.reduce((n: number, r: any) => n + r.irDumpFiles, 0),
      excludedAsNonJulia: { files: excludedFiles, errorNodes: excludedErrorNodes, missingNodes: excludedMissingNodes },
      errorFilePct: scanned ? +(100 * errorFiles / scanned).toFixed(2) : null,
      topErrorShapes: [...errorShapes.entries()].map(([shape, g]) => ({ shape, errorFiles: g.n, files: g.files.size, example: g.example })).sort((a, b) => b.errorFiles - a.errorFiles).slice(0, 25),
    },
    surface: {
      declaredNamedTypes: declaredNames.size,
      declaredSupertypes,
      declaredSupertypesNeverNamed,
      note: "a declared SUPERTYPE is never produced by design — it names a category, not a node — and ERROR/MISSING are tree-sitter built-ins rather than grammar declarations. Both are excluded from the findings and listed separately so the exclusion is visible.",
      producedNamedTypes: producedNames.size,
      declaredNotProduced,
      producedNotDeclared,
      typesThatNeverFire: corpusNeverFires,
      rows,
    },
    externalScanner: {
      scannerSource: path.relative(ROOT, path.join(GRAMMAR_DIR, "scanner.c")),
      declaredExternals: externals,
      observed: [...scannerSeen].sort(),
      neverObserved: externals.filter((e) => (scannerTotal.get(e) ?? 0) === 0),
      note: "Julia's grammar has an external scanner (string interpolation and lexical states a context-free grammar cannot decide). A scanner whose tokens are silently not produced shows up as ERROR nodes far from their cause, so its token names are compared against what the tree actually contains.",
    },
    errorFileRows: errorFileRows.sort((a, b) => b.errorNodes - a.errorNodes).slice(0, 60),
    verdict:
      errorNodes === 0 && missingNodes === 0
        ? `grammar is CLEAN over ${scanned} real files (${(totalBytes / 1048576).toFixed(1)} MB): 0 ERROR nodes, 0 MISSING. ${producedNames.size} named types produced, ${declaredNotProduced.length} declared but never produced.`
        : `${errorFiles} of ${scanned} files carry ERROR/MISSING nodes: ${errorNodes} ERROR, ${missingNodes} MISSING ` +
          `(${scanned ? +(100 * errorFiles / scanned).toFixed(2) : 0}% of files). ${producedNames.size} named types produced; ` +
          `${declaredNotProduced.length} declared but never produced; ${producedNotDeclared.length} produced but undeclared.`,
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n")

  console.log(`corpus: ${REPOS.length} repos, ${scanned} files, ${(totalBytes / 1048576).toFixed(1)} MB   parse failures ${parseFailed}`)
  for (const f of perRepo) console.log(`  ${f.repo.padEnd(10)} ${String(f.files).padStart(4)} files  ${(f.bytes / 1048576).toFixed(1)} MB  ${f.errorFiles} error files  ${f.errorNodes}E/${f.missingNodes}M`)
  console.log(`\nGRAMMAR HEALTH: ${errorFiles}/${scanned} files with errors (${payload.grammarHealth.errorFilePct}%)   ${errorNodes} ERROR   ${missingNodes} MISSING`)
  if (errorFileRows.length) {
    console.log("  worst files:")
    for (const e of errorFileRows.slice(0, 8)) console.log(`    ${String(e.errorNodes).padStart(4)}E  ${e.file}`)
    console.log("  top error shapes:")
    for (const s of payload.grammarHealth.topErrorShapes.slice(0, 8)) console.log(`    ${String(s.errorFiles).padStart(4)} files  ${s.shape}`)
    console.log("\n  per-directory error rate (top 10 by error nodes) — the corpus is NOT uniform:")
    for (const r of payload.files) for (const [dir, d] of Object.entries(r.dirs).slice(0, 10)) {
      if (!d.errorNodes) continue
      console.log(`    ${String(d.errorNodes).padStart(6)}E  ${String(d.files).padStart(4)} files  ${(dir || "(root)").padEnd(28)} ir-dumps ${d.irDumpFiles}`)
    }
  }
  console.log(`\nSURFACE: ${declaredNames.size} declared named types, ${producedNames.size} produced`)
  console.log(`  declared but never produced: ${declaredNotProduced.length}${declaredNotProduced.length ? "  " + declaredNotProduced.slice(0, 12).join(", ") : ""}`)
  console.log(`  produced but undeclared:     ${producedNotDeclared.length}${producedNotDeclared.length ? "  " + producedNotDeclared.slice(0, 12).join(", ") : ""}`)
  console.log(`\nEXTERNAL SCANNER (${externals.length} declared tokens):`)
  console.log(`  observed:      ${[...scannerSeen].sort().join(", ") || "none"}`)
  console.log(`  never observed: ${externals.filter((e) => (scannerTotal.get(e) ?? 0) === 0).join(", ") || "none"}`)
  console.log(`\ntop 18 node types by occurrence:`)
  for (const r of rows.slice(0, 18)) console.log(`  ${String(r.occurrences).padStart(8)}  ${String(r.files).padStart(4)} files  ${r.type}`)
  console.log(`\nVERDICT: ${payload.verdict}`)
  console.log(`-> ${path.relative(ROOT, OUT)}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
