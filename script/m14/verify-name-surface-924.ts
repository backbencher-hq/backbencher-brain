/**
 * M60-C — #924 gate: a C/C++ lane publishes NAMES.
 *
 * Three name-surface defects landed in #924, and all three had the same shape:
 * the published string was source TEXT rather than a name.
 *
 *   1. the include's NAME was a slice of the whole directive, so a trailing
 *      comment rode along (`vector // vector`) — gated by F13;
 *   2. a qualified declarator's NAME was the outer qualifier segment read as a
 *      name, so a return type the grammar could not place became part of the name
 *      and its tail became the OWNER (`system_error vwindows_error`);
 *   3. a call's TARGET was whatever node the callee descent stopped on, so a
 *      lambda body, an element call or a functional cast was published as the
 *      callee (`[](UInt m) { … }`, `fns[0]`, `calls -> int`).
 *
 * WHY A GATE AND NOT JUST FIXTURES: fixtures pin the shapes an author thought
 * of. These are corpus-surface invariants, and the differential oracle is
 * structurally blind to all three — it derives its truth from the same rules, so
 * both sides moved together and F5 reported zero unexplained edges while
 * thousands of names were wrong. A self-consistent lane needs a gate that reads
 * the LANGUAGE, which is why the lists below are written here rather than
 * imported from the analyzer: a gate that shares the rule cannot see the rule.
 *
 * Checks (all three over real files, through the production entry):
 *   V1  NO WHITESPACE CALL TARGET. No identifier in C/C++ contains whitespace.
 *   V2  NO CAST TARGET. No call target spells a builtin type keyword — a keyword
 *       can never name a function, so those edges are functional casts.
 *   V3  SYMBOL NAMES ARE NAMES. A published symbol name contains whitespace only
 *       where the product DECIDED it may: a macro-declared body's heading
 *       (`metadata.expandedFrom === "macro-heading"`, #919) or an operator's own
 *       spelling (`operator <<`, `operator"" _json`).
 *   V4  MUTATION SELF-TEST. The PRE-FIX state is re-derived from the same files
 *       — the old callee rule from the source text, the old declarator name from
 *       the TREE — and V1/V2/V3 MUST flag it. A gate that cannot fail on the
 *       defect it was written for is decoration.
 *
 * CLI: bun run script/m14/verify-name-surface-924.ts [--emit] [--selftest]
 * Evidence: validation/m14/results/M14.0.F14.json.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/engine"
import { getParser } from "./run-fixtures"
import { emitEvidence } from "./evidence-harness"

const ROOT = path.resolve(__dirname, "..", "..")
const REPOS = "$HOME/fixtures/repositories"

const LANES: Array<{ lang: "c" | "cpp"; dirs: string[]; exts: string[] }> = [
  { lang: "c", dirs: ["jq", "sqlite"], exts: [".c"] },
  { lang: "cpp", dirs: ["fmt", "nlohmann-json"], exts: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx", ".h"] },
]
const PER_LANE_LIMIT = Number(process.env.BB_NAMESURFACE_SAMPLE ?? 40)
const SKIP_DIRS = new Set([".git", "node_modules", "build", "out", "dist", "target", "third_party", "vendor", "test", "tests", "docs", "doc"])

/** The C/C++ builtin TYPE keywords, written out here on purpose (see the header). */
const BUILTIN_TYPE_KEYWORDS = new Set([
  "void", "bool", "char", "char8_t", "char16_t", "char32_t", "wchar_t",
  "short", "int", "long", "float", "double", "signed", "unsigned",
  "_Bool", "_Complex", "_Imaginary", "_Atomic", "auto",
])

/** The two DELIBERATE whitespace classes in the universal symbol contract. */
function deliberateName(name: string, metadata: unknown): string | null {
  const md = (metadata ?? {}) as Record<string, unknown>
  if (md.expandedFrom === "macro-heading") return "macro-heading"
  if (name.startsWith("operator")) return "operator-spelling"
  return null
}

function collectFiles(lane: (typeof LANES)[number]): string[] {
  const out: string[] = []
  for (const dir of lane.dirs) {
    const root = path.join(REPOS, dir)
    if (!fs.existsSync(root)) continue
    const stack: string[] = [root]
    const found: string[] = []
    while (stack.length > 0) {
      const cur = stack.pop()!
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(cur, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) {
        const p = path.join(cur, e.name)
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name)) continue
          stack.push(p)
        } else if (e.isFile() && lane.exts.some((x) => e.name.endsWith(x))) found.push(p)
      }
    }
    found.sort()
    out.push(...found.slice(0, PER_LANE_LIMIT))
  }
  return out
}

interface Violation {
  file: string
  lang: string
  check: string
  detail: string
}

/**
 * V4's pre-fix derivation of the CALL side, from the source text alone: the old
 * descent returned whatever node it stopped on, so a callee that is a lambda
 * body, an element call or a functional cast published its own text.
 */
function prefixCallTargets(src: string): string[] {
  const out: string[] = []
  for (const line of src.split("\n")) {
    const lam = /\[[^\]]*\]\s*\([^)]*\)\s*\{/.exec(line)
    if (lam) {
      const close = line.indexOf("}", lam.index + lam[0].length)
      if (close > 0 && line.slice(close + 1).trimStart().startsWith("(")) out.push(line.slice(lam.index, close + 1))
    }
    const sub = /([A-Za-z_][A-Za-z0-9_]*\s*\[[^\]]*\]\s*)\(/.exec(line)
    if (sub) out.push(sub[1].trim())
    const cast = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line)
    if (cast && BUILTIN_TYPE_KEYWORDS.has(cast[1])) out.push(cast[1])
  }
  return out
}

/**
 * V4's pre-fix derivation of the DECLARATOR-name side, from the TREE (not from
 * the analyzer): the old read took the OUTER qualified_identifier's last named
 * segment as the name, and the segment above it as the owner.
 */
function prefixDeclaratorNames(root: any): string[] {
  const out: string[] = []
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "function_definition" || n.type === "declaration") {
      const kids: any[] = n.namedChildren ?? []
      let decl = kids.find((c: any) => c.type === "function_declarator")
      if (!decl) {
        const ptr = kids.find((c: any) => c.type === "pointer_declarator" || c.type === "reference_declarator")
        if (ptr) decl = (ptr.namedChildren ?? []).find((c: any) => c.type === "function_declarator")
      }
      const qid = (decl?.namedChildren ?? []).find((c: any) => c.type === "qualified_identifier")
      if (qid) {
        const last = qid.namedChild(qid.namedChildCount - 1)
        if (last && /\s/.test(String(last.text ?? ""))) out.push(String(last.text))
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

async function main(): Promise<void> {
  const violations: Violation[] = []
  const preViolations: Violation[] = []
  let files = 0
  let calls = 0
  let symbols = 0
  let deliberate = 0

  for (const lane of LANES) {
    for (const f of collectFiles(lane)) {
      let src = ""
      let r: any
      try {
        src = fs.readFileSync(f, "utf8")
        r = await parseFile(f, src)
      } catch {
        continue
      }
      files++
      const rel = f.replace(`${REPOS}/`, "")

      // V1 + V2 over the published call targets
      for (const e of r.relationships ?? []) {
        if (String(e.type) !== "calls") continue
        calls++
        const t = String(e.target ?? "")
        if (/\s/.test(t)) violations.push({ file: rel, lang: lane.lang, check: "V1-no-whitespace-target", detail: JSON.stringify(t.slice(0, 80)) })
        if (BUILTIN_TYPE_KEYWORDS.has(t)) violations.push({ file: rel, lang: lane.lang, check: "V2-no-cast-target", detail: JSON.stringify(t) })
      }

      // V3 over the published symbol names
      for (const s of r.symbols ?? []) {
        symbols++
        const name = String(s.name ?? "")
        if (!/\s/.test(name)) continue
        const why = deliberateName(name, s.metadata)
        if (why) deliberate++
        else violations.push({ file: rel, lang: lane.lang, check: "V3-name-is-a-name", detail: `${String(s.kind)} ${JSON.stringify(name.slice(0, 80))}` })
      }

      // V4: the same files, the PRE-FIX rules
      for (const t of prefixCallTargets(src)) {
        if (/\s/.test(t)) preViolations.push({ file: rel, lang: lane.lang, check: "V1-no-whitespace-target", detail: JSON.stringify(t.slice(0, 60)) })
        if (BUILTIN_TYPE_KEYWORDS.has(t)) preViolations.push({ file: rel, lang: lane.lang, check: "V2-no-cast-target", detail: JSON.stringify(t) })
      }
      for (const t of prefixDeclaratorNames((await getParser(lane.lang)).parse(src).rootNode)) {
        preViolations.push({ file: rel, lang: lane.lang, check: "V3-name-is-a-name", detail: JSON.stringify(t.slice(0, 60)) })
      }
    }
  }

  const byCheck = new Map<string, number>()
  for (const v of violations) byCheck.set(v.check, (byCheck.get(v.check) ?? 0) + 1)
  const preByCheck = new Map<string, number>()
  for (const v of preViolations) preByCheck.set(v.check, (preByCheck.get(v.check) ?? 0) + 1)

  const lines: string[] = []
  lines.push(`corpus: ${files} files, ${symbols} symbols, ${calls} calls, ${deliberate} deliberate whitespace names`)
  const show = (name: string, n: number, pre: number, ok: boolean): void => {
    lines.push(`${ok ? "ok   " : "FAIL "} ${name} ${n === 0 ? "0 violations" : `${n} violation(s)`}${pre ? ` — PRE-FIX would flag ${pre}` : ""}`)
  }
  show("V1-no-whitespace-call-target", byCheck.get("V1-no-whitespace-target") ?? 0, preByCheck.get("V1-no-whitespace-target") ?? 0, (byCheck.get("V1-no-whitespace-target") ?? 0) === 0)
  show("V2-no-cast-call-target", byCheck.get("V2-no-cast-target") ?? 0, preByCheck.get("V2-no-cast-target") ?? 0, (byCheck.get("V2-no-cast-target") ?? 0) === 0)
  show("V3-symbol-name-is-a-name", byCheck.get("V3-name-is-a-name") ?? 0, preByCheck.get("V3-name-is-a-name") ?? 0, (byCheck.get("V3-name-is-a-name") ?? 0) === 0)

  const selfTestFails = (["V1-no-whitespace-target", "V2-no-cast-target", "V3-name-is-a-name"] as const).filter((k) => (preByCheck.get(k) ?? 0) === 0)
  const ok = violations.length === 0 && selfTestFails.length === 0
  lines.push(
    ok
      ? "ok   V4-selftest-prefix-is-caught the pre-fix rules re-derived from these files trip all three checks — the gate can fail"
      : `FAIL V4-selftest: no pre-fix violation for ${selfTestFails.join(", ")} — a check that cannot fail is decoration`,
  )

  console.log(lines.join("\n"))
  for (const v of violations.slice(0, 20)) console.log(`   ${v.lang} ${v.file} ${v.check} ${v.detail}`)
  console.log(`\n${ok ? "PASS" : "FAIL"} — ${ok ? "3/3 checks + self-test" : `${violations.length} violation(s), ${selfTestFails.length} dead check(s)`}`)

  if (process.argv.includes("--emit")) {
    emitEvidence({
      issueId: "M14.0.F14",
      title: "C/C++ call targets and symbol names are names",
      claimLevel: "L1",
      layers: ["corpus", "mutation"],
      checks: [
        { id: "V1-no-whitespace-call-target", description: `no published call target contains whitespace (${calls} calls over ${files} files); PRE-FIX derivation flags ${preByCheck.get("V1-no-whitespace-target") ?? 0}`, status: (byCheck.get("V1-no-whitespace-target") ?? 0) === 0 ? "pass" : "fail" },
        { id: "V2-no-cast-call-target", description: `no call target spells a builtin type keyword; PRE-FIX derivation flags ${preByCheck.get("V2-no-cast-target") ?? 0}`, status: (byCheck.get("V2-no-cast-target") ?? 0) === 0 ? "pass" : "fail" },
        { id: "V3-symbol-name-is-a-name", description: `a whitespace-bearing symbol name is only the two deliberate classes (#919 macro-heading, operator spelling); ${deliberate} published, ${byCheck.get("V3-name-is-a-name") ?? 0} violations`, status: (byCheck.get("V3-name-is-a-name") ?? 0) === 0 ? "pass" : "fail" },
        { id: "V4-selftest-prefix-is-caught", description: `the pre-fix callee rule (from the source) and the pre-fix declarator read (from the tree) trip every check`, status: selfTestFails.length === 0 ? "pass" : "fail" },
      ],
      limitations: [
        `sample: up to ${PER_LANE_LIMIT} files per lane from the four pinned corpora (jq, sqlite, fmt, nlohmann-json), excluding test/docs/third-party directories — the full-corpus A/B is script/m14/tmp/c924-calls-ab.ts and c924qid-ab.ts`,
        "V1's invariant (an identifier contains no whitespace) is a language fact, not a parser fact: a lane that publishes expression text as a callee violates it in any C/C++ file",
        "the differential oracle downstream of this lane derives its truth from the same rules, so F5 could not see any of these three classes; this gate is deliberately independent of them (its keyword list is written out here, not imported)",
        "V3 pins the two DELIBERATE whitespace classes by name (#919 macro-heading metadata, `operator` spellings); it does not judge whether those two decisions are right, only that nothing else leaks into them",
        "one `calls -> uint64_t` remains on the corpora by deliberate decision (a typedef name IS a legal identifier, so refusing it by name would be a heuristic) and is therefore not a V2 violation",
      ],
      corpusPins: LANES.map((l) => ({ repo: l.dirs.join("+"), lang: l.lang, files: PER_LANE_LIMIT })),
      data: { files, symbols, calls, deliberateWhitespaceNames: deliberate, violations: violations.length, byCheck: Object.fromEntries(byCheck), prefixViolations: preViolations.length, prefixByCheck: Object.fromEntries(preByCheck), samples: violations.slice(0, 20) },
    })
    console.log("evidence emitted: validation/m14/results/M14.0.F14.json")
  }
  if (!ok) process.exitCode = 1
}

if (process.argv.includes("--selftest")) {
  // The self-test IS the pre-fix derivation inside main(); --selftest is accepted
  // so the battery can call it the same way it calls the other gates.
  await main()
} else {
  await main()
}
void ROOT
