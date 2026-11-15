// Which lanes need a `contains` oracle, and which ALREADY HAVE ONE?
//
// The sweep has now found the same shape three times — typescript (846 lines, zero
// consumers), clojure (three oracles, wired only to a tmp gate), dart (none, so a
// new one was written). Writing a new oracle when one already exists is wasted work,
// and leaving an existing one unwired is a blind spot. So this classifies all 34
// lanes on both axes at once:
//
//   A. does the lane emit `contains`?
//   B. is `contains` admitted by the differential allowlist?
//   C. does a `contains` truth function already exist in the repo?
//   D. is that function actually WIRED into differential.ts?
//
// The four combinations that matter:
//   emits + unadmitted + oracle exists + wired   -> impossible; the gap is elsewhere
//   emits + unadmitted + oracle exists + NOT wired -> WIRE IT (cheapest possible fix)
//   emits + unadmitted + no oracle                -> write one
//   emits + unadmitted + oracle exists in tmp only -> wire from tmp into the lane
//
// `wired` is measured by searching differential.ts for the function NAME, not by
// trusting an import list, because typescript's oracles were imported by nobody.

import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const DIFF = fs.readFileSync(path.join(ROOT, "script/m14/differential.ts"), "utf8")

// every exported truth function in the repo that could derive containment
const oracleFiles: string[] = []
for (const dir of [path.join(ROOT, "script/m14"), path.join(ROOT, "script/m14/oracles")]) {
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".ts")) continue
    if (f.startsWith("verify-")) continue
    oracleFiles.push(path.join(dir, f))
  }
}

interface Oracle { fn: string; file: string; lane: string; wired: boolean }
const oracles: Oracle[] = []
for (const file of oracleFiles) {
  const src = fs.readFileSync(file, "utf8")
  const re = /^export function ([A-Za-z0-9_]*(?:Contains|Containment)[A-Za-z0-9_]*)/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const fn = m[1]
    // the file's lane, for display: real-<lane>-analyzer or a lane-named file
    // Infer the lane from the FILE name, stripping the role suffix. The first draft
    // used the whole basename, so `zig-truth` did not match lane `zig` and the triage
    // reported zig as "no oracle exists" while deriveZigContainment sat unwired in
    // that very file — the instrument repeating the mistake it was built to find.
    let base = path.basename(file, ".ts")
    if (base.startsWith("real-")) base = base.replace(/^real-/, "").replace(/-analyzer$/, "")
    else base = base.replace(/-(truth|contains|containment|oracle|edges|diff)(-[a-z]+)*$/, "")
    const lane = base
    oracles.push({ fn, file: path.relative(ROOT, file), lane, wired: DIFF.includes(fn) })
  }
}

// which lanes exist, and does each admit contains?
const LANGS_BLOCK = DIFF.match(/export const LANGS: Record<string, \{[^}]*\}> = \{([\s\S]*?)\n\}/)
const LANGS = new Set<string>()
if (LANGS_BLOCK) {
  for (const line of LANGS_BLOCK[1].split("\n")) {
    const e = line.match(/^\s*([a-z0-9]+):\s*\{/)
    if (e) LANGS.add(e[1])
  }
}
// extract + evaluate the allowlist, as verify-label-coverage does
const MARK = '.filter((r: any) => ["extends", "implements", "instantiates"'
const at = DIFF.indexOf(MARK)
const bodyStart = DIFF.indexOf("=>", at) + 2
let depth = 0
let inStr: string | null = null
let inLine = false
let inBlock = false
let end = -1
for (let i = bodyStart; i < DIFF.length; i++) {
  const c = DIFF[i]
  const n = DIFF[i + 1]
  if (inLine) { if (c === "\n") inLine = false; continue }
  if (inBlock) { if (c === "*" && n === "/") { inBlock = false; i++ } continue }
  if (inStr) { if (c === "\\") { i++; continue } if (c === inStr) inStr = null; continue }
  if (c === "/" && n === "/") { inLine = true; i++; continue }
  if (c === "/" && n === "*") { inBlock = true; i++; continue }
  if (c === '"' || c === "'" || c === "`") { inStr = c; continue }
  if (c === "[" || c === "(" || c === "{") { depth++; continue }
  if (c === "]" || c === ")" || c === "}") { depth--; if (depth === 0 && c === "]") { end = i + 1; break } }
}
const ALLOW_EXPR = DIFF.slice(bodyStart, end)

// lanes that EMIT contains, measured with a static scan of their analyzer for the
// enum member. Not a substitute for verify-label-coverage's runtime measurement,
// but it needs no grammar and is enough to prioritise the work.
const EMITS = new Set<string>()
for (const lane of LANGS) {
  const f = path.join(ROOT, "src/ast", `real-${lane}-analyzer.ts`)
  if (!fs.existsSync(f)) continue
  const src = fs.readFileSync(f, "utf8")
  if (/RelationshipType\.Contains|"contains"/.test(src)) EMITS.add(lane)
}

console.log("# `contains` coverage triage — does each emitting lane have a WIRED oracle?\n")
const rows: { lane: string; admits: boolean; oracle: Oracle | null }[] = []
for (const lane of [...EMITS].sort()) {
  const admits = (new Function("lang", `return ${ALLOW_EXPR}`)(lane) as string[]).includes("contains")
  const oracle = oracles.find((o) => o.lane === lane) ?? null
  rows.push({ lane, admits, oracle })
}

const wireable = rows.filter((r) => !r.admits && r.oracle && !r.oracle.wired)
const needsNew = rows.filter((r) => !r.admits && !r.oracle)

console.log(`lanes emitting \`contains\`: ${EMITS.size}\n`)
console.log("| lane | allowlist admits contains | existing oracle | wired into differential | action |")
console.log("|---|---|---|---|---|")
for (const r of rows) {
  const o = r.oracle
  const action = r.admits ? (o ? "closed" : "ADMITTED, no oracle")
    : o ? (o.wired ? "GAP DESPITE A WIRED ORACLE — investigate" : "**WIRE IT**")
    : "write one"
  console.log(`| ${r.lane} | ${r.admits ? "yes" : "no"} | ${o ? `\`${o.fn}\` (${o.file})` : "—"} | ${o ? (o.wired ? "yes" : "**no**") : "—"} | ${action} |`)
}

console.log(`\n## WIRE IT — an oracle exists and is not in the lane (cheapest possible fix)`)
for (const r of wireable) console.log(`- **${r.lane}**: ${r.oracle!.fn} in ${r.oracle!.file}`)
if (!wireable.length) console.log("- none")

console.log(`\n## WRITE ONE — no oracle exists anywhere`)
for (const r of needsNew) console.log(`- ${r.lane}`)
if (!needsNew.length) console.log("- none")

console.log(`\n## oracles that exist but have NO lane to run in`)
for (const o of oracles) {
  if (!EMITS.has(o.lane) && !o.wired) console.log(`- ${o.fn} (${o.file}) — lane \`${o.lane}\` emits no contains, or has no corpus`)
}
console.log(`\n- ${wireable.length} wireable, ${needsNew.length} need writing`)