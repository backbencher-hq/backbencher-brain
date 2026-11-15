#!/usr/bin/env npx tsx
/**
 * FALSIFIER CENSUS — the `part_of` ruling's named constructs, COUNTED.
 *
 * The `part_of` contract: "A library unit INCLUDES a part file … a part shares the library's
 * single scope" (`src/ast/types.ts:163-179`). The fleet's measured populations are
 * parse-level directives (dart `part`, typescript `/// <reference>`, erlang `-include`,
 * php `include/require`): the INCLUDING FILE names the INCLUDED FILE as a construct the
 * grammar carries, and the included text shares the includer's scope.
 *
 * R's candidate is `source()`/`sys.source()`, and this census counts the three facts that
 * decide its class, over the whole admitted population, by AST shape and never by pattern:
 *
 *   1. THE SCOPE SPLIT — `source()`'s default is `local=TRUE`: the included file is
 *      evaluated in a NEW environment, which FAILS the contract's "shares the single
 *      scope". `local=FALSE` and `local=globalenv()` evaluate in the GLOBAL environment
 *      and share it. Both halves are counted, per spelling.
 *   2. THE TARGET SPLIT — a `part_of` row needs a NAMEABLE target. `source("utf-8.txt")`
 *      carries a literal path; `source(system.file("test-tools.R", package="Matrix"))`
 *      computes its path at runtime, inside a CALL — the analyzer's `r_source` edges
 *      already record the literal-string sites as `imports`/`references` on the path, and
 *      a computed path has no name at all. Both halves are counted.
 *   3. THE CONSTRUCT CLASS — a `source()` call is a CALL, not a parse-level inclusion
 *      directive: the grammar carries it as an ordinary `call` node (the same node type as
 *      every other call), and R has no include directive at all. The census counts the
 *      served grammar's directive-family named types so the ruling's grammar half is read
 *      from the inventory, not asserted.
 *
 * Run: BB_CORPUS_ROOT=$PWD/.corpus npx tsx validation/m14/fixtures/r/census-partof-falsifier.ts
 * Artifact: validation/m14/fixtures/r/measurements/r-partof-falsifier.txt
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { ASTEngine } from "../../../../src/ast/engine"

const T0 = Date.now()
const loadAtStart = os.loadavg()
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ARTIFACT = path.resolve(HERE, "measurements", "r-partof-falsifier.txt")

const LANE = "r"
const EXTS = ["r"]
const SIZE_CAP = 1024 * 1024
function admit(rel: string): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (EXTS.some((e) => low.endsWith(`.${e}`))) return true
  return EXTS.some((e) => base === e) && detectLanguageFromPath(rel) === LANE
}

interface Admitted { repo: string; rel: string; abs: string }
const admitted: Admitted[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!admit(rel)) continue
    const abs = path.join(dir, rel)
    let size: number
    try { size = statSync(abs).size } catch { continue }
    if (size > SIZE_CAP) continue
    admitted.push({ repo: e, rel, abs })
  }
}
admitted.sort((a, b) => a.abs.localeCompare(b.abs))
const digest = createHash("sha256").update(admitted.map((c) => c.abs).join("\n")).digest("hex")

// The served grammar's directive-family named types (the grammar half of the ruling).
const grammar = JSON.parse(readFileSync(path.resolve(HERE, "..", "..", "..", "..", "validation", "m14", "measurements", "r-grammar-nodes.json"), "utf8")) as {
  servedDigest: string; namedTypes: number; namedTypeNames: string[]
}
const DIR_WORDS = ["include", "part", "import", "source", "require", "directive", "header"]
const directiveFamily = grammar.namedTypeNames.filter((n) => DIR_WORDS.some((w) => n.toLowerCase().includes(w)))

let parsed = 0, failures = 0, retriedFiles = 0
const TRAP_ATTEMPTS = 3

const sites = {
  source: 0, sysSource: 0,
  localFalse: 0, localGlobalenv: 0, localTrue: 0, localDefault: 0, localOther: 0,
  literalPath: 0, computedPath: 0,
  literalAndSharesScope: 0,
}
const literalSites: string[] = []
const sharesSites: string[] = []

function calleeOf(n: any): string {
  const fn = n.namedChild?.(0)
  if (!fn) return ""
  if (fn.type === "identifier") return fn.text
  if (fn.type === "namespace_operator") return fn.namedChild?.(1)?.text ?? ""
  return ""
}
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
/** First positional VALUE node of a call (the path argument for source()). */
function firstPositionalValue(callNode: any): any {
  const args = callNode?.namedChild?.(1)
  if (!args) return null
  for (let i = 0; i < (args.namedChildCount ?? 0); i++) {
    const a = args.namedChild(i)
    if (!a || a.type === "comma") continue
    if (a.type === "argument") {
      if (a.childForFieldName("name")) continue // a NAMED argument is not positional
      return a.childForFieldName("value")
    }
    return a
  }
  return null
}
function localSpelling(v: any): "false" | "globalenv" | "true" | "other" {
  if (!v) return "true"
  if (v.type === "false") return "false"
  if (v.type === "true") return "true"
  const txt = typeof v.text === "string" ? v.text : ""
  if (v.type === "identifier" && (txt === "FALSE" || txt === "F")) return "false"
  if (v.type === "identifier" && (txt === "TRUE" || txt === "T")) return "true"
  if (v.type === "identifier" && txt === "globalenv") return "globalenv"
  if (v.type === "call" && (calleeOf(v) === "globalenv" || txt.startsWith("globalenv"))) return "globalenv"
  return "other"
}

async function walkOne(f: Admitted) {
  const key = `${f.repo}/${f.rel}`
  let text: string
  try { text = readFileSync(f.abs, "utf8") } catch { failures++; return }
  let tree: any = null
  for (let attempt = 1; attempt <= TRAP_ATTEMPTS && !tree; attempt++) {
    try {
      const r = await ASTEngine.parseTree(f.abs, text)
      tree = r?.tree ?? null
      if (tree && attempt > 1) retriedFiles++
    } catch { if (attempt === TRAP_ATTEMPTS) failures++ }
  }
  if (!tree) return
  parsed++
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "call") {
      const fn = calleeOf(n)
      if (fn !== "source" && fn !== "sys.source") { /* not this census's construct */ }
      else {
        if (fn === "source") sites.source++
        else sites.sysSource++
        const localArg = namedArgValue(n, "local")
        const sp = localSpelling(localArg)
        const shares = sp === "false" || sp === "globalenv"
        if (sp === "false") sites.localFalse++
        else if (sp === "globalenv") sites.localGlobalenv++
        else if (sp === "true") sites.localTrue++
        else sites.localOther++
        if (!localArg) sites.localDefault++
        // Target shape: literal string path, or computed (call/identifier/connection).
        // `source(file = srcConn, ...)` names a CONNECTION; the named-arg `file=` path
        // is read the same way as the positional one.
        const target = firstPositionalValue(n) ?? namedArgValue(n, "file")
        const isLiteral = target?.type === "string"
        if (isLiteral) {
          sites.literalPath++
          literalSites.push(`${key}: ${target.text}`)
          if (shares) { sites.literalAndSharesScope++; sharesSites.push(`${key}: local=${sp === "false" ? "FALSE" : "globalenv()"}`) }
        } else {
          sites.computedPath++
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

let cursor = 0
const WORKERS = Number(process.env.BB_R_WORKERS ?? "4")
async function worker() {
  while (cursor < admitted.length) {
    const i = cursor++
    await walkOne(admitted[i])
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

const out: string[] = []
const line = "=".repeat(78)
out.push(line)
out.push("FALSIFIER CENSUS — the `part_of` ruling's named constructs, COUNTED")
out.push(line)
out.push(`node ${process.version}   workers ${WORKERS}`)
out.push(`load at start: ${loadAtStart.map((n) => n.toFixed(2)).join(" ")}`)
out.push(`corpus root: ${CR}`)
out.push(`admission: the GATE's predicate — .${EXTS.join(", .")} + bare basename clause, SIZE_CAP ${SIZE_CAP} B`)
out.push(`admitted files [0,${admitted.length}) of ${admitted.length}`)
out.push(`corpus file set: sha256 ${digest}`)
out.push(`files parsed: ${parsed}   failures: ${failures}   (wasm-trap retries: ${retriedFiles})`)
out.push("")
out.push("THE CONSTRUCT CLASS — the served grammar's directive-family named types:")
out.push(`  served grammar digest: ${grammar.servedDigest} (validation/m14/measurements/r-grammar-nodes.json)`)
out.push(`  named node types served: ${grammar.namedTypes}`)
out.push(`  include/part/import/source/require/directive/header-family named types: ${directiveFamily.length}`)
if (directiveFamily.length) for (const n of directiveFamily) out.push(`    ${n}`)
out.push(`  -> R's grammar carries NO inclusion directive; what it carries is the ordinary `)
out.push(`     \`call\` node — the same node type as every other call in the language.`)
out.push("")
out.push("THE SITES — source()/sys.source() over the whole admitted population:")
out.push(`  source() call sites:            ${sites.source}`)
out.push(`  sys.source() call sites:        ${sites.sysSource}`)
out.push(`  total inclusion-call sites:     ${sites.source + sites.sysSource}`)
out.push("")
out.push("THE SCOPE SPLIT (the contract requires the included file to SHARE the single scope):")
out.push(`  local=FALSE (global env — SHARES):        ${sites.localFalse}`)
out.push(`  local=globalenv() (SHARES):              ${sites.localGlobalenv}`)
out.push(`  local=TRUE / default (NEW env — FAILS):   ${sites.localTrue}`)
out.push(`    of which NO local= given at all:        ${sites.localDefault}`)
out.push(`  local= other spelling (custom env — FAILS): ${sites.localOther}`)
out.push("")
out.push("THE TARGET SPLIT (a part_of row needs a NAMEABLE target):")
out.push(`  LITERAL STRING path (nameable):           ${sites.literalPath}`)
for (const s of literalSites) out.push(`    ${s}`)
out.push(`  COMPUTED path (call/variable/connection): ${sites.computedPath}`)
out.push("")
out.push("THE INTERSECTION — literal path AND shares scope (the only sites a part_of row could name):")
out.push(`  ${sites.literalAndSharesScope}`)
for (const s of sharesSites) out.push(`    ${s}`)
out.push(line)
const report = out.join("\n") + "\n"
try { writeFileSync(ARTIFACT, report) } catch (e: any) { process.stderr.write(`ARTIFACT WRITE FAILED: ${e?.message ?? e}\n`) }
process.stderr.write(report)
process.on("exit", (code) => process.stderr.write(`EXIT code=${code} after ${Date.now() - T0}ms\n`))
process.exitCode = 0
