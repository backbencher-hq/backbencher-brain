/**
 * script/m60/objc-oracle-divergence.ts — EVERY POINT WHERE THIS LANE AND THE SHARED F5
 * ORACLE DISAGREE, COUNTED.
 *
 * WHY. `script/m14/differential.ts` is the shared harness and this lane does not edit it,
 * but its `deriveObjcEdges` reads the SAME `tree-sitter-objc` wasm and can therefore be
 * wrong in the same way the analyzer was. When that happens the differential reports the
 * analyzer's CORRECT rows as MISSING and the analyzer's refusal as a gap, and the only
 * honest thing a lane can do is count the disagreement and say which side is right —
 * argued in prose it is just a complaint.
 *
 * Two such points exist at this commit, and both are places where the ANALYZER refuses a
 * fabricated endpoint:
 *
 *   1. `instantiates -> self`. `[self alloc]` allocates an instance of the receiver's own
 *      class; the oracle reads the receiver's text unconditionally and publishes the
 *      `self` KEYWORD, a name no file declares. Corrected in the analyzer by OC-ONT-4.
 *   2. `implements -> <type parameter>`. Objective-C spells lightweight generics with the
 *      same token sequence as protocol adoption (`@interface Cache <KeyType, ObjectType>
 *      : Store <KeyType, ObjectType> <CacheProtocol>`); the oracle reads every
 *      `parameterized_arguments` as an adoption list, so it publishes the class's own type
 *      parameters as protocols. Corrected in the analyzer by OC-ONT-6.
 *
 * The oracle's `references` / `calls` / `uses` / `extends` / `implements` branches agree;
 * `objc-ontology-oracle.ts` measures that side, and the census's ORACLE COVERAGE section
 * reports it per label. This file is the OPPOSITE direction: rows the oracle derives that
 * the analyzer does not, and whether each is the analyzer being right.
 *
 * This supersedes the narrower `objc-instantiates-oracle-divergence.ts`, which measured
 * only the first of the two and was deleted rather than left in place as a second
 * instrument claiming part of the same fact.
 *
 * METHOD. Both sides are derived over the SAME retained trees, and compared at EDGE grain
 * (`label|source->target`), not at target grain, because "the oracle derives a target the
 * analyzer never names" cannot distinguish a wrong oracle from a wrong analyzer while
 * "the oracle derives this edge" can.
 *
 * READ-ONLY. Writes nothing.
 *
 * Usage: bun run script/m60/objc-oracle-divergence.ts [--json <path>]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"
import { deriveObjcEdges } from "../m14/differential"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories/objc"

/** The two classes of disagreement, and which side is right in each. Stated as data so
 *  the report is generated from the classification rather than from prose. */
const CLASSES: Record<string, { analyzerIsRight: boolean; why: string }> = {
  "instantiates->self": {
    analyzerIsRight: true,
    why: "`[self alloc]` allocates an instance of the receiver's OWN class. `self` is a keyword; no file declares it and no consumer can resolve it. OC-ONT-4 resolves the target to the enclosing class from the declaration already in hand.",
  },
  "implements->type-parameter": {
    analyzerIsRight: true,
    why: "the target is this class's own lightweight-generic TYPE PARAMETER, not a protocol. OC-ONT-6 selects the adoption list by position, so a type parameter is never published as an adopted protocol.",
  },
}

const files: { label: string; abs: string; dir: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "ls-files", "-z"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "objective-c") continue
    files.push({ label: `${e}/${rel}`, abs, dir, text })
  }
}

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-objc.wasm"))))

/** Every type parameter name this corpus declares, so a protocol-list slot holding one is
 *  recognisable without hardcoding KeyType/ObjectType. */
const TYPE_PARAMS = new Set<string>()
for (const f of files) {
  const t = parser.parse(f.text)
  if (!t) continue
  const kids = (n: any): any[] => { const o: any[] = []; for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) o.push(c) } return o }
  const v = (n: any): void => {
    if (n.type === "class_interface" || n.type === "class_implementation") {
      const ks = kids(n)
      const colonIdx = ks.findIndex((c) => !c.isNamed && c.type === ":")
      if (colonIdx >= 0) {
        for (let i = 0; i < colonIdx; i++) {
          if (ks[i].isNamed && ks[i].type === "parameterized_arguments") {
            for (let p = 0; p < ks[i].namedChildCount; p++) {
              const pn = ks[i].namedChild(p)
              if (pn && ["type_identifier", "identifier", "type_name"].includes(pn.type)) TYPE_PARAMS.add(pn.text)
            }
          }
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) v(c) }
  }
  v(t.rootNode)
  t.delete?.()
}

const classify = (label: string, target: string): string | null => {
  if (label === "instantiates" && (target === "self" || target === "super")) return "instantiates->self"
  if (label === "implements" && TYPE_PARAMS.has(target)) return "implements->type-parameter"
  return null
}

type Row = { file: string; label: string; edge: string; cls: string | null }
const oracleOnly: Row[] = []
const analyzerOnly: Row[] = []
let filesMeasured = 0
let idx = 0
await Promise.all(Array.from({ length: 6 }, async () => {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const tree = parser.parse(f.text)
    if (!tree) continue
    filesMeasured++
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { tree.delete?.(); continue }
    // The oracle emits UNIQUE (label,target) per file and its `from` is the literal
    // "(expr)"; the analyzer's source is a method selector or `root`. So BOTH sides are
    // normalised to `label|target` and compared at that grain per file — the finest grain
    // on which the two are comparable at all. The first version of this file compared the
    // oracle's raw `label|(expr)->target` against a normalised analyzer key, so every
    // `references` row on all 322 files was reported oracle-only: 9,560 rows, of which
    // zero were a disagreement.
    const mine = new Set<string>()
    for (const x of r.relationships ?? []) mine.add(`${String(x.type ?? "")}|${String(x.target ?? "")}`)
    const theirs = new Set<string>()
    for (const e of deriveObjcEdges(tree.rootNode)) theirs.add(`${e.label}|${e.target}`)
    tree.delete?.()
    for (const k of theirs) if (!mine.has(k)) {
      const [label, t2] = k.split("|")
      oracleOnly.push({ file: f.label, label: label ?? "", edge: k, cls: classify(label ?? "", t2 ?? "") })
    }
    for (const k of mine) if (!theirs.has(k)) {
      const [label, t2] = k.split("|")
      analyzerOnly.push({ file: f.label, label: label ?? "", edge: k, cls: classify(label ?? "", t2 ?? "") })
    }
  }
}))

console.log(`OBJECTIVE_C — analyzer vs deriveObjcEdges, ${filesMeasured} files`)
console.log(`oracle-only rows: ${oracleOnly.length}   analyzer-only rows: ${analyzerOnly.length}`)
console.log(`  (grain: (label,target) per file. The oracle's \`from\` is the literal "(expr)" and the`)
console.log(`   analyzer's is a method selector, so no finer comparison is defined between them.)\n`)

const buckets = new Map<string, Row[]>()
for (const r of oracleOnly) {
  const k = r.cls ?? "UNCLASSIFIED"
  const a = buckets.get(k) ?? []
  a.push(r)
  buckets.set(k, a)
}
console.log(`oracle-only rows by class:`)
for (const [k, rows] of [...buckets].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n  ${k}: ${rows.length} rows`)
  console.log(`     analyzer is right: ${CLASSES[k]?.analyzerIsRight ?? "NOT CLASSIFIED — investigate"}`)
  if (CLASSES[k]) console.log(`     ${CLASSES[k]!.why}`)
  const filesSeen = new Set<string>()
  for (const r of rows) {
    if (filesSeen.has(r.file)) continue
    filesSeen.add(r.file)
    if (filesSeen.size <= 6) console.log(`     e.g. ${r.file}  ${r.edge}`)
  }
  console.log(`     files: ${filesSeen.size}`)
}
console.log(`\nanalyzer-only rows by label (a first-order sanity check, not a defect list — the`)
console.log(`two derivations have different SCOPE, and script/m60/objc-ontology-oracle.ts states`)
console.log(`where each side's scope is narrower):`)
const ao = new Map<string, number>()
for (const r of analyzerOnly) ao.set(r.label, (ao.get(r.label) ?? 0) + 1)
for (const [k, v] of [...ao].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(14)} ${v}`)
const aoCls = new Map<string, number>()
for (const r of analyzerOnly) if (r.cls) aoCls.set(r.cls, (aoCls.get(r.cls) ?? 0) + 1)
if (aoCls.size) {
  console.log(`\nanalyzer-only rows that are the analyzer RESOLVING what the oracle left raw:`)
  for (const [k, v] of [...aoCls].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(30)} ${v}`)
}

const j = process.argv.indexOf("--json")
if (j > 0 && process.argv[j + 1]) {
  writeFileSync(process.argv[j + 1], JSON.stringify({
    at: new Date().toISOString(), files: filesMeasured,
    oracleOnlyTotal: oracleOnly.length,
    oracleOnlyByClass: Object.fromEntries([...buckets].map(([k, v]) => [k, { rows: v.length, files: new Set(v.map((r) => r.file)).size, analyzerIsRight: CLASSES[k]?.analyzerIsRight ?? null, why: CLASSES[k]?.why ?? null, sample: v.slice(0, 5).map((r) => `${r.file} ${r.edge}`) }])),
    analyzerOnlyByLabel: Object.fromEntries(ao),
    typeParameterNames: [...TYPE_PARAMS].sort(),
  }, null, 2))
  console.log(`\nwrote ${process.argv[j + 1]}`)
}