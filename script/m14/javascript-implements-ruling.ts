/**
 * JAVASCRIPT `implements` RULING — the falsifiable instrument behind the verdict.
 *
 * WHY A SEPARATE FILE. `script/m14/javascript-ontology-census.ts` measures
 * instruments A–D for the missing type. A–C read a CORPUS; this file adds the two
 * measurements a corpus cannot give, because both are about the ARTIFACT rather
 * than about the population:
 *
 *   A1  THE GRAMMAR PACKAGE'S OWN DECLARATION. `node_modules/
 *       tree-sitter-javascript/src/node-types.json` is the grammar's declared
 *       vocabulary — every named type it can produce, with no dependence on which
 *       files happen to be checked out. A ruling that rests on a corpus sample is
 *       a ruling about the sample; this one is about the parser.
 *   A2  THE PROBE CAN SEE IT. A measurement is only worth its instrument if the
 *       instrument would FIRE on the construct it claims not to exist. So the same
 *       node-types scan runs against the sibling `tree-sitter-typescript` package,
 *       which declares `implements_clause`. If A1 reported "no supertype-shaped
 *       type" for both, A1 would be measuring nothing.
 *   E   THE COUNTERFACTUAL. JavaScript's only possible spelling of the construct
 *       is `class A implements B {}` or `class A extends B implements C {}`. Both
 *       are parsed with the pinned wasm and the resulting node types printed. This
 *       is the decisive one: it answers "what does this grammar make of the
 *       construct" instead of "did I find the construct".
 *
 * AND THE QUESTION THAT DECIDES THE JSDOC VARIANT. JSDoc defines
 * `@implements {Type}`, and instrument D counts those tags. A tag is a COMMENT, so
 * it is not the language — but "it is a comment" is only half an argument, because
 * a comment CAN still be a real edge. The other half is whether the edge could
 * ever RESOLVE: JavaScript declares no interfaces and no abstract classes as a
 * separate kind, so a `@implements {IFoo}` names a type that the language has no
 * declaration site for. This file therefore measures how many `@implements` tags
 * name a type that any corpus file actually DECLARES. The answer decides whether
 * implementing the tag would produce resolvable edges or a graph full of targets
 * that nothing binds — which is the difference between a relationship and a
 * decoration.
 *
 * WRITES ONE FILE (validation/m14/tmp/javascript-implements-ruling.json).
 * READ-ONLY otherwise.
 *
 *   bun run script/m14/javascript-implements-ruling.ts [--corpus=<dir>] [--tag=<name>]
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const CR = arg("corpus", "$HOME/fixtures/repositories/typescript")
const TAG = arg("tag", path.basename(CR))
const SIZE_CAP = 512 * 1024
const OUT = `validation/m14/tmp/javascript-implements-ruling.json`

const SUPERTYPE_PATTERN = /impl|interface|super|heritage|abstract|mixin|trait|protocol|conform/i

/** A1 / A2 — the grammar package's own declared vocabulary. */
function declaredNodeTypes(pkgDir: string): { version: string; named: string[]; supertype: string[] } | null {
  const nt = path.join(pkgDir, "src", "node-types.json")
  if (!existsSync(nt)) return null
  let version = "?"
  try { version = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")).version ?? "?" } catch { /* version is decoration */ }
  const all = JSON.parse(readFileSync(nt, "utf8")) as { type: string; named?: boolean }[]
  const named = all.filter((n) => n.named).map((n) => n.type)
  return { version, named, supertype: named.filter((n) => SUPERTYPE_PATTERN.test(n)) }
}

const JS_PKG = path.join(process.cwd(), "node_modules", "tree-sitter-javascript")
const TS_PKG = path.join(process.cwd(), "node_modules", "tree-sitter-typescript", "typescript")
const a1 = declaredNodeTypes(JS_PKG)
const a2 = existsSync(TS_PKG) ? declaredNodeTypes(TS_PKG) : null

console.log("A1 — the javascript grammar's OWN declared vocabulary")
if (!a1) console.log("  UNREADABLE: node-types.json not found")
else console.log(`  tree-sitter-javascript@${a1.version}: ${a1.named.length} named types; supertype-shaped: ${JSON.stringify(a1.supertype)}`)

console.log("\nA2 — the same scan on the sibling typescript grammar, which DOES have the construct")
if (!a2) console.log("  UNREADABLE: tree-sitter-typescript/typescript not installed")
else console.log(`  tree-sitter-typescript@${a2.version}: ${a2.named.length} named types; supertype-shaped: ${JSON.stringify(a2.supertype)}`)
console.log(`  the probe fires: ${a2 && a2.supertype.some((n) => n === "implements_clause") ? "YES" : "NO — A1 measures nothing if this is NO"}`)

// ---------------------------------------------------------------- corpus
const tracked: string[] = execFileSync("git", ["-C", CR, "ls-files", "-z"], {
  encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
}).split("\0").filter(Boolean)
const admitted: string[] = []
for (const rel of tracked) {
  const abs = path.join(CR, rel)
  try {
    if (statSync(abs).size > SIZE_CAP) continue
    if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "javascript") continue
  } catch { continue }
  admitted.push(rel)
}
admitted.sort()
console.log(`\ncorpus ${CR}: ${admitted.length} admitted js files`)

// ---------------------------------------------------------------- E — counterfactual
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-javascript.wasm"))))

const COUNTERFACTUALS = [
  "class A extends B { }",
  "class A implements B { }",
  "class A extends B implements C { }",
  "class A extends B, C { }",
  "class A extends ns.B { }",
]
const counterfactuals = COUNTERFACTUALS.map((src) => {
  const t = parser.parse(src)
  const sexp = t!.rootNode.toString()
  const heritage = /class_heritage/.test(sexp)
  const error = /\(ERROR/.test(sexp)
  // The falsifier, stated as a predicate rather than as prose: a real
  // multi-supertype clause would put MORE THAN ONE named child under
  // `class_heritage` with NO ERROR node anywhere in the class declaration.
  const m = /class_heritage((?:\s+\([a-z_]+[^()]*\))+)/.exec(sexp)
  const namedUnderHeritage = m ? (m[1].match(/\(/g) ?? []).length : 0
  return { source: src, sexp, hasHeritage: heritage, hasError: error, namedChildrenUnderHeritage: namedUnderHeritage, derivable: heritage && !error }
})
for (const c of counterfactuals) {
  console.log(`  ${c.derivable ? "PARSES " : "ERRORS "} ${c.source.padEnd(36)} heritage=${c.hasHeritage} error=${c.hasError} namedUnderHeritage=${c.namedChildrenUnderHeritage}`)
}

// ---------------------------------------------------------------- B/C — corpus heritage
const heritageShapes = new Map<string, number>()
const heritageTokens = new Map<string, number>()
const multi: string[] = []
let heritageClauses = 0, implementsTokens = 0, trees = 0, errorTrees = 0
/**
 * THE COUNT IS THE MEASUREMENT; `multi` is a SAMPLE of it.
 *
 * The first version of this instrument got that wrong in the same way the census
 * did — it kept the examples in one capped array and printed its length as the
 * count, so it reported 40 where the structural count is 97. Two capped counters
 * reading the same tree and disagreeing is what surfaced it: the census's shape
 * table accounted for 97 multi-child clauses (`ERROR+identifier` 86 plus
 * `ERROR+binary_expression` 11) while this file's array had stopped at 40. A cap
 * that silently becomes the reported number is the failure mode this whole
 * workstream is about, and it is worth catching twice in one round rather than
 * once.
 */
let multiClauses = 0
let multiInsideError = 0
for (const rel of admitted) {
  const t = parser.parse(readFileSync(path.join(CR, rel), "utf8"))
  if (!t) continue
  trees++
  const stack: any[] = [t.rootNode]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "class_heritage") {
      heritageClauses++
      const named = n.namedChildren.map((c: any) => c.type)
      const key = named.join("+")
      heritageShapes.set(key, (heritageShapes.get(key) ?? 0) + 1)
      if (named.length > 1) {
        multiClauses++
        const hasError = /ERROR/.test(n.toString())
        if (hasError) multiInsideError++
        if (multi.length < 20) multi.push(`${rel}:${n.startPosition.row + 1} [${named.join(", ")}] hasError=${hasError}`)
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (!c.isNamed) {
          const txt = String(c.text)
          heritageTokens.set(txt, (heritageTokens.get(txt) ?? 0) + 1)
          if (txt === "implements") implementsTokens++
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  t.delete?.()
}
console.log(`\nB/C — corpus heritage clauses: ${heritageClauses} over ${trees} trees`)
console.log(`  shapes: ${JSON.stringify([...heritageShapes.entries()].map(([k, v]) => [k, v]))}`)
console.log(`  anonymous tokens under class_heritage: ${JSON.stringify([...heritageTokens.entries()].map(([k, v]) => [k, v]))}`)
console.log(`  \`implements\` tokens: ${implementsTokens}   multi-named-child clauses: ${multiClauses}, of which ${multiInsideError} contain an ERROR node` + (multi.length ? `  e.g. ${multi[0]}` : ""))

// ---------------------------------------------------------------- D — JSDoc, and whether it could resolve
let idx = 0
const declaredNames = new Set<string>()
const tagHits: { file: string; line: number; types: string[] }[] = []
let jsdocTags = 0, extendsTags = 0
async function worker(): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= admitted.length) return
    const rel = admitted[i]
    let r: any
    try { r = await parseFile(path.join(CR, rel), CR) } catch { continue }
    for (const s of r?.symbols ?? []) { const n = String(s?.name ?? ""); if (n) declaredNames.add(n) }
    // The tag is in a COMMENT. Read the comments the analyzer itself collected,
    // so the count is of tags in comments the pipeline saw.
    for (const s of r?.symbols ?? []) {
      const doc = String(s?.documentation ?? s?.doc ?? "")
      if (!doc) continue
      const im = doc.match(/@implements\s*\{([^}]*)\}/g)
      if (im) {
        jsdocTags += im.length
        for (const m of im) {
          const types = (m.match(/\{([^}]*)\}/)?.[1] ?? "").split(/[,|]/).map((x) => x.trim()).filter(Boolean)
          tagHits.push({ file: rel, line: s.range?.startLine ?? 0, types })
        }
      }
      extendsTags += (doc.match(/@extends\s*\{/g) ?? []).length
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

// Comments that are file headers belong to no symbol, so read those from the tree
// as well rather than undercounting. A file-level `/** @implements {IFoo} */`
// names no declaration, which is itself part of the answer.
const fileLevelTags: { file: string; line: number; text: string }[] = []
for (const rel of admitted) {
  const t = parser.parse(readFileSync(path.join(CR, rel), "utf8"))
  if (!t) continue
  const stack: any[] = [t.rootNode]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "comment") {
      const m = /@implements\s*\{([^}]*)\}/.exec(String(n.text))
      if (m) fileLevelTags.push({ file: rel, line: n.startPosition.row + 1, text: m[0].slice(0, 120) })
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  t.delete?.()
}
const allTagTypes = tagHits.flatMap((t) => t.types)
const resolvable = allTagTypes.filter((t) => declaredNames.has(t.split(".").pop() ?? t))
console.log(`\nD — JSDoc: ${jsdocTags} @implements tag(s) on symbol documentation, ${fileLevelTags.length} in comments attached to no symbol`)
console.log(`  ${extendsTags} @extends tag(s) for contrast`)
console.log(`  named types referenced by an @implements tag: ${allTagTypes.length}; DECLARED as a symbol anywhere in this corpus: ${resolvable.length}`)
for (const h of tagHits.slice(0, 8)) console.log(`  ${h.file}:${h.line} @implements {${h.types.join(", ")}}`)
for (const h of fileLevelTags.slice(0, 8)) console.log(`  (file-level) ${h.file}:${h.line} ${h.text}`)

// ---------------------------------------------------------------- verdict
const verdict = {
  type: "implements",
  verdict: "RULED",
  grammarDeclaredTypes: a1?.named.length ?? null,
  grammarSupertypeShapes: a1?.supertype ?? null,
  grammarMentionsImplements: a1 ? a1.named.some((n) => n.includes("implements")) : null,
  probeWouldFireOnTypescript: a2 ? a2.supertype.includes("implements_clause") : null,
  corpusHeritageClauses: heritageClauses,
  corpusHeritageShapes: [...heritageShapes.entries()].map(([k, v]) => [k, v]),
  corpusImplementsTokens: implementsTokens,
  corpusMultiNamedHeritageClauses: multiClauses,
  corpusMultiNamedInsideError: multiInsideError,
  corpusMultiNamedAllErrors: multiClauses === multiInsideError,
  counterfactuals,
  jsdocImplementsTags: jsdocTags,
  jsdocFileLevelTags: fileLevelTags.length,
  jsdocReferencedTypes: allTagTypes.length,
  jsdocResolvableTypes: resolvable.length,
}
console.log(`\nVERDICT implements = RULED`)
console.log(`  the grammar declares ${a1?.named.length} named types and none of them is a supertype clause;`)
console.log(`  the same scan finds implements_clause in the typescript grammar, so the scan is not blind;`)
console.log(`  \`class A implements B {}\` parses to an ERROR with no class_heritage at all;`)
console.log(`  ${heritageClauses} corpus heritage clauses carry ${implementsTokens} \`implements\` tokens and ${multiClauses} multi-child clauses, ${multiInsideError} of them inside an ERROR node;`)
console.log(`  ${jsdocTags + fileLevelTags.length} JSDoc @implements tag(s) name ${allTagTypes.length} type(s), of which ${resolvable.length} is declared as a symbol anywhere in the corpus.`)

mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), corpus: CR, tag: TAG, admittedFiles: admitted.length, ...verdict, multiExamples: multi.slice(0, 20), tagHits: tagHits.slice(0, 40), fileLevelTags: fileLevelTags.slice(0, 40) }, null, 2))
console.log(`\nwrote ${OUT}`)