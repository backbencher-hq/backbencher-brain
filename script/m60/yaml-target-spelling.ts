// M60 (YAML lane) — the target-spelling question, measured for the yaml lane.
//
// WHY THIS FILE EXISTS RATHER THAN A ROW IN THE SHARED CENSUS
// ------------------------------------------------------------
// `script/m60/target-spelling-census.ts` enumerates its lanes from `LANGS` in
// `script/m14/differential.ts`, filtering on `LANGS[l].analyzerFile`. yaml is not
// in `LANGS`, so the shared census cannot see the lane and R10 has never judged it.
//
// The tempting fix — adding a `LANGS.yaml` row — BREAKS a shared milestone, and the
// reason is worth recording because it is a trap rather than an oversight. The shared
// F5 sweep in the same file derives its truth per lane through a hand-written
// `derive<Lang>Edges` chain, and it THROWS on a lane that derives zero truth rows
// (`treeEdgesTotal === 0`, "a 0/0 row is a fabrication"). A `LANGS.yaml` row with no
// `deriveYamlEdges` would enroll the lane with an empty truth set and take the shared
// differential down for every lane. Writing `deriveYamlEdges` into that 15k-line
// shared file is central-owner work, not lane work.
//
// The register cannot be pre-populated either: `verify-standing-rules.ts` fails R10
// with `registered lane(s) appear in no census row` for a registered-but-unmeasured
// lane. So a `lanes.yaml` entry written today turns G1 red without measuring anything.
//
// Therefore: this is a LANE-SCOPED instrument with a declared boundary, and the
// shared gate stays the authority once the lane is enrolled. The classifier below is
// a faithful MIRROR of the shared one — same `isLiteralTarget`, same `DELIMITERS`,
// same `imports`/`exports` exclusion, same separator triples, same MIN_SYMBOLS
// threshold — and every place it had to differ is marked. When the shared census
// enrolls yaml, the two must be reconciled, and this artifact says so in writing
// rather than letting a lane-local number stand in for a gate that never ran.
//
// WHAT IT MEASURES. Spelling, not resolution: a well-spelled target that resolves to
// nothing is the differential's finding, not this one's. The question here is prior —
// can a yaml relationship target be spelled in a way no yaml symbol can ever be
// named? Three classes, mirroring the shared census:
//   literal      the WHOLE target is a quoted string or a bare number
//   whitespace   the target contains a space, tab or newline
//   delimiter    a character from `;(){},` — impossible in every identifier here
//   separator    any other non-alphanumeric character occurring in NONE of the lane's
//                own symbol names, measured at runtime over real corpora. Alphanumerics
//                are excluded, so a character absent from a draw cannot convict.
// `imports`/`exports` targets are REPORTED, never convicted, for the shared census's
// own reason: a module path may legitimately carry grouping punctuation.
//
// USAGE: bun run script/m60/yaml-target-spelling.ts [--per-repo=250] [--all]
//   default draws the two pinned sweep corpora (kubernetes primary, ansible second);
//   --all adds the lane's other six pinned repositories for a deeper draw.
import { writeFileSync, mkdirSync } from "node:fs"
import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = process.cwd()
const CORPUS_ROOT = "$HOME/fixtures/repositories"
const PRIMARY = "kubernetes"
const SECOND = "ansible"
const REST = ["grails-core", "docker", "terraform", "openapi-spec", "helm", "gh-cli"]

// The shared census's own calibration constants (script/m60/target-spelling-census.ts:123,135).
const MIN_SYMBOLS = 250
const SAMPLE_TARGETS = 120
// Mirror of the shared `DELIMITERS`, copied with its reason: provably impossible in
// any identifier in these languages. Brackets are deliberately excluded there.
const DELIMITERS = ";(){},"

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}`))
const PER_REPO = Number(arg("per-repo")?.split("=")[1] ?? 250)
const ALL = !!arg("--all")
const REPOS = ALL ? [PRIMARY, SECOND, ...REST] : [PRIMARY, SECOND]

const argValue = arg("per-repo")?.split("=")[1]
const PER = Number(argValue ?? 250)

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ya?ml)$/i.test(e.name)) out.push(p)
  }
}

// MIRROR of the shared census's `isLiteralTarget`: a quoted string, or a bare number
// (digits with at most one dot).
const isQuoted = (c: string) => c === '"' || c === "'" || c === "`"
const isLiteralTarget = (t: string): boolean => {
  if (t.length >= 2 && isQuoted(t[0]!) && t[t.length - 1] === t[0] && !t.slice(1, -1).includes(t[0]!)) return true
  let dots = 0
  for (const c of t) {
    if (c === ".") dots++
    else if (c < "0" || c > "9") return false
  }
  return t.length > 0 && dots <= 1
}

interface Target { target: string; type: string; file: string }

const targets: Target[] = []
const symbolNames = new Set<string>()
let files = 0
let symbols = 0
let relationships = 0
let allRels = 0
const draws: Array<{ repo: string; files: number }> = []
const crashes: Array<{ file: string; error: string }> = []

for (const repo of REPOS) {
  const dir = path.join(CORPUS_ROOT, repo)
  if (!fs.existsSync(dir)) { draws.push({ repo, files: 0 }); continue }
  const all: string[] = []
  walk(dir, all)
  all.sort()
  // The shared census's deterministic draw: sorted, then spread across the tree, so
  // one directory cannot decide the verdict.
  const chosen: string[] = []
  if (all.length <= PER) chosen.push(...all)
  else {
    const step = all.length / PER
    for (let i = 0; i < PER; i++) chosen.push(all[Math.floor(i * step)]!)
  }
  draws.push({ repo, files: chosen.length })
  for (const file of chosen) {
    let parsed: any
    try { parsed = await parseFile(file, ROOT) } catch (e: any) {
      crashes.push({ file: path.relative(dir, file), error: String(e?.message ?? e).slice(0, 200) })
      continue
    }
    files++
    const syms = (parsed.symbols ?? []) as any[]
    const rels = (parsed.relationships ?? []) as any[]
    symbols += syms.length
    relationships += rels.length
    allRels += rels.length
    for (const s of syms) symbolNames.add(String(s.name ?? ""))
    const rel = path.relative(dir, file)
    for (const r of rels) targets.push({ target: String(r.target ?? ""), type: String(r.type ?? ""), file: rel })
  }
}

const distinctSymbols = symbolNames.size
const anomalies: Array<{ target: string; type: string; chars: string[]; klass: string; file: string }> = []
const separatorTriples: Array<{ target: string; type: string; chars: string[]; file: string }> = []
const reportedPathTargets: Array<{ target: string; type: string; file: string }> = []
const emptyTargets: Array<{ type: string; file: string }> = []
const isAlphaNum = (c: string) => /[A-Za-z0-9]/.test(c)

for (const t of targets) {
  if (t.target.length === 0) { emptyTargets.push({ type: t.type, file: t.file }); continue }
  const chars = [...new Set(Array.from(t.target))]
  if (isLiteralTarget(t.target)) {
    anomalies.push({ ...t, chars: [], klass: "literal" })
    continue
  }
  // Module paths are reported, never convicted — the shared census's own rule.
  if (t.type === "imports" || t.type === "exports") {
    if (reportedPathTargets.length < SAMPLE_TARGETS) reportedPathTargets.push(t)
    for (const c of chars) if (!isAlphaNum(c)) separatorTriples.push({ ...t, chars: [c] })
    continue
  }
  const ws = chars.filter((c) => c === " " || c === "\t" || c === "\n")
  if (ws.length) { anomalies.push({ ...t, chars: ws, klass: "whitespace" }); continue }
  const delims = chars.filter((c) => DELIMITERS.includes(c))
  if (delims.length) { anomalies.push({ ...t, chars: delims, klass: "delimiter" }); continue }
  const seps = chars.filter((c) => !isAlphaNum(c) && !symbolNames.has(c) && ![...symbolNames].some((n) => n.includes(c)))
  if (seps.length) { anomalies.push({ ...t, chars: seps, klass: "separator" }); continue }
  for (const c of chars) if (!isAlphaNum(c)) separatorTriples.push({ ...t, chars: [c] })
}

const byClass = {
  literal: anomalies.filter((a) => a.klass === "literal").length,
  whitespace: anomalies.filter((a) => a.klass === "whitespace").length,
  delimiter: anomalies.filter((a) => a.klass === "delimiter").length,
  separator: anomalies.filter((a) => a.klass === "separator").length,
}

// SAMPLE PER CLASS, not one bounded list of every anomaly in class order. The first
// draft took `anomalies.slice(0, 120)` and the 13,899 `separator` rows filled it,
// so the four `literal` and two `whitespace` rows — the only CONVICTING classes here —
// were absent from the artifact that is supposed to make them auditable. A sample
// that is decided by class ORDER is not a sample of the finding.
const PER_CLASS_SAMPLES = 20
const anomalySamples = (["literal", "whitespace", "delimiter", "separator"] as const).flatMap((k) =>
  anomalies.filter((a) => a.klass === k).slice(0, PER_CLASS_SAMPLES),
)
const uniqueTriples = [...new Set(separatorTriples.map((s) => `${s.type}|${s.chars[0]}`))].sort()
const adjudicable = distinctSymbols >= MIN_SYMBOLS
const verdict = byClass.literal + byClass.whitespace + byClass.delimiter > 0
  ? "fabricated-spellings"
  : !adjudicable ? "underdetermined" : byClass.separator > 0 ? "unruled-separators" : "clean"

const payload = {
  schemaVersion: 1,
  milestone: "M60",
  rule: "R10",
  authority: "lane-scoped",
  purpose: "Measure the R10 spelling question for the yaml lane, which the shared census cannot see because it enumerates lanes from LANGS in script/m14/differential.ts.",
  generatedAt: new Date().toISOString(),
  boundary: {
    sharedGateStatus: "NOT RUN for yaml. script/m60/verify-standing-rules.ts cannot adjudicate R10 for this lane: the lane is absent from the shared census's lane set, and registering it in validation/m60/target-spelling-register.json today would fail the gate with `registered lane(s) appear in no census row`.",
    whyNotEnrolled: "Adding a LANGS.yaml row without a hand-written deriveYamlEdges in the shared F5 sweep would enroll the lane with zero truth rows, which that sweep throws on (treeEdgesTotal === 0). Both changes are central-owner work in a 15k-line shared file.",
    classifier: "A faithful mirror of the shared census's classifier, with the same DELIMITERS, the same isLiteralTarget, the same imports/exports exclusion, the same MIN_SYMBOLS threshold and the same separator-triple vocabulary. It must be reconciled against the shared census when the lane is enrolled; until then it is evidence, not a gate result.",
    draw: "The shared census's own deterministic draw (sorted, then every k-th file) is reproduced because filesFor() requires a LANGS entry this lane may not add. The deviation is the file set: the shared sweep's primary/second pairs, kubernetes and ansible, per LANG_REPOS and SECOND_CORPUS in script/m14/differential.ts.",
  },
  lang: "yaml",
  verdict,
  draws,
  files,
  symbols,
  distinctSymbols,
  minSymbols: MIN_SYMBOLS,
  adjudicable,
  relationships,
  targets: targets.length,
  distinctTargets: new Set(targets.map((t) => `${t.type}|${t.target}`)).size,
  sampleTargets: Math.min(targets.length, SAMPLE_TARGETS),
  byClass,
  anomalySamples,
  anomalySampleRule: `up to ${PER_CLASS_SAMPLES} per class, in class order literal/whitespace/delimiter/separator`,
  emptyTargets: emptyTargets.slice(0, 40),
  emptyTargetCount: emptyTargets.length,
  reportedPathTargets,
  separatorTriples: uniqueTriples.map((tr) => {
    const [type, char] = tr.split("|")
    return { relationshipType: type, char }
  }),
  relationTypes: [...new Set(targets.map((t) => t.type))].sort(),
  crashes,
  crashCount: crashes.length,
}

mkdirSync(path.join(ROOT, "validation/m60/results"), { recursive: true })
const out = path.join(ROOT, "validation/m60/results/yaml-target-spelling.json")
writeFileSync(out, JSON.stringify(payload, null, 2) + "\n")
console.log(`yaml target-spelling: ${verdict}`)
console.log(`  draws ${JSON.stringify(draws)}  files=${files} symbols=${symbols} distinct=${distinctSymbols} adjudicable=${adjudicable}`)
console.log(`  relationships=${relationships} targets=${targets.length} distinct=${payload.distinctTargets}`)
console.log(`  byClass ${JSON.stringify(byClass)}  emptyTargets=${emptyTargets.length} crashes=${crashes.length}`)
console.log(`  separator triples (unruled, to declare once the shared gate can see the lane): ${uniqueTriples.join(" ")}`)
console.log(`  relation types: ${payload.relationTypes.join(", ")}`)
console.log(`  → ${path.relative(ROOT, out)}`)
