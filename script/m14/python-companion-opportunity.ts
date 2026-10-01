/**
 * PY-7 MEASUREMENT. The companion-index tier of the `overrides` contract is declared on
 * `AnalyzeContext`, read by fifteen lanes, and populated by nobody in production — so tier 2 is
 * dead and tier 3, the 0.5 `first-parent-guess`, absorbs 100% of external overrides. That is the
 * known state and it is not what this script decides.
 *
 * This script asks the only question that decides whether wiring the tier up is worth the blast
 * radius of touching the production indexer: OF THE GUESSES, HOW MANY NAME A REAL EDGE?
 *
 * For every 0.5-confidence override edge the analyzer emits, cross-reference the guessed base
 * against a CORPUS-WIDE, tree-derived map of class name -> member names. Three outcomes, and they
 * are not equally valuable:
 *
 *   RESOLVES     the base is declared in another file and really does declare the method. The
 *                guess is a TRUE edge that the companion tier would convert to confidence 1.0.
 *   CONTRADICTED the base is declared elsewhere and does NOT have the method. The guess is FALSE,
 *                and this is the more valuable half to know: it means the 0.5 tier is not merely
 *                unverified, it is wrong, and a consumer cannot discount it by reading the
 *                confidence value.
 *   UNREACHABLE  no file in the corpus declares the base. Still unknown — the base may be in a
 *                dependency — so the guess is defensible.
 *
 * The map is derived from the TREE, not from analyzer output, for the reason every oracle in this
 * repo shares: an index built by reading the analyzer it is meant to check inherits the analyzer's
 * mistakes and then confirms them.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"

const root = process.argv[2]
if (!root) {
  console.error("usage: python-companion-opportunity.ts <corpus-root>")
  process.exit(1)
}

const pyFiles: string[] = []
;(function walk(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith(".py")) pyFiles.push(p)
  }
})(root)

/** class name -> member names it declares anywhere in the corpus, plus where it was seen. */
const corpusMembers = new Map<string, Set<string>>()
const corpusSeenIn = new Map<string, Set<string>>()

function recordType(name: string, members: Set<string>, file: string): void {
  let m = corpusMembers.get(name)
  if (!m) {
    m = new Set()
    corpusMembers.set(name, m)
  }
  for (const v of members) m.add(v)
  let w = corpusSeenIn.get(name)
  if (!w) {
    w = new Set()
    corpusSeenIn.set(name, w)
  }
  w.add(file)
}

/** Collect a class's own member names from the tree. A class's DIRECT body statements only —
 *  a nested class's methods are the nested class's members, not this one's. */
function directMembers(classNode: any, depth: number): Set<string> {
  const out = new Set<string>()
  if (depth > 0) return out // nested class members are attributed by their own class pass
  const body = classNode.childForFieldName("body")
  if (!body) return out
  for (let i = 0; i < body.namedChildCount; i++) {
    const st = body.namedChild(i)
    if (!st) continue
    let target: any = st
    // `@property` / `@staticmethod` wrap the definition in `decorated_definition`.
    if (target.type === "decorated_definition") {
      const d = target.childForFieldName("definition")
      if (d) target = d
    }
    if (target.type === "function_definition") {
      const n = target.childForFieldName("name")
      if (n && n.text) out.add(n.text)
    } else if (target.type === "class_definition") {
      // a nested class is a MEMBER by name, not by its methods
      const n = target.childForFieldName("name")
      if (n && n.text) out.add(n.text)
    } else if (target.type === "expression_statement") {
      // `x = ...` at class level declares `x`; a tuple target declares several.
      const inner = target.namedChildren[0]
      if (inner && inner.type === "assignment") {
        const left = inner.childForFieldName("left")
        if (!left) continue
        const targets: any[] =
          left.type === "pattern_list" || left.type === "tuple"
            ? Array.from({ length: left.namedChildCount }, (_, k) => left.namedChild(k)).filter(Boolean)
            : [left]
        for (const t of targets) if (t && t.text) out.add(t.text)
      }
    }
  }
  return out
}

function indexClasses(rootNode: any, file: string): void {
  const stack: Array<{ n: any; depth: number }> = [{ n: rootNode, depth: 0 }]
  while (stack.length > 0) {
    const { n, depth } = stack.pop()!
    if (n.type === "class_definition") {
      const nm = n.childForFieldName("name")
      if (nm && nm.text) recordType(nm.text, directMembers(n, depth), file)
      const body = n.childForFieldName("body")
      if (body) {
        for (let i = 0; i < body.namedChildCount; i++) {
          const c = body.namedChild(i)
          if (c) stack.push({ n: c, depth: depth + 1 })
        }
      }
      continue
    }
    if (n.type === "function_definition") {
      // a function body cannot declare a class in python; skip its subtree
      continue
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push({ n: c, depth })
    }
  }
}

// ── PASS A: the corpus-wide index, from TREES ──────────────────────────────────────────────
// Two passes on purpose. `parseFile` deletes its tree, so an index and the analyzer's
// relationships cannot come from one call, and reading the index out of the analyzer's SYMBOLS
// would be the dependency this script exists to avoid: a class or method the analyzer fails to
// record would be absent from the map and every guess naming it would be scored UNREACHABLE
// instead of RESOLVES, which is a false NEGATIVE on exactly the quantity being measured.
let nIndexed = 0
let nDamaged = 0
for (const f of pyFiles) {
  const raw = fs.readFileSync(f, "utf8")
  const content = raw.length > 1024 * 1024 ? raw.substring(0, 1024 * 1024) : raw
  try {
    const t: any = await ASTEngine.parseTree(f, content)
    if (t?.language === "python") {
      indexClasses(t.tree.rootNode, f)
      nIndexed++
    }
    t?.tree?.delete?.()
  } catch {
    nDamaged++
  }
}
console.log(`pass A: indexed ${nIndexed} file(s), ${corpusMembers.size} type name(s), ${nDamaged} damaged`)

// ── PASS B: the analyzer's guesses ─────────────────────────────────────────────────────────
let n = 0
let nGuess = 0
/** Pass-B guesses, keyed so pass C can DIFF against them. */
const guessesInB = new Set<string>()
let resolves = 0
let contradicted = 0
let unreachable = 0
let damaged = 0
const samples: Record<string, string[]> = { RESOLVES: [], CONTRADICTED: [], UNREACHABLE: [] }

for (const f of pyFiles) {
  const raw = fs.readFileSync(f, "utf8")
  const content = raw.length > 1024 * 1024 ? raw.substring(0, 1024 * 1024) : raw
  let res: any
  try {
    res = await ASTEngine.parseFile(f, content)
  } catch {
    damaged++
    continue
  }
  if (res?.language !== "python") continue
  n++
  for (const r of res.relationships ?? []) {
    const t = String(r.type)
    if (!/override/i.test(t)) continue
    const conf = typeof r.confidence === "number" ? r.confidence : 1
    if (conf > 0.5) continue // not a guess
    nGuess++
    const src = String(r.source ?? "")
    const tgt = String(r.target ?? "")
    const dot = tgt.lastIndexOf(".")
    if (dot < 0) continue
    const base = tgt.slice(0, dot)
    const method = tgt.slice(dot + 1)
    const known = corpusMembers.get(base)
    if (!known) {
      unreachable++
      if (samples.UNREACHABLE.length < 6) samples.UNREACHABLE.push(`${base}.${method}`)
      continue
    }
    guessesInB.add(`${path.basename(f)}|${src}|${base}.${method}`)
    if (known.has(method)) {
      resolves++
      if (samples.RESOLVES.length < 6) samples.RESOLVES.push(`${base}.${method}  (${known.size} members)`)
    } else {
      contradicted++
      if (samples.CONTRADICTED.length < 6)
        samples.CONTRADICTED.push(`${base}.${method}  (base has ${known.size} members, none named ${method})`)
    }
  }
}

console.log(`pass B: analysed ${n} file(s), ${damaged} damaged`)
console.log(`override guesses at confidence <= 0.5: ${nGuess}`)
console.log(`\n  RESOLVES     (true edge a populated companion would verify): ${resolves}  (${((100 * resolves) / Math.max(1, nGuess)).toFixed(1)}%)`)
console.log(`  CONTRADICTED (base is in the corpus and lacks the method):  ${contradicted}  (${((100 * contradicted) / Math.max(1, nGuess)).toFixed(1)}%)`)
console.log(`  UNREACHABLE  (no file in the corpus declares the base):      ${unreachable}  (${((100 * unreachable) / Math.max(1, nGuess)).toFixed(1)}%)`)
for (const k of ["RESOLVES", "CONTRADICTED", "UNREACHABLE"] as const) {
  if (samples[k].length) console.log(`\n  ${k} samples:\n    ${samples[k].join("\n    ")}`)
}
// ── PASS C: the SAME run with the companion index SUPPLIED ───────────────────────────────────
// The point of the census. Everything above says what the 0.5 tier is worth when nothing knows
// the base; this says what it is worth once something does. Same corpus, same analyzer, same
// trees — the ONLY difference is that `overrideCompanion` is populated, which became possible
// from the moment the lane stopped reading a field nobody wrote (PY-7).
//
// The accounting here is a SET DIFFERENCE against pass B, and getting that wrong was the first
// version of this script: it scanned pass C's surviving edges looking for fabrications, which
// reported SUPPRESSED = 0 — not because nothing was suppressed, but because a SUPPRESSED EDGE DOES
// NOT EXIST, so counting it by looking for survivors cannot find it. An absence counted by
// presence is a measurement that can only ever report zero. What changed between the two runs is
// the difference between the two SETS.
const companion: Map<string, Set<string>> = new Map()
for (const [k, v] of corpusMembers) companion.set(k, new Set(v))

const edgesInC = new Set<string>()
let cVerified = 0
let cStillGuessed = 0
let cVerifiedButFalse = 0

for (const f of pyFiles) {
  const raw = fs.readFileSync(f, "utf8")
  const content = raw.length > 1024 * 1024 ? raw.substring(0, 1024 * 1024) : raw
  let res: any
  try {
    res = await ASTEngine.parseFile(f, content, { overrideCompanion: companion })
  } catch {
    continue
  }
  if (res?.language !== "python") continue
  for (const r of res.relationships ?? []) {
    const t = String(r.type)
    if (!/override/i.test(t)) continue
    const conf = typeof r.confidence === "number" ? r.confidence : 1
    const src = String(r.source ?? "")
    const tgt = String(r.target ?? "")
    const key = `${path.basename(f)}|${src}|${tgt}`
    edgesInC.add(key)
    const dot = tgt.lastIndexOf(".")
    if (dot < 0) continue
    const base = tgt.slice(0, dot)
    const method = tgt.slice(dot + 1)
    const known = corpusMembers.get(base)
    if (conf > 0.5) {
      cVerified++
      if (known && !known.has(method)) cVerifiedButFalse++
    } else {
      cStillGuessed++
    }
  }
}

let promoted = 0
let suppressed = 0
for (const k of guessesInB) {
  if (edgesInC.has(k)) promoted++
  else suppressed++
}

console.log(`\n── PASS C: the same corpus, with the companion index populated ──`)
console.log(`  pass-B guesses: ${guessesInB.size}`)
console.log(`  PROMOTED   (guess survived, now verified): ${promoted}`)
console.log(`  SUPPRESSED (guess is GONE — the index knew the base and it lacks the method): ${suppressed}`)
console.log(`  still guessed (base outside the corpus): ${cStillGuessed}`)
console.log(`  verified edges naming a base the corpus map says lacks the method: ${cVerifiedButFalse}`)

console.log(`\ncorpus types indexed: ${corpusMembers.size}`)