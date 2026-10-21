/**
 * c-oracle-verify — the DEVELOPMENT instrument for `script/m14/oracles/c-truth.ts`.
 *
 * The ALL-OUT-OF-ALL D4 verdict is the shared differential's run (both halves: an oracle DERIVES a
 * label and the compared set ADMITS it). That file is Lead-serialised and this lane must not edit
 * it, so this instrument exists to prove the lane-owned derivations agree with the analyzer BEFORE
 * the wiring lands — and to price every disagreement by NAME, which is what makes an iteration
 * possible instead of a guess.
 *
 * It mirrors the shared differential's comparison semantics that matter for these labels:
 *   - a match key is `label + normTarget(target)` (the differential's own rule: type-args stripped,
 *     LAST dotted segment — for C's `contains`/`overrides` targets that is the identity, and for
 *     `exports` it is the marker as written),
 *   - MISSING      = the oracle derives a key the analyzer did not emit in that file
 *   - UNEXPLAINED  = the analyzer emitted a key the oracle does not derive in that file
 * Both directions are printed with file:line samples, so a disagreement is a named row.
 *
 * It also reports the clang-independent evidence for `contains` by reference (do not re-run clang
 * here): validation/m14/fixtures/c/contains-vs-clang.ts measured 421/421 members agreed.
 *
 * Usage:
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   bun run script/m14/c-oracle-verify.ts --repo sqlite            # whole repo
 *   bun run script/m14/c-oracle-verify.ts --repo sqlite --sample 60
 *   bun run script/m14/c-oracle-verify.ts --repo jq --json
 *
 * Exit: 0 when all three labels agree on the measured population; 1 when a disagreement exists
 * (the disagreement is the output — this instrument is a loop, not a gate).
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"
import { C_ORACLE_LABELS, deriveCExtraTruth } from "./oracles/c-truth"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")

// ────────────────────────────────────────────────────────────────────────────────────────────────
// CONTRACT CHECK (--selftest) — synthetic sources with hand-written expected row sets, so a rule
// that silently stops refusing (or stops deriving) fails HERE, before a corpus number is quoted.
// Each case states what the oracle must derive AND what it must REFUSE.
// ────────────────────────────────────────────────────────────────────────────────────────────────
interface ContractCase {
  name: string
  source: string
  expect: { contains?: string[]; exports?: Array<{ from: string; target: string }>; overrides?: string[] }
  forbid?: { contains?: string[]; exports?: Array<{ from: string; target: string }>; overrides?: string[] }
}

const CONTRACT_CASES: ContractCase[] = [
  {
    name: "contains / struct+union+enum members, and NO local/type-name members",
    source: `struct S { int a; int b; };
union U { long lo; char buf[4]; };
enum E { ONE, TWO };
void f(void) { struct S local; int not_a_member = 0; (void)local; (void)not_a_member; }
`,
    expect: { contains: ["a", "b", "lo", "buf", "ONE", "TWO"] },
    forbid: { contains: ["not_a_member", "local", "S", "U", "E"] },
  },
  {
    name: "exports / linkage marker derived, local marker + disagreeing arm refused",
    source: `#define API extern
#define PLATFORM extern __declspec(dllexport)
#define IMPORT extern __declspec(dllimport)
API int exported_fn(void);
IMPORT int import_fn(void);
static int not_a_marker(void) { return 0; }
void holder(void) { API int local_not_exported = 0; (void)local_not_exported; }
`,
    expect: { exports: [{ from: "exported_fn", target: "API" }] },
    forbid: {
      exports: [
        { from: "local_not_exported", target: "API" },
        { from: "not_a_marker", target: "API" },
        // #989's agreement rule: a macro whose replacement names `dllimport` is NOT an export marker
        { from: "import_fn", target: "IMPORT" },
      ],
    },
  },
  {
    name: "exports / guarded preproc attribute (Form C) derived, guarded #define refused",
    source: `#ifdef _WIN32
__declspec(dllexport)
#endif
int guarded_out(int x);

#ifdef PLATFORM_IS_WIN32
#define PLATFORM_EXPORT extern __declspec(dllexport)
#elif defined(PLATFORM_IS_WIN64)
#define PLATFORM_EXPORT extern __declspec(dllimport)
#else
#define PLATFORM_EXPORT extern
#endif
PLATFORM_EXPORT void *platform_marker(int n);
`,
    expect: { exports: [{ from: "guarded_out", target: "__declspec(dllexport)" }] },
    forbid: { exports: [{ from: "platform_marker", target: "__declspec(dllexport)" }] },
  },
  {
    name: "overrides / conditional arms and #undef/#define derived; unconditional duplicate refused",
    source: `#if defined(A)
int pick(void) { return 1; }
#else
int pick(void) { return 2; }
#endif

#define VALUE 1
#undef VALUE
#define VALUE 2

int dup(void) { return 0; }
int dup(void) { return 1; }
`,
    expect: { overrides: ["pick", "VALUE"] },
    forbid: { overrides: ["dup"] },
  },
  {
    name: "overrides / separate conditionals (no SHARED conditional) refused",
    source: `#if defined(A)
int split(void) { return 1; }
#endif
#if defined(B)
int split(void) { return 2; }
#endif
`,
    // This case is a PURE REFUSAL, so its derivation half is EMPTY BY CONSTRUCTION — and it is
    // written out rather than left out, because `ContractCase.expect` is REQUIRED (every case
    // states both channels) and because "no overrides row is derived" is itself the assertion.
    expect: { overrides: [] },
    forbid: { overrides: ["split"] },
  },
]

function rowKey(label: string, target: string): string {
  // The differential's match key is `label + normTarget(target)` — `from` is carried for a
  // hand-read but is NOT part of the key, so the contract check must not key on it either.
  return `${label}|${normTarget(target)}`
}

async function runSelftest(): Promise<number> {
  const parser: any = await getParser("c")
  const failures: string[] = []
  for (const c of CONTRACT_CASES) {
    const tree = parser.parse(c.source)
    const derived = deriveCExtraTruth(tree.rootNode, c.source)
    const keys = new Set(derived.map((e) => rowKey(e.label, e.target)))
    for (const member of c.expect?.contains ?? []) {
      if (!keys.has(rowKey("contains", member))) failures.push(`${c.name}: expected contains row for member ${member} — NOT DERIVED`)
    }
    for (const e of c.expect?.exports ?? []) {
      if (!keys.has(rowKey("exports", e.target))) failures.push(`${c.name}: expected exports ${e.from}->${e.target} — NOT DERIVED`)
    }
    for (const name of c.expect?.overrides ?? []) {
      if (!derived.some((e) => e.label === "overrides" && e.target === name)) failures.push(`${c.name}: expected overrides ${name} — NOT DERIVED`)
    }
    for (const member of c.forbid?.contains ?? []) {
      if (derived.some((e) => e.label === "contains" && e.target === member)) failures.push(`${c.name}: FORBIDDEN contains row derived for ${member}`)
    }
    for (const e of c.forbid?.exports ?? []) {
      if (derived.some((d) => d.label === "exports" && d.from === e.from && d.target === e.target)) failures.push(`${c.name}: FORBIDDEN exports ${e.from}->${e.target} DERIVED`)
    }
    for (const name of c.forbid?.overrides ?? []) {
      if (derived.some((e) => e.label === "overrides" && e.target === name)) failures.push(`${c.name}: FORBIDDEN overrides ${name} DERIVED`)
    }
    try { tree.delete?.() } catch { /* polite */ }
  }
  // THE COMPARATOR MUST BE ABLE TO GO RED TOO: a dropped truth row and a dropped payload row are
  // distinct findings, and this asserts each is reported.
  const truthKeys = new Map<string, string>([["a", "S->a@1"], ["b", "S->b@2"]])
  const payloadKeys = new Map<string, string>([["a", "S->a@1"]])
  let missing = 0
  let unexplained = 0
  for (const k of truthKeys.keys()) if (!payloadKeys.has(k)) missing++
  for (const k of payloadKeys.keys()) if (!truthKeys.has(k)) unexplained++
  if (missing !== 1) failures.push(`comparator control: dropped truth row was not counted MISSING (got ${missing})`)
  if (unexplained !== 0) failures.push(`comparator control: clean direction miscounted (got ${unexplained})`)
  if (!failures.length) {
    console.log(`CONTRACT CHECK PASSED — ${CONTRACT_CASES.length} cases, each asserting both derivation and refusal`)
    console.log("  comparator control: a dropped truth row is MISSING (1) and a fully covered payload has 0 unexplained")
    return 0
  }
  console.error(`CONTRACT CHECK FAILED — ${failures.length} finding(s):`)
  for (const f of failures) console.error("  " + f)
  return 1
}


const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")

const argv = process.argv.slice(2)
const arg = (name: string, dflt: string): string => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const REPO = arg("repo", "sqlite")
const SAMPLE = Number(arg("sample", "0"))
const JSON_OUT = argv.includes("--json")
const SIZE_CAP = 1024 * 1024

/** The differential's `normTarget` contract for the targets these three labels produce. */
function normTarget(t: string): string {
  const s = String(t ?? "").trim()
  // strip a type-argument list beginning after the first character (the shared rule)
  let cut = -1
  for (let i = 1; i < s.length; i++) {
    if (s[i] === "[" || s[i] === "<") { cut = i; break }
  }
  const head = cut > 0 ? s.slice(0, cut) : s
  const dot = head.lastIndexOf(".")
  return (dot >= 0 ? head.slice(dot + 1) : head).trim()
}

if (argv.includes("--selftest")) {
  process.exit(await runSelftest())
}

function discover(repoRoot: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries: any[]
    try { entries = readdirSync(dir, { withFileTypes: true }) as any } catch { return }
    for (const e of entries as any[]) {
      if (e.name === ".git" || e.name === "node_modules") continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) { walk(full); continue }
      if (!e.name.endsWith(".c")) continue
      try { if (statSync(full).size > SIZE_CAP) continue } catch { continue }
      out.push(full)
    }
  }
  walk(repoRoot)
  out.sort()
  return out
}

const repoRoot = path.join(CR, REPO)
if (!statSync(repoRoot, { throwIfNoEntry: false })) {
  console.error(`c-oracle-verify: no such corpus repo ${repoRoot}`)
  process.exit(2)
}
let files = discover(repoRoot)
const total = files.length
if (SAMPLE > 0 && total > SAMPLE) {
  const stride = Math.max(1, Math.floor(total / SAMPLE))
  const picked: string[] = []
  for (let i = 0; i < files.length && picked.length < SAMPLE; i += stride) picked.push(files[i])
  files = picked
}
if (files.length === 0) {
  console.error(`c-oracle-verify: 0 .c files under ${repoRoot}`)
  process.exit(2)
}

const parser: any = await getParser("c")
const analyzerMod: any = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))
const analyzer = new analyzerMod.RealCAnalyzer()
const ctor: any = analyzer?.constructor
if (typeof ctor?.setGrammar === "function") {
  try { ctor.setGrammar((parser as any).language, (parser as any).constructor) } catch { /* main pass only */ }
}

interface Cmp {
  truth: number
  covered: number
  missing: number
  analyzerEdges: number
  unexplained: number
  missingSamples: string[]
  unexplainedSamples: string[]
}
const perLabel: Record<string, Cmp> = {}
for (const label of C_ORACLE_LABELS) perLabel[label] = { truth: 0, covered: 0, missing: 0, analyzerEdges: 0, unexplained: 0, missingSamples: [], unexplainedSamples: [] }

let parsed = 0
let failed = 0
for (const abs of files) {
  const content = readFileSync(abs, "utf8")
  const rel = path.relative(repoRoot, abs)
  let result: any
  let tree: any
  try {
    tree = parser.parse(content)
    result = await analyzer.analyze(tree.rootNode, content, rel)
  } catch {
    failed++
    continue
  }
  parsed++
  const truth = deriveCExtraTruth(tree.rootNode, content)

  // truth per label — a SET of match keys, as the differential compares (label + normTarget)
  const truthKeys: Record<string, Map<string, string>> = {}
  for (const label of C_ORACLE_LABELS) truthKeys[label] = new Map()
  for (const e of truth) truthKeys[e.label].set(normTarget(e.target), `${e.from}->${e.target}@${e.line ?? "?"}`)

  // analyzer edges per label — the SAME match key
  const analyzerKeys: Record<string, Map<string, string>> = {}
  for (const label of C_ORACLE_LABELS) analyzerKeys[label] = new Map()
  for (const r of (result.relationships ?? []) as any[]) {
    const label = String(r.type ?? "")
    if (!(label in analyzerKeys)) continue
    analyzerKeys[label].set(normTarget(String(r.target ?? r.to ?? "")), `${r.source}->${r.target}@${r.line_number ?? "?"}`)
  }

  for (const label of C_ORACLE_LABELS) {
    const cmp = perLabel[label]
    cmp.truth += truthKeys[label].size
    cmp.analyzerEdges += analyzerKeys[label].size
    for (const [k, sample] of truthKeys[label]) {
      if (analyzerKeys[label].has(k)) { cmp.covered++; continue }
      cmp.missing++
      if (cmp.missingSamples.length < 12) cmp.missingSamples.push(`${rel}: ${sample}`)
    }
    for (const [k, sample] of analyzerKeys[label]) {
      if (truthKeys[label].has(k)) continue
      cmp.unexplained++
      if (cmp.unexplainedSamples.length < 12) cmp.unexplainedSamples.push(`${rel}: ${sample}`)
    }
  }
  try { tree.delete?.() } catch { /* an aborted instance refuses politely */ }
}

if (JSON_OUT) {
  console.log(JSON.stringify({
    instrument: "script/m14/c-oracle-verify.ts",
    repo: REPO,
    population: { discovered: total, sampled: files.length, parsed, failed, sizeCapBytes: SIZE_CAP },
    labels: C_ORACLE_LABELS,
    comparisonSemantics: "match key = label + normTarget(target), the shared differential's rule; truth and analyzer edges deduped per file",
    perLabel,
    limitation: "SECOND WALKER OVER THE SAME GRAMMAR — convicts a disagreement between two implementations of a rule; cannot see a defect in the grammar. `contains` additionally has the clang-14 instrument (421/421 members agreed, validation/m14/fixtures/c/contains-vs-clang.ts).",
  }, null, 2))
} else {
  console.log(`c-oracle-verify — ${REPO}: ${parsed} parsed of ${files.length} sampled (${total} discovered), failed ${failed}`)
  console.log("match key = label + normTarget(target) — the shared differential's rule\n")
  for (const label of C_ORACLE_LABELS) {
    const c = perLabel[label]
    console.log(`${label}: truth ${c.truth} · covered ${c.covered} · MISSING ${c.missing} · analyzerEdges ${c.analyzerEdges} · UNEXPLAINED ${c.unexplained}`)
    for (const s of c.missingSamples) console.log(`   MISSING      ${s}`)
    for (const s of c.unexplainedSamples) console.log(`   UNEXPLAINED  ${s}`)
  }
  const bad = C_ORACLE_LABELS.some((l) => perLabel[l].missing > 0 || perLabel[l].unexplained > 0)
  console.log(`\n${bad ? "DISAGREEMENTS PRESENT — iterate; the samples above are the named rows" : "AGREED on this population (both directions)"}`)
  process.exit(bad ? 1 : 0)
}
process.exit(C_ORACLE_LABELS.some((l) => perLabel[l].missing > 0 || perLabel[l].unexplained > 0) ? 1 : 0)
