// #743 C-half, second question (#841 two-question form): the census proves the
// GRAMMAR errors on 20/45 jq files — but does the ANALYZER lose the real function
// surface there? The F5 differential cannot answer this (both sides share the
// tree, so a shared blind spot is invisible). This audit uses an INDEPENDENT
// reference: clang's own AST for the same file.
//
// Filtering matters: clang dumps every header declaration it includes, and those
// are not file symbols. Clang's JSON marks include-origin nodes with
// `includedFrom`, so a declaration belongs to the audited file exactly when that
// key is ABSENT on both its `loc` and its `range.begin` (verified on jv_print.c:
// assert.h's __assert_fail carries includedFrom, the file's own decls do not).
//
// clang cannot build jq standalone (config.h is generated), but with
// -ferror-limit=0 it keeps parsing and still reports the file's own decls.
//
// Run: bun script/m14/tmp/c901-clang-audit.ts
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { tmpdir } from "node:os"
import { parseFile } from "../../../src/ast/pool-worker"

const ROOT = "<corpus-root>/bb_tests/repositories/jq"
const artifact = JSON.parse(readFileSync("validation/m12/results/c-corpus-errors.json", "utf8"))
const files: string[] = (artifact.errorFileList as any[]).map((e: any) => String(e.file))

// clang's JSON is a DIFF: a node prints `loc.file` only when the file CHANGES
// from the previous node, and children inherit. A stateless check therefore
// leaks every system-header declaration after the first (measured: 2393
// "lost" names like __acos/isalnum on the first run — all of glibc). The audit
// must carry the file down the walk, exactly as clang emits it.
function resolveFile(loc: any): string | undefined {
  if (!loc) return undefined
  if (typeof loc.file === "string") return loc.file
  for (const k of ["expansionLoc", "spellingLoc"]) {
    const inner = loc[k]
    if (inner && typeof inner.file === "string") return inner.file
  }
  return undefined
}

// A declaration belongs to the audited file exactly when clang reports it with
// no include ancestry AND no resolved file (the main file is the default and
// its path is never printed) — measured shapes on jq:
//   jvp_number_is_nan  loc={offset,line,col,tokLen}                  -> MAIN
//   jv_string_fmt      (defined in jv.c) same shape                -> MAIN
//   jv_string_fmt      (declared in jv.h) loc.file + includedFrom  -> header
//   jv_mem_alloc       loc.file=jv_alloc.h + includedFrom          -> header
//   __acos             loc.expansionLoc.file=.../mathcalls.h       -> header
function isMainFileDecl(n: any): boolean {
  const loc = n?.loc
  if (!loc || loc.includedFrom) return false
  const f = resolveFile(loc)
  return f === undefined
}

// System headers are stripped from the audited copy before the dump. Even with
// `file`/`includedFrom` filtering, libc leaks two classes of FunctionDecl that
// belong to no file: predefined builtins (`__finite`, `__isinf`) and re-declared
// fortify wrappers (`scanf`, `isalnum`, `_tolower`) whose loc carries neither a
// file nor an include chain (measured: 671 phantom "lost" names before this
// step). Their absence removes the ambiguity at the source instead of trying to
// re-classify it. jq's OWN headers stay included: their decls are not file
// symbols either, and they are correctly excluded by includedFrom.
function stripSystemIncludes(src: string): string {
  return src.split("\n").filter(l => !/^\s*#\s*include\s*</.test(l)).join("\n")
}

// #907 correction: `isMainFileDecl` alone is NOT a definition test, and the
// audit's first form read 314 "lost" names that were almost entirely libc
// prototypes (scanf/sscanf/vfscanf/memcpy/strlen...). Mechanism: this audit
// strips `#include <...>` lines to keep glibc out of the count, and clang then
// relocates the *implicit* declarations of those same functions into the
// stripped main file — so they land with no `loc.file` and no `includedFrom`,
// which is exactly the shape the main-file test accepts. A prototype is not a
// file symbol, so the reference set must be DEFINITIONS: a FunctionDecl whose
// body is present (`inner` carries a CompoundStmt). Measured effect: jv_print.c
// clang=21 decls / 13 definitions — and 13 is what the file really defines.
function isDefinition(n: any): boolean {
  const inner = n?.inner
  if (!Array.isArray(inner)) return false
  return inner.some((c: any) => c?.kind === "CompoundStmt")
}

// A definition node's NAME is not always written at the node's own location:
// when the definition comes out of a macro expansion, clang attributes the
// node to the expansion SITE (the macro invocation), whose line does not carry
// the name. Recording the line lets the residue be classified from evidence
// instead of guessed: name-on-its-own-line => a definition the analyzer really
// missed; name-absent => a macro-expanded definition the tree can never name.
function locLine(n: any): number | undefined {
  const l = n?.loc?.line ?? n?.range?.begin?.line
  return typeof l === "number" ? l : undefined
}

function clangMainDecls(file: string): { fns: Set<string>; defs: Map<string, number | undefined>; types: Set<string>; bytes: number } {
  // clang exits non-zero on the very syntax errors this audit is about (jq does
  // not compile standalone: config.h is generated) — the AST dump is still
  // written, so the failure path carries the payload.
  const stripped = join(tmpdir(), `c901-${basename(file)}`)
  writeFileSync(stripped, stripSystemIncludes(readFileSync(file, "utf8")))
  let out = ""
  try {
    out = execFileSync("clang", [
      "-fsyntax-only", "-ferror-limit=0", "-I", ROOT, "-I", `${ROOT}/src`,
      "-Xclang", "-ast-dump=json", stripped,
    ], { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] })
  } catch (e: any) {
    out = typeof e?.stdout === "string" ? e.stdout : String(e?.stdout ?? "")
  }
  const tree = JSON.parse(out)
  const fns = new Set<string>()
  const defs = new Map<string, number | undefined>()
  const types = new Set<string>()
  const walk = (n: any): void => {
    if (isMainFileDecl(n)) {
      const kind = n?.kind
      const name = n?.name
      if (typeof name === "string" && name.length > 0) {
        if (kind === "FunctionDecl") {
          fns.add(name)
          if (isDefinition(n)) defs.set(name, locLine(n))
        } else if (kind === "RecordDecl" || kind === "TypedefDecl" || kind === "EnumDecl") types.add(name)
      }
    }
    for (const c of n?.inner ?? []) walk(c)
  }
  walk(tree)
  return { fns, defs, types, bytes: out.length }
}

const rows: Array<{ file: string; clangFns: number; clangDefs: number; analyzerFns: number; lostDefs: string[]; lostDefLines: Record<string, number>; extraDefs: string[]; lostDeclsOnly: string[] }> = []
for (const rel of files) {
  const abs = `${ROOT}/${rel}`
  const c = clangMainDecls(abs)
  const r: any = await parseFile(abs, ROOT)
  const aFns = new Set<string>((r.symbols ?? []).filter((s: any) => s.kind === "function").map((s: any) => String(s.name)))
  // The class question (#907) is about DEFINITIONS. Declarations the analyzer
  // omits are reported separately so they can never be confused with the loss
  // class this audit exists to bound.
  const lostDefs = [...c.defs.keys()].filter(n => !aFns.has(n)).sort()
  const lostDefLines: Record<string, number> = {}
  for (const n of lostDefs) {
    const l = c.defs.get(n)
    if (typeof l === "number") lostDefLines[n] = l
  }
  const extraDefs = [...aFns].filter(n => !c.defs.has(n)).sort()
  const lostDeclsOnly = [...c.fns].filter(n => !c.defs.has(n) && !aFns.has(n)).sort()
  rows.push({ file: rel, clangFns: c.fns.size, clangDefs: c.defs.size, analyzerFns: aFns.size, lostDefs, lostDefLines, extraDefs, lostDeclsOnly })
}

console.log(`jq error-file set vs clang (main-file DEFINITIONS; declarations reported separately): ${files.length} files\n`)
let totalLostDefs = 0
let totalDefs = 0
let totalDeclsOnly = 0
for (const row of rows) {
  totalLostDefs += row.lostDefs.length
  totalDefs += row.clangDefs
  totalDeclsOnly += row.lostDeclsOnly.length
  console.log(`${row.lostDefs.length > 0 ? "LOSS" : "ok  "} ${row.file}: clang-defs=${row.clangDefs} analyzer=${row.analyzerFns} lost-defs=${row.lostDefs.length} (prototypes-only omitted: ${row.lostDeclsOnly.length})`)
  if (row.lostDefs.length > 0) console.log(`       lost-defs: ${row.lostDefs.slice(0, 15).join(", ")}${row.lostDefs.length > 15 ? ` ... (+${row.lostDefs.length - 15})` : ""}`)
  if (row.extraDefs.length > 0 && row.extraDefs.length <= 8) console.log(`       analyzer-only-defs: ${row.extraDefs.join(", ")}`)
}
console.log(`\nTOTALS: clang main-file DEFINITIONS=${totalDefs}  lost by analyzer=${totalLostDefs}  (non-definition decls omitted=${totalDeclsOnly})`)

// #907 acceptance 3 needs the residue NAMED, and a console log truncates at 15
// names per file. The rows go to an artifact so the classification (and any
// reviewer) sees the full lists rather than a slice.
const OUT = "validation/m12/results/c-clang-def-audit.json"
writeFileSync(OUT, JSON.stringify({
  at: new Date().toISOString(),
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  method: "clang -ast-dump=json with system #includes stripped; a main-file FunctionDecl is a DEFINITION iff its inner[] carries a CompoundStmt (prototypes the analyzer omits are reported separately so they can never be read as the #907 loss class)",
  repo: ROOT,
  errorFileSet: files,
  perFile: rows.map(r => ({
    file: r.file, clangDecls: r.clangFns, clangDefs: r.clangDefs, analyzerFns: r.analyzerFns,
    lostDefs: r.lostDefs, lostDefLines: r.lostDefLines,
    analyzerOnlyDefs: r.extraDefs, lostPrototypesOnly: r.lostDeclsOnly.length,
  })),
  totals: { clangDefs: totalDefs, lostDefs: totalLostDefs, nonDefinitionDeclsOmitted: totalDeclsOnly },
}, null, 2) + "\n")
console.log(`artifact: ${OUT}`)
