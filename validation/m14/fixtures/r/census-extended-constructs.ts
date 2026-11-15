#!/usr/bin/env npx tsx
/**
 * CENSUS — the four EXTENDED types' CONSTRUCT SITES over the WHOLE admitted R population.
 *
 * `decorates`, `renders`, `mixes_in` and `part_of` are the campaign's tail. Before any rung
 * of the ladder is walked the population of CANDIDATE CONSTRUCTS must be counted, because the
 * fleet's rule is that a ruling is earned by a measurement, not by prose — and a population of
 * zero is a control failure, not a measurement.
 *
 * THE POPULATION IS THE GATE'S, EXACTLY. `script/m14/incoming-gate.ts` admits a tracked path
 * when (a) its spelling ends in one of the ROUTER TABLE's extensions for the lane (`.r`), or
 * (b) its bare basename equals one of those spellings AND the router's own detection attributes
 * it to the lane — and never above the 1 MiB engine cap. A content-based walk is a DIFFERENT
 * population: the c lane measured its content walk admitting 16,854 files where the gate admits
 * 20,824, and every ruling measured on the wrong set had to be thrown away. So this file copies
 * the gate's predicate rather than inventing one, and prints the admitted list's bounds.
 *
 * WHAT IS COUNTED, per type — CONSTRUCT SITES (the analyzer emits none of the four yet):
 *
 *   mixes_in    The construct that takes another class's member set is `setClass(contains=)`
 *               — S4's `contains=` argument. The spellings that DECLARE conformance are
 *               counted beside it so the difference is visible, never blurred:
 *               `R6Class(inherit=)` is IS-A (extends), and S7's `new_class(parent=)` is IS-A
 *               too. `R6Class(include=)` is counted because the question was asked; R6 has no
 *               such argument, so the expected reading is 0 and a non-zero would refute that.
 *   part_of     `source()` / `sys.source()` call sites, split by the `local=` argument's
 *               spelling: `local=FALSE` and `local=globalenv()` evaluate the included file in
 *               the GLOBAL environment (same scope); the DEFAULT (`local=TRUE`) and every other
 *               spelling evaluate in a NEW environment, which fails the contract's "shares the
 *               library's single scope". A CALL is not a grammar construct — that is the point
 *               of counting it rather than asserting it.
 *   decorates   roxygen `#'` comment sites and their tag sites (`@export`, `@import*`). A tag
 *               is a COMMENT a TOOL reads; the census counts sites so the ruling carries a
 *               number and its falsifier (a tool-invoked annotation parsed as a NODE) has
 *               something to refute.
 *   renders     nothing in the `.R` population can be a render host. The `.Rmd`/`.Rnw`
 *               spellings are counted on the corpus tree and the ROUTER'S TABLE is quoted:
 *               it gives this lane `.r` only, so a `.Rmd` file is not this lane's file.
 *
 * Method: the engine's own `parseTree` and a named-node walk — a `call` node whose function is
 * an `identifier` or `namespace_operator` spelling the wanted name, and `comment` nodes read by
 * CHARACTER CODE (`#` is 35, `'` is 39). No regex literal appears in this instrument.
 *
 * Run: BB_CORPUS_ROOT=$PWD/.corpus npx tsx validation/m14/fixtures/r/census-extended-constructs.ts
 * Artifact: validation/m14/fixtures/r/measurements/r-extended-constructs.txt
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { ASTEngine } from "../../../../src/ast/engine"
import { extensionsFor } from "../../../../script/m14/language-extensions"

const T0 = Date.now()
const loadAtStart = os.loadavg()
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ARTIFACT = path.resolve(HERE, "measurements", "r-extended-constructs.txt")

// --- THE GATE'S ADMISSION RULE, copied from script/m14/incoming-gate.ts:367 ---------------
const LANE = "r"
const EXTS = extensionsFor(LANE).map((e) => e.replace(/^\./, "")) // ["r"]
const SIZE_CAP = 1024 * 1024

function admitByExtension(rel: string, exts: string[], lang: string): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (exts.some((e) => low.endsWith(`.${e}`))) return true
  return exts.some((e) => base === e) && detectLanguageFromPath(rel) === lang
}

interface Admitted { repo: string; rel: string; abs: string }
const admitted: Admitted[] = []
let excludedOverCap = 0
let excludedAbsent = 0
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!admitByExtension(rel, EXTS, LANE)) continue
    const abs = path.join(dir, rel)
    let size: number
    try { size = statSync(abs).size } catch { excludedAbsent++; continue }
    if (size > SIZE_CAP) { excludedOverCap++; continue }
    admitted.push({ repo: e, rel, abs })
  }
}
const corpusDigest = createHash("sha256").update(admitted.map((c) => c.abs).sort().join("\n")).digest("hex")

// --- counters ---------------------------------------------------------------------------
interface Counter { sites: number; files: Set<string> }
const mk = (): Counter => ({ sites: 0, files: new Set() })
const bump = (c: Counter, key: string) => { c.sites++; c.files.add(key) }

const partOf = {
  source: mk(), sysSource: mk(),
  localFalse: mk(), localGlobalenv: mk(), localTrue: mk(), localDefault: mk(), localOther: mk(),
}
const mixesIn = {
  setClassContains: mk(),
  containsSingle: mk(), containsMulti: mk(),
  r6Include: mk(), r6Inherit: mk(),
  r6InheritSingle: mk(), r6InheritMulti: mk(),
  r5ContainsSingle: mk(), r5ContainsMulti: mk(),
  s7Parent: mk(), setIs: mk(), r5contains: mk(),
}
const decorates = { roxygenSite: mk(), tagExport: mk(), tagImport: mk() }
const filesWithRoxygen = new Set<string>()

let parsed = 0, failures = 0
/** The engine's intermittent wasm trap: retried, and the retries are counted. */
const TRAP_ATTEMPTS = 3
let retriedFiles = 0
let trapExhausted = 0
const trapLines: string[] = []
const failureNames: string[] = []
const origWrite = process.stderr.write.bind(process.stderr)
process.stderr.write = ((chunk: any, ...rest: any[]) => {
  const s = String(chunk)
  if (s.includes("[BB-PARSE-ERR]")) trapLines.push(s.trim())
  return origWrite(chunk, ...rest)
}) as any

/**
 * The BARE callee name of a call — `fn` for a plain call, and the `rhs` for `pkg::fn` /
 * `pkg:::fn`.
 *
 * The qualifier is dropped because the ANALYZER drops it (`calleeName` at
 * `src/ast/real-r-analyzer.ts:1184-1189` maps `R6::R6Class` and `base::sqrt` to the bare
 * name), so a census that matched the qualified spelling would be counting a DIFFERENT
 * population from the one the analyzer reads. Measured before the fix: `methods::setRefClass(
 * clname, contains = "C++Object", ...)` (`r-Rcpp/R/Module.R:225`) was invisible to this
 * census while the analyzer handles it, and the R5 count read 3 where the construct has 4
 * sites. A census and its analyzer must agree on what a call is called.
 */
function calleeNameOf(callNode: any): string {
  const fn = callNode?.namedChild?.(0)
  if (!fn) return ""
  if (fn.type === "identifier") return fn.text
  if (fn.type === "namespace_operator") {
    const name = fn.namedChild?.(1)?.text ?? ""
    return name
  }
  return ""
}

/** A call's named-argument VALUE node, or null when absent. */
function namedArgValue(callNode: any, name: string): any {
  const args = callNode?.namedChild?.(1)
  if (!args) return null
  for (let i = 0; i < (args.namedChildCount ?? 0); i++) {
    const a = args.namedChild?.(i)
    if (a?.type !== "argument") continue
    if (a.childForFieldName?.("name")?.text !== name) continue
    return a.childForFieldName?.("value") ?? null
  }
  return null
}

/**
 * HOW MANY class names a `contains=`/`inherit=`/`parent=` value names.
 *
 * The distinction is load-bearing for the label: the fleet's own `mixes_in` definition says a
 * mixin is "not `extends` either (there is no single base and the `with` list is not an
 * inheritance clause)" (`src/ast/types.ts:156-160`). So a composition value naming SEVERAL
 * classes is unambiguously a list; a value naming exactly ONE is the single-base shape. Both
 * are counted so the ruling can state which shape dominates, rather than asserting one.
 *
 * `comma` IS A NAMED NODE TYPE IN THIS GRAMMAR (`validation/m14/measurements/r-grammar-nodes.json`
 * lists it among the 41 named types), so a `c()` argument list's named children alternate
 * argument and comma. The first version of this function counted every named child and so
 * counted the commas too, which turned a one-class `c("A")` into a "list" — the classification
 * threshold hid the error for `c("A","B")`, but the count was wrong. Commas are skipped.
 */
function classNamesInValue(v: any): number {
  if (!v) return 0
  if (v.type === "call") {
    const callee = calleeNameOf(v)
    if (callee === "c" || callee === "list") {
      const args = v.namedChild?.(1)
      let n = 0
      for (let i = 0; i < (args?.namedChildCount ?? 0); i++) {
        const a = args.namedChild(i)
        if (!a || a.type === "comma") continue
        if (a.type === "argument") { if (a.childForFieldName?.("value")) n++ }
        else n++
      }
      return n
    }
    return 1
  }
  return 1
}

/**
 * What a `local=` value means for scope sharing. `source()`'s DEFAULT is `local=TRUE`
 * (a NEW environment), so an ABSENT argument is `"true"`, never "shares scope".
 */
function localSpelling(v: any): "false" | "globalenv" | "true" | "other" {
  if (!v) return "true"
  if (v.type === "false") return "false"
  if (v.type === "true") return "true"
  const txt = typeof v.text === "string" ? v.text : ""
  if (v.type === "identifier" && (txt === "FALSE" || txt === "F")) return "false"
  if (v.type === "identifier" && (txt === "TRUE" || txt === "T")) return "true"
  if (v.type === "identifier" && txt === "globalenv") return "globalenv"
  if (v.type === "call" && (txt.startsWith("globalenv") || calleeNameOf(v) === "globalenv")) return "globalenv"
  return "other"
}

function bumpLocal(sp: "false" | "globalenv" | "true" | "other", hadArg: boolean, key: string) {
  if (sp === "false") bump(partOf.localFalse, key)
  else if (sp === "globalenv") bump(partOf.localGlobalenv, key)
  else if (sp === "true") bump(partOf.localTrue, key)
  else bump(partOf.localOther, key)
  if (!hadArg) bump(partOf.localDefault, key)
}

/** Split a comment's text into words by character class — no pattern matching. */
function wordsOf(text: string): string[] {
  const out: string[] = []
  let start = -1
  for (let i = 0; i <= text.length; i++) {
    const c = i < text.length ? text.charCodeAt(i) : 32
    const isSpace = c === 32 || c === 9 || c === 10 || c === 13 || c === 40 || c === 41 || c === 44
    if (isSpace) {
      if (start >= 0) { out.push(text.slice(start, i)); start = -1 }
    } else if (start < 0) start = i
  }
  return out
}

async function walkOne(f: Admitted) {
  const key = `${f.repo}/${f.rel}`
  let text: string
  try { text = readFileSync(f.abs, "utf8") } catch { failures++; failureNames.push(`${key} (unreadable)`); return }
  // The engine's wasm parser carries a KNOWN INTERMITTENT trap ("memory access out of
  // bounds") that is not load-correlated — the lane's own spec measured it on the same
  // corpus digest at load 12.71, 5.40 and 4.68, firing on the lowest. A whole-population
  // claim must therefore RETRY rather than report whichever files happened to trap; the
  // attempt count is printed so a run that needed retries is not read as a clean one.
  let tree: any = null
  let lastErr = ""
  for (let attempt = 1; attempt <= TRAP_ATTEMPTS && !tree; attempt++) {
    try {
      const r = await ASTEngine.parseTree(f.abs, text)
      tree = r?.tree ?? null
      if (tree && attempt > 1) retriedFiles++
    } catch (err: any) {
      lastErr = String(err?.message ?? err)
      if (attempt === TRAP_ATTEMPTS) trapExhausted++
    }
  }
  if (!tree) { failures++; failureNames.push(`${key} (${lastErr || "no tree"})`); return }
  parsed++
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    const t = n.type
    if (t === "call") {
      const fn = calleeNameOf(n)
      if (fn === "source" || fn === "sys.source") {
        bump(fn === "source" ? partOf.source : partOf.sysSource, key)
        const localArg = namedArgValue(n, "local")
        bumpLocal(localSpelling(localArg), localArg !== null, key)
      } else if (fn === "setClass") {
        const contains = namedArgValue(n, "contains")
        if (contains) {
          bump(mixesIn.setClassContains, key)
          if (classNamesInValue(contains) > 1) bump(mixesIn.containsMulti, key)
          else bump(mixesIn.containsSingle, key)
        }
      } else if (fn === "setIs") {
        bump(mixesIn.setIs, key)
      } else if (fn === "R6Class") {
        const inherit = namedArgValue(n, "inherit")
        if (inherit) {
          bump(mixesIn.r6Inherit, key)
          if (classNamesInValue(inherit) > 1) bump(mixesIn.r6InheritMulti, key)
          else bump(mixesIn.r6InheritSingle, key)
        }
        if (namedArgValue(n, "include")) bump(mixesIn.r6Include, key)
      } else if (fn === "new_class" || fn === "S7::new_class" || fn === "S7:::new_class") {
        if (namedArgValue(n, "parent")) bump(mixesIn.s7Parent, key)
      } else if (fn === "setRefClass") {
        const contains = namedArgValue(n, "contains")
        if (contains) {
          bump(mixesIn.r5contains, key)
          if (classNamesInValue(contains) > 1) bump(mixesIn.r5ContainsMulti, key)
          else bump(mixesIn.r5ContainsSingle, key)
        }
      }
    } else if (t === "comment") {
      const ctext = n.text ?? ""
      // roxygen: `#'` — by character code, never a pattern.
      if (ctext.length >= 2 && ctext.charCodeAt(0) === 35 && ctext.charCodeAt(1) === 39) {
        bump(decorates.roxygenSite, key)
        filesWithRoxygen.add(key)
        for (const word of wordsOf(ctext)) {
          if (word === "@export") bump(decorates.tagExport, key)
          else if (word.length > 7 && word.slice(0, 7) === "@import") bump(decorates.tagImport, key)
        }
      }
    }
    for (let i = (n.namedChildCount ?? 0) - 1; i >= 0; i--) {
      const ch = n.namedChild(i)
      if (ch) stack.push(ch)
    }
  }
  try { tree.delete?.() } catch { /* best effort */ }
}

const WORKERS = Number(process.env.BB_R_WORKERS ?? "4")
let cursor = 0
async function worker() {
  while (cursor < admitted.length) {
    const i = cursor++
    await walkOne(admitted[i])
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

/** Count the knitr/rmarkdown spellings on the corpus TREE (all repos, depth<=6). */
function countSpellings() {
  let rmd = 0, rnw = 0, rmdLower = 0, rnwLower = 0
  const visit = (dir: string, depth: number) => {
    if (depth > 6) return
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const e of entries) {
      if (e === ".git" || e === "node_modules") continue
      const p = path.join(dir, e)
      let st: any
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) visit(p, depth + 1)
      else if (e === ".Rmd") rmd++
      else if (e === ".Rnw") rnw++
      else if (e === ".rmd") rmdLower++
      else if (e === ".rnw") rnwLower++
    }
  }
  for (const e of readdirSync(CR).sort()) {
    const dir = path.join(CR, e)
    try { if (statSync(dir).isDirectory()) visit(dir, 0) } catch { continue }
  }
  return { rmd, rnw, rmdLower, rnwLower }
}

const out: string[] = []
const line = "=".repeat(78)
out.push(line)
out.push("CENSUS — the FOUR EXTENDED TYPES' CONSTRUCT SITES over the WHOLE admitted R population")
out.push(line)
out.push(`node ${process.version}   workers ${WORKERS}   cores ${os.cpus().length}`)
out.push(`load at start: ${loadAtStart.map((n) => n.toFixed(2)).join(" ")}`)
out.push(`corpus root: ${CR}`)
out.push(`admission: the GATE's predicate (script/m14/incoming-gate.ts:367) — spelling .${EXTS.join(", .")} from the ROUTER TABLE (script/m14/language-extensions.ts), bare basename==spelling only when the router's detection names this lane; SIZE_CAP ${SIZE_CAP} B`)
out.push(`admitted files [0,${admitted.length}) of ${admitted.length} — the WHOLE admitted population (no stride, no cap)`)
out.push(`excluded from the population: ${excludedAbsent} tracked-but-absent/unreadable + ${excludedOverCap} over the ${SIZE_CAP} B cap`)
out.push(`corpus file set: sha256 ${corpusDigest} (${admitted.length} absolute paths, sorted)`)
out.push(`files parsed: ${parsed}   failures: ${failures}   traps: ${trapLines.length}`)
out.push(`parse attempts: up to ${TRAP_ATTEMPTS} per file for the engine's known intermittent wasm trap — ${retriedFiles} file(s) needed a retry, ${trapExhausted} exhausted all attempts`)
for (const t of trapLines) out.push(`  TRAP ${t}`)
for (const n of failureNames) out.push(`  FAILED ${n}`)
out.push(`walk wall time: ${Date.now() - T0}ms`)
out.push("")
const show = (label: string, c: Counter) =>
  out.push(`  ${label.padEnd(46)} ${String(c.sites).padStart(6)} sites   ${String(c.files.size).padStart(5)} files`)

out.push("mixes_in — the CONSTRUCT SITES, by spelling (the label question is whether conformance is declared):")
show("setClass(contains=) — S4 composition clause", mixesIn.setClassContains)
show("  contains= naming ONE class (single-base shape)", mixesIn.containsSingle)
show("  contains= naming SEVERAL classes (list shape)", mixesIn.containsMulti)
show("setRefClass(contains=) — R5 (same keyword, same reading)", mixesIn.r5contains)
show("  R5 contains= naming ONE class (single-base)", mixesIn.r5ContainsSingle)
show("  R5 contains= naming SEVERAL classes (list)", mixesIn.r5ContainsMulti)
show("R6Class(inherit=) — IS-A conformance [extends, NOT mixes_in]", mixesIn.r6Inherit)
show("  inherit= naming ONE class", mixesIn.r6InheritSingle)
show("  inherit= naming SEVERAL classes", mixesIn.r6InheritMulti)
show("R6Class(include=) — the asked-about spelling (R6 has no such arg)", mixesIn.r6Include)
show("S7 new_class(parent=) — IS-A conformance [extends]", mixesIn.s7Parent)
show("setIs() — S4 coerce inheritance [extends]", mixesIn.setIs)
out.push("")
out.push("part_of — the runtime-inclusion CONSTRUCT SITES (a CALL, not a grammar construct):")
show("source() call sites", partOf.source)
show("sys.source() call sites", partOf.sysSource)
show("  local=FALSE (global env — SHARES scope)", partOf.localFalse)
show("  local=globalenv() (SHARES scope)", partOf.localGlobalenv)
show("  local=TRUE / default (NEW env — fails contract)", partOf.localTrue)
show("    of which: NO local= given at all", partOf.localDefault)
show("  local= other spelling", partOf.localOther)
out.push("")
out.push("decorates — roxygen comment sites (a COMMENT a TOOL reads):")
show("any roxygen `#'` comment site", decorates.roxygenSite)
show("  @export tag sites", decorates.tagExport)
show("  @import* tag sites", decorates.tagImport)
out.push(`  DISTINCT FILES carrying any roxygen tag: ${filesWithRoxygen.size} of ${parsed}`)
out.push("")
out.push("renders — the admitted population cannot host the construct:")
const mds = countSpellings()
out.push(`  .Rmd ${mds.rmd}   .Rnw ${mds.rnw}   .rmd ${mds.rmdLower}   .rnw ${mds.rnwLower} (corpus TREE, depth<=6)`)
out.push(`  the ROUTER'S ONE TABLE gives this lane .${EXTS.join(", .")} only, so a .Rmd file is NOT this lane's file`)
out.push(line)
const report = out.join("\n") + "\n"
try { writeFileSync(ARTIFACT, report) } catch (e: any) { origWrite(`ARTIFACT WRITE FAILED: ${e?.message ?? e}\n`) }
origWrite(report)

process.on("exit", (code) => {
  origWrite(`EXIT code=${code} after ${Date.now() - T0}ms\n`)
})
process.exitCode = 0
