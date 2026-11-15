#!/usr/bin/env npx tsx
/**
 * SIZE — the xml twin class: are the 4,782 "wrong edges" actually wrong?
 *
 * ## What the gate says, and why the words matter
 *
 * `residual-gate.ts --lane xml` prints a `twin` column with the header *"ONLY another file answers
 * (a wrong edge)"*, and reads **references 4,137 · extends 645 = 4,782**. The classifier behind it
 * is `classifyIntent` (`incoming-gate.ts:433-445`):
 *
 *     decls = declarations of the target NAME in the project
 *     if none                      -> noDeclaration
 *     if none in the EDGE'S FILE   -> arbitraryTwin     <-- the twin column
 *
 * So `twin` means exactly "no declaration of this name in the edge's own file". For `contains` and
 * `exports` that is a defect by construction — those must name an identity their own file minted.
 * For `references` and `extends` it is what a CROSS-DOCUMENT reference IS: an XSD that extends a type
 * declared in a sibling schema, an XSLT that references a template defined in an imported
 * stylesheet. The gate's own docstring for the class is weaker than its column header: it says the
 * class is *"exactly when the store's `s.id` tie-break picks a foreign declaration"* — a RISK, not a
 * proven wrongness, and it says so for the sibling class in the same paragraph.
 *
 * ## What this measures
 *
 * For every edge the gate would call a twin, two independent questions, so the population is SIZED
 * before any change is proposed:
 *
 *   REFERENCED  does the edge's own file name the declaring file? (`xsi:schemaLocation`,
 *               `xsl:import`/`xsl:include`, a SYSTEM/PUBLIC id, `xi:include`, `href`, or simply the
 *               declaring file's basename appearing in the file's own text). If yes the cross-file
 *               binding is the CORRECT one and the twin column is counting a legitimate edge.
 *   CEILING     does the edge's own file declare a name whose LAST SEGMENT equals the target's last
 *               segment? That is the owner-qualification ceiling — the fraction a spelling change
 *               could reach — and it must be measured before assuming a fix reaches.
 *
 * Anything in neither class is counted separately and left unexplained.
 *
 * Run: npx tsx validation/m14/fixtures/xml/probe-twin-class.ts --files 600
 */

import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../../src/ast/engine"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const EXTS = [".xml", ".xsd", ".dtd", ".svg", ".xsl", ".xslt", ".rng"]
const argv = process.argv.slice(2)
const argOf = (f: string, d: string): string => {
  const i = argv.indexOf(f)
  return i >= 0 ? (argv[i + 1] ?? d) : d
}
const PER = Number(argOf("--files", "600"))   // 0 = the WHOLE admitted population

const found: string[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!EXTS.some((e) => rel.toLowerCase().endsWith(e))) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    found.push(abs)
  }
}
found.sort()
const stride = PER > 0 ? Math.max(1, Math.floor(found.length / PER)) : 1
const draw: string[] = []
for (let i = 0; i < found.length && (PER === 0 || draw.length < PER); i += stride) draw.push(found[i])

interface Rec { abs: string; rel: string }
const parsed: Rec[] = []
for (const abs of draw) parsed.push({ abs, rel: path.relative(CR, abs) })
// NO TEXT IS RETAINED. A whole-population run would otherwise hold all 11,552 documents in memory;
// both passes below re-read the file instead, which costs I/O and buys headroom.

// ── the project key space: name -> the files that declare it ────────────────────────────────
const declFiles = new Map<string, Set<string>>()
const perFileNames = new Map<string, Set<string>>()
for (const r of parsed) perFileNames.set(r.abs, new Set<string>())
for (const r of parsed) {
  let text: string
  try { text = readFileSync(r.abs, "utf8") } catch { continue }
  let res: any
  try { res = await ASTEngine.parseFile(r.abs, text) } catch { continue }
  const names = perFileNames.get(r.abs)!
  for (const s of res?.symbols ?? []) {
    for (const n of [s?.name, s?.qualifiedName, s?.metadata?.fqn]) {
      if (typeof n !== "string" || !n) continue
      names.add(n)
      let set = declFiles.get(n)
      if (!set) declFiles.set(n, (set = new Set()))
      set.add(r.abs)
    }
  }
}

let edges = 0
let twins = 0
let referenced = 0
let ceiling = 0
let neither = 0
const examples: { referenced: string[]; ceiling: string[]; neither: string[]; inDocument: string[] } = { referenced: [], ceiling: [], neither: [], inDocument: [] }
const twinByClass = new Map<string, number>()
/** Every twin NOT carrying the external claim — the residue this ruling's falsifier is about. */
const unclaimed: { rel: string; label: string; source: string; target: string; line: number; cls: string; md: string }[] = []
const perType: Record<string, { twins: number; referenced: number; ceiling: number; neither: number }> = {}

for (const r of parsed) {
  let text: string
  try { text = readFileSync(r.abs, "utf8") } catch { continue }
  let res: any
  try { res = await ASTEngine.parseFile(r.abs, text) } catch { continue }
  const own = perFileNames.get(r.abs) ?? new Set<string>()
  const ownLeafs = new Set<string>()
  for (const n of own) ownLeafs.add(n.includes(".") ? n.slice(n.lastIndexOf(".") + 1) : n)
  const textLower = text

  for (const e of res?.relationships ?? []) {
    const label = String(e?.type ?? "")
    if (label !== "references" && label !== "extends") continue
    edges++
    const tgt = String(e?.target ?? "")
    if (!tgt) continue
    const declaring = declFiles.get(tgt)
    if (!declaring || declaring.size === 0) continue      // noDeclaration, not a twin
    if (declaring.has(r.abs)) continue                    // own file answers -> not a twin
    twins++
    perType[label] ??= { twins: 0, referenced: 0, ceiling: 0, neither: 0 }
    perType[label].twins++

    // THE ANALYZER'S OWN CLASS, recorded per twin: `resolvable` is the lane's classification
    // (in-document | builtin | external | unresolved) and an external claim key means the edge is
    // already declared as naming something outside the project. A twin that is already claimed
    // external is not a defect the lane can fix — it is the GATE's twin column counting a
    // correctly-classified edge, because the column is a NAME test and does not read claims.
    const md: any = (e as any)?.metadata ?? {}
    const cls = String(md.resolvable ?? "(none)")
    const claimed = Object.keys(md).filter((k) => k !== "evidenceClass" && md[k] === true).sort().join("+") || "(no claim)"
    const key = `${cls} | claim=${claimed}`
    twinByClass.set(key, (twinByClass.get(key) ?? 0) + 1)
    if (claimed !== "isExternalTarget") {
      unclaimed.push({ rel: r.rel, label, source: String(e.source ?? ""), target: tgt, line: Number((e as any).line_number ?? 0), cls, md: JSON.stringify(md).slice(0, 220) })
    }
    if (md.resolvable === "in-document" && examples.inDocument.length < 6) {
      examples.inDocument.push(`${r.rel}: ${e.source} -${label}-> ${tgt}  resolvable=in-document claim=${claimed}`)
    }

    // REFERENCED: does the own file name any file that declares this target?
    let isReferenced = false
    for (const d of declaring) {
      const base = path.basename(d)
      if (textLower.includes(base)) { isReferenced = true; break }
      const stem = base.replace(/\.[^.]+$/, "")
      if (stem.length > 3 && textLower.includes(stem)) { isReferenced = true; break }
    }
    // CEILING: does the own file declare a name with the same LAST SEGMENT?
    const leaf = tgt.includes(".") ? tgt.slice(tgt.lastIndexOf(".") + 1) : tgt
    const inCeiling = ownLeafs.has(leaf)

    if (isReferenced) {
      referenced++; perType[label].referenced++
      if (examples.referenced.length < 6) examples.referenced.push(`${r.rel}: ${e.source} -${label}-> ${tgt}`)
    } else if (inCeiling) {
      ceiling++; perType[label].ceiling++
      if (examples.ceiling.length < 6) examples.ceiling.push(`${r.rel}: ${e.source} -${label}-> ${tgt}`)
    } else {
      neither++; perType[label].neither++
      if (examples.neither.length < 6) examples.neither.push(`${r.rel}: ${e.source} -${label}-> ${tgt}`)
    }
  }
}

console.log("=".repeat(90))
console.log("SIZE — the xml twin class: referenced cross-document, qualification ceiling, or neither")
console.log("=".repeat(90))
console.log(`population: ${found.length} files over ${EXTS.join("/")}; draw ${draw.length} by even stride ${stride}`)
console.log(`references+extends edges in draw: ${edges}`)
console.log(`TWINS (target declared only outside the edge's own file): ${twins}`)
console.log(`  REFERENCED  the own file names the declaring file  -> the cross-file binding is CORRECT: ${referenced} (${twins ? (100 * referenced / twins).toFixed(1) : "-"}%)`)
console.log(`  CEILING     own file declares the same LEAF        -> a spelling change could reach:      ${ceiling} (${twins ? (100 * ceiling / twins).toFixed(1) : "-"}%)`)
console.log(`  NEITHER     unexplained by this probe:                                                     ${neither} (${twins ? (100 * neither / twins).toFixed(1) : "-"}%)`)
console.log("")
console.log("per type:")
for (const [t, v] of Object.entries(perType)) {
  console.log(`  ${t}: twins ${v.twins}  referenced ${v.referenced}  ceiling ${v.ceiling}  neither ${v.neither}`)
}
console.log("")
// THE FALSIFIER COUNT, PRINTED AS A NUMBER EVEN WHEN IT IS ZERO. The by-class table below lists
// only classes that OCCUR, so a zero would otherwise be an argument from absence — and this count is
// the one the ruling's falsifier turns on, so it must be readable without inference.
let inDocumentTwins = 0
let claimedTwin = 0
for (const [k, v] of twinByClass) {
  if (k.startsWith("in-document")) inDocumentTwins += v
  if (k.includes("claim=isExternalTarget")) claimedTwin += v
}
console.log(`FALSIFIER COUNT — twins the analyzer calls in-document: ${inDocumentTwins}`)
console.log(`                  twins already carrying isExternalTarget: ${claimedTwin}`)
console.log("")
console.log(`THE UNCLAIMED TWINS, IN FULL (${unclaimed.length}) — the only residue this ruling leaves:`)
for (const u of unclaimed) console.log(`  ${u.rel}:${u.line}  ${u.source} -${u.label}-> ${u.target}   [${u.cls}]\n      md=${u.md}`)
console.log("")
console.log("TWINS BY THE ANALYZER'S OWN CLASS (resolvable | external claim keys):")
for (const [k, v] of [...twinByClass.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(6)}  ${k}`)
console.log("")
if (examples.inDocument.length) {
  console.log("twins the analyzer calls in-document (the ones that would be real defects):")
  for (const e of examples.inDocument) console.log(`  ${e}`)
  console.log("")
}
for (const k of ["referenced", "ceiling", "neither"] as const) {
  if (!examples[k].length) continue
  console.log(`${k.toUpperCase()} examples:`)
  for (const e of examples[k]) console.log(`  ${e}`)
}
process.exit(0)
