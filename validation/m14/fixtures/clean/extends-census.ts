// CLEAN `extends` CENSUS — capability probe + bounded corpus census.
//
// WHY TWO PARTS. `extends` is this lane's only silent type, and silence has two very different
// causes: the CONSTRUCT never occurs in the corpus, or the GRAMMAR cannot express it. A corpus
// count alone cannot tell them apart — and this corpus is thin (109 files in the best repo, below
// the programme's 120 target), so a zero from it is weak evidence. Part A therefore parses
// SYNTHETIC shapes and prints what the pinned grammar actually builds, which separates "the corpus
// does not contain it" from "the language does not have it" from "the grammar cannot read it".
// Part B counts the real corpus, bounded, and tallies the analyzer's own emitted types.
//
// USAGE
//   bun validation/m14/fixtures/clean/extends-census.ts shapes              capability probe only
//   bun validation/m14/fixtures/clean/extends-census.ts controls            capability controls; exit 3 on FAIL
//   bun validation/m14/fixtures/clean/extends-census.ts <corpusDir> [max]   corpus census
//
// THE CONTROLS ARE PART OF THE INSTRUMENT, not a courtesy. Every zero this census prints is a
// claim about the corpus, and a zero from a detector that cannot fire is a claim about nothing:
// `controls` parses synthetic shapes whose trees are printed beside each check and runs the SAME
// detector functions the corpus walk runs, so the census's `0 owned by class_declaration` and its
// `0 <= misparse sites` are distinguishable from a dead tally. Exit 3 means a control failed and
// no corpus number from this instrument may be quoted.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { getParser } from "../../../../src/ast/engine.ts"
import { RelationshipType } from "../../../../src/ast/types.ts"

const ALL = [...new Set(Object.values(RelationshipType))] as string[]
const args = process.argv.slice(2)

// ── PART A — the capability probe. Clean's class syntax admits a SUPERCLASS (`<=`) and a CONTEXT
// (`|`); each shape is parsed and dumped so the node type and FIELD carrying it is read off the
// grammar rather than assumed.
const SHAPES: [string, string][] = [
  ["plain class", "class Eq a where (==) infix 2 :: a a -> Bool\n"],
  ["superclass <=", "class Ord a <= Eq a where (<) infix 4 :: a a -> Bool\n"],
  ["superclass chain", "class Ord a <= Eq a where (<) infix 4 :: a a -> Bool\n"],
  ["context |", "class Ord a | Eq a where (<) infix 4 :: a a -> Bool\n"],
  ["instance plain", "instance Eq Int where (==) x y = True\n"],
  ["instance with context", "instance Ord Int | Eq Int where (<) x y = True\n"],
  ["instance of instance", "instance Ord [a] | Ord a where (<) x y = True\n"],
  ["derive", "derive class Eq Int\n"],
  ["class without where", "class Eq a\n"],
]

// ── THE SHARED DETECTORS. Both the capability controls and the corpus walk call THESE
// functions, never a copy: a control that exercises a re-implementation tests the
// re-implementation, and the number it certifies is then not the number the census prints.
// (Same reason `script/m14/clean-ruled.ts` exports its own walk to the evidence generator.)

/** Depth-bounded dump, used only by the `shapes` path. */
function dumpTree(n: any, d = 0, errs: any[] = []): void {
  if (n.type === "ERROR" || n.isMissing) errs.push(n)
  if (d <= 4) console.log("  ".repeat(d + 1) + n.type + (n.isNamed ? "" : " [anon]") + (n.isMissing ? " [MISSING]" : ""))
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) dumpTree(c, d + 1, errs) }
}

/** Every node, pre-order, iterative (a deep Clean file can exceed the JS recursion budget). */
function walkNodes(root: any, visit: (n: any) => void): void {
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    visit(n)
    const kids = n.children ?? []
    for (let i = kids.length - 1; i >= 0; i--) if (kids[i]) stack.push(kids[i])
  }
}

/**
 * THE `<=` MISPARSE DETECTOR. `class Ord a <= Eq a where …` parses with ZERO errors as a
 * `class_declaration` TERMINATED at `class Ord a`, followed by a separate top-level
 * `operator_definition` for `<= Eq a` — so a superclass written that way is silently LOST, not
 * damaged. What the tree actually contains, measured on the synthetic shape rather than assumed:
 * the operator_definition's children are `operator` covering `<` [12,13], an ANONYMOUS `=` token
 * [13,14], an application and a where_block. `<=` is TWO TOKENS with no gap between them.
 *
 * THAT IS THE BUG THIS REVISION FIXES, and it is recorded because of the shape of error: the first
 * revision compared the `operator` child's text to `"<="`. That child is `<`, so the test could
 * never pass, and the census printed `<= SUPERCLASS MISPARSE 0 in 0 file(s)` — a corpus zero that
 * was a property of the detector and not of the corpus. It was caught by a control (`controls` C4)
 * that asks the detector to fire on the shape it exists for; before that control, the zero was
 * indistinguishable from a measurement.
 *
 * The detector matches the exact token shape: adjacent `<` + `=`, immediately after a
 * `class_declaration`. A genuine `<=` definition is parenthesised (`(<=) x y = True`) and does not
 * match (control C6); the same `<`+`=` head after an INSTANCE does not match (control C5).
 */
function countSuperclassMisparse(root: any, content: string): number {
  let n = 0
  walkNodes(root, (node) => {
    if (node.type !== "operator_definition") return
    const kids = node.children ?? []
    const op = kids.find((c: any) => c.type === "operator")
    const eq = kids.find((c: any) => c.type === "=")
    if (!op || !eq) return
    if (op.endIndex !== eq.startIndex) return
    if (content.slice(op.startIndex, eq.endIndex) !== "<=") return
    let prev: any = null
    for (const c of node.parent?.children ?? []) { if (c && c.startIndex >= node.startIndex) break; prev = c }
    if (prev && prev.type === "class_declaration") n++
  })
  return n
}

/** Which node OWNS each `class_context` — the split that decides whether a `|` is a superclass. */
function classContextParentTally(root: any): Map<string, number> {
  const m = new Map<string, number>()
  walkNodes(root, (n) => {
    if (n.type !== "class_context") return
    const pt = n.parent?.type ?? "(no parent)"
    m.set(pt, (m.get(pt) || 0) + 1)
  })
  return m
}
const tallyStr = (m: Map<string, number>): string =>
  m.size ? [...m].map(([k, v]) => `${k}:${v}`).join("  ") : "(none)"

/** ERROR / MISSING counts for one parse, so a control states the parse it ruled on. */
function parseHealth(root: any): { errors: number; missing: number } {
  let errors = 0, missing = 0
  walkNodes(root, (n) => { if (n.type === "ERROR") errors++; if (n.isMissing) missing++ })
  return { errors, missing }
}

if (args[0] === "shapes") {
  const parser = await getParser("clean")
  for (const [label, src] of SHAPES) {
    const pr = await parser.parse(src, "probe.icl")
    const errs: any[] = []
    console.log(`\n=== ${label}: ${JSON.stringify(src.trim())}`)
    dumpTree(pr.rootNode, 0, errs)
    console.log(`  ERROR nodes: ${errs.filter((n) => n.type === "ERROR").length}, MISSING: ${errs.filter((n) => n.isMissing).length}`)
  }
  process.exit(0)
}

// ── THE CAPABILITY CONTROLS. Rule: a detector whose 0 is quoted must be shown able to produce a
// non-zero, and a discriminator whose split is quoted must be shown able to move. Each check runs
// the SAME detector the corpus walk runs, on a synthetic shape whose answer is known from a parse
// printed beside it. Exit 3 on any FAIL, so a failing control cannot be read as a result.
if (args[0] === "controls") {
  const parser = await getParser("clean")
  const checks: Array<{ name: string; pass: boolean; detail: string }> = []
  const parse = async (src: string, f: string) => (await parser.parse(src, f)).rootNode

  // C1 — can the parent split SEE the superclass position? Without this, "0 owned by
  // class_declaration" is indistinguishable from a tally that can never return that key.
  const ctxSrc = "class Ord a | Eq a where (<) infix 4 :: a a -> Bool\n"
  const ctxRoot = await parse(ctxSrc, "control-class-context.icl")
  const ctxTally = classContextParentTally(ctxRoot)
  const ctxH = parseHealth(ctxRoot)
  checks.push({
    name: "C1 the `|` context on a CLASS is tallied to class_declaration (the superclass position)",
    pass: (ctxTally.get("class_declaration") || 0) === 1,
    detail: `tally {${tallyStr(ctxTally)}}  ERROR ${ctxH.errors} MISSING ${ctxH.missing}`,
  })

  // C2/C3 — and can it tell that apart from the two USE positions the corpus does contain?
  // A discriminator that returns `class_declaration` for every context would make the corpus 0
  // impossible; one that returns it for none would make the 0 vacuous. Both sides are exercised.
  const sigSrc = "f :: a -> a | Eq a\nf x = x\n"
  const sigRoot = await parse(sigSrc, "control-signature-context.icl")
  const sigTally = classContextParentTally(sigRoot)
  const sigH = parseHealth(sigRoot)
  checks.push({
    name: "C2 a `|` context on a SIGNATURE is tallied to type_signature, NOT to class_declaration",
    pass: (sigTally.get("type_signature") || 0) === 1 && (sigTally.get("class_declaration") || 0) === 0,
    detail: `tally {${tallyStr(sigTally)}}  ERROR ${sigH.errors} MISSING ${sigH.missing}`,
  })

  const instSrc = "instance Ord Int | Eq Int where (<) x y = True\n"
  const instRoot = await parse(instSrc, "control-instance-context.icl")
  const instTally = classContextParentTally(instRoot)
  const instH = parseHealth(instRoot)
  checks.push({
    name: "C3 a `|` context on an INSTANCE is tallied to instance_declaration, NOT to class_declaration",
    pass: (instTally.get("instance_declaration") || 0) === 1 && (instTally.get("class_declaration") || 0) === 0,
    detail: `tally {${tallyStr(instTally)}}  ERROR ${instH.errors} MISSING ${instH.missing}`,
  })

  // C4 — and can the `<=` detector fire at all? This is the one that certifies the corpus `0`, and
  // it is the control that FAILED against the first revision of this instrument: the detector was
  // comparing the `operator` child's text to `"<="` when the child is `<` followed by an anonymous
  // `=`, so it returned 0 on the very shape it was written for. A zero from a detector that cannot
  // fire is not a corpus measurement. C4 is therefore the guard on this whole file's `<=` row.
  const misSrc = "class Ord a <= Eq a where (<) infix 4 :: a a -> Bool\n"
  const misRoot = await parse(misSrc, "control-superclass.icl")
  const misN = countSuperclassMisparse(misRoot, misSrc)
  const misH = parseHealth(misRoot)
  checks.push({
    name: "C4 a `<=` in the superclass position IS counted as a lost superclass",
    pass: misN >= 1,
    detail: `count ${misN}  ERROR ${misH.errors} MISSING ${misH.missing}  (silent: no ERROR to count)`,
  })

  // C5 — the OTHER half of that detector: the predecessor test must be able to fail. The identical
  // `<`+`=` head after an INSTANCE is not a lost superclass, and the file parses at 0 ERROR.
  const predSrc = "instance Eq Int where (==) x y = True\n<= Eq a where (<) infix 4 :: a a -> Bool\n"
  const predRoot = await parse(predSrc, "control-instance-predecessor.icl")
  const predN = countSuperclassMisparse(predRoot, predSrc)
  const predH = parseHealth(predRoot)
  checks.push({
    name: "C5 the SAME `<`+`=` head after an instance is NOT counted (the predecessor test is live)",
    pass: predN === 0,
    detail: `count ${predN}  ERROR ${predH.errors} MISSING ${predH.missing}`,
  })

  // C6 — and the detector matches the MISPARSE TOKEN SHAPE, not the `<=` text anywhere: a genuine,
  // parenthesised definition of `<=` directly after a class declaration is not counted.
  const parenSrc = "class Eq a where (==) infix 2 :: a a -> Bool\n(<=) x y = True\n"
  const parenRoot = await parse(parenSrc, "control-parenthesised.icl")
  const parenN = countSuperclassMisparse(parenRoot, parenSrc)
  const parenH = parseHealth(parenRoot)
  checks.push({
    name: "C6 a parenthesised `<=` definition after a class is NOT counted (the token-shape test is live)",
    pass: parenN === 0,
    detail: `count ${parenN}  ERROR ${parenH.errors} MISSING ${parenH.missing}`,
  })

  console.log("CLEAN extends CENSUS — capability controls (each runs the detector the corpus walk runs)")
  for (const c of checks) console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.name}\n        ${c.detail}`)
  const failed = checks.filter((c) => !c.pass).length
  console.log(`\ncontrols: ${checks.length - failed}/${checks.length} pass, ${failed} FAIL`)
  if (failed) {
    console.log("A FAILED CONTROL IS NOT A RESULT. The corpus numbers this instrument prints are")
    console.log("uninterpretable until every control passes; exiting 3.")
    process.exit(3)
  }
  process.exit(0)
}

// ── PART B — bounded corpus census.
const ROOT = args[0] || "/home/ishaq2321/bb_tests/repositories/Clyde"
const MAX = args[1] ? Number(args[1]) : 0

function walkDir(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 20) return out
  let ents: any[]
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) walkDir(p, out, depth + 1) }
    else if (e.name.endsWith(".icl") || e.name.endsWith(".dcl")) { try { if (statSync(p).size <= 1_000_000) out.push(p) } catch {} }
  }
  return out
}

const m: any = await import("../../../../src/ast/real-clean-analyzer.ts")
const Cls = Object.values(m).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name)) as any

let files = walkDir(ROOT)
if (MAX > 0) files = files.slice(0, MAX)

const perType: Record<string, { edges: number; files: Set<string> }> = {}
for (const t of ALL) perType[t] = { edges: 0, files: new Set() }
// the declaration forms `extends` could come from, counted from the tree
// `Object.create(null)`, NOT `{}`. A node type named `constructor` — which this grammar has, it is
// the name/tag/type leaf — reads back from a plain object literal as `Object.prototype.constructor`,
// a FUNCTION, so an `=== undefined` membership test says "known" and the counter becomes NaN and
// the file-set `.add` throws. Measured: that bug reported 103 of 109 files as analyze FAILURES
// while the edge tallies were correct, which is the shape of instrument error that reads as an
// analyzer defect. A null-prototype map has no inherited keys at all.
const declSites: Record<string, number> = Object.create(null)
const declFiles: Record<string, Set<string>> = Object.create(null)
for (const k of ["class_declaration", "instance_declaration", "derive_declaration", "class_context", "class_member", "instance_member"]) {
  declSites[k] = 0; declFiles[k] = new Set()
}
const classShapes = new Map<string, number>()
// THE `<=` MISPARSE SIGNATURE, which neither the word list nor the node-type list can see.
// `class Ord a <= Eq a where …` parses with ZERO errors as a `class_declaration` TERMINATED at
// `class Ord a`, followed by a separate top-level `operator_definition` for `<= Eq a`. So a
// superclass written with Clean's `<=` is silently LOST — not damaged, re-read as something else.
// Counted here so the corpus can be asked whether any file writes it.
let superclassMisparseSites = 0
const superclassMisparseFiles = new Set<string>()
// and the `|` context, which the analyzer DOES read (CL-G3) and routes to `references`
let classContextSites = 0
// THE DECISIVE MEASUREMENT for `extends`: which node OWNS each `class_context`.
// A `|` context on a CLASS declaration states a superclass constraint (interface extension). The
// same node type on an INSTANCE or a SIGNATURE states what the instance/signature REQUIRES — a
// use, not an inheritance. Counting the parent types separates the two, and the previous lane
// routed every one of them to `references` (CL-G3) without that split.
const classContextParents = new Map<string, number>()
const nodeTypes = new Map<string, number>()
let parsed = 0
const errors: string[] = []

for (const f of files) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { continue }
  try {
    const parser = await getParser("clean")
    const pr = await parser.parse(content, f)
    const res = new Cls().analyze(pr.rootNode, content, f)
    parsed++
    for (const r of res.relationships || []) {
      const t = String((r as any).type ?? (r as any).relationshipType)
      if (!perType[t]) continue
      perType[t].edges++
      perType[t].files.add(f)
    }
    // the two load-bearing detectors, called from the SAME functions the `controls` path runs
    const lostSuperclass = countSuperclassMisparse(pr.rootNode, content)
    if (lostSuperclass > 0) { superclassMisparseSites += lostSuperclass; superclassMisparseFiles.add(f) }
    for (const [pt, n] of classContextParentTally(pr.rootNode)) {
      classContextParents.set(pt, (classContextParents.get(pt) || 0) + n)
      classContextSites += n
    }
    walkNodes(pr.rootNode, (n: any) => {
      nodeTypes.set(n.type, (nodeTypes.get(n.type) || 0) + 1)
      if (declSites[n.type] !== undefined) { declSites[n.type]++; declFiles[n.type].add(f) }
      if (n.type === "class_declaration") {
        // what does a class declaration actually carry? a `<=` superclass, a `|` context, or neither
        const kids = (n.children ?? []).map((c: any) => c.type)
        const hasSuper = kids.some((k: string) => k === "<=" || k === "keyword_superclass" || k.includes("super"))
        const hasCtx = kids.some((k: string) => k === "|" || k === "class_context")
        const hasWhere = kids.some((k: string) => k === "class_body" || k === "where_block" || k === "class_member")
        classShapes.set(`${hasSuper ? "superclass" : "no-superclass"} / ${hasCtx ? "context" : "no-context"} / ${hasWhere ? "body" : "no-body"}`,
          (classShapes.get(`${hasSuper ? "superclass" : "no-superclass"} / ${hasCtx ? "context" : "no-context"} / ${hasWhere ? "body" : "no-body"}`) || 0) + 1)
      }
    })
  } catch (e) { errors.push(`${relative(ROOT, f)}: ${String(e).slice(0, 60)}`) }
}

const pad = (s: any, n: number) => String(s).padEnd(n)
const pl = (s: any, n: number) => String(s).padStart(n)
console.log(`CLEAN extends CENSUS`)
console.log(`corpus: ${ROOT}   files: ${files.length}   parsed: ${parsed}   failures: ${errors.length}`)
console.log(`\nDECLARATION FORMS extends could come from (sites / files):`)
for (const [k, v] of Object.entries(declSites)) console.log(`  ${pad(k, 24)}${pl(v, 7)} / ${declFiles[k].size}`)
console.log(`\nclass_declaration SHAPES (superclass / context / body):`)
if (!classShapes.size) console.log("  (none)")
for (const [k, v] of [...classShapes].sort((a, b) => b[1] - a[1])) console.log(`  ${pad(k, 46)}${pl(v, 6)}`)
console.log(`\nCLASS-CONTEXT vs SUPERCLASS:`)
console.log(`  class_context (the \`|\` form, analyzer reads it -> \`references\`)   ${pl(classContextSites, 7)}`)
console.log(`    by the node that OWNS it — the split that decides whether it is a superclass:`)
if (!classContextParents.size) console.log(`      (none)`)
for (const [k, v] of [...classContextParents].sort((a, b) => b[1] - a[1])) {
  const kind = k === "class_declaration" ? "  <-- SUPERCLASS position" : k === "instance_declaration" ? "  (instance requirement)" : k === "type_signature" || k === "type_definition" ? "  (signature constraint)" : ""
  console.log(`      ${pad(k, 26)}${pl(v, 6)}${kind}`)
}
console.log(`  \`<=\` SUPERCLASS MISPARSE (class_declaration then operator_definition)  ${pl(superclassMisparseSites, 7)} in ${superclassMisparseFiles.size} file(s)`)
if (superclassMisparseSites === 0) {
  console.log(`    -> this corpus writes NO \`<=\` superclass; the capability probe shows the`)
  console.log(`       grammar would LOSE one if it did (see:\`bun ... extends-census.ts shapes\`)`)
}
console.log(`\nANALYZER EDGES (all 10 types):`)
let tot = 0
for (const t of ALL) { tot += perType[t].edges }
for (const t of ALL) console.log(`  ${pad(t, 14)}${pl(perType[t].edges, 8)} edges / ${pl(perType[t].files.size, 5)} files${perType[t].edges === 0 ? "   <-- SILENT" : ""}`)
console.log(`  ${pad("TOTAL", 14)}${pl(tot, 8)}`)
for (const probe of ["super", "<=", "inherit", "extend"]) {
  const hits = [...nodeTypes].filter(([t]) => t.includes(probe))
  console.log(`\nnode types containing '${probe}': ${hits.length ? hits.map(([t, n]) => `${t}:${n}`).join("  ") : "NONE"}`)
}
if (errors.length) { console.log(`\nfirst failures:`); for (const e of errors.slice(0, 5)) console.log("  " + e) }
