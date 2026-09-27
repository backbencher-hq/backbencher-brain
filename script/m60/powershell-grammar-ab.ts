// M60 #278 — the PowerShell grammar A/B, and the instrument the grammar wave needs.
//
//   bun script/m60/powershell-grammar-ab.ts --new <candidate.wasm> [--out <path>]
//                                                    [--rebuild <wired-rebuild.wasm>]
//                                                    [--label <name>]
//
// The CSS lane established the method (script/m14/tmp/css-grammar-ab.ts) and one
// fact that changed how this one is built: a grammar patch is only ATTRIBUTABLE
// if the thing it is applied to is the thing the product loads. So this measures
// five questions, in the order that decides the matter:
//
//   Q1 REPRODUCE   does the vendored source, rebuilt, reproduce the WIRED wasm's
//                  behaviour? If not, no patch on that source is a patch on the
//                  wired grammar — it is a patch on something else, and every
//                  downstream number is unattributable.
//   Q2 NET WIN    per corpus, damaged files before vs after. A grammar that fixes
//                  some files and breaks others is not a win.
//   Q3 NO COLLATERAL  every file that parsed cleanly BEFORE must parse cleanly
//                  AFTER. This is the question that decides it: widening a token
//                  can silently re-lex a construct that used to be unambiguous,
//                  and the only evidence is the file set, not a spot check.
//   Q4 SHAPE DELTA   node-type enumeration + multiset over a clean corpus, so an
//                  analyzer written against the old shapes is not silently
//                  re-pointed. A behaviour-preserving SHAPE change is a
//                  different kind of decision and must be declared, not found
//                  later.
//   Q5 ID-ORDER      the id-order digest (M49 W19), because a rebuild's sha256 is
//                  NOT a function of its source across toolchain versions — so
//                  the id ORDER is the part that can be required to match.
//
// Q1 is the one this lane needed and no existing lane had: the wired powershell
// wasm is 983,236 bytes and the source in the npm cache builds a 1,088,467-byte
// artifact. Measuring that gap is what turned a guess ("the cache holds the
// wired grammar's source") into a fact (it does not — see the pin).

import { Parser as TSParser, Language } from "web-tree-sitter"
import { readFileSync, readdirSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { createHash } from "crypto"
import { execFileSync } from "child_process"

const ROOT = "$HOME/mcp/backbencher-brain"
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const val = (f: string) => { const i = argv.indexOf(f); return i < 0 ? undefined : argv[i + 1] }
const NEW = val("--new")
const REBUILD = val("--rebuild")
const LABEL = val("--label") ?? "candidate"
const OUT = val("--out")
const WIRED = join(ROOT, "wasm/tree-sitter-powershell.wasm")

// The production half of two corpora. `powershell`'s test/ tree is parser-error
// TEST DATA, not a corpus — including it would have made the damage number a
// statement about their test fixtures.
const REPOS = ["powershell", "ansible"]
const EXTS = new Set(["ps1", "psm1", "psd1"])

const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b as any).digest("hex")

// ---------------------------------------------------------------------------
// The draw. Same rule as powershell-surface-measure.ts: production (non-test)
// tracked files, drawn by a hash of `repo/relative-path` so the sample is
// unbiased and reproducible, with the digest recorded so a re-run that drew a
// different set SAYS SO instead of being compared.
// ---------------------------------------------------------------------------
function trackedPsFiles(repo: string): string[] {
  let out = ""
  try { out = execFileSync("git", ["-C", join(CORPUS_ROOT, repo), "ls-files"], { encoding: "utf8", maxBuffer: 1 << 28 }) } catch { return [] }
  return out.split("\n").filter((r) => {
    if (!r) return false
    if (r.split("/").some((s) => s === "test" || s === "tests" || s === "spec")) return false
    return EXTS.has((r.split(".").pop() ?? "").toLowerCase())
  })
}

function draw(repo: string): string[] {
  const all = trackedPsFiles(repo)
  if (all.length === 0) return []
  const keyed = all.map((r) => ({ r, h: sha256(`ab-draw/${repo}/${r}`) })).sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
  return keyed.map((k) => k.r)
}

// ---------------------------------------------------------------------------
// A surface, measured the way verify-grammar-pins.ts measures it, so the numbers
// here and the numbers in the pin are the same numbers.
// ---------------------------------------------------------------------------
interface Surface { ids: number; named: number; anon: number; fields: number; idOrder: string; typeSet: string; fieldSet: string; allNames: string[]; namedNames: string[] }

function surfaceOf(g: any): Surface {
  const ids: string[] = [], pairs: string[] = [], fields: string[] = []
  const named: string[] = [], anon: string[] = [], all: string[] = []
  for (let i = 0; i < g.nodeTypeCount; i++) {
    const name = String(g.nodeTypeForId(i) ?? "")
    const isNamed = !!g.nodeTypeIsNamed(i)
    ids.push(`${i}\u0000${name}\u0000${isNamed ? 1 : 0}`)
    pairs.push(`${isNamed ? 1 : 0}\u0000${name}`)
    ;(isNamed ? named : anon).push(name)
    all.push(name)
  }
  for (let i = 1; i <= g.fieldCount; i++) { const f = g.fieldNameForId(i); if (f) fields.push(f) }
  return {
    ids: g.nodeTypeCount, named: new Set(named).size, anon: new Set(anon).size, fields: g.fieldCount,
    idOrder: sha256(ids.join("\n")), typeSet: sha256(pairs.slice().sort().join("\n")), fieldSet: sha256(fields.slice().sort().join("\n")),
    allNames: [...new Set(all)].sort(),
    // The NAMED vocabulary is kept separately from the full id enumeration on
    // purpose. A first run of this instrument printed "named vocabulary changed:
    // YES" for a candidate whose 152 named types were IDENTICAL, because it
    // diffed the full enumeration — where an added rule contributes both its
    // anonymous helper AND its anonymous token — and then filtered only
    // `_`-prefixed names, which does not exclude an anonymous token like `'`.
    // An analyzer is written against the named surface, so that is the surface
    // the "is the analyzer re-pointed?" question is about.
    namedNames: [...new Set(named)].sort(),
  }
}

interface Damage { damaged: number; err: number; missing: number; clean: number; multiset: Record<string, number> }

function damageOf(tree: any): Damage {
  let err = 0, missing = 0
  const multiset: Record<string, number> = {}
  const walk = (n: any): void => {
    const t = n.type
    multiset[t] = (multiset[t] ?? 0) + 1
    if (n.isError) err++
    if (n.isMissing) missing++
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(tree.rootNode)
  return { damaged: err + missing > 0 ? 1 : 0, err, missing, clean: err + missing === 0 ? 1 : 0, multiset }
}

await TSParser.init({ locateFile: () => join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })

async function load(p: string): Promise<any> { return Language.load(readFileSync(p)) }

const report: any = {
  tool: "powershell-grammar-ab",
  lane: "powershell",
  issue: "#278",
  generatedBy: "script/m60/powershell-grammar-ab.ts",
  candidate: { label: LABEL, path: NEW, sha256: NEW ? sha256(readFileSync(NEW)) : null, bytes: NEW ? readFileSync(NEW).length : null },
  wired: { path: WIRED, sha256: sha256(readFileSync(WIRED)), bytes: readFileSync(WIRED).length },
  method:
    "Corpora: the production (non-test) tracked .ps1/.psm1/.psd1 files of powershell and ansible, drawn by a hash of `repo/relative-path` (unbiased, reproducible) with the digest recorded per repo so a re-run that drew a different set says so rather than being compared. `powershell`' test/ tree is excluded because it is parser-error TEST DATA, not a corpus. Damage is measured with a parser loaded directly from the wasm under test, so it is the GRAMMAR's number and no analyzer decision can move it. Q3 (no collateral) is the deciding question and is checked as a file SET, not a spot check. Q4 compares the node-type multiset over each corpus. Q5 is the id-order digest from M49 W19, because a rebuild's sha256 is not a function of its source across toolchain versions. --rebuild answers Q1: whether the vendored source reproduces the WIRED behaviour, without which no patch on that source is attributable to the wired grammar.",
}

if (!NEW) { console.log("usage: --new <candidate.wasm> [--rebuild <wired-rebuild.wasm>] [--label <name>] [--out <path>]"); process.exit(2) }

const langs: Record<string, any> = { wired: await load(WIRED), new: await load(NEW) }
if (REBUILD) langs.rebuild = await load(REBUILD)

const surfaces: Record<string, Surface> = {}
for (const [k, g] of Object.entries(langs)) surfaces[k] = surfaceOf(g)
const sb = surfaces.wired, sn = surfaces.new

console.log(`candidate: ${LABEL}`)
console.log(`  wired  sha ${report.wired.sha256.slice(0, 16)}  ${report.wired.bytes} bytes`)
console.log(`  new    sha ${report.candidate.sha256?.slice(0, 16)}  ${report.candidate.bytes} bytes`)
console.log("")
console.log("SURFACE")
console.log(`  wired  ids=${sb.ids} named=${sb.named} anon=${sb.anon} fields=${sb.fields}  idOrder=${sb.idOrder.slice(0, 12)}`)
console.log(`  new    ids=${sn.ids} named=${sn.named} anon=${sn.anon} fields=${sn.fields}  idOrder=${sn.idOrder.slice(0, 12)}`)
if (REBUILD) {
  const sr = surfaces.rebuild
  const rebuildSha = sha256(readFileSync(REBUILD))
  const byteIdenticalToWired = rebuildSha === report.wired.sha256
  const idOrderMatchesWired = sr.idOrder === sb.idOrder
  const typeSetMatchesWired = sr.typeSet === sb.typeSet
  console.log(`  rebuild ids=${sr.ids} named=${sr.named} anon=${sr.anon} fields=${sr.fields}  idOrder=${sr.idOrder.slice(0, 12)}`)
  report.q1_reproduce = {
    rebuildSha256: rebuildSha,
    bytes: readFileSync(REBUILD).length,
    byteIdenticalToWired,
    idOrderMatchesWired,
    typeSetMatchesWired,
    fieldsMatchWired: sr.fieldSet === sb.fieldSet,
    namedSurfaceMatchesWired: JSON.stringify(sr.namedNames) === JSON.stringify(sb.namedNames),
    verdict: byteIdenticalToWired
      ? "the vendored source rebuilds to the wired wasm BYTE-FOR-BYTE: the strongest provenance in this registry"
      : idOrderMatchesWired && typeSetMatchesWired
        ? "the vendored source rebuilds to the wired wasm's id order and type set: patching THIS source is patching the wired grammar"
        : "the vendored source does NOT reproduce the wired wasm: a patch on it is a patch on something else and its numbers are unattributable",
  }
  console.log("")
  console.log("Q1 REPRODUCE (does the vendored source reproduce the wired wasm?)")
  const q1 = report.q1_reproduce
  console.log(`  bytes identical: ${q1.byteIdenticalToWired}   id-order matches: ${q1.idOrderMatchesWired}   type-set matches: ${q1.typeSetMatchesWired}`)
  console.log(`  -> ${q1.verdict}`)
}

const onlyNew = sn.allNames.filter((n) => !sb.allNames.includes(n))
const onlyWired = sb.allNames.filter((n) => !sn.allNames.includes(n))
const namedOnlyNew = sn.namedNames.filter((n) => !sb.namedNames.includes(n))
const namedOnlyWired = sb.namedNames.filter((n) => !sn.namedNames.includes(n))
report.q4_shapeDelta = {
  candidateOnlyTypes: onlyNew, wiredOnlyTypes: onlyWired,
  namedCandidateOnly: namedOnlyNew,
  namedWiredOnly: namedOnlyWired,
  fieldSetMatches: sn.fieldSet === sb.fieldSet,
  idOrderMatches: sn.idOrder === sb.idOrder,
  namedVocabularyUnchanged: namedOnlyNew.length + namedOnlyWired.length === 0,
}
console.log("")
console.log("Q4 SHAPE DELTA (the analyzer must not be silently re-pointed)")
console.log(`  types only in candidate (${onlyNew.length}): ${onlyNew.join(", ") || "(none)"}`)
console.log(`  types only in wired     (${onlyWired.length}): ${onlyWired.join(", ") || "(none)"}`)
console.log(`  NAMED vocabulary: ${report.q4_shapeDelta.namedVocabularyUnchanged ? `UNCHANGED (${sn.named} named types, identical set)` : `CHANGED (+${namedOnlyNew.join(",") || "none"} / -${namedOnlyWired.join(",") || "none"})`} — the analyzer's vocabulary is ${report.q4_shapeDelta.namedVocabularyUnchanged ? "safe" : "RE-POINTED"}`)
if (onlyNew.length && !namedOnlyNew.length) console.log(`  (the ${onlyNew.length} added types are all ANONYMOUS internal rules, so the analyzer sees no new node type)`)

report.q2_netWin = []
report.q3_collateral = []
let anyCollateral = false

for (const repo of REPOS) {
  const rels = draw(repo)
  if (rels.length === 0) { console.log(`\n${repo}: corpus absent — skipped`); continue }
  const digest = sha256(rels.join("\n"))
  const acc: Record<string, { d: Damage; rels: string[] }> = { wired: { d: { damaged: 0, err: 0, missing: 0, clean: 0, multiset: {} }, rels: [] }, new: { d: { damaged: 0, err: 0, missing: 0, clean: 0, multiset: {} }, rels: [] } }
  const parsers: Record<string, TSParser> = { wired: new TSParser(), new: new TSParser() }
  parsers.wired.setLanguage(langs.wired); parsers.new.setLanguage(langs.new)

  for (const rel of rels) {
    let src = ""
    try { src = readFileSync(join(CORPUS_ROOT, repo, rel), "utf8") } catch { continue }
    for (const which of ["wired", "new"] as const) {
      const t = parsers[which].parse(src)
      if (!t) continue
      const d = damageOf(t)
      acc[which].d.damaged += d.damaged; acc[which].d.err += d.err; acc[which].d.missing += d.missing; acc[which].d.clean += d.clean
      for (const [k, v] of Object.entries(d.multiset)) acc[which].d.multiset[k] = (acc[which].d.multiset[k] ?? 0) + v
      acc[which].rels.push(rel)
      t.delete?.()
    }
  }
  for (const p of Object.values(parsers)) p.delete?.()

  const w = acc.wired.d, n = acc.new.d
  const before = new Set(acc.wired.rels), after = new Set(acc.new.rels)
  const fixed = [...before].filter((f) => !acc.new.rels.includes(f))
  const broke = [...after].filter((f) => !acc.wired.rels.includes(f))
  if (broke.length) anyCollateral = true

  console.log("")
  console.log(`${repo}: ${rels.length} production files, draw ${digest.slice(0, 12)}`)
  console.log(`  Q2 damaged ${w.damaged} -> ${n.damaged}   (ERROR ${w.err}->${n.err}, MISSING ${w.missing}->${n.missing})   fixed ${fixed.length}, broke ${broke.length}`)

  // The multiset delta over the corpus: the shape question at corpus scale.
  const keys = new Set([...Object.keys(w.multiset), ...Object.keys(n.multiset)])
  const deltas = [...keys].map((k) => ({ type: k, wired: w.multiset[k] ?? 0, next: n.multiset[k] ?? 0 })).filter((d) => d.wired !== d.next)
  deltas.sort((a, b) => Math.abs(b.next - b.wired) - Math.abs(a.next - a.wired))

  report.q2_netWin.push({ repo, files: rels.length, drawDigest: digest, wired: { damaged: w.damaged, err: w.err, missing: w.missing }, candidate: { damaged: n.damaged, err: n.err, missing: n.missing }, fixed: fixed.length, broke: broke.length, fixedFiles: fixed.slice(0, 40), brokeFiles: broke.slice(0, 40) })
  report.q3_collateral.push({ repo, brokeFiles: broke.slice(0, 60), count: broke.length })
  report.q4_shapeDelta.corpusMultisetDelta = report.q4_shapeDelta.corpusMultisetDelta ?? []
  report.q4_shapeDelta.corpusMultisetDelta.push({ repo, deltas: deltas.slice(0, 25), deltaCount: deltas.length })
  if (deltas.length) console.log(`  Q4 corpus node-multiset changed on ${deltas.length} types; top: ${deltas.slice(0, 5).map((d) => `${d.type} ${d.wired}->${d.next}`).join(", ")}`)
  if (fixed.length) console.log(`     fixed: ${fixed.slice(0, 3).join(", ")}${fixed.length > 3 ? ` (+${fixed.length - 3})` : ""}`)
  if (broke.length) console.log(`     BROKE: ${broke.slice(0, 3).join(", ")}${broke.length > 3 ? ` (+${broke.length - 3})` : ""}`)
}

report.verdict = anyCollateral
  ? "REJECTED — collateral: files that parsed cleanly under the wired grammar are damaged under the candidate"
  : "no collateral; read q2_netWin for the net effect"
console.log("")
console.log(`VERDICT: ${report.verdict}`)

if (OUT) { writeFileSync(OUT, JSON.stringify(report, null, 2)); console.log(`\nwrote ${OUT}`) }
