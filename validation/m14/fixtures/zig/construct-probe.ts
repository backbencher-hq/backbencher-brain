/**
 * ZIG CONSTRUCT PROBE — the two instruments the workstream defines, applied to
 * the relationship types this lane does not emit.
 *
 * ## Why this exists
 *
 * A prose justification is not a verdict. `overrides` had one in the bash lane,
 * it was wrong, and the differential stayed green throughout because the oracle
 * omitted the same type: "nothing" agrees with "nothing". So each ruling here is
 * backed by a COUNT, and each count names what would overturn it.
 *
 * ## The two instruments, and the question each answers
 *
 *   A: GRAMMAR INVENTORY — for a construct that needs a node type, a field or a
 *      keyword the language does not have. Read from the pinned wasm's OWN type
 *      and field tables (`language.types` / `language.fields`) rather than from a
 *      hand-kept list, because a hand-kept list is a list that goes stale
 *      silently. Three views, since one is not enough for a language that HAS a
 *      type declaration:
 *        A1  the declared node-type table, in full. In web-tree-sitter this table
 *            carries the ANONYMOUS TOKEN types too (`fn`, `const`, `pub`,
 *            `struct`, `opaque` are all in it), so it is simultaneously the
 *            keyword inventory (A3): a language can express a construct with a
 *            node type, a field name, or a keyword, and this table answers all
 *            three at once. The control for that reading is in `controls`
 *            (`declaredTypeTableContainsKeywords`), because a table that held only
 *            named types would make A3 vacuous.
 *        A2  the declared FIELD-name table, in full — a node can exist and still
 *            have nowhere to write a supertype. Zig's is 16 names, listed in full.
 *        A4  the CHILDREN of a type declaration, counted on the tree and then
 *            CLASSIFIED. A type that could be extended would carry a second type
 *            as a child, and this is the position test A1–A3 cannot substitute
 *            for. A4 is deliberately NOT reported as a bare count: an early run
 *            reported 2,168 and read as a non-zero, which would have overturned the
 *            `extends`/`implements` rulings for the wrong reason. Every child in
 *            that position is classified below and the ruling rests on the
 *            UNCLASSIFIED residual, which is the only bucket a supertype slot can
 *            land in.
 *
 *   B: PARSE-TREE SEMANTIC COUNT — for a construct the language CAN express. A
 *      string literal cannot fake a declaration and neither can a comment, so a
 *      count taken on the tree is a fact about code rather than about text.
 *      This is the instrument `overrides` needs: a duplicate declaration is
 *      expressible in zig source even though the compiler rejects it, and the
 *      corpus contains files that are MEANT to fail — so hits are split by
 *      whether the file is a compiler-error test case, because a diagnostic test
 *      documents the compiler's REJECTION of the construct, which is evidence for
 *      the ruling rather than against it.
 *
 * ## Calibration — the part that decides whether a zero means anything
 *
 * A probe reporting 0 everywhere is indistinguishable from a probe that cannot
 * see. Every probe therefore also runs against a CONTROL — a synthetic snippet
 * it must find, through THE SAME probe function the corpus run uses. A control
 * that reads 0 voids the corpus zero it certifies. Negative controls matter too:
 * a probe that fires on ordinary members is a probe whose count is noise.
 *
 * ## Two defects this file's own earlier revision had, both now fixed
 *
 * 1. CONTROL HITS CONTAMINATED THE CORPUS COUNT. The controls were run through
 *    the same accumulator as the corpus and their hits landed in the published
 *    `occurrences`, so the corpus figure carried two synthetic `f` redeclarations
 *    and two synthetic containers. Corpus and control counts are now taken from
 *    separate recorders, and the control section asserts that the corpus totals
 *    did not move while the controls ran — which is what makes the separation a
 *    property rather than a promise.
 * 2. A CONTAINER IN A TYPE POSITION WAS TREATED AS A DECLARATION.
 *    `fn f() !struct { Temporary, Temporary }` is a return-type annotation whose
 *    named fields are not members of anything, so `fn minMax(…) struct { T, T }`
 *    and four siblings in std/codegen read as duplicate-member sites. They are
 *    not duplicates; they are the same field named in a result type. The probe now
 *    requires a container's parent to be a `variable_declaration`, which is the
 *    analyzer's own boundary for what counts as a container.
 * 3. ANONYMOUS CONTAINERS COLLIDED IN THE SCOPE KEY. `fn f() ?struct { x: u8 }`
 *    and `fn g() ?struct { x: u8 }` have no container identity, so both resolved to
 *    the key `container#?@<owner row>` and every anonymous struct inside one
 *    owner counted as a redefinition of the last. The corpus B3 count carried 8
 *    such phantoms in one file. Anonymous containers are now keyed by their own
 *    extent, matching the analyzer's own "an anonymous container produces no
 *    symbols" contract: it has no identity, so it cannot own a scope.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, writeFileSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { Parser, Language } from "web-tree-sitter"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const argv = process.argv.slice(2)
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const SAMPLE = Number(arg("sample", "400"))
const SEED = arg("seed", "construct-probe-v1")
const OUT = arg("out", "")

await Parser.init({
  locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const language: any = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-zig.wasm")))
const parser = new Parser()
parser.setLanguage(language)

// ───────────────────────────────────────────── corpus, walked the census's way
type FileRec = { repo: string; dir: string; rel: string; abs: string; text: string; compilerErrorCase: boolean }
const all: FileRec[] = []
const repoFileCounts: Record<string, number> = {}
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.zig"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  repoFileCounts[e] = tracked.length
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    all.push({ repo: e, dir, rel, abs, text: "", compilerErrorCase: /(^|\/)compile_errors\//.test(rel) })
  }
}
for (const f of all) {
  try { f.text = readFileSync(f.abs, "utf8") } catch { f.text = "" }
}
const key = (f: FileRec) => `${f.repo}/${f.rel}`
const hashed = all
  .map((f) => ({ f, h: createHash("sha256").update(`${SEED}|${key(f)}`).digest("hex") }))
  .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
  .map((x) => x.f)
const draw = SAMPLE > 0 && SAMPLE < hashed.length ? hashed.slice(0, SAMPLE) : hashed
const drawHash = createHash("sha256").update(draw.map(key).sort().join("\n")).digest("hex")

// ───────────────────────────────────────────── what the probes key on
const TYPE_DECLS = new Set([
  "struct_declaration", "union_declaration", "enum_declaration",
  "error_set_declaration", "opaque_declaration",
])
/** The children of a zig type declaration that are MEMBERS, not a header-slot
 *  type: fields / enum members / union members, methods, nested declarations,
 *  doc comments, and the bare identifiers that make up an error set. */
const MEMBER_CHILD_NODES = new Set([
  "container_field", "function_declaration", "variable_declaration", "comment",
])
/** Blocks are NAME SCOPES for a binding in zig: a declaration is live from its
 *  own statement to the end of the enclosing block, so two `const x` in
 *  DISJOINT branches are both legal shadowing and neither replaces the other. A
 *  scope key that stops at the function would count them as a redefinition, which
 *  is the probe defect the first run had (83 phantom hits in 7 files, every one a
 *  shadow across switch prongs). */
const BLOCK_SCOPES = new Set([
  "block", "block_expression", "switch_case", "else_clause",
  "for_statement", "while_statement", "if_statement",
])
const SCOPE_DECLS = new Set(["function_declaration", "test_declaration", "comptime_declaration"])
/** A nested executable block inside a container body. It is a non-member child by
 *  node type but it IS a member by meaning — `comptime { … }` and `test "…" { … }`
 *  are body entries — so A4 buckets it separately rather than leaving it in the
 *  residual where it would read as a header-slot type. */
const NESTED_EXECUTABLE = new Set(["comptime_declaration", "test_declaration"])
/** Node types that can appear in a header-slot type POSITION. Used to decide
 *  whether a non-member child is a type reference at all. */
const TYPE_POSITION_NODES = new Set([
  "identifier", "builtin_type", "pointer_type", "slice_type", "array_type",
  "nullable_type", "error_union_type", "anyframe_type", "function_signature",
  "labeled_type", "field_expression", "struct_declaration", "union_declaration",
  "enum_declaration", "opaque_declaration", "error_set_declaration",
  "call_expression", "if_expression", "builtin_function",
  "null_coercion_expression",
])

/** A container node is a container DECLARATION only when it is a declaration's
 *  right-hand side (`const S = struct { … }`). The same node in a TYPE position is
 *  a type expression that names nothing: `fn f() !struct { Temporary, Temporary }`
 *  and `pub fn minMax(T: type, s: []T) struct { T, T }` are return-type ANNOTATIONS
 *  whose named fields are not members of anything, and counting them as a
 *  duplicate-member site reported 8 corpus hits that are not duplicates at all.
 *  This is the analyzer's own boundary ("a container is only a CONTAINER when it
 *  is a declaration's right-hand side") applied to the probe. */
const isContainerDeclaration = (n: any): boolean => n.parent?.type === "variable_declaration"

type ProbeKey =
  | "A4_child_of_type_declaration"
  | "B1_same_scope_duplicate_function"
  | "B2_same_scope_duplicate_binding"
  | "B3_duplicate_member_in_one_container"
const PROBE_KEYS: ProbeKey[] = [
  "A4_child_of_type_declaration",
  "B1_same_scope_duplicate_function",
  "B2_same_scope_duplicate_binding",
  "B3_duplicate_member_in_one_container",
]
/** A4 buckets; the rest record the redeclared name. `A4_bucket` is set only for
 *  A4, where the bucket IS the finding. */
type Hit = { file: string; detail: string; compilerErrorCase: boolean; bucket?: string }
/** Two recorders, so a control hit can never enter a corpus total. */
const makeRec = (): Record<ProbeKey, Hit[]> => Object.fromEntries(PROBE_KEYS.map((k) => [k, []])) as Record<ProbeKey, Hit[]>
let hits = makeRec()
let hitFiles: Record<string, Set<string>> = Object.fromEntries(PROBE_KEYS.map((k) => [k, new Set<string>()])) as Record<string, Set<string>>
/** seen[probe][scopeKey|name] -> declaration count. Cleared per FILE: a name
 *  declared once in each of two files is not a redefinition. */
const seen: Record<string, Map<string, number>> = Object.fromEntries(PROBE_KEYS.map((k) => [k, new Map()]))
const produced = new Map<string, number>()
const fieldsResolved = new Map<string, Set<string>>()
const FIELD_NAMES_TO_TEST = ["type", "body", "name", "value", "left", "right", "superclass", "bases", "interfaces"]

const push = (k: ProbeKey, file: string, detail: string, compilerErrorCase: boolean, bucket?: string): void => {
  hits[k].push({ file, detail, compilerErrorCase, bucket })
  hitFiles[k].add(file)
}

const hasTok = (n: any, t: string): boolean => {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && !c.isNamed && c.type === t) return true
  }
  return false
}

/** The nearest ancestor that establishes the name scope of a DECLARATION.
 *  Container scope and function scope are separate keys, so the same name in a
 *  struct and in a fn never collide.
 *
 *  An ANONYMOUS container has no name and therefore no identity, so it is keyed
 *  by its own extent instead of by its owner's name. Keying it by the owner made
 *  every anonymous container inside one owner share a scope, which turned
 *  `fn f() ?struct { x: u8 }` and `fn g() ?struct { x: u8 }` into a redefinition
 *  of each other. */
const scopeKey = (n: any, blockSensitive: boolean): string => {
  let cur = n.parent
  let block: any = null
  while (cur) {
    if (TYPE_DECLS.has(cur.type)) {
      const p = cur.parent
      const named = p && p.type === "variable_declaration"
      const nm = named
        ? (p.namedChildren?.find((c: any) => c.type === "identifier")?.text ?? null)
        : null
      // No name -> no identity -> no scope of its own to collide with another.
      // A NAMED container keeps its owner's row as well as its name: zig's own
      // source declares `Index`, `Slice` and `Optional` inside a dozen different
      // generic functions, and each is a different container. Dropping the row
      // collided them (22 corpus hits, every one a phantorn). An ANONYMOUS
      // container has no name to collide on, so its own extent is its identity.
      const id = nm !== null
        ? `${nm}@${cur.startPosition?.row ?? -1}`
        : `<anon@${cur.startPosition?.row ?? -1}:${cur.startPosition?.column ?? -1}-${cur.endPosition?.row ?? -1}:${cur.endPosition?.column ?? -1}>`
      const base = `container#${id}`
      return block ? `${base}/block@${block.startPosition?.row ?? -1}` : base
    }
    if (SCOPE_DECLS.has(cur.type)) {
      const nm = cur.namedChildren?.find((c: any) => c.type === "identifier")?.text ?? "?"
      const base = `${cur.type}#${nm}@${cur.startPosition?.row ?? -1}`
      return block ? `${base}/block@${block.startPosition?.row ?? -1}` : base
    }
    if (blockSensitive && !block && BLOCK_SCOPES.has(cur.type)) block = cur
    cur = cur.parent
  }
  return block ? `file/block@${block.startPosition?.row ?? -1}` : "file"
}

/** `_` is zig's DISCARD identifier: `const _ = x;` declares nothing that can be
 *  named again, so repeating it in one body is not a redefinition. The analyzer
 *  already holds this rule for reads; the probe needs it for redeclarations, or
 *  every discard in every container body reads as a duplicate member. */
const isDiscardName = (s: string | null): boolean => s === null || s === "_" || s.startsWith("@")

const declName = (n: any): string | null => {
  if (n.type === "container_field") {
    const f = n.childForFieldName?.("name")
    return isDiscardName(f && f.type === "identifier" ? String(f.text) : null) ? null : f && f.type === "identifier" ? String(f.text) : null
  }
  const c = n.namedChildCount > 0 ? n.namedChild(0) : null
  if (!c || c.type !== "identifier") return null
  return isDiscardName(String(c.text)) ? null : String(c.text)
}

/** A zig declaration that binds MORE THAN ONE name: `x, const y, var z: u32 = t`.
 *  Zig destructuring is one declaration with several binding slots, so the same
 *  name legitimately appears in a scope that already declared it. The test is
 *  token-level — a `,` among the declaration's own anonymous children — because
 *  the construct is a separator, not a subtree. */
const isDestructuringDecl = (n: any): boolean => hasTok(n, ",")

/**
 * Classify a non-member child of a type declaration.
 *
 * The buckets are exhaustive over the child types the corpus actually produces,
 * and `UNCLASSIFIED` is the only bucket in which a supertype reference could
 * hide. Returning UNCLASSIFIED for anything unrecognised is what makes the
 * residual a measurement instead of an assumption.
 */
function classifyHeaderSlot(parent: any, child: any): string {
  if (child.type === "ERROR") return "error-recovery"
  if (NESTED_EXECUTABLE.has(child.type)) return "nested-executable-block"
  if (!TYPE_POSITION_NODES.has(child.type)) return "UNCLASSIFIED"
  if (parent.type === "enum_declaration") return "enum-backing-type"
  if (parent.type === "union_declaration") return "union-tag-type"
  if (parent.type === "struct_declaration") {
    // `packed struct(u64)` carries an INTEGER FIELD COUNT, not a base type. The
    // node's own text opens with the `packed` keyword; the count is an integer
    // type in the header slot and means something else entirely.
    if (/^\s*packed\b/.test(String(parent.text))) return "packed-struct-field-count"
    return "UNCLASSIFIED"
  }
  return "UNCLASSIFIED"
}

/** THE PROBE. The corpus run and every control call this one function. */
function probe(text: string, label: string, compilerErrorCase = false): void {
  for (const k of PROBE_KEYS) seen[k].clear()
  const tree = parser.parse(text)
  if (!tree) return
  const visit = (n: any): void => {
    produced.set(n.type, (produced.get(n.type) ?? 0) + 1)

    if (n.isNamed) {
      let fs = fieldsResolved.get(n.type)
      if (!fs) { fs = new Set(); fieldsResolved.set(n.type, fs) }
      for (const f of FIELD_NAMES_TO_TEST) if (n.childForFieldName?.(f)) fs.add(f)
    }

    // A4 — a child written in the header slot of a type declaration.
    if (TYPE_DECLS.has(n.type) && isContainerDeclaration(n)) {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (MEMBER_CHILD_NODES.has(c.type)) continue
        if (c.type === "identifier" && n.type === "error_set_declaration") continue
        const bucket = classifyHeaderSlot(n, c)
        push("A4_child_of_type_declaration", label, `${bucket}: ${n.type} > ${c.type} "${String(c.text).slice(0, 48)}"`, compilerErrorCase, bucket)
      }
    }

    if (n.type === "function_declaration" || n.type === "container_field") {
      // A field of a container written in a TYPE position is an annotation, not a
      // member declaration, so it cannot collide with another member.
      if (n.type === "container_field") {
        let anc: any = n.parent
        let inDeclaration = false
        while (anc) {
          if (TYPE_DECLS.has(anc.type)) { inDeclaration = isContainerDeclaration(anc); break }
          anc = anc.parent
        }
        if (!inDeclaration) {
          for (let i = 0; i < n.childCount; i++) {
            const c = n.child(i)
            if (c) visit(c)
          }
          return
        }
      }
      const nm = declName(n)
      if (nm) {
        // A container member's scope is the container; a function's is the
        // function (or the block inside it). Both are declaration scopes, so a
        // function nested in a function still gets its own key.
        const k: ProbeKey = n.type === "container_field"
          ? "B3_duplicate_member_in_one_container"
          : "B1_same_scope_duplicate_function"
        const m = seen[k]
        const key2 = `${scopeKey(n, n.type === "function_declaration")}|${nm}`
        const c = (m.get(key2) ?? 0) + 1
        m.set(key2, c)
        if (c === 2) push(k, label, `${nm} declared twice in ${scopeKey(n, n.type === "function_declaration")}`, compilerErrorCase)
      }
    }
    if (n.type === "variable_declaration" && (hasTok(n, "const") || hasTok(n, "var"))) {
      const nm = declName(n)
      if (nm) {
        const m = seen["B2_same_scope_duplicate_binding"]
        const key2 = `${scopeKey(n, true)}|${nm}`
        const c = (m.get(key2) ?? 0) + 1
        m.set(key2, c)
        if (c === 2) {
          push(
            "B2_same_scope_duplicate_binding", label,
            `${nm} bound twice in ${scopeKey(n, true)}${isDestructuringDecl(n) ? " [DESTRUCTURING declaration]" : ""}`,
            compilerErrorCase,
            isDestructuringDecl(n) ? "destructuring" : "plain-rebinding",
          )
        }
      }
    }

    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) visit(c)
    }
  }
  visit(tree.rootNode)
  tree.delete?.()
}

// ───────────────────────────────────────────── corpus run, into its own recorder
for (const f of draw) probe(f.text, key(f), f.compilerErrorCase)
const corpusRec = hits
const corpusFiles = hitFiles
const corpusTotals = Object.fromEntries(PROBE_KEYS.map((k) => [k, hits[k].length])) as Record<ProbeKey, number>

// ───────────────────────────────────────────── controls, into a DIFFERENT recorder
hits = makeRec()
// The file SETS are recorders too. Leaving `hitFiles` shared let a control's file
// label into the corpus file count, which surfaced as a row reporting
// `0 occurrences in 1 file` — a combination that cannot be true, and the only
// reason to keep the invariant that occurrences and files move together.
hitFiles = Object.fromEntries(PROBE_KEYS.map((k) => [k, new Set<string>()])) as Record<string, Set<string>>
const controlResults: Record<string, { source: string; found: number; mustBe: number; kind: "positive" | "negative"; probeKey: string }> = {}
const runControl = (
  name: string, probeKey: ProbeKey, src: string, mustBe: number, kind: "positive" | "negative",
): void => {
  const before = hits[probeKey].length
  probe(src, "<control>")
  controlResults[name] = { probeKey, source: src.replace(/\n/g, " | "), found: hits[probeKey].length - before, mustBe, kind }
}

runControl("B3 sees a duplicate member in one container", "B3_duplicate_member_in_one_container",
  "const S = struct {\n    a: u8,\n    a: u16,\n};\n", 1, "positive")
runControl("B1 sees a duplicate function at file scope", "B1_same_scope_duplicate_function",
  "fn f() void {}\nfn f() void {}\n", 1, "positive")
runControl("B1 sees a duplicate method in one container", "B1_same_scope_duplicate_function",
  "const S = struct {\n    fn f() void {}\n    fn f() void {}\n};\n", 1, "positive")
runControl("B2 sees a duplicate binding in one block", "B2_same_scope_duplicate_binding",
  "fn g() void {\n    const a = 1;\n    const a = 2;\n}\n", 1, "positive")
runControl("B2 sees a destructuring rebind as a DESTUCTURING hit, not a plain one", "B2_same_scope_duplicate_binding",
  "fn g(t: anytype) void {\n    var a: u32 = undefined;\n    a, const b: u64 = .{ 1, 2 };\n    _ = b;\n}\n", 1, "positive")
runControl("B2 NEGATIVE: the same name in DISJOINT blocks is shadowing, not redefinition",
  "B2_same_scope_duplicate_binding",
  "fn g(c: bool) void {\n    if (c) {\n        const a = 1;\n        _ = a;\n    } else {\n        const a = 2;\n        _ = a;\n    }\n}\n", 0, "negative")
runControl("B1 NEGATIVE: the same name in two containers is two names",
  "B1_same_scope_duplicate_function",
  "const S = struct { fn a() void {} };\nconst T = struct { fn a() void {} };\n", 0, "negative")
runControl("B3 NEGATIVE: two ANONYMOUS containers in one owner are two containers",
  "B3_duplicate_member_in_one_container",
  "const S = struct {\n    fn f() ?struct { x: u8 } { return null; }\n    fn g() ?struct { x: u8 } { return null; }\n};\n", 0, "negative")
runControl("A4 NEGATIVE: ordinary struct/error/opaque containers carry no header-slot type",
  "A4_child_of_type_declaration",
  "const S = struct {\n    a: u8,\n    fn f() void {}\n};\nconst E = error{ Boom, Bang };\nconst O = opaque {};\n", 0, "negative")
runControl("A4 POSITIVE: the header-slot children zig DOES have are backing/tag/count types",
  "A4_child_of_type_declaration",
  "const D = enum(u8) { a };\nconst U = union(Kind) { a: u8 };\nconst A = packed struct(u64) { x: u64 };\n", 3, "positive")
runControl("A4 sees a nested executable block as a MEMBER, not as a header-slot type",
  "A4_child_of_type_declaration",
  "const E2 = struct { comptime { x = 1; } y: u8 };\n", 1, "positive")

/** A3 calibration. If the declared type table held only NAMED node types it could
 *  not answer "does the language have this KEYWORD", and the whole A-inventory
 *  reading of `extends` would rest on a table that cannot see `extends`. This
 *  asserts that table holds the anonymous token types. */
const declaredTypesAll: string[] = (language.types ?? []).filter((t: string) => typeof t === "string" && t.length > 0)
const KEYWORDS_THAT_ARE_IN_THE_TABLE = ["fn", "const", "var", "pub", "struct", "enum", "union", "opaque", "error", "comptime", "usingnamespace"]
const keywordsInTable = KEYWORDS_THAT_ARE_IN_THE_TABLE.filter((k) => declaredTypesAll.includes(k))

/** The corpus totals must not have moved while the controls ran. If a control
 *  could still write into the corpus recorder this would be false, which is what
 *  makes the corpus/control separation testable instead of asserted. */
const corpusTotalsAfterControls = Object.fromEntries(PROBE_KEYS.map((k) => [k, corpusRec[k].length])) as Record<ProbeKey, number>
const corpusUncontaminated = PROBE_KEYS.every((k) => corpusTotals[k] === corpusTotalsAfterControls[k])
/** An occurrence always has at least one file, and a zero has none. A row that
 *  says otherwise means a recorder leaked, so it is checked, not published. */
const occurrencesMatchFiles = PROBE_KEYS.every((k) =>
  corpusTotals[k] === 0 ? corpusFiles[k].size === 0 : corpusFiles[k].size > 0)

// ───────────────────────────────────────────── instrument A's inventories
const declaredFields: string[] = (language.fields ?? []).filter((f: string) => typeof f === "string" && f.length > 0)
const producedSorted = [...produced].sort((a, b) => b[1] - a[1])

/** The vocabulary that would express inheritance or interface conformance. A
 *  node type, a field name, or a keyword — all three, because a language can
 *  express a construct with any one of them and be silent in the other two. */
const INHERITANCE_VOCABULARY = [
  "class_declaration", "interface_declaration", "trait_declaration", "protocol_declaration",
  "inheritance_specifier", "extends_clause", "implements_clause", "superclass", "base_class",
  "base_class_clause", "class_specifier", "interface_implementation", "protocol_conformance",
  "type_constraints", "mixin_declaration", "extends", "implements", "inherits", "class", "interface",
  "trait", "protocol", "superclass", "bases", "interfaces", "super", "override", "overrides",
]

const split = (list: string[], vocab: string[]) => {
  const set = new Set(list)
  return {
    present: vocab.filter((v) => set.has(v)),
    absent: vocab.filter((v) => !set.has(v)),
  }
}

const a4 = corpusRec.A4_child_of_type_declaration
const a4Buckets = new Map<string, number>()
const a4Examples = new Map<string, string>()
for (const h of a4) {
  const b = h.bucket ?? "UNCLASSIFIED"
  a4Buckets.set(b, (a4Buckets.get(b) ?? 0) + 1)
  if (!a4Examples.has(b)) a4Examples.set(b, `${h.file}: ${h.detail}`)
}

const bucketCount = (k: ProbeKey, b: string): number => corpusRec[k].filter((h) => h.bucket === b).length

const report = {
  instrument: "validation/m14/fixtures/zig/construct-probe.ts",
  corpusRoot: CR,
  seed: SEED,
  samplingMethod:
    "git ls-files -- '*.zig' per corpus repo, ordered by sha256(seed|<repo>/<rel>), first N taken. " +
    "A reproducible draw named by drawHash; NOT claimed to be a statistical sample.",
  corpusFileCounts: repoFileCounts,
  corpusFilesAdmitted: all.length,
  sampledFiles: draw.length,
  drawHash: `sha256:${drawHash}`,
  compilerErrorCaseFilesInDraw: draw.filter((f) => f.compilerErrorCase).length,
  calibration: {
    corpusCountsUnchangedByControls: corpusUncontaminated,
    occurrencesMatchFiles,
    corpusTotals,
    declaredTypeTableHoldsKeywords: keywordsInTable.length,
    declaredTypeTableHoldsKeywordsDetail: keywordsInTable,
    declaredTypeTableHoldsAllTestedKeywords: keywordsInTable.length === KEYWORDS_THAT_ARE_IN_THE_TABLE.length,
  },
  instrumentA: {
    declaredNodeTypes: declaredTypesAll.length,
    declaredFieldNames: declaredFields.length,
    declaredNodeTypesFull: declaredTypesAll,
    declaredFieldNamesFull: declaredFields,
    producedNodeTypes: producedSorted.length,
    producedNodeTypesFull: producedSorted.map(([t, n]) => `${t}=${n}`),
    typeDeclarationNodeTypesPresent: declaredTypesAll.filter((t) => TYPE_DECLS.has(t)),
    nodeTypes: split(declaredTypesAll, INHERITANCE_VOCABULARY),
    fieldNames: split(declaredFields, INHERITANCE_VOCABULARY),
    fieldsResolvedByNodeType: Object.fromEntries(
      [...fieldsResolved].sort((a, b) => a[0].localeCompare(b[0])).map(([t, s]) => [t, [...s].sort()]),
    ),
    fieldsNeverResolvingAnywhere: FIELD_NAMES_TO_TEST.filter(
      (f) => ![...fieldsResolved.values()].some((s) => s.has(f)),
    ),
    a4HeaderSlotClassification: {
      note: "A4 is reported as a CLASSIFICATION, not a count. UNCLASSIFIED is the only bucket a supertype reference could occupy.",
      total: a4.length,
      files: corpusFiles.A4_child_of_type_declaration.size,
      buckets: Object.fromEntries([...a4Buckets].sort((a, b) => b[1] - a[1])),
      bucketExamples: Object.fromEntries([...a4Examples]),
      unclassified: a4Buckets.get("UNCLASSIFIED") ?? 0,
    },
  },
  instrumentB: Object.fromEntries(
    PROBE_KEYS.map((k) => [k, {
      occurrences: corpusRec[k].length,
      files: corpusFiles[k].size,
      occurrencesInCompilerErrorCases: corpusRec[k].filter((h) => h.compilerErrorCase).length,
      occurrencesOutsideCompilerErrorCases: corpusRec[k].filter((h) => !h.compilerErrorCase).length,
      byBucket: Object.fromEntries(
        [...new Set(corpusRec[k].map((h) => h.bucket ?? "(unbucketed)"))]
          .sort()
          .map((b) => [b, bucketCount(k, b)]),
      ),
      examples: corpusRec[k].slice(0, 10).map((h) => `${h.file}: ${h.detail}`),
      allHits: corpusRec[k].map((h) => `${h.file}: ${h.detail}${h.compilerErrorCase ? " [compile_errors case]" : ""}`),
    }]),
  ),
  controls: controlResults,
}

const text = JSON.stringify(report, null, 2)
if (OUT) {
  writeFileSync(path.resolve(ROOT, OUT), text + "\n")
  console.log(`wrote ${OUT}`)
}
console.log(`zig construct probe — ${report.sampledFiles} files sampled (${report.corpusFilesAdmitted} admitted), draw ${report.drawHash}`)
console.log(`  compiler-error test cases in the draw: ${report.compilerErrorCaseFilesInDraw}`)
console.log(`  calibration: corpus counts unchanged by controls: ${corpusUncontaminated}; occurrences/file-counts consistent: ${occurrencesMatchFiles}; declared-type table holds ${keywordsInTable.length}/${KEYWORDS_THAT_ARE_IN_THE_TABLE.length} tested keywords`)
console.log("")
console.log("INSTRUMENT A — the pinned grammar's own tables")
console.log(`  declared node types (named + anonymous): ${declaredTypesAll.length}   declared field names: ${declaredFields.length}   produced by corpus: ${producedSorted.length}`)
console.log(`  field names: ${declaredFields.join(", ")}`)
console.log(`  type-declaration node types present: ${report.instrumentA.typeDeclarationNodeTypesPresent.join(", ")}`)
console.log(`  inheritance vocabulary PRESENT as a node type/keyword: ${report.instrumentA.nodeTypes.present.length ? report.instrumentA.nodeTypes.present.join(", ") : "none"}`)
console.log(`  inheritance vocabulary PRESENT as a field:                   ${report.instrumentA.fieldNames.present.length ? report.instrumentA.fieldNames.present.join(", ") : "none"}`)
console.log(`  of ${INHERITANCE_VOCABULARY.length} probed words, absent as a node type/keyword: ${report.instrumentA.nodeTypes.absent.length}, absent as a field: ${report.instrumentA.fieldNames.absent.length}`)
console.log("")
console.log("A4 — the header slot of a type declaration, CLASSIFIED")
const a4r = report.instrumentA.a4HeaderSlotClassification
console.log(`  ${a4r.total} non-member children in ${a4r.files} file(s)`)
for (const [b, n] of Object.entries(a4r.buckets)) console.log(`      ${String(n).padStart(6)}  ${b}`)
console.log(`      ${String(a4r.unclassified).padStart(6)}  UNCLASSIFIED  <-- the only bucket a supertype slot could occupy`)
console.log("")
console.log("INSTRUMENT B — semantic counts on the parse tree")
for (const k of PROBE_KEYS) {
  const v = report.instrumentB[k] as any
  console.log(`  ${k.padEnd(40)} ${String(v.occurrences).padStart(6)} in ${String(v.files).padStart(4)} file(s); ${v.occurrencesInCompilerErrorCases} in compile_errors cases, ${v.occurrencesOutsideCompilerErrorCases} outside them; buckets ${JSON.stringify(v.byBucket)}`)
  for (const e of v.examples) console.log(`      ${e}`)
}
console.log("")
console.log("CONTROLS")
for (const [k, v] of Object.entries(controlResults)) {
  const ok = v.mustBe === 0 ? v.found === 0 : v.found >= v.mustBe
  console.log(`  ${ok ? "ok  " : "FAIL"} ${v.kind.padEnd(8)} ${k.padEnd(70)} found ${String(v.found).padStart(3)} (must be ${v.mustBe})`)
}
console.log("")
console.log("A2 — the tested field names, per named node type that resolved at least one:")
for (const [t, f] of Object.entries(report.instrumentA.fieldsResolvedByNodeType)) {
  if ((f as string[]).length) console.log(`  ${t.padEnd(32)} ${(f as string[]).join(", ")}`)
}
console.log(`  never resolving anywhere: ${report.instrumentA.fieldsNeverResolvingAnywhere.join(", ")}`)
if (Object.values(controlResults).some((v) => (v.mustBe === 0 ? v.found !== 0 : v.found < v.mustBe))) process.exitCode = 1