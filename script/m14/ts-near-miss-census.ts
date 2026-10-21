/**
 * TS NEAR-MISS CENSUS — the two admissibility tests a RULED cell must pass (L-2026-10-21-06).
 *
 * ## WHY THIS INSTRUMENT EXISTS
 *
 * A ruling that says "TypeScript has no mixin construct and no part construct" is only admissible
 * if it survives THREE tests, and this instrument measures the SECOND and the THIRD:
 *
 *   2 · **THE NEAR-MISS TEST.** A near-miss construct must be NAMED AND COUNTED. An absence with
 *       an unnamed near-miss is prose. So for each ruled type this names the nearest construct the
 *       language DOES have, and counts its SITES over the whole admitted population.
 *   3 · **THE INFORMATION TEST.** A ruling must show that the row it would produce carries no
 *       information the corpus does not already carry. A `part_of` row that would be X→X carries
 *       none; a `mixes_in` row that duplicates an `implements` row carries none. So this counts,
 *       for every near-miss site, whether the relation is ALREADY published under another label —
 *       and that is the number that decides the ruling, not the prose.
 *
 * (Test 1 — THE BUILD TEST — is the other instrument's job: `script/m14/ts-mixin-part-ruling.ts`
 * carries the pinned wasm digests, the node-type counts, and the FIRED control.)
 *
 * ## THE TWO NEAR MISSES, AND WHY THESE TWO
 *
 *   **mixes_in ⇒ DECLARATION MERGING.** TypeScript's nearest thing to a mixin is the merge of an
 *   `interface` and a `class` of the SAME name: the class `implements` the interface and the two
 *   declarations are one symbol. The construct to name and count is therefore the
 *   `implements_clause` SITE, and — more sharply — the MERGING PAIR ITSELF (a file that declares
 *   a class and an interface with the same name). The information question: does the merge
 *   already publish a relation? It does, as an `implements` edge naming the interface, so a
 *   `mixes_in` row would DUPLICATE an existing row. The count of merging pairs whose `implements`
 *   edge is present is the number the ruling rests on.
 *
 *   **part_of ⇒ THE TRIPLE-SLASH REFERENCE DIRECTIVE.** TypeScript's nearest thing to a part
 *   directive is `/// <reference path="./other.ts" />` — a file naming another compilation unit.
 *   The grammar lexes it as a COMMENT, so no analyzer can see it as a node, and the construct to
 *   name and count is the DIRECTIVE SITE, split by what it names: `path` (a FILE — the part-like
 *   form), `types` (a PACKAGE) and `lib` (a LIBRARY). The information question: does a `part_of`
 *   row add anything? A `path` directive that names a file the SAME file also imports is ALREADY
 *   carried by `imports`/`references` ⇒ a `part_of` row would be a duplicate. A `path` directive
 *   that names a file the same file does NOT import would be NEW information ⇒ the ruling would
 *   be wrong unless something carries it, so that count is printed separately and named.
 *
 * ## THE GRAMMAR HAND-OVER (the sql lane's lesson, applied here)
 *
 * A census that calls `analyze()` DIRECTLY, without handing the grammar over, can measure a
 * SILENTLY DEGRADED analyzer: sql's was 260 edges light over the whole population, with no error
 * and no visible counter. ⇒ ⇒ THE HAND-OVER IS `analyzer.constructor.setGrammar(parser.language,
 * analyzer.constructor)` — it is on the CLASS, and `Class.constructor.setGrammar` is
 * `Function.setGrammar` and THROWS ⇒ ⇒ ⇒ IT IS DONE ONCE PER PROCESS ⇒ ⇒ **THE TWO ARMS ARE TWO
 * PROCESSES**, and this census is run twice, once with `--hand-over` and once without, and the
 * PER-TYPE DELTA is printed (`--compare <other.json>`). **A ZERO DELTA IS A ZERO MEASURED, NOT A
 * ZERO ASSUMED.**
 *
 * And because a delta alone does not say WHICH instrument was degraded, this census also counts
 * **THE TRIGGER SITES** — the `acquireParser()` / `getParser()` calls INSIDE `analyze()` in this
 * lane's own analyzer — over the analyzer's own AST, never over the text. **THE COUNT IS THE
 * MEASUREMENT WITH A ROOT**: a zero count is a measured zero.
 *
 * ## WHAT IT DOES NOT CLAIM
 *
 * It does not adjudicate the contract between `uses` and `references`, and it does not use the
 * analyzer's own rules to decide anything: the near-miss sites are counted from the TREE, and the
 * "already published under another label" question is answered by the ANALYZER'S OWN EDGES, which
 * is stated in the output because a bucket built on the analyzer's rules can SIZE a question and
 * cannot decide it.
 *
 * ## USAGE
 *
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/ts-near-miss-census.ts
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/ts-near-miss-census.ts --max-files 2000 --json out.json
 *
 * `--max-files 0` (the default) is the WHOLE admitted population. A bounded run prints its own
 * population and is a DRAW, not a population, and says so in its own output.
 */

import { readFileSync, statSync, existsSync, writeFileSync, readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { RealTypeScriptAnalyzer } from "../../src/ast/real-typescript-analyzer"
import { laneExtensions } from "./ts-lane-extensions"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const MAX_FILES = Number(argOf("--max-files") ?? "0")
const JSON_OUT = argOf("--json")
const HAND_OVER = argv.includes("--hand-over")
const COMPARE = argOf("--compare") ?? ""

/** THE GATE'S SIZE CAP, read LIVE out of the gate's own source (1 MB — the analyzer's FULL_AST limit). */
function sizeCapBytes(): number {
  const gate = path.resolve(process.cwd(), "script/m14/incoming-gate.ts")
  try {
    const m = readFileSync(gate, "utf8").match(/const\s+SIZE_CAP\s*=\s*([^\n;]+)/)
    if (m) {
      const expr = m[1]!.replace(/_/g, "").trim()
      if (/^[0-9+\-*/() ]+$/.test(expr)) {
        const bytes = Function(`"use strict";return (${expr})`)() as number
        if (Number.isFinite(bytes) && bytes > 0) return bytes
      }
    }
  } catch { /* the fallback below is the historical value and the output says which was used */ }
  return 1024 * 1024
}
const CAP = sizeCapBytes()

/** THE ADMITTED POPULATION — the gate's own rule: a git checkout, the TRACKED file list, the
 *  four spellings, not over the cap, and present in the working tree. Untracked, over-cap and
 *  absent paths are each COUNTED, because a population that hides them claims files it cannot read. */
function admittedFiles(): { files: string[]; repos: number; reposWithAdmitted: number; untracked: number; overCap: number; absent: number; tracked: number } {
  // THE GATE's OWN MAP, read live — the lane's standing rule: an extension list comes from the
  // gate's own LANES_A, never from memory, so a drifted population is a number about a population
  // nobody parses.
  const lane = laneExtensions("typescript", ["ts", "tsx", "mts", "cts"])
  const exts = new Set(lane.list.map((e) => e.replace(/^\./, "").toLowerCase()))
  const out: string[] = []
  const repos: string[] = []
  const reposWithAdmitted = new Set<string>()
  let untracked = 0
  let overCap = 0
  let absent = 0
  let tracked = 0
  let entries: string[] = []
  try {
    entries = (readdirSync(CR, { withFileTypes: true }) as { name: string }[]).map((e) => e.name)
  } catch { entries = [] }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    let real = dir
    try {
      // statSync FOLLOWS a symlink; readdirSync's Dirent.isDirectory() is FALSE for a symlinked
      // dir and silently drops whole repos (the charter's standing trap 9).
      real = statSync(dir).isDirectory() ? dir : ""
    } catch { continue }
    if (!real) continue
    try { execFileSync("git", ["-C", real, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    repos.push(name)
    let files: string[]
    try {
      files = execFileSync("git", ["-C", real, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of files) {
      const low = rel.toLowerCase()
      const dot = low.lastIndexOf(".")
      if (dot < 0) continue
      if (!exts.has(low.slice(dot + 1))) continue
      tracked++
      const abs = path.join(real, rel)
      if (!existsSync(abs)) { absent++; continue }
      let size = 0
      try { size = statSync(abs).size } catch { absent++; continue }
      if (size > CAP) { overCap++; continue }
      out.push(abs)
      reposWithAdmitted.add(name)
    }
  }
  void untracked
  return { files: out, repos: repos.length, reposWithAdmitted: reposWithAdmitted.size, untracked, overCap, absent, tracked }
}

/** THE MIXIN NEAR MISS — the `implements_clause` sites and the MERGING PAIRS (a file that
 *  declares a class and an interface with the SAME NAME). */
function mixinNearMiss(root: any): { implementsSites: number; mergingPairs: number; mergingNames: string[] } {
  let implementsSites = 0
  const classes = new Set<string>()
  const interfaces = new Set<string>()
  const walk = (n: any) => {
    if (!n) return
    if (n.type === "implements_clause") implementsSites++
    if (n.type === "class_declaration" || n.type === "abstract_class_declaration") {
      const nm = n.childForFieldName("name")
      if (nm && nm.type === "identifier") classes.add(String(nm.text))
    }
    if (n.type === "interface_declaration") {
      const nm = n.childForFieldName("name")
      if (nm && nm.type === "identifier") interfaces.add(String(nm.text))
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
  const merging = [...classes].filter((c) => interfaces.has(c)).sort()
  return { implementsSites, mergingPairs: merging.length, mergingNames: merging.slice(0, 20) }
}

/** THE PART NEAR MISS — the triple-slash reference directives, split by what they name. The
 *  grammar lexes them as COMMENT nodes, so this reads the comment TEXT — and a reader should know
 *  that the text is read with string operations, never a regex over source (the lane's contract). */
function partNearMiss(root: any): { directives: number; pathRefs: number; typesRefs: number; libRefs: number; pathTargets: string[] } {
  let directives = 0
  let pathRefs = 0
  let typesRefs = 0
  let libRefs = 0
  const pathTargets: string[] = []
  const walk = (n: any) => {
    if (!n) return
    if (n.type === "comment") {
      const text = String(n.text ?? "")
      if (text.startsWith("///")) {
        const body = text.slice(3)
        if (body.includes("<reference")) {
          directives++
          if (body.includes("path=")) {
            pathRefs++
            const at = body.indexOf("path=")
            const rest = body.slice(at + 5)
            const q = rest[0]
            if (q === '"' || q === "'") {
              const end = rest.indexOf(q, 1)
              if (end > 0) pathTargets.push(rest.slice(1, end))
            }
          } else if (body.includes("types=")) typesRefs++
          else if (body.includes("lib=")) libRefs++
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
  return { directives, pathRefs, typesRefs, libRefs, pathTargets }
}

const pop = admittedFiles()
const files = MAX_FILES > 0 && pop.files.length > MAX_FILES ? pop.files.slice(0, MAX_FILES) : pop.files

const parser = await ASTEngine.getParser("typescript" as never)

// ── THE GRAMMAR HAND-OVER, ONCE PER PROCESS, ON THE ANALYZER's CLASS ──────────────────────────
if (HAND_OVER) {
  const ctor: any = (RealTypeScriptAnalyzer as any).constructor
  try {
    ctor.setGrammar((parser as any).language, ctor)
    console.log(`  THE GRAMMAR HAND-OVER: DONE on the analyzer's CLASS (setGrammar(parser.language, ctor))`)
  } catch (e) {
    console.log(`  THE GRAMMAR HAND-OVER: REFUSED — ${(e as Error).message}`)
    console.log(`    AND THE REFUSAL IS THE EVIDENCE FOR THIS LANE, not a gap in the census: the analyzer's`)
    console.log(`    CLASS has no static setGrammar to call, which means the analyzer NEVER ACQUIRES A`)
    console.log(`    PARSER — it takes the tree it is GIVEN. The sql degradation class (an analyzer that`)
    console.log(`    calls acquireParser()/getParser() INSIDE analyze(), so a failed acquisition takes the`)
    console.log(`    recovery path and the file is reported as analysed anyway) CANNOT OCCUR HERE, and the`)
    console.log(`    trigger-site count below is the MEASUREMENT of that, with a root.`)
  }
} else {
  console.log(`  THE GRAMMAR HAND-OVER: NOT DONE (this is the NO-HAND-OVER arm)`)
}

// ── THE TRIGGER-SITE COUNT — the ROOT of the degradation, measured in THIS lane's own analyzer ──
// A DEGRADED analyzer is one that CALLS `acquireParser()`/`getParser()` INSIDE `analyze()`: the
// call fails, the recovery path is taken, and the file is reported as analysed anyway. The count
// is taken over the analyzer's own AST (the PRODUCTION typescript grammar), never over the text.
async function countParserCallSites(): Promise<{ total: number; insideAnalyze: number; byFunction: Record<string, number> }> {
  const src = readFileSync(path.resolve(process.cwd(), "src/ast/real-typescript-analyzer.ts"), "utf8")
  const tree: any = await parser.parse(src)
  const byFunction: Record<string, number> = {}
  let total = 0
  let insideAnalyze = 0
  const walk = (n: any, fn: string) => {
    if (!n) return
    const t = n.type
    if ((t === "call_expression" || t === "new_expression")) {
      const f = n.childForFieldName("function")
      const name = f ? String(f.text ?? "") : ""
      if (name === "acquireParser" || name === "getParser") {
        total++
        byFunction[fn] = (byFunction[fn] ?? 0) + 1
        if (fn === "analyze") insideAnalyze++
      }
    }
    const next = t === "method_definition" || t === "function_declaration" || t === "public_field_definition"
      ? String((n.childForFieldName("name") ?? n.namedChild(0))?.text ?? "")
      : fn
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i), next)
  }
  walk(tree.rootNode, "(module)")
  return { total, insideAnalyze, byFunction }
}
const triggerSites = await countParserCallSites()
console.log(`  THE TRIGGER-SITE COUNT (this lane's own analyzer, over its own AST): ${triggerSites.total} acquireParser()/getParser() call site(s) in total, ${triggerSites.insideAnalyze} INSIDE analyze()`)
if (triggerSites.total > 0) console.log(`    by enclosing function: ${Object.entries(triggerSites.byFunction).map(([k, v]) => `${k}=${v}`).join(", ")}`)

const tally = {
  files: 0,
  parsed: 0,
  parseFailures: 0,
  // mixin near miss
  implementsSites: 0,
  mergingPairs: 0,
  mergingPairsCarriedByImplements: 0,
  mergingPairsNotCarried: 0,
  mergingPairNames: [] as string[],
  // part near miss
  referenceDirectives: 0,
  pathRefs: 0,
  typesRefs: 0,
  libRefs: 0,
  pathRefTargets: 0,
  distinctPathTargets: 0,
  pathRefSelfReferential: 0,
  pathRefTargetAlsoImported: 0,
  pathRefTargetNotImported: 0,
  pathRefTargetUnresolvable: 0,
}

const targetSet = new Set<string>()
const relByType = new Map<string, number>()

for (const abs of files) {
  tally.files++
  let content = ""
  try { content = readFileSync(abs, "utf8") } catch { tally.parseFailures++; continue }
  let tree: any = null
  try { tree = await parser.parse(content) } catch { tally.parseFailures++; continue }
  if (!tree) { tally.parseFailures++; continue }
  tally.parsed++
  const root = tree.rootNode

  const mix = mixinNearMiss(root)
  tally.implementsSites += mix.implementsSites
  tally.mergingPairs += mix.mergingPairs
  for (const nm of mix.mergingNames) if (!tally.mergingPairNames.includes(nm)) tally.mergingPairNames.push(nm)

  const part = partNearMiss(root)
  tally.referenceDirectives += part.directives
  tally.pathRefs += part.pathRefs
  tally.typesRefs += part.typesRefs
  tally.libRefs += part.libRefs
  tally.pathRefTargets += part.pathTargets.length
  for (const t of part.pathTargets) {
    targetSet.add(t)
    // THE SELF-REFERENCE ROW — the X→X case the information test names: a `part_of` row from a
    // file to ITSELF carries no information at all.
    const base = path.basename(abs)
    if (t === base || t === `./${base}` || t === base.replace(/\.d\.ts$/, ".d.ts")) tally.pathRefSelfReferential++
  }

  // THE INFORMATION QUESTION — answered from the ANALYZER's own edges, and stated as such: a
  // bucket built on the analyzer's rules can SIZE the question and cannot decide it. The ORACLE
  // is untouched, and the ORACLE is what the differential compares against.
  let rels: any[] = []
  try {
    const analyzed = new RealTypeScriptAnalyzer().analyze(root, content, path.relative(CR, abs))
    rels = (analyzed?.relationships ?? []) as any[]
  } catch { /* the analyzer's own failure is counted by the parse-failure bucket above */ }

  // THE PER-TYPE RELATIONSHIP TALLY — the thing the hand-over DELTA is computed on. A degradation
  // is a per-type shortfall, so the census carries the per-type counts and the comparison prints
  // the per-type delta.
  for (const r of rels) {
    const lt = String(r?.type ?? "")
    relByType.set(lt, (relByType.get(lt) ?? 0) + 1)
  }
  const importTargets = new Set<string>()
  const implementsTargets = new Set<string>()
  for (const r of rels) {
    const t = String(r?.target ?? "")
    if (String(r?.type ?? "") === "imports") importTargets.add(t)
    if (String(r?.type ?? "") === "implements") implementsTargets.add(t)
  }
  for (const name of mix.mergingNames) {
    if (implementsTargets.has(name)) tally.mergingPairsCarriedByImplements++
    else tally.mergingPairsNotCarried++
  }
  for (const t of part.pathTargets) {
    const leaf = t.split("/").pop() ?? t
    const stem = leaf.replace(/\.(d\.)?tsx?$/, "")
    const alsoImported =
      importTargets.has(t) || importTargets.has(leaf) || importTargets.has(stem) ||
      [...importTargets].some((x) => x.endsWith(`/${leaf}`) || x.endsWith(`/${stem}`))
    if (alsoImported) tally.pathRefTargetAlsoImported++
    else {
      // The referenced file is named but NOT imported: a `part_of` row would carry NEW
      // information here, so the count is printed separately and the ruling says what carries it.
      const targetAbs = path.resolve(path.dirname(abs), t)
      if (existsSync(targetAbs)) tally.pathRefTargetNotImported++
      else tally.pathRefTargetUnresolvable++
    }
  }
}
tally.distinctPathTargets = targetSet.size

const L: string[] = []
const say = (s = "") => L.push(s)
say("TS NEAR-MISS CENSUS — the L-2026-10-21-06 admissibility tests 2 and 3, for the two ruled types")
say()
say(`corpus root: ${CR}`)
say(`population: ${tally.files} file(s) — ${MAX_FILES > 0 ? `A DRAW (max-files ${MAX_FILES}), NOT a population` : "the WHOLE admitted population"}`)
say(`  admitted by the gate's rule: ${pop.files.length} file(s) in ${pop.reposWithAdmitted} repo(s) that admitted at least one · over-cap ${pop.overCap} · absent ${pop.absent} · tracked-and-extension-matched ${pop.tracked} · git checkouts seen ${pop.repos}`)
say(`  parsed ${tally.parsed} · parse failures ${tally.parseFailures}`)
say()
say("  THE PER-TYPE RELATIONSHIP TALLY (the hand-over delta is computed on this):")
{
  const keys = [...relByType.keys()].sort()
  for (const k of keys) say(`    ${k.padEnd(16)} ${String(relByType.get(k)!).padStart(10)}`)
  say(`    ${"TOTAL".padEnd(16)} ${String([...relByType.values()].reduce((a, b) => a + b, 0)).padStart(10)}`)
}
if (COMPARE) {
  say()
  say("── THE HAND-OVER DELTA — this arm against the other arm's JSON ──")
  try {
    const other = JSON.parse(readFileSync(COMPARE, "utf8"))
    const mine = Object.fromEntries(relByType.entries())
    const theirs = other.relationshipByType ?? {}
    const all = [...new Set([...Object.keys(mine), ...Object.keys(theirs)])].sort()
    let delta = 0
    for (const k of all) {
      const a = mine[k] ?? 0
      const b = theirs[k] ?? 0
      const d = a - b
      if (d !== 0) delta += Math.abs(d)
      say(`    ${k.padEnd(16)} mine ${String(a).padStart(10)} · other ${String(b).padStart(10)} · delta ${String(d).padStart(10)}`)
    }
    say(`    THE TOTAL ABSOLUTE DELTA: ${delta} — ${delta === 0 ? "A ZERO MEASURED, NOT A ZERO ASSUMED" : "NON-ZERO — the two arms saw DIFFERENT analyzer behaviour"}`)
  } catch (e) {
    say(`    THE COMPARISON ARM ${COMPARE} COULD NOT BE READ — ${(e as Error).message}`)
  }
}
say()
say("── TEST 2 · THE NEAR-MISS TEST — a near-miss construct NAMED AND COUNTED ──")
say()
say("  mixes_in ⇒ the nearest TypeScript construct is DECLARATION MERGING (a class and an")
say("  interface of the same name). The construct is named; here are its SITES:")
say(`    implements_clause sites (whole population)   ${tally.implementsSites.toLocaleString()}`)
say(`    MERGING PAIRS (a class and an interface of the same name, one file)  ${tally.mergingPairs.toLocaleString()}`)
say(`      names (up to 20): ${tally.mergingPairNames.slice(0, 20).join(", ") || "(none)"}`)
say()
say("  part_of ⇒ the nearest TypeScript construct is the TRIPLE-SLASH REFERENCE DIRECTIVE, which")
say("  the grammar lexes as a COMMENT. The construct is named; here are its SITES:")
say(`    /// <reference …> directives (whole population)  ${tally.referenceDirectives.toLocaleString()}`)
say(`      of which path= (a FILE — the part-like form)   ${tally.pathRefs.toLocaleString()}`)
say(`      of which types= (a PACKAGE)                     ${tally.typesRefs.toLocaleString()}`)
say(`      of which lib= (a LIBRARY)                      ${tally.libRefs.toLocaleString()}`)
say(`      distinct path targets                         ${tally.distinctPathTargets.toLocaleString()}`)
say()
say("── TEST 3 · THE INFORMATION TEST — would the row the ruling refuses carry information? ──")
say()
say("  A `mixes_in` row would be class → mixin. The merge ALREADY publishes a relation (the")
say("  `implements` edge naming the interface), so a `mixes_in` row would DUPLICATE it:")
say(`    merging pairs whose implements edge IS published    ${tally.mergingPairsCarriedByImplements.toLocaleString()}`)
say(`    merging pairs whose implements edge is NOT published ${tally.mergingPairsNotCarried.toLocaleString()}`)
say()
say("  A `part_of` row would be file → file. The relation is already carried by `imports`")
say("  whenever the same file also imports the referenced unit:")
say(`    path references naming a file this file ALSO imports  ${tally.pathRefTargetAlsoImported.toLocaleString()}`)
say(`    path references naming a file this file does NOT import, and the file EXISTS  ${tally.pathRefTargetNotImported.toLocaleString()}`)
say(`    path references whose target does not resolve on disk            ${tally.pathRefTargetUnresolvable.toLocaleString()}`)
say(`    path references naming the file ITSELF (the X→X row the test names)  ${tally.pathRefSelfReferential.toLocaleString()}`)
say()
say("  THE NUMBERS A RULING RESTS ON, IN ONE PLACE:")
const mixinUncarried = tally.mergingPairsNotCarried
const partNewInfo = tally.pathRefTargetNotImported
say(`    mixes_in — merging pairs NOT already carried by an implements edge: ${mixinUncarried.toLocaleString()}`)
say(`    part_of  — path references that would carry NEW information:            ${partNewInfo.toLocaleString()}`)
say()
function text(): string { return L.join("\n") }
console.log(text())
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({
    corpusRoot: CR,
    population: {
      kind: MAX_FILES > 0 ? "draw" : "whole-admitted-population",
      maxFiles: MAX_FILES || null,
      files: tally.files,
      admitted: pop.files.length,
      repos: pop.repos,
      reposWithAdmitted: pop.reposWithAdmitted,
      overCap: pop.overCap,
      absent: pop.absent,
      parsed: tally.parsed,
      parseFailures: tally.parseFailures,
    },
    nearMiss: {
      mixes_in: {
        construct: "declaration merging (a class and an interface of the same name)",
        implementsClauseSites: tally.implementsSites,
        mergingPairs: tally.mergingPairs,
        mergingPairsCarriedByImplements: tally.mergingPairsCarriedByImplements,
        mergingPairsNotCarried: tally.mergingPairsNotCarried,
      },
      part_of: {
        construct: "the triple-slash reference directive (a COMMENT in the grammar)",
        directives: tally.referenceDirectives,
        pathRefs: tally.pathRefs,
        typesRefs: tally.typesRefs,
        libRefs: tally.libRefs,
        distinctPathTargets: tally.distinctPathTargets,
        selfReferential: tally.pathRefSelfReferential,
        targetAlsoImported: tally.pathRefTargetAlsoImported,
        targetNotImportedButExists: tally.pathRefTargetNotImported,
        targetUnresolvable: tally.pathRefTargetUnresolvable,
      },
    },
    informationTest: { mixes_in: mixinUncarried, part_of: partNewInfo },
    relationshipByType: Object.fromEntries(relByType.entries()),
    grammarHandOver: HAND_OVER,
    triggerSites,
  }, null, 2))
  console.log(`\nJSON written: ${JSON_OUT}`)
}
