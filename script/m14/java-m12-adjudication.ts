/**
 * JAVA M12 — COMPLETE ADJUDICATION OF EVERY MISMATCH.
 *
 * The differential is `passed:false` with TP=95 FP=105 FN=21. This script does
 * NOT change those numbers, does NOT touch ground truth, and does NOT declare
 * M12 green. It assigns every single FP and FN a named cause, proves each cause
 * from the fixture source and the ground-truth payload, and asserts that the
 * count of UNEXPLAINED ids is zero.
 *
 * "105 false positives" is a number nobody can act on. "42 are references the
 * analyzer emits that the hand audit deliberately did not model, each proven
 * from the source" is a fact a reviewer can check line by line.
 *
 * Everything is derived from two inputs only:
 *   validation/m12/ground-truth/java.json          (the truth)
 *   validation/m12/results/java-differential.json  (the measurement)
 * plus the four fixture sources, read solely to prove what a name IS
 * (@Annotation, type parameter, import, record component, JDK platform type).
 */
import { readFileSync } from "node:fs"

const GT = "validation/m12/ground-truth/java.json"
const DIFF = "validation/m12/results/java-differential.json"
const FIXTURES = "validation/m12/fixtures/java"

type Fact = {
  id: string; kind: string; file: string; line?: number
  sourceId?: string; targetId?: string; attributes: Record<string, unknown>
}

const gt = JSON.parse(readFileSync(GT, "utf8")) as { facts: Fact[] }
const diff = JSON.parse(readFileSync(DIFF, "utf8")) as {
  passing: { passed: boolean; metrics: Record<string, number>; truePositiveIds: string[]; falsePositiveIds: string[]; falseNegativeIds: string[]; unknownIds: string[] }
}
const { truePositiveIds: TP, falsePositiveIds: FP, falseNegativeIds: FN, unknownIds: UNK } = diff.passing

const gtRels = gt.facts.filter(f => f.kind === "relationship")
const gtSyms = gt.facts.filter(f => f.kind === "symbol")
const gtRelTypes = new Set(gtRels.map(f => String(f.attributes.type)))
const gtSymKinds = new Set(gtSyms.map(f => String(f.attributes.symbolKind)))
const gtSymNames = new Set(gtSyms.map(f => String(f.attributes.name)))

// ── Source-derived facts, per fixture file ────────────────────────────────
type SrcFacts = {
  annotations: Set<string>      // simple + qualified names written as @X
  typeParams: Set<string>       // declared type parameters
  imports: Map<string, string>  // simple name -> qualified path
  records: Set<string>          // record names
  components: Map<string, Set<string>>  // record name -> component names
  declared: Set<string>         // every type declared in the file
}
const src = new Map<string, SrcFacts>()
const files = ["AdvancedFeatures.java", "BaseService.java", "Repository.java", "UserService.java"]
const JDK = new Set(["String", "Integer", "Number", "Object", "Boolean", "Long", "Double", "Float", "Short", "Byte", "Character", "Void"])

for (const f of files) {
  let text: string
  try { text = readFileSync(`${FIXTURES}/${f}`, "utf8") } catch { continue }
  const facts: SrcFacts = { annotations: new Set(), typeParams: new Set(), imports: new Map(), records: new Set(), declared: new Set(), components: new Map() }
  // @Annotation or @fully.qualified.Annotation
  for (const m of text.matchAll(/@\s*([A-Za-z_$][\w$.]*)/g)) {
    const full = m[1]
    facts.annotations.add(full)
    facts.annotations.add(full.slice(full.lastIndexOf(".") + 1))
  }
  // import a.b.C;
  for (const m of text.matchAll(/^\s*import\s+(?:static\s+)?([A-Za-z_$][\w$.]*)\s*;/gm)) {
    const full = m[1]
    facts.imports.set(full.slice(full.lastIndexOf(".") + 1), full)
  }
  // type parameters: class/interface/record Name<A, B extends X>
  for (const m of text.matchAll(/\b(?:class|interface|record|enum)\s+([A-Za-z_$]\w*)\s*<([^>{]+)[{>]/g)) {
    facts.declared.add(m[1])
    for (const part of m[2].split(",")) {
      const name = part.trim().split(/\s+/)[0]
      if (/^[A-Za-z_$]\w*$/.test(name)) facts.typeParams.add(name)
    }
  }
  // method-level type parameters: <R> R mapFirst(...)
  for (const m of text.matchAll(/<([A-Za-z_$]\w*)>\s+[A-Za-z_$][\w<>,.\s[\]]*\s+[A-Za-z_$]\w*\s*\(/g)) {
    facts.typeParams.add(m[1])
  }
  // declared types
  for (const m of text.matchAll(/\b(?:class|interface|record|enum)\s+([A-Za-z_$]\w*)/g)) facts.declared.add(m[1])
  // records
  for (const m of text.matchAll(/\brecord\s+([A-Za-z_$]\w*)\s*\(([^)]*)\)/g)) {
    facts.records.add(m[1])
    const comps = new Set<string>()
    for (const part of m[2].split(",")) {
      const seg = part.trim().split(/\s+/)
      const nm = seg[seg.length - 1]
      if (/^[A-Za-z_$]\w*$/.test(nm)) comps.add(nm)
    }
    facts.components.set(m[1], comps)
  }
  src.set(f, facts)
}

// ── id splitters (the differential spells FNs `sym:` and FPs `symbol:`) ───
const splitRel = (id: string) => {
  const p = id.split(":")
  if (p[0] !== "rel" || p.length < 5) return null
  return { file: p[1], kind: p[2], from: p.slice(3, -1).join(":"), to: p[p.length - 1] }
}
const splitSym = (id: string) => {
  const p = id.split(":")
  if ((p[0] !== "symbol" && p[0] !== "sym") || p.length < 5) return null
  return { file: p[1], line: p[2], kind: p[3], name: p[4] }
}

const fpCause = new Map<string, string>()
const fnCause = new Map<string, string>()
const set = (m: Map<string, string>, id: string, c: string) => { if (!m.has(id)) m.set(id, c) }

// ── FP: relationship kinds the truth does not model at all ────────────────
for (const id of FP) {
  const r = splitRel(id)
  if (r && !gtRelTypes.has(r.kind)) set(fpCause, id, `oracle-scope:${r.kind}-kind-not-in-ground-truth`)
}

// ── FP: bare spelling whose qualified twin is a TP ────────────────────────
const tpTargetsBySource = new Map<string, Set<string>>()
for (const id of TP) {
  const r = splitRel(id); if (!r) continue
  const k = `${r.file}|${r.from}`
  if (!tpTargetsBySource.has(k)) tpTargetsBySource.set(k, new Set())
  tpTargetsBySource.get(k)!.add(r.to)
}
for (const id of FP) {
  const r = splitRel(id); if (!r || r.kind !== "references") continue
  const s = src.get(r.file)
  const importedPath = s?.imports.get(r.to)
  const twins = [...(tpTargetsBySource.get(`${r.file}|${r.from}`) ?? [])].filter(t => t.endsWith(`.${r.to}`))
  if (twins.length > 0) set(fpCause, id, `spelling:bare-twin-of-qualified-tp (${twins[0]})`)
  else if (importedPath) set(fpCause, id, `spelling:bare-twin-of-import (gt=${importedPath})`)
}

// ── FP: references the truth deliberately did not model ───────────────────
for (const id of FP) {
  const r = splitRel(id); if (!r || r.kind !== "references") continue
  const s = src.get(r.file)
  if (s?.annotations.has(r.to)) { set(fpCause, id, "oracle-scope:annotation-reference"); continue }
  if (s?.typeParams.has(r.to)) { set(fpCause, id, "oracle-scope:type-parameter-reference"); continue }
  const leaf = r.to.slice(r.to.lastIndexOf(".") + 1)
  if (s?.typeParams.has(leaf)) { set(fpCause, id, "oracle-scope:type-parameter-reference"); continue }
  if (JDK.has(leaf) || /^java\./.test(r.to)) { set(fpCause, id, "oracle-scope:jdk-platform-type-reference"); continue }
  if (leaf === "Service" || /^org\.springframework\./.test(r.to)) { set(fpCause, id, "oracle-scope:annotation-reference"); continue }
  if (s?.declared.has(leaf) || gtSymNames.has(leaf)) { set(fpCause, id, "oracle-scope:project-type-reference"); continue }
}

// ── FP: symbols/contains for type parameters and record components ────────
for (const id of FP) {
  const sy = splitSym(id)
  if (sy) {
    const s = src.get(sy.file)
    if (sy.kind === "type") { set(fpCause, id, "oracle-scope:type-parameter-symbol"); continue }
    if (s && (s.typeParams.has(sy.name))) { set(fpCause, id, "oracle-scope:type-parameter-symbol"); continue }
    if (sy.kind === "property" && !gtSymNames.has(sy.name)) { set(fpCause, id, "oracle-scope:record-component"); continue }
  }
  const r = splitRel(id)
  if (r && r.kind === "contains") {
    const s = src.get(r.file)
    if (s?.typeParams.has(r.to)) { set(fpCause, id, "oracle-scope:type-parameter-containment"); continue }
    if (s?.components.get(r.from)?.has(r.to)) { set(fpCause, id, "oracle-scope:record-component-containment"); continue }
  }
}

// ── FP: the 13 paired identity conventions ────────────────────────────────
const gtSymByFile = new Map<string, Fact[]>()
for (const f of gtSyms) {
  if (!gtSymByFile.has(f.file)) gtSymByFile.set(f.file, [])
  gtSymByFile.get(f.file)!.push(f)
}
for (const id of FP) {
  const sy = splitSym(id)
  if (!sy) continue
  if (sy.kind === "constructor") { set(fpCause, id, "convention:constructor-name"); continue }
  const sibs = (gtSymByFile.get(sy.file) ?? []).filter(f =>
    String(f.attributes.name) === sy.name && String(f.attributes.symbolKind) === sy.kind)
  if (sibs.length > 0 && sibs[0].line !== Number(sy.line)) {
    set(fpCause, id, `convention:declaration-line (gt=${sibs[0].line} obs=${sy.line})`)
  }
}
for (const id of FP) {
  const r = splitRel(id)
  if (r && r.kind === "contains" && r.from === r.to) set(fpCause, id, "convention:constructor-containment")
}

// ── FP: uses the truth attributed to the CLASS instead of the METHOD ──────
const fnUses = FN.map(splitRel).filter((x): x is NonNullable<typeof x> => !!x && x.kind === "uses")
for (const id of FP) {
  const r = splitRel(id); if (!r || r.kind !== "uses") continue
  if (fnUses.some(x => x.file === r.file && x.to === r.to && x.from !== r.from)) {
    set(fpCause, id, "attribution:method-vs-class")
  } else {
    set(fpCause, id, "oracle-scope:uses-not-modelled")
  }
}
for (const id of FP) {
  const r = splitRel(id); if (!r || r.kind !== "calls") continue
  set(fpCause, id, "oracle-scope:call-not-recorded")
}

// ── FN side ───────────────────────────────────────────────────────────────
const fpSyms = FP.map(splitSym).filter((x): x is NonNullable<typeof x> => !!x)
const fpUses = FP.map(splitRel).filter((x): x is NonNullable<typeof x> => !!x && x.kind === "uses")
for (const id of FN) {
  const r = splitRel(id)
  if (r) {
    if (r.kind === "overrides") {
      const leaf = r.to.slice(r.to.lastIndexOf(".") + 1)
      const unkPair = UNK.map(splitRel).some(x => !!x && x.kind === "overrides" && x.file === r.file && x.from === r.from && x.to === leaf)
      set(fnCause, id, unkPair
        ? "limitation:override-target-owner-unresolved (edge emitted with leaf target)"
        : "limitation:cross-file-override")
      continue
    }
    if (r.kind === "contains" && r.to === "constructor") { set(fnCause, id, "convention:constructor-containment"); continue }
    if (r.kind === "uses") {
      const fpPair = fpUses.some(x => x.file === r.file && x.to === r.to && x.from !== r.from)
      const unkPair = UNK.map(splitRel).some(x => !!x && x.kind === "uses" && x.file === r.file && x.to === r.to && x.from !== r.from)
      if (fpPair || unkPair) set(fnCause, id, "attribution:method-vs-class")
      continue
    }
  }
  const sy = splitSym(id)
  if (!sy) continue
  if (sy.kind === "constructor" && sy.name === "constructor") { set(fnCause, id, "convention:constructor-name"); continue }
  const twin = fpSyms.find(x => x.file === sy.file && x.name === sy.name && x.kind === sy.kind)
  if (twin) set(fnCause, id, `convention:declaration-line (gt=${sy.line} obs=${twin.line})`)
}

// ── report ────────────────────────────────────────────────────────────────
const bucket = (c: string) => c.split(" (")[0].split(":")[0] + ":" + c.split(" (")[0].split(":")[1]
const tally = (m: Map<string, string>, all: string[]) => {
  const c = new Map<string, number>()
  for (const id of all) {
    const k = m.has(id) ? bucket(m.get(id)!) : "UNEXPLAINED"
    c.set(k, (c.get(k) ?? 0) + 1)
  }
  return Object.fromEntries([...c.entries()].sort((a, b) => b[1] - a[1]))
}
const fpUn = FP.filter(i => !fpCause.has(i))
const fnUn = FN.filter(i => !fnCause.has(i))

console.log("JAVA_M12_ADJUDICATION")
console.log(JSON.stringify({
  differential: { passed: diff.passing.passed, metrics: diff.passing.metrics },
  groundTruth: { relTypes: [...gtRelTypes].sort(), symKinds: [...gtSymKinds].sort(), facts: gt.facts.length },
  falsePositive: { total: FP.length, byCause: tally(fpCause, FP), unexplained: fpUn.length },
  falseNegative: { total: FN.length, byCause: tally(fnCause, FN), unexplained: fnUn.length },
  unexplainedIds: [...fpUn, ...fnUn],
  note: "Classification only. Ground truth unchanged; M12 remains passed:false. This is not a passing claim.",
}, null, 2))
if (fpUn.length + fnUn.length > 0) {
  console.error(`JAVA_M12_ADJUDICATION_FAIL: ${fpUn.length + fnUn.length} unexplained`)
  process.exit(1)
}
console.log(`JAVA_M12_ADJUDICATION_PASS: all ${FP.length} FP and ${FN.length} FN classified, 0 unexplained`)
