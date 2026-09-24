/**
 * M60-C — #924 gate: a lane publishes NAMES. c/cpp (#924) and rust (#798, R10).
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
import { parseFile, ASTEngine } from "../../src/ast/engine"
import { getParser } from "./run-fixtures"
import { emitEvidence } from "./evidence-harness"

const ROOT = path.resolve(__dirname, "..", "..")
const REPOS = "$HOME/fixtures/repositories"

const LANES: Array<{ lang: "c" | "cpp" | "rust"; dirs: string[]; exts: string[]; limit?: number; why?: string }> = [
  { lang: "c", dirs: ["jq", "sqlite"], exts: [".c"] },
  { lang: "cpp", dirs: ["fmt", "nlohmann-json"], exts: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx", ".h"] },
  // R10 (#798): rust rides the M60 corpora, and it is read at the FULL EXTENT
  // rather than on a draw. The reason is measured, not stylistic: R10's
  // conviction lived in cargo/crates/cargo-test-support/src/lib.rs, which is
  // ABSENT from the census's canonical 40-file spread and present at caps 400
  // and 1400 (script/m14/tmp/rust-798-draw-check.ts) — a gate for this class
  // that sampled the way the census samples would have read "clean" on the very
  // file that was not clean. A gate is not a census: it reads MORE.
  {
    lang: "rust", dirs: ["ripgrep", "cargo"], exts: [".rs"], limit: Number.MAX_SAFE_INTEGER,
    why: "full extent — the census's 40-file draw does not contain the file that carried the R10 conviction (rust-798-draw-check.ts), so reading the same draw would have missed it. A gate must be able to fail on the defect it was written for.",
  },
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

// ------------------------------------------------------------------- rust
//
// Rust's name predicate, written out HERE rather than imported from the
// analyzer (a gate that shares the rule cannot see the rule). A raw identifier
// is wrapped in `(?:r#)?` explicitly, as an accepted SPELLING, not as a
// tolerated defect — see the header's R2 and reviews/rust/closure.md.
const RUST_IDENT = "(?:r#)?[A-Za-z_][A-Za-z0-9_]*"
const RUST_NAME_PATH = new RegExp(`^${RUST_IDENT}(?:::${RUST_IDENT})*$`)

/** The rust KEYWORDS: a bare (non-raw) segment may never be one, because a
 *  keyword is not an identifier — the only spellable form is `r#kw`, which is
 *  exactly why a raw identifier keeps its prefix on both the symbol and its
 *  targets. */
const RUST_KEYWORDS = new Set([
  "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else", "enum", "extern",
  "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub",
  "ref", "return", "self", "Self", "static", "struct", "super", "trait", "true", "type", "unsafe",
  "use", "where", "while", "try", "abstract", "become", "box", "do", "final", "macro", "override",
  "priv", "typeof", "unsized", "virtual", "yield",
])

/** Why a published string is not a rust NAME, or `null` when it is one. */
function rustNameDefect(name: string): string | null {
  if (name.trim() === "") return "empty name"
  if (!RUST_NAME_PATH.test(name)) return "not a rust name path (whitespace / punctuation / wrapper text)"
  for (const seg of name.split("::")) {
    if (!seg.startsWith("r#") && RUST_KEYWORDS.has(seg)) {
      return `bare keyword segment \`${seg}\` (only \`r#${seg}\` can be written in source)`
    }
  }
  return null
}

/**
 * R3's PRE-FIX derivation, from the TREE: the old rule published the
 * implemented type's own text (`stripGenerics(typeNode.text)`) as the impl
 * symbol's name, as the `implements` edge's source, and — through that text's
 * leaf — as every `Self` target inside the block. Both forms are returned, so
 * the self-test covers the symbol surface and the target surface of the defect
 * with ONE derivation rather than a rule copied from the analyzer.
 */
function prefixRustImplNames(root: any): string[] {
  const out: string[] = []
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "impl_item") {
      const typeNode = n.childForFieldName?.("type")
      if (typeNode) {
        const text = String(typeNode.text ?? "")
        const lt = text.indexOf("<")
        const base = lt >= 0 ? text.slice(0, lt) : text
        out.push(base)
        out.push(base.split("::").filter(Boolean).pop() ?? "")
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
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
    out.push(...found.slice(0, lane.limit ?? PER_LANE_LIMIT))
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
  // R10 (#798): rust's own counters — the C/C++ ones count `calls` only, and a
  // rust reading has to be able to say how many name-bearing targets and
  // symbols it actually adjudicated.
  const rustViolations: Violation[] = []
  const rustPreViolations: Violation[] = []
  let files = 0
  let calls = 0
  let symbols = 0
  let deliberate = 0
  let rustTargets = 0
  // Per-lane file counts, so the artifact pins the draw each lane was actually
  // read at instead of repeating one global cap for lanes read at different
  // extents (rust is full extent by design — see LANES).
  const filesByLane = new Map<string, number>()
  let rustSymbols = 0
  let rustPreTargets = 0

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
      filesByLane.set(lane.lang, (filesByLane.get(lane.lang) ?? 0) + 1)
      const rel = f.replace(`${REPOS}/`, "")

      if (lane.lang === "rust") {
        // R1: every NAME-BEARING target (all labels but the module PATHS) is a
        // rust name. This is where the R10 conviction lived, and it is why the
        // check is not scoped to `calls` as C/C++'s V1 is.
        for (const e of r.relationships ?? []) {
          const label = String(e.type ?? "")
          if (label === "imports" || label === "exports") continue
          if (e.target === undefined || e.target === null) continue
          rustTargets++
          const t = String(e.target)
          const bad = rustNameDefect(t)
          if (bad) rustViolations.push({ file: rel, lang: "rust", check: "R1-no-whitespace-name-target", detail: `${label} -> ${JSON.stringify(t.slice(0, 80))} — ${bad}` })
        }
        // R2: every published SYMBOL name is a rust name.
        for (const s of r.symbols ?? []) {
          rustSymbols++
          const bad = rustNameDefect(String(s.name ?? ""))
          if (bad) rustViolations.push({ file: rel, lang: "rust", check: "R2-symbol-name-is-a-rust-name", detail: `${String(s.kind)} ${JSON.stringify(String(s.name ?? "").slice(0, 80))} — ${bad}` })
        }
        // R3: the same files, the PRE-FIX impl-target rule.
        const root = (await ASTEngine.getParser("rust" as any)).parse(src).rootNode
        for (const t of prefixRustImplNames(root)) {
          rustPreTargets++
          const bad = rustNameDefect(t)
          if (!bad) continue
          // The same pre-fix string is both a published TARGET (R1) and a
          // published SYMBOL NAME (R2) under the old rule, so it is recorded
          // under both — each check must be able to fail on its own.
          rustPreViolations.push({ file: rel, lang: "rust", check: "R1-no-whitespace-name-target", detail: `${JSON.stringify(t.slice(0, 60))} — ${bad}` })
          rustPreViolations.push({ file: rel, lang: "rust", check: "R2-symbol-name-is-a-rust-name", detail: `${JSON.stringify(t.slice(0, 60))} — ${bad}` })
        }
        continue
      }

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
  const okCFamily = violations.length === 0 && selfTestFails.length === 0
  lines.push(
    okCFamily
      ? "ok   V4-selftest-prefix-is-caught the pre-fix rules re-derived from these files trip all three checks — the gate can fail"
      : `FAIL V4-selftest: no pre-fix violation for ${selfTestFails.join(", ")} — a check that cannot fail is decoration`,
  )

  // R10 (#798): the rust lane's own checks, same discipline — a check with no
  // pre-fix hit is decoration, so the self-test is per-check here too.
  const rustByCheck = new Map<string, number>()
  for (const v of rustViolations) rustByCheck.set(v.check, (rustByCheck.get(v.check) ?? 0) + 1)
  const rustPreByCheck = new Map<string, number>()
  for (const v of rustPreViolations) rustPreByCheck.set(v.check, (rustPreByCheck.get(v.check) ?? 0) + 1)
  const rustFiles = filesByLane.get("rust") ?? 0
  lines.push(`rust corpus: ${rustFiles} files (FULL extent of ${LANES.find((l) => l.lang === "rust")?.dirs.join("+")}), ${rustTargets} name-bearing targets, ${rustSymbols} symbols, ${rustPreTargets} PRE-FIX impl-target spellings re-derived`)
  show("R1-no-whitespace-name-target", rustByCheck.get("R1-no-whitespace-name-target") ?? 0, rustPreByCheck.get("R1-no-whitespace-name-target") ?? 0, (rustByCheck.get("R1-no-whitespace-name-target") ?? 0) === 0)
  show("R2-symbol-name-is-a-rust-name", rustByCheck.get("R2-symbol-name-is-a-rust-name") ?? 0, rustPreByCheck.get("R2-symbol-name-is-a-rust-name") ?? 0, (rustByCheck.get("R2-symbol-name-is-a-rust-name") ?? 0) === 0)
  const rustSelfTestFails = (["R1-no-whitespace-name-target", "R2-symbol-name-is-a-rust-name"] as const).filter((k) => (rustPreByCheck.get(k) ?? 0) === 0)
  const okRust = rustViolations.length === 0 && rustSelfTestFails.length === 0
  lines.push(
    rustSelfTestFails.length === 0
      ? "ok   R3-selftest-prefix-is-caught the pre-fix impl-target rule re-derived from these files trips both checks — the gate can fail"
      : `FAIL R3-selftest: no pre-fix violation for ${rustSelfTestFails.join(", ")} — a check that cannot fail is decoration`,
  )
  const ok = okCFamily && okRust

  console.log(lines.join("\n"))
  for (const v of [...violations, ...rustViolations].slice(0, 20)) console.log(`   ${v.lang} ${v.file} ${v.check} ${v.detail}`)
  console.log(
    `\n${ok ? "PASS" : "FAIL"} — ${ok ? "c/cpp 3/3 + rust 2/2 + 2 self-tests" : `c/cpp ${violations.length} violation(s)/${selfTestFails.length} dead check(s), rust ${rustViolations.length} violation(s)/${rustSelfTestFails.length} dead check(s)`}`,
  )

  if (process.argv.includes("--emit")) {
    emitEvidence({
      issueId: "M14.0.F14",
      title: "A lane publishes NAMES: C/C++ call targets and symbol names (#924), rust name-bearing targets and symbol names (#798/R10)",
      claimLevel: "L1",
      layers: ["corpus", "mutation"],
      checks: [
        { id: "V1-no-whitespace-call-target", description: `no published call target contains whitespace (${calls} calls over ${files} files); PRE-FIX derivation flags ${preByCheck.get("V1-no-whitespace-target") ?? 0}`, status: (byCheck.get("V1-no-whitespace-target") ?? 0) === 0 ? "pass" : "fail" },
        { id: "V2-no-cast-call-target", description: `no call target spells a builtin type keyword; PRE-FIX derivation flags ${preByCheck.get("V2-no-cast-target") ?? 0}`, status: (byCheck.get("V2-no-cast-target") ?? 0) === 0 ? "pass" : "fail" },
        { id: "V3-symbol-name-is-a-name", description: `a whitespace-bearing symbol name is only the two deliberate classes (#919 macro-heading, operator spelling); ${deliberate} published, ${byCheck.get("V3-name-is-a-name") ?? 0} violations`, status: (byCheck.get("V3-name-is-a-name") ?? 0) === 0 ? "pass" : "fail" },
        { id: "V4-selftest-prefix-is-caught", description: `the pre-fix callee rule (from the source) and the pre-fix declarator read (from the tree) trip every check`, status: selfTestFails.length === 0 ? "pass" : "fail" },
        { id: "R1-no-whitespace-name-target", description: `rust: every name-bearing relationship TARGET (all labels except the module paths \`imports\`/\`exports\`) is a rust name path — ${rustTargets} targets over the FULL extent of ripgrep+cargo (${rustFiles} files); PRE-FIX derivation flags ${rustPreByCheck.get("R1-no-whitespace-name-target") ?? 0}`, status: (rustByCheck.get("R1-no-whitespace-name-target") ?? 0) === 0 ? "pass" : "fail" },
        { id: "R2-symbol-name-is-a-rust-name", description: `rust: every published symbol name is a \`::\`-joined path of rust identifiers (a RAW identifier keeps its \`r#\` prefix — see the limitations) with no bare keyword segment — ${rustSymbols} symbols; PRE-FIX derivation flags ${rustPreByCheck.get("R2-symbol-name-is-a-rust-name") ?? 0}`, status: (rustByCheck.get("R2-symbol-name-is-a-rust-name") ?? 0) === 0 ? "pass" : "fail" },
        { id: "R3-selftest-prefix-is-caught", description: `rust: the pre-fix impl-target rule, re-derived from the TREE (${rustPreTargets} spellings), trips both rust checks`, status: rustSelfTestFails.length === 0 ? "pass" : "fail" },
      ],
      limitations: [
        `sample: up to ${PER_LANE_LIMIT} files per corpus for the C/C++ lanes (jq, sqlite, fmt, nlohmann-json), excluding test/docs/third-party directories — the full-corpus A/B is script/m14/tmp/c924-calls-ab.ts and c924qid-ab.ts. Rust is the exception and is read at full extent; the per-lane counts are pinned in corpusPins`,
        "V1's invariant (an identifier contains no whitespace) is a language fact, not a parser fact: a lane that publishes expression text as a callee violates it in any C/C++ file",
        "the differential oracle downstream of this lane derives its truth from the same rules, so F5 could not see any of these three classes; this gate is deliberately independent of them (its keyword list is written out here, not imported)",
        "V3 pins the two DELIBERATE whitespace classes by name (#919 macro-heading metadata, `operator` spellings); it does not judge whether those two decisions are right, only that nothing else leaks into them",
        "one `calls -> uint64_t` remains on the corpora by deliberate decision (a typedef name IS a legal identifier, so refusing it by name would be a heuristic) and is therefore not a V2 violation",
        "rust is measured over the FULL EXTENT of ripgrep + cargo (every non-test/docs `.rs` file), NOT on a draw — and NOT on the M60 census's 40-file spread, because the file that carried the R10 conviction (cargo/crates/cargo-test-support/src/lib.rs) is absent from that spread and present at caps 400 and 1400 (script/m14/tmp/rust-798-draw-check.ts). Reading the census's draw here would have made this gate unable to fail on the defect it was written for, so the gate deliberately reads MORE than the census; the census's own full-extent reading is `--lane rust --sample 2285`. The rust checks are R1/R2 with the R3 self-test, NOT the C/C++ V1/V2/V3",
        "RUST IS NOT GIVEN THE C/C++ V2 (no call target spells a builtin type keyword) because that claim is FALSE about rust: its primitive names are not keywords, so `fn usize()` is legal. Measured on rust's own files through this gate (script/m14/tmp/rust-798-calls-keywords.ts): 18 published `calls` targets spell a primitive name and every one is a real call to a real function — `convert::usize(&v.unwrap_value())` at ripgrep/crates/core/flags/defs.rs:264, whose module declares `pub(super) fn usize(v: &OsStr) -> anyhow::Result<usize>`. Importing that predicate would have convicted 18 correct edges",
        "R2 ACCEPTS A RAW IDENTIFIER'S `r#` PREFIX as the identifier's own spelling: `r#try`/`r#async` cannot be written any other way in source, the prefix is carried on BOTH the symbol and its targets (so the edge resolves — symbol and target census: refTargetNotName 0), and the alternative is prohibited by R2 itself, since a stripped name would be the bare keyword `try`/`async`. Measured on rust: ripgrep 1 symbol + 1 target, cargo 2 symbols + 11 targets",
      ],
      corpusPins: LANES.map((l) => ({ repo: l.dirs.join("+"), lang: l.lang, files: filesByLane.get(l.lang) ?? 0, draw: l.why ?? `first ${PER_LANE_LIMIT} sorted files per corpus` })),
      data: {
        files,
        symbols,
        calls,
        deliberateWhitespaceNames: deliberate,
        violations: violations.length,
        byCheck: Object.fromEntries(byCheck),
        prefixViolations: preViolations.length,
        prefixByCheck: Object.fromEntries(preByCheck),
        samples: violations.slice(0, 20),
        rust: {
          files: rustFiles,
          nameBearingTargets: rustTargets,
          symbols: rustSymbols,
          prefixImplTargetSpellings: rustPreTargets,
          violations: rustViolations.length,
          byCheck: Object.fromEntries(rustByCheck),
          prefixViolations: rustPreViolations.length,
          prefixByCheck: Object.fromEntries(rustPreByCheck),
          samples: rustViolations.slice(0, 20),
        },
      },
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
