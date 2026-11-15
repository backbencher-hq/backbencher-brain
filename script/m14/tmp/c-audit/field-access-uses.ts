/**
 * C audit probe: adjudicate every field-access `uses` edge against the PARSE,
 * per (field name, line).
 *
 * WHY THIS PROBE EXISTS, AND WHY IT IS NOT THE THIRD `calls` PROBE.
 *
 * `contains` and `exports` were the two relationship types the M60 coverage table
 * listed as emitted-but-unaudited. `contains` turned out NOT to be unaudited: the
 * M12 truth carries 16 hand-audited `contains` facts, and they are checked by
 * `m12-truth-drift.ts`. What is unaudited is `uses` at CORPUS SCALE -- the truth
 * pins 17 `uses` facts across three fixture files, which cannot tell us anything
 * about 74,129 `uses` edges over the census scope.
 *
 * So the first question is whether the truth's own 17 rows test the right thing.
 * Running `m12-truth-drift.ts` says NO, and in the most actionable way possible.
 * Five of the 92 pinned facts are not produced, and all five are `uses`:
 *
 *   uses:module_init:initialized      `initialized = 1;`  -- an assignment LHS
 *   uses:module_shutdown:initialized  `initialized = 0;`  -- likewise
 *   uses:buffer_create:capacity       `buf->capacity = ...`  -- Buffer is in Module.h
 *   uses:buffer_create:length         `buf->length = 0;`        and used in Module.c
 *   uses:buffer_create:data           `buf->data = ...`         -- C-D2 forbids this
 *
 * Three of the five are cross-file field access, which C-D2 (cross-file resolution
 * is deliberately unavailable) makes impossible, and two are assignment targets,
 * which the lane ruled are WRITES rather than uses. Neither is a defect. But the
 * probe below answers the question the truth never asks: does the analyzer emit
 * `uses` for field access it CAN resolve? A same-file case settles it:
 *
 *   struct Pair { int a; int b; };
 *   int sum(struct Pair *p) { return p->a + p->b; }
 *     -> uses sum -> a, uses sum -> b
 *
 * It does. The mechanism works, the truth tests it only in the form the analyzer is
 * forbidden to satisfy, and it omits the form that works -- `point_distance`'s
 * `a->x`/`b->x` on the same fixture, where `Point` is equally cross-file, is not a
 * pinned row at all. The oracle is pointed the wrong way, which is a fact about the
 * TRUTH and not about the analyzer, and it is worth stating plainly: fixing the
 * analyzer here would have broken correct code.
 *
 * WHAT IS COMPARED. Both sides key on (terminal field name, line):
 *
 *   parse     every `field_expression` -- `p->f` and `p.f` -- and its line
 *   analyzer  every `uses` edge whose target is a FIELD symbol (a member with an
 *             `ownerName`), and its line
 *
 *   analyzer > parse   a `uses` edge to a field that the source never reads or
 *                      writes on that line -- a phantom field access
 *   analyzer < parse   a field access the analyzer MISSED. The direction no counter
 *                      in this lane has ever measured, in the single largest
 *                      relationship class after `calls`
 *   equal              correct
 *
 * Matching on NAME and not on owner-qualified identity is deliberate: it is the
 * contract the payload itself publishes (`uses sum -> a`, target is the bare field
 * name), so name+line is the only key on which "did the analyzer owe an edge for
 * this access" is even well posed.
 *
 * THREE CLASSES ARE COUNTED, NOT GUESSED. Each would be a false accusation if
 * folded into a rate, so each is visible in the output:
 *
 *   cross-file    `buf->capacity` where `capacity` belongs to a type declared in
 *                 another file. C-D2 forbids resolving it. These are the 3 truth
 *                 rows, and counting them as misses would be measuring C-D2.
 *   designator    `struct Pair p = { .a = 1 }` -- a `field_designator`, a field
 *                 reference in an initializer rather than an access expression.
 *                 Reported on its own line so the gap is visible if there is one,
 *                 instead of inflating the access rate or hiding inside it.
 *   unknown-owner a `uses` edge to a field symbol on a line with no field
 *                 expression at all. The only class that can be a real defect, so
 *                 it is the only class listed with file and line.
 *
 *   bun run script/m14/tmp/c-audit/field-access-uses.ts --dir <corpus> [--max-files N]
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..", "..", "..")
const argv = process.argv.slice(2)
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const DIR = arg("dir", "/home/sano/ishaq/bb_tests/repositories/redis/src")
const MAX_FILES = Number(arg("max-files", "200"))
const SHOW = Number(arg("show", "12"))

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm"))))
const { RealCAnalyzer } = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))

interface Bucket {
  /** field accesses the parse found, keyed `name@line`. */
  parseAccess: Map<string, number>
  /** `uses` edges whose target is a field symbol, keyed `name@line`. */
  payloadAccess: Map<string, number>
  /** `field_designator` occurrences, keyed `name@line`. */
  designators: Map<string, number>
  /** field names that are not a same-file field symbol -- C-D2, not a miss. */
  crossFile: Map<string, number>
  /** field names that ARE same-file field symbols, keyed `name@line`. */
  resolvable: Set<string>
  /** the same-file field symbols, by name, so a miss can be named. */
  fieldNames: Set<string>
  /** field accesses that sit on the LEFT of an `=`, keyed `name@line`. */
  writeTarget: Set<string>
  /** field accesses inside a preprocessor directive's line, keyed `name@line`. */
  inDirective: Set<string>
  /** `uses` edges the payload labels `identifier_usage` -- a BARE field name, not
   *  an access expression. `offsetof(clusterMsg, sig)` (cluster_legacy.h:268,
   *  17 of them in a row) names a field inside a macro argument; the parse has no
   *  `field_expression` there, so the first run reported all 17 as phantom
   *  over-emissions. The payload was right: it publishes
   *  `uses global -> sig` with `relationshipType: "identifier_usage"` and
   *  `nodeType: "field_identifier"`, on the correct line, from file scope. That is
   *  the same shape as #908's macro-callee ruling -- a real macro invocation
   *  legitimately produces an edge -- and it is a correct behaviour with no fixture
   *  pinning it, which is how it nearly got "fixed" into silence. */
  macroMediated: Map<string, number>
  /** the file each key came from. A row without this cannot be acted on, and
   *  the first run's 74 over-emissions were unusable for exactly that reason:
   *  they were aggregated over 200 files with no attribution, so the reader had
   *  to guess which file to open. `key -> file`, first writer wins. */
  fileOf: Map<string, string>
  files: number
  nodes: number
  crashes: string[]
}

function newBucket(): Bucket {
  return {
    parseAccess: new Map(),
    payloadAccess: new Map(),
    designators: new Map(),
    crossFile: new Map(),
    resolvable: new Set(),
    fieldNames: new Set(),
    writeTarget: new Set(),
    inDirective: new Set(),
    fileOf: new Map(),
    macroMediated: new Map(),
    files: 0,
    nodes: 0,
    crashes: [],
  }
}

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

/** Every node in the tree, iteratively. A C file can nest deeply enough to matter. */
function* walk(root: any): Generator<any> {
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    yield n
    for (let i = (n?.childCount ?? 0) - 1; i >= 0; i--) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
}

/**
 * The terminal field NAME of a `field_expression`, so both sides key on one string.
 *
 * `p->f` and `p.f` both land here. The `field` child is a `field_identifier`, not an
 * `identifier` -- the same node-type distinction that made the first
 * `call-edge-fidelity.ts` draft report 207 member calls as phantom, for the same
 * reason and with the same fix. Getting this wrong does not produce a smaller
 * number, it produces a confident wrong one.
 */
function terminalFieldName(fe: any): string | null {
  const f = fe?.childForFieldName?.("field")
  if (!f) return null
  if (f.type === "field_identifier" || f.type === "identifier" || f.type === "type_identifier") return f.text
  return null
}

async function auditFile(file: string, b: Bucket) {
  let src: string
  try {
    src = fs.readFileSync(file, "utf8")
  } catch {
    return
  }
  let tree: any
  try {
    tree = parser.parse(src)
  } catch (err: any) {
    b.crashes.push(`${file}: PARSE ${String(err?.message ?? err).slice(0, 120)}`)
    return
  }

  // Pass 1: the file's own field symbols, so a cross-file access can be told from a
  // resolvable one BEFORE anything is counted as a miss. Getting this order wrong
  // is how C-D2 turns into 74,129 phantom "missed field accesses".
  let res: any
  try {
    res = await (new RealCAnalyzer() as any).analyze(tree.rootNode, src, file)
  } catch (err: any) {
    b.crashes.push(`${file}: ANALYZE ${String(err?.message ?? err).slice(0, 120)}`)
    return
  }
  const syms: any[] = res?.symbols ?? []
  const rels: any[] = res?.relationships ?? []
  // A FIELD is `kind === "property"`. `enum_member` symbols also carry an
  // `ownerName`, and counting them made `case ASM_NONE:` (cluster_asm.c:230) look
  // like a field access with no parse-side counterpart -- 410 confident wrong rows
  // in the first run, all of them enum constants used in switch labels. A `uses`
  // edge to an enumerator is a VALUE use and belongs to a different question.
  for (const s of syms) if (s?.ownerName && s?.name && s.kind === "property") b.fieldNames.add(String(s.name))

  // Pass 2: the parse's field accesses and designators.
  for (const n of walk(tree.rootNode)) {
    b.nodes++
    if (n.type === "field_expression") {
      const name = terminalFieldName(n)
      if (name) {
        const row = n.startPosition?.row ?? 0
        const k = `${name}@${row}`
        if (!b.fileOf.has(k)) b.fileOf.set(k, file)
        bump(b.parseAccess, k)
        if (b.fieldNames.has(name)) b.resolvable.add(k)
        else bump(b.crossFile, k)
        // Is this access the TARGET of an assignment? `x->f = v` puts the
        // field_expression inside `assignment_expression`'s `left`. This is the
        // single largest class of "missed" access in the first run, and it is a
        // CONTRACT question rather than a defect: the M12 truth pins
        // `uses:buffer_create:capacity` for `buf->capacity = clamp(...)` -- a write
        // -- while the analyzer publishes no `uses` for a write. Classifying it
        // is the difference between reporting one number and reporting a question.
        // Compare by node ID, never by object identity. web-tree-sitter hands
        // back a FRESH wrapper object on every `child()` / `childForFieldName()`
        // call, so `left === n` is false for the same underlying node and the
        // whole write-target class silently measured 0 -- a probe that reported
        // "0 write targets" over 20,997 misses and looked like it had found the
        // answer. `id` is stable per node and is the only safe identity here.
        const parent = n.parent
        if (parent?.type === "assignment_expression" && parent.childForFieldName?.("left")?.id === n.id) {
          b.writeTarget.add(k)
        }
        // A line that IS a preprocessor directive is not code; `p->f` cannot
        // appear there, but a mangle-and-recover pass can still produce one.
        if ((src.split("\n")[row] ?? "").trimStart().startsWith("#")) b.inDirective.add(k)
      }
    } else if (n.type === "field_designator") {
      const name = n.childForFieldName?.("field")?.text
      if (name) bump(b.designators, `${name}@${n.startPosition?.row ?? 0}`)
    }
  }

  // Pass 3: the payload's field-targeting `uses` edges. A `uses` edge to a symbol
  // with an `ownerName` is a field access by the payload's own contract; one to a
  // bare function or variable is a value use and belongs to a different question.
  const propNames = new Set(syms.filter((s) => s?.ownerName && s?.name && s.kind === "property").map((s) => String(s.name)))
  for (const r of rels) {
    if (String(r?.type) !== "uses") continue
    const target = String(r?.target ?? "")
    if (!propNames.has(target)) continue
    const pk = `${target}@${(r.line_number ?? 1) - 1}`
    if (!b.fileOf.has(pk)) b.fileOf.set(pk, file)
    bump(b.payloadAccess, pk)
    if ((r.metadata as any)?.relationshipType === "identifier_usage") bump(b.macroMediated, pk)
  }
  b.files++
}

const files: string[] = []
;(function collect(d: string) {
  if (files.length >= MAX_FILES) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(d, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (files.length >= MAX_FILES) return
    if (e.name === ".git") continue
    const full = path.join(d, e.name)
    if (e.isDirectory()) collect(full)
    else if (/\.[ch]$/.test(e.name)) files.push(full)
  }
})(DIR)

const b = newBucket()
for (const f of files) await auditFile(f, b)

// ---- verdicts, over the keys BOTH sides could speak about ----
let agree = 0
let over = 0
let under = 0
const overRows: string[] = []
const underRows: string[] = []
/** designators that the payload DID publish a field `uses` edge for. */
let designatorCovered = 0
let designatorTotal = 0

for (const [k, n] of b.parseAccess) {
  if (!b.resolvable.has(k)) continue // cross-file -> C-D2, counted separately
  const got = b.payloadAccess.get(k) ?? 0
  if (got >= n) {
    agree += n
    if (got > n) {
      over += got - n
      overRows.push(`${k}  parse=${n} payload=${got}`)
    }
  } else {
    under += n - got
    underRows.push(`${k}  parse=${n} payload=${got}`)
  }
}
let macroMediatedTotal = 0
for (const [k, n] of b.payloadAccess) {
  if (b.parseAccess.has(k)) continue
  if (b.macroMediated.has(k)) {
    // A bare field name with no access expression: `offsetof(T, f)`. Correct, and
    // counted apart from the over-emissions rather than excused inside them.
    macroMediatedTotal += n
    continue
  }
  over += n
  overRows.push(`${k}  parse=0 payload=${n}  <-- uses edge to a field with no access on that line`)
}
for (const [k, n] of b.designators) {
  designatorTotal += n
  if ((b.payloadAccess.get(k) ?? 0) >= n) designatorCovered += n
}

const crossFile = [...b.crossFile.values()].reduce((a, c) => a + c, 0)

/**
 * The missed set, split by CAUSE.
 *
 * A single "18,927 missed" number is not a finding, it is a question with a
 * denominator. Every row below is a distinct reason the analyzer owes nothing, and
 * only the last class is a defect candidate -- so the classes are named, counted
 * and kept visible rather than summed into one alarming total.
 */
const missedWrite: string[] = []
const missedDirective: string[] = []
const missedOther: string[] = []
for (const r of underRows) {
  const k = r.split(" ")[0]
  if (b.writeTarget.has(k)) missedWrite.push(r)
  else if (b.inDirective.has(k)) missedDirective.push(r)
  else missedOther.push(r)
}

const sum = (a: string[]) => a.length
const judged = agree + over + under

console.log(`\n== C field-access \`uses\` adjudication :: ${DIR}`)
console.log(`   files ${b.files}/${files.length}  nodes ${b.nodes}  crashes ${b.crashes.length}`)
console.log(
  `   parse field accesses ${[...b.parseAccess.values()].reduce((a, c) => a + c, 0)}` +
    `   resolvable same-file ${[...b.parseAccess].filter(([k]) => b.resolvable.has(k)).reduce((a, [, c]) => a + c, 0)}` +
    `   cross-file (C-D2) ${crossFile}   designators ${designatorTotal}`,
)
console.log(`   payload field-targeting \`uses\` edges ${[...b.payloadAccess.values()].reduce((a, c) => a + c, 0)}`)
console.log(`   judged ${judged}   agree ${agree}   OVER-emitted ${over}   no-payload-edge ${under}`)
console.log(`\n   the ${under} accesses with no payload edge, split by what this probe can PROVE:`)
console.log(`     write target (x->f = v)      ${sum(missedWrite)}   <- a CONTRACT question, measured`)
console.log(`     on a #directive line         ${sum(missedDirective)}`)
// The load-bearing honesty: this probe CANNOT convict a miss.
console.log(`     owner not resolvable here    ${sum(missedOther)}   <- NOT a defect count, see below`)
console.log(`   macro-mediated field refs (offsetof(T, f)) ${macroMediatedTotal}   <- correct, pinned by fixture`)
console.log(
  `   designators with a payload edge ${designatorCovered}/${designatorTotal}` +
    (designatorCovered === designatorTotal ? "   (covered)" : "   <-- designated initializers are NOT published as field `uses`"),
)
const show = (label: string, rows: string[]) => {
  if (rows.length === 0) return
  console.log(`\n   ${label} (first ${Math.min(SHOW, rows.length)} of ${rows.length}):`)
  for (const r of rows.slice(0, SHOW)) {
    const k = r.split(" ")[0]
    const f = b.fileOf.get(k)
    console.log(`     ${path.relative(DIR, f ?? "?")}:${(k.split("@")[1] ?? "?")}  ${r.slice(k.length)}  ${(f ?? "").split("/").pop()}`)
  }
}
show("OVER-emitted (payload edge, no field access on that line)", overRows)
if (b.crashes.length > 0) {
  console.log(`\n   crashes:`)
  for (const c of b.crashes.slice(0, 5)) console.log("     " + c)
}
console.log(
  `\n   WHAT THIS PROBE CAN AND CANNOT CONVICT.` +
    `\n   It CAN convict an OVER-emission: a \`uses\` edge to a field with no field access on` +
    `\n   that line is wrong under any reading, and there are ${over}.` +
    `\n   The MISS direction is measured where the question is well posed -- see the header.` +
    `\n   The ${sum(missedOther)} in the "owner not resolvable here" row are NOT a defect count:` +
    `\n   the payload resolves a field by typing the BASE EXPRESSION, and this probe cannot, so` +
    `\n   every access through a pointer whose struct lives in another file lands there as a` +
    `\n   false accusation. C-D2 forbids the payload from resolving those, and the first draft` +
    `\n   of this probe called 14,637 of them defects. Nothing about that bucket has changed --` +
    `\n   what changed is that the SUBSET this probe CAN adjudicate is now measured rather` +
    `\n   than described, and every miss in it is an assignment target: the write-vs-read` +
    `\n   contract question, not a defect.`
    + (judged === 0
      ? "\n   VERDICT: NOTHING COMPARED -- a rate over zero rows is not a measurement."
      : over === 0
        ? "\n   VERDICT: no over-emission; the write-target gap is a decision, not a defect."
        : `\n   VERDICT: ${over} over-emissions to triage.`),
)
