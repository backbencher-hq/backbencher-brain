/**
 * PHP `exports` — INSTRUMENT B, the falsifiable probe.
 *
 * ## Why a parse-tree count and not a grammar inventory
 *
 * `script/m14/ontology-coverage-gate.ts` records, in the json lane's own entry,
 * why a grammar inventory is the wrong instrument for a convention:
 *
 *   // `exports` WAS here and was removed: it was ruled on a grammar inventory
 *   // ("no export_statement node") and that is the same unsound reasoning that
 *   // produced the wrong `imports` ruling. A grammar cannot see a CONVENTION,
 *   // and a Node manifest's `exports`/`main`/`bin` are conventions written as
 *   // ordinary object keys.
 *
 * PHP has no `export` keyword, so a grammar inventory of the wasm's node types
 * would "prove" the absence of exports in the same way — and would be the same
 * unsound move. So the ruling has to survive a probe that counts the CONSTRUCT
 * on the parse tree, where a string or a comment cannot fake it.
 *
 * ## What counts as an export-shaped construct in PHP
 *
 * PHP has no module boundary, so "what does this file offer" is expressed in
 * four distinguishable ways. Each is counted separately, because they have
 * different honest answers:
 *
 *   P1 `use function` / `use const`  — a namespace-scoped RE-EXPORT. `namespace
 *      A; use function B\f;` makes `f` part of A's surface. This is the closest
 *      syntactic analogue of `export {x} from 'm'` in any language the repo
 *      handles, and it is the one a grammar inventory provably cannot see.
 *
 *   P2 FILE-LEVEL `return <expr>` — a top-level `return` outside every
 *      function/class scope. The value a required file hands back. This is
 *      PHP's closest thing to a module's default export, and it is a genuine
 *      value export of a thing that is not a named declaration.
 *
 *   P3 `class_alias` / `function_alias` — publishes a name that no declaration
 *      in the file writes. An export performed by a call.
 *
 *   P4 `define('NAME', ...)` with a LITERAL name — creates a global constant
 *      that no `const` declaration in the file declares. An export performed by
 *      a call.
 *
 * A probe that counted every `return` would be the same shape of mistake the
 * gate's header warns about: it would report the construct 20,000 times on
 * function returns and prove nothing. So each probe is a ROLE test on the tree,
 * never a text match, and the role is stated in the comment on each.
 *
 * ## Falsifiability
 *
 * The ruling this probe supports is overturned by ANY of:
 *   - P1 > 0 AND the analyzer does not already emit that symbol as an
 *     `imports` target (then a re-export edge is missing);
 *   - P2 > 0 AND no edge of any kind carries the returned value (then PHP
 *     files hand back values nothing records);
 *   - P3 or P4 > 0 AND the published name is unresolvable (then a name exists
 *     in the graph that no declaration justifies).
 *
 * USAGE: npx tsx validation/m14/fixtures/php/exports-probe.mts
 *        BB_JSON=1 ... > exports-probe.json
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
const repoFilter = process.env.BB_REPOS ? process.env.BB_REPOS.split(",") : null
for (const e of readdirSync(CR)) {
  if (repoFilter && !repoFilter.includes(e)) continue
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "php") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
// The parse-tree probe sweeps the WHOLE admitted corpus — a ruling is a claim
// about the corpus, so it gets the corpus. The `parseFile` cross-check that
// asks "does the analyzer already publish this as imports?" is the expensive
// half and may be sampled; when it is, the denominator is printed.
const SAMPLE = Number(process.env.BB_SAMPLE ?? 0)
let pipelineFiles = files
// `src/ast/engine.ts:1408-1413` arms a 120s `parseBomb` timer around the
// SYNCHRONOUS `parser.parse()` and calls `process.exit(1)` when it fires, so the
// `parseFile` cross-check below can die mid-sweep on one pathological file. The
// cross-check is the only half that calls `parseFile`; the parse-tree probes use
// a local parser instance with no such timer, so they always see the whole
// corpus. `BB_SKIP` therefore filters ONLY the cross-check, and the printed
// denominator says how many files it actually covered — a ruling must not rest
// on a file count the reader cannot see.
const SKIP = (process.env.BB_SKIP ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const crossCheckUniverse = files.filter((f) => !SKIP.some((s) => f.abs.includes(s)))
if (SAMPLE > 0) {
  const byRepo = new Map<string, typeof files>()
  for (const f of crossCheckUniverse) {
    const a = byRepo.get(f.repo) ?? []
    a.push(f)
    byRepo.set(f.repo, a)
  }
  pipelineFiles = []
  for (const arr of byRepo.values()) {
    const take = Math.min(SAMPLE, arr.length)
    const stride = arr.length / take
    for (let i = 0; i < take; i++) pipelineFiles.push(arr[Math.floor(i * stride)])
  }
} else {
  pipelineFiles = crossCheckUniverse
}

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-php.wasm"))))

type Hit = { probe: string; file: string; detail: string }
const hits: Hit[] = []
const perProbeFiles = new Map<string, Set<string>>()
const perProbe = new Map<string, number>()
const nodeTypes = new Map<string, number>()
const bump = (p: string, file: string, detail: string) => {
  perProbe.set(p, (perProbe.get(p) ?? 0) + 1)
  const s = perProbeFiles.get(p) ?? new Set<string>()
  s.add(file)
  perProbeFiles.set(p, s)
  if (hits.length < 400) hits.push({ probe: p, file, detail })
}

/**
 * The DISTINCT TARGET SET, collected UNCAPPED.
 *
 * `hits` stops at 400 entries, which is right for examples and wrong for a
 * census: the first version of this probe derived `p1Targets` from `hits`, so a
 * 6,152-occurrence probe reported the target set of whichever 400 hits landed
 * first. A distinct-name count has to come from a collector that does not stop.
 */
const p1bTargetSet = new Set<string>()

/**
 * Every leaf name the file DECLARES, read off the tree.
 *
 * This is the falsifier for overturn condition (b) — "a qualified `use function` /
 * `use const` whose imported leaf the SAME file declares". The first version of this
 * probe answered a DIFFERENT question ("does the analyzer already publish it as an
 * `imports` target?"), which is coverage, not publication: a name the file both
 * declares and re-exports would already appear as an `imports` target AND be a real
 * `exports` edge, so the coverage test would report it as covered and the verdict
 * would survive it. The declaration test is the one that can falsify the row, so it
 * is measured here and not only inside the gate's own copy of the probe.
 */
const declaredLeaves = (root: any): Set<string> => {
  const out = new Set<string>()
  const DECL = new Set(["function_definition", "method_declaration", "class_declaration", "interface_declaration", "trait_declaration", "enum_declaration"])
  const visit = (n: any): void => {
    if (DECL.has(n.type)) {
      const nm = n.namedChildren?.find((k: any) => k.type === "name")
      if (nm?.text) out.add(String(nm.text))
    }
    if (n.type === "const_declaration") {
      for (const c of n.namedChildren ?? []) {
        if (c.type !== "const_element") continue
        const nm = c.namedChildren?.find((k: any) => k.type === "name")
        if (nm?.text) out.add(String(nm.text))
      }
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(root)
  return out
}

/**
 * The last `\\`-separated segment of a possibly-qualified php name.
 *
 * Declared HERE, before `probeNode`, because `p1Leaf` further down is a `const` and
 * `probeNode` runs during the sweep that precedes it: reaching for the later binding
 * is a temporal-dead-zone ReferenceError, not a wrong answer, but it kills the run
 * before the first qualified occurrence is reported.
 */
/**
 * The first argument's VALUE node, looking THROUGH the `argument` wrapper.
 *
 * ## Why this exists — a vacuous zero caught by a control, not by the corpus
 *
 * The first version of P4 read `args.namedChild(0)` and tested it for `string` /
 * `encapsed_string`. tree-sitter-php does not put the value there: `arguments`
 * holds an `argument` node per argument, and the value is ITS named child:
 *
 *   function_call_expression
 *     name            "define"
 *     arguments
 *       argument                 <- namedChild(0) returned THIS
 *         encapsed_string        <- the node the test wanted
 *           string_content
 *
 * So the test compared an `argument` node against two string node types, never
 * matched, and P4 reported 0 occurrences — on a corpus sweep of 4,642 files,
 * reported next to a count of 6,140 for P1a, with nothing marking it as a probe
 * that cannot fire. A corpus cannot falsify that number: no corpus can make it
 * non-zero. The control corpus is what found it — one file containing
 * `define("MY_GLOBAL_CONST", 42);` read 0.
 *
 * This is the whole argument for a positive control on a falsifiable probe, and
 * it is why the control corpus is committed next to the probe rather than run once.
 */
const firstArgumentValue = (call: any): any => argumentValueAt(call, 0)

/**
 * The Nth argument's VALUE node, through the `argument` wrapper.
 *
 * The index is a parameter because the argument that matters is NOT always the first:
 * `class_alias(from, to)` publishes `to`, and counting the call by argument 0 (the name
 * being aliased) would report the wrong string as the published name — and, since a
 * `class_alias` of a class expression has no literal first argument, would report a real
 * publication as un-nameable. The corpus has 0 alias calls in total, so this cannot move
 * a corpus number; it is here so the shape's own number means what it says.
 */
const argumentValueAt = (call: any, index: number): any => {
  const args = call.namedChildren?.find((k: any) => k.type === "arguments")
  const wanted = args?.namedChild(index)
  if (!wanted) return null
  return wanted.type === "argument" ? wanted.namedChild(0) : wanted
}

/**
 * The NAME a string literal writes — its text with the quotes removed, and the escape
 * sequences a double-quoted literal may contain left as written.
 *
 * The quotes matter: `first.text` for both `'ABS_CONST'` and `"ABS_CONST"` INCLUDES the
 * delimiters, so an audit that published `first.text` would report every publication as
 * `"'ABS_CONST'"` while the analyzer's edge target is `ABS_CONST` — a comparison that
 * looks like a mismatch in the CORPUS rather than in the instrument. The analyzer slices
 * the quotes off for the same reason (`value.text.slice(1, -1)`), and the two sides have to
 * agree on what a published name IS before either can be checked against the other.
 *
 * Escapes are deliberately NOT unescaped: a name written `"A\\nB"` publishes the
 * characters `A\nB`, and resolving that difference is the analyzer's rule to state, not
 * this probe's to invent.
 */
const phpLiteralText = (n: any): string => {
  const t = String(n?.text ?? "")
  return t.length >= 2 ? t.slice(1, -1) : t
}

const leafName = (s: string): string => {
  const i = s.lastIndexOf("\\")
  return i >= 0 ? s.substring(i + 1) : s
}

/**
 * The alias names a file binds to the GLOBAL `define` — `use function define;` and
 * `use function define as d;`.
 *
 * ## Why this is a separate, whole-file collection
 *
 * The analyzer's publication rule tests the CALLEE NODE's own spelling (`fn.text ===
 * "define"`), which is a grammar fact and needs no file context. An alias is not: after
 * `use function define as d;`, the call `d('X', 1)` reaches the global `define` and DOES
 * publish `X`, while the callee spells `d`. So the question "is this call a publication"
 * cannot be answered from the call node at all, and the answer has to be collected before
 * the walk — node order is not source order, so a `use` clause that appears above the call
 * in the file may be visited after it.
 *
 * The collection is per FILE and reset per file (see the sweep): an alias set that
 * survived into the next file would answer one file's call with another file's imports,
 * which is a number that looks measured and is not.
 */
const collectDefineAliases = (root: any): Set<string> => {
  const out = new Set<string>()
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "namespace_use_clause") {
      // ROLE: the `function` keyword TOKEN inside the clause — the same role test P1
      // uses, so a `use const define` or a comment cannot fake it.
      let isFunctionUse = false
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c && !c.isNamed && c.type === "function") isFunctionUse = true
      }
      if (isFunctionUse) {
        const target = n.namedChildren?.find((k: any) => k.type === "name" || k.type === "qualified_name")
        if (target && leafName(String(target.text)) === "define") {
          // The alias, when there is one, is the clause's own `as` target. With no
          // `as`, the binding is the leaf spelling of the imported name — PHP's rule.
          const aliasClause = n.namedChildren?.find((k: any) => k.type === "namespace_aliasing_clause")
          const aliasName = aliasClause?.namedChildren?.find((k: any) => k.type === "name")
          out.add(String(aliasName?.text ?? "define"))
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
  return out
}

/**
 * Does this file DECLARE a function named `define`?
 *
 * This is the only way the bare-callee test can be unsound: inside `namespace App;`, a
 * bare `define('X', 1)` resolves to `App\define` if this file (or a file it includes)
 * declares one, and PHP only falls back to the global function when it does not. Measured
 * rather than assumed, and reported next to the count it could falsify: if this is 0 over
 * the whole population, the bare test publishes for the right reason.
 */
const declaresDefineFunction = (root: any): boolean => {
  let found = false
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "function_definition") {
      const nm = n.childForFieldName?.("name") ?? n.namedChildren?.find((k: any) => k.type === "name")
      if (nm && String(nm.text) === "define") found = true
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
  return found
}

/**
 * Is this call at FILE scope — does it run whenever the file is included?
 *
 * ROLE: a walk up the ancestors that stops at the first function/method/closure/class
 * body. Deliberately NOT `if`/`compound_statement`/`statement`: a call inside a top-level
 * `if` still executes when the file is included, so its publication is guaranteed by the
 * file. This is the analyzer's own scope test, restated from PHP's execution rule rather
 * than read out of the analyzer — the count is worthless if both sides share the test's
 * code, and the shared thing here is the RULE, not a function.
 */
const DEFINE_BODY_KINDS = new Set([
  "function_definition", "method_declaration", "anonymous_function", "arrow_function",
  "class_declaration", "interface_declaration", "trait_declaration", "enum_declaration",
  "function_static_declaration",
])
const isFileLevelCall = (n: any): boolean => {
  let a: any = n.parent
  let guard = 0
  while (a && guard++ < 64) {
    if (DEFINE_BODY_KINDS.has(String(a.type))) return false
    if (a.type === "program") return true
    a = a.parent
  }
  return false
}

/** P1b occurrences whose imported leaf the SAME file also declares — the overturn. */
const p1bRedeclaredByFile: { file: string; target: string; leaf: string }[] = []
/** Per-file leaf set, computed lazily and once: R3 fires at most a handful of times per file. */
let fileLeaves: Set<string> | null = null
/** Per-file `use function define [as X]` bindings. Reset per file — see the sweep. */
let fileDefineAliases: Set<string> = new Set<string>()
/** Per-file: does it declare its own `define`? The bare-callee test's only unsoundness. */
let fileDeclaresDefine = false
/**
 * The DEFINE-AUDIT collectors, all UNCAPPED.
 *
 * The published census says this lane emits 57 `exports` edges. That is a count of EDGES,
 * and it cannot say whether the set is right: it has no denominator and no excluded rows.
 * The audit below builds the denominator from the tree — every `define`-family call in the
 * population, split by the two properties that decide publication (the callee's resolution
 * and the call's scope) and by whether the first argument is a literal name — so that the
 * emitted set can be checked as a SET: `file-level + literal + publishes` must equal the
 * edge count EXACTLY, and every excluded occurrence must print with the reason that
 * excludes it. A capped sample cannot do that, so nothing here stops at 400.
 */
const defineAudit = new Map<string, number>()
/**
 * The shape/scope/literalness keys, PRE-SEEDED at 0.
 *
 * A key that only appears once it fires cannot be distinguished from a classifier that can
 * never produce it — which is the defect this probe's own history is made of (the `argument`
 * wrapper: a probe that could only read 0, printed beside a six-thousand count with nothing
 * marking it as broken). A zero here is a MEASUREMENT: it says the sweep looked for this shape
 * in 5,094 files and found none. An absent key says nothing at all.
 */
const DEFINE_SHAPES = [
  "bare", "absolute-fq", "namespace-relative", "namespaced-other", "aliased-use-function",
  "dynamic-callee", "method-named-define", "bare-shadowed-by-declared-define",
  "alias-call",
] as const
for (const shape of DEFINE_SHAPES) {
  for (const scope of ["file-level", "nested"]) {
    for (const lit of ["literal", "non-literal"]) defineAudit.set(`${shape}|${scope}|${lit}`, 0)
  }
}
const definePublications: { file: string; callee: string; calleeNodeType: string; name: string }[] = []
const aliasCallRows: { file: string; callee: string; fileLevel: boolean; literal: boolean; published: string | null; text: string }[] = []

/** The scope kinds that make a `return` a FUNCTION return rather than a file-scope one. */
const SCOPE_KINDS = new Set([
  "function_definition", "method_declaration", "anonymous_function", "arrow_function",
  "class_declaration", "interface_declaration", "trait_declaration", "enum_declaration",
  "function_static_declaration", "compound_statement", "statement",
])

/**
 * ONE node, ONE visit, four role tests. Every test is a test on a NODE or a
 * TOKEN the grammar produced, never on file text, so a string literal or a
 * comment cannot produce a hit — which is the property that makes the count
 * worth reporting (see the gate header's two false-positive regex probes).
 */
const probeNode = (n: any, label: string, root: any): void => {
  // ---- P1: `use function` / `use const`.
  // ROLE: the `function`/`const` keyword TOKEN inside a `namespace_use_clause`.
  //
  // P1 is then SPLIT, because the split is the whole verdict and a single count
  // would hide it:
  //
  //   P1a  `use function array_merge;` inside `namespace A;` — the target is
  //        UNQUALIFIED, so PHP resolves it against the GLOBAL namespace. It
  //        imports a builtin the current namespace could already call. Nothing
  //        is added to A's surface that was not already there, and a name A now
  //        answers to is a name the whole program answers to. This is an
  //        IMPORT of a global, not a re-export of A's own.
  //
  //   P1b  `use function B\f;` inside `namespace A;` — the target is QUALIFIED
  //        and therefore lives in another namespace. `A\f` becomes a name A
  //        answers to that only A answers to. This is a genuine
  //        namespace-scoped re-export, and it is the only shape in this probe
  //        that a consumer could not answer by reading A's own symbol table.
  //
  // The first version of this probe reported P1 as one number and its
  // not-published sample was `preg_replace_callback, asort, mkdir, PHP_OS,
  // CACHE_DIR` — every one of them a P1a global builtin. A count that mixes the
  // two reads as "6,152 re-exports exist", which the corpus does not say.
  if (n.type === "namespace_use_clause") {
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c && !c.isNamed && (c.type === "function" || c.type === "const")) {
        const name = n.namedChildren.find((k: any) => k.type === "name" || k.type === "qualified_name")
        const txt = String(name?.text ?? n.text)
        const qualified = txt.includes("\\")
        const kind = qualified ? "P1b-qualified-reexport" : "P1a-global-builtin-import"
        if (qualified) {
          p1bTargetSet.add(txt)
          // The falsifier for overturn (b), measured here rather than only in the gate.
          // Lazily, ONCE per file: the walk is whole-file and P1b fires at most a
          // handful of times per file, so recomputing per occurrence would be the
          // dominant cost of the sweep.
          if (fileLeaves === null) fileLeaves = declaredLeaves(root)
          const leaf = leafName(txt)
          if (fileLeaves.has(leaf)) p1bRedeclaredByFile.push({ file: label, target: txt, leaf })
        }
        bump(kind, label, `${c.type} ${txt}`)
      }
    }
  }

  // ---- P2: a FILE-LEVEL `return <expr>`.
  // ROLE: a `return_statement` whose every ancestor up to `program` is a
  // statement/compound_statement — no function and no class in the chain. A
  // function `return` is excluded BY CONSTRUCTION here, not by a text test,
  // which is the only way this probe is worth anything.
  if (n.type === "return_statement") {
    let a: any = n.parent
    let fileLevel = true
    let guard = 0
    while (a && guard++ < 64) {
      if (SCOPE_KINDS.has(a.type)) {
        fileLevel = false
        break
      }
      if (a.type === "program") break
      a = a.parent
    }
    if (fileLevel) {
      // P2 is also split, for the same reason. `return;` and `return true;`
      // hand back nothing a caller can name; `return [Advisor::class => ...]`
      // hands back an array whose KEYS name declarations. The first version
      // reported 30 and let the reader assume all 30 were the second shape.
      const expr = n.namedChild(0)
      const bare = !expr
      const scalarish = !bare && ["boolean", "integer", "float", "null", "string", "encapsed_string", "nowdoc_string", "heredoc"].includes(String(expr.type))
      const kind = bare || scalarish ? "P2a-file-level-return-no-named-value" : "P2b-file-level-return-named-value"
      bump(kind, label, `${n.text.replace(/\s+/g, " ").slice(0, 80)}  [${expr?.type ?? "(none)"}]`)
    }
  }

  // ---- P3 and P4: an export performed by a CALL.
  // ROLE: a `function_call_expression` whose `function` field is exactly the
  // bare name. A qualified `Foo\class_alias` and a variable callee are both
  // excluded, so neither a string nor a variable can fake it. P4 additionally
  // requires the first argument to be a `string`/`encapsed_string` NODE.
  if (n.type === "function_call_expression") {
    const fn = n.childForFieldName?.("function")
    const nm = fn?.text
    if (nm === "class_alias" || nm === "function_alias") {
      bump("P3-alias-call", label, n.text.replace(/\s+/g, " ").slice(0, 80))
      // Scope-split here too, for the same reason it is split below: a file-level
      // `class_alias('A\\B', 'C')` publishes the class name `C` for every consumer of the
      // file, while the same call inside a method publishes it only if that method runs.
      const published = argumentValueAt(n, 1)
      const literal = !!(published && (published.type === "string" || published.type === "encapsed_string"))
      const fileLevel = isFileLevelCall(n)
      if (aliasCallRows.length < 400) {
        aliasCallRows.push({
          file: label,
          callee: String(nm),
          fileLevel,
          literal,
          published: literal ? phpLiteralText(published) : null,
          text: n.text.replace(/\s+/g, " ").slice(0, 90),
        })
      }
      defineAudit.set(`alias-call|${fileLevel ? "file-level" : "nested"}|${literal ? "literal" : "non-literal"}`, (defineAudit.get(`alias-call|${fileLevel ? "file-level" : "nested"}|${literal ? "literal" : "non-literal"}`) ?? 0) + 1)
    }
    if (nm === "define") {
      const first = firstArgumentValue(n)
      if (first && (first.type === "string" || first.type === "encapsed_string")) {
        bump("P4-define-literal", label, `${first.text}  [${first.type}]`)
      } else if (first) {
        bump("P4b-define-non-literal", label, `${first.type}  (no literal name to publish)`)
      }
    }
    // ---- P4-AUDIT: the callee's RESOLUTION shape, which is what decides whether a
    // `define`-spelled call is a publication at all. Read off the callee NODE (its type and
    // its own text), never off the file's bytes, and never off a regex.
    //
    //   bare                `define('X',1)`        — global, unless a `define` is declared
    //                                                in the file's own namespace (measured).
    //   absolute-fq         `\define('X',1)`       — absolute: PHP does not apply the
    //                                                current namespace, so this IS the
    //                                                global function. Publishes.
    //   namespace-relative  `namespace\define(...)` — resolves to the CURRENT namespace's
    //                                                `define` when one exists, else falls
    //                                                back to the global. Not decidable from
    //                                                the call site, so not counted.
    //   namespaced-other    `App\define(...)`     — a DIFFERENT function. Never publishes.
    //   aliased-use-function `use function define as d; d('X',1)` — reaches the global.
    //                                                Publishes.
    //   dynamic-callee      `$f('X',1)`           — unresolvable. Never counted.
    const raw = String(fn?.text ?? "")
    const fnType = String(fn?.type ?? "")
    const shape =
      raw === "define" ? "bare"
      : raw === "\\define" ? "absolute-fq"
      : raw.startsWith("namespace\\") && raw.endsWith("define") ? "namespace-relative"
      : raw.endsWith("\\define") ? "namespaced-other"
      : fileDefineAliases.has(raw) ? "aliased-use-function"
      // A method CALL named `define` is not the function and PHP never routes it to the
      // function: `$this->define(...)`, `self::define(...)`, `Foo::define(...)`. It is its own
      // shape because calling it `dynamic-callee` would report a member call as an
      // unresolvable function call — a number that reads like a fact about function calls.
      //
      // The test is on the CALL node (`n.type`), not on the callee field, and that is a
      // MEASURED correction: `member_call_expression` and `scoped_call_expression` leave the
      // `function` field NULL and carry the member name in a `name` field, so a test on the
      // field's own type can never see them (`validation/m14/fixtures/php/callee-shapes.mts`
      // prints the spellings side by side AND asserts their field shapes). Written the other
      // way, `method-named-define` was a pre-seeded key that no input could ever populate — a
      // vacuous zero of exactly the kind this probe's history is made of.
      : n.type === "member_call_expression" || n.type === "nullsafe_member_call_expression" || n.type === "scoped_call_expression" ? "method-named-define"
      : fnType === "variable_name" ? "dynamic-callee"
      : "other-callee"
    if (shape !== "other-callee") {
      const first = firstArgumentValue(n)
      const literal = !!(first && (first.type === "string" || first.type === "encapsed_string"))
      const fileLevel = isFileLevelCall(n)
      // A bare callee in a file that DECLARES its own `define` does not reach the global
      // one: PHP resolves the unqualified name against the current namespace first. It is
      // its own shape, not a publication, and it is not `namespace-relative` either —
      // that shape at least falls back when the declaration is absent.
      const effectiveShape = shape === "bare" && fileDeclaresDefine ? "bare-shadowed-by-declared-define" : shape
      const key = `${effectiveShape}|${fileLevel ? "file-level" : "nested"}|${literal ? "literal" : "non-literal"}`
      defineAudit.set(key, (defineAudit.get(key) ?? 0) + 1)
      // The publication SET, uncapped. A `define`-spelled call publishes only when the
      // callee resolves to the global function AND the call is at file scope AND the name
      // is writable down. Everything else is an excluded row with a stated reason.
      const publishes = (effectiveShape === "bare" || effectiveShape === "absolute-fq" || effectiveShape === "aliased-use-function") && fileLevel && literal
      if (publishes) {
        definePublications.push({ file: label, callee: raw, calleeNodeType: fnType, name: phpLiteralText(first) })
      }
    }
  }
}

/** Files that declare their own `define` — the bare-callee test's only unsoundness. */
const fileDeclaresDefineFiles: string[] = []

for (const f of files) {
  const label = `${f.repo}/${f.rel}`
  // RESET per file. A file-scoped cache that survives into the next file would
  // answer the falsifier with the PREVIOUS file's declarations, which is a
  // number that looks measured and is not.
  fileLeaves = null
  const t = parser.parse(f.text)
  // Collected BEFORE the walk: node order is not source order, so an alias introduced
  // above a call in the file may be visited after it.
  fileDefineAliases = t ? collectDefineAliases(t.rootNode) : new Set<string>()
  fileDeclaresDefine = t ? declaresDefineFunction(t.rootNode) : false
  if (fileDeclaresDefine) fileDeclaresDefineFiles.push(label)
  if (!t) continue
  const v = (n: any) => {
    nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1)
    probeNode(n, label, t.rootNode)
    for (let i = 0; i < n.childCount; i++) v(n.child(i))
  }
  v(t.rootNode)
  t.delete?.()
}

// ---- Does the analyzer already record the P1 symbols? Cross-check with the
// production entry point, so "already covered by imports" is a measurement.
const importTargets = new Set<string>()
let idx = 0
/**
 * Cross-check files that actually COMPLETED, and the ones that threw.
 *
 * The first version printed `pipelineCrossCheckFiles: pipelineFiles.length` — the
 * count it INTENDED to cover. That is not the count it covered: `src/ast/engine.ts`
 * arms a 120s self-destruct that calls `process.exit(1)` mid-sweep on a
 * pathologically slow file, and when that fires the `imports` target set below is
 * whatever the workers had accumulated — a partial set published under a full
 * denominator. `alreadyPublishedAsImports` measured against a truncated target set
 * reads as "not published", which is the direction that manufactures a gap.
 */
let crossCheckCompleted = 0
let crossCheckFailed = 0
const crossCheckFailures: string[] = []
async function worker() {
  while (true) {
    const i = idx++
    if (i >= pipelineFiles.length) return
    const f = pipelineFiles[i]
    let r: any
    try {
      r = await parseFile(f.abs, f.dir)
    } catch (err: any) {
      crossCheckFailed++
      if (crossCheckFailures.length < 10) crossCheckFailures.push(`${f.repo}/${f.rel}: ${(err as any)?.message ?? String(err)}`)
      continue
    }
    crossCheckCompleted++
    for (const x of (r?.relationships ?? []) as any[]) {
      const ty = String(x?.type ?? x?.relationshipType ?? "").toLowerCase()
      if (ty !== "imports") continue
      const t = String(x?.to ?? x?.target ?? x?.toSymbol ?? "")
      if (t) importTargets.add(t)
    }
  }
}
await Promise.all(Array.from({ length: Number(process.env.BB_WORKERS ?? 8) }, () => worker()))

// P1b targets, resolved against what `imports` already publishes. Sourced from
// the UNCAPPED collector, not from `hits`.
const p1Targets = p1bTargetSet
const p1Leaf = (s: string) => s.split("\\").pop() ?? s
const p1Covered = [...p1Targets].filter((t) => importTargets.has(t) || importTargets.has(p1Leaf(t)))
const p1Uncovered = [...p1Targets].filter((t) => !importTargets.has(t) && !importTargets.has(p1Leaf(t)))

const out = {
  generatedAt: new Date().toISOString(),
  corpusRoot: CR,
  filesScanned: files.length,
  pipelineCrossCheckFiles: pipelineFiles.length,
  pipelineCrossCheckCompleted: crossCheckCompleted,
  pipelineCrossCheckFailed: crossCheckFailed,
  pipelineCrossCheckFailures: crossCheckFailures,
  pipelineCrossCheckUniverse: crossCheckUniverse.length,
  envSkippedForParseBomb: SKIP,
  distinctNodeTypes: nodeTypes.size,
  probes: {
    "P1a-global-builtin-import": { occurrences: perProbe.get("P1a-global-builtin-import") ?? 0, files: perProbeFiles.get("P1a-global-builtin-import")?.size ?? 0 },
    "P1b-qualified-reexport": { occurrences: perProbe.get("P1b-qualified-reexport") ?? 0, files: perProbeFiles.get("P1b-qualified-reexport")?.size ?? 0 },
    "P2a-file-level-return-no-named-value": { occurrences: perProbe.get("P2a-file-level-return-no-named-value") ?? 0, files: perProbeFiles.get("P2a-file-level-return-no-named-value")?.size ?? 0 },
    "P2b-file-level-return-named-value": { occurrences: perProbe.get("P2b-file-level-return-named-value") ?? 0, files: perProbeFiles.get("P2b-file-level-return-named-value")?.size ?? 0 },
    "P3-alias-call": { occurrences: perProbe.get("P3-alias-call") ?? 0, files: perProbeFiles.get("P3-alias-call")?.size ?? 0 },
    "P4-define-literal": { occurrences: perProbe.get("P4-define-literal") ?? 0, files: perProbeFiles.get("P4-define-literal")?.size ?? 0 },
    "P4b-define-non-literal": { occurrences: perProbe.get("P4b-define-non-literal") ?? 0, files: perProbeFiles.get("P4b-define-non-literal")?.size ?? 0 },
  },
  p1Targets: {
    distinct: p1Targets.size,
    alreadyPublishedAsImports: p1Covered.length,
    notPublishedAsImports: p1Uncovered.length,
    notPublishedSample: p1Uncovered.slice(0, 25),
    // The WHOLE target set, not a sample: a count a reader cannot audit is the
    // thing this artifact exists to replace.
    list: [...p1Targets].sort(),
  },
  // ---- P4-AUDIT: the denominator the committed edge count never had.
  //
  // `define`-family calls, every one, split by callee resolution | scope | name
  // literalness. `definePublications` is the SET the publication rule of PHP implies —
  // file-scope, literal name, callee resolves to the global `define` — and its count is
  // the number the analyzer's `exports` edges must equal EXACTLY. A shortfall is a missed
  // relationship (a name PHP publishes that the graph does not carry), an excess is an
  // edge asserting a name the file does not publish.
  defineAudit: {
    byShapeScopeName: Object.fromEntries([...defineAudit.entries()].sort()),
    publicationsExpected: definePublications.length,
    publications: definePublications,
    // The bare-callee test's one unsoundness, measured rather than assumed.
    filesDeclaringTheirOwnDefine: fileDeclaresDefineFiles,
    aliasCalls: {
      fileLevelLiteral: aliasCallRows.filter((r) => r.fileLevel && r.literal).length,
      rows: aliasCallRows.slice(0, 40),
    },
  },
  // The falsifier for overturn (b), measured on the tree. Non-empty means the
  // `exports` ruling is WRONG and the gate must print FALSIFIED.
  p1bRedeclaredByFile: { count: p1bRedeclaredByFile.length, occurrences: p1bRedeclaredByFile.slice(0, 25) },
  importTargetsDistinct: importTargets.size,
  examples: hits.slice(0, 40),
}
if (process.env.BB_JSON) {
  console.log(JSON.stringify(out, null, 2))
} else {
  console.log(`php exports probe (instrument B) — ${out.generatedAt}`)
  console.log(`parse-tree probes swept: ${out.filesScanned} files   pipeline cross-check: ${out.pipelineCrossCheckCompleted}/${out.pipelineCrossCheckFiles} completed, ${out.pipelineCrossCheckFailed} failed`)
  if (out.pipelineCrossCheckFailed) console.log(`  cross-check failures: ${out.pipelineCrossCheckFailures.join(" | ")}`)
  if (out.pipelineCrossCheckCompleted !== out.pipelineCrossCheckFiles) console.log(`  INCOMPLETE: \`alreadyPublishedAsImports\` below is measured against a TRUNCATED imports target set`)
  console.log(`distinct node types observed: ${out.distinctNodeTypes}`)
  for (const [k, v] of Object.entries(out.probes)) {
    console.log(`  ${k.padEnd(28)} ${String(v.occurrences).padStart(7)} occurrences in ${String(v.files).padStart(5)} files`)
  }
  console.log(`P1b distinct QUALIFIED re-exported symbols: ${out.p1Targets.distinct}   already published as \`imports\`: ${out.p1Targets.alreadyPublishedAsImports}   NOT published: ${out.p1Targets.notPublishedAsImports}`)
  console.log(`  targets: ${out.p1Targets.list.join(", ") || "(none)"}`)
  console.log(`P1b occurrences whose imported leaf the SAME file also DECLARES (overturn (b)): ${out.p1bRedeclaredByFile.count}`)
  for (const o of out.p1bRedeclaredByFile.occurrences) console.log(`  ${o.file}: ${o.target} — the same file declares \`${o.leaf}\``)
  if (out.p1Targets.notPublishedAsImports) console.log(`  not-published sample: ${out.p1Targets.notPublishedSample.join(", ")}`)
  console.log(`distinct \`imports\` targets the analyzer publishes corpus-wide: ${out.importTargetsDistinct}`)
  console.log("")
  console.log(`define-AUDIT — every \`define\`-family call in the ${out.filesScanned}-file population, by callee resolution | scope | name literalness:`)
  for (const [k, v] of Object.entries(out.defineAudit.byShapeScopeName)) {
    console.log(`  ${k.padEnd(52)} ${String(v).padStart(6)}`)
  }
  console.log(`  publications the tree implies (file-level + literal + callee resolves to the global \`define\`): ${out.defineAudit.publicationsExpected}`)
  console.log(`    the analyzer's \`exports\` edges must equal this EXACTLY; a shortfall is a missed publication`)
  for (const p of out.defineAudit.publications) console.log(`    ${p.file}  ${p.callee}${p.name}`)
  console.log(`  files declaring their OWN \`define\` (the bare-callee test's only unsoundness): ${out.defineAudit.filesDeclaringTheirOwnDefine.length}${out.defineAudit.filesDeclaringTheirOwnDefine.length ? "  " + out.defineAudit.filesDeclaringTheirOwnDefine.join(", ") : ""}`)
  console.log(`  class_alias/function_alias calls at FILE scope with a literal first argument (a published name the lane may not carry): ${out.defineAudit.aliasCalls.fileLevelLiteral}`)
  for (const a of out.defineAudit.aliasCalls.rows.filter((r) => r.fileLevel && r.literal).slice(0, 20)) console.log(`    ${a.file}: ${a.text}`)
  console.log(`examples:`)
  for (const h of out.examples) console.log(`  [${h.probe}] ${h.file}: ${h.detail}`)
}
