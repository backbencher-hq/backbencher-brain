/**
 * ONTOLOGY COVERAGE GATE — the check whose absence let a real defect through.
 *
 * ## Why this gate exists
 *
 * The lane's differential reports 99.9% coverage and 0 UNEXPLAINED across 73,961
 * edges, and that is TRUE — and it hid a missing relationship type for the whole
 * wave. The reason is structural, and no amount of differential testing fixes it:
 *
 *   the differential is independent at the level of IMPLEMENTATION. The analyzer
 *   and the oracle are two separate walkers over one grammar, so they disagree
 *   when either is wrong. But when a relationship type is absent from BOTH —
 *   because the implementer ruled it inapplicable and the oracle was written
 *   after that ruling — there is nothing to disagree about. Both say nothing, and
 *   "nothing" agrees with "nothing" perfectly.
 *
 * `overrides` is the concrete case. Bash redefines functions — 174 redefinition
 * events across 57 of 2,747 admitted files — and a redefinition replaces the
 * prior definition, which is an override in the only sense the language has one.
 * The analyzer omitted it, the oracle omitted it, and the differential was green
 * throughout. Only measuring the LANGUAGE rather than diffing the CODE found it.
 *
 * ## What this gate asserts
 *
 * For every type in the ontology, exactly one of:
 *
 *   EMITTED   the production `parseFile` actually produced it on this corpus, with
 *             a count and the files it came from. Evidence, not assertion.
 *   RULED     the spec carries a written reason AND a CORPUS MEASUREMENT showing
 *             the construct the type would need never occurs. A prose justification
 *             alone is NOT sufficient, because `overrides` had a prose justification
 *             and it was wrong.
 *
 * A ruled type whose construct probe finds a non-zero count is FALSIFIED, and the
 * gate fails. That is the whole point: the ruling is testable, so a wrong ruling
 * cannot survive.
 *
 * READ-ONLY. Writes nothing.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"
import { LANGS } from "./differential"
import { LUA_RULED } from "./lua-ruled"
import { TOML_RULED } from "./toml-ruled"
import { FSHARP_RULED } from "./fsharp-ruled"
// This file is a REGISTRY, so a merge conflict here is always "both sides added a
// lane" and the correct resolution is always the UNION. Taking either side deletes the
// other lane's ruling table SILENTLY, and a deleted entry does not fail loudly — the
// arbiter just exits 2 for that lane again, which reads as "nobody has ruled on this
// yet" rather than "someone's work was dropped in a merge". Silent loss in a registry
// is the failure mode to fear, so resolve toward MORE entries here, never fewer.
//
// The same applies to the import block: it is a registry too. Both halves must be
// present or the map does not compile — which is the one saving grace, because a
// missing import is a hard error rather than a silent wrong answer.
import { PROTOBUF_RULED } from "./protobuf-ruled"
import { ZIG_RULED } from "./zig-ruled"
import { JULIA_RULED } from "./julia-ruled"
import { CSS_RULED } from "./css-ruled"
import { XML_RULED } from "./xml-ruled"
import { NIM_RULED } from "./nim-ruled"
import { SCSS_RULED } from "./scss-ruled"
import { MARKDOWN_RULED } from "./markdown-ruled"
import { PHP_RULED } from "./php-ruled"
import { SQL_RULED } from "./sql-ruled"
import { CLEAN_RULED } from "./clean-ruled"
import { R_RULED } from "./r-ruled"
import { GRAPHQL_RULED } from "./graphql-ruled"
import { DART_RULED } from "./dart-ruled"
import { POWERSHELL_RULED } from "./powershell-ruled"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const LANG = process.argv[2] ?? "bash"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
/**
 * EXPORTED so lane ruling tables can import it instead of restating the shape.
 *
 * Fourteen lanes each declared their own structural copy of `Ruled`, and because those
 * copies typed `type` as `string` while the gate typed it as this literal union, `string`
 * was not assignable and julia-ruled and xml-ruled failed to type-check at all. Their own
 * docblocks predicted this and called the fix 'a one-line follow-up if the gate exports
 * them'.
 *
 * That follow-up is now done rather than pending. Fourteen restatements of one shape is
 * fourteen places for it to drift, and this is the only reason it did.
 */
export type Type = (typeof ALL_TYPES)[number]

// ---------------------------------------------------------------- instruments
//
// A text regex is the WRONG instrument for "does this language have this
// construct", and this gate's first version proved it by returning two
// false positives. A probe for `extends` matched `class voice` inside
// `_comp_compgen -- -W 'up down reset rstat ... class voice iac ...'` — a telnet
// IAC word list in a string. A probe for `instantiates` matched `new Map(` and
// `new Promise(` in a bash file that carries embedded JavaScript in a heredoc.
// Both would have convicted a correct ruling on the strength of a regex.
//
// So there are two instruments, and which one applies is decided by the QUESTION:
//
//   A. GRAMMAR INVENTORY — for a type that needs a node type the language does
//      not have. Enumerating every node type the grammar actually produces is
//      positive evidence of absence: bash yields 164 across the corpus and NONE
//      of them expresses a type declaration or a constructor. That is a fact
//      about the grammar, not a failure to find something.
//
//   B. PARSE-TREE SEMANTIC COUNT — for a type the language CAN express. A second
//      declaration of a name is perfectly good bash, so no grammar inventory will
//      find it; it has to be counted on the tree, where a string or an embedded
//      heredoc cannot fake it.
type Instrument = "A:grammar-inventory" | "B:parse-tree-count"

export type Ruled = {
  type: Type
  instrument: Instrument
  /** A: node types that would express the construct. B: unused. */
  nodeTypesThatWouldMeanIt?: string[]
  /**
   * B only: the count and file count this ruling PUBLISHES, over the corpus the gate
   * discovers. These are the numbers a ruling is accountable to, so they live in the type
   * rather than repeated in prose where they can go stale. julia-ruled's probe reads them
   * directly — it used to hardcode the pair in its own source and reported MISMATCH while
   * exiting 0 when the corpus grew, which is a gate that can neither fail nor be right.
   */
  publishedCount?: number
  publishedFiles?: number
  /** B: count occurrences on the tree. A: unused. */
  countOnTree?: (root: any, fileLabel: string, hits: string[]) => void
  describe: string
}

/**
 * Preorder walk with an EXPLICIT STACK, in the same order as the recursive form it replaces
 * (children are pushed in reverse so `pop()` yields them left to right).
 *
 * WHY NOT RECURSION. Measured 2026-10-07: the recursive walk died with `Maximum call stack
 * size exceeded` on `dart-sdk/tests/language/syntax/deep_nesting_statement_test.dart` — a file
 * dart's own suite keeps in order to exercise deep nesting — and it died AFTER the
 * 33,692-file walk had completed, so the gate walked the whole corpus and then printed no
 * table at all. The same recursion sat in two `countOnTree` helpers a few lines below, where
 * it would have killed Instrument B on a bash or json walk for the same reason. A JS call
 * stack is bounded by nesting depth; an array is not.
 *
 * The visit ORDER is preserved deliberately: the bash probe counts the SECOND declaration of a
 * name, so pushing children in reverse is what keeps "second" meaning the same occurrence it
 * meant before. The change cannot move a count.
 */
function walkPreorder(root: any, visit: (n: any) => void): void {
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    visit(n)
    for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i))
  }
}

const BASH_RULED: Ruled[] = [
  {
    type: "extends",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: ["class_declaration", "class", "interface_declaration", "trait_declaration", "struct_declaration", "inheritance_specifier"],
    describe: "a type declaration another type could extend",
  },
  {
    type: "implements",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: ["implements_clause", "extends_clause", "superclass", "interface_implementation"],
    describe: "a supertype clause naming an implemented or inherited type",
  },
  {
    type: "instantiates",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: ["new_expression", "object_creation_expression", "constructor_invocation"],
    describe: "a constructor call",
  },
  {
    type: "overrides",
    instrument: "B:parse-tree-count",
    // A redefinition is expressible in bash — a second `name() { … }` — so the
    // grammar inventory is silent by construction and the count must be semantic.
    countOnTree: (root, fileLabel, hits) => {
      const seen = new Map<string, number>()
      walkPreorder(root, (n: any) => {
        if (n.type === "function_definition") {
          const named = n.namedChildren?.find((c: any) => c.type === "word")
          const name = named?.text
          if (name) {
            const c = (seen.get(name) ?? 0) + 1
            seen.set(name, c)
            if (c === 2) hits.push(`${fileLabel}: ${name} (redefined)`)
          }
        }
      })
    },
    describe: "a SECOND declaration of a name already declared in the same file — it replaces the prior one",
  },
]

/**
 * json's seven non-emitted types, each with the construct it would need.
 *
 * The bash table above is unchanged and still bash's. The two lanes disagree in the
 * most informative way available: bash emits 7 of 10 and rules 3 on a grammar
 * inventory of 164 node types, while json emits 3 of 10 and rules 7 on an inventory of
 * 26 — and the difference between the two is exactly what each language has. Same
 * ontology, same gate, opposite verdicts, and neither is arbitrary.
 */
const JSON_RULED: Ruled[] = [
  { type: "implements", instrument: "A:grammar-inventory", nodeTypesThatWouldMeanIt: ["implements_clause", "extends_clause", "superclass"], describe: "a supertype clause" },
  { type: "instantiates", instrument: "A:grammar-inventory", nodeTypesThatWouldMeanIt: ["new_expression", "object_creation_expression", "constructor_invocation"], describe: "a constructor call" },
  { type: "overrides", instrument: "A:grammar-inventory", nodeTypesThatWouldMeanIt: ["redefinition", "override_specifier"], describe: "a second declaration replacing a prior one" },
  // `exports` WAS here and was removed: it was ruled on a grammar inventory ("no
  // export_statement node") and that is the same unsound reasoning that produced the
  // wrong `imports` ruling. A grammar cannot see a CONVENTION, and a Node manifest's
  // `exports`/`main`/`bin` are conventions written as ordinary object keys. The audit
  // found 1 of 36 manifests carrying `exports`, so the mass is small and the
  // principle is not: it is emitted now, and the gate re-measures rather than
  // trusting this note.
  // `calls` stays ruled: json has no functions to call, and no convention supplies
  // one. It is listed so the gate reports on all ten types.
  { type: "calls", instrument: "A:grammar-inventory", nodeTypesThatWouldMeanIt: ["function_definition", "method_definition", "call_expression"], describe: "a function definition or call" },
  {
    // `imports` is the one that is NOT settled by the grammar, and it is worth
    // stating why. The grammar has no import node, but that is the wrong question:
    // an EXTERNAL $ref to another file on disk is a file dependency whatever the
    // grammar calls it, and the grammar cannot see it because it is a STRING.
    // So this was measured instead: across the whole 3,334-file corpus, 0 of the
    // external $refs point at another file — 38 name a URL (a JSON-Schema draft
    // identifier, i.e. a vocabulary reference) and 12 name something else. There is
    // no file-to-file $ref to import, so the type has nothing to carry.
    type: "imports",
    instrument: "B:parse-tree-count",
    countOnTree: (root, fileLabel, hits) => {
      // ONLY the value of a `$ref` key. The first version scanned every `string` in
      // the document, and it reported the construct 2,651 times across 103 files — of
      // which the examples were `MANIFEST.json: FILES.json`, a filename sitting in a
      // `files` array. That is not a $ref, it is a list of files a collection ships,
      // and the gate correctly refused to accept my measurement: it said the ruling
      // was falsified by evidence I had manufactured. A probe that matches a SHAPE
      // rather than a ROLE produces a number, and the number is worth nothing.
      walkPreorder(root, (n: any) => {
        if (n.type === "pair") {
          const k = n.childForFieldName?.("key")
          const keyText = String(k?.namedChildren?.find((c: any) => c.type === "string_content")?.text ?? "")
          if (keyText === "$ref") {
            const v = n.childForFieldName?.("value")
            const inner = String(v?.text ?? "").replace(/^["']|["']$/g, "")
            if (!/^https?:\/\//.test(inner) && /\.(json|jsonc|json5|ya?ml|avsc|avdl|proto)(#[^"']*)?$/.test(inner)) {
              hits.push(`${fileLabel}: ${inner.slice(0, 60)}`)
            }
          }
        }
      })
    },
    describe: "a $ref naming another FILE on disk — a file-to-file dependency",
  },
]

// Resolved to the UNION — see the note at the imports above. A registry conflict is
// always "both sides added a lane"; taking one side deletes the other's ruling table
// silently, and a deleted entry makes the arbiter exit 2 for a lane that WAS ruled,
// which reads as "unadjudicated" rather than "dropped in a merge".
// The registry. A conflict here is ALWAYS "both sides added a lane", so the resolution
// is ALWAYS the union — taking one side deletes the other lane's ruling table silently,
// and a deleted entry does not fail loudly, it just makes the arbiter exit 2 for a lane
// that WAS ruled, which reads as "unadjudicated" rather than "dropped in a merge".
const RULED_BY_LANG: Record<string, Ruled[]> = {
  bash: BASH_RULED,
  json: JSON_RULED,
  lua: LUA_RULED,
  toml: TOML_RULED,
  fsharp: FSHARP_RULED,
  nim: NIM_RULED,
  protobuf: PROTOBUF_RULED,
  zig: ZIG_RULED,
  julia: JULIA_RULED,
  css: CSS_RULED,
  xml: XML_RULED,
  php: PHP_RULED,
  sql: SQL_RULED,
  scss: SCSS_RULED,
  markdown: MARKDOWN_RULED,
clean: CLEAN_RULED,
  r: R_RULED,
  graphql: GRAPHQL_RULED,
  dart: DART_RULED,
  powershell: POWERSHELL_RULED,
}
const RULED: Ruled[] = RULED_BY_LANG[LANG] ?? []

// ---------------------------------------------------------------- corpus
//
// THE EXCLUSIONS ARE PART OF THE POPULATION CLAIM, so they are counted here and printed
// below rather than skipped silently. Two were, until this was measured:
//
//   * a path `git ls-files` lists but the working tree does not have — 2 of the 33,755
//     tracked .dart files in this corpus (`pb-reference/examples/{add,list}_people.dart`);
//   * a file over the SIZE CAP. The cap used to be 512 KB, which admitted 33,692 .dart
//     files and excluded 61 with no line in the output saying so. 46 of those 61 sit
//     between 512 KB and 1 MB, which is exactly the range the ENGINE still parses as a
//     full AST (`pool-worker.ts` FULL_AST_LIMIT = 1 MB), so those 46 were analyzable and
//     unmeasured — a coverage number that counted them out of its own denominator.
//     The cap is now the engine's own limit, and what remains excluded is stated: above
//     1 MB the engine itself degrades to structural extraction, and above 5 MB it returns
//     an empty fallback with zero symbols, so those files could not be measured as
//     analyzers whatever this gate did.
const SIZE_CAP = 1024 * 1024
const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
const excluded = { tracked: 0, absent: 0, overCap: 0, wrongLanguage: 0 }
let overCapLargest = 0
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    excluded.tracked++
    let text: string
    let size: number
    try {
      size = statSync(abs).size
      if (size > SIZE_CAP) {
        // COUNTED IN THIS LANE'S TERMS, by name: the file is never read, so a content-based
        // detection is impossible and reporting every language's bundles as this lane's
        // exclusions would be a number about the corpus wearing this lane's label.
        if (detectLanguageFromPath(abs) === LANG) { excluded.overCap++; overCapLargest = Math.max(overCapLargest, size) }
        continue
      }
      text = readFileSync(abs, "utf8")
    } catch {
      // `continue` here is a file git tracks and this process cannot read. Counted the same
      // way, and for the same reason.
      if (detectLanguageFromPath(abs) === LANG) excluded.absent++
      continue
    }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
console.log(`ontology coverage gate — ${LANG}`)
console.log(
  `corpus: ${files.length} admitted files — and this lane EXCLUDED ` +
  `${excluded.absent} tracked-but-unreadable/absent + ${excluded.overCap} over the ` +
  `${(SIZE_CAP / 1024 / 1024).toFixed(0)} MB cap (largest ${(overCapLargest / 1024 / 1024).toFixed(1)} MB). ` +
  `Above that cap the engine itself extracts structurally (FULL_AST_LIMIT), and above 5 MB it returns ` +
  `an empty fallback with zero symbols, so those files are outside any analyzer claim — stated, not silent. ` +
  `Excluded by path name, because a file over the cap is never read. ` +
  `${excluded.tracked} tracked paths were walked.`,
)
console.log()

// ---------------------------------------------------------------- what is emitted
const observed = new Map<Type, { n: number; files: Set<string> }>()

// Resumable, because `parseFile` can kill this process outright: parser.parse() is
// synchronous WASM and a grammar that loops on a pathological input cannot be
// interrupted, so ASTEngine answers a hang with process.exit(). The 120s guard's own
// comment claims "the indexer is incremental - re-running resumes", which is true of the
// indexer and false of every tool that walks a corpus in ONE process, including this
// one. Measured consequence, repeatedly: nim, scss and hcl each lost an entire corpus
// walk to a single file (a 1.6 MB generated sprite, a tree-sitter-nim fault, a terraform
// testdata file), and because the file is always in the corpus, every re-run lost it
// again.
//
// So the walk checkpoints. `--fresh` starts over; without it a second run resumes where
// the last one died, a file that kills the process is retried once in a fresh process and
// then recorded as abandoned, and every outcome is recorded in a form that distinguishes
// a real parse from a swallowed crash (see `resumable-walk.ts`).
const { resumableWalk, resetCheckpoint } = await import("./resumable-walk")
const CHECKPOINT = `validation/m14/measurements/walk-${LANG}.txt`
if (process.argv.includes("--fresh")) resetCheckpoint(CHECKPOINT)

// A file whose parse CRASHED does not reject out of `parseFile`: `pool-worker.ts` catches
// the error, writes `[BB-PARSE-ERR]`, and returns `extractFallback(...)` — a REGEX
// extraction marked `fallback: true`. Measured 2026-10-07: `ontology-coverage-gate dart`
// hit `memory access out of bounds` on `dart-sdk/tests/corelib/map_values3_test.dart`,
// and the file went into the checkpoint as WALKED. Counting those relationships as
// EMITTED evidence is how a regex edge becomes proof that an analyzer fires, so fallback
// results are collected in their OWN map and reported as their own population. Files over
// the 1 MB structural limit land there too, and that is correct — the analyzer did not
// read those either.
const observedViaFallback = new Map<Type, { n: number; files: Set<string> }>()
const walkStats = await resumableWalk(CHECKPOINT, files.length, {
  id: (i) => files[i].abs,
  concurrency: 8,
  run: async (i) => {
    const f = files[i]
    const r: any = await parseFile(f.abs, f.dir)
    // TWO distinct crash paths reach here and only ONE of them says `fallback`:
    //   - a WASM trap  -> `pool-worker`'s catch -> `extractFallback`, which sets `fallback: true`
    //   - the analyzer timing out or blowing the JS stack -> `engine.ts` returns
    //     `metadata.analysisVersion: "2.0-basic-fallback"` with 0 symbols, 0 relationships,
    //     and no top-level `fallback` field at all.
    // Measured on the dart corpus: `deep_nesting_expression_test.dart` and
    // `deep_nesting_statement_test.dart` return the SECOND shape ("Maximum call stack size
    // exceeded"). Counting them as measured is not a rounding error — it lets a type read as
    // NOT EMITTED because the one file exercising it was never analyzed, which is a false
    // RULED-SOUND. The version string is this codebase's own signature for that path;
    // `real-sql-analyzer.ts` (a 392 KB schema crossing the same 120 s timeout) and
    // `real-html-analyzer.ts` both name it, so this is the established idiom rather than a
    // new convention.
    const degraded = r?.fallback === true || r?.metadata?.analysisVersion === "2.0-basic-fallback"
    const sink = degraded ? observedViaFallback : observed
    for (const x of r.relationships ?? []) {
      const t = String(x.type ?? x.relationshipType ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      const row = sink.get(t) ?? { n: 0, files: new Set<string>() }
      row.n++
      if (row.files.size < 4) row.files.add(`${f.repo}/${f.rel}`)
      sink.set(t, row)
    }
    if (degraded) {
      return { degraded: true, reason: `fallback:true (regex extraction) for ${f.repo}/${f.rel}` }
    }
    return undefined
  },
})

// ---------------------------------------------------------------- measure with the right instrument
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const wasmPath = (LANGS as any)[LANG]?.wasm ?? "tree-sitter-bash.wasm"
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", wasmPath))))

// Instrument A: the grammar's own vocabulary, observed across the whole corpus.
const grammarNodeTypes = new Map<string, number>()
for (const f of files) {
  const t = parser.parse(f.text)
  if (!t) continue
  walkPreorder(t.rootNode, (n: any) => { grammarNodeTypes.set(n.type, (grammarNodeTypes.get(n.type) ?? 0) + 1) })
  t.delete?.()
}

// Instrument B: semantic counts on the tree, where strings and heredocs cannot lie.
const treeHits = new Map<Type, { occurrences: number; files: number; examples: string[] }>()
for (const r of RULED) {
  if (r.instrument !== "B:parse-tree-count" || !r.countOnTree) continue
  const hits: string[] = []
  const hitFiles = new Set<string>()
  for (const f of files) {
    const before = hits.length
    const t = parser.parse(f.text)
    if (t) { r.countOnTree(t.rootNode, `${f.repo}/${f.rel}`, hits); t.delete?.() }
    if (hits.length > before) hitFiles.add(f.rel)
  }
  treeHits.set(r.type, { occurrences: hits.length, files: hitFiles.size, examples: hits.slice(0, 3) })
}

// ---------------------------------------------------------------- the spec's rulings
function rulingFor(t: Type): { reason: string; src: string } | null {
  // A ruling may live in EITHER place, and both are legitimate:
  //   - `script/m14/spec/<lang>-completeness.json`, the long-standing spec whose
  //     design_decision.decisions carry a `status: RULED` row;
  //   - the lane's `RULED` entry in the table above, which is where a lane writes
  //     when its rulings are corpus probes rather than prose.
  //
  // Reading only the spec reported 8 of TOML's 9 rulings as RULED-UNJUSTIFIED —
  // the spec carries ONE decision (TOML-D1) while the other 8 were measured and
  // live in `script/m14/toml-ruled.ts`. So a lane that did the harder work looked
  // like a lane that skipped it, which is the inverse of the truth and exactly the
  // kind of verdict this gate exists to prevent.
  //
  // The table is checked FIRST: it is where a measured ruling lives, and its
  // `describe` is the probe's own statement of what it looked for.
  const tabled = RULED.find((r) => r.type === t)
  if (tabled) {
    return {
      reason: `${tabled.describe} [instrument ${tabled.instrument}${tabled.nodeTypesThatWouldMeanIt?.length ? `, probed for ${tabled.nodeTypesThatWouldMeanIt.join(" / ")}` : ""}]`,
      src: `script/m14/${LANG}-ruled.ts (RULED_BY_LANG.${LANG})`,
    }
  }

  const specPath = `script/m14/spec/${LANG}-completeness.json`
  let raw: string
  try { raw = readFileSync(specPath, "utf8") } catch { return null }
  const d = JSON.parse(raw)
  const decs = d?.design_decision?.decisions ?? []
  for (const dec of decs) {
    if (dec.status !== "RULED") continue
    const body = String(dec.resolution ?? "")
    if (new RegExp(`\`${t}\``, "i").test(body) || new RegExp(`\\b${t}\\b`, "i").test(body)) {
      // prefer a decision that is ABOUT the ontology
      if (/ontology|emits|excluded|type/i.test(body)) return { reason: body, src: `${specPath}#${dec.id}` }
    }
  }
  return null
}

// ---------------------------------------------------------------- verdict
type Row = { type: Type; status: "EMITTED" | "RULED-SOUND" | "FALSIFIED" | "RULED-UNJUSTIFIED"; detail: string }

// `--coverage` reports which lanes this gate can actually rule for, and does NOT
// parse a corpus. The gate's own header records why this matters: it exists
// because `overrides` was missing from Bash for a whole wave and the differential
// stayed green, since the analyzer omitted it and the oracle was written after
// that ruling — nothing agrees with nothing. A lane with no RULING TABLE gets no
// verdict here at all, which is the same blind spot wearing a different hat.
//
// So the size of the blind spot is reported rather than left to be discovered one
// exit-2 at a time.
if (process.argv.includes("--coverage")) {
  const LANGS_WITH_TABLES = Object.keys(RULED_BY_LANG).sort()
  console.log("ontology coverage gate — ruling-table coverage\n")
  console.log(`lanes this arbiter can rule for: ${LANGS_WITH_TABLES.length}`)
  for (const l of LANGS_WITH_TABLES) console.log(`  ${l}`)
  console.log()
  console.log("Every other lane exits 2 with no verdict, because an empty table would call every")
  console.log("un-emitted type RULED-UNJUSTIFIED, and that is a verdict about the TABLE, not the lane.")
  console.log("A ruling table encodes that lane's OWN corpus probe — its node types, its counts — so it")
  console.log("is written by the lane that measured it, not centrally. See RULED_BY_LANG above.")
  process.exit(0)
}

if (RULED_BY_LANG[LANG] === undefined) {
  // The guard's original reasoning was right — a lane with no ruling source at all
  // would get every un-emitted type called RULED-UNJUSTIFIED, which is a verdict about
  // the TABLE rather than about the lane. But it fired on the ABSENCE OF A TABLE alone,
  // and `rulingFor` legitimately reads TWO places: the table, then
  // `script/m14/spec/<lang>-completeness.json`.
  //
  // So it refused lanes whose spec DOES carry rulings — HCL-D1..D6, MAKE-D1..D5 among
  // them — discarding real evidence and reporting those lanes as unadjudicated when
  // they had been adjudicated all along. Measured: 13 of 26 lanes were blocked, and 12
  // of the 13 have spec rulings that were never consulted.
  //
  // The precise guard is this one: refuse only when rulingFor() finds NOTHING for any
  // un-emitted type, i.e. when neither source can supply a verdict. The original failure
  // mode is still fully prevented — a lane with neither a table nor spec decisions
  // still refuses — and the lanes it now lets through are reported with a note saying
  // their rulings came from the spec, so a spec-only lane is never mistaken for a
  // corpus-measured one.
  const unEmittedForGuard = ALL_TYPES.filter((t) => (observed.get(t)?.n ?? 0) === 0)
  const ruledFromSpec = unEmittedForGuard.filter((t) => rulingFor(t) !== null)
  if (ruledFromSpec.length === 0) {
    console.log(`\nontology coverage gate — no RULING SOURCE for ${LANG}.`)
    console.log(`Refusing to report: with no ruling anywhere, every un-emitted type would be called`)
    console.log(`RULED-UNJUSTIFIED, and that is a verdict about the absence of evidence, not about the lane.`)
    console.log(`Neither RULED_BY_LANG.${LANG} nor script/m14/spec/${LANG}-completeness.json supplies one.`)
    process.exit(2)
  }
  console.log(`note: ${LANG} has no ruling TABLE; ${ruledFromSpec.length}/${unEmittedForGuard.length} un-emitted types are ruled from its SPEC.`)
  console.log(`      a spec ruling is prose; a table ruling is a corpus probe. They are not equally strong.`)
}

// The population this verdict is actually about. A resumed or partial walk produces the
// SAME edge counts as a complete one over the files it did see — the counts do not know
// they are smaller — so without this line a 99% walk reports identically to a 100% one and
// the reader cannot tell. Stated before the table, not in a footnote.
// TWO different coverage numbers, and conflating them is the defect this line used to have.
//
// The edge counts below come from exactly ONE source: the `run` callback above, which is
// called only for files THIS run walked. A file settled by an earlier run is SKIPPED by the
// walk and therefore contributes NO edges — so `alreadyDone` is coverage of the CHECKPOINT,
// not coverage of the TABLE. The first version of this line added the two together and
// printed "every edge count below is over 100.0% of the corpus" for a run whose table had
// seen 10 files: a correct-looking number about the wrong population, which is the one
// defect this programme keeps paying for.
//   table coverage = walked                     (files whose edges fed `observed`)
//   walk coverage  = walked + alreadyDone        (files that need no further walking)
const tablePct = walkStats.total === 0 ? 0 : (walkStats.walked / walkStats.total) * 100
const walkPct = walkStats.total === 0 ? 0 : ((walkStats.walked + walkStats.alreadyDone) / walkStats.total) * 100
console.log(
  `walk: ${walkStats.walked}/${walkStats.total} files measured in THIS run ` +
    `(${tablePct.toFixed(1)}% — the files every edge count in the table below is computed from)`,
)
console.log(
  `walk: ${walkStats.walked + walkStats.alreadyDone}/${walkStats.total} files settled in TOTAL ` +
    `(${walkPct.toFixed(1)}%)  newly walked ${walkStats.walked}, resumed ${walkStats.alreadyDone}` +
    (walkStats.skippedBad > 0 ? `  SKIPPED-BAD ${walkStats.skippedBad}` : ``) +
    (walkStats.partial ? `  PARTIAL` : ``),
)
if (walkStats.walked < walkStats.total) {
  console.log(
    `      >>> THE TABLE BELOW IS ABOUT ${walkStats.walked} OF ${walkStats.total} FILES. ` +
      `${walkStats.alreadyDone} file(s) were settled by an earlier run and contribute NO edges this run, ` +
      `so a type they would have shown cannot be seen to fire. Run with --fresh for a whole-corpus table.`,
  )
}
if (walkStats.partial) {
  console.log(
    `      DEGRADED ${walkStats.degraded + walkStats.alreadyDegraded} file(s) were measured by the regex ` +
      `fallback rather than the analyzer and are excluded from EMITTED; ${walkStats.skippedBad} abandoned. ` +
      `Checkpoint: ${walkStats.checkpoint}`,
  )
}
console.log()

const rows: Row[] = []
for (const t of ALL_TYPES) {
  const obs = observed.get(t)
  if (obs && obs.n > 0) {
    rows.push({ type: t, status: "EMITTED", detail: `${obs.n.toLocaleString()} edges in ${obs.files.size}+ files, e.g. ${[...obs.files].slice(0, 2).join(", ")}` })
    continue
  }
  const ruled = RULED.find((r) => r.type === t)
  const hit = treeHits.get(t)
  if (hit && hit.occurrences > 0) {
    rows.push({
      type: t,
      status: "FALSIFIED",
      detail: `NOT EMITTED, but the construct occurs ${hit.occurrences}x across ${hit.files} file(s) on the PARSE TREE — it is derivable, so the ruling is wrong. e.g. ${hit.examples[0] ?? ""}`,
    })
    continue
  }
  if (ruled?.instrument === "A:grammar-inventory") {
    const present = (ruled.nodeTypesThatWouldMeanIt ?? []).filter((n) => grammarNodeTypes.has(n))
    if (present.length > 0) {
      rows.push({ type: t, status: "FALSIFIED", detail: `NOT EMITTED, but the grammar DOES produce ${present.join(", ")} — the construct exists. Instrument A.` })
      continue
    }
  }
  const ruling = rulingFor(t)
  if (!ruling) {
    rows.push({ type: t, status: "RULED-UNJUSTIFIED", detail: `NOT EMITTED and its construct is absent, but NO written ruling was found in the spec` })
    continue
  }
  const basis = ruled?.instrument === "A:grammar-inventory"
    ? `the grammar produced ${grammarNodeTypes.size} distinct node types across the corpus and NONE expresses it`
    : `the construct occurs 0x on the parse tree`
  rows.push({ type: t, status: "RULED-SOUND", detail: `NOT EMITTED; ${basis}. Written ruling: ${ruling.src}` })
}

// ---------------------------------------------------------------- the population that was ACTUALLY measured
// Printed BEFORE the table, because a table of ten relationship types is a statement
// about a population, and this programme's recurring defect is a correct number about the
// wrong population. `partial` is true if any file was degraded, any file was abandoned, or
// the run did not reach every file it was offered.
{
  // The buckets PARTITION the offered population, so they can be added up and checked:
  // walked + degraded + alreadyDone + alreadyDegraded + skippedBad === total.
  const accounted = walkStats.walked + walkStats.degraded + walkStats.alreadyDone + walkStats.alreadyDegraded + walkStats.skippedBad
  console.log(`walk: ${walkStats.total} offered = ${walkStats.walked} measured by the analyzer (this run) + ${walkStats.alreadyDone} measured by an earlier run + ${walkStats.degraded} DEGRADED (regex fallback, not the analyzer) + ${walkStats.alreadyDegraded} degraded earlier + ${walkStats.skippedBad} abandoned`)
  console.log(`walk: partial=${walkStats.partial}  retried=${walkStats.retried}  unfinished-from-previous-run=${walkStats.unfinishedFromPreviousRun}  fresh=${walkStats.fresh}  history ${walkStats.untrustedHistory ? "UNTRUSTED (no format header — cannot tell a parse from a swallowed crash)" : "trusted"}`)
  console.log(`walk: rss ${walkStats.rssMbStart}MB -> ${walkStats.rssMbEnd}MB (${walkStats.rssMbPerKFile >= 0 ? "+" : ""}${walkStats.rssMbPerKFile}MB per 1k files)  checkpoint ${walkStats.checkpoint}`)
  if (accounted !== walkStats.total) {
    console.log(`walk: >>> ${walkStats.total - accounted} file(s) were neither measured nor settled — this table is about ${accounted}/${walkStats.total} files.`)
  }
  if (observedViaFallback.size > 0) {
    const rows = [...observedViaFallback.entries()].map(([t, r]) => `${t}=${r.n}`).join(" ")
    console.log(`walk: >>> excluded from EMITTED — relationship rows produced by the regex fallback, not the analyzer: ${rows}`)
  }
  if (walkStats.partial) {
    console.log(`walk: >>> THIS TABLE IS PARTIAL. Its EMITTED column is evidence about ${walkStats.walked + walkStats.alreadyDone} of ${walkStats.total} files.`)
  }
  console.log("")
}

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`${w("type", 14)}${w("status", 18)}detail`)
console.log("-".repeat(120))
for (const r of rows) console.log(`${w(r.type, 14)}${w(r.status, 18)}${r.detail}`)

const falsified = rows.filter((r) => r.status === "FALSIFIED")
const unjustified = rows.filter((r) => r.status === "RULED-UNJUSTIFIED")
const emitted = rows.filter((r) => r.status === "EMITTED")
console.log("-".repeat(120))
console.log(`emitted ${emitted.length}/10   ruled-sound ${rows.filter((r) => r.status === "RULED-SOUND").length}   FALSIFIED ${falsified.length}   ruled-without-justification ${unjustified.length}`)
if (falsified.length) {
  console.log(`\n>>> THIS GATE FAILS. ${falsified.map((r) => r.type).join(", ")} ${falsified.length === 1 ? "is" : "are"} claimed inapplicable but ${falsified.length === 1 ? "is" : "are"} demonstrably derivable from real code.`)
  console.log(`>>> A differential cannot find this class of defect, because the oracle omits the same type.`)
}
process.exitCode = falsified.length + unjustified.length === 0 ? 0 : 1
