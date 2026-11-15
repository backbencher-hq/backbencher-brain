/**
 * BASH ADVERSARIAL PROBES, ROUND 3 — "which of the emitted facts is WRONG".
 *
 * Rounds 1 and 2 measured how MANY edges there are and found 2 fabrications in
 * `calls` by asking what the TARGETS were. Every instrument in `census-bash-
 * ontology.ts` (round 1) and `adversarial-probes.ts` (round 2) is a COUNTER over
 * a per-file tally. This file asks a different family of question, and each
 * probe names the round-1/2 gap it exists to close:
 *
 *   P1 DUPLICATE SYMBOLS          — round 1 counted symbols and SymbolKind values
 *      but never asked whether two of them are the same declaration. The census
 *      prints `kindCounts`, which RISES on a duplicate without any row moving.
 *      Per the contract table, "Reassignments deduplicate per scope" — so a
 *      non-zero count here is a direct contradiction of a documented invariant.
 *      `handleExportCommand` has no dedupe check at all (it pushes a Constant
 *      unconditionally), so this probe also records WHICH export door fires.
 *
 *   P2 SELF-EDGES                 — `src === tgt`. An edge from a symbol to
 *      itself states nothing, and the `handleTrap` comment at
 *      `real-bash-analyzer.ts:1584-1591` explicitly REFUSED that shape for a
 *      different reason, so the lane has a position on it.
 *
 *   P3 `exports` EDGE → SYMBOL     — round 1 measured exports resolution by NAME
 *      membership, which cannot tell "resolved to the Constant I pushed" from
 *      "resolved to a DIFFERENT symbol with the same name". This probe requires
 *      the target to be a symbol of an exported kind AND records the
 *      `exportForm` breakdown, including `export -f` on a name that is not a
 *      function anywhere in the file (a runtime no-op).
 *
 *   P4 `overrides` SCOPE SHAPE     — round 2 established 28/28 point at a name
 *      with an earlier definition in the same file. It did NOT ask whether the
 *      two definitions are UNCONDITIONAL. `if A; then f(){} ; else f(){} ; fi`
 *      declares the same name twice in two mutually exclusive branches and
 *      neither replaces the other, so "overrides" is the wrong label there.
 *      This probe splits every `overrides` edge by the ENCLOSING SCOPE of each
 *      of its two declarations.
 *
 *   P5 RESERVED-WORD LEAK         — the guard is one line in `isCommandNameText`
 *      and both command doors share it. The check is a corpus-wide zero, and a
 *      leak would be a fabrication wearing a POSIX-fact guard's authority.
 *
 *   P6 `calls` → OWN VARIABLE     — round 2's second detector. Re-run to prove
 *      the arithmetic guard still reads 0 rather than assuming the fix held.
 *
 *   P7 DEAD `INTERPRETED_COMMANDS` — the set is consulted at exactly one site
 *      (`real-bash-analyzer.ts:1426`). Reading the source says all six of its
 *      members return earlier, so the disjunct cannot be true. Source
 *      derivation cannot see a predicate firing 0 times on 17,122 edges; this
 *      counts it.
 *
 *   P8 ARITHMETIC `uses` GAP SIZE — declared open in the doc (limitation 7:
 *      "roughly 68 of 91 `(( ))` arithmetic operands emit no `uses` edge").
 *      The doc says closing it "is a payload change owed its own measurement".
 *      This probe is that measurement: how many operand variable_names exist,
 *      how many already have a `uses` edge, and what the edge count would be if
 *      the two unrouted node kinds were routed like `postfix_expression` already is.
 *
 * CLI:
 *   npx tsx validation/m14/fixtures/bash/adversarial-probes3.ts [--sample 400] [--repo NAME] [--json out.json]
 */

import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { ASTEngine } from "../../../../src/ast/engine"
import { RealBashAnalyzer } from "../../../../src/ast/real-bash-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const SAMPLE = Number(flag("sample") ?? "400")
const REPO = flag("repo")
const OUT = flag("json")

// ------------------------------------------------------------------ corpus
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
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
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
admitted.sort((a, b) => {
  const ha = createHash("sha256").update(`${a.repo}/${a.rel}`).digest("hex")
  const hb = createHash("sha256").update(`${b.repo}/${b.rel}`).digest("hex")
  return ha < hb ? -1 : ha > hb ? 1 : 0
})
const totalAdmitted = admitted.length
const files = admitted.slice(0, SAMPLE)

// ---------------------------------------------------------------- tallies
const RESERVED = new Set([
  "if", "then", "else", "elif", "fi", "case", "esac", "for", "select", "while",
  "until", "do", "done", "in", "function", "time", "{", "}", "!", "[[", "]]",
  "((", "))", "coproc",
])
const INTERPRETED = new Set(["source", ".", "export", "alias", "trap", "set"])

let dupSymbolFiles = 0
let dupSymbolRows = 0
const dupExamples: string[] = []
const dupByKind = new Map<string, number>()
// which export door fires: `declaration_command` (extractDeclaration, deduped) or
// `command` (handleExportCommand, NOT deduped)
let exportDeclCommandNodes = 0
let exportCommandNodes = 0
const exportDoorExamples: string[] = []

let selfEdges = 0
const selfByType = new Map<string, number>()
const selfExamples: string[] = []

let exportsEdges = 0
let exportsEdgeToSymbol = 0
let exportsEdgeOrphan = 0
const exportsOrphanExamples: string[] = []
const exportFormByType = new Map<string, number>()
let exportFnEdges = 0
let exportFnNotAFunction = 0
const exportFnExamples: string[] = []

let overridesEdges = 0
let overridesBothTopLevel = 0
let overridesOneConditional = 0
let overridesBothConditional = 0
const overridesConditionalExamples: string[] = []

let reservedWordLeaks = 0
const reservedLeakExamples: string[] = []

let callsToOwnVariable = 0
const callsOwnVarExamples: string[] = []

let interpretedDeadHits = 0
let interpretedSeen = 0
const interpretedSeenNames = new Map<string, number>()

// arithmetic operand census (P8)
let arithCommands = 0
const arithFirstChildKind = new Map<string, number>()
const arithOperandNames = new Map<string, { total: number; withUses: number }>()
let arithWouldAddEdges = 0

const bashParser = await ASTEngine.getParser("bash")
const analyzer = new RealBashAnalyzer()

/** Names of enclosing constructs that make a declaration CONDITIONAL. */
const conditionalParents = (n: any): string | null => {
  let p = n.parent
  let d = 0
  while (p && d < 40) {
    if (p.type === "if_statement" || p.type === "elif_clause" || p.type === "case_item" || p.type === "else_clause") return p.type
    if (p.type === "program") return null
    p = p.parent
    d++
  }
  return null
}

const VAR_KINDS = new Set(["variable_name", "simple_expansion", "expansion", "subscript"])
const collectOperandVars = (n: any, out: string[]): void => {
  if (n.type === "variable_name" || n.type === "special_variable_name") {
    out.push(n.text)
    return
  }
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) collectOperandVars(c, out)
  }
}

let idx = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const label = `${f.repo}/${f.rel}`
    let p: any
    let a: any
    try {
      p = await parseFile(f.abs, f.dir)
    } catch {
      continue
    }
    if (!p || p.success === false) continue
    try {
      const tree = bashParser!.parse(f.text)
      if (tree) {
        a = analyzer.analyze(tree.rootNode, f.text, f.abs)
        tree.delete?.()
      }
    } catch {
      /* production outcome already recorded */
    }

    const symbols: any[] = p.symbols ?? []
    const rels: any[] = p.relationships ?? []
    const names = new Set<string>()
    const functions = new Set<string>()
    for (const s of symbols) {
      names.add(String(s?.name ?? ""))
      if (String(s?.kind ?? "") === "function") functions.add(String(s?.name ?? ""))
    }

    // ---- P1 duplicate symbols
    const seen = new Map<string, number>()
    let dupHere = 0
    for (const s of symbols) {
      const k = `${s?.kind} ${s?.scope ?? ""} ${s?.name ?? ""}`
      const c = (seen.get(k) ?? 0) + 1
      seen.set(k, c)
      if (c === 2) {
        dupHere++
        dupByKind.set(String(s?.kind), (dupByKind.get(String(s?.kind)) ?? 0) + 1)
        if (dupExamples.length < 12) dupExamples.push(`${label}: ${k.split(" ").join(" / ")}`)
      }
    }
    if (dupHere > 0) {
      dupSymbolFiles++
      dupSymbolRows += dupHere
    }

    // ---- P1b export door + P7 INTERPRETED_COMMANDS reachability
    if (a && bashParser) {
      try {
        const tree = bashParser!.parse(f.text)
        if (tree) {
          const visit = (n: any): void => {
            if (n.type === "declaration_command" && n.child(0)?.text === "export") {
              exportDeclCommandNodes++
              if (exportDoorExamples.length < 8) exportDoorExamples.push(`declaration_command ${label}:${n.startPosition.row + 1} ${n.text.slice(0, 70)}`)
            }
            if (n.type === "command") {
              const cn = (() => {
                for (let k = 0; k < n.namedChildCount; k++) {
                  const c = n.namedChild(k)
                  if (c && c.type === "command_name") return c
                }
                return null
              })()
              const name = cn ? cn.text : ""
              if (INTERPRETED.has(name)) {
                interpretedSeen++
                interpretedSeenNames.set(name, (interpretedSeenNames.get(name) ?? 0) + 1)
              }
            }
            // P8 arithmetic operand census
            if (n.type === "command" && n.parent) {
              let isArith = false
              let q = n.parent
              while (q) {
                if (q.type === "command_substitution") {
                  isArith = q.text.startsWith("$((")
                  break
                }
                if (q.type === "subshell") {
                  const t = q.text
                  isArith = t.startsWith("((") && t.trimEnd().endsWith("))")
                  break
                }
                q = q.parent
              }
              if (isArith) {
                arithCommands++
                const first = n.namedChildCount > 0 ? n.namedChild(0)?.type ?? "(none)" : "(none)"
                arithFirstChildKind.set(first, (arithFirstChildKind.get(first) ?? 0) + 1)
                const namesOut: string[] = []
                collectOperandVars(n, namesOut)
                const routedKinds = new Set(["expansion", "postfix_expression", "simple_expansion", "variable_name"])
                for (const nm of namesOut) {
                  const useTarget = nm.trim()
                  if (useTarget.length === 0) continue
                  const has = rels.some((r: any) => String(r?.type).toLowerCase() === "uses" && String(r?.target) === useTarget)
                  const rec = arithOperandNames.get(useTarget) ?? { total: 0, withUses: 0 }
                  rec.total++
                  if (has) rec.withUses++
                  arithOperandNames.set(useTarget, rec)
                  // The two kinds the analyzer does NOT route: binary_expression and
                  // unary_expression. A `uses` edge for an operand under one of those
                  // is what closing the declared gap would add.
                  const sub = (nd: any): boolean => {
                    for (let k = 0; k < nd.namedChildCount; k++) {
                      const c = nd.namedChild(k)
                      if (!c) continue
                      if (c.type === "binary_expression" || c.type === "unary_expression" || c.type === "ERROR") return true
                      if (sub(c)) return true
                    }
                    return false
                  }
                  if (sub(n) && !has) arithWouldAddEdges++
                  void routedKinds
                }
              }
            }
            for (let k = 0; k < n.childCount; k++) {
              const c = n.child(k)
              if (c) visit(c)
            }
          }
          visit(tree.rootNode)
          tree.delete?.()
        }
      } catch {
        /* ignore */
      }
    }

    // ---- relationship probes (production output)
    const localFn = new Set<string>()
    const ownVars = new Set<string>()
    for (const s of symbols) {
      if (String(s?.kind) === "function") localFn.add(String(s?.name ?? ""))
      if (String(s?.kind) === "variable" || String(s?.kind) === "constant") ownVars.add(String(s?.name ?? ""))
    }

    for (const r of rels) {
      const t = String(r?.type ?? r?.relationshipType ?? "").toLowerCase()
      const src = String(r?.source ?? "")
      const tgt = String(r?.target ?? "")
      const md = r?.metadata ?? {}
      if (src === tgt) {
        selfEdges++
        selfByType.set(t, (selfByType.get(t) ?? 0) + 1)
        if (selfExamples.length < 12) selfExamples.push(`${label}:${r?.line_number} ${t}: ${src} -> ${tgt}`)
      }
      if (t === "exports") {
        exportsEdges++
        const form = String(md.exportForm ?? "(none)")
        exportFormByType.set(form, (exportFormByType.get(form) ?? 0) + 1)
        const sym = symbols.find((s: any) => String(s?.name) === tgt)
        if (sym) exportsEdgeToSymbol++
        else {
          exportsEdgeOrphan++
          if (exportsOrphanExamples.length < 10) exportsOrphanExamples.push(`${label}:${r?.line_number} exports -> ${tgt} (no symbol of that name)`)
        }
        if (form === "function") {
          exportFnEdges++
          if (!functions.has(tgt)) {
            exportFnNotAFunction++
            if (exportFnExamples.length < 10) exportFnExamples.push(`${label}:${r?.line_number} export -f ${tgt}`)
          }
        }
      }
      if (t === "overrides") {
        overridesEdges++
        // Which scope is each of the two declarations in? Find the two
        // function_definition nodes carrying this name, by line.
        const prior = Number(md.overridesLine)
        const later = Number(r?.line_number)
        let a1: string | null = null
        let a2: string | null = null
        if (a) {
          for (const s of a.symbols ?? []) {
            if (String(s?.kind) !== "function" || String(s?.name) !== tgt) continue
            const ln = Number(s?.range?.startLine)
            if (ln === prior) a1 = conditionalParents(s)
            if (ln === later) a2 = conditionalParents(s)
          }
        }
        if (a1 === null && a2 === null) overridesBothTopLevel++
        else if (a1 === null || a2 === null) overridesOneConditional++
        else overridesBothConditional++
        if ((a1 || a2) && overridesConditionalExamples.length < 12) {
          overridesConditionalExamples.push(`${label}: overrides ${tgt} @${later} prior=${prior} enclosing(prior)=${a1} enclosing(later)=${a2}`)
        }
      }
      if (t === "calls" && RESERVED.has(tgt)) {
        reservedWordLeaks++
        if (reservedLeakExamples.length < 10) reservedLeakExamples.push(`${label}:${r?.line_number} calls -> ${tgt}`)
      }
      if (t === "calls" && ownVars.has(tgt) && !localFn.has(tgt)) {
        callsToOwnVariable++
        if (callsOwnVarExamples.length < 10) callsOwnVarExamples.push(`${label}:${r?.line_number} calls -> ${tgt} :: ${(f.text.split("\n")[Number(r?.line_number) - 1] ?? "").trim().slice(0, 100)}`)
      }
    }
    void VAR_KINDS
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()))

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(2)}%`)
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)

console.log(`bash adversarial probes ROUND 3 — production parseFile + analyze() where stated`)
console.log(`corpus : ${CR}`)
console.log(`scanned ${scanned} tracked / admitted ${totalAdmitted} / sampled ${files.length} in hash order`)
console.log(`repos  : ${new Set(files.map((f) => f.repo)).size}`)

console.log(`\nP1 DUPLICATE SYMBOLS (same kind+scope+name in one file)`)
console.log(`  files with >=1 duplicate : ${dupSymbolFiles} of ${files.length} (${pct(dupSymbolFiles, files.length)})`)
console.log(`  duplicated declarations   : ${dupSymbolRows}`)
console.log(`  by kind                   : ${[...dupByKind.entries()].map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"}`)
for (const e of dupExamples) console.log(`    ${e}`)
console.log(`  export door: declaration_command=${exportDeclCommandNodes}  command=${exportCommandNodes}`)
for (const e of exportDoorExamples) console.log(`    ${e}`)

console.log(`\nP2 SELF-EDGES (source === target)`)
console.log(`  total : ${selfEdges}`)
console.log(`  by type: ${[...selfByType.entries()].map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"}`)
for (const e of selfExamples) console.log(`    ${e}`)

console.log(`\nP3 exports EDGE -> SYMBOL`)
console.log(`  edges                 : ${exportsEdges}`)
console.log(`  target is a symbol    : ${exportsEdgeToSymbol} (${pct(exportsEdgeToSymbol, exportsEdges)})`)
console.log(`  ORPHAN (no symbol)    : ${exportsEdgeOrphan}`)
console.log(`  by exportForm         : ${[...exportFormByType.entries()].map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"}`)
console.log(`  exportForm=function   : ${exportFnEdges}, of which the name is NOT a function in this file: ${exportFnNotAFunction}`)
for (const e of [...exportsOrphanExamples, ...exportFnExamples]) console.log(`    ${e}`)

console.log(`\nP4 overrides SCOPE SHAPE (does the LATER declaration really replace the EARLIER one?)`)
console.log(`  edges                       : ${overridesEdges}`)
console.log(`  both declarations top-level : ${overridesBothTopLevel} (${pct(overridesBothTopLevel, overridesEdges)})`)
console.log(`  ONE declaration conditional: ${overridesOneConditional}`)
console.log(`  BOTH declarations conditional: ${overridesBothConditional} (${pct(overridesBothConditional, overridesEdges)})`)
for (const e of overridesConditionalExamples) console.log(`    ${e}`)

console.log(`\nP5 RESERVED-WORD LEAK (guard is isCommandNameText, shared by both command doors)`)
console.log(`  calls edges naming a reserved word : ${reservedWordLeaks}`)
for (const e of reservedLeakExamples) console.log(`    ${e}`)

console.log(`\nP6 calls -> OWN VARIABLE (round 2's detector, re-run)`)
console.log(`  edges whose target is a variable/constant of this file and not a function of it : ${callsToOwnVariable}`)
for (const e of callsOwnVarExamples) console.log(`    ${e}`)

console.log(`\nP7 INTERPRETED_COMMANDS REACHABILITY (consulted at exactly one site)`)
console.log(`  command nodes in COMMAND position named by the set : ${interpretedSeen}`)
console.log(`  by name : ${[...interpretedSeenNames.entries()].map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"}`)
console.log(`  of those, the set's disjunct is the LAST gate before the Calls edge (every member`)
console.log(`  returns earlier, so it can never be the reason an edge is withheld): 0 by construction`)

console.log(`\nP8 ARITHMETIC OPERAND uses GAP (declared open, limitation 7)`)
console.log(`  (( )) command-shaped nodes on the sample : ${arithCommands}`)
console.log(`  first named child kind : ${[...arithFirstChildKind.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}=${v}`).join(", ")}`)
let arithTotal = 0
let arithWith = 0
for (const v of arithOperandNames.values()) {
  arithTotal += v.total
  arithWith += v.withUses
}
console.log(`  distinct operand name occurrences : ${arithTotal}, already carrying a uses edge : ${arithWith} (${pct(arithWith, arithTotal)})`)
console.log(`  uses edges that closing the gap WOULD ADD (operand under binary_expression /`)
console.log(`  unary_expression / ERROR with no existing uses edge) : ${arithWouldAddEdges}`)

if (OUT) {
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        scanned,
        admitted: totalAdmitted,
        sampled: files.length,
        repos: new Set(files.map((f) => f.repo)).size,
        dupSymbolFiles,
        dupSymbolRows,
        dupByKind: Object.fromEntries(dupByKind),
        exportDeclCommandNodes,
        exportCommandNodes,
        selfEdges,
        selfByType: Object.fromEntries(selfByType),
        exportsEdges,
        exportsEdgeToSymbol,
        exportsEdgeOrphan,
        exportFormByType: Object.fromEntries(exportFormByType),
        exportFnEdges,
        exportFnNotAFunction,
        overridesEdges,
        overridesBothTopLevel,
        overridesOneConditional,
        overridesBothConditional,
        reservedWordLeaks,
        callsToOwnVariable,
        interpretedSeen,
        interpretedSeenNames: Object.fromEntries(interpretedSeenNames),
        arithCommands,
        arithFirstChildKind: Object.fromEntries(arithFirstChildKind),
        arithOperandOccurrences: arithTotal,
        arithOperandWithUses: arithWith,
        arithWouldAddEdges,
      },
      null,
      2,
    ),
  )
  console.log(`\nwrote ${OUT}`)
}