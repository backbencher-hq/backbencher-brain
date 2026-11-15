/**
 * NIM RULING PROBE — runs `script/m14/nim-ruled.ts`'s own probe over the whole
 * corpus, so every number in that table's `describe` comes from a run and not from
 * a previous session's prose.
 *
 * It exists because of the asymmetry the table's header names: a 0 with no
 * denominator is indistinguishable from a probe that examined nothing. This prints
 * both, and it prints the populations the guards REMOVE, because a guard that
 * removes 120 of 125 candidates is a judgement that has to be inspectable rather
 * than asserted.
 *
 * Two measurements, both on the tree, neither on text:
 *
 *   A. INSTRUMENT A — every node type the pinned wasm produces across the corpus.
 *      It decides the question `implements` does NOT need deciding (the grammar
 *      HAS `concept_declaration`) and it is printed so that fact is on the record
 *      next to the 0 rather than assumed.
 *   B. INSTRUMENT B — the concept population, split by spelling and by which guard
 *      each candidate fails. `refines` is the `of` form. The `is` form is counted
 *      at four depths: every `is` in a concept body; those whose left side is a
 *      bare concept parameter; those whose right side names a concept THIS FILE
 *      declares; and those that pass every guard, which is the hit condition.
 *
 * A text probe is deliberately NOT run as the deciding instrument, and the reason
 * is on the record: `nim/compiler/parser.nim` QUOTES the `conceptDecl` production
 * this construct is written in, inside a diagnostic string. A text search for the
 * spelling finds it. The text probe is run anyway and reported as a
 * non-instrument, with each hit classified by node type, because "a text probe
 * would have found N and all N are prose" is a stronger statement than silence.
 *
 * Run: npx tsx validation/m14/fixtures/nim/nim-ruled-probe.ts [out.json]
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { NIM_IMPLEMENTS_EXAMINED, countNimImplementsConstruct } from "../../../../script/m14/nim-ruled"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const ANALYZER = path.resolve((import.meta as any).dirname ?? ".", "../../../../src/ast/real-nim-analyzer.ts")
const analyzerHash = (): string => createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")
const HASH_BEFORE = analyzerHash()
const OUT = process.argv[2] && process.argv[2].endsWith(".json") ? process.argv[2] : null

const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "nim") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
const byRepo = new Map<string, number>()
for (const f of files) byRepo.set(f.repo, (byRepo.get(f.repo) ?? 0) + 1)
console.log(`nim ruling probe — production corpus walk`)
console.log(`analyzer    : ${path.relative(process.cwd(), ANALYZER)} sha256:${HASH_BEFORE.slice(0, 16)}`)
console.log(`corpus root : ${CR}`)
console.log(`files       : ${files.length.toLocaleString()}  [${[...byRepo].map(([k, v]) => `${k}=${v}`).join(", ")}]`)
console.log(`wasm        : wasm/tree-sitter-nim.wasm (${statSync(path.join(process.cwd(), "wasm/tree-sitter-nim.wasm")).size.toLocaleString()} B)`)

const wts: any = await import("web-tree-sitter")
const WSP: any = wts.Parser ?? wts.default
const WSL: any = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-nim.wasm"))))

// ── the `is`-form population, split by which guard each candidate fails
const isForm = {
  everyIsInConceptBody: 0,
  leftIsBareConceptParameter: 0,
  rightNamesSameFileConcept: 0,
  passesAllGuards: 0,
  rightSideNames: new Map<string, number>(),
  allIsRightSideNames: new Map<string, number>(),
  allIsRightSideNotIdentifier: 0,
  guardFailures: { argumentList: 0, leftNotParameter: 0, rightNotIdentifier: 0, rightNotLocalConcept: 0, selfReference: 0 } as Record<string, number>,
  examples: [] as string[],
}
const ofForm = { withRefinesField: 0, examples: [] as string[] }
const conceptDecls = { total: 0, files: new Set<string>() }
const nodeTypes = new Map<string, number>()
const rawParseFailures: string[] = []
// Text-probe hits, classified by the node they sit in. NOT an instrument.
const textHits: { file: string; line: number; nodeType: string; snippet: string }[] = []

/** Concepts this file declares, with their formal parameters. */
function conceptsIn(root: any): any[] {
  const out: any[] = []
  const visit = (n: any): void => {
    if (n.type === "concept_declaration") out.push(n)
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(root)
  return out
}
function ownerTypeName(node: any): string | null {
  let p = node.parent
  while (p) {
    if (p.type === "type_declaration") {
      for (let i = 0; i < p.namedChildCount; i++) {
        const c = p.namedChild(i)
        if (c && c.type === "type_symbol_declaration") {
          const nm = c.childForFieldName?.("name")
          if (!nm) return null
          if (nm.type === "exported_symbol") {
            const inner = nm.namedChildCount > 0 ? nm.namedChild(0) : null
            return inner ? String(inner.text) : null
          }
          return String(nm.text)
        }
      }
      return null
    }
    p = p.parent
  }
  return null
}
function lastNamedChildOf(n: any): any {
  for (let i = n.namedChildCount - 1; i >= 0; i--) {
    const c = n.namedChild(i)
    if (c) return c
  }
  return null
}

for (const f of files) {
  let t: any
  try { t = parser.parse(f.text) } catch { rawParseFailures.push(`${f.repo}/${f.rel}`); continue }
  if (!t) { rawParseFailures.push(`${f.repo}/${f.rel}`); continue }
  const label = `${f.repo}/${f.rel}`

  // Instrument A — one walk, every node.
  const stack: any[] = [t.rootNode]
  while (stack.length > 0) {
    const n = stack.pop()
    nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1)
    for (let k = 0; k < n.childCount; k++) stack.push(n.child(k))
  }

  // Instrument B, the `of` form.
  const cs = conceptsIn(t.rootNode)
  if (cs.length > 0) {
    conceptDecls.total += cs.length
    conceptDecls.files.add(f.rel)
    for (const c of cs) {
      const ref = c.childForFieldName?.("refines")
      if (ref) {
        ofForm.withRefinesField++
        if (ofForm.examples.length < 6) ofForm.examples.push(`${label}:${ref.startPosition.row + 1}: ${String(ref.text).replace(/\n/g, " ").slice(0, 70)}`)
      }
    }
  }

  // Instrument B, the `is` form, with the guard funnel.
  //
  // EACH BODY IS WALKED WITH ITS OWN CONCEPT'S PARAMETER SET. The first version
  // kept one map from concept OWNER NAME to that concept's parameters and looked a
  // candidate up by the candidate's LEFT identifier, so every lookup missed and the
  // funnel read `leftIsBareConceptParameter: 0` against a corpus the analyzer reads
  // concept-`is`-concept sites in. A guard that cannot match prints the same zero as
  // a construct that does not occur, which is the one confusion this instrument
  // exists to rule out.
  const localConcepts = new Set<string>()
  const sites: { concept: any; owner: string; params: Set<string> }[] = []
  for (const c of cs) {
    const owner = ownerTypeName(c)
    if (!owner) continue
    localConcepts.add(owner)
    const set = new Set<string>()
    const pl = c.childForFieldName?.("parameters")
    if (pl) for (const p of pl.namedChildren ?? []) if (p && p.type === "identifier") set.add(String(p.text))
    sites.push({ concept: c, owner, params: set })
  }
  for (const site of sites) {
    const body = lastNamedChildOf(site.concept)
    if (!body) continue
    const walkIs = (n: any): void => {
      if (n.type === "infix_expression") {
        const op = n.childForFieldName?.("operator")
        if (op && op.text === "is") {
          isForm.everyIsInConceptBody++
          const left = n.childForFieldName?.("left")
          const right = n.childForFieldName?.("right")
          // The right-hand side of EVERY `is` in a concept body, recorded before
          // any guard runs. The old fixture comments quoted a breakdown of this
          // population ("T 31, int 23, bool 15, string 10") that no committed
          // artifact carried, so the numbers could not be checked and drifted with
          // the corpus. `rightSideNames` below covers only the 13 sites that pass
          // the FIRST guard, which is why this second map exists: together they
          // let a reader see what the guards actually removed.
          if (right && right.type === "identifier") isForm.allIsRightSideNames.set(String(right.text), (isForm.allIsRightSideNames.get(String(right.text)) ?? 0) + 1)
          else isForm.allIsRightSideNotIdentifier++
          if (left && left.type === "identifier") {
            if (site.params.has(String(left.text))) {
              isForm.leftIsBareConceptParameter++
              if (right && right.type === "identifier") {
                const target = String(right.text)
                isForm.rightSideNames.set(target, (isForm.rightSideNames.get(target) ?? 0) + 1)
                if (localConcepts.has(target)) {
                  isForm.rightNamesSameFileConcept++
                  if (target === site.owner) isForm.guardFailures.selfReference++
                  else {
                    isForm.passesAllGuards++
                    if (isForm.examples.length < 6) isForm.examples.push(`${label}:${n.startPosition.row + 1}: ${site.owner}: ${left.text} is ${target}`)
                  }
                } else isForm.guardFailures.rightNotLocalConcept++
              } else isForm.guardFailures.rightNotIdentifier++
            } else isForm.guardFailures.leftNotParameter++
          } else isForm.guardFailures.leftNotParameter++
        }
      }
      if (n.type === "argument_list") { isForm.guardFailures.argumentList++; return }
      for (let i = 0; i < n.childCount; i++) walkIs(n.child(i))
    }
    walkIs(body)
  }

  // The NON-instrument: the `of` spelling found in TEXT, classified by the node it
  // sits in. `nim/compiler/parser.nim` quotes the `conceptDecl` production this
  // construct is written in, inside a diagnostic STRING, so a text probe finds it
  // and a reader who trusted the text probe would overturn a correct ruling.
  //
  // The pattern is LOOSE on purpose. A tight one (`concept X of `) returns 0 on this
  // corpus, because the site that exists is `('concept' COMMENT? … ('of' typeDesc …`
  // — the keyword is QUOTED there, so the tight pattern misses the one file a loose
  // one catches. Reporting only the tight pattern's 0 would be the same category of
  // error as the guard bug above: a number that reads like evidence and is an
  // artefact of the probe.
  {
    const re = /concept[^\n]{0,40}?\bof\b/g
    let m: RegExpExecArray | null
    while ((m = re.exec(f.text)) !== null) {
      const line = f.text.slice(0, m.index).split("\n").length
      const cls = classify(t.rootNode, m.index, m.index + m[0].length)
      if (textHits.length < 400) textHits.push({ file: `${label}:${line}`, line, nodeType: cls, snippet: m[0].replace(/\s+/g, " ").slice(0, 70) })
    }
  }
  t.delete?.()
}

/** Which node encloses a byte range — the classification that turns a text hit
 *  into a fact about a COMMENT or a STRING rather than about code. A bare
 *  substring search cannot make that distinction, which is the whole reason the
 *  gate's instruments are tree walks. */
function classify(n: any, start: number, end: number): string {
  if (n.startIndex <= start && end <= n.endIndex) {
    if (n.type === "comment" || n.type.endsWith("_comment") || n.type === "comment_content") return "comment"
    if (n.type.includes("string")) return "string"
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (!c) continue
      const r = classify(c, start, end)
      if (r !== "code") return r
    }
    return "code"
  }
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (!c) continue
    const r = classify(c, start, end)
    if (r !== "code") return r
  }
  return "code"
}

// The table's own probe, run over the same corpus, so the table's counter is the
// one on the record rather than a reimplementation of it.
const tableHits: string[] = []
for (const f of files) {
  let t: any
  try { t = parser.parse(f.text) } catch { continue }
  if (!t) continue
  countNimImplementsConstruct(t.rootNode, `${f.repo}/${f.rel}`, tableHits)
  t.delete?.()
}

const w = (s: string, n: number): string => (s + " ".repeat(n)).slice(0, n)
console.log(`\nINSTRUMENT A — grammar inventory`)
console.log(`  distinct node types produced over ${files.length.toLocaleString()} files : ${nodeTypes.size}`)
console.log(`  concept_declaration produced                                        : ${nodeTypes.get("concept_declaration") ?? 0}`)
console.log(`  refinement_list produced                                            : ${nodeTypes.get("refinement_list") ?? 0}`)
console.log(`  So the construct's OWN node type is present and instrument A cannot decide this row.`)
console.log(`  Instrument A is the right instrument for a construct needing a node type the`)
console.log(`  grammar does NOT have (json's function call, zig's supertype clause). It is the`)
console.log(`  wrong instrument for a RELATION, which is json's exports history exactly.`)

console.log(`\nINSTRUMENT B — the concept population, and the refinement count inside it`)
console.log(`  ${w("concept_declaration", 46)}${String(conceptDecls.total).padStart(6)} in ${String(conceptDecls.files.size).padStart(4)} files`)
console.log(`  ${w("…of those, carrying a `refines` field (the `of` form)", 46)}${String(ofForm.withRefinesField).padStart(6)}`)
console.log(`  ${w("`is X` expressions inside a concept body", 46)}${String(isForm.everyIsInConceptBody).padStart(6)}`)
console.log(`  ${w("…left side is a bare concept formal parameter", 46)}${String(isForm.leftIsBareConceptParameter).padStart(6)}`)
console.log(`  ${w("…right side names a concept THIS FILE declares", 46)}${String(isForm.rightNamesSameFileConcept).padStart(6)}`)
console.log(`  ${w("REFINEMENTS (passes every guard — the hit condition)", 46)}${String(isForm.passesAllGuards).padStart(6)}`)
console.log(`  guard failures: ${JSON.stringify(isForm.guardFailures)}`)
const topRhs = [...isForm.rightSideNames].sort((a, b) => b[1] - a[1]).slice(0, 12)
console.log(`  most common right-hand sides of a guarded \`is\`: ${topRhs.map(([k, v]) => `${k}(${v})`).join(" ")}`)
// The same distribution over the WHOLE `is`-in-a-concept-body population, i.e.
// before the left-parameter guard. This is the number the fixture comments quote
// when they say what an unguarded reader would fabricate, so it is published here
// rather than asserted in a comment that no artifact backs.
const topAll = [...isForm.allIsRightSideNames].sort((a, b) => b[1] - a[1]).slice(0, 14)
const allTotal = [...isForm.allIsRightSideNames.values()].reduce((a, b) => a + b, 0)
console.log(`  right-hand sides of ALL ${isForm.everyIsInConceptBody} \`is\`-in-concept-body: ${allTotal} name an identifier, ${isForm.allIsRightSideNotIdentifier} do not`)
console.log(`    most common, unguarded: ${topAll.map(([k, v]) => `${k}(${v})`).join(" ")}`)
for (const e of ofForm.examples) console.log(`  of-form: ${e}`)
for (const e of isForm.examples) console.log(`  is-form HIT: ${e}`)

console.log(`\nTHE TABLE'S OWN PROBE — script/m14/nim-ruled.ts, run over the same corpus`)
for (const [k, v] of Object.entries(NIM_IMPLEMENTS_EXAMINED)) console.log(`  ${w(k, 34)}${v}`)
console.log(`  hits pushed : ${tableHits.length}`)
for (const h of tableHits.slice(0, 6)) console.log(`    ${h}`)
console.log(`  A non-zero hits count is what makes the arbiter print FALSIFIED for \`implements\`.`)

const textByClass = new Map<string, number>()
for (const h of textHits) textByClass.set(h.nodeType, (textByClass.get(h.nodeType) ?? 0) + 1)
console.log(`\nNOT AN INSTRUMENT — the same spelling found in TEXT, classified by the node it sits in`)
console.log(`  text hits for the \`concept … of\` shape : ${textHits.length}  by enclosing node ${JSON.stringify(Object.fromEntries(textByClass))}`)
for (const h of textHits.slice(0, 10)) console.log(`    ${h.nodeType.padEnd(8)} ${h.file.padEnd(64)} ${h.snippet}`)
const codeHits = textHits.filter((h) => h.nodeType === "code")
console.log(`  of those, ${codeHits.length} sit in CODE and would be a real \`of\`-form refinement.`)
console.log(`  \`nim/compiler/parser.nim\` QUOTES the conceptDecl production in a diagnostic STRING, which is`)
console.log(`  why the verdict rests on the parse-tree count and not on this one.`)

console.log(`\nraw parse failures: ${rawParseFailures.length}${rawParseFailures.length ? ` — ${rawParseFailures.slice(0, 5).join(", ")}` : ""}`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    analyzerSha256: HASH_BEFORE, analyzerStableDuringRun: analyzerHash() === HASH_BEFORE,
    corpusRoot: CR, files: files.length, filesByRepo: Object.fromEntries(byRepo),
    instrumentA: { nodeTypeCount: nodeTypes.size, conceptDeclaration: nodeTypes.get("concept_declaration") ?? 0, refinementList: nodeTypes.get("refinement_list") ?? 0 },
    conceptDecls: { total: conceptDecls.total, files: conceptDecls.files.size },
    ofForm: { withRefinesField: ofForm.withRefinesField, examples: ofForm.examples },
    isForm: {
      everyIsInConceptBody: isForm.everyIsInConceptBody,
      leftIsBareConceptParameter: isForm.leftIsBareConceptParameter,
      rightNamesSameFileConcept: isForm.rightNamesSameFileConcept,
      passesAllGuards: isForm.passesAllGuards,
      guardFailures: isForm.guardFailures,
      rightSideNames: Object.fromEntries([...isForm.rightSideNames].sort((a, b) => b[1] - a[1]).slice(0, 40)),
      allIsRightSideNames: Object.fromEntries([...isForm.allIsRightSideNames].sort((a, b) => b[1] - a[1]).slice(0, 40)),
      allIsRightSideNotIdentifier: isForm.allIsRightSideNotIdentifier,
      examples: isForm.examples,
    },
    tableProbe: { ...NIM_IMPLEMENTS_EXAMINED, hits: tableHits.length, hitExamples: tableHits.slice(0, 10) },
    textProbeNonInstrument: { hits: textHits.length, byNodeType: Object.fromEntries(textByClass), sample: textHits.slice(0, 20) },
    rawParseFailures,
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
console.log(`analyzer sha256 after the walk : ${HASH_BEFORE.slice(0, 16)}${analyzerHash() === HASH_BEFORE ? "  (unchanged — every number above is tied to this analyzer state)" : "  CHANGED DURING THE RUN — the numbers above are a MIXTURE of two analyzer states and are not reproducible"}`)
  }