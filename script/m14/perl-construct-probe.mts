/**
 * PERL CONSTRUCT PROBE — does the LANGUAGE have the constructs, measured?
 *
 * ## What question this answers
 *
 * ONTOLOGY-WORKSTREAM Part 2: for a relationship type the analyzer does not
 * emit, the verdict is RULED only with "a written reason AND a corpus measurement
 * proving the construct that would produce it never occurs", and the ruling must
 * be FALSIFIABLE — "a probe finding a non-zero count overturns it". Prose alone is
 * not sufficient, and the reason is recorded in the gate's own header: `overrides`
 * was missing from Bash for a whole wave and the differential stayed green, because
 * the analyzer omitted it and the oracle was written after the ruling.
 *
 * So this file counts CONSTRUCTS on the parse tree. It never asks the analyzer
 * what it emits — asking the analyzer would make every probe answer "0" by
 * construction and would make a ruling unfalsifiable in the one direction that
 * matters.
 *
 * ## Why a tree walk and not a text search
 *
 * ONTOLOGY-WORKSTREAM Part 2 records what a text search does here: the gate's
 * first version returned two false positives — a probe for `extends` matched
 * `class voice` inside a telnet IAC word list in a string literal, and a probe
 * for `instantiates` matched `new Map(` in a bash file carrying embedded
 * JavaScript in a heredoc. A Perl string can hold any of it, so the same trap is
 * open here. On the tree, a string literal is a `string_content` child and a
 * comment is not a node at all.
 *
 * ## NO REGEX
 *
 * None. `endsWith`, `===`, `split` and `Set.has` only — the same rule
 * `script/m14/tmp/perl-zero-regex.mts` enforces over the analyzer.
 *
 * ## Instrument A as well as B
 *
 * Part 2 says which instrument applies is decided by the question: A
 * (grammar-inventory) for a type needing a node type the language does not have,
 * B (parse-tree semantic count) for a type the language CAN express. Perl can
 * express all four un-emitted types, so B is the decider — and A is collected
 * anyway, because "the grammar produced N distinct node types across the corpus"
 * is the population statement that makes a zero legible rather than merely
 * asserted.
 *
 * ## The population is derived, never hand-written
 *
 * Same derivation as `script/m14/perl-ontology-census.mts` and
 * `script/m14/ontology-coverage-gate.ts`: `git ls-files` per repo, <=512KiB,
 * `detectLanguageFromPath === "perl"`. M14-HONESTY-CONTRACT's population rule.
 *
 * Usage:
 *   bun script/m14/perl-construct-probe.mts [--fresh] [--limit N]
 */
import { execFileSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const MEAS = path.join(ROOT, "validation", "m14", "measurements")
const CHECKPOINT = path.join(MEAS, "walk-perl-probe.txt")
const JSONL = path.join(MEAS, "perl-construct-probe.jsonl")
const SUMMARY = path.join(MEAS, "perl-construct-probe-summary.json")

const FRESH = process.argv.includes("--fresh")
const LIMIT = (() => { const i = process.argv.indexOf("--limit"); return i >= 0 ? Number(process.argv[i + 1]) : 0 })()

// ------------------------------------------------------------------ population
const { detectLanguageFromPath } = await import(path.join(ROOT, "src/ast/language-detection.ts"))
const files: { repo: string; dir: string; rel: string; abs: string }[] = []
const perRepo: Record<string, number> = {}
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  let n = 0
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "perl") continue
    n++
    files.push({ repo: e, dir, rel, abs })
  }
  if (n) perRepo[e] = n
}
if (LIMIT) files.length = Math.min(files.length, LIMIT)
if (!files.length) { console.error(`NO CORPUS under ${CR} — this is NOT a pass.`); process.exit(2) }
console.log(`PERL CONSTRUCT PROBE`)
console.log(`population: ${files.length} admitted files across ${Object.keys(perRepo).length} repos (derived: git ls-files, <=512KiB, detectLanguageFromPath === "perl")`)
console.log(`           largest: ${Object.entries(perRepo).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(", ")}`)
if (LIMIT) console.log(`LIMITED to ${LIMIT} by --limit — every count below is about that subset and NOT the population`)
console.log(`jsonl: ${JSONL}\n`)

// ------------------------------------------------------------------ tree
const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const language: any = await Language.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-perl.wasm")))
const parser = new ParserClass()
parser.setLanguage(language)
const { RealPerlAnalyzer } = await import(path.join(ROOT, "src/ast/real-perl-analyzer.ts"))

/**
 * Is this text a NAME the source writes?
 *
 * A POSITIVE allowlist, copied in spirit from the analyzer's
 * `isWrittenCalleeName`: a negative test can only enumerate the dynamic cases
 * somebody already hit, and this pair has been got wrong that way three times
 * (documented in docs/analyzers/perl.md). Character-by-character,
 * no regex.
 */
function isWrittenName(text: string): boolean {
  const t = String(text ?? "").trim()
  if (!t) return false
  if (t.startsWith("&")) return isWrittenName(t.slice(1))
  let i = 0
  if (t.startsWith("::")) i = 2
  if (i >= t.length) return false
  let sawWord = false
  for (; i < t.length; i++) {
    const c = t[i]
    const wordish =
      (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") ||
      c === "_" || c === ":" || c === "+" || c === "-" || c === "."
    if (!wordish) return false
    if (c !== ":" && c !== ".") sawWord = true
  }
  return sawWord
}

const MAGIC = new Set(["__PACKAGE__", "__CLASS__", "__FILE__", "__LINE__", "__SUB__", "self", "undef"])

type Counters = Record<string, number>
type Examples = Record<string, string[]>
const newCounters = (): Counters => ({})
const bump = (c: Counters, k: string, n = 1) => { c[k] = (c[k] ?? 0) + n }
const noteEx = (e: Examples, k: string, v: string) => { if (!e[k]) e[k] = []; if (e[k].length < 5) e[k].push(v) }

function walkAll(n: any, fn: (n: any) => void, onField?: (field: string) => void): void {
  const stack: any[] = [n]
  while (stack.length) {
    const x = stack.pop()
    fn(x)
    for (let i = 0; i < x.childCount; i++) {
      const c = x.child(i)
      if (!c) continue
      // Field names are read HERE, from the parent's own index, and never by
      // comparing a child wrapper for identity: web-tree-sitter returns a FRESH
      // JS object on every access, so `parent.child(i) === n` is false for every
      // node the walk ever produced. That is why this instrument reported 0
      // distinct fields on the first run over 60 files while the corpus plainly
      // contains `function`, `module`, `left`, `right` and `key`.
      if (onField && x.isNamed && c.isNamed) {
        const f = x.fieldNameForChild(i)
        if (f) onField(f)
      }
      stack.push(c)
    }
  }
}

/** Direct children only, in order — the grammar's own child list. */
function kids(n: any): any[] {
  const out: any[] = []
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c) out.push(c)
  }
  return out
}
function firstNamed(n: any, type: string): any | undefined {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && c.isNamed && c.type === type) return c
  }
  return undefined
}
/** All children carrying `field`, which is how this grammar spells a paren. */
function fieldKids(n: any, field: string): any[] {
  const out: any[] = []
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && n.fieldNameForChild(i) === field) out.push(c)
  }
  return out
}

const PROBE_IDS = [
  // --- `references`: a sub named as a VALUE, never invoked -------------------
  "refs.coderef.plain",            // \&name
  "refs.coderef.qualified",        // \&Pkg::name
  "refs.coderef.dynamic",          // \&{...} / \&$var  -- MUST be refused by any emitter
  "refs.coderef.via_call",         // \&name(...)  explicit call syntax, already a `calls` edge
  // --- `references`: a class named as a TYPE -------------------------------
  "refs.bless.literal",            // bless $x, 'Class::Name'
  "refs.bless.magic",              // bless $x, __PACKAGE__
  "refs.bless.variable",           // bless $x, $class -- nothing written to name
  "refs.isa.literal",              // $obj->isa('Class')
  "refs.isa.variable",             // $obj->isa($class)
  "refs.does.literal",             // $obj->DOES('Role')
  "refs.qualified_var",            // $Pkg::VAR  / @Pkg::VAR -- a package variable read
  "refs.universal_isa.literal",    // UNIVERSAL::isa($x, 'Class')
  "refs.can.literal",              // $obj->can('method') -- a METHOD named as a string
  // --- `uses`: a MEMBER read, which is what every other lane's `uses` is ----
  "uses.hash_element.bareword_key", // $self->{attr}  with a written key
  "uses.hash_element.expr_key",     // $self->{$k}   -- no written member name
  "uses.hash_deref",                // %{$self->{h}}
  "uses.array_element",
  "uses.isa_read",                  // $obj->isa('X') read as a member? no -- see refs.*
  // The CLEAN `uses` candidates: a value read that is NOT the declaration site,
  // and a code reference to a sub the SAME package declares.
  "uses.package_global_read",
  "uses.package_global_read_at_declaration",
  "uses.coderef_to_declared_sub_same_package",
  "uses.coderef_to_sub_of_other_package",
  "uses.qualified_var_of_declared_package_global"
] as const
type ProbeId = (typeof PROBE_IDS)[number]

function classify(root: any, label: string, c: Counters, ex: Examples, nodeTypes: Map<string, number>, fields: Map<string, number>): void {
  walkAll(root, (n: any) => {
    nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1)

    switch (n.type) {
      // ---- \&name / \&Pkg::name / \&{...} / \&$var --------------------------
      case "refgen_expression": {
        const fn = firstNamed(n, "function")
        const body = fn ? String(fn.text ?? "") : ""
        const bare = body.startsWith("&") ? body.slice(1) : body
        const hasVar = !!firstNamed(fn ?? n, "varname")
        const hasBlock = !!firstNamed(n, "code_deref_expression")
        if (hasBlock) { bump(c, "refs.coderef.dynamic"); noteEx(ex, "refs.coderef.dynamic", `${label}:${n.startPosition.row + 1} ${JSON.stringify(n.text.slice(0, 40))}`) }
        else if (hasVar && isWrittenName(bare)) {
          if (bare.includes("::")) { bump(c, "refs.coderef.qualified"); noteEx(ex, "refs.coderef.qualified", `${label}:${n.startPosition.row + 1} ${JSON.stringify(n.text.slice(0, 40))}`) }
          else { bump(c, "refs.coderef.plain"); noteEx(ex, "refs.coderef.plain", `${label}:${n.startPosition.row + 1} ${JSON.stringify(n.text.slice(0, 40))}`) }
        } else { bump(c, "refs.coderef.dynamic"); noteEx(ex, "refs.coderef.dynamic", `${label}:${n.startPosition.row + 1} ${JSON.stringify(n.text.slice(0, 40))}`) }
        break
      }

      // ---- bless $x, <CLASS> ----------------------------------------------
      case "ambiguous_function_call_expression":
      case "function_call_expression": {
        const fnNode = (() => { for (let i = 0; i < n.childCount; i++) { const c2 = n.child(i); if (c2 && n.fieldNameForChild(i) === "function") return c2 } return undefined })()
        const fn = String(fnNode?.text ?? "")
        if (fn === "bless") {
          const args = fieldKids(n, "arguments").filter((a: any) => a.isNamed)
          const second = args[args.length - 1]
          const st = second?.type
          if (!second) bump(c, "refs.bless.variable")
          else if (st === "string_literal" || st === "bareword" || st === "package") {
            const t = String(second.text ?? "").replace(/^['"]/, "").replace(/['"]$/, "")
            if (MAGIC.has(t)) { bump(c, "refs.bless.magic"); noteEx(ex, "refs.bless.magic", `${label}:${n.startPosition.row + 1} ${JSON.stringify(n.text.slice(0, 50))}`) }
            else if (isWrittenName(t)) { bump(c, "refs.bless.literal"); noteEx(ex, "refs.bless.literal", `${label}:${n.startPosition.row + 1} ${JSON.stringify(n.text.slice(0, 50))}`) }
            else bump(c, "refs.bless.variable")
          } else bump(c, "refs.bless.variable")
        }
        // UNIVERSAL::isa($x, 'Class') -- the FUNCTION form of the same type
        // query `$obj->isa('Class')` has. Same semantics, different node type,
        // so it is counted separately rather than folded in.
        if (fn === "UNIVERSAL::isa" || fn === "UNIVERSAL::can") {
          const args = fieldKids(n, "arguments").filter((a: any) => a.isNamed)
          const last = args[args.length - 1]
          const t = String(last?.text ?? "").replace(/^['"]/, "").replace(/['"]$/, "")
          if (last && (last.type === "string_literal" || last.type === "bareword") && isWrittenName(t) && !MAGIC.has(t)) {
            bump(c, "refs.universal_isa.literal")
            noteEx(ex, "refs.universal_isa.literal", `${label}:${n.startPosition.row + 1} ${JSON.stringify(n.text.slice(0, 50))}`)
          }
        }
        // \&name(...) -- perl's EXPLICIT-CALL syntax. It is a CALL, and the
        // analyzer already files it as one; counted so the two are not confused.
        if (fn.startsWith("&")) {
          const hasArgs = fieldKids(n, "arguments").some((a: any) => a.isNamed)
          if (hasArgs) { bump(c, "refs.coderef.via_call"); noteEx(ex, "refs.coderef.via_call", `${label}:${n.startPosition.row + 1} ${JSON.stringify(n.text.slice(0, 50))}`) }
        }
        break
      }

      // ---- $obj->isa('X') / $obj->DOES('R') -------------------------------
      case "method_call_expression": {
        const m = firstNamed(n, "method")
        const method = String(m?.text ?? "")
        if (method === "can") {
          const cargs = fieldKids(n, "arguments").filter((a: any) => a.isNamed)
          const cf = cargs[0]
          const ct = String(cf?.text ?? "").replace(/^['"]/, "").replace(/['"]$/, "")
          if (cf && (cf.type === "string_literal" || cf.type === "bareword") && isWrittenName(ct) && !MAGIC.has(ct)) {
            bump(c, "refs.can.literal")
            noteEx(ex, "refs.can.literal", `${label}:${n.startPosition.row + 1} ${JSON.stringify(n.text.slice(0, 50))}`)
          }
        }
        if (method === "isa" || method === "DOES") {
          const args = fieldKids(n, "arguments").filter((a: any) => a.isNamed)
          const first = args[0]
          const key = method === "isa" ? "refs.isa" : "refs.does"
          if (!first) bump(c, `${key}.variable`)
          else if (first.type === "string_literal" || first.type === "bareword" || first.type === "package") {
            const t = String(first.text ?? "").replace(/^['"]/, "").replace(/['"]$/, "")
            if (isWrittenName(t) && !MAGIC.has(t)) {
              bump(c, `${key}.literal`)
              noteEx(ex, `${key}.literal`, `${label}:${n.startPosition.row + 1} ${JSON.stringify(n.text.slice(0, 50))}`)
            } else bump(c, `${key}.variable`)
          } else bump(c, `${key}.variable`)
        }
        break
      }

      // ---- $Pkg::VAR / @Pkg::VAR / %Pkg::VAR ------------------------------
      case "scalar":
      case "array":
      case "hash": {
        const v = firstNamed(n, "varname")
        const t = String(v?.text ?? "")
        if (t.includes("::")) {
          bump(c, "refs.qualified_var")
          noteEx(ex, "refs.qualified_var", `${label}:${n.startPosition.row + 1} ${JSON.stringify(n.text.slice(0, 40))}`)
        }
        break
      }
      case "bareword": {
        const t = String(n.text ?? "")
        // `Foo::CONST` is a package constant read; `Foo::Bar->x` is the invocant of
        // a method call, which is already a `calls` edge -- a receiver, not a
        // reference. Only the standalone form counts here.
        if (t.includes("::") && t.endsWith("::") === false) {
          const par = n.parent
          const isReceiver = par && (par.type === "method_call_expression" || par.type === "func0op_call_expression" || par.type === "func1op_call_expression" || par.type === "ambiguous_function_call_expression")
          let isFunctionOfCall = false
          if (par) for (let i = 0; i < par.childCount; i++) { if (par.child(i) === n && par.fieldNameForChild(i) === "function") isFunctionOfCall = true }
          if (!isReceiver && !isFunctionOfCall) {
            bump(c, "refs.qualified_var")
            noteEx(ex, "refs.qualified_var", `${label}:${n.startPosition.row + 1} ${JSON.stringify(n.text.slice(0, 40))}`)
          }
        }
        break
      }

      // ---- $self->{attr} : a MEMBER READ ---------------------------------
      case "hash_element_expression": {
        const keyField = fieldKids(n, "key").filter((k: any) => k.isNamed)[0]
        const first = firstNamed(keyField ?? n, "autoquoted_bareword") ?? firstNamed(keyField ?? n, "string_content") ?? firstNamed(keyField ?? n, "string_literal")
        const t = String(first?.text ?? "").trim()
        if (keyField && t && isWrittenName(t) && !t.includes("::")) {
          bump(c, "uses.hash_element.bareword_key")
          noteEx(ex, "uses.hash_element.bareword_key", `${label}:${n.startPosition.row + 1} ${JSON.stringify(n.text.slice(0, 40))}`)
        } else bump(c, "uses.hash_element.expr_key")
        break
      }
      case "hash_deref_expression": { bump(c, "uses.hash_deref"); break }
      case "array_element_expression": { bump(c, "uses.array_element"); break }
      case "isa_read": { bump(c, "uses.isa_read"); break }
    }
  }, (field: string) => { fields.set(field, (fields.get(field) ?? 0) + 1) })
}

// ------------------------------------------------------------------ walk
if (FRESH) {
  writeFileSync(CHECKPOINT, "")
  try { writeFileSync(JSONL, "") } catch {}
}
mkdirSync(MEAS, { recursive: true })
const MARK_BAD = "!"
const done = new Set<string>(), bad = new Set<string>()
if (existsSync(CHECKPOINT)) {
  for (const line of readFileSync(CHECKPOINT, "utf8").split("\n")) {
    const t = line.trim()
    if (!t) continue
    if (t.startsWith(MARK_BAD)) bad.add(t.slice(1)); else done.add(t)
  }
}
let cursor = 0, walked = 0, skippedBad = 0
async function worker(): Promise<void> {
  while (true) {
    const i = cursor++
    if (i >= files.length) return
    const f = files[i]
    if (done.has(f.abs) || bad.has(f.abs)) continue
    let line: string
    try {
      const src = readFileSync(f.abs, "utf8")
      const tree = parser.parse(src)
      const c: Counters = newCounters()
      const ex: Examples = {}
      const nodeTypes = new Map<string, number>()
      const fields = new Map<string, number>()
      classify(tree.rootNode, `${f.repo}/${f.rel}`, c, ex, nodeTypes, fields)
      // The DECLARED-MEMBER subset: of the member reads found, how many name a
      // Property the analyzer's own extraction declares in this file? This is the
      // number that decides whether a `uses` edge can be emitted at all -- an
      // undeclared key is a hash key, and naming it would fabricate a member.
      const res: any = new RealPerlAnalyzer().analyze(tree.rootNode, src, f.abs)
      const props = new Set<string>()
      // Every name the analyzer's OWN extraction declares, as bare leaves and as
      // owner::name pairs. This is what question 5 ("do both endpoints bind to
      // real symbols?") is measured against, so it is read from the extraction
      // rather than from a hand-written list.
      const declared = new Set<string>()
      const declaredQualified = new Set<string>()
      /** Package globals this file declares: Variable / Constant / Property owned
       *  by a package. This is the symbol class a `uses` read can name. */
      const packageGlobals = new Set<string>()
      for (const s of res.symbols ?? []) {
        const nm = String(s.name)
        if (String(s.kind) === "property") props.add(nm)
        declared.add(nm)
        if (s.ownerName) declaredQualified.add(`${s.ownerName}::${nm}`)
        const k = String(s.kind)
        if ((k === "variable" || k === "constant" || k === "property") && s.ownerName) packageGlobals.add(`${s.ownerName}\u001f${nm}`)
      }
      const state0 = { packageOfFile: String((res.symbols ?? []).find((x: any) => x.ownerName === undefined && String(x.kind) === "class")?.name ?? "") }
      // Re-walk so each candidate can be tested against what was declared.
      walkAll(tree.rootNode, (n: any) => {
        // (a) does a qualified package-variable read name a symbol THIS file declares?
        if (n.type === "scalar" || n.type === "array" || n.type === "hash") {
          const v = firstNamed(n, "varname")
          const t = String(v?.text ?? "")
          // (a0) an UNQUALIFIED read of a package global this file declares -- the
          // exact analogue of bash's `$VAR` read, which is what every other lane's
          // `uses` is. The DECLARATION SITE is counted separately and never emitted:
          // `our $VERSION = ...` is a declaration, and an edge from a declaration to
          // itself would be a self-edge of the same class as the self-base guard.
          if (!t.includes("::") && t) {
            const atDecl = n.parent?.type === "variable_declaration"
            if (atDecl) bump(c, "uses.package_global_read_at_declaration")
            else {
              let owner: string | undefined
              for (const key of packageGlobals) { const i = key.indexOf("\u001f"); if (key.slice(i + 1) === t) { owner = key.slice(0, i); break } }
              if (owner) {
                bump(c, "uses.package_global_read")
                noteEx(ex, "uses.package_global_read", `${f.repo}/${f.rel}:${n.startPosition.row + 1} ${t} of ${owner}`)
              }
            }
          }
          if (t.includes("::")) {
            const leaf = t.slice(t.lastIndexOf("::") + 2)
            const qual = t.slice(0, t.lastIndexOf("::"))
            if (packageGlobals.has(`${qual}\u001f${leaf}`)) {
              bump(c, "uses.qualified_var_of_declared_package_global")
              noteEx(ex, "uses.qualified_var_of_declared_package_global", `${f.repo}/${f.rel}:${n.startPosition.row + 1} ${t}`)
            } else if (declared.has(leaf)) { bump(c, "uses.qualified_var_of_declared_name"); noteEx(ex, "uses.qualified_var_of_declared_name", `${f.repo}/${f.rel}:${n.startPosition.row + 1} ${t}`) }
            else if (declaredQualified.has(t)) { bump(c, "uses.qualified_var_of_declared_qualified"); noteEx(ex, "uses.qualified_var_of_declared_qualified", `${f.repo}/${f.rel}:${n.startPosition.row + 1} ${t}`) }
            else if (declared.has(qual.split("::").slice(-1)[0])) { bump(c, "uses.qualified_var_owner_is_declared_here"); noteEx(ex, "uses.qualified_var_owner_is_declared_here", `${f.repo}/${f.rel}:${n.startPosition.row + 1} ${t}`) }
            else bump(c, "uses.qualified_var_undeclared")
          } else if (t && declared.has(t)) bump(c, "uses.unqualified_var_of_declared_name")
          return
        }
        // (b) does a code reference name a sub THIS file declares?
        if (n.type === "refgen_expression") {
          const fn = firstNamed(n, "function")
          const body = fn ? String(fn.text ?? "") : ""
          const bare = body.startsWith("&") ? body.slice(1) : body
          const hasVar = !!firstNamed(fn ?? n, "varname")
          const hasBlock = !!firstNamed(n, "code_deref_expression")
          if (!hasBlock && hasVar && isWrittenName(bare)) {
            const leaf = bare.includes("::") ? bare.slice(bare.lastIndexOf("::") + 2) : bare
            const owner = bare.includes("::") ? bare.slice(0, bare.lastIndexOf("::")) : undefined
            // Same-package first: `\&helper` inside `package Foo` where `sub helper`
            // is declared resolves to a symbol THIS file owns, which is the honest
            // bar. A qualified `\&Other::helper` naming a package this file also
            // declares is the second bar. Anything else is a cross-file target the
            // indexer may or may not resolve, and is counted so the difference is
            // a number rather than an assumption.
            let samePackage = false
            let otherDeclaredPackage = false
            for (const s2 of res.symbols ?? []) {
              const nm2 = String(s2.name)
              const ow = s2.ownerName ? String(s2.ownerName) : ""
              if (nm2 !== leaf) continue
              if (ow === state0.packageOfFile) samePackage = true
              if (owner && ow === owner) otherDeclaredPackage = true
            }
            if (samePackage) { bump(c, "uses.coderef_to_declared_sub_same_package"); noteEx(ex, "uses.coderef_to_declared_sub_same_package", `${f.repo}/${f.rel}:${n.startPosition.row + 1} ${JSON.stringify(n.text.slice(0, 40))}`) }
            else if (otherDeclaredPackage) bump(c, "uses.coderef_to_sub_of_other_package")
            else if (declared.has(leaf)) { bump(c, "uses.coderef_to_declared_sub"); noteEx(ex, "uses.coderef_to_declared_sub", `${f.repo}/${f.rel}:${n.startPosition.row + 1} ${JSON.stringify(n.text.slice(0, 40))}`) }
            else bump(c, "uses.coderef_to_undeclared_sub")
          }
          return
        }
        if (n.type !== "hash_element_expression") return
        const keyField = fieldKids(n, "key").filter((k: any) => k.isNamed)[0]
        const first = firstNamed(keyField ?? n, "autoquoted_bareword") ?? firstNamed(keyField ?? n, "string_content") ?? firstNamed(keyField ?? n, "string_literal")
        const t = String(first?.text ?? "").trim()
        if (keyField && t && isWrittenName(t) && !t.includes("::") && props.has(t)) {
          bump(c, "uses.member_read_of_declared_property")
          noteEx(ex, "uses.member_read_of_declared_property", `${f.repo}/${f.rel}:${n.startPosition.row + 1} ->${t}`)
        }
      })
      tree.delete?.()
      line = JSON.stringify({
        f: `${f.repo}/${f.rel}`,
        counts: c, examples: ex,
        nodeTypes: [...nodeTypes.entries()],
        fields: [...fields.entries()],
        propsDeclared: props.size,
      })
      done.add(f.abs)
    } catch (e) {
      skippedBad++; bad.add(f.abs)
      appendFileSync(CHECKPOINT, `${MARK_BAD}${f.abs}\n`)
      line = JSON.stringify({ f: `${f.repo}/${f.rel}`, threw: String(e).slice(0, 200) })
    }
    appendFileSync(JSONL, line + "\n")
    appendFileSync(CHECKPOINT, `${bad.has(f.abs) ? MARK_BAD : ""}${f.abs}\n`)
    walked++
    if (walked % 500 === 0) console.log(`  ...${walked} new (${done.size} done, ${bad.size} bad)`)
  }
}
await Promise.all([worker()])

// ------------------------------------------------------------------ summarise
const rows: any[] = []
try { for (const l of readFileSync(JSONL, "utf8").split("\n")) { const t = l.trim(); if (t) { try { rows.push(JSON.parse(t)) } catch {} } } } catch {}
const counted = rows.filter((r) => !r.threw)
const threw = rows.filter((r) => r.threw)

const total: Counters = {}
const filesWith: Counters = {}
const examples: Examples = {}
const nodeTypes = new Map<string, number>()
const fields = new Map<string, number>()
let propsDeclaredTotal = 0
for (const r of counted) {
  for (const [k, v] of Object.entries(r.counts as Counters)) {
    total[k] = (total[k] ?? 0) + (v as number)
    filesWith[k] = (filesWith[k] ?? 0) + 1
  }
  for (const [k, v] of Object.entries(r.examples as Examples)) {
    if (!examples[k]) examples[k] = []
    for (const x of (v as string[])) if (examples[k].length < 8) examples[k].push(x)
  }
  for (const [k, v] of r.nodeTypes as [string, number][]) nodeTypes.set(k, (nodeTypes.get(k) ?? 0) + v)
  for (const [k, v] of r.fields as [string, number][]) fields.set(k, (fields.get(k) ?? 0) + v)
  propsDeclaredTotal += r.propsDeclared ?? 0
}

const summary = {
  generatedAt: new Date().toISOString(),
  head: execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  population: { corpusRoot: CR, admittedFiles: files.length, repos: Object.entries(perRepo).sort((a, b) => b[1] - a[1]), limited: LIMIT > 0, limit: LIMIT },
  coverage: { measured: counted.length, threwOnParse: threw.length, pct: ((counted.length / Math.max(1, files.length)) * 100).toFixed(2), newlyWalkedThisRun: walked },
  instrumentA_grammarInventory: { distinctNodeTypes: nodeTypes.size, distinctFields: fields.size },
  probes: Object.fromEntries(PROBE_IDS.map((id) => [id, { occurrences: total[id] ?? 0, files: filesWith[id] ?? 0, examples: examples[id] ?? [] }])),
  extraProbes: Object.fromEntries(Object.keys(total).filter((k) => !PROBE_IDS.includes(k as ProbeId)).map((k) => [k, { occurrences: total[k], files: filesWith[k], examples: examples[k] ?? [] }])),
  propertiesDeclared: propsDeclaredTotal,
  nodeTypes: [...nodeTypes.entries()].sort((a, b) => b[1] - a[1]),
  fields: [...fields.entries()].sort((a, b) => b[1] - a[1]),
}
writeFileSync(SUMMARY, JSON.stringify(summary, null, 2))

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`\nwalk: ${counted.length}/${files.length} files (${summary.coverage.pct}%)   newly walked ${walked}   threw ${threw.length}`)
console.log(`INSTRUMENT A — grammar inventory: ${nodeTypes.size} distinct node types, ${fields.size} distinct fields observed across the corpus\n`)
console.log(`${w("probe", 40)}${w("occurrences", 14)}${w("files", 9)}example`)
console.log("-".repeat(120))
for (const id of [...PROBE_IDS, ...Object.keys(summary.extraProbes) as ProbeId[]]) {
  const p = (summary.probes as any)[id] ?? (summary.extraProbes as any)[id]
  if (!p) continue
  console.log(`${w(id, 40)}${w(p.occurrences.toLocaleString(), 14)}${w(String(p.files), 9)}${(p.examples[0] ?? "").slice(0, 55)}`)
}
console.log(`\nproperties the analyzer declares across the corpus: ${propsDeclaredTotal.toLocaleString()}`)
console.log(`wrote ${SUMMARY}`)
