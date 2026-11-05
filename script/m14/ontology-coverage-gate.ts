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
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
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
import { HTML_RULED } from "./html-ruled"
import { JAVASCRIPT_RULED } from "./javascript-ruled"
import { SVELTE_RULED } from "./svelte-ruled"
import { PHP_RULED } from "./php-ruled"
import { SQL_RULED } from "./sql-ruled"
import { CLEAN_RULED } from "./clean-ruled"
import { R_RULED } from "./r-ruled"
import { GRAPHQL_RULED } from "./graphql-ruled"
import { DART_RULED } from "./dart-ruled"
import { POWERSHELL_RULED } from "./powershell-ruled"
// M60 json lane: the lane's MEASURED table, imported like the 18 above. `json-ruled.ts` says it
// restates the `Ruled` shape "once the supervisor adds the wiring" — this is that wiring, and
// until it landed the gate read an inline copy instead (see the deleted block below).
import { JSON_RULED } from "./json-ruled"
// python (2026-10-10): the lane's ruling table, imported like the nineteen above. Until this
// line and the `python:` entry below it landed, the gate printed `no RULING SOURCE for python`
// and exited 2 for the whole lane — which is what `script/m14/python-ruled.ts` recorded as the
// one supervisor-owned import + one line it needed. See that file's header for the implements
// reversal the table now carries.
import { PYTHON_RULED } from "./python-ruled"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
/** The lane is the first NON-FLAG argument: `--self-test` / `--coverage` must not be read as a lane
 *  name, or `gate --self-test` would look for a language called `--self-test` and exit 2. */
const LANG = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "bash"
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
   * WHICH SPACES this probe enumerated, when the lane can state it. Optional only so the twelve
   * tables written before the spaces check existed keep compiling; a MISSING declaration in a
   * language whose corpus writes key/value bindings is now RULED-UNJUSTIFIED, not RULED-SOUND
   * (see the space-attestation block below — measured on HCL, where a node-type inventory
   * certified `extends` while 44 `inherits` attribute-key sites sat in the same corpus).
   */
  spacesProbed?: ProbeSpace[]
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

// ---------------------------------------------------------------- the SPACE attestation
/**
 * A ruling that certifies ABSENCE is only as strong as the SPACES its probe enumerated, and until
 * 2026-10-09 this gate accepted `instrument: "A:grammar-inventory"` as covering the whole question.
 * It does not, and the failure was measured rather than imagined:
 *
 *   `ontology-coverage-gate.ts hcl` printed `extends RULED-SOUND; the construct occurs 0x on the
 *   parse tree` for a lane whose own whole-corpus census had just measured **44 `inherits` sites in
 *   8 files, 53 named parents, 53/53 resolving to a `target` declared in the same file**. Docker-bake
 *   spells inheritance as an ATTRIBUTE KEY (`inherits = ["_common"]`), and no node-type inventory
 *   can see a construct spelled that way. The false RULED-SOUND is the flattering direction: it
 *   certifies a ruling that shrinks a denominator.
 *
 * So a ruling now declares WHICH SPACES it probed, and the gate cross-checks that declaration
 * against the corpus it walks:
 *
 *   * the walk counts key/value BINDINGS structurally — a node with `=` or `:` between two named
 *     children, which is HCL's `attribute`, TOML's and JSON's `pair`, YAML's block_mapping_pair,
 *     CSS's `declaration` — so "this language has attribute syntax" is an OBSERVATION, not an
 *     assumption about a grammar's name;
 *   * a vocabulary-based ruling (instrument A, or a spec-text ruling with no table entry) in such a
 *     language is RULED-UNJUSTIFIED unless its spaces include `attribute-keys`. An instrument-B
 *     ruling is exempt: it counts a shape on the TREE, which is not a vocabulary blind spot;
 *   * spaces may be declared per entry (`Ruled.spacesProbed`) or in
 *     `validation/m14/fixtures/<lang>/ruling-attestation.json`, and an attestation must cite an
 *     artefact that EXISTS whose pointers actually hold the declared counts.
 *
 * The control runs on every invocation (see SPACE_CHECK_SELF_TEST below): it FIRES the check on a
 * node-type-only ruling, PASSES a ruling that declares both spaces, and FAILS the run (exit 3) if
 * either arm stops behaving. A guard that cannot fail is not a guard.
 */
export type ProbeSpace = "node-types" | "block-types" | "attribute-keys" | "corpus-count"
type RulingStatus = "EMITTED" | "RULED-SOUND" | "FALSIFIED" | "RULED-UNJUSTIFIED" | "RULED-UNKNOWN"
/** What the EMITTED column is actually a claim about. `complete` is true only when EVERY offered file
 *  was parsed by the analyzer in THIS run: a file the checkpoint settled from an earlier walk
 *  contributes no edges (the checkpoint stores per-file OUTCOMES, not per-file relationship types),
 *  and a degraded or abandoned file was never analyzed at all. */
type EmittedPopulation = { measured: number; settled: number; degraded: number; abandoned: number; total: number; complete: boolean }
type SpaceAttestation = {
  lane?: string
  instrument?: string
  artefact?: string
  spacesProbed?: ProbeSpace[]
  spaceEvidence?: Record<string, { pointer?: string[]; observed?: number }>
  rulings?: Record<string, { spaces?: ProbeSpace[]; constructSites?: number; pointer?: string[]; note?: string }>
}
type KeyEvidence = { nodes: number; topTypes: string[]; sample: string }

function pointerGet(doc: any, ptr: string[]): unknown {
  let cur: any = doc
  for (const k of ptr) {
    if (cur === null || typeof cur !== "object") return undefined
    cur = Array.isArray(cur) ? cur[Number(k)] : cur[k]
  }
  return cur
}

/** The half of an attestation that can be checked without trusting its author: does the artefact it
 *  names exist, and does each declared pointer hold the number the attestation declares? */
function verifyAttestation(att: SpaceAttestation): { problems: string[]; verified: string[] } {
  const problems: string[] = [], verified: string[] = []
  let artefact: any = null
  if (typeof att.artefact === "string" && att.artefact !== "") {
    const ap = path.resolve(process.cwd(), att.artefact)
    if (!existsSync(ap)) problems.push(`names artefact ${att.artefact}, which does not exist`)
    else { try { artefact = JSON.parse(readFileSync(ap, "utf8")) } catch { problems.push(`artefact ${att.artefact} is not parseable JSON`) } }
  } else if ((att.spacesProbed ?? []).includes("attribute-keys")) {
    problems.push("declares the attribute-keys space but cites no artefact")
  }
  if (artefact !== null) {
    for (const [space, ev] of Object.entries(att.spaceEvidence ?? {})) {
      if (!Array.isArray(ev?.pointer)) continue
      const got = pointerGet(artefact, ev.pointer)
      if (got === undefined) problems.push(`spaceEvidence.${space}: pointer ${ev.pointer.join(".")} is not in ${att.artefact}`)
      else if (ev.observed !== undefined && got !== ev.observed) problems.push(`spaceEvidence.${space}: declares ${ev.observed}, ${att.artefact} holds ${String(got)} at ${ev.pointer.join(".")}`)
      else verified.push(`${space}=${String(got)}`)
    }
    for (const [t, r] of Object.entries(att.rulings ?? {})) {
      if (!Array.isArray(r?.pointer)) continue
      const got = pointerGet(artefact, r.pointer)
      if (got === undefined) problems.push(`rulings.${t}: pointer ${r.pointer.join(".")} is not in ${att.artefact}`)
      else if (r.constructSites !== undefined && got !== r.constructSites) problems.push(`rulings.${t}: declares ${r.constructSites} construct site(s), ${att.artefact} holds ${String(got)} at ${r.pointer.join(".")}`)
      else verified.push(`${t}.constructSites=${String(got)}`)
    }
  }
  return { problems, verified }
}

function readAttestation(lang: string): { att: SpaceAttestation | null; rel: string; problems: string[]; verified: string[] } {
  const rel = `validation/m14/fixtures/${lang}/ruling-attestation.json`
  const abs = path.resolve(process.cwd(), rel)
  if (!existsSync(abs)) return { att: null, rel, problems: [], verified: [] }
  let att: SpaceAttestation
  try { att = JSON.parse(readFileSync(abs, "utf8")) } catch (e) { return { att: null, rel, problems: [`${rel} is not parseable JSON: ${String(e).slice(0, 60)}`], verified: [] } }
  return { att, rel, ...verifyAttestation(att) }
}

/** The verdict for ONE un-emitted type. Pure except for the filesystem reads inside
 *  `verifyAttestation`, which happen before this is called, so the self-test can drive it. */
function verdictInner(args: {
  type: Type
  ruled: Ruled | undefined
  ruling: { reason: string; src: string } | null
  keyEvidence: KeyEvidence
  nodeTypeCount: number
  population: EmittedPopulation
  att: SpaceAttestation | null
  attRel: string
  attProblems: string[]
  attVerified: string[]
}): { status: RulingStatus; detail: string } {
  const { type, ruled, ruling, keyEvidence, nodeTypeCount, att, attRel, attProblems, attVerified } = args
  if (!ruling) {
    return { status: "RULED-UNJUSTIFIED", detail: `NOT EMITTED and its construct is absent, but NO written ruling was found in the spec` }
  }
  const entry = att?.rulings?.[type]
  const spaces: ProbeSpace[] = entry?.spaces ?? ruled?.spacesProbed ?? (entry ? att?.spacesProbed ?? [] : [])
  const vocabularyBased = ruled === undefined || ruled.instrument === "A:grammar-inventory"
  // THE KEY-SPACE CHECK — the defect this block exists for. A vocabulary-based ruling cannot see a
  // construct spelled as an attribute key, and this corpus writes them, so the space must be
  // declared AND, where an attestation exists, verified.
  if (vocabularyBased && keyEvidence.nodes > 0 && !spaces.includes("attribute-keys")) {
    return {
      status: "RULED-UNJUSTIFIED",
      detail: `NOT EMITTED, and the probe does not cover the space this language USES: the corpus writes ` +
        `${keyEvidence.nodes.toLocaleString()} key/value bindings (top node types ${keyEvidence.topTypes.join(", ") || "?"}, e.g. \`${keyEvidence.sample}\`), ` +
        `so a construct spelled as an attribute key cannot appear in a node-type inventory — that is exactly how HCL's ` +
        `\`inherits\` hid 44 sites. Declare the probed spaces (\`spacesProbed\` in the lane's Ruled table, or ${attRel} with an ` +
        `artefact that EXISTS and verifies). Written ruling: ${ruling.src}`,
    }
  }
  if (entry) {
    if (attProblems.length > 0) {
      return {
        status: "RULED-UNJUSTIFIED",
        detail: `NOT EMITTED; ${attRel} attests the attribute-keys space but does not verify (${attProblems.join("; ")}). ` +
          `A declaration that cannot be checked is prose, and prose does not shrink a denominator. Written ruling: ${ruling.src}`,
      }
    }
    const sites = entry.constructSites
    if (sites === undefined) {
      return {
        status: "RULED-UNJUSTIFIED",
        detail: `NOT EMITTED; ${attRel} attests the spaces but states no construct count for \`${type}\` — rule-book §6: a ruling without a count is prose. Written ruling: ${ruling.src}`,
      }
    }
    const note = entry.note ? ` ${entry.note}` : ""
    if (sites > 0) {
      return {
        status: "FALSIFIED",
        detail: `NOT EMITTED, but the attested probe found ${sites.toLocaleString()} site(s) of the construct in the space that was ` +
          `missing from the inventory — the type is DERIVABLE, so no ruling can certify it absent: it must be emitted, or measured into a ` +
          `class that stays in the denominator.${note} Artefact: ${att?.artefact ?? "?"}`,
      }
    }
    return {
      status: "RULED-SOUND",
      detail: `NOT EMITTED; attested over ${spaces.join(", ")} — ${att?.artefact ?? "no artefact"} verifies ` +
        `${attVerified.join(", ") || "the declared spaces"}, and \`${type}\` has 0 construct sites there.${note} Written ruling: ${ruling.src}`,
    }
  }
  const basis = ruled?.instrument === "A:grammar-inventory"
    ? `the grammar produced ${nodeTypeCount} distinct node types across the corpus and none of the ${(ruled.nodeTypesThatWouldMeanIt ?? []).length} probed names is among them`
    : ruled?.instrument === "B:parse-tree-count"
      ? `the tree probe counted 0 occurrences on the tree (instrument B)`
      : `no Instrument-A/B entry exists for this lane, so the written ruling is certified on its text alone; this corpus writes 0 key/value bindings, so the attribute-key blind spot is not available here`
  return { status: "RULED-SOUND", detail: `NOT EMITTED; ${basis}. Written ruling: ${ruling.src}` }
}

/**
 * THE POPULATION GATE — a PARTIAL walk can no longer produce RULED-SOUND.
 *
 * Measured 2026-10-09 on hcl, on the same walk that had just been fixed for the key-space blind
 * spot: with a history-trusted checkpoint the gate re-measured 5 of 4,047 files and settled the
 * other 4,042 from an earlier run, which contributes NO edges — the checkpoint records per-file
 * OUTCOMES, not per-file relationship types. `calls` and `overrides` therefore printed
 * `RULED-SOUND; the construct occurs 0x on the parse tree` while a fresh walk of the same corpus
 * carried 4 and 68 edges. A false RULED-SOUND is the flattering direction, and this one arrives
 * through the DEFAULT invocation, so a reader who does not pass `--fresh` gets a wrong verdict with
 * no signal in the row.
 *
 * The fix is a REFUSAL, not a guess: when any offered file was settled by an earlier walk, degraded
 * (regex fallback, not the analyzer) or abandoned, absence is not established and the row reads
 * RULED-UNKNOWN. It is not a failure — it is a row that has not been measured yet — but it can never
 * be read as a certification. FALSIFIED and RULED-UNJUSTIFIED pass through untouched: both are
 * findings about the ruling itself and neither depends on the EMITTED column.
 */
function verdictFor(args: Parameters<typeof verdictInner>[0]): { status: RulingStatus; detail: string } {
  const v = verdictInner(args)
  if (v.status !== "RULED-SOUND" || args.population.complete) return v
  const p = args.population
  return {
    status: "RULED-UNKNOWN",
    detail: `NOT CERTIFIED: no edge of this type was observed, but the EMITTED column covers only ${p.measured.toLocaleString()} of ` +
      `${p.total.toLocaleString()} offered files (${p.settled.toLocaleString()} settled by an earlier walk contribute NO edges, ` +
      `${p.degraded} degraded by the regex fallback, ${p.abandoned} abandoned), so absence is NOT established. The written ruling is ` +
      `unchanged (${args.ruling?.src ?? "none"}); re-run with --fresh to certify it.`,
  }
}

// ---------------------------------------------------------------- the space check's own control
/**
 * Rule-book §7: a guard with no live hits must be shown firing on a planted case. This control runs
 * on EVERY invocation (cheap: in-memory arms plus one real file read) and the process exits 3 if any
 * arm stops behaving. The artefact it verifies against is
 * `validation/m14/fixtures/hcl/ruling-space-control.json`, a committed fixture, so the control does
 * not depend on any lane's census being present.
 */
const SPACE_CONTROL_ARTEFACT = "validation/m14/fixtures/hcl/ruling-space-control.json"
const KEYED: KeyEvidence = { nodes: 118304, topTypes: ["attribute=118000", "object_elem=304"], sample: `attribute inherits = ["_common"]` }
const UNKEYED: KeyEvidence = { nodes: 0, topTypes: [], sample: "" }
function spaceCheckSelfTest(verbose: boolean): { passed: number; failures: string[] } {
  const ruledA: Ruled = { type: "extends", instrument: "A:grammar-inventory", nodeTypesThatWouldMeanIt: ["class_declaration"], describe: "a type declaration another type could extend" }
  const ruledB: Ruled = { type: "extends", instrument: "B:parse-tree-count", describe: "a second declaration of the same name" }
  const ruling = { reason: "self-test", src: "self-test" }
  const goodAtt: SpaceAttestation = {
    artefact: SPACE_CONTROL_ARTEFACT,
    spacesProbed: ["node-types", "block-types", "attribute-keys"],
    spaceEvidence: { nodeTypes: { pointer: ["nodeTypes"], observed: 64 }, attributeKeys: { pointer: ["attributeKeys"], observed: 5311 } },
    rulings: { extends: { spaces: ["node-types", "block-types", "attribute-keys"], constructSites: 0, pointer: ["sites", "extends"] } },
  }
  const presentAtt: SpaceAttestation = { ...goodAtt, rulings: { extends: { spaces: ["node-types", "block-types", "attribute-keys"], constructSites: 44, pointer: ["sites", "extendsPresent"] } } }
  const missingArtefactAtt: SpaceAttestation = { artefact: "validation/m14/fixtures/hcl/this-file-does-not-exist.json", spacesProbed: ["attribute-keys"], rulings: { extends: { spaces: ["attribute-keys"], constructSites: 0 } } }
  const contradictedAtt: SpaceAttestation = { ...goodAtt, rulings: { extends: { spaces: ["node-types", "attribute-keys"], constructSites: 99, pointer: ["sites", "extends"] } } }
  const countlessAtt: SpaceAttestation = { artefact: SPACE_CONTROL_ARTEFACT, spacesProbed: ["attribute-keys"], rulings: { extends: { spaces: ["attribute-keys"] } } }
  const arm = (name: string, want: RulingStatus, ruled: Ruled | undefined, keyEvidence: KeyEvidence, att: SpaceAttestation | null, population?: EmittedPopulation) => {
    const pop = population ?? { measured: 4047, settled: 0, degraded: 0, abandoned: 0, total: 4047, complete: true }
    const v = verdictFor({ type: "extends", ruled, ruling, keyEvidence, nodeTypeCount: 64, population: pop, att, attRel: "self-test", attProblems: att ? verifyAttestation(att).problems : [], attVerified: att ? verifyAttestation(att).verified : [] })
    return { name, want, got: v.status, detail: v.detail }
  }
  const partial: EmittedPopulation = { measured: 5, settled: 4042, degraded: 0, abandoned: 0, total: 4047, complete: false }
  const arms = [
    arm("A node-type-only ruling in a key-bearing language", "RULED-UNJUSTIFIED", ruledA, KEYED, null),
    arm("B the same ruling, spaces attested and verified, 0 sites", "RULED-SOUND", ruledA, KEYED, goodAtt),
    arm("C the same ruling where the attested probe found 44 sites", "FALSIFIED", ruledA, KEYED, presentAtt),
    arm("D a node-type-only ruling where the corpus writes NO key bindings", "RULED-SOUND", ruledA, UNKEYED, null),
    arm("E an attestation naming an artefact that does not exist", "RULED-UNJUSTIFIED", ruledA, KEYED, missingArtefactAtt),
    arm("F an attestation whose declared count contradicts its artefact", "RULED-UNJUSTIFIED", ruledA, KEYED, contradictedAtt),
    arm("G an attestation that states no construct count", "RULED-UNJUSTIFIED", ruledA, KEYED, countlessAtt),
    arm("H an instrument-B tree count is not a vocabulary probe", "RULED-SOUND", ruledB, KEYED, null),
    arm("I an attested ruling on a PARTIAL walk (5 of 4,047 files) refuses to certify", "RULED-UNKNOWN", ruledA, KEYED, goodAtt, partial),
    arm("J the same ruling on a COMPLETE walk still certifies", "RULED-SOUND", ruledA, KEYED, goodAtt),
    arm("K a partial walk does not soften a key-space UNJUSTIFIED", "RULED-UNJUSTIFIED", ruledA, KEYED, null, partial),
  ]
  const failures: string[] = []
  for (const a of arms) {
    const ok = a.got === a.want
    if (!ok) failures.push(`${a.name}: expected ${a.want}, got ${a.got}`)
    if (verbose || !ok) console.log(`  ${ok ? "PASS" : "FAIL"} ${a.name} -> ${a.got}`)
  }
  return { passed: arms.length - failures.length, failures }
}

const SELF_TEST_VERBOSE = process.argv.includes("--self-test")
{
  const control = spaceCheckSelfTest(SELF_TEST_VERBOSE)
  const ok = control.failures.length === 0
  console.log(`ruling space+population self-test: ${ok ? "PASS" : "FAIL"} — ${control.passed}/${control.passed + control.failures.length} arms ` +
    `(fires on a node-type-only ruling in a key-bearing language; passes an attested one; a ruling contradicted by its own artefact fails; a PARTIAL walk refuses to certify)`)
  if (!ok) {
    console.error("SPACE CONTROL FAILED — this gate refuses to print a RULED-SOUND its space check cannot certify.")
    for (const f of control.failures) console.error(`  - ${f}`)
    process.exit(3)
  }
  if (SELF_TEST_VERBOSE) process.exit(0)
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
 * WHERE A LANE'S RULINGS COME FROM, and why json is not inline here.
 *
 * Every other lane's table is imported from its own `<lang>-ruled.ts` — the lane that MEASURED it
 * writes it, because a ruling table encodes that lane's corpus probe and its counts, and a central
 * copy goes stale the moment the lane learns something. json was the exception: the gate carried
 * an inline five-entry table (ruling `calls`, `implements`, `instantiates`, `overrides`, `imports`
 * on grammar inventories) while `script/m14/json-ruled.ts` carried the lane's real one, which rules
 * `instantiates` and nothing else. Two consequences, both measured:
 *
 *  1. **The citation was false.** `rulingFor()` labels every ruling `script/m14/<lang>-ruled.ts
 *     (RULED_BY_LANG.<lang>)`, so the table above printed a verdict citing a file the gate had
 *     never read. `json-ruled.ts` anticipated exactly this — it restates the `Ruled` shape
 *     "once the supervisor adds the wiring".
 *  2. **The stale entries were armed against a regression.** For a type that stops being
 *     emitted, the gate falsifies a grammar-inventory ruling only if the grammar actually produces
 *     one of that ruling's declared node types. json's grammar has no `implements_clause`, so had
 *     `implements` regressed the gate would have printed RULED-SOUND and exited 0 — while the
 *     corpus carried 113 `implements` edges, all in
 *     `dart-sdk/third_party/pkg/language_server_protocol/lsp_meta_model.json`. That is the exact
 *     failure `json-ruled.ts` records having already happened once ("the gate reported RULED-SOUND
 *     on this type against a grammar that had never heard of a keyword, and the corpus carried 113
 *     edges' worth of the construct the whole time"). The lane fixed the emission and left the trap
 *     armed. With the lane's own table the same regression reads RULED-UNJUSTIFIED and turns the
 *     gate red, which is the correct outcome.
 *
 * The deleted table's fifth entry, `imports`, was NOT one of the four unsound ones and is recorded
 * separately because the distinction matters. It was instrument B with a live `countOnTree` probe
 * and a real corpus measurement — sound, falsifiable evidence, ruling that a file-to-file `$ref`
 * occurred 0 times over a 3,334-file corpus. It is gone because its PREMISE was overtaken, not
 * because its reasoning was bad: the analyzer now implements manifest dependencies as `imports`
 * (82 edges, measured below, in `package.json` files), which is the same turn the inline comment
 * beside `exports` already recorded — "a grammar cannot see a CONVENTION, and a Node manifest's
 * `exports`/`main`/`bin` are conventions written as ordinary object keys". Re-admitting it would
 * re-arm a ruling whose subject the analyzer now emits.
 *
 * Whole-corpus measurement on the wired gate, 14,012 of 14,016 admitted files (4 degraded by the
 * regex fallback and excluded from EMITTED, named by the gate):
 *
 *   emitted 9/10   ruled-sound 1   FALSIFIED 0   ruled-without-justification 0
 */


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
  // clean-ruled declares a WIDER `Type` union (it also rules the four extended
  // relationship types); CLEAN_RULED's entries use only the ontology's base
  // values, and the pair is validated by clean's own gate. The cast keeps one
  // documented shape (this gate's Ruled) as the contract instead of forking it.
  clean: CLEAN_RULED as unknown as Ruled[],
  r: R_RULED,
  graphql: GRAPHQL_RULED,
  dart: DART_RULED,
  powershell: POWERSHELL_RULED,
  python: PYTHON_RULED,
  // THE THREE TABLES THE REGISTRATION GATE FOUND MISSING (2026-11-04): these lanes had
  // committed `script/m14/{html,javascript,svelte}-ruled.ts` but no line here, so the
  // arbiter could not see them and each lane read as unadjudicated — a ruling table that
  // is committed but invisible is a decision nobody applies. Registered as found; their
  // verdicts are measured by the arbiter's own run, not asserted here.
  html: HTML_RULED,
  javascript: JAVASCRIPT_RULED,
  svelte: SVELTE_RULED,
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
//
// AND, in the same pass, the KEY SPACE — the space a node-type inventory cannot enumerate. A node
// with `=` or `:` between two named children is a key/value BINDING whatever its grammar calls it:
// HCL's `attribute`, TOML's and JSON's `pair`, YAML's block_mapping_pair, CSS's `declaration`. This
// is observed structurally rather than assumed from a language's name, which is what lets the space
// check fire on a real corpus instead of on a list somebody maintains.
const grammarNodeTypes = new Map<string, number>()
const keySpaces = { bindings: 0, byType: new Map<string, number>(), samples: [] as string[] }
for (const f of files) {
  const t = parser.parse(f.text)
  if (!t) continue
  walkPreorder(t.rootNode, (n: any) => {
    grammarNodeTypes.set(n.type, (grammarNodeTypes.get(n.type) ?? 0) + 1)
    if (n.childCount >= 3) {
      const sep = n.child(1)?.type
      if (sep === "=" || sep === ":") {
        keySpaces.bindings++
        keySpaces.byType.set(n.type, (keySpaces.byType.get(n.type) ?? 0) + 1)
        if (keySpaces.samples.length < 6) keySpaces.samples.push(`${n.type} \`${String(n.text).slice(0, 48).split("\n").join(" ")}\``)
      }
    }
  })
  t.delete?.()
}
const keyEvidence: KeyEvidence = {
  nodes: keySpaces.bindings,
  topTypes: [...keySpaces.byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, n]) => `${t}=${n.toLocaleString()}`),
  sample: keySpaces.samples[0] ?? "",
}
const attestation = readAttestation(LANG)

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
type Row = { type: Type; status: RulingStatus; detail: string }

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
/** What the EMITTED column below is a claim about — computed once, printed, and attached to every
 *  row that depends on it. `walked === total` is the only state in which ABSENCE is certifiable. */
const emittedPopulation: EmittedPopulation = {
  measured: walkStats.walked,
  settled: walkStats.alreadyDone + walkStats.alreadyDegraded,
  degraded: walkStats.degraded,
  abandoned: walkStats.skippedBad,
  total: walkStats.total,
  complete: walkStats.walked === walkStats.total,
}
const populationTag = emittedPopulation.complete ? ""
  : ` [edges over ${emittedPopulation.measured.toLocaleString()}/${emittedPopulation.total.toLocaleString()} files — a LOWER BOUND, ${emittedPopulation.settled.toLocaleString()} settled without contributing edges]`
for (const t of ALL_TYPES) {
  const obs = observed.get(t)
  if (obs && obs.n > 0) {
    rows.push({ type: t, status: "EMITTED", detail: `${obs.n.toLocaleString()} edges in ${obs.files.size}+ files, e.g. ${[...obs.files].slice(0, 2).join(", ")}${populationTag}` })
    continue
  }
  const ruled = RULED.find((r) => r.type === t)
  const hit = treeHits.get(t)
  if (hit && hit.occurrences > 0) {
    // ── A FALSIFICATION IS TWO CLAIMS, AND ONLY ONE OF THEM IS CERTIFIABLE ON A PARTIAL WALK.
    //
    // "the construct occurs Nx on the PARSE TREE"      <- the walker READ THE TREE. Real, always.
    // "NOT EMITTED"                                    <- the EMITTED column. NOT certifiable when
    //                                                     files were settled by an EARLIER walk,
    //                                                     because the checkpoint stores per-file
    //                                                     OUTCOMES and not per-file relationship
    //                                                     types, so a settled file contributes no
    //                                                     edges to this run's count.
    //
    // This branch used to emit FALSIFIED on BOTH, with no `complete` check and no `populationTag` —
    // while the EMITTED branch four lines above DOES carry the tag, and the comment below states the
    // rule this row was breaking: "a PARTIAL walk's tag rides on the row itself rather than living
    // only in the header lines above it."
    //
    // MEASURED CONSEQUENCE, and this is why the guard is here rather than in a note: `bash` and `toml`
    // BOTH read `FALSIFIED 1` on a partial walk and `FALSIFIED 0` on `--fresh` (bash also 0/10 -> 7/10
    // emitted, unjustified 9 -> 3). The gate ACCUSED TWO LANES of a defect neither had, and the verdict
    // it printed cites a file and a line — so it reads as though the claim had already been checked.
    // THE PARSE-TREE HALF HAD BEEN. THE UNCERTIFIABLE HALF CARRIED NO MARKER AT ALL.
    //
    // The direction of this error is the one that matters: RULED-UNKNOWN WITHHOLDS a verdict and
    // FALSIFIED ASSERTS one, so guarding the withheld verdict and not the asserted one means a partial
    // run fails LOUDLY AND WRONGLY — and sends someone to rewrite an analyzer that was working.
    const partial = !emittedPopulation.complete
    rows.push({
      type: t,
      status: partial ? "RULED-UNKNOWN" : "FALSIFIED",
      detail: partial
        ? `NOT CERTIFIED: the construct occurs ${hit.occurrences}x across ${hit.files} file(s) on the PARSE TREE, ` +
          `but the EMITTED column covers only ${emittedPopulation.measured.toLocaleString()}/${emittedPopulation.total.toLocaleString()} ` +
          `files (${emittedPopulation.settled.toLocaleString()} settled by an earlier walk contribute NO edges, ` +
          `${emittedPopulation.degraded.toLocaleString()} degraded, ${emittedPopulation.abandoned.toLocaleString()} abandoned), ` +
          `so "NOT EMITTED" is NOT established and this row CANNOT be falsified. e.g. ${hit.examples[0] ?? ""}. ` +
          `Re-run with --fresh to certify it.`
        : `NOT EMITTED, but the construct occurs ${hit.occurrences}x across ${hit.files} file(s) on the PARSE TREE — it is derivable, so the ruling is wrong. e.g. ${hit.examples[0] ?? ""}`,
    })
    continue
  }
  if (ruled?.instrument === "A:grammar-inventory") {
    const present = (ruled.nodeTypesThatWouldMeanIt ?? []).filter((n) => grammarNodeTypes.has(n))
    if (present.length > 0) {
      // SAME SPLIT AS ABOVE: the grammar claim is about the PARSER and is real; "NOT EMITTED" is about
      // the EMITTED column and is not certifiable on a partial walk.
      rows.push({
        type: t,
        status: emittedPopulation.complete ? "FALSIFIED" : "RULED-UNKNOWN",
        detail: emittedPopulation.complete
          ? `NOT EMITTED, but the grammar DOES produce ${present.join(", ")} — the construct exists. Instrument A.`
          : `NOT CERTIFIED: the grammar DOES produce ${present.join(", ")}, but the EMITTED column covers only ` +
            `${emittedPopulation.measured.toLocaleString()}/${emittedPopulation.total.toLocaleString()} files, so ` +
            `"NOT EMITTED" is NOT established. Instrument A. Re-run with --fresh to certify it.`,
      })
      continue
    }
  }
  const ruling = rulingFor(t)
  const v = verdictFor({
    type: t, ruled, ruling, keyEvidence, nodeTypeCount: grammarNodeTypes.size, population: emittedPopulation,
    att: attestation.att, attRel: attestation.rel, attProblems: attestation.problems, attVerified: attestation.verified,
  })
  // Every row the ruling path produces is a statement about a population, so a PARTIAL walk's tag
  // rides on the row itself rather than living only in the header lines above it.
  rows.push({ type: t, status: v.status, detail: v.status === "RULED-UNKNOWN" || emittedPopulation.complete ? v.detail : `${v.detail}${populationTag}` })
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
  // THE ROW-LEVEL POPULATION CLAIM. The lines above describe the walk; this one says what the
  // ABSENCE verdicts below are allowed to assert, and every row that leans on it carries the tag.
  console.log(`walk: emitted population ${emittedPopulation.measured.toLocaleString()}/${emittedPopulation.total.toLocaleString()} files measured by the analyzer THIS run ` +
    `(${emittedPopulation.settled.toLocaleString()} settled by an earlier walk and contributing NO edges, ${emittedPopulation.degraded} degraded, ${emittedPopulation.abandoned} abandoned) — ` +
    (emittedPopulation.complete
      ? `COMPLETE, so absence is certifiable in this run`
      : `PARTIAL, so absence is NOT certifiable: such rows read RULED-UNKNOWN rather than RULED-SOUND. Re-run with --fresh.`))
  console.log("")
}

console.log(`key spaces: ${keyEvidence.nodes.toLocaleString()} key/value bindings observed over ${files.length} files` +
  (keyEvidence.nodes > 0
    ? ` (top node types ${keyEvidence.topTypes.join(", ") || "?"}; e.g. ${keyEvidence.sample}) — a VOCABULARY-based ruling in this language must declare the attribute-keys space, or it is RULED-UNJUSTIFIED`
    : ` — no attribute-key syntax observed, so a vocabulary-based ruling cannot hide a construct that way`))
console.log(attestation.att
  ? `attestation ${LANG}: ${attestation.rel} — spaces ${(attestation.att.spacesProbed ?? []).join(", ") || "(none declared)"}; artefact ${attestation.att.artefact ?? "(none)"}` +
    (attestation.verified.length ? `; VERIFIED ${attestation.verified.join(", ")}` : "") +
    (attestation.problems.length ? `; PROBLEMS ${attestation.problems.join("; ")}` : "")
  : `attestation ${LANG}: none — declare \`spacesProbed\` in the lane's Ruled table, or provide ${attestation.rel} with an artefact that exists`)
console.log("")
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`${w("type", 14)}${w("status", 18)}detail`)
console.log("-".repeat(120))
for (const r of rows) console.log(`${w(r.type, 14)}${w(r.status, 18)}${r.detail}`)

const falsified = rows.filter((r) => r.status === "FALSIFIED")
const unjustified = rows.filter((r) => r.status === "RULED-UNJUSTIFIED")
const unknown = rows.filter((r) => r.status === "RULED-UNKNOWN")
const emitted = rows.filter((r) => r.status === "EMITTED")
console.log("-".repeat(120))
console.log(`emitted ${emitted.length}/10   ruled-sound ${rows.filter((r) => r.status === "RULED-SOUND").length}   FALSIFIED ${falsified.length}   ruled-without-justification ${unjustified.length}   ruled-unknown ${unknown.length}`)
if (unknown.length) {
  // NOT a failure: an unmeasured row is work to do, not a defective ruling. It must never be read
  // as a certification, which is exactly why it is not RULED-SOUND.
  console.log(`\n>>> ${unknown.length} row(s) are RULED-UNKNOWN, not certified: ${unknown.map((r) => r.type).join(", ")}.`)
  console.log(`>>> The EMITTED column covered ${emittedPopulation.measured.toLocaleString()}/${emittedPopulation.total.toLocaleString()} files in this run; re-run with --fresh to turn these into verdicts.`)
}
if (falsified.length) {
  console.log(`\n>>> THIS GATE FAILS. ${falsified.map((r) => r.type).join(", ")} ${falsified.length === 1 ? "is" : "are"} claimed absent but ${falsified.length === 1 ? "is" : "are"} demonstrably derivable from real code.`)
  console.log(`>>> A differential cannot find this class of defect, because the oracle omits the same type.`)
}
process.exitCode = falsified.length + unjustified.length === 0 ? 0 : 1
