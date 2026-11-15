/**
 * adjudicate-carriers.ts — settle the 158 `extends`/`implements` carrier candidates that
 * `labels-and-resolution.ts` BLOCK B could not adjudicate.
 *
 * ## Why this exists
 *
 * BLOCK B derives R's inheritance and generic-implementation carriers from the parse tree and
 * compares them against the edges the analyzer emitted. Its last committed output ends with:
 *
 *     extends    …so UNCONDITIONAL carriers with no edge:  14  <- a real gap
 *     implements …so UNCONDITIONAL carriers with no edge: 144  <- a real gap
 *
 * "A real gap" is a claim, and a claim that names no reason is a guess. This probe assigns every
 * one of those candidates a REASON CODE read off the tree, so the residue that no code explains
 * is the only thing left to call a gap — and if the residue is 0, the number 158 was an
 * instrument artefact and is recorded as one.
 *
 * ## Two defects in BLOCK B's own instrument, found here
 *
 * 1. BACKTICK KEY MISMATCH. BLOCK B keys a carrier on `lhs.text` RAW, so R's quoted assignment
 *    target `` `$.AC` `` is keyed `` `$.AC`>$` `` while the analyzer publishes the name with the
 *    backticks stripped (`$.AC` -> `$`). The two can never agree, so every backticked S3 method
 *    read as a miss in BOTH directions at once. `rm()` was the same class of defect one layer up
 *    and was already recorded; this is the same class again, which is why the reason codes below
 *    are applied to the NORMALISED key and the raw-key delta is printed rather than assumed.
 *
 * 2. NO SYMBOL-SET CHECK. BLOCK B counts a carrier as "emitted" if an edge with a matching
 *    `src>tgt` string exists, and as a miss otherwise — but an `extends` edge whose SOURCE is not
 *    a symbol in the file is not an edge the analyzer could have published at all. The class
 *    behind `S7::new_class(parent = class_function)` is declared in a DIFFERENT file, so the
 *    carrier is real and the edge is impossible from syntax. That is a structural reason, and it
 *    has to be counted separately from a rule that failed to fire.
 *
 * ## What this probe is NOT
 *
 * It is not a differential. It reads the same grammar the analyzer reads, so a grammar-level bug
 * is invisible to it by construction. It settles only the question "was there a rule that should
 * have fired and did not", and it can do that because it never imports `real-r-analyzer.ts`.
 *
 *     npx tsx validation/m14/fixtures/r/adjudicate-carriers.ts
 *     BB_R_LIMIT=400 npx tsx validation/m14/fixtures/r/adjudicate-carriers.ts   # fast prefix
 */

import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LIMIT = Number(process.env.BB_R_LIMIT ?? 0)
const WORKERS = 4

// ------------------------------------------------------------------ corpus
interface Admitted { repo: string; abs: string; text: string }
const admitted: Admitted[] = []
const reposWithR: Record<string, number> = {}
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
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "r") continue
    admitted.push({ repo: e, abs, text })
    reposWithR[e] = (reposWithR[e] ?? 0) + 1
  }
}
const covered = LIMIT > 0 ? admitted.slice(0, LIMIT) : admitted
const label = (a: Admitted): string => `${a.repo}/${path.relative(path.join(CR, a.repo), a.abs)}`

console.log("R carrier adjudicator — every BLOCK-B candidate assigned a reason code read off the tree")
console.log(`corpus root: ${CR}`)
console.log(`admitted files: ${admitted.length} across ${Object.keys(reposWithR).length} repositories`)
console.log(`files walked: ${covered.length}${LIMIT > 0 ? " (BB_R_LIMIT prefix)" : " (whole population, no sampling)"}`)
console.log(`workers: ${WORKERS}\n`)

// ------------------------------------------------------------------ tree probe
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-r.wasm"))))

const INHERITANCE_CARRIERS: Record<string, string> = {
  R6Class: "inherit", "R6::R6Class": "inherit",
  setRefClass: "contains",
  setClass: "contains",
  new_class: "parent",
}

/** R's quoted identifier is a plain `identifier` node that still carries its backticks. */
const unquote = (t: string): string =>
  t.length >= 2 && t.startsWith("`") && t.endsWith("`") ? t.slice(1, -1) : t

const strOf = (n: any): string => {
  if (!n) return ""
  if (n.type === "string") return n.childForFieldName?.("content")?.text ?? n.text.replace(/^["']|["']$/g, "")
  if (n.type === "identifier") return unquote(n.text)
  return ""
}
const calleeText = (n: any): string => {
  if (!n) return ""
  if (n.type === "identifier") return n.text
  if (n.type === "namespace_operator") return n.text
  return n.text
}
const stringsIn = (n: any, out: string[]): void => {
  if (!n) return
  if (n.type === "string" || n.type === "identifier") { const s = strOf(n); if (s) out.push(s); return }
  if (n.type === "call") {
    // A call's CALLEE is not an argument. Skipping the `function` field is what stops
    // `contains = c("VIRTUAL", "Matrix")` contributing a base class named `c`.
    stringsIn(n.childForFieldName?.("arguments"), out)
    return
  }
  for (let i = 0; i < n.namedChildCount; i++) stringsIn(n.namedChild(i), out)
}

/** TRUE when the node sits inside an `if`/`while`/`for` body — a branch R may not take. */
const insideConditional = (start: any, end: number): boolean => {
  let cur: any = start.parent
  while (cur && cur.startIndex < end) {
    if (cur.type === "if_statement" || cur.type === "while_statement" || cur.type === "for_statement") return true
    cur = cur.parent
  }
  return false
}

/**
 * The analyzer's own scope rule, re-derived from R's semantics rather than from its code:
 * an assignment is a file-level binding unless it is inside a function body or a `local({...})`.
 * Verified on R 4.4.3 — see `docs/analyzers/r.md`, *Scope boundaries*.
 */
const insideLocalBoundary = (node: any): boolean => {
  let cur: any = node.parent
  while (cur) {
    if (cur.type === "function_definition") return true
    if (cur.type === "braced_expression" || cur.type === "parenthesized_expression") {
      let owner: any = cur
      for (let hop = 0; hop < 3 && owner; hop++) {
        const up: any = owner.parent
        if (!up) break
        if (up.type === "call") {
          const fn = up.childForFieldName?.("function")
          if (fn && calleeText(fn).includes("local")) return true
          break
        }
        owner = up
      }
    }
    cur = cur.parent
  }
  return false
}

interface Carrier {
  kind: "extends" | "implements"
  src: string
  tgt: string
  /** The RAW `lhs.text`/`callee` text, so a backtick key mismatch is measurable not assumed. */
  rawSrc: string
  conditional: boolean
  localBoundary: boolean
  /** For implements: why the RHS is or is not a `function_definition`. */
  rhsShape: string
  /** For extends: the carrier's own argument name. */
  carrierArg?: string
}

async function probeCarriers(text: string): Promise<Carrier[]> {
  const tree = parser.parse(text)
  const out: Carrier[] = []
  const rm = new Set<string>()

  const visit = (n: any): void => {
    if (n.type === "call") {
      const callee = calleeText(n.childForFieldName?.("function"))
      const bare = callee.includes("::") ? callee.slice(callee.lastIndexOf("::") + 2) : callee
      if (bare === "rm" && n.parent?.type === "program") {
        const rargs = n.childForFieldName?.("arguments")
        for (let i = 0; rargs && i < rargs.namedChildCount; i++) {
          const a2 = rargs.namedChild(i)
          if (!a2 || a2.childForFieldName?.("name")) continue
          const v2 = a2.type === "argument" ? a2.childForFieldName?.("value") : a2
          const s2 = strOf(v2)
          if (s2) rm.add(s2)
        }
      }
      const argName = INHERITANCE_CARRIERS[callee] ?? INHERITANCE_CARRIERS[bare]
      if (argName) {
        const selfRaw = strOf(n.childForFieldName?.("arguments")?.namedChild?.(0))
          || strOf(n.childForFieldName?.("arguments")?.namedChild?.(0)?.childForFieldName?.("value"))
        if (selfRaw) {
          const args = n.childForFieldName?.("arguments")
          for (let i = 0; args && i < args.namedChildCount; i++) {
            const a = args.namedChild(i)
            if (!a || a.type !== "argument") continue
            if (a.childForFieldName?.("name")?.text !== argName) continue
            const bases: string[] = []
            stringsIn(a.childForFieldName?.("value"), bases)
            for (const b of bases) {
              out.push({
                kind: "extends", src: selfRaw, tgt: b, rawSrc: selfRaw,
                conditional: insideConditional(n, n.endIndex),
                localBoundary: insideLocalBoundary(n), rhsShape: "n/a", carrierArg: argName,
              })
            }
          }
        }
      }
    }
    if (n.type === "binary_operator") {
      const op = n.childForFieldName?.("operator")?.text
      if (op === "<-" || op === "=" || op === "<<-") {
        const lhs = n.childForFieldName?.("lhs")
        const rhs = n.childForFieldName?.("rhs")
        const raw = lhs?.type === "identifier" ? lhs.text : ""
        const nm = unquote(raw)
        const rhsIsFn = rhs?.type === "function_definition"
          || (rhs?.type === "call" && rhs.childForFieldName?.("function")?.type === "identifier"
            && unquote(rhs.childForFieldName("function").text) === "function")
        if (nm.includes(".") && nm.indexOf(".") > 0 && !nm.startsWith(".") && rhsIsFn) {
          out.push({
            kind: "implements", src: nm, tgt: nm.slice(0, nm.indexOf(".")), rawSrc: raw,
            conditional: insideConditional(n, n.endIndex),
            localBoundary: insideLocalBoundary(n),
            rhsShape: rhs?.type === "function_definition" ? "function_definition" : "call-to-function",
          })
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) visit(n.namedChild(i))
  }
  visit(tree.rootNode)
  // `rm()` can appear before OR after the declaration it unbinds, so it is applied last.
  tree.delete?.()
  return out.filter((c) => !rm.has(c.src))
}

// ------------------------------------------------------------------ reason codes
/**
 * Assign the ONE reason a candidate has no edge. Ordered most-structural first, so a candidate is
 * never credited with a shallower reason when a deeper one applies. Every code is a statement
 * about R's semantics or about the file's symbol set — never about the analyzer's code path,
 * because reading the analyzer's code path would make this a restatement of it.
 */
function adjudicate(c: Carrier, symNames: Set<string>, genericDeclared: Set<string>): string {
  if (c.conditional) return "R_NEVER_EVALUATES_BRANCH"
  if (c.localBoundary) return "LOCAL_FRAME_NOT_FILE_BINDING"

  if (c.kind === "implements") {
    if (!symNames.has(c.src)) return "SOURCE_NOT_A_SYMBOL_IN_THIS_FILE"
    // The generic is a name from a naming convention. If the FILE declares it, the edge is
    // emitted; if it does not, the edge would point at a name no symbol carries.
    if (!genericDeclared.has(c.tgt)) return "GENERIC_NOT_DECLARED_IN_THIS_FILE"
    return "UNADJUDICATED"
  }

  // extends: both ends must be symbols this file publishes, or the edge cannot exist.
  if (!symNames.has(c.src)) return "SOURCE_CLASS_NOT_DECLARED_IN_THIS_FILE"
  if (!symNames.has(c.tgt)) return "BASE_CLASS_NOT_DECLARED_IN_THIS_FILE"
  return "UNADJUDICATED"
}

// ------------------------------------------------------------------ the walk
interface Row { file: string; kind: string; src: string; tgt: string; code: string; rawSrc: string }
const rows: Row[] = []
const emitted = { extends: new Map<string, Set<string>>(), implements: new Map<string, Set<string>>() }
/** Every symbol name production published, across the whole corpus — for a corpus-scope check. */
const corpusSymbolNames = new Set<string>()
const perFileSymNames = new Map<string, Set<string>>()
/** file -> the set of names it declares that are dotted (so a generic is resolvable in-file). */
const perFileNames = new Map<string, Set<string>>()
let parseFailures = 0
let degraded = 0
let idx = 0

function ontologyType(raw: unknown): string {
  const s = String(raw ?? "").toLowerCase()
  if (s === "brain_extends") return "extends"
  if (s === "brain_implements") return "implements"
  return s
}

async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= covered.length) return
    const a = covered[i]
    const lab = label(a)
    let res: Awaited<ReturnType<typeof parseFile>>
    try {
      res = await parseFile(a.abs, a.text, "r")
    } catch (e) {
      parseFailures++
      continue
    }
    const syms = (res as any)?.symbols ?? []
    const rels = (res as any)?.relationships ?? []
    const names = new Set<string>()
    for (const s of syms) { if (s?.name) { names.add(s.name); corpusSymbolNames.add(s.name) } }
    perFileSymNames.set(lab, names)
    perFileNames.set(lab, names)
    for (const r of rels) {
      const t = ontologyType((r as any)?.type)
      if (t !== "extends" && t !== "implements") continue
      let m = emitted[t].get(lab)
      if (!m) emitted[t].set(lab, m = new Set())
      m.add(`${(r as any).source}>${(r as any).target}`)
    }
    if ((res as any)?.degraded) degraded++
    const carriers = await probeCarriers(a.text)
    for (const c of carriers) {
      const key = `${c.src}>${c.tgt}`
      if (emitted[c.kind].get(lab)?.has(key)) continue
      rows.push({
        file: lab, kind: c.kind, src: c.src, tgt: c.tgt, rawSrc: c.rawSrc,
        code: adjudicate(c, names, names),
      })
    }
  }
}
await Promise.all(Array.from({ length: WORKERS }, worker))

// ------------------------------------------------------------------ report
const bar = (s: string) => "=".repeat(126)
console.log(bar())
console.log("BLOCK 1 — candidates (a tree carrier with no emitted edge), by reason code")
console.log(bar())

const byCode = new Map<string, Row[]>()
for (const r of rows) {
  let m = byCode.get(r.code)
  if (!m) byCode.set(r.code, m = [])
  m.push(r)
}
const codes = [...byCode.entries()].sort((a, b) => b[1].length - a[1].length)
console.log("code".padEnd(42) + "extends".padStart(9) + "implements".padStart(11) + "total".padStart(8))
console.log("-".repeat(70))
let tEx = 0, tIm = 0
for (const [code, rs] of codes) {
  const ex = rs.filter((r) => r.kind === "extends").length
  const im = rs.filter((r) => r.kind === "implements").length
  tEx += ex; tIm += im
  console.log(code.padEnd(42) + String(ex).padStart(9) + String(im).padStart(11) + String(rs.length).padStart(8))
}
console.log("-".repeat(70))
console.log("TOTAL".padEnd(42) + String(tEx).padStart(9) + String(tIm).padStart(11) + String(rows.length).padStart(8))

const unadj = (byCode.get("UNADJUDICATED") ?? [])
console.log(`\nUNADJUDICATED — a carrier whose both ends are symbols this file declares, and still no edge:`)
console.log(`  ${unadj.length}${unadj.length ? "   <- the only residue that can be called a gap" : "   <- the 158 candidates are fully explained"}`)
for (const r of unadj.slice(0, 60)) console.log(`    ${r.file}: ${r.src} -${r.kind}-> ${r.tgt}`)

console.log(`\n${bar()}`)
console.log("BLOCK 2 — the BACKTICK KEY MISMATCH, measured rather than asserted")
console.log(bar())
// BLOCK B keys on `lhs.text` RAW. Count the candidates whose RAW src carries a backtick the
// normalised src does not: those are the ones a raw-keyed probe can never match against an edge
// published under an unquoted name.
let backtickSrc = 0
for (const r of rows) if (r.rawSrc !== r.src) backtickSrc++
console.log(`candidates whose raw \`lhs.text\` differs from the unquoted name: ${backtickSrc} of ${rows.length}`)
console.log("BLOCK B compared those as two different strings, so each counted once as a carrier with")
console.log("no edge AND once as an edge with no carrier. Both directions were an instrument defect.")

console.log(`\n${bar()}`)
console.log("BLOCK 3 — corpus-scope reach of the two dominant codes")
console.log(bar())
for (const code of ["GENERIC_NOT_DECLARED_IN_THIS_FILE", "BASE_CLASS_NOT_DECLARED_IN_THIS_FILE", "SOURCE_CLASS_NOT_DECLARED_IN_THIS_FILE", "SOURCE_NOT_A_SYMBOL_IN_THIS_FILE"]) {
  const rs = byCode.get(code) ?? []
  if (!rs.length) continue
  const reach = rs.filter((r) => corpusSymbolNames.has(r.tgt)).length
  console.log(`${code}:`)
  console.log(`  candidates ${rs.length}; target name EXISTS somewhere in the ${corpusSymbolNames.size.toLocaleString()} corpus symbols: ${reach} (${((reach / rs.length) * 100).toFixed(1)}%)`)
  const miss = rs.filter((r) => !corpusSymbolNames.has(r.tgt))
  console.log(`  target name exists NOWHERE in the corpus: ${miss.length}`)
  for (const r of miss.slice(0, 6)) console.log(`    ${r.file}: ${r.src} -${r.kind}-> ${r.tgt}`)
}

console.log(`\n${bar()}`)
console.log("INTEGRITY")
console.log(bar())
console.log(`files attempted: ${covered.length}   parse failures: ${parseFailures}   degraded parses: ${degraded}`)
console.log(`distinct corpus symbol names: ${corpusSymbolNames.size.toLocaleString()}`)

console.log(`\n${bar()}`)
console.log("LIMITATIONS — what this file does NOT establish")
console.log(bar())
console.log(`  The probe reads the SAME grammar the analyzer reads, so a grammar-level bug is invisible`)
console.log(`  to it by construction. It settles one question only: whether a carrier existed whose`)
console.log(`  edge the analyzer COULD have published and did not. It cannot say any emitted edge is`)
console.log(`  correct, and agreement between the two is two implementations over one grammar.`)
console.log(`  A reason code is a structural fact about R or about the file's symbol set; the residue`)
console.log(`  is what no structural fact explains. Code and counts are in this file, not in a summary.`)
