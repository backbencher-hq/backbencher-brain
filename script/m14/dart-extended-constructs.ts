/**
 * DART EXTENDED CONSTRUCTS — THE MEASUREMENT THAT DECIDES `renders` AND `decorates`.
 *
 * ## WHY THIS INSTRUMENT EXISTS
 *
 * The Lead's ruling on the two extended values a lane cannot simply declare is precise, and it is the
 * ruling this instrument exists to satisfy:
 *
 *   · **THE ZERO-EMISSION FACT IS A CLAIM ABOUT TWO SUBJECTS.** "The analyzer emits this type zero
 *     times" is a claim about the ANALYZER, and an analyzer that merely lacks an emission site is an
 *     UNIMPLEMENTED type — a gap, which does NOT shrink the denominator. Only the GRAMMAR-side half
 *     makes it an exclusion: the language has no such construct, measured over the grammar's own
 *     node-type inventory.
 *   · **BEFORE A RULING, LOOK FOR THE CONSTRUCT IN THE CORPUS.** The csharp lane found that C#'s
 *     `renders` was NOT a zero-emission fact: C#'s grammar HAS the construct — the dynamic render
 *     host `builder.RenderComponent<Widget>()`, with the component as a TYPE ARGUMENT — and the
 *     EXISTING `invocation_expression` node type carries it, so no grammar change was needed. A lane
 *     that rules without looking has not answered the question.
 *
 * So the question for dart is a CORPUS question, and it is measured here, over the whole admitted
 * population, with the shapes NAMED:
 *
 *   `renders`   — a component RENDERS another component. Three candidate shapes are counted:
 *                  build_returns_creation — a `build` method whose body returns an instance creation
 *                                        naming a class (Flutter's rendering entry point; the
 *                                        structural analogue of JSX's `<Child/>` inside a component)
 *                  render_host_call       — a call whose method name denotes rendering AND that
 *                                        carries a TYPE ARGUMENT naming a type (csharp's shape)
 *                  type_arg_call         — a call with a type argument and NO render-denoting name
 *                                        (the REFUSAL shape: a type argument alone is not a render)
 *                  child_named_arg       — a named argument (`child:`, `home:`, `builder:`) whose
 *                                        value is an instance creation (the widget-tree shape)
 *   `decorates` — a decorator is APPLIED TO a declaration. The shapes counted:
 *                  annotation_nodes       — every annotation site, split by whether the annotation
 *                                        CARRIES ARGUMENTS (a const constructor invocation) or is a
 *                                        bare marker, and by the carrier it marks
 *                  annotation_arg_carrier — the count where the annotation's OWN arguments mention the
 *                                        declaration it marks (the test that separates an APPLIED
 *                                        CALLABLE from passive metadata: in python, `deco(f)` PASSES
 *                                        the declaration; in dart there is no syntax for it)
 *
 * ## WHAT IT DOES NOT CLAIM
 *
 * It does not decide the ruling and it does not emit anything. It measures the population the ruling
 * is made over, so a ruling is a MEASUREMENT with a count and not a sentence.
 *
 * Usage:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/dart-extended-constructs.ts [--json <out.json>] [--limit N]
 */
import { readFileSync, statSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const eq = argv.find((a) => a.startsWith(`${f}=`))
  if (eq) return eq.slice(eq.indexOf("=") + 1)
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const JSON_OUT = argOf("--json")
const LIMIT = Number(argOf("--limit") ?? "0")
// // THE CHUNKING FLAGS. THE MECHANISM, MEASURED (the Lead, with a control): the growth is the
// UNFREED TREES, not the parse count — the shared path frees each tree
// (src/ast/engine.ts:2244-2245, inside parseFile) and is safe; THIS INSTRUMENT IS THE
// COUNTEREXAMPLE: it holds every tree it parses and never calls tree.delete(), so its
// module runs out at ~7,600 files and every later `new Parser` ABORTS — a run that
// LOOKS complete and silently measures a fraction of it. So the walk is chunked (this
// lane's own arm cap is 2,000 files), one PROCESS per chunk, and the chunk JSONs are
// merged by script/m14/dart-census-merge.ts. The chunks are DISJOINT, so summing their
// rows and their file counts is exact, not an estimate. Shared probe:
// script/m14/wasm-parse-lifetime.ts (exit 5 on an abort).
const REPO = argOf("--repo") ?? ""
const OFFSET = Number(argOf("--offset") ?? "0")
const SIZE_CAP = 1024 * 1024

/** THE CORE MARKERS — dart's annotations that are the LANGUAGE's own, not a user's callable. */
const CORE_MARKERS = new Set([
  "override", "deprecated", "pragma", "immutable", "protected", "visibleForTesting",
  "visibleForOverriding", "mustCallSuper", "nonVirtual", "optionalTypeArgs", "sealed",
  "internal", "literal", "factory", "useResult",
])

type Bucket = { rows: number; files: Set<string> }
const bucket = (): Bucket => ({ rows: 0, files: new Set() })
const bump = (b: Bucket, f: string): void => { b.rows++; b.files.add(f) }

/** REMOVE THE STRING LITERALS FROM A PIECE OF SOURCE TEXT — char-code scan, no regex. */
function stripStringLiterals(text: string): string {
  let out = ""
  let i = 0
  while (i < text.length) {
    const c = text.charCodeAt(i)
    if (c === 39 || c === 34) { // ' or "
      const quote = c
      i++
      while (i < text.length && text.charCodeAt(i) !== quote) i++
      i++
      out += " "
      continue
    }
    out += text[i]
    i++
  }
  return out
}

function admittedFiles(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const { readdirSync } = require("node:fs")
  for (const e of readdirSync(CR, { withFileTypes: true }) as any[]) {
    const dir = path.join(CR, e.name)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
    } catch { continue }
    const files: string[] = []
    for (const rel of tracked) {
      if (!rel.toLowerCase().endsWith(".dart")) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      files.push(abs)
    }
    if (files.length) out.set(e.name, files.sort())
  }
  return out
}

async function main(): Promise<void> {
  const repos = admittedFiles()
  if (repos.size === 0) { console.error("FATAL: no admitted dart files under " + CR); process.exit(2) }
  // THE PARSER IS FETCHED PER FILE, NOT ONCE. A tree-sitter WASM parse of a deeply-nested file
  // can ABORT the module, and an aborted parser fails every later parse instantly: with one
  // cached parser for the whole walk, dart-sdk (25,727 files) was measured in 1 SECOND because
  // every parse after the first abort threw at once. The engine recreates the parser every 500
  // calls (src/ast/engine.ts:901), so fetching per file is what makes the walk SURVIVE an abort —
  // and the failure count is printed, because a number that hides a lost population is not a
  // number.
  const parserFor = async (): Promise<any> => await getParser("dart")

  // THE `renders` CANDIDATES.
  const buildMethods = bucket()
  const buildReturnsCreation = bucket()
  const buildReturnsCall = bucket()
  const buildReturnsVariable = bucket()
  const buildReturnsOther = bucket()
  const buildNoBody = bucket()
  const renderHostCall = bucket()      // a call whose name denotes rendering AND that carries a type argument
  const typeArgCall = bucket()         // a call with a type argument and no render-denoting name (the refusal)
  const childNamedArg = bucket()       // `child:`/`home:`/`builder:` whose value is an instance creation
  const renderedNames = new Map<string, number>()
  const buildReturnTypes = new Map<string, number>()
  const widgetBuildReturnsCreation = bucket()
  const widgetBuildReturnsComponent = bucket()
  // THE `decorates` CANDIDATES.
  const annotationNodes = bucket()
  const annotationWithArgs = bucket()
  const annotationBare = bucket()
  const annotationArgMentionsCarrier = bucket()  // the APPLIED-CALLABLE test
  const annotationCoreMarker = bucket()
  const annotationUserCallable = bucket()
  const annotationByCarrier = new Map<string, Bucket>()
  const annotationNames = new Map<string, number>()
  const appliedCallableSites: any[] = []
  const appliedCallableTrueSites: any[] = []
  const annotationArgNamesCarrier = bucket()
  const annotationArgMemberOfCarrier = bucket()

  let files = 0, parsed = 0, failed = 0
  const perRepo: any[] = []
  const start = Date.now()

  for (const [repo, list] of repos) {
    if (REPO && repo !== REPO) continue
    // THE CHUNK WINDOW — the offset is applied to the FULL list, never to the limited slice:
    // `list.slice(0, LIMIT).slice(OFFSET)` is EMPTY for every offset >= LIMIT, which is how a
    // chunked walk silently measures only the first chunk of every repository.
    const walked = OFFSET > 0 ? list.slice(OFFSET, LIMIT > 0 ? OFFSET + LIMIT : undefined) : (LIMIT > 0 ? list.slice(0, LIMIT) : list)
    const repoBuckets: Record<string, number> = {}
    for (const abs of walked) {
      files++
      const rel = path.relative(path.join(CR, repo), abs).split(path.sep).join("/")
      let src: string
      try { src = readFileSync(abs, "utf8") } catch { failed++; continue }
      let tree: any
      const parser = await parserFor()
      try { tree = parser.parse(src) } catch { failed++; continue }
      if (!tree) { failed++; continue }
      const root = tree.rootNode
      parsed++

      // ── THE ANNOTATIONS (the `decorates` candidates) ───────────────────────────────────────────
      // The dart grammar hangs the annotation on the DECLARATION it marks: for a class it is a
      // CHILD of `class_definition`; for a member it is a CHILD of `class_body` and a SIBLING of
      // the `method_signature`. The carrier is the node the annotation's parent is, or the parent's
      // sibling, and the carrier's KIND is what the analyzer publishes as `annotatedKind`.
      const stack: any[] = [root]
      while (stack.length > 0) {
        const n = stack.pop()
        if (!n) continue
        if (n.type === "annotation") {
          bump(annotationNodes, rel)
          const kids: any[] = n.namedChildren ?? []
          const nameNode = kids.find((k) => k && (k.type === "identifier" || k.type === "scoped_identifier" || k.type === "type_identifier"))
          const spelled = nameNode ? nameNode.text : "(unresolved)"
          annotationNames.set(spelled, (annotationNames.get(spelled) ?? 0) + 1)
          const hasArgs = kids.some((k) => k && k.type === "arguments")
          if (hasArgs) bump(annotationWithArgs, rel); else bump(annotationBare, rel)
          if (CORE_MARKERS.has(spelled)) bump(annotationCoreMarker, rel)
          else bump(annotationUserCallable, rel)
          // THE APPLIED-CALLABLE TEST: does the annotation's OWN argument list mention the carrier?
          // In python, `deco(f)` passes the declaration; in dart the grammar has no field for it.
          const carrier = n.parent
          const carrierName = carrier ? (carrier.childForFieldName?.("name")?.text ?? "") : ""
          // THE CARRIER KIND — the `annotatedKind` the analyzer publishes.
          const carrierType = carrier ? carrier.type : "(none)"
          if (hasArgs && carrierName && spelled && !spelled.startsWith("@")) {
            const argText = kids.filter((k) => k && k.type === "arguments").map((k) => k.text).join(" ")
            if (argText.includes(carrierName)) {
              bump(annotationArgMentionsCarrier, rel)
              // THE SITES THEMSELF — a substring test can be satisfied by a one-letter carrier
              // name, so the reader must see the site, not the count alone.
              if (appliedCallableSites.length < 400) {
                appliedCallableSites.push({
                  file: rel,
                  carrier: carrierName,
                  carrierType,
                  annotation: spelled,
                  args: argText.slice(0, 160),
                })
              }
            }
            // THE SHARPENED TEST — a mention INSIDE A STRING LITERAL is not the declaration being
            // passed to the annotation: `@JsonValue('cancelled')` on a field named `cancelled`
            // spells the field's NAME in a string, it does not pass the field. So the string
            // literals are removed from the arguments and the test is run again on what is left.
            // This is the measurement that separates "the annotation mentions the declaration"
            // from "the annotation is APPLIED TO the declaration".
            const outsideStrings = stripStringLiterals(argText)
            // THE WHOLE-IDENTIFIER TEST — a mention of the carrier's name INSIDE A LONGER NAME is
            // not a mention of the carrier (`Int` inside `Int32()`, `B` inside `Box()`,
            // `AbiSpecificInteger1` inside `AbiSpecificIntegerMapping`), and the annotation's OWN
            // name is not a mention of the carrier either. So the test is on IDENTIFIER TOKENS.
            const tokens = outsideStrings.split(/[^A-Za-z0-9_$]+/).filter(Boolean)
            const wholeWord = tokens.includes(carrierName)
            if (wholeWord && carrierName !== spelled) {
              bump(annotationArgNamesCarrier, rel)
              // THE STATIC-MEMBER SHAPE IS COUNTED SEPARATELY — `C.STATIC_FIELD` and `B.foo` pass a
              // MEMBER of the carrier, not the carrier, and that is where the survivors live.
              const isMemberAccess = tokens.some((t, i) => t === carrierName && tokens[i + 1] !== undefined && /^[A-Za-z_$]/.test(tokens[i + 1]))
              if (isMemberAccess) bump(annotationArgMemberOfCarrier, rel)
              if (appliedCallableTrueSites.length < 400) {
                appliedCallableTrueSites.push({
                  file: rel,
                  carrier: carrierName,
                  carrierType,
                  annotation: spelled,
                  args: argText.slice(0, 160),
                  outsideStrings: outsideStrings.slice(0, 160),
                  isMemberAccess,
                })
              }
            }
          }
          let cb = annotationByCarrier.get(carrierType)
          if (!cb) annotationByCarrier.set(carrierType, (cb = bucket()))
          bump(cb, rel)
        }
        for (const k of n.namedChildren ?? []) if (k) stack.push(k)
      }

      // ── THE `renders` CANDIDATES ───────────────────────────────────────────────────────────────
      // The dart grammar puts a method's SIGNATURE and its BODY as SIBLINGS inside `class_body`,
      // so the body of a `build` method is the `function_body` that FOLLOWS its `method_signature`.
      // THE SIBLING LOOKUP — `namedChildren` RETURNS FRESH WRAPPERS ON EVERY CALL, so `indexOf`
      // against it is ALWAYS -1 (MEASURED: a probe over flutter-packages read `idx = -1` for every
      // method and therefore attributed the FIRST method's body to every method in the class). The
      // API's own `nextNamedSibling` is the correct walk.
      const bodyFor = (sig: any): any => {
        let k = sig.nextNamedSibling
        while (k) {
          if (k.type === "function_body") return k
          if (k.type === "method_signature" || k.type === "field_signature" || k.type === "class_definition") return null
          k = k.nextNamedSibling
        }
        return null
      }
      // THE CONSTRUCTION SHAPES — dart spells a construction three ways, and all three name the
      // type: `const T()` is a `const_object_expression`, `new T()` is a `new_expression`, and the
      // modern `T()` is a BARE `identifier` FOLLOWED BY A `selector` (the call). A bare identifier
      // with NO selector is a VARIABLE, not a construction — that is the refusal.
      const creationTypeOf = (expr: any): string | null => {
        if (!expr) return null
        if (expr.type === "const_object_expression" || expr.type === "new_expression" || expr.type === "instance_creation_expression") {
          const t = expr.childForFieldName?.("type") ?? (expr.namedChildren ?? []).find((k: any) => k && (k.type === "type_identifier" || k.type === "identifier"))
          return t ? t.text : null
        }
        if (expr.type === "identifier") {
          const sib = expr.nextNamedSibling
          return sib && sib.type === "selector" ? expr.text : null
        }
        return null
      }
      const stack2: any[] = [root]
      while (stack2.length > 0) {
        const n = stack2.pop()
        if (!n) continue
        if (n.type === "method_signature") {
          // THE METHOD'S OWN SIGNATURE — the name and the declared return type live on the inner
          // `function_signature`: child 0 is the RETURN TYPE (when there is one) and child 1 carries
          // the `name` field. The return type is Flutter's own rendering marker (`Widget build(...)`).
          const fsig = (n.namedChildren ?? []).find((k: any) => k && k.type === "function_signature")
          const first = fsig?.namedChild?.(0)
          const declaredReturn = first && (first.type === "type_identifier" || first.type === "type") ? first.text : "(none)"
          const sig = fsig?.childForFieldName?.("name")?.text ?? ""
          if (sig === "build") {
            bump(buildMethods, rel)
            buildReturnTypes.set(declaredReturn, (buildReturnTypes.get(declaredReturn) ?? 0) + 1)
            const body = bodyFor(n)
            if (!body) { bump(buildNoBody, rel) }
            else {
              // THE RETURNED EXPRESSION — the `return_statement` inside the body's `block`, or the
              // body's own expression for an arrow body (`=> Widget()`).
              const blk = (body.namedChildren ?? []).find((k: any) => k && k.type === "block")
              const ret = (blk ?? body).namedChildren.find((k: any) => k && k.type === "return_statement")
              const expr = ret ? ret.namedChild(0) : (body.namedChildren ?? []).find((k: any) => k && k.type !== "comment")
              const created = creationTypeOf(expr)
              if (created) {
                bump(buildReturnsCreation, rel)
                if (declaredReturn === "Widget") {
                  bump(widgetBuildReturnsCreation, rel)
                  // THE COMPONENT TEST — a lowercase name is not a class (the same test the JS
                  // lane applies to a JSX tag). This is the population the analyzer publishes.
                  const firstChar = created[0]
                  if (firstChar && firstChar !== firstChar.toLowerCase()) {
                    bump(widgetBuildReturnsComponent, rel)
                    renderedNames.set(created, (renderedNames.get(created) ?? 0) + 1)
                  }
                }
                renderedNames.set(created, (renderedNames.get(created) ?? 0) + 1)
              } else if (!expr) bump(buildReturnsOther, rel)
              else if (expr.type === "identifier") bump(buildReturnsVariable, rel)
              else if (expr.type === "selector" || expr.type === "static_creation_expression") bump(buildReturnsCall, rel)
              else bump(buildReturnsOther, rel)
            }
          }
        }
        if (n.type === "selector" || n.type === "static_creation_expression") {
          const kids: any[] = n.namedChildren ?? []
          const hasTypeArgs = kids.some((k) => k && k.type === "type_arguments")
          if (hasTypeArgs) {
            const nameNode = kids.find((k: any) => k && (k.type === "identifier" || k.type === "selector"))
            const nm = nameNode ? nameNode.text : ""
            if (/^(render|build|create|mount|show|display)/i.test(nm)) bump(renderHostCall, rel)
            else bump(typeArgCall, rel)
          }
          // THE WIDGET-TREE SHAPE — a named argument whose value is an instance creation.
          for (const k of kids) {
            if (!k || k.type !== "argument_part") continue
            for (const a of (k.namedChildren ?? [])) {
              if (!a || a.type !== "named_argument") continue
              const label = a.childForFieldName?.("name")?.text ?? a.text.split(":")[0]
              if (!/^(child|children|home|builder|body|title|content|pageBuilder|itemBuilder)$/.test(label)) continue
              const v = creationTypeOf((a.namedChildren ?? []).find((x: any) => x && x.type !== "label"))
              if (v) bump(childNamedArg, rel)
            }
          }
        }
        for (const k of n.namedChildren ?? []) if (k) stack2.push(k)
      }
      repoBuckets[rel] = 0
    }
    perRepo.push({ repo, files: walked.length })
    console.error(`  repo ${repo}: ${walked.length} files, ${Math.round((Date.now() - start) / 1000)}s`)
  }

  const L: string[] = []
  const say = (s = "") => L.push(s)
  say("DART EXTENDED CONSTRUCTS — the corpus measurement the two rulings are made over")
  say()
  say(`  corpus root  ${CR}`)
  say(`  population   ${files} files over ${repos.size} repos · parsed ${parsed} · failed ${failed} · ${Math.round((Date.now() - start) / 1000)}s`)
  say()
  say("== THE `renders` CANDIDATES (a component RENDERS another component) ==")
  say(`  build methods                       ${String(buildMethods.rows).padStart(9)}   ${String(buildMethods.files.size).padStart(6)} files`)
  say(`    RETURN an instance creation        ${String(buildReturnsCreation.rows).padStart(9)}   ${String(buildReturnsCreation.files.size).padStart(6)} files   <-- the CANDIDATE population`)
  say(`    RETURN a call                      ${String(buildReturnsCall.rows).padStart(9)}   ${String(buildReturnsCall.files.size).padStart(6)} files   (refusal: no component is NAMED)`)
  say(`    RETURN a variable                  ${String(buildReturnsVariable.rows).padStart(9)}   ${String(buildReturnsVariable.files.size).padStart(6)} files   (refusal: no component is NAMED)`)
  say(`    RETURN something else               ${String(buildReturnsOther.rows).padStart(9)}   ${String(buildReturnsOther.files.size).padStart(6)} files`)
  say(`    no body found                      ${String(buildNoBody.rows).padStart(9)}   ${String(buildNoBody.files.size).padStart(6)} files`)
  say(`  render-host calls (render/build/... WITH a type argument)  ${String(renderHostCall.rows).padStart(9)}   ${String(renderHostCall.files.size).padStart(6)} files   (csharp's shape)`)
  say(`  calls with a type argument and NO render name (the REFUSAL shape) ${String(typeArgCall.rows).padStart(9)}   ${String(typeArgCall.files.size).padStart(6)} files`)
  say(`  child/home/builder named args whose value is a creation     ${String(childNamedArg.rows).padStart(9)}   ${String(childNamedArg.files.size).padStart(6)} files`)
  say(`    of those, the DECLARED RETURN TYPE is Widget: ${widgetBuildReturnsCreation.rows} sites (Flutter's own rendering marker)`)
  say(`    of THOSE, the returned name is a CLASS (capitalized): ${widgetBuildReturnsComponent.rows} sites / ${widgetBuildReturnsComponent.files.size} files   <-- THE renders POPULATION the analyzer publishes`)
  say(`  THE DECLARED RETURN TYPES OF THE BUILD METHODS (top 12):`)
  for (const [n, c] of [...buildReturnTypes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) say(`    ${String(c).padStart(8)}  ${n}`)
  say(`  THE MOST-RENDERED NAMES (top 20):`)
  for (const [n, c] of [...renderedNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) say(`    ${String(c).padStart(8)}  ${n}`)
  say()
  say("== THE `decorates` CANDIDATES (a decorator is APPLIED TO a declaration) ==")
  say(`  annotation sites                     ${String(annotationNodes.rows).padStart(9)}   ${String(annotationNodes.files.size).padStart(6)} files`)
  say(`    carrying ARGUMENTS (a const ctor)  ${String(annotationWithArgs.rows).padStart(9)}   ${String(annotationWithArgs.files.size).padStart(6)} files`)
  say(`    bare marker                        ${String(annotationBare.rows).padStart(9)}   ${String(annotationBare.files.size).padStart(6)} files`)
  say(`    a CORE marker (override/deprecated/pragma/...)  ${String(annotationCoreMarker.rows).padStart(9)}   ${String(annotationCoreMarker.files.size).padStart(6)} files`)
  say(`    a USER annotation name             ${String(annotationUserCallable.rows).padStart(9)}   ${String(annotationUserCallable.files.size).padStart(6)} files`)
  say(`  THE APPLIED-CALLABLE TEST — the annotation's OWN arguments MENTION the marked declaration: ${annotationArgMentionsCarrier.rows} sites`)
  say(`    of those, the mention is a WHOLE IDENTIFIER (not inside a longer name) and is not the annotation's own name: ${annotationArgNamesCarrier.rows} sites`)
  say(`      of those, the argument is a MEMBER of the marked declaration (C.STATIC_FIELD, B.foo) and not the declaration itself: ${annotationArgMemberOfCarrier.rows} sites`)
  say(`      THE APPLIED-CALLABLE COUNT (the DECLARATION ITSELF passed to the annotation): ${annotationArgNamesCarrier.rows - annotationArgMemberOfCarrier.rows} sites`)
  say("    (python's `deco(f)` PASSES the declaration; dart's grammar has no field for it, so this is 0 by construction — and that is the measurement)")
  say(`  THE CARRIER KINDS:`)
  for (const [k, b] of [...annotationByCarrier.entries()].sort((a, b) => b[1].rows - a[1].rows)) {
    say(`    ${k.padEnd(28)} ${String(b.rows).padStart(9)}   ${String(b.files.size)} files`)
  }
  say(`  THE MOST-USED ANNOTATION NAMES (top 25):`)
  for (const [n, c] of [...annotationNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) say(`    ${String(c).padStart(8)}  ${n}`)
  console.log(L.join("\n"))

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({
      instrument: "dart-extended-constructs",
      corpusRoot: CR,
      command: `BB_CORPUS_ROOT=${CR} bun run script/m14/dart-extended-constructs.ts --json ${JSON_OUT}`,
      population: { files, repos: repos.size, parsed, failed },
      renders: {
        buildMethods: { rows: buildMethods.rows, files: buildMethods.files.size },
        buildReturnsCreation: { rows: buildReturnsCreation.rows, files: buildReturnsCreation.files.size },
        buildReturnsCall: { rows: buildReturnsCall.rows, files: buildReturnsCall.files.size },
        buildReturnsVariable: { rows: buildReturnsVariable.rows, files: buildReturnsVariable.files.size },
        buildReturnsOther: { rows: buildReturnsOther.rows, files: buildReturnsOther.files.size },
        buildNoBody: { rows: buildNoBody.rows, files: buildNoBody.files.size },
        renderHostCall: { rows: renderHostCall.rows, files: renderHostCall.files.size },
        typeArgCall: { rows: typeArgCall.rows, files: typeArgCall.files.size },
        childNamedArg: { rows: childNamedArg.rows, files: childNamedArg.files.size },
        widgetBuildReturnsCreation: { rows: widgetBuildReturnsCreation.rows, files: widgetBuildReturnsCreation.files.size },
        widgetBuildReturnsComponent: { rows: widgetBuildReturnsComponent.rows, files: widgetBuildReturnsComponent.files.size },
        buildReturnTypes: [...buildReturnTypes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50),
        renderedNames: [...renderedNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100),
      },
      decorates: {
        annotationNodes: { rows: annotationNodes.rows, files: annotationNodes.files.size },
        withArguments: { rows: annotationWithArgs.rows, files: annotationWithArgs.files.size },
        bare: { rows: annotationBare.rows, files: annotationBare.files.size },
        coreMarker: { rows: annotationCoreMarker.rows, files: annotationCoreMarker.files.size },
        userCallable: { rows: annotationUserCallable.rows, files: annotationUserCallable.files.size },
        appliedCallableTest: { rows: annotationArgMentionsCarrier.rows, files: annotationArgMentionsCarrier.files.size },
        appliedCallableSites,
        appliedCallableTrueSites: { rows: annotationArgNamesCarrier.rows, files: annotationArgNamesCarrier.files.size },
        appliedCallableTrueSiteList: appliedCallableTrueSites,
        appliedCallableMemberOfCarrier: { rows: annotationArgMemberOfCarrier.rows, files: annotationArgMemberOfCarrier.files.size },
        byCarrier: Object.fromEntries([...annotationByCarrier.entries()].map(([k, b]) => [k, { rows: b.rows, files: b.files.size }])),
        names: [...annotationNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100),
      },
      perRepo,
    }, null, 2))
    console.log(`WROTE ${JSON_OUT}`)
  }
}

await main()
