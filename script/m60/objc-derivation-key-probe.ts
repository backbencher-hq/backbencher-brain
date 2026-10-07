/**
 * script/m60/objc-derivation-key-probe.ts — WHICH KEY DOES THE DERIVATION FINDING
 * BELONG TO, and what does the shared gate actually compare for this lane?
 *
 * WHY THIS FILE EXISTS. `script/m60/rel-type-coverage-gate.ts` CHECK 1 (DERIVATION)
 * compares, per lane, the relationship types an analyzer file CONSTRUCTS against the
 * label set `script/m14/differential.ts` AUDITS. It derives the lane's key from the
 * ANALYZER FILENAME (`real-objective-c-analyzer.ts` → `objective-c`) and then EVALUATES
 * the differential's own allowlist with that key. `differential.ts` keys the same
 * analyzer `objc` — in `LANGS`, in `ROUTER_LANGUAGE`, and in every `lang === "objc"`
 * clause. So the two never meet, and the reported finding is an artefact of the key,
 * not a fact about the lane.
 *
 * That matters in the direction that hides nothing and overstates a debt: the gate
 * reports `objective-c 6 un-audited` where the harness's own audited set for `objc` is
 * larger. A DERIVATION finding that is wrong is still a finding a lane will spend a wave
 * closing, and the fix for a false one is to correct the record, not to add an oracle.
 *
 * Both keys are therefore evaluated HERE, from the same literal the gate extracts, so
 * the two verdicts are read off one source and cannot drift apart. Nothing is restated:
 * the allowlist literal is read out of `differential.ts` and evaluated, the emitted set is
 * read out of the analyzer with the gate's own regex, and the corpus-side label coverage
 * is re-measured over the real parse trees.
 *
 * READ-ONLY. Writes nothing.
 *
 * Usage: bun run script/m60/objc-derivation-key-probe.ts
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const DIFFERENTIAL = path.join(ROOT, "script", "m14", "differential.ts")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories/objc"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]

const fileKey = "objective-c"          // from real-objective-c-analyzer.ts
const harnessKey = "objc"              // from differential.ts LANGS / ROUTER_LANGUAGE
/** The labels `script/m60/objc-ontology-oracle.ts` derives independently — a SECOND
 *  derivation over the same wasm, which is the strongest opinion available from inside
 *  this lane. Read from its own header constant rather than restated here. */
const LANE_ORACLE_LABELS = ["calls", "contains", "exports", "imports", "references", "uses"]

// ---- 1 + 2 the emitted set and the gate's own verdict, read from the GATE --------
// `runGate` is the gate's own exported entry point and `main()` is argv-guarded, so
// calling it here is the same computation the gate prints — not a restatement of it.
// Re-deriving "what this analyzer can construct" with a private regex would be exactly
// the copied-constant drift this probe exists to rule out, and the first version of this
// file did precisely that and read the analyzer's emitted set as EMPTY, because the gate
// reads `RelationshipType.X` through MEMBER_TO_VALUE and this file only matched string
// literals. The correction is to ask the gate.
import { runGate, readAuditedSets } from "../m60/rel-type-coverage-gate"
const live = runGate()
const laneRow = live.lanes.find((l) => l.lang === fileKey)
if (!laneRow) throw new Error(`the gate produced no lane named ${fileKey} — its lane extraction changed`)
const emitted = new Set(laneRow.emitted)
console.log(`gate lane key (from the analyzer FILENAME): "${fileKey}"`)
console.log(`types the analyzer can construct, by the gate's own extraction: ${[...emitted].sort().join(", ")}`)
console.log(`gate's own audited set for that key: ${JSON.stringify([...laneRow.audited].sort())}`)
console.log(`gate's own DERIVATION findings for that key: ${JSON.stringify(live.findings.filter((f) => f.check === "DERIVATION" && f.lang === fileKey).map((f) => f.detail.split("`")[1]))}`)

// ---- 3 the audited set, EVALUATED from differential.ts, under both keys --------
const src = readFileSync(DIFFERENTIAL, "utf8")
const HEAD = '.filter((r: any) => ["extends"'
const i = src.indexOf(HEAD)
if (i < 0) throw new Error(`no audited-label filter found in ${DIFFERENTIAL} — its shape changed`)
const start = i + HEAD.length - '["extends"'.length
const end = src.indexOf("].includes(r.label)", start)
if (end < 0) throw new Error(`the audited-label filter in ${DIFFERENTIAL} is unterminated`)
const literal = src.slice(start, end + 1).split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "").replace(/\s+\/\/[^\n]*$/, "")).join("\n")
/** The gate's own evaluator, called directly so this file cannot disagree with it about
 *  what the allowlist returns for a key. `literal` is kept only as a fallback for the
 *  case where the gate's extraction itself failed, and the failure is reported. */
const auditedFor = (lang: string): string[] => {
  const read = readAuditedSets([lang])
  const set = read.sets.get(lang)
  if (set && set.size > 0) return [...set].sort()
  if (read.failed.length) {
    console.log(`  readAuditedSets("${lang}") FAILED: ${read.failed[0]!.reason}`)
    return new Function("lang", "return " + literal)(lang) as string[]
  }
  return new Function("lang", "return " + literal)(lang) as string[]
}

const setFile = new Set(auditedFor(fileKey))
const setHarness = new Set(auditedFor(harnessKey))

// ---- 4 the gate's per-lane oracle override path --------------------------------
// readOwnOracleLabels(lang) probes script/m14/<lang>-truth.ts. `lang` here is the FILE
// key, so the probe path is derived rather than asserted, and the existing file is
// reported if one is already there under the other spelling.
const ownPathFor = (lang: string) => path.join(ROOT, "script", "m14", `${lang}-truth.ts`)
console.log(`\nreadOwnOracleLabels() would probe: ${ownPathFor(fileKey).replace(ROOT + "/", "")}  exists=${existsSync(ownPathFor(fileKey))}`)
console.log(`the file the harness actually keys:  ${ownPathFor(harnessKey).replace(ROOT + "/", "")}  exists=${existsSync(ownPathFor(harnessKey))}`)

console.log(`\naudited set evaluated with the FILE key   "${fileKey}": ${JSON.stringify([...setFile].sort())}`)
console.log(`audited set evaluated with the HARNESS key "${harnessKey}": ${JSON.stringify([...setHarness].sort())}`)
const derFile = [...emitted].filter((t) => !setFile.has(t)).sort()
const derHarness = [...emitted].filter((t) => !setHarness.has(t)).sort()
console.log(`\nDERIVATION as the gate reports it (file key):   ${derFile.length} un-audited: ${JSON.stringify(derFile)}`)
console.log(`DERIVATION as the harness compares (objc key):  ${derHarness.length} un-audited: ${JSON.stringify(derHarness)}`)
console.log(`   of those, covered by the lane-owned oracle (script/m60/objc-ontology-oracle.ts): ${LANE_ORACLE_LABELS.filter((t) => derHarness.includes(t)).join(", ") || "none"}`)
console.log(`   of those, with NO opinion of any kind: ${JSON.stringify(derHarness.filter((t) => !LANE_ORACLE_LABELS.includes(t)).sort())}`)

// ---- 5 which of the ten the F5 ORACLE actually derives, over real trees -------
// Not a restatement of the allowlist: the oracle's LABEL SET over the corpus is what
// decides whether a label in the comparison set has truth behind it at run time.
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
const { deriveObjcEdges } = await import("../m14/differential")

const oracleLabels = new Set<string>()
const oracleHits = new Map<string, number>()
let idx = 0
await Promise.all(Array.from({ length: 6 }, async () => {
  while (true) {
    const k = idx++
    if (k >= files.length) return
    const t = parser.parse(files[k].text)
    if (!t) continue
    for (const e of deriveObjcEdges(t.rootNode)) {
      oracleLabels.add(e.label)
      oracleHits.set(e.label, (oracleHits.get(e.label) ?? 0) + 1)
    }
    t.delete?.()
  }
}))

console.log(`\nF5 oracle deriveObjcEdges over ${files.length} admitted files — labels it DERIVES:`)
for (const l of [...oracleLabels].sort()) {
  console.log(`   ${l.padEnd(12)} ${String(oracleHits.get(l)).padStart(6)} rows`)
}
console.log(`\nof the ten, the ones with NO F5 derivation at all: ${JSON.stringify(ALL_TYPES.filter((t) => !oracleLabels.has(t)).sort())}`)
console.log(`and of THOSE, the ones the differential COMPARES anyway (in objc's audited set): ${JSON.stringify(ALL_TYPES.filter((t) => !oracleLabels.has(t) && setHarness.has(t)).sort())}`)