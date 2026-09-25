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

const LANES: Array<{ lang: "c" | "cpp" | "rust" | "go" | "clean"; dirs: string[]; exts: string[]; limit?: number; why?: string }> = [
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
  // GO (#799 round, R10): go rides the M60 corpora at FULL EXTENT for the same
  // measured reason rust does — a name-surface gate that samples the way the
  // census samples inherits the census's blind spot. This round's go work is
  // exactly a name-surface change (a qualified type USE is published by leaf,
  // and the import path moved off `references` onto the family's `imports`
  // label), so the gate reads every `.go` file of both corpora and its counts
  // are then comparable to the census's own full-draw reading
  // (`--lane go --sample 2200`: syms=25962 rels=270842 sep=11933).
  {
    lang: "go", dirs: ["go-tools", "terraform"], exts: [".go"], limit: Number.MAX_SAFE_INTEGER,
    why: "full extent of both corpora — the R10 census's canonical draw is 40 go-tools + 24 terraform files, and the class this round changed is sparse (a qualified type use, an import path); reading the draw would let the gate read clean on files it never opened.",
  },
  {
    lang: "clean",
    dirs: ["Clyde", "clean-stdlib", "Prelude", "cloogle.org", "eastwood"],
    exts: [".icl", ".dcl"],
    limit: Number.MAX_SAFE_INTEGER,
    why: "EVERY Clean source base on this machine — the defect is present in 15.3% of declarations, so a 40-file draw is enough to see it, but the count that matters is the one a lane can quote and 312 files is all this box has. Reading the full extent is also what makes C1's violation count comparable with the fix's own measurement (704 declarations over the same 312 files).",
  },
]
/**
 * The fifth name-surface class, found while adjudicating tree-sitter-clean v1.2.7 — and the
 * only one of the five that is not about a string that is not a name, but about WHICH name was
 * read at all.
 *
 * `processFunction` read the declared name as `findChild(node, n => n.type === "identifier")`,
 * the FIRST identifier child. Both the pinned v1.2.4 and the v1.2.7 grammar expose the name as
 * the `name:` FIELD, and the heuristic is wrong wherever the name is not typed `identifier` —
 * an uppercase definition's name is a `constructor`, so the heuristic skipped it and published
 * the first PARAMETER instead. Measured over this lane's five corpora (script/m14/tmp/
 * clean-127-name-field.ts):
 *
 *   pinned v1.2.4 : 4,607 declarations — 452 published a parameter as the name, 252 dropped
 *   v1.2.7        : 4,647 declarations — 447 published a parameter as the name, 244 dropped
 *
 * So it is a live HEAD defect in BOTH grammars and not something the grammar bump introduced:
 * `NSMakeSize w h #! ptr = …` was published as `function:w`, `AppDelDidFinishLaunching
 * impAppDelDidFinishLaunching self cmd …` as `function:impAppDelDidFinishLaunching`, and the
 * 122-row ``where``-local/fabrication residue of the v1.2.7 adjudication is mostly this one rule.
 *
 * The checks are written against the FIELD, computed here and not imported from the analyzer
 * (a gate that shares the rule cannot see the rule):
 *   C1  every module-level definition's DECLARED name is published somewhere in its file.
 *   C2  no published function/method name is one the file never declares — this is the check
 *       that a parameter published under its own name fails.
 *   C-PRE  the pre-fix name derivation (first `identifier` child) re-derived from the same
 *       trees must trip C1 — without it the check is decoration.
 */
const CLEAN_DECL_TYPES = new Set(["function_declaration", "type_signature"])

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

// ---------------------------------------------------------------------- go
//
// Go's name predicate, written out HERE rather than imported from the analyzer
// (a gate that shares the rule cannot see the rule). Go has no raw identifiers,
// no operator declarations and no qualified declaration names, so the predicate
// is the spec's own: an identifier is a `letter` (unicode_letter or `_`)
// followed by letters and unicode DIGITS. IT IS NOT ASCII, and the first draft
// of this gate proved why: an ASCII-only predicate convicted 41 `uses` targets
// and 86 symbols on these corpora — every one a LEGAL identifier, because
// go-tools' own `go/ssa/interp/external.go` writes `ext۰bytes۰Equal` with an
// Arabic zero numeral U+06F0 (category Nd) as a "dot" and says so in a comment
// above it. A name predicate that is narrower than the language convicts the
// language; the calibration belongs in the predicate, not in an allowlist.
// (`\p{L}` = unicode_letter, `\p{Nd}` = unicode_digit, per the Go spec.)
const GO_IDENT = /^[\p{L}_][\p{L}\p{Nd}_]*$/u
function goNameDefect(name: string): string | null {
  if (name.trim() === "") return "empty name"
  if (!GO_IDENT.test(name)) return "not a Go identifier (whitespace, punctuation, or a qualified/wrapper spelling)"
  return null
}

/**
 * GO-PRE: the two spellings this round retired, re-derived from the TREE (never
 * from the analyzer).
 *
 *   (a) every `qualified_type` node's own text — `io.Writer`, `time.Time`,
 *       `types.Importer`. That is what `references/declared_type` and
 *       `references/return_type` published before the round, and the whole
 *       reason `references|.` stood in the lane's separator vocabulary.
 *   (b) every import spec's PATH — `net/http`, `github.com/google/go-cmp/cmp`.
 *       That is the target the import-dependency edge carried while it was
 *       labelled `references`: a module specifier, which is not a name at all.
 *
 * Both are strings the source writes and neither is a Go identifier, so the
 * gate MUST flag them — that is the self-test, and it is derived from the
 * grammar rather than copied from the rule it checks.
 */
function prefixGoTargets(root: any): string[] {
  const out: string[] = []
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "qualified_type") out.push(String(n.text ?? ""))
    if (n.type === "import_spec") {
      const kids: any[] = n.namedChildren ?? []
      const path = kids.find((c: any) => c.type === "interpreted_string_literal" || c.type === "raw_string_literal")
      if (path) out.push(String(path.text ?? "").replace(/^["`]/, "").replace(/["`]$/, ""))
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
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
  // GO (#799 round): go's own counters, same discipline — the gate has to be
  // able to say how many name-bearing targets and symbols it adjudicated.
  const goViolations: Violation[] = []
  const goPreViolations: Violation[] = []
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
  let goTargets = 0
  let goSymbols = 0
  let goPreTargets = 0
  // Clean's own counters (M60 functional lane) — see the CLEAN_DECL_TYPES header.
  const cleanViolations: Violation[] = []
  const cleanPreViolations: Violation[] = []
  let cleanFiles = 0
  let cleanDeclarations = 0
  let cleanMissing = 0
  let cleanFabricated = 0
  let cleanPreMissing = 0
  let cleanPreFabricated = 0

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

      if (lane.lang === "clean") {
        // C1/C2 over the tree's own `name:` fields, and C-PRE over the pre-fix derivation.
        const root = (await getParser("clean" as any)).parse(src).rootNode
        const declaredNow = new Set<string>()
        const declaredPre = new Set<string>()
        const memberSignatures = new Set<string>()
        // What the PRE-FIX rule would have published for every module-level definition, so C2
        // can be given the self-test its own doctrine requires rather than stated as decoration.
        const prePublished = new Set<string>()
        const stack: any[] = [root]
        while (stack.length > 0) {
          const n = stack.pop()!
          if (n.type === "function_declaration" || n.type === "type_signature") {
            const field = n.childForFieldName?.("name") ?? null
            const declared = field?.text ? String(field.text) : null
            // Module-level only: a `where`-local is scoped noise by this lane's own design
            // (M11.11 closure boundary), so it is not a declaration C1 may require.
            let cur = n.parent
            let local = false
            while (cur) { if (cur.type === "where_block") { local = true; break } cur = cur.parent }
            // C1's population is DEFINITIONS only. A `type_signature` is a declaration of an
            // interface name and this lane deliberately publishes no symbol for it (it records
            // metadata and continues), so a signature is not a name C1 may demand — the first
            // draft of this check made that mistake and reported 1,078 "never published" rows
            // that were almost entirely `.dcl` signatures. Signatures are still collected, as
            // the ADMISSION set for C2: a class-member signature IS published, as a Method.
            if (n.type === "type_signature") {
              if (declared) memberSignatures.add(declared)
            } else {
              // The pre-fix derivation, from the same node: the first `identifier` child.
              let firstId: any = null
              for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c?.type === "identifier") { firstId = c; break } }
              if (!local && declared) {
                declaredNow.add(declared)
                cleanDeclarations++
                if (firstId?.text) declaredPre.add(String(firstId.text))
              }
              if (declared) prePublished.add(firstId?.text ? String(firstId.text) : "\u0000dropped")
            }
          }
          for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
        }
        const publishedFn = new Set<string>()
        for (const s of r.symbols ?? []) {
          const kind = String(s.kind ?? "")
          if (kind === "function" || kind === "Function" || kind === "method" || kind === "Method") {
            publishedFn.add(String(s.name ?? ""))
          }
        }
        // C1 — a declared name that is never published. This is the defect's own signature:
        // under the pre-fix rule the declared name is replaced by a parameter, or dropped.
        for (const d of declaredNow) {
          if (publishedFn.has(d)) continue
          cleanMissing++
          if (cleanViolations.length < 60) cleanViolations.push({ file: rel, lang: "clean", check: "C1-declared-name-is-published", detail: `declares ${JSON.stringify(d)}; published ${JSON.stringify([...publishedFn].slice(0, 3))}` })
        }
        // C2 — a published function/method name the file never declares. Class-member
        // signatures are published as Method symbols, so they are admitted by name.
        for (const p of publishedFn) {
          if (declaredNow.has(p) || memberSignatures.has(p)) continue
          // A multi-clause function's later clauses are merged, and the merged symbol carries
          // the first clause's name — so `declaredNow` is the right admission set here too.
          cleanFabricated++
          if (cleanViolations.length < 60) cleanViolations.push({ file: rel, lang: "clean", check: "C2-no-undeclared-name", detail: `${JSON.stringify(p)} is published but never declared in this file` })
        }
        // C2-PRE — the same predicate over the pre-fix derivation's published names.
        for (const p of prePublished) {
          if (p === "\u0000dropped") { cleanPreFabricated++; continue }
          if (declaredNow.has(p) || memberSignatures.has(p)) continue
          cleanPreFabricated++
          if (cleanPreViolations.length < 60) cleanPreViolations.push({ file: rel, lang: "clean", check: "C2-no-undeclared-name", detail: `pre-fix derivation would publish ${JSON.stringify(p)}, which this file never declares` })
        }
        // C-PRE — the same C1 predicate, applied to the pre-fix derivation.
        for (const d of declaredNow) {
          if (declaredPre.has(d)) continue
          cleanPreMissing++
          if (cleanPreViolations.length < 60) cleanPreViolations.push({ file: rel, lang: "clean", check: "C1-declared-name-is-published", detail: `pre-fix derivation never publishes ${JSON.stringify(d)}` })
        }
        cleanFiles++
        continue
      }

      if (lane.lang === "go") {
        // G1: every name-bearing target is a Go identifier. The ONE exemption
        // is the module SPECIFIER on an `imports` edge (named here, not
        // tolerated silently): a path is the dependency's own spelling, which
        // is why this round moved it off `references` and onto the family's
        // `imports` label instead of ruling the separators into the references
        // surface where they would have excused a real spelling defect too.
        for (const e of r.relationships ?? []) {
          const label = String(e.type ?? "")
          if (label === "imports") continue
          if (e.target === undefined || e.target === null) continue
          goTargets++
          const t = String(e.target)
          const bad = goNameDefect(t)
          if (bad) goViolations.push({ file: rel, lang: "go", check: "G1-target-is-a-go-name", detail: `${label} -> ${JSON.stringify(t.slice(0, 80))} — ${bad}` })
        }
        // G2: every published SYMBOL name is a Go identifier.
        for (const s of r.symbols ?? []) {
          goSymbols++
          const bad = goNameDefect(String(s.name ?? ""))
          if (bad) goViolations.push({ file: rel, lang: "go", check: "G2-symbol-name-is-a-go-name", detail: `${String(s.kind)} ${JSON.stringify(String(s.name ?? "").slice(0, 80))} — ${bad}` })
        }
        // G1's self-test: the retired spellings, re-derived from the tree.
        const goRoot = (await ASTEngine.getParser("go" as any)).parse(src).rootNode
        for (const t of prefixGoTargets(goRoot)) {
          goPreTargets++
          const bad = goNameDefect(t)
          if (bad) goPreViolations.push({ file: rel, lang: "go", check: "G1-target-is-a-go-name", detail: `${JSON.stringify(t.slice(0, 60))} — ${bad}` })
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
  // GO (#799 round): G1 with its tree-derived self-test; G2 is an INVARIANT
  // without one, and the reason is stated in the limitations rather than
  // papered over — the strings GO-PRE recovers are TARGET spellings, and this
  // lane never published a non-name SYMBOL (its non-name symbol shapes were
  // published as nothing at all, the #889 class).
  const goByCheck = new Map<string, number>()
  for (const v of goViolations) goByCheck.set(v.check, (goByCheck.get(v.check) ?? 0) + 1)
  const goPreByCheck = new Map<string, number>()
  for (const v of goPreViolations) goPreByCheck.set(v.check, (goPreByCheck.get(v.check) ?? 0) + 1)
  const goFiles = filesByLane.get("go") ?? 0
  lines.push(`go corpus: ${goFiles} files (FULL extent of ${LANES.find((l) => l.lang === "go")?.dirs.join("+")}), ${goTargets} name-bearing targets (module specifiers excluded by name), ${goSymbols} symbols, ${goPreTargets} RETIRED spellings re-derived from the tree`)
  show("G1-target-is-a-go-name", goByCheck.get("G1-target-is-a-go-name") ?? 0, goPreByCheck.get("G1-target-is-a-go-name") ?? 0, (goByCheck.get("G1-target-is-a-go-name") ?? 0) === 0)
  show("G2-symbol-name-is-a-go-name", goByCheck.get("G2-symbol-name-is-a-go-name") ?? 0, 0, (goByCheck.get("G2-symbol-name-is-a-go-name") ?? 0) === 0)
  const goSelfTestFails = (goPreByCheck.get("G1-target-is-a-go-name") ?? 0) === 0 ? ["G1-target-is-a-go-name"] : []
  const okGo = goViolations.length === 0 && goSelfTestFails.length === 0
  lines.push(
    goSelfTestFails.length === 0
      ? "ok   G-PRE-selftest the retired spellings re-derived from these files trip G1 — the gate can fail"
      : "FAIL G-PRE-selftest: no pre-fix violation for G1-target-is-a-go-name — a check that cannot fail is decoration",
  )

  // CLEAN (M60 functional lane): C1 with a tree-derived self-test, C2 as an invariant.
  const cleanByCheck = new Map<string, number>()
  for (const v of cleanViolations) cleanByCheck.set(v.check, (cleanByCheck.get(v.check) ?? 0) + 1)
  const cleanFilesRead = filesByLane.get("clean") ?? 0
  lines.push(`clean corpus: ${cleanFilesRead} files (EVERY Clean source base on this machine), ${cleanDeclarations} module-level function definitions, ${cleanMissing} declared name(s) never published`)
  show("C1-declared-name-is-published", cleanMissing, cleanPreMissing, cleanMissing === 0)
  show("C2-no-undeclared-name", cleanFabricated, cleanPreFabricated, cleanFabricated === 0)
  // A gate that read nothing cannot fail: on this lane an empty population is itself a failure.
  const cleanSelfTestFails: string[] = []
  if (cleanDeclarations === 0) cleanSelfTestFails.push("C-zero-declarations-read")
  if (cleanPreMissing === 0) cleanSelfTestFails.push("C1-declared-name-is-published")
  if (cleanPreFabricated === 0) cleanSelfTestFails.push("C2-no-undeclared-name")
  const okClean = cleanViolations.length === 0 && cleanSelfTestFails.length === 0
  lines.push(
    cleanSelfTestFails.length === 0
      ? `ok   C-PRE-selftest the pre-fix derivation re-derived from these trees leaves ${cleanPreMissing} declared name(s) unpublished and publishes ${cleanPreFabricated} undeclared one(s) — the gate can fail`
      : `FAIL C-PRE-selftest: ${cleanSelfTestFails.join(", ")} — a check that cannot fail is decoration, and a check with no population has not looked`,
  )

  const ok = okCFamily && okRust && okGo && okClean

  console.log(lines.join("\n"))
  for (const v of [...violations, ...rustViolations, ...goViolations, ...cleanViolations].slice(0, 20)) console.log(`   ${v.lang} ${v.file} ${v.check} ${v.detail}`)
  console.log(
    `\n${ok ? "PASS" : "FAIL"} — ${ok ? "c/cpp 3/3 + rust 2/2 + go 2/2 + clean 2/2 + 4 self-tests" : `c/cpp ${violations.length} violation(s)/${selfTestFails.length} dead check(s), rust ${rustViolations.length} violation(s)/${rustSelfTestFails.length} dead check(s), go ${goViolations.length} violation(s)/${goSelfTestFails.length} dead check(s), clean ${cleanViolations.length} violation(s)/${cleanSelfTestFails.length} dead check(s)`}`,
  )

  if (process.argv.includes("--emit")) {
    emitEvidence({
      issueId: "M14.0.F14",
      title: "A lane publishes NAMES: C/C++ call targets and symbol names (#924), rust name-bearing targets and symbol names (#798/R10), go name-bearing targets and symbol names (#799/R10), clean declared names (#924 round, M60 functional lane)",
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
        { id: "G1-target-is-a-go-name", description: `go: every name-bearing relationship TARGET is a Go identifier — ${goTargets} targets over the FULL extent of go-tools+terraform (${goFiles} files), with the module SPECIFIER on an \`imports\` edge as the one named exemption; PRE-FIX derivation (qualified type texts + import paths, from the tree) flags ${goPreByCheck.get("G1-target-is-a-go-name") ?? 0}`, status: (goByCheck.get("G1-target-is-a-go-name") ?? 0) === 0 ? "pass" : "fail" },
        { id: "G2-symbol-name-is-a-go-name", description: `go: every published symbol name is a Go identifier — ${goSymbols} symbols; stated as an INVARIANT (see the limitations: this lane has never published a non-name symbol, so it has no pre-fix hit and is not given one)`, status: (goByCheck.get("G2-symbol-name-is-a-go-name") ?? 0) === 0 ? "pass" : "fail" },
        { id: "G-PRE-selftest", description: `go: the two spellings this round retired — qualified type texts re-published by leaf, import paths moved off \`references\` onto \`imports\` — re-derived from the TREE (${goPreTargets} spellings), trip G1`, status: goSelfTestFails.length === 0 ? "pass" : "fail" },
        { id: "C1-declared-name-is-published", description: `clean: every module-level definition's declared \`name:\` is published somewhere in its file — ${cleanDeclarations} definitions over ${cleanFilesRead} files (EVERY Clean source base on this machine), ${cleanMissing} violation(s); PRE-FIX derivation (first \`identifier\` child, re-derived from the same trees) leaves ${cleanPreMissing} declared name(s) unpublished`, status: cleanMissing === 0 ? "pass" : "fail" },
        { id: "C2-no-undeclared-name", description: `clean: no published function/method name is one the file never declares — ${cleanFabricated} violation(s); PRE-FIX derivation would publish ${cleanPreFabricated} undeclared name(s). This is the check a PARAMETER fails: \`NSMakeSize w h #! ptr = …\` was published as \`function:w\` and \`AppDelDidFinishLaunching impAppDelDidFinishLaunching self cmd …\` as \`function:impAppDelDidFinishLaunching\``, status: cleanFabricated === 0 ? "pass" : "fail" },
        { id: "C-PRE-selftest", description: `clean: the pre-fix name derivation, re-derived from these trees, trips C1 on ${cleanPreMissing} declared name(s) and C2 on ${cleanPreFabricated}`, status: cleanSelfTestFails.length === 0 ? "pass" : "fail" },
      ],
      limitations: [
        `sample: up to ${PER_LANE_LIMIT} files per corpus for the C/C++ lanes (jq, sqlite, fmt, nlohmann-json), excluding test/docs/third-party directories — the full-corpus A/B is script/m14/tmp/c924-calls-ab.ts and c924qid-ab.ts. Rust is the exception and is read at full extent; the per-lane counts are pinned in corpusPins`,
        "V1's invariant (an identifier contains no whitespace) is a language fact, not a parser fact: a lane that publishes expression text as a callee violates it in any C/C++ file",
        "the differential oracle downstream of this lane derives its truth from the same rules, so F5 could not see any of these three classes; this gate is deliberately independent of them (its keyword list is written out here, not imported)",
        "V3 pins the two DELIBERATE whitespace classes by name (#919 macro-heading metadata, `operator` spellings); it does not judge whether those two decisions are right, only that nothing else leaks into them",
        "one `calls -> uint64_t` remains on the corpora by deliberate decision (a typedef name IS a legal identifier, so refusing it by name would be a heuristic) and is therefore not a V2 violation",
        "rust is measured over the FULL EXTENT of ripgrep + cargo (every non-test/docs `.rs` file), NOT on a draw — and NOT on the M60 census's 40-file spread, because the file that carried the R10 conviction (cargo/crates/cargo-test-support/src/lib.rs) is absent from that spread and present at caps 400 and 1400 (script/m14/tmp/rust-798-draw-check.ts). Reading the census's draw here would have made this gate unable to fail on the defect it was written for, so the gate deliberately reads MORE than the census; the census's own full-extent reading is `--lane rust --sample 2285`. The rust checks are R1/R2 with the R3 self-test, NOT the C/C++ V1/V2/V3",
        "RUST IS NOT GIVEN THE C/C++ V2 (no call target spells a builtin type keyword) because that claim is FALSE about rust: its primitive names are not keywords, so `fn usize()` is legal. Measured on rust's own files through this gate (script/m14/tmp/rust-798-calls-keywords.ts): 18 published `calls` targets spell a primitive name and every one is a real call to a real function — `convert::usize(&v.unwrap_value())` at ripgrep/crates/core/flags/defs.rs:264, whose module declares `pub(super) fn usize(v: &OsStr) -> anyhow::Result<usize>`. Importing that predicate would have convicted 18 correct edges",
        "GO IS READ AT THE FULL EXTENT OF BOTH CORPORA (go-tools + terraform, every non-test/docs `.go` file), NOT on a draw — the class this round changed is sparse (one qualified type use, one import path), and go-tools carries 1 stray `.cpp` file that makes the differential's `--repo` probe mode abort (`differential: go-tools:cpp parsed 1 file(s) and derived ZERO truth edges`), which is why the go reading here does not come from a differential run",
        "G2 (a go symbol name is an identifier) IS STATED WITHOUT A SELF-TEST, deliberately: GO-PRE recovers TARGET spellings, and this lane has never published a non-name SYMBOL — its non-name symbol shapes were published as NOTHING at all (`Inner`/`*Pair[int, string]`/`io.Reader` embedded fields emitting nothing, the #889 class), so there is no pre-fix symbol string to flag. Writing one would be reclassifying a target as a symbol to make the counter move",
        "GO'S PREDICATE IS THE SPEC'S, NOT ASCII — and the gate's first draft was ASCII: it convicted 41 `uses` targets and 86 symbol names, every one a LEGAL Go identifier (`ext۰bytes۰Equal` in go-tools/go/ssa/interp/external.go, whose own comment names the character: `U+06F0`, an Arabic zero numeral in category Nd, which Go's identifier rule accepts as a unicode_digit). The narrower predicate was the defect, not the lane: it is recorded here because the same mistake would convict any lane whose source uses non-ASCII identifiers, and because the R10 census solves it differently — by CALIBRATING against the lane's own symbol alphabet (a character the lane's own symbols use can never be a separator) rather than by enumerating the language's character classes",
        "G1's ONE EXEMPTION is the module SPECIFIER on an `imports` edge: a Go import path is a string literal naming a module (`net/http`, `github.com/google/go-cmp/cmp`), not an identifier, and the lane publishes it on the family's `imports` label — which is exactly the label the R10 census now sees the lane's remaining separators on (`imports|.`, `imports|/`, `imports|-`, recorded as owed in validation/m60/target-spelling-register.json for go and for 17 other lanes). Nothing else is exempt: before this round the same paths rode `references`, and that IS a violation G1 would have flagged",
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
        go: {
          files: goFiles,
          nameBearingTargets: goTargets,
          symbols: goSymbols,
          retiredSpellingsReDerived: goPreTargets,
          violations: goViolations.length,
          byCheck: Object.fromEntries(goByCheck),
          prefixViolations: goPreViolations.length,
          prefixByCheck: Object.fromEntries(goPreByCheck),
          samples: goViolations.slice(0, 20),
        },
        clean: {
          files: cleanFilesRead,
          moduleLevelFunctionDefinitions: cleanDeclarations,
          declaredNamesNeverPublished: cleanMissing,
          undeclaredNamesPublished: cleanFabricated,
          prefixDerivationMissing: cleanPreMissing,
          prefixDerivationFabricated: cleanPreFabricated,
          violations: cleanViolations.length,
          byCheck: Object.fromEntries(cleanByCheck),
          prefixViolations: cleanPreViolations.length,
          samples: cleanViolations.slice(0, 20),
          prefixSamples: cleanPreViolations.slice(0, 20),
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
