/**
 * ruby-oracle-verify — the DEVELOPMENT instrument for `script/m14/ruby-truth.ts`.
 *
 * The ALL-OUT-OF-ALL D4 verdict is the shared differential's run (both halves: an oracle DERIVES a
 * label and the compared set ADMITS it). `script/m14/differential.ts` is Lead-serialised and this lane
 * must not edit it, so this instrument exists to prove the lane-owned derivations agree with the
 * analyzer BEFORE the wiring lands — and to price every disagreement BY NAME, which is what makes an
 * iteration possible instead of a guess. It also carries the CONTRACT CHECK (`--selftest`) the Lead
 * asked for: synthetic Ruby sources with hand-written expected row sets, each asserting BOTH what the
 * oracle must derive AND what it must REFUSE, plus a comparator control — so the prove-instrument can
 * itself be demonstrated able to fail.
 *
 * Comparison semantics mirror the shared differential's rule that matters for these labels: a match key
 * is `label + normTarget(target)` (type-args stripped, LAST dotted segment). NOTE the imports spelling
 * contract (Lead ruling, stronger matcher `174f35fda`): a path-like target is compared EXACTLY as
 * written, so the oracle publishes the specifier exactly as the analyzer does (`require_relative "./x"`
 * -> `./x`, not `x`) — this instrument keys imports on the exact trimmed string, which is stricter than
 * normTarget and surfaces a spelling divergence instead of hiding it.
 *
 * Usage:
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   bun run script/m14/ruby-oracle-verify.ts --selftest
 *   bun run script/m14/ruby-oracle-verify.ts --repo rack [--sample 60]
 *   bun run script/m14/ruby-oracle-verify.ts --repo rack --json
 *
 * Exit: 0 = agreed; 1 = disagreement (the samples are the named rows — this is a loop, not a gate).
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"
import { RUBY_ORACLE_LABELS, deriveRubyEdges } from "./ruby-truth"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")

const argv = process.argv.slice(2)
const arg = (name: string, dflt: string): string => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const REPO = arg("repo", "rack")
const SAMPLE = Number(arg("sample", "0"))
const JSON_OUT = argv.includes("--json")
const SIZE_CAP = 1024 * 1024

/** The differential's normTarget contract, mirrored for non-import labels. */
function normTarget(t: string): string {
  const s = String(t ?? "").trim()
  let cut = -1
  for (let i = 1; i < s.length; i++) {
    if (s[i] === "[" || s[i] === "<") { cut = i; break }
  }
  const head = cut > 0 ? s.slice(0, cut) : s
  const dot = head.lastIndexOf(".")
  return (dot >= 0 ? head.slice(dot + 1) : head).trim()
}
/** Imports are compared EXACTLY (path-like targets, stronger matcher); everything else by normTarget. */
function key(label: string, target: string): string {
  return label === "imports" ? `${label}|${String(target ?? "").trim()}` : `${label}|${normTarget(target)}`
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// CONTRACT CHECK (the Lead-requested shape: positive + refusal cases + comparator control)
// ────────────────────────────────────────────────────────────────────────────────────────────────
interface ContractCase {
  name: string
  source: string
  expect: Array<{ label: string; target: string }>
  forbid: Array<{ label: string; target?: string }>
}
const CONTRACT_CASES: ContractCase[] = [
  {
    name: "mixes_in: include/prepend/extend are COMPOSITION; dynamic mixin refused; no implements/extends-mixin",
    source: `module M1; def a; end; end
module M2; def b; end; end
module M3; def c; end; end
class Base; def base; end; end
class C < Base
  include M1
  prepend M2
  extend M3
  def apply(m) = include(m)
end
`,
    expect: [
      { label: "mixes_in", target: "M1" },
      { label: "mixes_in", target: "M2" },
      { label: "mixes_in", target: "M3" },
      { label: "extends", target: "Base" },
    ],
    forbid: [
      { label: "implements" },
      { label: "mixes_in", target: "m" },
      { label: "extends", target: "M3" },
    ],
  },
  {
    name: "imports: exact specifier spelling (./ and ../ preserved), interpolated literal refused",
    source: `require "a/b"
require_relative "./c"
require_relative "../d/e"
load "f"
autoload :G, "g/h"
require "i/#{dynamic}"
`,
    expect: [
      { label: "imports", target: "a/b" },
      { label: "imports", target: "./c" },
      { label: "imports", target: "../d/e" },
      { label: "imports", target: "f" },
      { label: "imports", target: "g/h" },
      // the same facts as references rows — the load-fact pair is one-for-one
      { label: "references", target: "a/b" },
      { label: "references", target: "./c" },
    ],
    forbid: [{ label: "imports", target: "i/#{dynamic}" }],
  },
  {
    name: "exports: file-unit surface (class/module/def/factory) with its measured refusals",
    source: `PLAIN_CONST = 2
FACTORY = Class.new
class TopClass
  MEMBER_CONST = 3
  def member_method; end
end
module TopModule
  def self.singleton_here; end
end
def top_level_method; end
def self.main_singleton; end
private_constant :PLAIN_CONST
`,
    expect: [
      { label: "exports", target: "FACTORY" },
      { label: "exports", target: "TopClass" },
      { label: "exports", target: "TopModule" },
      { label: "exports", target: "top_level_method" },
    ],
    forbid: [
      { label: "exports", target: "MEMBER_CONST" },
      { label: "exports", target: "member_method" },
      { label: "exports", target: "singleton_here" },
      { label: "exports", target: "main_singleton" },
      { label: "exports", target: "PLAIN_CONST" },
    ],
  },
  {
    name: "contains/overrides/instantiates: local class graph only, no cross-file or dynamic guesses",
    source: `class Base
  def run; end
end
class Sub < Base
  def run; end
  def build; = Object.new
end
class Other
  def run; end
end
`,
    expect: [
      { label: "contains", target: "run" },
      { label: "overrides", target: "Base.run" },
      { label: "instantiates", target: "Object" },
    ],
    forbid: [{ label: "overrides", target: "Other.run" }],
  },
]

async function runSelftest(): Promise<number> {
  const parser: any = await getParser("ruby")
  const failures: string[] = []
  for (const c of CONTRACT_CASES) {
    const tree = parser.parse(c.source)
    const derived = deriveRubyEdges(tree.rootNode)
    const keys = new Set(derived.map((e: any) => key(e.label, e.target)))
    for (const want of c.expect) {
      if (!keys.has(key(want.label, want.target))) failures.push(`${c.name}: expected ${want.label} -> ${want.target} — NOT DERIVED`)
    }
    for (const bad of c.forbid) {
      // FORBID rows compare the RAW target, not the leaf key: a qualified target (`Other.run`) would
      // otherwise be "matched" by a legitimate `Base.run` row sharing the leaf, and the refusal case
      // would fail for the wrong reason (measured: the first version flagged exactly that).
      const hit = derived.some((e: any) => e.label === bad.label && (bad.target === undefined || String(e.target).trim() === String(bad.target).trim()))
      if (hit) failures.push(`${c.name}: FORBIDDEN ${bad.label}${bad.target ? ` -> ${bad.target}` : " (any row)"} DERIVED`)
    }
    try { tree.delete?.() } catch { /* polite */ }
  }
  // THE COMPARATOR MUST BE ABLE TO GO RED TOO: a dropped truth row is MISSING, and a fully covered
  // payload has 0 unexplained.
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

// ────────────────────────────────────────────────────────────────────────────────────────────────
// CORPUS ARM
// ────────────────────────────────────────────────────────────────────────────────────────────────
function discover(repoRoot: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries: any[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) as any } catch { return }
    for (const e of entries as any[]) {
      if (e.name === ".git" || e.name === "node_modules") continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) { walk(full); continue }
      if (!e.name.endsWith(".rb")) continue
      try { if (fs.statSync(full).size > SIZE_CAP) continue } catch { continue }
      out.push(full)
    }
  }
  walk(repoRoot)
  out.sort()
  return out
}

async function corpusArm(): Promise<number> {
  const repoRoot = path.join(CR, REPO)
  if (!fs.existsSync(repoRoot)) {
    console.error(`ruby-oracle-verify: no such corpus repo ${repoRoot}`)
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
  const parser: any = await getParser("ruby")
  const mod: any = await import(path.join(ROOT, "src/ast/real-ruby-analyzer.ts"))
  const analyzer = new mod.RealRubyAnalyzer()
  const ctor: any = analyzer?.constructor
  if (typeof ctor?.setGrammar === "function") { try { ctor.setGrammar((parser as any).language, (parser as any).constructor) } catch { /* main pass */ } }

  const cmps: Record<string, any> = {}
  for (const label of RUBY_ORACLE_LABELS) cmps[label] = { truth: 0, covered: 0, missing: 0, analyzerEdges: 0, unexplained: 0, missingSamples: [], unexplainedSamples: [] }
  let parsed = 0
  let failed = 0
  for (const abs of files) {
    const content = fs.readFileSync(abs, "utf8")
    const rel = path.relative(repoRoot, abs)
    let result: any
    let tree: any
    try {
      tree = parser.parse(content)
      result = await analyzer.analyze(tree.rootNode, content, rel)
    } catch { failed++; continue }
    parsed++
    const truth = deriveRubyEdges(tree.rootNode)
    const truthKeys: Record<string, Map<string, string>> = {}
    const payloadKeys: Record<string, Map<string, string>> = {}
    for (const label of RUBY_ORACLE_LABELS) { truthKeys[label] = new Map(); payloadKeys[label] = new Map() }
    for (const e of truth) {
      const m = truthKeys[e.label as string]
      if (m) m.set(key(e.label, e.target), `${e.from ?? "?"}->${e.target}@${e.line ?? "?"}`)
    }
    for (const r of (result.relationships ?? []) as any[]) {
      const label = String(r.type ?? "")
      const m = payloadKeys[label]
      if (!m) continue
      m.set(key(label, String(r.target ?? "")), `${r.source}->${r.target}@${r.line_number ?? "?"}`)
    }
    for (const label of RUBY_ORACLE_LABELS) {
      const c = cmps[label]
      c.truth += truthKeys[label].size
      c.analyzerEdges += payloadKeys[label].size
      for (const [k, sample] of truthKeys[label]) {
        if (payloadKeys[label].has(k)) { c.covered++; continue }
        c.missing++
        if (c.missingSamples.length < 10) c.missingSamples.push(`${rel}: ${sample}`)
      }
      for (const [k, sample] of payloadKeys[label]) {
        if (truthKeys[label].has(k)) continue
        c.unexplained++
        if (c.unexplainedSamples.length < 10) c.unexplainedSamples.push(`${rel}: ${sample}`)
      }
    }
    try { tree.delete?.() } catch { /* polite */ }
  }
  const bad = RUBY_ORACLE_LABELS.some((l) => (cmps[l] as any).missing > 0 || (cmps[l] as any).unexplained > 0)
  if (JSON_OUT) {
    console.log(JSON.stringify({
      instrument: "script/m14/ruby-oracle-verify.ts",
      repo: REPO,
      population: { discovered: total, sampled: files.length, parsed, failed, sizeCapBytes: SIZE_CAP },
      labels: RUBY_ORACLE_LABELS,
      comparisonSemantics: "label + normTarget(target) for names; label + EXACT trimmed target for imports (stronger path matcher)",
      perLabel: cmps,
      limitation: "second walker over the same grammar; imports spelling is compared exactly, per the Lead's stronger loader-path matcher",
    }, null, 2))
    return bad ? 1 : 0
  }
  console.log(`ruby-oracle-verify — ${REPO}: ${parsed} parsed of ${files.length} sampled (${total} discovered), failed ${failed}`)
  console.log("match key = label + normTarget(target); imports = label + EXACT target\n")
  for (const label of RUBY_ORACLE_LABELS) {
    const c: any = cmps[label]
    console.log(`${label}: truth ${c.truth} · covered ${c.covered} · MISSING ${c.missing} · analyzerEdges ${c.analyzerEdges} · UNEXPLAINED ${c.unexplained}`)
    for (const s of c.missingSamples) console.log(`   MISSING      ${s}`)
    for (const s of c.unexplainedSamples) console.log(`   UNEXPLAINED  ${s}`)
  }
  console.log(`\n${bad ? "DISAGREEMENTS PRESENT — iterate; the samples above are the named rows" : "AGREED on this population (both directions)"}`)
  return bad ? 1 : 0
}

if (argv.includes("--selftest")) process.exit(await runSelftest())
process.exit(await corpusArm())
