/**
 * ZIG ANALYZER-OWNED MISS CAUSE LADDER — why each `dropped-*-IN-FILE` edge's
 * target is a real declaration the parser had in hand, and why nothing was
 * published for it.
 *
 * `filelocal-miss-class.ts` established THAT a target is missing: its rungs
 * `dropped-decl-IN-FILE` / `dropped-field-IN-FILE` mean "this file's own tree
 * declares the name and parseFile published no symbol for it", and it counts
 * **4,509** such edges at the full 3,834-file population, calling the lot
 * "analyzer-owned". That name is a claim about the ANALYZER and nothing tested
 * it, so pass 17 §G left the number undecomposed. It is decomposed here.
 *
 * The number is an UPPER BOUND and it mixes three different owners, because
 * `parseFile` is not the analyzer: it is the analyzer, then `keepSymbol`
 * (`src/ast/pool-worker.ts:918`), then the census. Reading the container_field
 * branch of `real-zig-analyzer.ts` (`:723`-`:810`), a field is published only
 * when a conjunction holds, and failing any conjunct has a different owner:
 *
 *   published = name guard passes (`:756`, `:744`)
 *               AND NOT (file-level field with no container)  -> zigFileLevelField
 *               AND container !== null AND anonContainer === false -> named branch
 *
 * so a missing field is either REFUSED BY A STATED RULE (the Z22 contract "a
 * container with no stable identity owns nothing", the anonymous-container
 * negative contract, the name guards), FILTERED BY SHARED PIPELINE CODE
 * (`keepSymbol`'s universal denylist, which for zig is `this` / `super` — both
 * real Zig spellings, and ghostty's `CloseTabMode` enum declares a member
 * literally named `this`), or DROPPED BY DEFECT. Those are opposite findings
 * and the published 4,509 folds them into one word, "analyzer-owned".
 *
 * METHOD — a SHADOW WALK, not a re-implementation and not a regex. Each
 * affected file is re-walked with the same four-state machine
 * (`container`, `inFunction`, `anonContainer`, and the container's NAME) that
 * `real-zig-analyzer.ts` uses, replicating its push sites:
 *
 *   variable_declaration inside a function or an anonymous container (:258)
 *       -> anonContainer ||= lastNamedChild(rhs) is a container node
 *   variable_declaration with a refused name (:266,:272,:311)
 *       -> container UNCHANGED  (the cascade; recorded as `owner-cascade`)
 *   variable_declaration otherwise (:443)
 *       -> container = the new symbol iff lastNamedChild(rhs) is a container node
 *   function_declaration (:662) / test_declaration / comptime_declaration (:472)
 *       -> inFunction = true
 *   a container node that is NOT the last named child of a variable_declaration (:692)
 *       -> anonContainer = true
 *   any other node, `block` included (:872)
 *       -> inFunction ||= node.type === "block"
 *
 * Two name facts are read from the analyzer itself rather than restated, because
 * restating them is how a ladder ends up measuring a different population:
 * `stripZigQuoting` (`real-zig-analyzer.ts:136`, applied to every published name
 * at `:1588`) and `keepSymbol` (`pool-worker.ts:427`, applied to every symbol at
 * `:918`). A `@"font-family"` field is published as `font-family`, and a field
 * named `this` is published by the analyzer and then DROPPED by the pipeline.
 *
 * CONTROLS, non-zero exit on failure:
 *   C1 every field the shadow walk says the analyzer publishes must be in the
 *      name set parseFile returned for that file. 0 violations over ~20k
 *      fields. This is what makes the walk a measurement: a mis-transcribed push
 *      site shows up here as a violation rather than as a quiet cause.
 *   C2 the recomputed `dropped-decl-IN-FILE` + `dropped-field-IN-FILE` totals
 *      equal the ones filelocal-miss-class.ts published, per type. If the two
 *      ladders ever disagree, this file is measuring a different population and
 *      says so by exiting — the comparison is the proof that the restatement is
 *      faithful, so it is asserted rather than assumed.
 *   C3 four synthetic sources, one per refusal class, each run through
 *      PRODUCTION `parseFile`: a struct inside a function (`local-type`), a
 *      struct used as a file-scope variable's type (`anon-container`), a
 *      container whose own name is over the 80-character cap (`owner-cascade`),
 *      and an enum member named `this` (`filtered-by-keepSymbol`). Each must
 *      both classify into its rung AND be absent from parseFile's output. A
 *      ladder that cannot reproduce a cause it claims to classify is not a
 *      ladder.
 *   C4 for every field site whose nearest container declaration has a usable
 *      name, the walk's `container` must be exactly that name. 0 violations.
 *      This is the invariant that would catch a cascade the analyzer does not
 *      have, and it is asserted over every site in the affected files.
 *   C5 for every field site whose nearest container declaration has a usable
 *      name, the kind published under that site's `qualifiedName` must be the
 *      kind the CONTAINER implies — `enum_member` when the container is an
 *      `enum_declaration`, `property` otherwise. C1 and C4 read a Set of NAMES,
 *      so a field published under the right name with the wrong KIND passes
 *      both; this is the control that can see it. Scope and its uncovered
 *      remainder are printed on the C5 line.
 *
 * NO REGEX. Every name, node type and cause comes from `node.type`,
 * `node.namedChild(i)` and `node.childForFieldName("name")` on the pinned wasm.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/analyzer-owned-miss-cause.ts \
 *          --dumps /tmp/opencode/zig-inc-p17
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { Parser, Language } from "web-tree-sitter"
import { ZIG_DECLARED_TYPE_BUILTINS, stripZigQuoting } from "../../../../src/ast/real-zig-analyzer"
import { keepSymbol, parseFile } from "../../../../src/ast/pool-worker"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const arg = (n: string, d: string): string => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
/**
 * THE DUMP DEFAULT WAS A TRAP, and it is fixed here rather than described.
 *
 * This line used to read `arg("dumps", "/tmp/opencode/zig-inc-p17")` — a HARDCODED
 * path to dumps produced at a commit FOUR PASSES OLD. Running the instrument with no
 * arguments therefore read pass-17 data and printed
 *
 *     C1 published-fields checked 22280  violations 66
 *     C2 recomputed rungs vs published: FAIL
 *
 * against a HEAD whose own dumps print `0` and `OK`. The FAIL is an artifact of the
 * default, and nothing in the output said so: `popHash` identifies the FILE
 * population, which is identical for both directories (`sha256:2f3545f9…`, 3,834
 * files), so the two runs claim the same population while disagreeing because they
 * ran different CODE. A reader has no way to tell a stale-dump failure from a live
 * defect — which is the same disease pass 19 §B fixed on the OUTPUT side (four
 * instruments naming their artifact with a hardcoded day, one clobbering another's
 * measurement in place). The input side had it and nobody had looked.
 *
 * The default is now the NEWEST `zig-inc-*` directory by mtime, and the resolved
 * directory, its mtime, and the per-shard counts are printed and recorded in the
 * artifact, so the run says what it read. `--dumps` still overrides.
 */
const DUMPS = arg("dumps", (() => {
  const base = "/tmp/opencode"
  let cands: { dir: string; m: number }[] = []
  try {
    for (const e of readdirSync(base)) {
      if (!e.startsWith("zig-inc")) continue
      const full = path.join(base, e)
      try {
        if (!statSync(full).isDirectory()) continue
        if (!readdirSync(full).some((f) => f.startsWith("dump-") && f.endsWith(".json"))) continue
        cands.push({ dir: full, m: statSync(full).mtimeMs })
      } catch { continue }
    }
  } catch { /* no base dir; fall through to the loud error below */ }
  cands.sort((a, b) => b.m - a.m)
  return cands.length ? cands[0].dir : path.join(base, "zig-inc-NONE")
})())
const DUMPS_MTIME = (() => { try { return new Date(statSync(DUMPS).mtimeMs).toISOString() } catch { return "unreadable" } })()

/**
 * The artifact name carries the day it was measured, so the default is derived from
 * the clock rather than hardcoded. Four of this lane's instruments hardcoded a date
 * literal, and the consequence was measured on pass 19: re-running `incoming-resolve.ts`
 * on a LATER day overwrote `incoming-resolution-full-2026-10-03.json` in place, leaving a
 * file whose name claims 2026-10-03 and whose content is from a later date — and a
 * `git status` that reads as an edit to an existing measurement rather than as a
 * clobber. Three of the four named 2026-10-04 and one named 2026-10-03, so no two agreed.
 *
 * This is the same shape as §8 items 15 and 18 (an instrument that writes a register it
 * does not own, or under a name that misstates what is in it), with the target being this
 * lane's own artifacts rather than a shared one. `--out` still overrides, so a
 * reproducible re-run can still be written to an explicit name.
 */
const MEASURED_ON = new Date().toISOString().slice(0, 10)
const OUT = arg("out", path.join(HERE, "measurements", `analyzer-owned-miss-cause-${MEASURED_ON}.json`))

await Parser.init({
  locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const language: any = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-zig.wasm")))
const parser = new Parser()
parser.setLanguage(language)

// ── the ladder's spelling helpers and its ORDER, restated from
// filelocal-miss-class.ts `classify` (:168-190) including the `builtin-type`
// conjunct `&& !publishedCount.has(target)` — dropping that conjunct moved 27
// edges between rungs on the first run of this file, which is what C2 exists to
// make loud instead of silent.
const isIdChar = (c: string): boolean => {
  const k = c.charCodeAt(0)
  return (k >= 97 && k <= 122) || (k >= 65 && k <= 90) || (k >= 48 && k <= 57) || k === 95
}
const isPlainIdent = (s: string): boolean => {
  if (!s.length) return false
  const c0 = s.charCodeAt(0)
  if (!((c0 >= 97 && c0 <= 122) || (c0 >= 65 && c0 <= 90) || c0 === 95)) return false
  for (let i = 1; i < s.length; i++) if (!isIdChar(s[i])) return false
  return true
}
const SCOPE_MARKERS = new Set(["(global)", "(file)", "(declared-type)", "(import)", "(local)"])
const looksLikePath = (s: string): boolean => {
  if (s.endsWith(".zig")) return true
  for (let i = 0; i < s.length; i++) if (s[i] === "/") return true
  return false
}
const ORD: Record<string, number> = { local: 0, parameter: 1, field: 2, decl: 3 }

type Dump = {
  popHash: string
  files: { key: string; symbols: { name: string; kind: string; qualifiedName: string }[]; declaredNames: [string, string][] }[]
  edges: { file: string; source: string; target: string; type: string; line: number; conf: number; meta: string | null; scope: string | null }[]
  fallbackFiles: string[]
}
const shards = readdirSync(DUMPS).filter((f) => f.startsWith("dump-") && f.endsWith(".json")).sort()
if (!shards.length) { console.error(`no dump-*.json in ${DUMPS}`); process.exit(2) }
const dumps: Dump[] = shards.map((f) => JSON.parse(readFileSync(path.join(DUMPS, f), "utf8")) as Dump)
const pops = new Set(dumps.map((d) => d.popHash))
if (pops.size !== 1) { console.error(`REFUSING: shards disagree on the population: ${[...pops]}`); process.exit(2) }
if (dumps.some((d) => d.fallbackFiles.length)) {
  console.error(`REFUSING: a shard reported parseFile fallback — it measured extractFallback, not the analyzer`)
  process.exit(2)
}

const fileNames = new Map<string, Set<string>>()
/** qualifiedName -> the set of kinds published under it. C1 and C4 check the
 *  NAME and the OWNER'S NAME; neither can see a symbol published under the
 *  right name with the wrong KIND, because the ladder only held a Set of names.
 *  `qualifiedName` is `Owner.member` for a field, so this map is what makes
 *  the kind check per-SITE rather than per-name. */
const fileQnameKinds = new Map<string, Map<string, Set<string>>>()
const fileDeclared = new Map<string, Map<string, string>>()
const publishedCount = new Map<string, number>()
for (const d of dumps) {
  for (const f of d.files) {
    const names = new Set<string>()
    for (const s of f.symbols) {
      if (!s.name) continue
      names.add(s.name)
      publishedCount.set(s.name, (publishedCount.get(s.name) ?? 0) + 1)
    }
    fileNames.set(f.key, names)
    const qk = new Map<string, Set<string>>()
    for (const s of f.symbols) {
      if (!s.qualifiedName) continue
      const set = qk.get(s.qualifiedName)
      if (set) set.add(s.kind); else qk.set(s.qualifiedName, new Set([s.kind]))
    }
    fileQnameKinds.set(f.key, qk)
    const dec = new Map<string, string>()
    for (const [n, k] of f.declaredNames) {
      const prev = dec.get(n)
      if (prev === undefined || (ORD[k] ?? -1) > (ORD[prev] ?? -1)) dec.set(n, k)
    }
    fileDeclared.set(f.key, dec)
  }
}

/** The two analyzer-owned rungs, in filelocal-miss-class.ts's order. Only the
 *  rungs at or above `dropped-field-IN-FILE` can produce one. */
function missingRung(file: string, target: string): string {
  if (!target) return "empty"
  if (fileNames.get(file)?.has(target)) return "resolved-file-local"
  if (SCOPE_MARKERS.has(target)) return "scope-marker"
  if (target.charCodeAt(0) === 64) return "builtin-fn"
  if (looksLikePath(target)) return "path"
  if (!isPlainIdent(target)) return "non-identifier"
  if (ZIG_DECLARED_TYPE_BUILTINS.has(target) && !publishedCount.has(target)) return "builtin-type"
  const here = fileDeclared.get(file)?.get(target)
  if (here === "decl") return "dropped-decl-IN-FILE"
  if (here === "field") return "dropped-field-IN-FILE"
  return "later-rung"
}

type Case = { file: string; name: string; rung: string; types: Map<string, number>; edges: number; lines: number[] }
const cases = new Map<string, Case>()
const recomputed: Record<string, Record<string, number>> = {}
for (const d of dumps) {
  for (const e of d.edges) {
    if (!fileNames.has(e.file)) continue
    if (e.target && fileNames.get(e.file)!.has(e.target)) continue
    const rung = missingRung(e.file, e.target)
    if (rung !== "dropped-decl-IN-FILE" && rung !== "dropped-field-IN-FILE") continue
    recomputed[e.type] ??= {}
    recomputed[e.type][rung] = (recomputed[e.type][rung] ?? 0) + 1
    const k = `${e.file} ${e.target}`
    let c = cases.get(k)
    if (!c) { c = { file: e.file, name: e.target, rung, types: new Map(), edges: 0, lines: [] }; cases.set(k, c) }
    c.types.set(e.type, (c.types.get(e.type) ?? 0) + 1)
    c.edges++
    c.lines.push(e.line)
  }
}
const affectedFiles = [...new Set([...cases.values()].map((c) => c.file))].sort()

// ── the shadow walk
const ANON_CONTAINER = new Set([
  "struct_declaration", "union_declaration", "enum_declaration",
  "error_set_declaration", "opaque_declaration",
])
/**
 * `containerPath` is the container's ABSOLUTE dotted path — Z-p22.
 *
 * `container` is the container's BARE name, which is what the walk tracked until
 * pass 22, and C5 built a site's expected `qualifiedName` as
 * `${nearestOwner}.${name}` from it. Production stopped publishing that spelling
 * at pass 22 (a member of `IOSurface.Error` is `IOSurface.Error.InvalidOperation`,
 * not `Error.InvalidOperation`), so the lookup started missing and C5's `if
 * (!publishedKinds) continue` SKIPPED the site silently: checked fell 19,533 ->
 * 12,916 and violations stayed 0. A control that covers 34% less and reports the
 * same 0 is worse than no control, because 0 reads as a pass.
 *
 * So the walk now carries both, and C5 looks the site up under the path
 * production publishes. The construction mirrors `real-zig-analyzer.ts`'s
 * `ownerPathOf` exactly — parent path + `.` + this container's name — so a
 * disagreement between the two is a finding rather than a definition difference.
 */
type Flags = {
  container: string | null
  containerPath: string | null
  inFunction: boolean
  anonContainer: boolean
  containerIsErrorSet: boolean
}
type DeclSite = {
  name: string
  flags: Flags
  willPublish: boolean
  /** the NAME guard's reason, or null when the name is acceptable and the SCOPE
   *  is what refuses the declaration. The two are different findings. */
  nameRefused: string | null
  line: number
}
type FieldSite = {
  name: string
  raw: string
  firstNamed: string
  flags: Flags
  isFileLevel: boolean
  isErrorMember: boolean
  nameRefused: string | null
  nearestOwner: string | null
  /** the NODE TYPE of the owner declaration (`enum_declaration`, …), which is
   *  what C5 needs: the analyzer's kind discriminator for a container field is
   *  the CONTAINER'S KIND (`real-zig-analyzer.ts:800`), not the field's own
   *  shape, so the ladder has to read the container's node type to predict the
   *  kind independently. Null whenever `nearestOwner` is. */
  ownerNodeType: string | null
  hasTypeField: boolean
  ownerRefused: string | null
  line: number
}

/** the first DIRECT named child matching `identifier` — `anyChild` in the
 *  analyzer (:2670) does not recurse, and a re-implementation that recurses
 *  would pick a different identifier on every declaration that has one. */
function firstDirectIdentifier(n: any): any {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === "identifier") return c
  }
  return null
}
function deepIdentifier(n: any): any {
  if (n.type === "identifier") return n
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (!c) continue
    const hit = deepIdentifier(c)
    if (hit) return hit
  }
  return null
}
/** the analyzer's field-name read (:746-753 and :2607-2610): the `name` FIELD
 *  when it is an identifier, else the first identifier anywhere under the node. */
function fieldNameOf(n: any, ownerNodeType: string | null): { raw: string; name: string; refused: string | null } {
  const nf = n.childForFieldName?.("name")
  // Z-p20. This function used to be
  //     const ident = nf && nf.type === "identifier" ? nf : deepIdentifier(n)
  // and the deep search is a LANE-INSTRUMENT DEFECT: when the `name` field
  // exists but is not an identifier it reached into the field's VALUE. On
  // `noreturn = max - 2` (aro/backend/Interner.zig:219) it recorded the enum
  // member as being named `max`, so 122 real members were charged as reads of an
  // unrelated declaration, and C1's name-membership check passed on that wrong
  // name -- a control satisfied for the wrong reason. The analyzer's own
  // fallback is `anyChild`, which does NOT recurse (`real-zig-analyzer.ts`
  // comment at :782), so the ladder's recursion was a divergence of its own.
  // The name field is now authoritative whenever it is present.
  if (nf) {
    // …and the one non-identifier that IS a name: an enum member may be named
    // with a primitive type name, which the lexer spells as `builtin_type`.
    // Gated on ENUM for the reason the analyzer gates it — a bare token in a
    // struct or union body is a tuple element type, not a declaration.
    if (nf.type === "identifier") { /* fall through to the shared tail */ }
    else if (nf.type === "builtin_type" && ownerNodeType === "enum_declaration") { /* ditto */ }
    else return { raw: nf.text, name: "", refused: `name-field-is-${nf.type}` }
  }
  const ident = nf ?? deepIdentifier(n)
  if (!ident) return { raw: "", name: "", refused: "no-identifier" }
  const raw = ident.text
  const name = stripZigQuoting(raw)
  if (!name) return { raw, name, refused: "empty" }
  if (name === "_") return { raw, name, refused: "blank-identifier" }
  if (name.length >= 200) return { raw, name, refused: "length-cap" }
  return { raw, name, refused: null }
}
/** the container DECLARATION a field belongs to, read from the tree rather than
 *  from the walk's flag — so the two can disagree, which is what C4 asserts
 *  cannot happen for a named owner. `file-level` and `no-container-ancestor`
 *  are NOT refusals: they are the two shapes that legitimately have no owner. */
function nearestOwnerDecl(fieldNode: any): { name: string | null; refused: string | null; nodeType: string | null } {
  let n = fieldNode.parent
  while (n) {
    if (ANON_CONTAINER.has(n.type)) {
      const decl = n.parent
      if (decl && decl.type === "variable_declaration") {
        const ident = firstDirectIdentifier(decl)
        const raw = ident?.text ?? ""
        const nm = stripZigQuoting(raw)
        if (!ident) return { name: null, refused: "no-identifier", nodeType: n.type }
        if (nm === "_") return { name: null, refused: "blank-identifier", nodeType: n.type }
        if (nm.length > 80) return { name: null, refused: "length-cap", nodeType: n.type }
        return { name: nm, refused: null, nodeType: n.type }
      }
      return { name: null, refused: "not-a-declaration-rhs", nodeType: null }
    }
    if (n.type === "source_file") return { name: null, refused: "file-level", nodeType: null }
    n = n.parent
  }
  return { name: null, refused: "no-container-ancestor", nodeType: null }
}

function shadowWalk(root: any): { fields: FieldSite[]; declSites: DeclSite[] } {
  const fields: FieldSite[] = []
  const declSites: DeclSite[] = []
  const stack: { node: any; flags: Flags }[] = [{
    node: root,
    flags: { container: null, containerPath: null, inFunction: false, anonContainer: false, containerIsErrorSet: false },
  }]
  while (stack.length) {
    const { node, flags } = stack.pop()!
    const type: string = node.type
    const push = (f: Flags): void => {
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const c = node.namedChild(i)
        if (c) stack.push({ node: c, flags: f })
      }
    }
    if (type === "variable_declaration") {
      let rhs: any = null
      for (let i = 0; i < node.namedChildCount; i++) rhs = node.namedChild(i)
      const rhsType: string = rhs?.type ?? ""
      if (flags.inFunction || flags.anonContainer) {
        // The site is recorded EVEN THOUGH the walk refuses it (:193/:258).
        // Leaving it unrecorded was a defect in this file, not a finding about
        // the corpus: 188 cases classified `no-local-decl-site` because the only
        // thing that decides them is the refusal this branch performs, and a
        // refusal that is not recorded cannot be classified. A remainder you
        // cannot attribute is a bug in the instrument.
        const inner = firstDirectIdentifier(node)
        // refused is the NAME guard only. In this branch the NAME is fine and the
      // SCOPE refuses the declaration, and recording that as a name refusal moved
      // 1,587 edges into `name-refused-by-analyzer` on the first run of the fix —
      // a number that large and that wrong is what a reason string is for.
      declSites.push({
          name: stripZigQuoting(inner?.text ?? ""), flags, willPublish: false,
          nameRefused: null, line: node.startPosition.row + 1,
        })
        push({ ...flags, anonContainer: flags.anonContainer || ANON_CONTAINER.has(rhsType) })
        continue
      }
      const ident = firstDirectIdentifier(node)
      const varName = stripZigQuoting(ident?.text ?? "")
      const refused = !ident ? "no-identifier" : varName === "_" ? "blank-identifier" : varName.length > 80 ? "length-cap" : null
      declSites.push({ name: varName, flags, willPublish: refused === null, nameRefused: refused, line: node.startPosition.row + 1 })
      if (refused) { push(flags); continue } // the cascade: container UNCHANGED
      const establishes = ANON_CONTAINER.has(rhsType)
      push({
        ...flags,
        container: establishes ? varName : flags.container,
        containerPath: establishes
          ? flags.containerPath ? `${flags.containerPath}.${varName}` : varName
          : flags.containerPath,
        containerIsErrorSet: establishes
          ? rhsType === "error_set_declaration" : flags.containerIsErrorSet,
      })
      continue
    }
    if (type === "function_declaration") {
      const ident = node.namedChildCount > 0 ? node.namedChild(0) : null
      const first = ident && ident.type === "identifier" ? ident : deepIdentifier(node)
      const fnName = stripZigQuoting(first?.text ?? "")
      // `isAnonymousContainerMember` (:577): anonContainer || (!container && inFunction)
      const member = flags.anonContainer || (!flags.container && flags.inFunction)
      declSites.push({
        name: fnName, flags,
        willPublish: !!fnName && fnName.length < 100 && !member,
        nameRefused: !fnName ? "no-identifier" : fnName.length >= 100 ? "length-cap" : null,
        line: node.startPosition.row + 1,
      })
      push({ ...flags, inFunction: true })
      continue
    }
    if (type === "test_declaration" || type === "comptime_declaration") { push({ ...flags, inFunction: true }); continue }
    if (type === "error_set_declaration") {
      // ERROR SET MEMBERS are declarations too — `error{ DeviceError }` declares
      // `DeviceError` — and they are PUBLISHED by a different branch of the walk
      // (:810, gated on `container.metadata.zigErrorSet`), so they are recorded
      // as sites and the gate is tracked in `containerIsErrorSet`. They are the
      // last 47 cases this file could not classify. This branch is placed
      // BEFORE the ANON_CONTAINER branch on purpose: `error_set_declaration` is a
      // member of ANON_CONTAINER, so the anon branch `continue`s past it and the
      // members are never recorded.
      // `pub const E = A || error{X}`
      // puts the error set inside a `binary_expression`, so the walk's container
      // is `E`'s OWNER rather than `E` itself, `zigErrorSet` is never set, and
      // the members are published nowhere. The ladder's `treeDeclaredNames` reads
      // `namedChild(0)` and calls each member a file-scope `decl`, which is why
      // those 47 cases arrived here as a remainder.
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (!c || c.type !== "identifier") continue
        const name = stripZigQuoting(c.text)
        fields.push({
          name, raw: c.text, firstNamed: name, flags, isFileLevel: false, isErrorMember: true,
          nameRefused: !name ? "empty" : name === "_" ? "blank-identifier"
            : name.length >= 50 ? "enum-member-length-cap" : null,
          nearestOwner: flags.container,
          ownerRefused: flags.containerIsErrorSet ? null : "not-an-error-set-container",
          line: c.startPosition.row + 1,
        })
      }
      push(flags)
      continue
    }
    if (ANON_CONTAINER.has(type)) {
      const parent = node.parent
      const isDeclRhs =
        !!parent && parent.type === "variable_declaration" &&
        parent.namedChildCount > 0 &&
        parent.namedChild(parent.namedChildCount - 1)?.id === node.id
      if (!isDeclRhs) { push({ ...flags, anonContainer: true }); continue }
      push(flags)
      continue
    }
    if (type === "container_field") {
      const isFileLevel = node.parent?.type === "source_file"
      const owner = nearestOwnerDecl(node)
      const { name, raw, refused } = fieldNameOf(node, owner.nodeType)
      fields.push({
        name, raw, firstNamed: stripZigQuoting(node.namedChild(0)?.text ?? ""),
        flags, isFileLevel, isErrorMember: false, nameRefused: refused,
        nearestOwner: owner.name,
        ownerNodeType: owner.nodeType,
        // the analyzer's `typeFieldOf` reads the grammar's `type` FIELD, so the
        // ladder reads the same field rather than looking for a node type: that
        // is the whole reason Z17b exists, and a ladder that re-derived it by
        // node type would disagree for reasons that are the ladder's own.
        hasTypeField: !!node.childForFieldName?.("type"),
        // `ownerRefused` is a REFUSAL of the owner's own name, which is a
        // different fact from "there is no container ancestor": the first loses
        // the walk's owner, the second never had one.
        ownerRefused: owner.refused === "file-level" || owner.refused === "no-container-ancestor" || owner.refused === "not-a-declaration-rhs"
          ? null : owner.refused,
        line: node.startPosition.row + 1,
      })
      push(flags)
      continue
    }
    push({ ...flags, inFunction: flags.inFunction || type === "block" })
  }
  return { fields, declSites }
}

// ── the cause ladder. ORDER IS OWNERSHIP: a stated refusal is reported as a
// refusal even where a defect also applies, because "we decided not to publish
// this, and here is the rule" is the actionable half, and burying it under a
// defect count would hand a fix to the wrong file.
const CAUSES = [
  "name-refused-by-analyzer",
  "filtered-by-keepSymbol",
  "local-type",
  "anon-container",
  "owner-cascade",
  "no-named-owner",
  "published-but-absent",
  "ladder-read-a-type-expression",
  "no-local-decl-site",
] as const
type Cause = (typeof CAUSES)[number]
/** who owns the decision. `shared-pipeline` is §8: src/ast/pool-worker.ts.
 *  `lane-instrument` is this lane's own measurement code, which is neither the
 *  analyzer nor shared machinery — a finding there is still a finding, and
 *  calling it the analyzer's would be a misattribution. */
const OWNER: Record<Cause, "analyzer-stated-rule" | "shared-pipeline" | "lane-instrument" | "defect"> = {
  "name-refused-by-analyzer": "analyzer-stated-rule",
  "filtered-by-keepSymbol": "shared-pipeline",
  "local-type": "analyzer-stated-rule",
  "anon-container": "analyzer-stated-rule",
  "owner-cascade": "analyzer-stated-rule",
  "no-named-owner": "analyzer-stated-rule",
  "published-but-absent": "defect",
  "ladder-read-a-type-expression": "lane-instrument",
  "no-local-decl-site": "defect",
}
/** A container node reached WITHOUT its `const X =` binding carries no declared
 *  name: the name is on the parent variable_declaration. The miss ladder reads
 *  `namedChild(0)` (incoming-check.ts:192), so for `const E = enum(u0) {…}` that
 *  child is the TAG TYPE and the ladder records `u0` — a Zig builtin — as a
 *  file-scope declaration this lane then failed to publish. The analyzer is
 *  right and the ladder is wrong, so this is its own rung with its own owner. */
const BARE_CONTAINER_NODES = new Set([
  "struct_declaration", "enum_declaration", "union_declaration",
  "opaque_declaration", "error_set_declaration",
])
function isBareContainerSite(d: { nodeType: string; parentType: string }): boolean {
  return BARE_CONTAINER_NODES.has(d.nodeType) && d.parentType === "variable_declaration"
}
function causeOfField(s: FieldSite, hasSites: boolean): Cause {
  if (!hasSites) return "no-local-decl-site"
  if (s.nameRefused) return "name-refused-by-analyzer"
  if (!keepSymbol({ name: s.name }, "zig")) return "filtered-by-keepSymbol"
  if (s.flags.inFunction) return "local-type"
  if (s.flags.anonContainer) return "anon-container"
  // An error-set member whose enclosing container is not itself an error set
  // (`pub const E = A || error{X}`) is the anonymous-container rule again, one
  // level down: Zig infers a merged error set and declares the member, but the
  // walk's container is `E`'s OWNER, so `zigErrorSet` is never set and the
  // member is published nowhere. Read as `anon-container`, not as a cascade:
  // nothing about the owner's NAME was refused.
  if (s.isErrorMember && !s.flags.containerIsErrorSet) return "anon-container"
  // declaration scope from here: not an executable body, not inside an
  // anonymous container, so a container ancestor IS the owner and the two
  // readings of "whose field is this" must agree.
  if (s.ownerRefused) return "owner-cascade"
  if (!s.flags.container && !s.isFileLevel) return "no-named-owner"
  return "published-but-absent"
}
function causeOfDecl(name: string, nameRefused: string | null, flags: Flags): Cause {
  if (nameRefused) return "name-refused-by-analyzer"
  if (!keepSymbol({ name }, "zig")) return "filtered-by-keepSymbol"
  if (flags.inFunction) return "local-type"
  if (flags.anonContainer) return "anon-container"
  return "published-but-absent"
}

const zero = (): Record<Cause, number> => Object.fromEntries(CAUSES.map((c) => [c, 0])) as Record<Cause, number>
const causeCases = zero()
const causeEdges = zero()
const causeByType: Record<string, Record<Cause, number>> = {}
const causeByRung: Record<string, Record<Cause, number>> = {
  "dropped-field-IN-FILE": zero(), "dropped-decl-IN-FILE": zero(),
}
const examples: Record<Cause, { file: string; name: string; line: number; edgeTypes: string }[]> =
  Object.fromEntries(CAUSES.map((c) => [c, []])) as Record<Cause, { file: string; name: string; line: number; edgeTypes: string }[]>

let c1Checked = 0
let c1Violations = 0
const c1Examples: string[] = []
let c4Checked = 0
let c4Violations = 0
const c4Examples: string[] = []
let c5Checked = 0
let c5Violations = 0
let c5FileLevelSites = 0
let c5FileLevelUncovered = 0
const c5Examples: string[] = []
let misattributed = 0
const misattributedExamples: string[] = []
const missingOnDisk: string[] = []
let fieldSites = 0
/** `no-local-decl-site` is the one rung this file cannot EXPLAIN, so it is
 *  diagnosed rather than counted: for each such case the file is re-scanned with
 *  the LADDER's own name rule (`namedChild(0)`, incoming-check.ts:192) and the
 *  disagreement is recorded — which node type claimed the name, and what the
 *  analyzer's `name`-FIELD rule reads at that same node. A rung that cannot say
 *  why it fired is a remainder, and this lane does not publish remainders. */
const noSiteDiag: { file: string; name: string; rung: string; sites: { nodeType: string; parentType: string; nameField: string }[] }[] = []
const LADDER_NAMED_KINDS = new Set([
  "function_declaration", "function_signature", "variable_declaration",
  "test_declaration", "struct_declaration", "enum_declaration",
  "union_declaration", "opaque_declaration", "error_set_declaration",
  "container_field", "parameter",
])
function diagnoseNoSite(root: any, name: string): { nodeType: string; parentType: string; nameField: string }[] {
  const out: { nodeType: string; parentType: string; nameField: string }[] = []
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (LADDER_NAMED_KINDS.has(n.type)) {
      const first = n.namedChild(0)
      if (first?.type === "identifier" && first.text === name) {
        const nf = n.childForFieldName?.("name")
        out.push({
          nodeType: n.type,
          parentType: n.parent?.type ?? "?",
          nameField: nf ? nf.type + (nf.type === "identifier" ? `:${nf.text}` : "") : "null",
          deepIdent: deepIdentifier(n)?.text ?? null,
        })
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return out
}

for (const file of affectedFiles) {
  const abs = path.join(CR, file)
  if (!existsSync(abs)) { missingOnDisk.push(file); continue }
  const tree = parser.parse(readFileSync(abs, "utf8"))
  const { fields, declSites } = shadowWalk(tree.rootNode)
  fieldSites += fields.length
  const names = fileNames.get(file)!
  const qnameKinds = fileQnameKinds.get(file) ?? new Map<string, Set<string>>()

  // C1 — what the walk says is published must be in parseFile's output. A name
  // `keepSymbol` drops is EXCLUDED, and that exclusion is the point: the filter
  // runs inside parseFile (`pool-worker.ts:918`), so a denylisted field is
  // published by the analyzer and absent from the index, which is a different
  // owner from the analyzer's. Leaving it in made this control report 8
  // violations on the first run, all of them `this`/`super`.
  for (const s of fields) {
    if (s.nameRefused) continue
    if (!keepSymbol({ name: s.name }, "zig")) continue
    // the two publication rules the walk has: a container_field (:723-810) and
    // an error_set_declaration's direct identifier members (:810, gated on
    // `container.metadata.zigErrorSet`, which is `containerIsErrorSet` here).
    const willPublish = s.isErrorMember
      ? s.flags.containerIsErrorSet && !s.flags.anonContainer
      : (s.isFileLevel && !s.flags.container && !s.flags.anonContainer) ||
        (s.flags.container !== null && !s.flags.anonContainer)
    if (!willPublish) continue
    c1Checked++
    if (!names.has(s.name)) {
      c1Violations++
      if (c1Examples.length < 12) c1Examples.push(`${file}:${s.line} ${s.name} (owner ${s.flags.container ?? "file"})`)
    }
  }
  // C4 — a field whose nearest container declaration has a usable name must be
  // attributed to exactly that name. GATED ON DECLARATION SCOPE, and the gate
  // is the correction rather than a caveat: ungated it reported 13,294
  // violations, every one of them a field of a container declared INSIDE a
  // function, where the walk never published the container (Z22) so there is no
  // owner to agree with. The invariant is about declaration scope only.
  for (const s of fields) {
    if (s.nearestOwner === null) continue
    if (s.flags.inFunction || s.flags.anonContainer) continue
    c4Checked++
    if (s.flags.container !== s.nearestOwner) {
      c4Violations++
      if (c4Examples.length < 12) c4Examples.push(`${file}:${s.line} ${s.name} owner=${s.flags.container} nearest=${s.nearestOwner}`)
    }
  }
  // C5 — a field published under the right NAME and the right OWNER must still
  // carry the kind its SITE implies. This is the check C1 and C4 cannot make:
  // both read a Set of names, so a field published as `property` where the
  // grammar says `enum_member` passes them both. It matters because kind is not
  // cosmetic — `enum_member` is what makes an enum literal's use resolve to the
  // member rather than to a property of the enum type.
  //
  // SCOPE, stated rather than discovered: this covers the CONTAINER path only
  // (`real-zig-analyzer.ts:800`), whose discriminator is the container's kind,
  // and it is gated on declaration scope for the reason C4 is. The FILE-LEVEL
  // path (`:2621`) has a different discriminator — the presence of a `type`
  // field — and needs the `@This()` binding to derive a qualifiedName, so its
  // sites are counted and declared uncovered rather than checked.
  for (const s of fields) {
    if (s.nameRefused) continue
    if (keepSymbol({ name: s.name }, "zig")) continue
    c5FileLevelUncovered++
    if (s.isFileLevel) c5FileLevelSites++
  }
  for (const s of fields) {
    if (s.nameRefused || s.nearestOwner === null) continue
    if (s.isFileLevel || s.flags.inFunction || s.flags.anonContainer) continue
    if (!s.ownerNodeType) continue
    const willPublish = s.isErrorMember
      ? s.flags.containerIsErrorSet && !s.flags.anonContainer
      : (s.flags.container !== null && !s.flags.anonContainer)
    if (!willPublish) continue
    if (!keepSymbol({ name: s.name }, "zig")) continue
    const expected = s.ownerNodeType === "enum_declaration" ? "enum_member" : "property"
    // Z-p22: the ABSOLUTE path, which is what production publishes. See `Flags`.
    const qn = `${s.flags.containerPath ?? s.nearestOwner}.${s.name}`
    const publishedKinds = qnameKinds.get(qn)
    if (!publishedKinds) continue // C1 owns absence; C5 is only about a wrong kind
    c5Checked++
    if (!publishedKinds.has(expected)) {
      c5Violations++
      if (c5Examples.length < 12) {
        c5Examples.push(`${file}:${s.line} ${qn} expected=${expected} published=${[...publishedKinds].sort().join("|")} (container ${s.ownerNodeType})`)
      }
    }
  }
  // a field published under an owner the source does not name is a
  // FABRICATION, whether or not the name is missing — so it is counted over
  // every site, not only over the missing ones, and over declaration scope only
  // for the same reason C4 is.
  for (const s of fields) {
    if (s.nameRefused || s.nearestOwner === null) continue
    if (s.flags.inFunction || s.flags.anonContainer) continue
    if (s.flags.container !== s.nearestOwner) {
      misattributed++
      if (misattributedExamples.length < 8) {
        misattributedExamples.push(`${file}:${s.line} ${s.name} walkOwner=${s.flags.container} nearestDecl=${s.nearestOwner}`)
      }
    }
  }

  const fieldSitesByName = new Map<string, FieldSite[]>()
  for (const s of fields) {
    const arr = fieldSitesByName.get(s.name)
    if (arr) arr.push(s); else fieldSitesByName.set(s.name, [s])
  }
  const declSitesByName = new Map<string, DeclSite[]>()
  for (const d of declSites) {
    if (!d.name) continue
    const arr = declSitesByName.get(d.name)
    if (arr) arr.push(d); else declSitesByName.set(d.name, [d])
  }

  for (const c of cases.values()) {
    if (c.file !== file) continue
    // The cause is a property of a SITE, and the ladder's rung is a property of a
    // NAME, so both kinds of site are considered for every case. Restricting the
    // `dropped-decl` rung to declaration nodes left 47 cases unclassifiable: the
    // ladder reads `error{DeviceError}`'s member off `namedChild(0)` and calls it
    // a file-scope DECLARATION, while the site that explains it is an
    // error_set_declaration member.
    const cands: Cause[] = [
      ...(declSitesByName.get(c.name) ?? []).map((d) => causeOfDecl(d.name, d.nameRefused, d.flags)),
      ...(fieldSitesByName.get(c.name) ?? []).map((s) => causeOfField(s, true)),
    ]
    const cause = cands.length
      ? cands.reduce((a, b) => (CAUSES.indexOf(b) < CAUSES.indexOf(a) ? b : a))
      : (() => {
          // no site of any kind carries this name. Before calling that a defect,
          // ask WHERE the ladder got the name: a bare container node's
          // `namedChild(0)` is a type expression, not a declaration.
          const found = diagnoseNoSite(tree.rootNode, c.name)
          if (found.length && found.every(isBareContainerSite)) return "ladder-read-a-type-expression" as Cause
          if (noSiteDiag.length < 40) noSiteDiag.push({ file: c.file, name: c.name, rung: c.rung, sites: found })
          return "no-local-decl-site" as Cause
        })()
    causeCases[cause]++
    causeEdges[cause] += c.edges
    causeByRung[c.rung][cause] += c.edges
    causeByType[c.types.size ? [...c.types.keys()].sort()[0] : "?"] ??= zero()
    for (const [t, n] of c.types) {
      causeByType[t] ??= zero()
      causeByType[t][cause] += n
    }
    const bucket = examples[cause]
    if (bucket.length < 8) {
      bucket.push({
        file: c.file, name: c.name, line: c.lines[0] ?? 0,
        edgeTypes: [...c.types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => `${t}:${n}`).join(","),
      })
    }
  }
}
function pickLowest<T>(items: T[] | undefined, f: (t: T) => Cause): Cause {
  if (!items || !items.length) return "no-local-decl-site"
  let best: Cause = f(items[0])
  for (const it of items) {
    const c = f(it)
    if (CAUSES.indexOf(c) < CAUSES.indexOf(best)) best = c
  }
  return best
}

// ── C2: the restated ladder must reproduce the published per-type totals
//
// `references/dropped-decl-IN-FILE` was **25** until pass 19, and the extra edge was
// `u0` in `zig/test/behavior/extern_struct_zero_size_fields.zig` — the backing type of
// `const E = enum(u0)`, read as a file-scope declaration by `incoming-check.ts`'s
// `treeDeclaredNames`. §8 item 26 of `docs/analyzers/zig.md` specified the
// skip; pass 19 applied it, and C2 is what reported the change rather than letting the
// two populations diverge. It is recorded here as a correction, not a re-baseline: every
// other cell is unchanged, and the one that moved moved DOWN by the exact number of false
// names the fix removes (1).
//
// ## Pass 26: the table gains the DEFINITION it was measured under, because the
// definition changed and nothing said so.
//
// Pass 22 recorded this control as permanently red on five cells and declined to
// re-baseline, on the grounds that "re-baselining that table is the fix and it
// edits a published number, so it is not this lane's to do". That left the control
// in a state where it could not distinguish its two possible meanings, and the two
// look identical in the output:
//
//   (a) the ladder's recomputation drifted — a real regression, and the control
//       is doing the only thing it is for;
//   (b) the column it reads changed definition underneath it, so the recomputation
//       is right and the baseline is stale.
//
// Measured, it is (b): the census's `declaredNames` column stopped emitting one
// `(name, highest-ranked slot)` entry per name and started emitting every
// `(name, slot)` the grammar binds, with the consumer reducing (the census's own
// header carries the diff: 22,401 bindings agreed, 1,266 slot values differ). The
// baseline below was measured under the superseded column. And it cannot be a
// population difference either: the committed `analyzer-owned-miss-cause-2026-10-04
// .json` and `…-p22-after.json` both report the SAME 395,967-edge population, and
// one recomputes to the baseline and the other does not — so the edge total does
// not identify the generation and cannot be the discriminator.
//
// The fix is therefore not to move the numbers. It is to carry the definition with
// them, which is what `ontology-census.ts` now stamps into its raw dump and this
// control compares. Three states, and only one of them is an alarm:
//
//   OK                 the baseline's definition is the one the dumps were built
//                      under, and every cell agrees.
//   DISAGREEMENT       same definition, a cell differs. The control works; treat
//                      it as a regression.
//   BASELINE-SUPERSEDED  the definitions differ. The control is INACTIVE for rung
//                      regressions, the per-cell deltas are printed so the next
//                      re-baseline is a diff rather than a guess, and the exit code
//                      is 2 — distinct from 1, because "the control cannot run" and
//                      "the control ran and found something" must not share a code.
//
// Re-baselining is still deliberately NOT done here, and now for a reason that can
// be stated: with the old definition unrecoverable (the dumps carrying it are four
// generations old), a re-baseline would replace a number whose provenance is known
// with a number whose provenance is merely current.
const PUBLISHED: Record<string, Record<string, number>> = {
  uses: { "dropped-field-IN-FILE": 3703, "dropped-decl-IN-FILE": 274 },
  calls: { "dropped-field-IN-FILE": 231, "dropped-decl-IN-FILE": 117 },
  references: { "dropped-field-IN-FILE": 131, "dropped-decl-IN-FILE": 24 },
  instantiates: { "dropped-field-IN-FILE": 19, "dropped-decl-IN-FILE": 1 },
  contains: { "dropped-field-IN-FILE": 8, "dropped-decl-IN-FILE": 0 },
  imports: { "dropped-field-IN-FILE": 0, "dropped-decl-IN-FILE": 0 },
  exports: { "dropped-field-IN-FILE": 0, "dropped-decl-IN-FILE": 0 },
}
/** The definition of `declaredNames` the table above was measured under. This is
 *  the string the census stamps; it is written out here so a reader of THIS file
 *  alone can tell which column the numbers describe. */
const PUBLISHED_DEFINITION = process.env.BB_C2_BASELINE_DEFINITION
  ?? "one-(name,highest-ranked-slot)-entry-per-name;producer-reduced"
if (process.env.BB_C2_BASELINE_DEFINITION) {
  console.log(`BB_C2_BASELINE_DEFINITION is set — C2 is comparing against a baseline declared`)
  console.log(`  to be measured under ${JSON.stringify(process.env.BB_C2_BASELINE_DEFINITION)}.`)
  console.log(`  This is how the control's three states are exercised, and how a re-baseline is done`)
  console.log(`  deliberately. A run that sets it is a SELF-TEST or a re-baseline, not a reading of`)
  console.log(`  the published table, and its C2 line must not be quoted as one.`)
}
/** The definition the dumps this run read were actually built under, read from the
 *  dumps. `null` means an older converter, which is itself a finding. */
const DUMP_DEFINITION: string | null = [...dumps][0]?.declaredNamesDefinition ?? null

const c2Cells: { cell: string; recomputed: number; published: number }[] = []
for (const [t, rungs] of Object.entries(PUBLISHED)) {
  for (const [rung, want] of Object.entries(rungs)) {
    const got = recomputed[t]?.[rung] ?? 0
    if (got !== want) c2Cells.push({ cell: `${t}/${rung}`, recomputed: got, published: want })
  }
}
// No stamp at all means the dumps predate the census change, so the comparison is
// against a population whose column definition is UNKNOWN — which is worse than
// either known state, and is reported as its own thing rather than as `OK`.
const C2_STATE: "OK" | "DISAGREEMENT" | "BASELINE-SUPERSEDED" | "DEFINITION-UNKNOWN" =
  DUMP_DEFINITION === null ? "DEFINITION-UNKNOWN"
  : DUMP_DEFINITION === PUBLISHED_DEFINITION ? (c2Cells.length ? "DISAGREEMENT" : "OK")
  : "BASELINE-SUPERSEDED"
const c2Detail: string[] = c2Cells.map((c) => `${c.cell}: recomputed ${c.recomputed} != published ${c.published}`)

// ── C3: one synthetic source per refusal class, through PRODUCTION parseFile.
// Each source was rewritten after the first run refused to exercise its own
// rung, which is the control working: `var h: struct { f: u8 } = undefined;`
// is NOT an anonymous container — the grammar hands the variable_declaration
// only [identifier, struct_declaration], so the struct IS its last named child,
// the walk publishes `h` as a Struct and `f` as its field, and both are
// correct. An inline struct is anonymous only where it is NOT a declaration's
// RHS, and the only shape that is anonymous while the walk is still in
// declaration scope is a struct used as a FIELD's type.
// The 66-character name likewise was under the 80-character cap, so nothing was
// refused; the cap case needs 81+.
// The 74-character name was under the 80-character cap, so nothing was refused;
// the cap case needs 81+. The length is ASSERTED rather than asserted-in-prose,
// because a control whose fixture silently fails to exercise its own rung is
// the exact failure this file exists to catch.
const CASCADE_NAME = "CascadeOwnerNameThatIsDeliberatelyLongerThanTheEightyCharacterCapOnDeclarationNames"
if (CASCADE_NAME.length <= 80) throw new Error(`C3 owner-cascade fixture name is ${CASCADE_NAME.length} chars, needs > 80`)
const C3: { tag: string; want: Cause; src: string; absent: string }[] = [
  {
    tag: "local-type", want: "local-type", absent: "inner_field",
    src: `fn outer() void {\n    const Local = struct { inner_field: u8 };\n    _ = Local;\n}\n`,
  },
  {
    tag: "anon-container", want: "anon-container", absent: "anon_field",
    src: `const Holder = struct {\n    inline_type: struct { anon_field: u8 },\n};\n`,
  },
  {
    tag: "owner-cascade", want: "owner-cascade", absent: "kept_field",
    src: `const ${CASCADE_NAME} = struct { kept_field: u8 };\n`,
  },
  {
    tag: "keepSymbol", want: "filtered-by-keepSymbol", absent: "this",
    src: `const Denied = enum { this, other };\n`,
  },
]
const c3Detail: string[] = []
let c3Ok = true
for (const c of C3) {
  const abs = path.join("/tmp/opencode", `aomc-c3-${c.tag}.zig`)
  writeFileSync(abs, c.src)
  let published: string[] = []
  try {
    const r = await parseFile(abs, "zig")
    published = ((r as any).symbols ?? []).map((s: any) => s.name)
  } catch (e) {
    c3Detail.push(`C3 ${c.tag}: parseFile threw ${String(e)}`)
    c3Ok = false
    continue
  }
  const tree = parser.parse(c.src)
  const { fields, declSites } = shadowWalk(tree.rootNode)
  const rungs: Cause[] = []
  for (const s of fields) rungs.push(causeOfField(s, true))
  for (const d of declSites) if (d.name) rungs.push(causeOfDecl(d.name, d.nameRefused, d.flags))
  const got = rungs.find((r) => r === c.want) ?? rungs[0] ?? "none"
  if (got !== c.want) { c3Detail.push(`C3 ${c.tag}: classified ${got}, expected ${c.want} (rungs ${JSON.stringify(rungs)})`); c3Ok = false }
  if (published.includes(c.absent)) {
    c3Detail.push(`C3 ${c.tag}: production published ${c.absent}, so the refusal is not exercised`)
    c3Ok = false
  } else c3Detail.push(`C3 ${c.tag}: OK cause=${got} unpublished=${c.absent}`)
}

// ── report
const totalCases = CAUSES.reduce((a, c) => a + causeCases[c], 0)
const totalEdges = CAUSES.reduce((a, c) => a + causeEdges[c], 0)
const byOwner: Record<string, number> = Object.fromEntries(
  [...new Set(CAUSES.map((c) => OWNER[c]))].map((o) => [o, 0]),
)
for (const c of CAUSES) byOwner[OWNER[c]] += causeEdges[c]

const out = {
  populationHash: [...pops][0],
  // What this run READ, recorded beside the population hash because the hash alone
  // cannot date a run: two dump sets over the SAME 3,834 files disagree (C1 66/FAIL
  // vs 0/OK) purely because they were produced by different analyzer commits. See the
  // DUMPS note above.
  dumpsRead: DUMPS,
  dumpsMtime: DUMPS_MTIME,
  shards: shards.length,
  filesInDraw: fileNames.size,
  edgesInDraw: dumps.reduce((a, d) => a + d.edges.length, 0),
  recomputedRungs: recomputed,
  publishedRungs: PUBLISHED,
  analyzerOwnedCases: totalCases,
  analyzerOwnedEdges: totalEdges,
  fieldSitesInAffectedFiles: fieldSites,
  causeOrder: CAUSES,
  causeOwner: OWNER,
  casesByCause: causeCases,
  edgesByCause: causeEdges,
  edgesByCauseAndRung: causeByRung,
  edgesByCauseAndType: causeByType,
  edgesByOwner: byOwner,
  fieldOwnership: { checked: c4Checked, violations: c4Violations, examples: c4Examples.slice(0, 8) },
  fieldsPublishedUnderTheWrongOwner: { count: misattributed, examples: misattributedExamples },
  keepSymbolDeny: { names: ["this", "super"], note: "src/ast/pool-worker.ts:427 UNIVERSAL, applied inside parseFile at :918" },
  filesMissingOnDisk: missingOnDisk,
  examples,
  noSiteDiagnosis: noSiteDiag,
  controls: {
    c1: { checked: c1Checked, violations: c1Violations, ok: c1Violations === 0, examples: c1Examples },
    c2: { state: C2_STATE, ok: C2_STATE === "OK", detail: c2Detail, cells: c2Cells,
          publishedDefinition: PUBLISHED_DEFINITION, dumpDefinition: DUMP_DEFINITION,
          note: "BASELINE-SUPERSEDED and DEFINITION-UNKNOWN mean this control did not RUN a comparison. "
              + "DISAGREEMENT is the only state in which a differing cell is a regression. See the header.", },
    c3: { ok: c3Ok, detail: c3Detail },
    c4: { checked: c4Checked, violations: c4Violations, ok: c4Violations === 0, examples: c4Examples },
  },
}
writeFileSync(OUT, JSON.stringify(out, null, 2))

const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(2)}%`)
console.log(`population ${[...pops][0].slice(0, 14)}…  shards ${shards.length}  files ${fileNames.size}  edges ${out.edgesInDraw}`)
console.log(`analyzer-owned: ${totalCases} (file,name) cases over ${affectedFiles.length} files = ${totalEdges} edges`)
console.log(`field sites in those files: ${fieldSites}`)
console.log("CAUSE                          cases    edges      %   owner")
for (const c of CAUSES) {
  console.log(`  ${c.padEnd(28)} ${String(causeCases[c]).padStart(5)} ${String(causeEdges[c]).padStart(7)} ${pct(causeEdges[c], totalEdges).padStart(8)}   ${OWNER[c]}`)
}
console.log("BY OWNER")
for (const [o, n] of Object.entries(byOwner)) console.log(`  ${o.padEnd(24)} ${String(n).padStart(6)} ${pct(n, totalEdges)}`)
console.log(`C1 published-fields checked ${c1Checked}  violations ${c1Violations}`)
if (c1Examples.length) console.log("  " + c1Examples.slice(0, 5).join("\n  "))
console.log(`C2 recomputed rungs vs published: ${C2_STATE}`)
console.log(`   baseline definition: ${PUBLISHED_DEFINITION}`)
console.log(`   dumps this run read: ${DUMP_DEFINITION === null ? "(no stamp — the converter predates the census change)" : DUMP_DEFINITION}`)
if (C2_STATE === "BASELINE-SUPERSEDED" || C2_STATE === "DEFINITION-UNKNOWN") {
  console.log(C2_STATE === "BASELINE-SUPERSEDED"
    ? "   -> the control did NOT run a comparison: the baseline and these dumps describe"
    : "   -> the control did NOT run a comparison, and for a WEAKER reason than a superseded")
  console.log(C2_STATE === "BASELINE-SUPERSEDED"
    ? "      different columns, so the deltas below are a definition change and not a"
    : "      one: these dumps carry NO definition stamp at all, so which column they hold is")
  console.log(C2_STATE === "BASELINE-SUPERSEDED"
    ? "      regression. It is INACTIVE for rung regressions until it is re-baselined"
    : "      unknown and the comparison below is not evidence of anything. Re-draw the census")
  console.log(C2_STATE === "BASELINE-SUPERSEDED"
    ? "      under the current definition and the control runs again."
    : "      raws so they carry the stamp. It is INACTIVE either way.")
  if (C2_STATE === "BASELINE-SUPERSEDED") {
    console.log("      Re-baselining is NOT done here: the dumps carrying the old definition are four")
    console.log("      generations old, so a re-baseline would replace a number whose provenance is")
    console.log("      known with one that is merely current.")
  }
}
if (C2_STATE === "DISAGREEMENT") {
  console.log("   -> the definitions AGREE and a cell differs. This is a real regression and the")
  console.log("      control is doing the only thing it is for.")
}
if (c2Cells.length) {
  console.log(`   ${c2Cells.length} cell(s) differ:`)
  console.log("  " + c2Detail.join("\n  "))
}
console.log(`C3 synthetic refusal classes: ${c3Ok ? "OK" : "FAIL"}`)
for (const d of c3Detail) console.log("  " + d)
console.log(`C4 field-owner agreement: checked ${c4Checked}  violations ${c4Violations}`)
if (c4Examples.length) console.log("  " + c4Examples.slice(0, 5).join("\n  "))
console.log(`C5 field-kind agreement: checked ${c5Checked}  violations ${c5Violations}  (file-level sites NOT covered ${c5FileLevelSites} of ${c5FileLevelUncovered} candidate sites)`)
// WHAT THIS RUN READ, printed and recorded. The two runs quoted in the DUMPS note
// above claim the SAME population hash and disagree because they read different code,
// so the draw identity alone cannot date a run — the dump directory's own mtime and
// the shard count can, and both are cheap to print.
console.log(`dumps read: ${DUMPS}  (mtime ${DUMPS_MTIME}, ${shards.length} shards, population ${[...pops][0]?.slice(0, 12) ?? "?"})`)
if (c5Examples.length) console.log("  " + c5Examples.slice(0, 5).join("\n  "))
console.log(`fields published under the wrong owner: ${misattributed}`)
if (misattributedExamples.length) console.log("  " + misattributedExamples.slice(0, 4).join("\n  "))
if (missingOnDisk.length) console.log(`NOTE ${missingOnDisk.length} affected files absent from disk: ${missingOnDisk.slice(0, 4).join(", ")}`)
console.log(`wrote ${OUT}`)
// Exit 1 = a control RAN and found something. Exit 2 = a control could not run
// (C2's baseline is superseded, or C1/C3/C4/C5 found a violation). The two are
// deliberately distinct: a control that cannot run must not be reported with the
// same code as a control that ran and failed, or a reader cannot tell which
// happened without parsing the text.
if (C2_STATE === "BASELINE-SUPERSEDED" || C2_STATE === "DEFINITION-UNKNOWN") {
  if (c1Violations || !c3Ok || c4Violations || c5Violations) process.exit(1)
  console.log("\nEXIT 2: C2 did not run. It is not a pass and not a failure; it is inactive.")
  console.log("       Every other control above ran and is reported on its own line.")
  process.exit(2)
}
if (c1Violations || c2Detail.length || !c3Ok || c4Violations || c5Violations) process.exit(1)