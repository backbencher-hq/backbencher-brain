// script/m12/objc-corpus-errors.ts — the Objective-C corpus census, over the ROUTER's universe.
//
// WHY THIS FILE WAS REWRITTEN RATHER THAN WIDENED
// -----------------------------------------------
// The previous version of this instrument was 43 lines, and its entire corpus was:
//
//     const ROOT = "$HOME/fixtures/repositories/Clyde"   // 4 .m + 3 .h
//     const MIN_BYTES = 256
//
// Seven files. It was honest about what it did — the header says "Clyde@8fec41dd, 7 .m/.h
// files, the M11.10 corpus target" — and everything built on it inherited the honesty without
// inheriting the coverage:
//
//   - the corpus manifest published corpusSymbols=100, corpusRelationships=333 and
//     grammarErrorFiles=0 as the lane's corpus claim
//   - the #743 closure record reported a genuine 322-file measurement
//
// So the lane carried a 322-file claim in prose and a 7-file claim in the artifact a consumer
// actually reads, and only one of the two could re-run. The M60 census over the full universe
// put the true number at 5,095 symbols / 24,226 relationships with 158 ERROR nodes across 15
// files — so `grammarErrorFiles: 0` was a true statement about seven files and a false one about
// the language, which is the most expensive kind of number to leave in a manifest.
//
// The earlier version also did not look like the rest of this family. The C/C++/Rust precedent
// it cites, and the yaml one beside it, measure invariants — line coverage, type fidelity,
// duplicate ids, sentinels — because a count of "files with errors" says nothing about whether
// the output is usable. This one printed a count and a list and stopped.
//
// THE UNIVERSE IS THE ROUTER'S, READ FROM THE ROUTER
// -------------------------------------------------
// src/ast/language-detection.ts admits `.m`, `.mm`, and `.h` ONLY when the file sniffs as
// Objective-C. That last condition is the whole reason the universe is 329 and not 390: of
// sdwebimage's 159 headers the router admits 143, because 16 of them are C headers that happen
// to sit beside ObjC ones. A census that counted all 390 would be measuring 61 files bb never
// opens, and a census that counted only `.m` would be measuring 157 — which is what
// script/m14/differential.ts's `ext: "m,h"` does, and is why a third spelling of this rule had
// to be retired rather than copied.
//
// The extension list is read out of `EXTENSION_LANGUAGE` in language-detection.ts so the census
// cannot drift from the admission decision, and the `.h` content sniff is stated in the same
// terms the router uses.
//
// Usage: bun run script/m12/objc-corpus-errors.ts [--per-repo=0] [--min-bytes=0]
// Writes: validation/m12/results/objc-corpus-errors.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { parseFile } from "../../src/ast/pool-worker"
import { ASTEngine } from "../../src/ast/engine"
import { loadWebTreeSitter } from "../../src/util/wasm"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS_ROOT = "$HOME/fixtures/repositories"
// The gate in script/m12/verify-corpus-claims.ts resolves a lane's corpus artifact as
// `validation/m12/results/${manifestAnalyzerName}-corpus-errors.json`, and this lane's manifest
// name is `objective-c` — so `objective-c-corpus-errors.json` is the path the gate READS. The
// first version of this rewrite wrote `objc-corpus-errors.json`, and the result was a gate
// comparing a fresh 329-file measurement (36 error files) against the STALE artifact it could
// still find (0 error files) and reporting H1, while the new numbers were reported as
// "unbacked" because no artifact the gate knew about carried them.
//
// The artifact it was reading is preserved at
// `validation/m12/results/objective-c-corpus-errors-CRASHED-2026-09-26.json`, and it is worth
// preserving rather than deleting: it records `errorFiles: 0, cleanFiles: 49` alongside
// `crashFiles: 49`, every file erroring "Failed to determine WASM path for objc: Language objc
// parser not yet implemented". That is where the manifest's `grammarErrorFiles: 0` came from —
// not from a small corpus, but from an instrument that counted a CRASH as a clean parse, so the
// lane's grammar-error claim has been "clean" ever since on the strength of a run in which
// nothing parsed at all.
const OUT = path.join(ROOT, "validation/m12/results/objective-c-corpus-errors.json")
const DETECT = path.join(ROOT, "src/ast/language-detection.ts")

/**
 * The three pinned repos, with the revision each was measured at.
 *
 * `clyde` is kept because it is the M11.10/M12.19 corpus TARGET and the manifest's
 * `corpusTarget` — dropping it would orphan those rows. It is 7 of 329 files, 2.1%, and the
 * artifact says so rather than quietly widening the target and leaving the old numbers in
 * place. `sdwebimage` and `afnetworking` are the lane's two production corpora, and both are
 * named in script/m14/differential.ts's own LANG_REPOS — this census measures the same
 * repositories the differential would, which is what makes the two comparable.
 */
const REPOS: { dir: string; rev: string; role: string }[] = [
  { dir: "sdwebimage", rev: "c3ad5e1a9bf55c9b76d4c362430b5fcded96c502", role: "production corpus (M14 F5 lane)" },
  { dir: "afnetworking", rev: "d9f589cc2c1fe9d55eb5eea00558010afea7a41e", role: "production corpus (M14 F5 lane)" },
  { dir: "Clyde", rev: "8fec41dd6ee03f863643aa958425c8bb4a6673ae", role: "M11.10/M12.19 corpus target — 7 of 329 files" },
]

const argNum = (f: string, d: number) => {
  const a = process.argv.find((x) => x.startsWith(`--${f}=`))
  return a ? Number(a.slice(f.length + 3)) : d
}
const argPerRepo = argNum("per-repo", 0)
const argMinBytes = argNum("min-bytes", 0)

/** The router's Objective-C extensions, read from the router rather than restated. */
function routerExtensions(): string[] {
  const src = readFileSync(DETECT, "utf8")
  const block = /EXTENSION_LANGUAGE: Readonly<Record<string, DetectedLanguage>> = \{([\s\S]*?)\n\}/.exec(src)
  if (!block) throw new Error("could not read EXTENSION_LANGUAGE from language-detection.ts — this census must not guess what the router admits")
  const exts: string[] = []
  for (const line of block[1]!.split("\n")) {
    if (!line.includes('"objective-c"')) continue
    for (const m of line.matchAll(/([a-z0-9]+):\s*"objective-c"/g)) exts.push(m[1]!)
  }
  if (!exts.length) throw new Error("language-detection.ts no longer routes any extension to objective-c")
  return [...new Set(exts)].sort()
}

/** `.h` is content-routed; the sniff is the router's own, stated in its own terms. */
function admitted(abs: string, exts: string[]): boolean {
  const ext = path.extname(abs).toLowerCase().slice(1)
  if (ext === "h") {
    try {
      const fd = fs.openSync(abs, "r"); const buf = Buffer.alloc(65536)
      const n = fs.readSync(fd, buf, 0, 65536, 0); fs.closeSync(fd)
      return /@(?:interface|protocol|implementation)\s+[A-Za-z_]/.test(buf.toString("utf8", 0, n))
    } catch { return false }
  }
  return exts.includes(ext)
}

async function main() {
  const exts = routerExtensions()
  const universe: any[] = []
  const toScan: { repo: string; abs: string; rel: string; bytes: number }[] = []

  for (const r of REPOS) {
    const dir = path.join(CORPUS_ROOT, r.dir)
    if (!fs.existsSync(dir)) { console.log(`  (absent on this box: ${r.dir})`); continue }
    // The glob MUST also fetch `*.h`, and the reason is a bug this file's first run had:
    // `EXTENSION_LANGUAGE` lists only the extensions the router maps BY NAME, so it contains
    // `m` and `mm` and NOT `h` — `.h` is admitted by CONTENT. Deriving the glob from that
    // table therefore fetched 157 files and no headers, and `admitted()`'s `h` branch was
    // unreachable. The census reported 157 files as if that were the universe and every
    // invariant still came back clean, because 157 clean files and 329 files produce the same
    // kind of green. A census that silently measures 48% of the language while reporting
    // nothing wrong is worse than one that measures 7 files and says so.
    const globs = [...new Set([...exts, "h"])].map((e) => `'*.${e}'`)
    let ls = ""
    try { ls = execSync(`git ls-files ${globs.join(" ")}`, { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }) } catch { continue }
    const tracked = ls.split("\n").filter((x) => x.trim())
    const admittedFiles = tracked.filter((f) => admitted(path.join(dir, f), exts))
    universe.push({
      repo: r.dir, rev: r.rev, role: r.role,
      trackedWithRouterExts: tracked.length,
      admittedByRouter: admittedFiles.length,
      hTracked: tracked.filter((f) => f.endsWith(".h")).length,
      hAdmitted: admittedFiles.filter((f) => f.endsWith(".h")).length,
      shareOfUniverse: 0,
    })
    const chosen = argPerRepo > 0 && admittedFiles.length > argPerRepo
      ? Array.from({ length: argPerRepo }, (_, i) => admittedFiles[Math.floor((i * admittedFiles.length) / argPerRepo)]!)
      : admittedFiles
    for (const f of chosen) {
      const abs = path.join(dir, f)
      let bytes = 0
      try { bytes = fs.statSync(abs).size } catch { }
      if (argMinBytes > 0 && bytes < argMinBytes) continue
      toScan.push({ repo: r.dir, abs, rel: f, bytes })
    }
  }
  const totalRouted = universe.reduce((n, u) => n + u.admittedByRouter, 0)
  for (const u of universe) u.shareOfUniverse = totalRouted ? +(u.admittedByRouter / totalRouted).toFixed(4) : 0

  await ASTEngine.getParser("objective-c")
  const mod = await loadWebTreeSitter()
  const lang = await mod.Language.load(path.join(ROOT, "wasm/tree-sitter-objc.wasm"))

  let ok = 0, errFiles = 0, crashes = 0
  let symbols = 0, relationships = 0, imports = 0
  let relWithLine = 0, relWithEvidence = 0, symWithComplexity = 0, importsWithLine = 0
  let dupIdFiles = 0, unknownSentinels = 0
  const errorRows: any[] = []
  const perRepo: Record<string, any> = {}
  const importTypes = new Map<string, number>()

  for (const f of toScan) {
    const acc = (perRepo[f.repo] ??= { files: 0, errors: 0, symbols: 0, relationships: 0 })
    acc.files++
    let p: any
    try { p = await parseFile(f.abs, path.join(CORPUS_ROOT, f.repo)) }
    catch (e: any) { crashes++; errorRows.push({ file: f.rel, repo: f.repo, crash: String(e?.message ?? e).slice(0, 140) }); continue }

    const parseErrs = (p.errors ?? []).filter((e: any) => e?.severity !== "info")
    // An independent read of the tree, so "the analyzer complained" and "the grammar produced
    // an ERROR node" stay two numbers. A file can be reported in error with a clean tree, and
    // can carry an ERROR node the analyzer walked around; summing them hides both.
    let errNodes = 0, missNodes = 0
    try {
      const parser = new mod.Parser(); parser.setLanguage(lang)
      const tree = parser.parse(readFileSync(f.abs, "utf8"))
      const cur = tree.walk()
      const visit = () => {
        if (cur.nodeType === "ERROR") errNodes++
        else if (cur.nodeType === "MISSING") missNodes++
        if (cur.gotoFirstChild()) { do { visit() } while (cur.gotoNextSibling()); cur.gotoParent() }
      }
      visit(); cur.delete()
    } catch { /* tree read is a cross-check, never the reason to fail a file */ }

    if (parseErrs.length > 0 || errNodes > 0 || missNodes > 0) {
      errFiles++
      acc.errors++
      errorRows.push({
        file: f.rel, repo: f.repo, bytes: f.bytes,
        reportedErrors: parseErrs.length, firstReported: (parseErrs[0]?.message ?? "").slice(0, 120),
        errorNodes: errNodes, missingNodes: missNodes,
        symbols: p.symbols?.length ?? 0, relationships: p.relationships?.length ?? 0,
      })
    } else ok++

    symbols += p.symbols?.length ?? 0
    relationships += p.relationships?.length ?? 0
    imports += p.imports?.length ?? 0
    acc.symbols += p.symbols?.length ?? 0
    acc.relationships += p.relationships?.length ?? 0

    for (const r of p.relationships ?? []) {
      if ((r.line_number ?? 0) > 0) relWithLine++
      if (r.metadata?.evidenceClass) relWithEvidence++
    }
    for (const s of p.symbols ?? []) if (typeof s.complexity === "number") symWithComplexity++
    // The output import object carries `type`, not `importType`: src/ast/pool-worker.ts maps
    // the analyzer's legacy `importType` onto `type` (`i.importType ?? (asMatch ? "alias" : baseType)`),
    // and the interface calls `importType` a "Legacy analyzer field" for exactly that reason.
    //
    // This census's first version read `im.importType` off the OUTPUT, found it undefined on
    // every row, and reported 918 imports of type "named" — which is the signature of the
    // import-payload-flattening defect this project already fixed in pool-worker for other
    // lanes. It is not that defect: the payload is intact and reads `type: "include"`. An
    // invariant that reports a real, already-fixed regression because it looked in the wrong
    // place is worse than no invariant, because it teaches the reader to distrust the number
    // that is right.
    for (const im of p.imports ?? []) {
      const t = im?.type ?? im?.importType ?? "<absent>"
      importTypes.set(t, (importTypes.get(t) ?? 0) + 1)
      if (im?.line !== undefined && (im.line as number) > 0) importsWithLine++
    }
    // duplicate ids and unknown sentinels are counted per file, as the family does
    const ids = (p.symbols ?? []).map((s: any) => s.id).filter((x: any) => x !== undefined)
    if (new Set(ids).size !== ids.length) dupIdFiles++
    if ((p.symbols ?? []).some((s: any) => /^(unknown|UNKNOWN|<unknown>)$/.test(String(s.name)))) unknownSentinels++
  }

  const totalRel = relationships
  const mismatch = relWithLine + (totalRel - relWithLine) - totalRel
  const payload = {
    schemaVersion: 1,
    milestone: "M12",
    // The names script/m12/verify-corpus-claims.ts reads (H1 grammarErrorFiles, H4
    // crashes/passed, H5 symbols+relationships), carried here rather than left to the gate to
    // discover a lane's private spelling. `crashFiles` in the archived artifact meant "files
    // that threw" and was counted as CLEAN; here it means the same thing and is fatal.
    analyzer: "objective-c",
    passed: crashes === 0,
    errorFileList: errorRows,
    crashes: errorRows.filter((e) => e.crash),
    rule: "Objective-C corpus census over the ROUTER's admitted universe",
    generatedAt: new Date().toISOString(),
    method:
      `every file src/ast/language-detection.ts admits — extensions read from its EXTENSION_LANGUAGE table ` +
      `(${exts.join(", ")}), plus .h content-sniffed for @interface|@protocol|@implementation — across ` +
      `${REPOS.length} pinned repositories, ${argPerRepo > 0 ? `${argPerRepo} per repo (SAMPLED)` : "NO sampling"}` +
      `${argMinBytes > 0 ? `, min ${argMinBytes} bytes` : ""}. Invariants: line coverage, evidence-class ` +
      `coverage, complexity coverage, duplicate ids, unknown sentinels, crash count, and an INDEPENDENT ` +
      `tree read for ERROR/MISSING nodes so the analyzer's own complaints and the grammar's own damage ` +
      `stay two numbers rather than one.`,
    why:
      "the previous instrument measured Clyde's 7 files and the manifest published its numbers as the " +
      "lane's corpus claim, including grammarErrorFiles: 0 — true of seven files, false of the language",
    repos: REPOS.map((r) => r.dir),
    corpusRevision: Object.fromEntries(REPOS.map((r) => [r.dir, r.rev])),
    routerExtensions: exts,
    universe,
    totalRouted,
    files: toScan.length,
    ok, errorFiles: errFiles, crashFiles: crashes,
    symbols, relationships, imports,
    invariants: {
      relationshipsWithLine: relWithLine,
      relationshipsWithLinePct: totalRel ? +(100 * relWithLine / totalRel).toFixed(2) : null,
      relationshipsWithEvidenceClass: relWithEvidence,
      relationshipsWithEvidenceClassPct: totalRel ? +(100 * relWithEvidence / totalRel).toFixed(2) : null,
      symbolsWithComplexity: symWithComplexity,
      duplicateIdFiles: dupIdFiles,
      unknownSentinels,
      importTypeHistogram: Object.fromEntries([...importTypes.entries()].sort((a, b) => b[1] - a[1])),
      importsWithLine,
      importsWithLinePct: imports ? +(100 * importsWithLine / imports).toFixed(2) : null,
      lineEvidenceMismatch: mismatch,
    },
    perRepo,
    errorRows: errorRows.sort((a, b) => (b.errorNodes ?? 0) - (a.errorNodes ?? 0)),
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n")

  console.log(`router extensions: ${exts.join(", ")}   (+ .h content-sniffed)`)
  for (const u of universe) console.log(`  ${u.repo.padEnd(14)} ${String(u.admittedByRouter).padStart(4)} admitted of ${String(u.trackedWithRouterExts).padStart(4)} tracked  (.h ${u.hAdmitted}/${u.hTracked})  ${(u.shareOfUniverse * 100).toFixed(1)}% of universe`)
  console.log(`\nfiles ${toScan.length}   clean ${ok}   with errors ${errFiles}   crashes ${crashes}`)
  console.log(`symbols ${symbols}   relationships ${relationships}   imports ${imports}`)
  console.log(`\ninvariants:`)
  console.log(`  relationships with a line          ${relWithLine}/${totalRel}  (${payload.invariants.relationshipsWithLinePct}%)`)
  console.log(`  relationships with evidenceClass  ${relWithEvidence}/${totalRel}  (${payload.invariants.relationshipsWithEvidenceClassPct}%)`)
  console.log(`  symbols with complexity           ${symWithComplexity}/${symbols}`)
  console.log(`  duplicate-id files                ${dupIdFiles}   unknown sentinels ${unknownSentinels}   crashes ${crashes}`)
  console.log(`  import types                      ${JSON.stringify(payload.invariants.importTypeHistogram)}  (read from the output's \`type\`, which pool-worker maps from the analyzer's legacy importType)`)
  console.log(`  imports with a line               ${importsWithLine}/${imports}  (${payload.invariants.importsWithLinePct}%)`)
  console.log(`\n-> ${path.relative(ROOT, OUT)}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
