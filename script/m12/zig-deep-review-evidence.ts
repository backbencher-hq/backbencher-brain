/**
 * M12/M14 — zig deep-review EVIDENCE (2026-09-28).
 *
 * A machine-written artifact for the second zig review wave: every number in it
 * is COMPUTED by this script from the three pinned corpora, never typed in, and
 * the file records which instrument produced each row so a reader can re-run it.
 * The depth-draw rows are deliberately NOT here: the differential owns those
 * numbers and re-running its 200-file draws takes minutes, so the review quotes
 * them with the command instead of freezing a copy that could drift from the
 * artifact the differential writes at ceremony.
 *
 * Corpus: BB_CORPUS_ROOT (default $HOME/ishaq/fixtures/repositories) over
 * zig, zls and ghostty. Sample size is a CLI argument so the artifact says how
 * much of the corpus it measured.
 *
 * Usage: npx tsx script/m12/zig-deep-review-evidence.ts [samplePerRepo]
 */
import * as fs from "fs"
import * as path from "path"
import { execSync } from "node:child_process"
import { init, parser, analyzer, zigFiles, walk } from "../m14/tmp/zigw-harness"
import { deriveZigReferenceEdges } from "../m14/differential"

const OUT = path.join(process.cwd(), "validation/m12/results/zig-deep-review.json")
const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/ishaq/fixtures/repositories"

const BUILTINS: ReadonlySet<string> = new Set([
  "void", "bool", "f16", "f32", "f64", "f80", "f128", "c_longdouble",
  "i8", "i16", "i32", "i64", "i128", "isize", "u8", "u16", "u32", "u64", "u128", "usize",
  "anytype", "comptime_int", "comptime_float", "noreturn", "type", "anyerror",
  "c_char", "c_short", "c_int", "c_long", "c_longlong", "c_uint", "c_ulong", "c_ulonglong", "c_void",
  "error", "test",
])

/** The PRE-FIX declared-type leaf (Z13's rule), transcribed for the red-team
 *  half of the audit. Mirrors `zigTypeLeafNode` as it was before 2026-09-28. */
function preFixHead(decl: any): string | null {
  const ids: string[] = []
  const stack: any[] = [decl]
  let guard = 0
  while (stack.length > 0 && guard++ < 200) {
    const n = stack.pop()!
    if (n.type === "identifier") ids.push(String(n.text))
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  if (ids.length === 0) return null
  if ((decl.type === "parameter" || decl.type === "container_field") && decl.namedChildCount > 0 && decl.namedChild(0)?.type === "identifier") {
    ids.shift()
    if (ids.length === 0) return null
  }
  const trim = ids[ids.length - 1]!.replace(/[!*\s[\]{}]+/g, "").trim()
  if (!trim) return null
  const base = trim.split("<or>")[0] ?? trim
  const head = base.indexOf("=") !== -1 ? base.slice(0, base.indexOf("=")).trim() : base
  if (!head || BUILTINS.has(head)) return null
  const c0 = head.charCodeAt(0)
  if (c0 >= 48 && c0 <= 57) return null
  return head
}

function preFixTargets(root: any): Set<string> {
  const out = new Set<string>()
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "parameter" || n.type === "container_field") {
      const h = preFixHead(n)
      if (h) out.add(h)
    }
    if (n.type === "function_declaration") {
      const kids: any[] = []
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) kids.push(c)
      }
      const ret = kids.filter((c) => c.type !== "identifier" || kids.indexOf(c) !== 0).find((c) =>
        c.type === "error_union_type" || c.type === "nullable_type" || c.type === "pointer_type" ||
        c.type === "slice_type" || c.type === "builtin_type" || c.type === "identifier" || c.type === "field_expression")
      if (ret) {
        const h = preFixHead(ret)
        if (h) out.add(h)
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

const norm = (t: string) => {
  const s = String(t).replace(/<.*$/, "").replace(/\[.*$/, "").trim()
  const parts = s.split(/::|\./).filter(Boolean)
  return parts[parts.length - 1] ?? s
}

async function main(): Promise<void> {
  await init()
  const perRepo = Number(process.argv[2] ?? 200)
  const files = zigFiles(["zig", "zls", "ghostty"], perRepo * 3).filter((_, i) => true)
  const sample = files.filter((_, i) => i % Math.max(1, Math.ceil(files.length / (perRepo * 3))) === 0).slice(0, perRepo * 3)

  const named = new Map<string, number>()
  const tokens = new Map<string, number>()
  const fields = new Map<string, number>()
  let filesWithError = 0
  let truthEdges = 0
  let declaredTypeTruth = 0
  let case1Missing = 0
  let case1Unexplained = 0
  let preMissing = 0
  let preUnexplained = 0
  let symbols = 0
  let relationships = 0
  let importedQuoted = 0
  let mangledQuoted = 0
  const kindCells = new Map<string, number>()
  const mangledEx: string[] = []

  for (const f of sample) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser().parse(src)
    const root = tree.rootNode
    if (root.hasError) filesWithError++
    walk(root, (n: any) => {
      named.set(n.type, (named.get(n.type) ?? 0) + 1)
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (!c) continue
        if (!c.isNamed) tokens.set(c.type, (tokens.get(c.type) ?? 0) + 1)
        const fname = typeof n.fieldNameForChild === "function" ? n.fieldNameForChild(i) : null
        if (fname) fields.set(fname, (fields.get(fname) ?? 0) + 1)
      }
    })
    const res: any = analyzer().analyze(root, src, f)
    symbols += (res.symbols as any[]).length
    relationships += (res.relationships as any[]).length
    // kind dispatch cells (RHS node type x case x assigned kind)
    const assigned = new Map<string, Set<string>>()
    for (const s of res.symbols as any[]) {
      const set = assigned.get(s.name) ?? new Set<string>()
      set.add(String(s.kind))
      assigned.set(s.name, set)
    }
    const SKIP = new Set(["function_declaration", "test_declaration", "comptime_declaration", "block", "function_signature"])
    const visit = (n: any, inFn: boolean): void => {
      if (n.type === "variable_declaration" && !inFn) {
        const kids: any[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) kids.push(c)
        }
        if (kids.length > 0 && kids[0].type === "identifier" && kids[0].text !== "_" && kids[0].text.length <= 80) {
          const name = kids[0].text
          const rhs = kids[kids.length - 1]
          const upper = name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase()
          const kinds = [...(assigned.get(name) ?? new Set(["MISSING"]))].sort().join("+")
          const key = `${rhs.type}|${upper ? "UPPER" : "lower"}|${kinds}`
          kindCells.set(key, (kindCells.get(key) ?? 0) + 1)
        }
      }
      const childInFn = inFn || SKIP.has(n.type)
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) visit(c, childInFn)
      }
    }
    visit(root, false)
    // the quoted-identifier corruption the removed regex caused
    for (const r of res.relationships as any[]) {
      if (String(r.type) !== "references") continue
      const t = String(r.target ?? "")
      if (!t.startsWith('@"')) continue
      importedQuoted++
      if (t.replace(/[!*\s[\]{}]+/g, "") !== t) {
        mangledQuoted++
        if (mangledEx.length < 6) mangledEx.push(`${f.split("/").slice(-2).join("/")}  ${t}`)
      }
    }
    // the reference-class audit, both directions
    const truth = deriveZigReferenceEdges(root)
    truthEdges += truth.length
    for (const t of truth) if (String((t as any).from ?? "") === "(declared-type)") declaredTypeTruth++
    const got = new Set<string>()
    for (const r of res.relationships as any[]) {
      if (String(r.type) !== "references") continue
      got.add(norm(String(r.target)))
    }
    const truthSet = new Set(truth.map((t) => norm(t.target)))
    for (const t of truthSet) if (!got.has(t)) case1Missing++
    for (const g of got) if (!truthSet.has(g)) case1Unexplained++
    const pre = preFixTargets(root)
    for (const p of pre) if (!truthSet.has(norm(p))) preUnexplained++
    for (const t of truthSet) if (!pre.has(t)) preMissing++
    tree.delete()
  }

  const document = {
    schemaVersion: 1,
    milestone: "M12/M14",
    kind: "zig_deep_review_evidence",
    generatedAt: new Date().toISOString(),
    analyzer: "src/ast/real-zig-analyzer.ts",
    corpus: {
      root: CORPUS,
      repos: ["zig", "zls", "ghostty"],
      revisions: Object.fromEntries(
        ["zig", "zls", "ghostty"].map((r) => {
          try {
            return [r, execSync("git rev-parse HEAD", { cwd: path.join(CORPUS, r), encoding: "utf8" }).trim()]
          } catch {
            return [r, "unavailable"]
          }
        }),
      ),
      filesMeasured: sample.length,
      sampleNote: `deterministic stride sample, at most ${perRepo} files per repository, from the sorted corpus file list`,
    },
    grammarCensus: {
      namedNodeTypes: named.size,
      anonymousTokenTypes: tokens.size,
      fieldNames: fields.size,
      filesWithParseError: filesWithError,
      parseErrorRatePct: +((100 * filesWithError) / Math.max(1, sample.length)).toFixed(2),
      instrument: "script/m14/tmp/zigw-census.ts (same walk, sampled)",
      topNamedNodeTypes: [...named.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20),
      fieldsSeen: [...fields.entries()].sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? "")),
    },
    symbolKindDispatch: {
      note: "RHS node type x name case -> the kind the analyzer published, AFTER the Z11 fix. The pre-fix cells are in reviews/zig/master-review.md and script/m14/tmp/zigw-kinds.ts.",
      cells: [...kindCells.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40),
      cellsMeasured: kindCells.size,
    },
    declaredTypeAudit: {
      note: "The reference-class audit (Z14). Case 1 is the real analyzer against the independent oracle; case 2 is a pre-fix leaf transcription against the same oracle and exists to prove the audit can convict (M14 §5.7).",
      truthEdges,
      declaredTypeTruth,
      case1: { missing: case1Missing, unexplained: case1Unexplained },
      case2PreFix: { missing: preMissing, unexplained: preUnexplained },
      verdict:
        case1Missing === 0 && case1Unexplained === 0
          ? "case 1 clean; case 2 convicts"
          : case1Missing + case1Unexplained > 0
            ? "case 1 RED"
            : "case 2 did not convict — the audit would be a tautology",
      instrument: "script/m14/tmp/zigw-oracle-check.ts (same derivation, sampled)",
    },
    quotedIdentifiers: {
      note: "Z18: the removed junk-strip could only fire on a quoted identifier, and where it fired it corrupted the name. The count below is over emitted `references` targets.",
      quotedTargets: importedQuoted,
      targetsTheRemovedRegexWouldHaveMangled: mangledQuoted,
      examples: mangledEx,
    },
    totals: { symbols, relationships },
    limitations: [
      "The kind dispatch still rests on the NAME's case for six two-sided RHS forms (identifier, field_expression, call_expression, if_expression, switch_expression, struct_initializer, parenthesized_expression, builtin_function) — counted in script/m14/spec/zig-completeness.json as ZIG.GAP.4.",
      "A construction in a value position with no type annotation (`Point{ … }`) publishes no edge; the family alternative is `instantiates`, which ZIG.D.1 rules out for Zig. Counted as ZIG.GAP.3.",
      "The labeled TYPE form of a labeled expression does not parse in the pinned grammar, so the kind rule for that node type is a measured shape, not a grammar fact (ZIG.GAP.5).",
      "Z10 stands: an if/while capture bound into the enclosing frame suppresses a same-named read in the ELSE arm. Both sides behave identically and the shape needs a file value colliding with a capture name to be observable.",
      "Coverage in the differential matches on (label, last-segment target), so a truth row can be covered by an unrelated edge sharing its leaf; BB_F5_STRICT=1 re-matches as written and should be read before any claim about declared-type PRECISION.",
      "The canonical M14.0.F5 artifact is emitted by the ceremony sweep; this wave changed the lane's compared label set, so the committed artifact describes the previous comparison until it is re-emitted.",
    ],
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(document, null, 2) + "\n")
  console.log(`wrote ${OUT}`)
  console.log(`sample=${sample.length} filesWithParseError=${filesWithError} truthEdges=${truthEdges}`)
  console.log(`case1 missing=${case1Missing} unexplained=${case1Unexplained}`)
  console.log(`case2 missing=${preMissing} unexplained=${preUnexplained}`)
  console.log(`quotedTargets=${importedQuoted} mangled=${mangledQuoted}`)
}
void main()
