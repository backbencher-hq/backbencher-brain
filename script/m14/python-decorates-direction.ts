/**
 * PYTHON — THE `decorates` DIRECTION, MEASURED BOTH WAYS.
 *
 * **THE DEFECT THIS INSTRUMENT MEASURES.** `src/ast/types.ts`'s `Decorates` member (the
 * vocabulary, the authority) says, verbatim:
 *
 *   "A decorator is APPLIED TO a declaration: source = the decorating symbol, target = the
 *    decorated declaration."
 *
 * **⇒ SOURCE = THE DECORATING SYMBOL, TARGET = THE DECORATED DECLARATION.** That is the
 * actor → object shape, and it is the shape of the other three extended values
 * (`Renders`: "source = the rendering symbol, target = the rendered component";
 * `MixesIn`: "source = the class, target = the mixin"; `PartOf`: "source = the including
 * library/file symbol, target = the part's file or its module symbol").
 *
 * **⇒ BUT ALL THREE EMITTERS PUBLISH THE REVERSE:**
 *   · `src/ast/real-python-analyzer.ts:6112` — `pushRel(ctx, nameNode.text, target.target,
 *     Decorates, …)` where `nameNode.text` is the DECORATED declaration and `target.target` is the
 *     DECORATOR's name
 *   · `src/ast/real-javascript-analyzer.ts:2955` — `source: symbol.name, target: decorator`
 *   · `src/ast/real-typescript-analyzer.ts:7403` — `source: symbol.name, target: decorator`
 *
 * **⇒ AND THE ARBITER IS THE TELL.** `script/m14/incoming-rule.ts`'s `classifyEdge` resolves
 * the edge's **TARGET** against the declaration space — the endpoint that must be FOUND. For
 * `decorates` the endpoint that must be found is THE DECORATED DECLARATION, which is a symbol
 * in the file. Published the other way round, the arbiter is asked to find the DECORATOR's name
 * — an imported, usually undeclared-in-file name — and the row is scored as unresolved.
 *
 * **⇒ SO THIS INSTRUMENT MEASURES THE COST, ON THE WHOLE ADMITTED POPULATION, WITH THE SAME
 * ARBITER, IN BOTH DIRECTIONS:**
 *   · as published:  target = the decorator's name
 *   · as the vocabulary says: target = the decorated declaration
 * and prints the movement per class. **A number without a root is prose; a number with a root
 * is a price, and this is the price of the swap.**
 *
 * **⇒ AND THE ARBITER'S OWN TIE-BREAK FACT IS USED THE SAME WAY IN BOTH DIRECTIONS**, so the
 * two columns differ ONLY in the endpoint that is resolved.
 *
 * USAGE:
 *   BB_CORPUS_ROOT="$PWD/.corpus" bun run script/m14/python-decorates-direction.ts \
 *     --out validation/m14/measurements/python-decorates-direction-2026-10-21.json
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"
import { RealPythonAnalyzer } from "../../src/ast/real-python-analyzer"
import { classifyEdge } from "./incoming-rule"

const CR = process.env.BB_CORPUS_ROOT || path.resolve(process.cwd(), ".corpus")
const EXTS = [".py", ".pyi", ".pyw"]
const SIZE_CAP = 1024 * 1024

const argv = process.argv.slice(2)
const outIdx = argv.indexOf("--out")
const OUT = outIdx >= 0 ? argv[outIdx + 1] : null
const REPO_ONLY = argv.includes("--repo") ? argv[argv.indexOf("--repo") + 1] : null

const gitHead = (): string => {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { return "unavailable" }
}
const blobOf = (rel: string): string => {
  try { return execFileSync("git", ["hash-object", rel], { encoding: "utf8" }).trim() } catch { return "unavailable" }
}

/** THE ADMITTED POPULATION — the gate's own rule, mirrored. */
interface Pop { files: string[]; repos: number; absent: number; overCap: number }
function admitted(): Pop {
  const files: string[] = []
  const repos = new Set<string>()
  let absent = 0, overCap = 0
  let entries: string[] = []
  try { entries = readdirSync(CR) } catch { entries = [] }
  for (const e of entries) {
    const d = path.join(CR, e)
    try {
      if (!statSync(d).isDirectory()) continue
      execFileSync("git", ["-C", d, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    let tracked: string[] = []
    try { tracked = execFileSync("git", ["-C", d, "ls-files"], { encoding: "utf8" }).split("\n") } catch { continue }
    for (const rel of tracked) {
      if (!EXTS.includes(path.extname(rel))) continue
      const abs = path.join(d, rel)
      try {
        if (statSync(abs).size > SIZE_CAP) { overCap++; continue }
      } catch { absent++; continue }
      files.push(abs)
      repos.add(e)
    }
  }
  files.sort()
  return { files, repos: repos.size, absent, overCap }
}

const pop = admitted()
const parser: any = await getParser("python")
const analyzer: any = new RealPythonAnalyzer()

/** the per-file declaration and kind spaces, exactly as the arbiter wants them */
interface FileFacts { decls: Map<string, number>; kinds: Map<string, Set<string>> }

function factsFor(tree: any, content: string, file: string): FileFacts {
  const decls = new Map<string, number>()
  const kinds = new Map<string, Set<string>>()
  try {
    const r = analyzer.analyze(tree.rootNode, content, file)
    for (const s of (r?.symbols ?? [])) {
      const n = String(s?.name ?? "")
      if (!n) continue
      decls.set(n, (decls.get(n) ?? 0) + 1)
      const k = String(s?.kind ?? "")
      let set = kinds.get(n)
      if (!set) kinds.set(n, (set = new Set<string>()))
      set.add(k)
    }
  } catch { /* a file the analyzer cannot read contributes no declaration */ }
  return { decls, kinds }
}

type Class = "resolved" | "amb" | "unresolved" | "extOK" | "ext?" | "bind" | "other"
function classify(target: string, decls: Map<string, number>, kinds: Map<string, Set<string>>, claim: any, isContains: boolean): Class {
  const o = classifyEdge(decls, kinds, target, claim, { packages: new Set<string>(), files: new Set<string>(), sdkLib: false } as any, isContains, undefined, undefined, undefined)
  switch (o.outcome) {
    case "resolved": return "resolved"
    case "ambDeclOnly": case "ambBoth": return "amb"
    case "unresolved": return "unresolved"
    case "externalVerified": return "extOK"
    case "externalUnverified": return "ext?"
    case "bindingVerified": case "bindingUnverified": case "bindingRefuted": return "bind"
    case "externalRefuted": return "other"
    default: return "other"
  }
}

const CLASSES: Class[] = ["resolved", "amb", "unresolved", "extOK", "ext?", "bind", "other"]
const asPublished = new Map<Class, number>()
const asVocabulary = new Map<Class, number>()
for (const c of CLASSES) { asPublished.set(c, 0); asVocabulary.set(c, 0) }
let rows = 0, moved = 0, noDecorator = 0
const movedExamples: string[] = []
const perLabel = new Map<string, { published: number; vocabulary: number; moved: number }>()

for (const file of pop.files) {
  if (REPO_ONLY && !file.includes(REPO_ONLY)) continue
  let content = ""
  try { content = readFileSync(file, "utf8") } catch { continue }
  let tree: any = null
  try { tree = (parser as any).parse(content) } catch { continue }
  if (!tree) continue
  const f = factsFor(tree, content, file)
  let rels: any[] = []
  try {
    const r = analyzer.analyze(tree.rootNode, content, file)
    rels = Array.isArray(r?.relationships) ? r.relationships : []
  } catch { continue }
  try { (tree as any)?.delete?.() } catch { /* a tree that cannot be freed is not an error here */ }
  for (const rel of rels) {
    if (String(rel?.type ?? "") !== "decorates") continue
    rows++
    // THE RELATIONSHIP SHAPE: the engine's UniversalRelationship names the SOURCE ENDPOINT
    // `source` (the gate reads `rel.source`), so `rel.from` is undefined and every row was
    // being skipped — which is why the first run classified ZERO rows and reported a movement
    // of 0 with no error anywhere. ⇒ THE ZERO WAS AN INSTRUMENT DEFECT, NOT A FINDING.
    const from = String(rel?.source ?? rel?.from ?? "")
    const target = String(rel?.target ?? "")
    if (!from || !target) { noDecorator++; continue }
    const md = rel?.metadata ?? {}
    const claim = md?.externalClaim ?? null
    const isContains = false
    // AS PUBLISHED: the target is the decorator's name.
    const cPub = classify(target, f.decls, f.kinds, claim, isContains)
    // AS THE VOCABULARY SAYS: the target is the decorated declaration — the edge's `from` today.
    const cVoc = classify(from, f.decls, f.kinds, claim, isContains)
    asPublished.set(cPub, (asPublished.get(cPub) ?? 0) + 1)
    asVocabulary.set(cVoc, (asVocabulary.get(cVoc) ?? 0) + 1)
    const key = `${from} -> ${target}`
    let pl = perLabel.get(key)
    if (!pl) perLabel.set(key, (pl = { published: 0, vocabulary: 0, moved: 0 }))
    pl.published++; pl.vocabulary++
    if (cPub !== cVoc) {
      moved++
      pl.moved++
      if (movedExamples.length < 8) movedExamples.push(`${key} : ${cPub} -> ${cVoc}`)
    }
  }
}

console.log(`\nPY — THE \`decorates\` DIRECTION, MEASURED BOTH WAYS (the same arbiter, the same rows)`)
console.log(`population: ${pop.files.length} admitted .py/.pyi/.pyw across ${pop.repos} repos · root ${CR}`)
console.log(`digests (MEASURED at run time): analyzer ${blobOf("src/ast/real-python-analyzer.ts")} · arbiter ${blobOf("script/m14/incoming-rule.ts")} · instrument ${blobOf("script/m14/python-decorates-direction.ts")} · HEAD ${gitHead()}`)
console.log(`\nTHE AUTHORITY: src/ast/types.ts's \`Decorates\` member — "source = the decorating symbol,`)
console.log(`target = the decorated declaration."  THE EMITTERS (all three) publish the REVERSE.`)
console.log(`\n  class          as published   as the vocabulary says    movement`)
const movement: Record<string, number> = {}
for (const c of CLASSES) {
  const p = asPublished.get(c) ?? 0
  const v = asVocabulary.get(c) ?? 0
  movement[c] = v - p
  console.log(`  ${c.padEnd(13)} ${String(p).padStart(12)} ${String(v).padStart(20)} ${String(v - p).padStart(12)}`)
}
console.log(`  ${"rows".padEnd(13)} ${String(rows).padStart(12)} ${String(rows).padStart(20)}`)
console.log(`\n  THE MOVEMENT: ${moved} of ${rows} decorates rows change class (${rows === 0 ? "0" : ((100 * moved) / rows).toFixed(1)} %).`)
console.log(`  THE ROOT: the arbiter resolves the edge's TARGET against the declaration space, and the`)
console.log(`  endpoint that must be found for \`decorates\` is the DECORATED DECLARATION — a symbol in`)
console.log(`  the file. Published the other way, the arbiter is asked to find the DECORATOR's name, an`)
console.log(`  imported name that this file does not declare.`)
for (const e of movedExamples) console.log(`    ${e}`)

const payload = {
  instrument: "script/m14/python-decorates-direction.ts",
  population: { files: pop.files.length, repos: pop.repos, absent: pop.absent, overCap: pop.overCap, root: CR },
  digests: {
    head: gitHead(),
    analyzer: blobOf("src/ast/real-python-analyzer.ts"),
    arbiter: blobOf("script/m14/incoming-rule.ts"),
    instrument: blobOf("script/m14/python-decorates-direction.ts"),
  },
  authority: {
    vocabulary: "src/ast/types.ts's `Decorates` member: \"source = the decorating symbol, target = the decorated declaration\"",
    emitters: [
      "src/ast/real-python-analyzer.ts:6112 — pushRel(ctx, nameNode.text /* decorated decl */, target.target /* decorator */, Decorates)",
      "src/ast/real-javascript-analyzer.ts:2955 — source: symbol.name, target: decorator",
      "src/ast/real-typescript-analyzer.ts:7403 — source: symbol.name, target: decorator",
    ],
  },
  rows,
  moved,
  movedFraction: rows === 0 ? null : moved / rows,
  asPublished: Object.fromEntries(CLASSES.map((c) => [c, asPublished.get(c) ?? 0])),
  asVocabulary: Object.fromEntries(CLASSES.map((c) => [c, asVocabulary.get(c) ?? 0])),
  movement,
  examples: movedExamples,
}
if (OUT) {
  writeFileSync(OUT, JSON.stringify(payload, null, 2))
  console.log(`\nwrote ${OUT}`)
}
if (!existsSync(OUT ?? "")) { /* no out requested */ }
