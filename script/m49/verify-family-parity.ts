// script/m49/verify-family-parity.ts — M49.G9: analyzer-vs-analyzer parity.
//
// The two ruling memos of the web family (`dup-key-ruling-memo.md` and
// `ruling-813-814.md`) were both found by *family-wide precedent probes*, not
// by any lane or per-language review: a construct whose answer differs across
// analyzers is invisible to a gate that compares one analyzer against its own
// oracle (F5 does exactly that, and the F5 comparison is deliberately
// site-agnostic — it matches label+target and never the source, so a source
// divergence cannot show up there by construction).
//
// This gate makes the class un-recurrable: for each shared CONSTRUCT it runs
// the SAME source shape through every declared analyzer and compares the
// observed attribution to a DECLARED value in `validation/m49/family-parity.json`.
// A language may be:
//   - `"<value>"`  — the observed attribution must equal it (agreement pinned),
//   - `gap`        — the language declares NO edge yet, with a reason framing
//                    the registered issue; if it starts emitting, the gate
//                    fires so the gap is re-adjudicated rather than silently
//                    becoming a divergence.
// A declaration whose state is `gap` must cite an issue: a silent divergence is
// exactly what this gate exists to forbid.
//
// Modes:
//   bun run script/m49/verify-family-parity.ts            # gate
//   bun run script/m49/verify-family-parity.ts --emit     # print live observations
//
// Evidence: validation/m49/family-parity.json (declarations)
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const WASM_DIR = path.join(ROOT, "wasm")
const DATA = path.join(ROOT, "validation", "m49", "family-parity.json")
const EMIT = process.argv.includes("--emit")

const LANGS: Record<string, { wasm: string; file: string; cls: string; ext: string }> = {
  java: { wasm: "tree-sitter-java.wasm", file: "real-java-analyzer", cls: "RealJavaAnalyzer", ext: "java" },
  javascript: { wasm: "tree-sitter-javascript.wasm", file: "real-javascript-analyzer", cls: "RealJavaScriptAnalyzer", ext: "js" },
  typescript: { wasm: "tree-sitter-typescript.wasm", file: "real-typescript-analyzer", cls: "RealTypeScriptAnalyzer", ext: "ts" },
  swift: { wasm: "tree-sitter-swift.wasm", file: "real-swift-analyzer", cls: "RealSwiftAnalyzer", ext: "swift" },
  kotlin: { wasm: "tree-sitter-kotlin.wasm", file: "real-kotlin-analyzer", cls: "RealKotlinAnalyzer", ext: "kt" },
  scala: { wasm: "tree-sitter-scala.wasm", file: "real-scala-analyzer", cls: "RealScalaAnalyzer", ext: "scala" },
  python: { wasm: "tree-sitter-python.wasm", file: "real-python-analyzer", cls: "RealPythonAnalyzer", ext: "py" },
  dart: { wasm: "tree-sitter-dart.wasm", file: "real-dart-analyzer", cls: "RealDartAnalyzer", ext: "dart" },
  cpp: { wasm: "tree-sitter-cpp.wasm", file: "real-cpp-analyzer", cls: "RealCppAnalyzer", ext: "cpp" },
  csharp: { wasm: "tree-sitter-c_sharp.wasm", file: "real-csharp-analyzer", cls: "RealCSharpAnalyzer", ext: "cs" },
  php: { wasm: "tree-sitter-php.wasm", file: "real-php-analyzer", cls: "RealPhpAnalyzer", ext: "php" },
  go: { wasm: "tree-sitter-go.wasm", file: "real-go-analyzer", cls: "RealGoAnalyzer", ext: "go" },
  rust: { wasm: "tree-sitter-rust.wasm", file: "real-rust-analyzer", cls: "RealRustAnalyzer", ext: "rs" },
}

interface Construct {
  id: string
  description: string
  /** The member name whose attribution is being tracked. */
  target: string
  /** One source shape per language, all expressing the SAME construct. */
  snippets: Record<string, string>
}

// The construct that produced the #814 ruling: a read of an OWN member through
// the receiver, from inside a method. `count` is the tracked member.
const CONSTRUCTS: Construct[] = [
  {
    id: "member-read-through-receiver",
    description: "a read of an own member through the receiver (this/self/$this/s.) from inside a method",
    target: "count",
    snippets: {
      java: ["class Store {", "  int count = 0;", "  int read() {", "    return this.count;", "  }", "}", ""].join("\n"),
      javascript: ["class Store {", "  count = 0;", "  read() {", "    return this.count;", "  }", "}", ""].join("\n"),
      typescript: ["class Store {", "  count = 0;", "  read(): number {", "    return this.count;", "  }", "}", ""].join("\n"),
      swift: ["class Store {", "  var count = 0", "  func read() -> Int {", "    return self.count", "  }", "}", ""].join("\n"),
      kotlin: ["class Store {", "  val count = 0", "  fun read(): Int {", "    return this.count", "  }", "}", ""].join("\n"),
      scala: ["class Store {", "  val count = 0", "  def read: Int = this.count", "}", ""].join("\n"),
      python: ["class Store:", "    def __init__(self):", "        self.count = 0", "    def read(self):", "        return self.count", ""].join("\n"),
      dart: ["class Store {", "  int count = 0;", "  int read() {", "    return this.count;", "  }", "}", ""].join("\n"),
      cpp: ["class Store {", "public:", "  int count = 0;", "  int read() {", "    return this->count;", "  }", "};", ""].join("\n"),
      csharp: ["class Store {", "  int count = 0;", "  int read() {", "    return this.count;", "  }", "}", ""].join("\n"),
      php: ["<?php", "class Store {", "  public int $count = 0;", "  function read() {", "    return $this->count;", "  }", "}", ""].join("\n"),
      go: ["package probe", "type Store struct {", "  count int", "}", "func (s Store) read() int {", "  return s.count", "}", ""].join("\n"),
      rust: ["struct Store {", "  count: i32,", "}", "impl Store {", "  fn read(&self) -> i32 {", "    self.count", "  }", "}", ""].join("\n"),
    },
  },
  {
    id: "private-member-declared-name",
    description: "the graph name of a `#`-private member: the declared symbol spelling must be the one every reading edge targets (M49 W15 #813)",
    target: "hidden",
    snippets: {
      // Only languages with `#` private-member syntax participate; the gate
      // requires every OTHER declared language to say so explicitly rather
      // than be silently absent.
      javascript: ["class Store {", "  #hidden = 1;", "  peek() {", "    return this.#hidden;", "  }", "}", ""].join("\n"),
      typescript: ["class Store {", "  #hidden = 1;", "  peek() {", "    return this.#hidden;", "  }", "}", ""].join("\n"),
    },
  },
]

interface Observation {
  /** "none" when the analyzer emitted no `uses` edge for the target. */
  source: string
  confidence: number | null
  /** For identity constructs: the declared symbol spelling of the target. */
  symbolName?: string | null
  /** The target the `uses` edge actually names (null when there is no edge). */
  edgeTarget?: string | null
  /** How that target spells the member: `count` is "bare", `Store.count" is "qualified". */
  targetSpelling?: "bare" | "qualified" | null
}

async function observe(construct: Construct, lang: string): Promise<Observation> {
  const cfg = LANGS[lang]
  const src = construct.snippets[lang]
  if (!cfg || !src) return { source: "unsupported", confidence: null }
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const language = await L.load(readFileSync(path.join(WASM_DIR, cfg.wasm)))
  const parser = new P()
  parser.setLanguage(language)
  const tree = parser.parse(src)
  if (tree.rootNode.hasError) return { source: "parse-error", confidence: null }
  const mod = await import(`../../src/ast/${cfg.file}`)
  const result = await new mod[cfg.cls]().analyze(tree.rootNode, src, `parity.${cfg.ext}`)
  // The tracked member may be spelled with a `#` (a private member's declared
  // name is the whole point of the identity construct), so both sides accept
  // the bare and the `#`-prefixed spelling and the DECLARATION decides which
  // one is correct — that is what makes the #813 ruling gate-able.
  //
  // OWNER-QUALIFICATION IS ALSO A MATCH, and this is a MEASUREMENT fix, not a
  // relaxation. The matcher used to accept only the bare spelling, so an
  // analyzer that published the member as `Store.count` — the same spelling the
  // fleet's dart `contains` ruling REQUIRES, because a bare member name repeated
  // across a project is ambiguous by construction — was observed as `"none"`,
  // indistinguishable from an analyzer that emitted no edge at all. That is what
  // made dart and php report `declared source "read", observed "none"` while both
  // were emitting `uses read -> Store.count` at confidence 0.9. The edge is found
  // under either spelling and the SPELLING ITSELF becomes a declared axis below.
  const memberMatches = (t: unknown) => {
    const s = String(t)
    if (s === construct.target || s === `#${construct.target}`) return true
    const leaf = s.slice(s.lastIndexOf(".") + 1)
    return leaf === construct.target || leaf === `#${construct.target}`
  }
  const rel = (result.relationships ?? []).find(
    (x: any) => (x.type ?? x.relationshipType) === "uses" && memberMatches(x.target),
  )
  const sym = (result.symbols ?? []).find((s: any) => memberMatches(s.name))
  return {
    source: rel ? String(rel.source) : "none",
    confidence: rel ? (typeof rel.confidence === "number" ? rel.confidence : null) : null,
    symbolName: sym ? String(sym.name) : null,
    edgeTarget: rel ? String(rel.target) : null,
    targetSpelling: rel ? (String(rel.target).includes(".") ? "qualified" : "bare") : null,
  }
}

let checks = 0, passed = 0, failed = 0, negatives = 0
const failures: string[] = []
function check(name: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else { failed++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`) }
}
function negative(name: string, ok: boolean, detail = "") { negatives++; check(`${name} [negative]`, ok, detail) }

/**
 * The comparison rule, isolated so the negatives below can drive it with
 * synthetic observations (a gate whose rule cannot fail is not a gate).
 */
function compare(declared: any, observed: Observation): { ok: boolean; detail: string } {
  if (declared?.state === "gap") {
    if (observed.source === "none") return { ok: true, detail: "" }
    return { ok: false, detail: `declared a GAP but the analyzer now emits uses ${observed.source} -> ${construct?.id ?? ""}` }
  }
  if (declared?.state === "unsupported") {
    return observed.source === "unsupported" || observed.source === "parse-error"
      ? { ok: true, detail: "" }
      : { ok: false, detail: `declared unsupported but observed "${observed.source}"` }
  }
  if (observed.source !== declared?.source) {
    return { ok: false, detail: `declared source "${declared?.source}", observed "${observed.source}"` }
  }
  if (declared?.symbolName !== undefined && declared.symbolName !== observed.symbolName) {
    return { ok: false, detail: `declared symbol name "${declared.symbolName}", observed "${observed.symbolName}"` }
  }
  // THE SPELLING AXIS, declared per lane. Before this, a lane could flip its edge
  // target from `count` to `Store.count` — or to anything whose leaf matched —
  // and the gate would not see it: the matcher normalised the difference away.
  // Pinning it makes the check STRONGER than the one it replaces.
  if (declared?.edgeTargetSpelling !== undefined && observed.targetSpelling !== declared.edgeTargetSpelling) {
    return {
      ok: false,
      detail: `declared edge-target spelling "${declared.edgeTargetSpelling}", observed "${observed.targetSpelling}" (target "${observed.edgeTarget}")`,
    }
  }
  return { ok: true, detail: "" }
}
let construct: Construct | null = null

async function main() {
  if (!existsSync(DATA)) {
    if (EMIT) {
      const out: Record<string, any> = {}
      for (const c of CONSTRUCTS) {
        out[c.id] = {}
        for (const lang of Object.keys(c.snippets)) out[c.id][lang] = await observe(c, lang)
      }
      console.log(JSON.stringify(out, null, 2))
      return
    }
    console.log("FAIL family-parity declarations missing (validation/m49/family-parity.json)")
    process.exitCode = 1
    return
  }
  const data = JSON.parse(readFileSync(DATA, "utf8"))
  check("declarations carry a schemaVersion", typeof data.schemaVersion === "number")
  check("declarations cover every declared construct", CONSTRUCTS.every((c) => !!data.constructs?.[c.id]))
  check("declarations cover no unknown construct", Object.keys(data.constructs ?? {}).every((id) => CONSTRUCTS.some((c) => c.id === id)))

  for (const c of CONSTRUCTS) {
    construct = c
    const declared = data.constructs?.[c.id] ?? {}
    // Construct-level documentation keys are not language declarations.
    const META_KEYS = new Set(["description", "trackedMember", "declaredAt"])
    const langsDeclared = Object.keys(declared).filter((k) => !META_KEYS.has(k))
    // Every language with a snippet must be declared — a snippet added without a
    // declaration (or vice versa) is drift, not coverage. An `unsupported`
    // declaration legitimately has NO snippet (that is what it declares), but it
    // must still carry a reason.
    check(`${c.id}: every snippet language is declared`, Object.keys(c.snippets).every((lang) => !!declared[lang]),
      `undeclared: ${Object.keys(c.snippets).filter((lang) => !declared[lang]).join(", ")}`)
    check(`${c.id}: every non-unsupported declaration has a snippet`,
      langsDeclared.every((lang) => !!c.snippets[lang] || declared[lang]?.state === "unsupported"),
      `no snippet for: ${langsDeclared.filter((lang) => !c.snippets[lang] && declared[lang]?.state !== "unsupported").join(", ")}`)
    // A declared gap/unsupported state must carry a reason AND (for a gap) an
    // issue number: a silent divergence is the thing this gate forbids.
    for (const lang of langsDeclared) {
      const d = declared[lang]
      if (d?.state === "gap") check(`${c.id}/${lang}: gap cites an issue`, /#\d+/.test(String(d.reason ?? "")) && !!(d.issue ?? /#\d+/.test(String(d.reason ?? ""))),
        "a gap without a registered issue is an unowned divergence")
      if (d?.state === "unsupported") check(`${c.id}/${lang}: unsupported cites a reason`, String(d.reason ?? "").length > 10)
    }
    for (const lang of langsDeclared) {
      const observed = await observe(c, lang)
      const verdict = compare(declared[lang], observed)
      check(`${c.id}/${lang}: attribution matches the declaration`, verdict.ok, verdict.detail)
    }
  }

  // Negative: the rule must reject a wrong declaration and accept the right one.
  negative("rule rejects a mismatched source",
    !compare({ source: "Store" }, { source: "read", confidence: 0.6 }).ok)
  negative("rule accepts a matching source",
    compare({ source: "read" }, { source: "read", confidence: 0.6 }).ok)
  negative("rule rejects a gap that now emits",
    !compare({ state: "gap", reason: "x", issue: "#740" } as any, { source: "read", confidence: 0.6 } as any).ok)
  negative("rule accepts a gap that is still silent",
    compare({ state: "gap", reason: "x", issue: "#740" } as any, { source: "none", confidence: null } as any).ok)
  negative("rule rejects a wrong declared symbol name",
    !compare({ source: "read", symbolName: "#count" }, { source: "read", confidence: 0.6, symbolName: "count" }).ok)
  // The spelling axis, both directions — and these are the controls for the fix
  // that made dart/php readable: an edge that EXISTS under a qualified spelling
  // must be found (so `source` is compared, not reported as "none"), while a lane
  // whose spelling differs from its declaration must still FAIL.
  negative("rule accepts a qualified edge target that the declaration pins as qualified",
    compare({ source: "read", edgeTargetSpelling: "qualified" },
      { source: "read", confidence: 0.9, edgeTarget: "Store.count", targetSpelling: "qualified" }).ok)
  negative("rule rejects a lane that flips its edge-target spelling",
    !compare({ source: "read", edgeTargetSpelling: "bare" },
      { source: "read", confidence: 0.9, edgeTarget: "Store.count", targetSpelling: "qualified" }).ok)
  negative("rule rejects a lane that drops its edge entirely",
    !compare({ source: "read", edgeTargetSpelling: "bare" },
      { source: "none", confidence: null, edgeTarget: null, targetSpelling: null }).ok)

  console.log(`M49.G9: ${passed}/${checks} checks passed, ${negatives} negative(s) exercised`)
  if (failed > 0) {
    console.error(`family-parity FAILED:\n  ${failures.join("\n  ")}`)
    process.exitCode = 1
  }
}

await main()
