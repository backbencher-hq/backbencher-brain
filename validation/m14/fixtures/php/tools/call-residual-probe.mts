/**
 * CALL RESIDUAL PROBE — php's `calls` residual, end to end, over the whole admitted population.
 *
 * ## Why this exists
 *
 * After the variable-read binding fix the lane's residual is 27.6% (96,570 of 349,236) and the NEXT
 * largest named cause is `calls`: `calls/phpSpecific` 47,902 and `calls/owner+phpSpecific` 43,641 in
 * the marker partition, whose unresolved and ambiguous columns are the largest left. A marker set
 * says which EMISSION SITE produced an edge; it does not say what the edge is DOING, and the
 * disposition available to the lane differs completely by receiver class:
 *
 *   * a call the tree TYPES (`$this->m()`, `self::m()`, `Foo::m()`) whose member the file itself
 *     declares is already re-spelled by `qualifyProvenMemberTargets` — such an edge still reading
 *     amb/unres is a MISS of that rule and a defect;
 *   * a call the tree types whose member is declared on an ANCESTOR THE SAME FILE DECLARES is
 *     provable per-file and is NOT re-spelled today — a candidate, and its size is what decides;
 *   * a call whose receiver the tree does not type (`$obj->m()`) is the type-inference wall this
 *     lane has RULED, and no name-keyed rule reaches it.
 *
 * Those three are indistinguishable in the marker table. This probe separates them, with counts, on
 * the production path, and DUMPS the rows so the partition can be re-cut offline without re-walking
 * 5,094 files (the walk is the expensive step, the grouping is not).
 *
 * ## The acceptance test comes first (a probe that cannot reproduce the gate is evidence about the
 *    probe)
 *
 * The gate's TABLE 1 is parsed out of a gate log (`BB_GATE_LOG`) and compared COLUMN BY COLUMN
 * against this walk, all 14 columns of all 10 types. Nothing below is read until that check prints,
 * and a mismatch prints the per-column deltas.
 *
 * ## The classifier's own reachability (§6.11: a zero is evidence only if the predicate could have
 *    returned non-zero)
 *
 * `R2-sameFileAncestorDeclares` is the class a candidate fix would move. A classifier reporting it
 * 0 because its own rule cannot fire would be a property of the PROBE. So it is self-tested first,
 * on constructed two-file projects: a same-file ancestor (positive — must fire), a cross-file
 * ancestor (negative control — must NOT fire), and a same-file trait (positive). All three print
 * PASS/FAIL, with the outcome, owner, shape and reach they produced, before any corpus number.
 *
 * Usage:
 *   BB_GATE_LOG=.tmp-php/gate-head-before-calls.log \
 *   BB_DUMP=.tmp-php/calls-before.json \
 *   npx tsx validation/m14/fixtures/php/tools/call-residual-probe.mts
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const GATE_LOG = process.env.BB_GATE_LOG ?? path.join(ROOT, ".tmp-php/gate-head-before-calls.log")
const DUMP = process.env.BB_DUMP ?? ""
const SIZE_CAP = 1024 * 1024
const ST = path.join(ROOT, ".tmp-php/call-probe-selftest")

const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
const { classifyEdge, externalClaimOf, isContainsEdge, emptyOutcomes, tally } = await import(
  path.join(ROOT, "script/m14/incoming-rule.ts")
)

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]

// ── THE SHAPE OF A CALL SITE, read from the source line the edge is stamped with ────────────────
//
// `metadata` cannot answer this: `processMethodCall` and `processFunctionCall` both emit
// `{phpSpecific: true}` when no owner was derived, so an owner-less `calls` edge may be either.
// The LINE the analyzer stamped the edge with does answer it, and the classifier is CONTROLLED
// below against a known-positive population — every edge carrying `metadata.owner` must read as a
// member or scoped call from its line and never `bare` — so a mis-parse is counted, not trusted.
type Shape = { shape: string; receiver: string; written: string }

function classifyShape(line: string, leaf: string): Shape {
  const shapes = new Set<string>()
  const receivers = new Set<string>()
  /** THE NAMESPACE THE SOURCE LINE WRITES ON THE CALLEE, when it writes one.
   *
   *  `phpStaticCallableName` returns the LEAF of a `qualified_name`, so `\App\Foo\bar()` and
   *  `bar()` both emit the target `bar` — the namespace is DESTROYED at emission. The line still
   *  carries it, so the probe recovers it here and prices the counterfactual target
   *  (FQN-as-written) against the project's own key space WITHOUT changing the analyzer. */
  let written = ""
  if (leaf.length === 0) return { shape: "no-leaf", receiver: "", written: "" }
  let idx = 0
  while ((idx = line.indexOf(leaf, idx)) >= 0) {
    const end = idx + leaf.length
    // a CALL is the name followed by `(` — a property read `$x->m` is a different edge type
    if (!/^\s*\(/.test(line.slice(end))) { idx = end; continue }
    const prev = idx > 0 ? line[idx - 1]! : ""
    // A NAMESPACE SEPARATOR IS NOT A WORD CHARACTER. The first version of this guard rejected a
    // name preceded by `\` as the tail of a longer identifier, so `\App\Helpers\wrangle($x)` —
    // THE ENTIRE CLASS `F1-writtenNamespaceOnCallee` EXISTS TO MEASURE — read `not-on-line` and
    // would have been reported as 0. Caught by the constructed self-test below, not by reading.
    if (/[A-Za-z0-9_$]/.test(prev)) { idx = end; continue }
    const before = line.slice(0, idx)
    let shape: string
    let recv = ""
    const questionArrow = before.endsWith("?->")
    const arrow = !questionArrow && before.endsWith("->")
    if (questionArrow || arrow) {
      const m = /([A-Za-z0-9_$\\>\]'"]+)(?:\?->|->)$/.exec(before)
      recv = m ? m[1]! : ""
      const kind = recv === "$this" ? "this" : recv.startsWith("$") ? "var" : recv.length === 0 ? "expr" : "expr"
      shape = (questionArrow ? "nullsafe" : "method") + ":" + kind
    } else if (before.endsWith("::")) {
      const m = /([A-Za-z0-9_$\\]+)::$/.exec(before)
      recv = m ? m[1]! : ""
      shape = "static:" + (recv === "self" || recv === "static" ? "self" : recv === "parent" ? "parent" : recv.length === 0 ? "expr" : "named")
    } else {
      // A FUNCTION CALL STILL SAYS WHERE IT LIVES, and the analyzer throws that away:
      // `phpStaticCallableName` returns the LEAF of a `qualified_name`, so `\App\Foo\bar()` and
      // `bar()` emit the same target `bar`. The line distinguishes them, so the probe records it.
      const m = /((?:[A-Za-z_][A-Za-z0-9_]*\\)+)$/.exec(before)
      const qualified = m !== null || /\\$/.test(before)
      shape = qualified ? "bare:namespace-written" : "bare"
      if (qualified && m) written = m[1]! + leaf
    }
    shapes.add(shape)
    receivers.add(recv)
    idx = end
  }
  if (shapes.size === 0) return { shape: "not-on-line", receiver: "", written: "" }
  if (shapes.size > 1) return { shape: "mixed", receiver: [...receivers].join("|"), written }
  return { shape: [...shapes][0]!, receiver: [...receivers][0] ?? "", written }
}

/**
 * `use function <FQN> [as <alias>];` — the FQN the FILE states for a local function name.
 *
 * PHP resolves an imported function name to the imported FQN, and a `use` import is ABSOLUTE
 * (PHP's own rule: "import names must be fully qualified, and are not processed relative to the
 * current namespace"), so no namespace prefixing is applied here.
 *
 * THIS IS A PROBE-SIDE SCAN and it is disclosed as one: the analyzer does not record whether a
 * `use` clause is a FUNCTION import (`emitUseClause` writes `{phpSpecific, aliased, grouped}` and
 * no flag), so the population cannot be read out of its output today. It is SELF-TESTED below on a
 * constructed file (positive and negative) rather than trusted.
 */
function parseUseFunction(text: string): Map<string, string> {
  const out = new Map<string, string>()
  if (!text.includes("use function")) return out
  const re = /(?:^|\n)[ \t]*use[ \t]+function[ \t]+([^;]+);/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    let body = m[1]!.trim()
    let prefix = ""
    const brace = body.indexOf("{")
    if (brace >= 0) {
      prefix = body.slice(0, brace).replace(/\\+$/, "") + "\\"
      body = body.slice(brace + 1).replace(/}\s*$/, "")
    }
    for (const raw of body.split(",")) {
      const part = raw.trim()
      if (!part) continue
      const as = /^(.*?)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/i.exec(part)
      const fqn = (prefix + (as ? as[1]! : part).trim()).replace(/^\\+/, "")
      if (!fqn) continue
      const leaf = fqn.slice(fqn.lastIndexOf("\\") + 1)
      out.set(as ? as[2]! : leaf, fqn)
    }
  }
  return out
}

/** Ancestors of each class DECLARED IN THIS FILE — `extends` targets and trait `use` targets. */
function ancestorsInFile(rels: any[], syms: any[]): Map<string, Set<string>> {  const declared = new Set<string>(syms.map((s: any) => String(s.name ?? "")))
  const direct = new Map<string, Set<string>>()
  const add = (a: string, b: string) => { if (!a || !b) return; let s = direct.get(a); if (!s) direct.set(a, (s = new Set())); s.add(b) }
  for (const r of rels) {
    const label = String(r.type ?? r.relationshipType ?? "")
    const md = (r.metadata ?? {}) as any
    if (label === "extends") add(String(r.source ?? ""), String(r.target ?? ""))
    else if (label === "uses" && md.isTraitUse === true) add(String(r.source ?? ""), String(r.target ?? ""))
  }
  const out = new Map<string, Set<string>>()
  for (const c of declared) {
    const set = new Set<string>()
    let frontier = [...(direct.get(c) ?? [])]
    let depth = 0
    while (frontier.length && depth < 10) {
      const next: string[] = []
      for (const a of frontier) {
        if (a === c || set.has(a)) continue
        set.add(a)
        for (const b of direct.get(a) ?? []) if (!set.has(b) && b !== c) next.push(b)
      }
      frontier = next
      depth++
    }
    out.set(c, set)
  }
  return out
}

/** THE CLASSES. Each one is a statement about what a name-keyed rule can DO with the edge. */
function reachClass(x: { owner: string; tgt: string; fileMembers: Set<string>; declaredHere: Set<string>; anc: Map<string, Set<string>>; shape: string; fnImports: Map<string, string> }): { reach: string; ancestor: string; ancestorCount: number } {
  const { owner, tgt } = x
  if (owner) {
    if (x.fileMembers.has(`${owner}.${tgt}`)) return { reach: "R1-ownFileOwnerMember", ancestor: "", ancestorCount: 0 }
    const hits = [...(x.anc.get(owner) ?? [])].filter((a) => x.fileMembers.has(`${a}.${tgt}`))
    // THE MULTIPLICITY DECIDES PROVABILITY, and the first version of this classifier threw it away by
    // returning the first set member. PHP resolves a member through the chain to the NEAREST
    // declaration, so `Child extends A` + `Child extends B` (or a trait beside a parent) with BOTH
    // declaring the member is NOT provable by a set-membership test — and a set iteration order is
    // not a resolution order. `ancestorCount` is what separates "one ancestor declares it, so the
    // qualified spelling is exactly one declaration" from "two do, so a rewrite would be a GUESS".
    if (hits.length === 1) return { reach: "R2-sameFileAncestorDeclares", ancestor: hits[0]!, ancestorCount: 1 }
    if (hits.length > 1) return { reach: "R2b-multipleSameFileAncestorsDeclare", ancestor: hits.join("|"), ancestorCount: hits.length }
    if (x.declaredHere.has(tgt)) return { reach: "R3-targetDeclaredInOwnFileOtherOwner", ancestor: "", ancestorCount: 0 }
    return { reach: "R4-noFileDeclaresOwnerMember", ancestor: "", ancestorCount: 0 }
  }
  // OWNER-LESS. `processFunctionCall` emits no owner at all, and `processMethodCall` emits none
  // when the receiver's class is not stated by the tree — so the SHAPE decides which it is.
  if (x.shape === "bare:namespace-written") return { reach: "F1-writtenNamespaceOnCallee", ancestor: "", ancestorCount: 0 }
  if (x.shape === "bare" && x.fnImports.has(tgt)) return { reach: "F2-useFunctionImport", ancestor: x.fnImports.get(tgt) ?? "", ancestorCount: 0 }
  if (x.shape.startsWith("method:this") || x.shape.startsWith("static:self") || x.shape.startsWith("static:parent")) {
    return { reach: "F0-ownerlessButTreeStatesReceiver", ancestor: "", ancestorCount: 0 }
  }
  if (x.shape === "bare") return { reach: "F3-plainUnqualifiedFunctionCall", ancestor: "", ancestorCount: 0 }
  return { reach: "F9-ownerless-untypedReceiver", ancestor: "", ancestorCount: 0 }
}

type Row = {
  t: string; rel: string; line: number; src: string; tgt: string; owner: string
  marker: string; outcome: string; shape: string; receiver: string
  declCount: number; declKinds: string; declFiles: number
  srcOwner: string; reach: string; ancestor: string; lineText: string
  /** how many in-file ancestors declare `<a>.<target>` — 1 makes the qualified spelling provable */
  ancestorCount: number
  /** THE STORE'S RULE-0 PATH: `metadata.owner` IS the source's own class, so
   *  `claimOwnerCarryingTargets` derives the owner id by IDENTITY (`member-owner-resolution.ts:357`)
   *  and a same-named class elsewhere in the project cannot make the owner a guess. */
  ownerIsSrcOwner: boolean
  /** THE COUNTERFACTUAL TARGET: the FQN the SOURCE LINE writes on the callee, when it writes one
   *  (`\App\Helpers\wrangle(` -> `App\Helpers\wrangle`). Empty when the line states no namespace. */
  writtenFqn: string
  /** would that counterfactual target name exactly one declaration in THIS PROJECT's key space? */
  writtenFqnResolves: boolean
  /** would the FQN the FILE's own `use function` clause states resolve? */
  importFqn: string
  importFqnResolves: boolean
}

const dirOuts = new Map<string, ReturnType<typeof emptyOutcomes>>()
const dirEdges = new Map<string, number>()
for (const t of ALL_TYPES) { dirOuts.set(t, emptyOutcomes()); dirEdges.set(t, 0) }

/**
 * THE FILES THAT RETURNED NOTHING — every one of them, classified, not the gate's first five.
 *
 * `incoming-gate.ts` counts them and prints its first five with a `?????` kind, and the count is
 * ONE counter over populations that mean opposite things: a 0-byte file leaves the population
 * COMPLETE, a timed-out one puts a HOLE in it. The instrument says so and then cannot tell them
 * apart. This walk parses every file anyway, so the split costs nothing here — and the
 * classification is read from the PARSE RESULT (symbols, relationships, `errors`), not from a
 * second copy of the instrument's rule.
 */
const emptyFiles: { rel: string; bytes: number; kind: string; detail: string }[] = []

/** Parse one project (a list of absolute paths under `root`), build its key space, and process
 *  every edge with the SHARED rule. The self-test and the corpus walk both call THIS, so the two
 *  cannot become two spellings of one rule. */
async function analyzeProject(files: string[], root: string, wantRows: boolean): Promise<{ rows: Row[]; parsed: number; agg: Map<string, number>; memberKeys: Set<string> }> {
  const rows: Row[] = []
  const agg = new Map<string, number>()
  const bump = (k: string, n = 1) => agg.set(k, (agg.get(k) ?? 0) + n)
  const memberKeys = new Set<string>()
  const decl = new Map<string, number>()
  const kinds = new Map<string, Set<string>>()
  const declFiles = new Map<string, Set<string>>()
  const walk = (s: any, abs: string) => {
    const n = String(s.name ?? "")
    if (!n) return
    const add = (key: string) => {
      decl.set(key, (decl.get(key) ?? 0) + 1)
      let ks = kinds.get(key); if (!ks) kinds.set(key, (ks = new Set())); ks.add(String(s.kind ?? ""))
      let fs = declFiles.get(key); if (!fs) declFiles.set(key, (fs = new Set())); fs.add(abs)
    }
    add(n)
    const q = String(s.qualifiedName ?? "")
    if (q && q !== n) add(q)
    if (s.ownerName) memberKeys.add(`${s.ownerName}.${n}`)
  }
  const cached: { abs: string; rels: any[]; syms: any[] }[] = []
  let parsed = 0
  for (const abs of files) {
    let res: any
    let text = ""
    try { text = readFileSync(abs, "utf8") } catch { continue }
    try { res = await parseFile(abs, root, { projectRoot: root } as any) } catch { continue }
    parsed++
    // ── the empty-result census, classified from the parse result itself ──────────────────────
    if (!abs.startsWith(ST)) {
      const symsN = (res.symbols ?? []).length
      const relsN = (res.relationships ?? []).length
      if (symsN === 0 && relsN === 0) {
        const bytes = Buffer.byteLength(text)
        const errs = (res.errors ?? []).length
        const meaningful = text.replace(/<\?php/gi, "").replace(/<\?=/g, "").replace(/\?>/g, "")
        const noComments = meaningful.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\n)\s*(\/\/|#)[^\n]*/g, "")
        const kind = text.trim().length === 0 ? "contentless-empty"
          : noComments.trim().length === 0 ? "contentless-comments-only"
          : errs > 0 ? "HOLE-parse-errors"
          : "DECLINES-nothing-to-declare-or-declined"
        emptyFiles.push({ rel: path.relative(CR, abs), bytes, kind, detail: errs > 0 ? `${errs} parse error(s)` : noComments.trim().slice(0, 60).replace(/\s+/g, " ") })
      }
    }
    for (const s of res.symbols ?? []) walk(s, abs)
    cached.push({ abs, rels: res.relationships ?? [], syms: res.symbols ?? [] })
  }
  const facts = { packages: new Set<string>(), files: new Set(files.map((f) => path.relative(root, f).split(path.sep).join("/"))), sdkLib: false }
  for (const { abs, rels, syms } of cached) {
    const rel = path.relative(CR, abs)
    const fileMembers = new Set<string>()
    for (const s of syms) if (s.ownerName) fileMembers.add(`${s.ownerName}.${s.name}`)
    const declaredHere = new Set<string>(syms.map((s: any) => String(s.name ?? "")))
    const symOwner = new Map<string, string>()
    for (const s of syms) if (s.ownerName && !symOwner.has(String(s.name))) symOwner.set(String(s.name), String(s.ownerName))
    const anc = ancestorsInFile(rels, syms)
    const text = readFileSync(abs, "utf8")
    const lines = text.split("\n")
    const fnImports = parseUseFunction(text)
    for (const r of rels) {
      const label = String(r.type ?? r.relationshipType ?? "")
      if (!ALL_TYPES.includes(label)) continue
      const tgt = String(r.target ?? r.to ?? r.toSymbol ?? "")
      // THE EDGE COUNT IS TAKEN BEFORE THE EMPTY-TARGET SKIP, exactly as the gate does
      // (`incoming-gate.ts:895` increments `row.edges` and only THEN tests `tgt.length === 0`). The
      // first version of this probe skipped first, so its `edges` column would have been short by
      // every empty-target edge and the acceptance check would have reported a corpus mismatch that
      // was really a probe-side off-by-one.
      dirEdges.set(label, (dirEdges.get(label) ?? 0) + 1)
      if (!tgt) continue
      const md = (r.metadata ?? {}) as any
      const pc = classifyEdge(decl, kinds, tgt, externalClaimOf(r), facts as any, isContainsEdge(label))
      tally(dirOuts.get(label)!, pc, tgt, label)
      if (label !== "calls") continue
      const leaf = tgt.includes(".") ? tgt.slice(tgt.lastIndexOf(".") + 1) : tgt
      const line = lines[Number(r.line_number ?? 0) - 1] ?? ""
      const shape = classifyShape(line, leaf)
      const owner = typeof md.owner === "string" ? md.owner : ""
      const rc = reachClass({ owner, tgt, fileMembers, declaredHere, anc, shape: shape.shape, fnImports })
      const marker = Object.keys(md).filter((k) => k !== "evidenceClass" && k !== "analysisVersion" && md[k] !== false && md[k] != null).sort().join("+") || "(no marker)"
      const outcome = pc.outcome === "ambDeclOnly" || pc.outcome === "ambBoth" ? "amb"
        : pc.outcome === "resolved" ? "resolved"
        : pc.outcome === "externalVerified" || pc.outcome === "externalUnverified" ? "ext"
        : pc.outcome.startsWith("binding") ? "binding"
        : pc.outcome.startsWith("cause") ? "cause" : "unres"
      // THE COUNTERFACTUAL, priced against THIS PROJECT's key space and not against a guess: the
      // declaration count of the FQN the line writes (or the file's own `use function` clause names).
      // An empty string means the edge states no namespace, so there is nothing to keep.
      const writtenFqn = shape.written
      const importFqn = fnImports.get(tgt) ?? ""
      const srcOwner = symOwner.get(String(r.source ?? "")) ?? ""
      // THE SHAPE CLASSIFIER'S OWN KNOWN-POSITIVE POPULATION: an edge carrying `metadata.owner`
      // whose shape reads `bare` is a mis-parse (or a tear-off), counted so the classifier is
      // never trusted silently.
      if (owner && shape.shape === "bare") bump("SHAPE-CONTROL owner present but line reads bare")
      if (owner) bump(`SHAPE-CONTROL owner present, shape ${shape.shape}`)
      if (!owner && (shape.shape === "method:this" || shape.shape === "static:self" || shape.shape === "static:parent")) bump("OWNERLESS-BUT-TREE-STATES-RECEIVER")
      if (owner && owner === srcOwner) bump("STORE-RULE-0 owner IS the source's own class (identity, not a name lookup)")
      if (wantRows) rows.push({
        t: label, rel, line: Number(r.line_number ?? 0), src: String(r.source ?? ""), tgt, owner,
        marker, outcome, shape: shape.shape, receiver: shape.receiver,
        declCount: decl.get(tgt) ?? 0, declKinds: [...(kinds.get(tgt) ?? [])].sort().join("|"),
        declFiles: declFiles.get(tgt)?.size ?? 0,
        srcOwner, reach: rc.reach, ancestor: rc.ancestor, lineText: line.trim().slice(0, 160),
        ancestorCount: rc.ancestorCount,
        ownerIsSrcOwner: owner !== "" && owner === srcOwner,
        writtenFqn,
        writtenFqnResolves: writtenFqn !== "" && (decl.get(writtenFqn) ?? 0) === 1,
        importFqn,
        importFqnResolves: importFqn !== "" && (decl.get(importFqn) ?? 0) === 1,
      })
    }
  }
  return { rows, parsed, agg, memberKeys }
}

const out = (s: string) => console.log(s)

// ── SELF-TEST FIRST, printed even when it fails ─────────────────────────────────────────────────
type StCase = { name: string; files: { rel: string; text: string }[]; want: string; wantNot?: string }
const SELFTEST_CASES: StCase[] = [
  {
    name: "positive — Child extends Base, BOTH in one file; Other::run() in another",
    files: [
      { rel: "child.php", text: `<?php\nnamespace Probe;\nclass Base { public function run() { return 1; } }\nclass Child extends Base { public function go() { return $this->run(); } }\n` },
      { rel: "other.php", text: `<?php\nnamespace Probe;\nclass Other { public function run() { return 2; } }\n` },
    ],
    want: "R2-sameFileAncestorDeclares",
  },
  {
    name: "NEGATIVE CONTROL — Child2 extends Base2, Base2 declared in ANOTHER file",
    files: [
      { rel: "child2.php", text: `<?php\nnamespace Probe2;\nclass Child2 extends Base2 { public function go() { return $this->run(); } }\n` },
      { rel: "base2.php", text: `<?php\nnamespace Probe2;\nclass Base2 { public function run() { return 1; } }\n` },
      { rel: "other2.php", text: `<?php\nnamespace Probe2;\nclass Other2 { public function run() { return 2; } }\n` },
    ],
    want: "R4-noFileDeclaresOwnerMember",
    wantNot: "R2-sameFileAncestorDeclares",
  },
  {
    name: "positive — trait `use` inside the same file (the same seam as extends)",
    files: [
      { rel: "trait.php", text: `<?php\nnamespace Probe3;\ntrait Helper { public function run() { return 1; } }\nclass User { use Helper; public function go() { return $this->run(); } }\n` },
      { rel: "other3.php", text: `<?php\nnamespace Probe3;\nclass Other3 { public function run() { return 2; } }\n` },
    ],
    want: "R2-sameFileAncestorDeclares",
  },
  {
    name: "positive — `use function` import: the FILE states the FQN of the callee",
    files: [
      { rel: "imported.php", text: `<?php\nnamespace Probe4;\nuse function App\\Helpers\\mangle;\nclass Caller { public function go($x) { return mangle($x); } }\n` },
      { rel: "declared.php", text: `<?php\nnamespace App\\Helpers;\nfunction mangle($x) { return $x; }\n` },
      { rel: "other4.php", text: `<?php\nnamespace Other4;\nfunction mangle($x) { return $x + 1; }\n` },
    ],
    want: "F2-useFunctionImport",
  },
  {
    name: "positive — the callee is WRITTEN with a namespace; the analyzer emits the leaf today",
    files: [
      { rel: "written.php", text: `<?php\nnamespace Probe5;\nclass Caller5 { public function go($x) { return \\App\\Helpers\\wrangle($x); } }\n` },
      { rel: "declared5.php", text: `<?php\nnamespace App\\Helpers;\nfunction wrangle($x) { return $x; }\n` },
      { rel: "other5.php", text: `<?php\nnamespace Other5;\nfunction wrangle($x) { return $x + 1; }\n` },
    ],
    want: "F1-writtenNamespaceOnCallee",
  },
  {
    name: "NEGATIVE CONTROL — a plain unqualified call states NO namespace and imports nothing",
    files: [
      { rel: "plain.php", text: `<?php\nnamespace Probe6;\nclass Caller6 { public function go($x) { return smangle($x); } }\n` },
      { rel: "declared6.php", text: `<?php\nnamespace App\\Helpers;\nfunction smangle($x) { return $x; }\n` },
      { rel: "other6.php", text: `<?php\nnamespace App\\Helpers2;\nfunction smangle($x) { return $x + 1; }\n` },
    ],
    want: "F3-plainUnqualifiedFunctionCall",
    wantNot: "F2-useFunctionImport",
  },
]

out(`php CALL RESIDUAL PROBE — whole admitted population (production path)`)
out(`\nSELF-TEST — the reach classifier on constructed inputs (§6.11: a class reported 0 must be shown able to fire):`)
mkdirSync(ST, { recursive: true })
let stFail = 0
let stEdgeCount = 0
for (const c of SELFTEST_CASES) {
  for (const f of c.files) writeFileSync(path.join(ST, f.rel), f.text)
  const res = await analyzeProject(c.files.map((f) => path.join(ST, f.rel)), ST, true)
  stEdgeCount = res.rows.length
  const got = res.rows.length === 1 ? res.rows[0]! : null
  const rc = got ? got.reach : "NO-SINGLE-CALLS-EDGE"
  const ok = rc === c.want && (!c.wantNot || rc !== c.wantNot)
  if (!ok) stFail++
  out(`  ${ok ? "PASS" : "** FAIL **"}  want ${c.want}${c.wantNot ? ` (and NOT ${c.wantNot})` : ""}`)
  out(`         got  ${rc}${got ? `   [outcome ${got.outcome} · owner ${got.owner || "(none)"} · shape ${got.shape} · ancestor ${got.ancestor || "-"} · ${got.src} -> ${got.tgt}]` : `   [${res.rows.length} calls edge(s) in this constructed project]`}`)
  out(`         case: ${c.name}`)
}
out(`  ${stFail === 0 ? ">>> THE CLASSIFIER CAN FIRE AND CAN DECLINE — the classes below are a measurement, not a probe property." : ">>> THE CLASSIFIER FAILED ITS OWN SELF-TEST — every count below is evidence about THIS PROBE."}`)
// THE SELF-TEST'S OWN EDGES MUST NOT REACH THE ACCEPTANCE TOTALS. `analyzeProject` tallies into
// the module-level `dirOuts`/`dirEdges`, and the three constructed projects contribute 3 `calls`
// edges and 24 edges in total — which the FIRST version of this probe left in place, so the
// acceptance check compared the CORPUS against the gate PLUS THE SELF-TEST and printed
// `calls edges-103187` against a gate row of 103,190. The delta was the probe's own scaffolding,
// and it would have read as a corpus mismatch. Reset here, before any corpus file is parsed.
for (const t of ALL_TYPES) { dirOuts.set(t, emptyOutcomes()); dirEdges.set(t, 0) }
void stEdgeCount

// ── the population: the gate's own discovery, reproduced (git-tracked, present, under the cap) ──
const repos: { repo: string; files: string[] }[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  const files: string[] = []
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".php")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    files.push(abs)
  }
  files.sort()
  if (files.length > 0) repos.push({ repo: dir, files })
}

const allRows: Row[] = []
const aggAll = new Map<string, number>()
let parsedTotal = 0
for (const { repo, files } of repos) {
  const res = await analyzeProject(files, repo, true)
  parsedTotal += res.parsed
  for (const r of res.rows) allRows.push(r)
  for (const [k, v] of res.agg) aggAll.set(k, (aggAll.get(k) ?? 0) + v)
}
out(`\npopulation: ${parsedTotal} files parsed across ${repos.length} repos`)

// ── the empty-result census, NAMED in full and classified ───────────────────────────────────────
{
  const byKind = new Map<string, number>()
  for (const f of emptyFiles) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1)
  out(`\nFILES THAT RETURNED NO SYMBOLS AND NO RELATIONSHIPS: ${emptyFiles.length} (ALL of them named below; the gate names its first five and calls the kind UNKNOWN)`)
  for (const [k, n] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) out(`  ${String(n).padStart(5)}  ${k}`)
  for (const f of emptyFiles) out(`    ${f.kind.padEnd(38)} ${String(f.bytes).padStart(7)} B  ${f.rel}${f.detail ? `   [${f.detail}]` : ""}`)
  out(`  ^ "contentless-*" leaves the population COMPLETE (nothing was there to extract); a "HOLE-*"`)
  out(`    kind would put a hole in it. The classification is the parse result's own, not a rule copy.`)
}

// ── the acceptance check, before any partition is read ──────────────────────────────────────────
const cols = ["edges", "resolved", "collRes", "amb", "ambKind", "unres", "extOK", "extQ", "extFAIL", "bindOK", "bindQ", "bindFAIL", "causeOK", "causeFAIL"]
const gate = new Map<string, number[]>()
{
  let text = ""
  try { text = readFileSync(GATE_LOG, "utf8") } catch { text = "" }
  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 15) continue
    if (!ALL_TYPES.includes(parts[0]!) && parts[0] !== "TOTAL") continue
    const nums = parts.slice(1, 15).map((x) => Number(x.replace(/,/g, "")))
    if (nums.some((n) => !Number.isFinite(n))) continue
    gate.set(parts[0]!, nums)
  }
}
const mineOf = (t: string): number[] => {
  const o = dirOuts.get(t)!
  return [dirEdges.get(t) ?? 0, o.resolved, o.resolvedAmongCollision, o.ambiguousByDecl, o.ambiguousByKind, o.unresolved, o.externalVerified, o.externalUnverified, o.externalRefuted, o.bindingVerified, o.bindingUnverified, o.bindingRefuted, o.causeDeclared, o.causeRefuted]
}
out(`\nACCEPTANCE — this walk vs the gate's own TABLE 1 (${path.relative(ROOT, GATE_LOG)}):`)
let allExact = gate.size > 0
for (const t of ALL_TYPES) {
  const g = gate.get(t)
  const mine = mineOf(t)
  if (!g) { out(`  ${t.padEnd(14)} NO GATE ROW`); allExact = false; continue }
  const diff = mine.map((v, i) => v - g[i]!)
  const exact = diff.every((d) => d === 0)
  if (!exact) allExact = false
  out(`  ${t.padEnd(14)} ${exact ? "EXACT" : diff.map((d, i) => (d === 0 ? "" : `${cols[i]}${d > 0 ? "+" : ""}${d}`)).filter(Boolean).join(" ")}`)
}
{
  const g = gate.get("TOTAL")
  if (g) {
    const sum = ALL_TYPES.map((t) => mineOf(t))
    const tot = sum.reduce((a, m) => m.map((v, i) => (a[i] ?? 0) + v), [] as number[])
    const diff = tot.map((v, i) => v - g[i]!)
    const exact = diff.every((d) => d === 0)
    if (!exact) allExact = false
    out(`  ${"TOTAL".padEnd(14)} ${exact ? "EXACT" : diff.map((d, i) => (d === 0 ? "" : `${cols[i]}${d > 0 ? "+" : ""}${d}`)).filter(Boolean).join(" ")}`)
  }
}
out(`  ${allExact ? ">>> THE WALK REPRODUCES THE GATE'S TABLE 1 EXACTLY — the partition below is the gate's own." : ">>> MISMATCH — THE PARTITION BELOW IS EVIDENCE ABOUT THIS PROBE, NOT THE LANE."}`)

// ── the calls residual, cut four ways ───────────────────────────────────────────────────────────
const residual = allRows.filter((r) => r.outcome === "amb" || r.outcome === "unres")
out(`\ncalls edges: ${allRows.length}   residual (amb+unres): ${residual.length}   resolved ${allRows.filter((r) => r.outcome === "resolved").length}   extClaim ${allRows.filter((r) => r.outcome === "ext").length}   binding ${allRows.filter((r) => r.outcome === "binding").length}   cause ${allRows.filter((r) => r.outcome === "cause").length}`)

const cut = (title: string, key: (r: Row) => string) => {
  const m = new Map<string, { n: number; amb: number; unres: number }>()
  for (const r of residual) {
    const k = key(r)
    let b = m.get(k); if (!b) m.set(k, (b = { n: 0, amb: 0, unres: 0 }))
    b.n++; if (r.outcome === "amb") b.amb++; else b.unres++
  }
  out(`\n${title}`)
  for (const [k, b] of [...m.entries()].sort((a, b) => b[1].n - a[1].n)) {
    out(`  ${String(b.n).padStart(8)}  amb ${String(b.amb).padStart(7)}  unres ${String(b.unres).padStart(7)}   ${k}`)
  }
  return m
}

cut("CUT 1 — calls residual by MARKER SET (which emission site):", (r) => r.marker || "(none)")
cut("CUT 2 — calls residual by RECEIVER SHAPE (read from the edge's own source line):", (r) => r.shape)
cut("CUT 3 — calls residual by REACH CLASS (what a name-keyed rule can do with it):", (r) => r.reach)
cut("CUT 4 — calls residual by OWNER PRESENCE x SHAPE:", (r) => `${r.owner ? "owner" : "NO-owner"} · ${r.shape}`)
// THE STORE'S OWN PATH, which the incoming gate does not model at all. `member-owner-resolution.ts`
// withdraws EVERY owner-carrying calls/uses row from the insert-time rank and re-decides it:
//   * :357 — when `metadata.owner` IS the source's own class the owner id is the SOURCE SYMBOL's id,
//            so a same-named class elsewhere in the project cannot make the owner a guess (Rule 0);
//   * :360 — otherwise the owner NAME is looked up in the project and TWO matches DECLINE (Rule 1);
//   * :396 — the owner's own member table, then :436 the ancestor chain, one candidate required.
// So an owner-carrying edge the gate calls `amb(decl)` is not necessarily unresolved in production,
// and the two halves must be counted separately before either is called a defect.
cut("CUT 5 — calls residual in the OWNER CHANNEL by the STORE's own path:", (r) => `${r.ownerIsSrcOwner ? "rule0-owner-is-source-identity" : "rule1-owner-looked-up-by-name"} · ${r.reach}`)
// THE COUNTERFACTUAL: what the edge would name if the namespace the SOURCE LINE writes were kept.
// Priced here, before anything is built, against the project's own key space.
{
  const ns = residual.filter((r) => r.writtenFqn !== "" || r.importFqn !== "")
  const written = ns.filter((r) => r.writtenFqn !== "")
  const imported = ns.filter((r) => r.importFqn !== "")
  const both = (l: Row[]) => l.filter((r) => r.writtenFqnResolves || r.importFqnResolves)
  out(`\nCUT 6 — THE NAMESPACE-WRITTEN / IMPORTED COUNTERFACTUAL (priced, not built):`)
  out(`  residual calls edges whose SOURCE LINE states a namespace on the callee, or whose file imports one: ${ns.length}`)
  out(`    \\FQN\\ written on the callee          : ${written.length}   of which the FQN names EXACTLY ONE declaration here: ${both(written).length}`)
  out(`    use function <FQN> import            : ${imported.length}   of which the FQN names EXACTLY ONE declaration here: ${both(imported).length}`)
  for (const r of both(ns).slice(0, 12)) {
    out(`      ${r.rel}:${r.line}  ${r.src} -> ${r.tgt}  =>  ${r.writtenFqn || r.importFqn}  [${r.outcome} · decls(tgt) ${r.declCount} · ${r.shape}]`)
  }
  out(`  ^ A target spelled as the FQN the file itself writes is a SUBSET of the bare name's`)
  out(`    declarations, so it cannot add ambiguity — but what it lands on must be checked against`)
  out(`    PRODUCTION's resolver, not only this gate's key space.`)
}

// ── the classes NAMED rather than summarised ────────────────────────────────────────────────────
const show = (title: string, why: string, list: Row[], cap = 10) => {
  out(`\n${title}: ${list.length} edge(s)`)
  out(`  (${why})`)
  for (const r of list.slice(0, cap)) out(`    ${r.rel}:${r.line}  ${r.src} -> ${r.tgt} (owner ${r.owner || "-"}, ancestor ${r.ancestor || "-"})  [${r.outcome} · ${r.marker}]  ${r.lineText}`)
  if (list.length > cap) out(`    ⋯ ${list.length - cap} further edge(s) NOT printed (cap ${cap}) — the dump carries all of them.`)
}
show("THE CANDIDATE CLASS — R2-sameFileAncestorDeclares", "owner typed by the tree, member declared on an ancestor DECLARED IN THE SAME FILE: provable per-file, not re-spelled today", residual.filter((r) => r.reach === "R2-sameFileAncestorDeclares"))
show("R2b — MORE THAN ONE same-file ancestor declares it", "the qualified spelling would be a GUESS here (PHP takes the NEAREST declaration and a set has no order): counted so R2's provability is not borrowed from it", residual.filter((r) => r.reach === "R2b-multipleSameFileAncestorsDeclare"), 6)
show("THE MISS CLASS — R1-ownFileOwnerMember", "the file PUBLISHES <owner>.<target> and the edge is still amb/unres: should be 0, anything here is a MISS of qualifyProvenMemberTargets", residual.filter((r) => r.reach === "R1-ownFileOwnerMember"))
show("R3 — target declared in the edge's own file under ANOTHER owner", "the name IS in the file, on a different class: the qualifier's precondition, not its miss", residual.filter((r) => r.reach === "R3-targetDeclaredInOwnFileOtherOwner"), 6)

// ── THE R2 CLASS, ASKED THE QUESTION THAT DECIDES IT: is it a DEFECT, or a state the store never
//    reaches? An owner-carrying edge is WITHDRAWN from the insert-time rank and re-decided by
//    `member-owner-resolution.ts`. When `metadata.owner` is the source's own class, Rule 0 (:357)
//    gives that pass the owner's IDENTITY, and :436 then resolves a bare target through the ancestor
//    chain when exactly one candidate exists. Neither step is modelled by the incoming gate, so the
//    gate's `amb(decl)` on this population is an UPPER BOUND, not a count of wrong edges.
{
  const r2 = residual.filter((r) => r.reach === "R2-sameFileAncestorDeclares")
  const byPath = (l: Row[], p: boolean) => l.filter((r) => r.ownerIsSrcOwner === p).length
  out(`\nTHE R2 CLASS AND WHAT THE STORE DOES WITH IT BEFORE ANY RE-SPELLING:`)
  out(`  R2 edges (one in-file ancestor declares the member): ${r2.length}   amb ${r2.filter((r) => r.outcome === "amb").length}  unres ${r2.filter((r) => r.outcome === "unres").length}`)
  out(`    owner IS the source's own class (store Rule 0, identity) : ${byPath(r2, true)}`)
  out(`    owner is a NAMED class       (store Rule 1, name lookup) : ${byPath(r2, false)}`)
  out(`  ^ IF a re-spelling to \`<ancestor>.<member>\` were emitted while \`metadata.owner\` still named the`)
  out(`    RECEIVER, the store would take the qualified branch at :432 and DECLINE — a qualified target`)
  out(`    "may only bind in the owner it NAMES" — so the edge would move from amb to NULL, not to`)
  out(`    resolved. The store side of this must be read before the class is called fixable.`)
}

// ── the classifier's own control ────────────────────────────────────────────────────────────────
out(`\nSHAPE CLASSIFIER CONTROL (a known-positive population for the line parser):`)
for (const [k, v] of [...aggAll.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) out(`  ${String(v).padStart(8)}  ${k}`)

if (DUMP) {
  writeFileSync(DUMP, JSON.stringify({ population: { parsed: parsedTotal, repos: repos.length }, gate: path.relative(ROOT, GATE_LOG), rows: allRows }))
  out(`\ndumped ${allRows.length} calls rows to ${path.relative(ROOT, DUMP)}`)
}
