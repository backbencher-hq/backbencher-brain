/**
 * ZIG — THE ABSENT POPULATION, CLASSIFIED. Prices cause B separately from A and C.
 *
 * ## The question
 *
 * `file-local-resolution.ts` measures HOW MANY edges name a target the sample publishes
 * nowhere. It does not say WHY, and the three whys have costs that differ by orders of
 * magnitude:
 *
 *   - **B (format mismatch).** The edge targets `a.b.L` while the declaration publishes
 *     `name: L` and `qualifiedName: a.b.L`. Same symbol, two spellings, one edge resolves
 *     to nothing. Fix: retarget the edge to `L`. One line per edge, no name-surface change.
 *   - **C (external).** The edge targets `std.mem.eql` and the corpus publishes nothing
 *     named `eql`, because `std` is not in the corpus. Nothing to fix in the edge; the
 *     edge is correct and the target is out of population.
 *   - **A (name is not an identifier).** The target is a bare name declared by 40 files.
 *     Not recoverable by retargeting; recoverable only by publishing an identifier that
 *     carries file or owner identity.
 *
 * `diagnose-incoming.mts` prices B as "dotted target whose final segment is a published
 * name". That predicate counts B-UNSAFE edges as B. This instrument separates them, and
 * the separation is the whole point: **retargeting a B-UNSAFE edge fabricates a wrong
 * edge**, which is the one mistake this workstream prices above everything else.
 *
 * ## The discriminator
 *
 * `pool-worker.ts:930` projects `qualifiedName` as `s.qualifiedName || s.metadata?.fqn
 * || (s.scope ? scope + "." + name : name)`. So for a symbol published in the edge's own
 * file with `name: L`:
 *
 *   - `qualifiedName === T`  → the walk `scope + "." + name` reconstructs T exactly.
 *       Retargeting `T` to `L` preserves the graph's own spelling of the symbol.
 *       Counted **B-SAFE**. This is the only class a retarget may touch.
 *   - `qualifiedName !== T`  → `L` names a DIFFERENT declaration than `T` does.
 *       Counted **B-UNSAFE**, reported with both spellings, never retargeted.
 *
 * ## Classes, exhaustive and disjoint, checked against the total
 *
 *   fileLocalExact   target is a published NAME in the edge's own file            (resolved)
 *   fileLocalLeaf    target dotted; leaf is a published name in the edge's own file
 *                    whose qualifiedName EQUALS the target                        (B-SAFE)
 *   fileLocalLeafX   same, but the leaf's qualifiedName differs from the target   (B-UNSAFE)
 *   corpusExact      target is a published name in ANOTHER file of the sample        (resolved)
 *   corpusLeaf       target dotted; leaf published in another file only             (cause A)
 *   absentDotted     target dotted; leaf published NOWHERE                            (cause C)
 *   absentBare       target bare; published nowhere                                   (cause A or dead)
 *
 * `marked` is an overlay, not a class: the edge carries `zigExternalRef`, `zigImport` or
 * `zigImportAlias`, i.e. it is ALREADY declared external by Z66 and should be excluded
 * rather than counted as a miss.
 *
 * ## Instrument
 *
 * `parseFile` from `src/ast/pool-worker` — production, not `analyze()`. Every number here
 * comes from it. Files: `find <root> -name '*.zig' -type f | sort | head -N`, the same
 * deterministic draw `file-local-resolution.ts` uses, so the two are comparable.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/absent-class.ts <root> [N] [--out path]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const argv = process.argv.slice(2)
const positional = argv.filter((a) => !a.startsWith("--"))
const flag = (k: string, d: string) => {
  const hit = argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`))
  if (hit === undefined) return d
  const eq = hit.indexOf("=")
  return eq === -1 ? (argv[argv.indexOf(hit) + 1] ?? d) : hit.slice(eq + 1)
}
const root = positional[0] ?? "/home/ishaq2321/bb_tests/repositories"
const N = Number(positional[1] ?? 3848)
const out = flag("out", "")

const files = execFileSync("bash", ["-lc", `find ${root} -name '*.zig' -type f | sort | head -${N}`], {
  encoding: "utf8",
  maxBuffer: 1 << 28,
})
  .trim()
  .split("\n")
  .filter(Boolean)

type Class =
  | "fileLocalExact"
  | "fileLocalLeaf"
  | "fileLocalLeafX"
  | "corpusExact"
  | "corpusLeaf"
  | "absentDotted"
  | "absentBare"

const CLASSES: Class[] = [
  "fileLocalExact",
  "fileLocalLeaf",
  "fileLocalLeafX",
  "corpusExact",
  "corpusLeaf",
  "absentDotted",
  "absentBare",
]

/** published bare name -> files declaring it */
const nameToFiles = new Map<string, Set<string>>()
/**
 * published QUALIFIED name -> files publishing it. This map exists to answer one
 * question the bare-name map cannot: is an unresolved edge's target string WRONG, or is
 * it RIGHT and merely unmatched?
 *
 * The store binds an edge by `name`; `qualifiedName` is published alongside and, per
 * pool-worker.ts:930, is `s.qualifiedName || metadata.fqn || (scope ? scope + "." + name : name)`.
 * So an edge whose target string EQUALS a published qualifiedName is a CORRECT edge
 * describing a real declaration, and it misses only because the lookup key is the bare
 * name. That is a resolver question, not an analyzer question, and the two must not be
 * counted as one — so it is measured separately here rather than left inside `absent*`.
 */
const qnToFiles = new Map<string, Set<string>>()
/** class x marked(external): the cross-tab that answers cause C */
const markedByClass = new Map<string, number>()
/** class x root: for the dotted classes, which module prefix the unresolved targets carry */
const rootsByClass = new Map<string, Map<string, number>>()
/** top NAMES per unresolved class, so a class is characterised and not only counted */
const namesByClass = new Map<string, Map<string, number>>()
/** how many unresolved edges carry no marker at all, per class — the unmarked remainder */
const unmarkedByClass = new Map<string, number>()
/** the `targetScope` distribution over ALL edges — Z65's own annotation, read as-is */
const scopeCells = new Map<string, number>()
/** edges Z65 marked `file-external`, per type */
const externalByType = new Map<string, number>()

/** qn-resolvable count per type, and the same broken down by the class it came from */
const qnResolvable = new Map<string, number>()
const qnByClass = new Map<string, number>()
/** per type, per class, plus the marked overlay */
const cells = new Map<string, Record<string, number>>()
const markerCells = new Map<string, number>()
/** samples of the two classes a retarget could act on, kept for inspection */
const safeSamples: { file: string; target: string; leaf: string; qn: string; leafQn: string; types: string[] }[] = []
const unsafeSamples: { file: string; target: string; leaf: string; leafQn: string; types: string[] }[] = []
/** the repairable half of absentBare: declared in the file's text, published by nothing */
const gapSamples = new Map<string, { name: string; file: string; types: Set<string>; kindHint: string }>()
let absentBareInText = 0
let absentBareDeclares = 0
let absentBareNotInText = 0
/** absent-dotted roots, so "external" is a measurement and not an assumption */
const absentDottedRoots = new Map<string, { edges: number; types: Set<string> }>()
const absentDottedLeafPublished = new Map<string, number>()
/**
 * every edge that did NOT resolve by bare name, kept as a compact tuple so it can be
 * re-classified once `qnToFiles` is complete. A qn published by the LAST file in the
 * walk is still a real publication, so this decision cannot be made inside the walk.
 */
const unresolved: { cls: Class; type: string; target: string; file: string }[] = []

const leafOf = (t: string) => (t.includes(".") ? t.slice(t.lastIndexOf(".") + 1) : t)
const rootOf = (t: string) => (t.includes(".") ? t.slice(0, t.indexOf(".")) : t)

/**
 * `absentBare` is the largest class and the least characterised: a bare target the
 * file does not publish under that name. Two opposite findings hide in it, and only
 * one is repairable.
 *
 *   - the name IS DECLARED in the file's own text and the analyzer published no
 *     symbol for it → a PUBLICATION GAP. This is fixable in this lane, and fixing it
 *     is the only change that raises resolution.
 *   - the name does not occur in the file's text at all → the edge names something
 *     the analyzer derived (a leaf of a path, a synthetic receiver) or something out
 *     of population. Retargeting or republishing cannot create a declaration that is
 *     not in the file.
 *
 * `inText` is a whole-word test against the file's own bytes. `declares` additionally
 * requires a declaration keyword within 40 characters before the occurrence, so a
 * mention inside an expression is not counted as a declaration.
 */
const declaredIn = (content: string, name: string): { inText: boolean; declares: boolean } => {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`(^|[^A-Za-z0-9_@])(${esc})([^A-Za-z0-9_]|$)`, "g")
  let inText = false
  let declares = false
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    inText = true
    // m.index is the start of the SEPARATOR capture, not of the name, so the window
    // must be anchored at the name's own first character or the keyword's trailing
    // space is cut off and no declaration can ever match.
    const nameStart = m.index + m[1].length
    const before = content.slice(Math.max(0, nameStart - 40), nameStart)
    if (/(^|[\s;{}()])((pub|export|inline|extern|comptime|noalias|const|var|fn)\s+)+$/.test(before)) {
      declares = true
      break
    }
    if (m.index === re.lastIndex) re.lastIndex++
  }
  return { inText, declares }
}

let symbols = 0
let parsed = 0
let failed = 0

/**
 * THE CONTROL. `absentBareDeclares === 0` is only a finding about the ANALYZER if the
 * detector can fire at all. So it is also run against every name the analyzer DOES
 * publish, from the same file's same bytes, with the same regex: `controlPublished`
 * counts published names the detector calls a declaration. A detector that reports 0
 * here is broken, and its 0 above means nothing.
 *
 * This is a self-check on the instrument, not a claim about the analyzer, and it is
 * reported as a rate so a reader can see the instrument's own precision.
 */
let controlPublished = 0
let controlDeclared = 0

const row = (type: string) => {
  let c = cells.get(type)
  if (!c) {
    c = Object.fromEntries(CLASSES.map((k) => [k, 0])) as Record<string, number>
    cells.set(type, c)
  }
  return c
}

/**
 * Accumulate the shape of one unresolved edge, for the cause-C answer: which module
 * prefix its target carries (the dotted classes), which bare NAME it carries (the bare
 * class), and whether it already carries an external marker. Without this the three
 * unresolved classes are three counts and nothing else.
 */
function noteUnresolved(cls: Class, target: string, marked: boolean): void {
  if (marked) markedByClass.set(cls, (markedByClass.get(cls) ?? 0) + 1)
  else unmarkedByClass.set(cls, (unmarkedByClass.get(cls) ?? 0) + 1)
  const key = cls === "absentBare" ? target : rootOf(target)
  let rm = rootsByClass.get(cls)
  if (!rm) rootsByClass.set(cls, (rm = new Map()))
  rm.set(key, (rm.get(key) ?? 0) + 1)
  let nm = namesByClass.get(cls)
  if (!nm) namesByClass.set(cls, (nm = new Map()))
  nm.set(target, (nm.get(target) ?? 0) + 1)
}

for (const f of files) {
  let r: any
  try {
    r = await parseFile(f, root)
    parsed++
  } catch {
    failed++
    continue
  }
  let content = ""
  try {
    content = readFileSync(f, "utf8")
  } catch {
    /* a file the walker could parse but this process cannot read is reported by the
       absentBare_notInText count; it is not silently treated as a publication gap */
  }
  /** this file's published names, and name -> the qualifiedName it published for it */
  const localNames = new Map<string, string | undefined>()
  for (const s of r?.symbols ?? []) {
    const n = String(s?.name ?? "")
    if (!n) continue
    symbols++
    if (!localNames.has(n)) {
      localNames.set(n, s?.qualifiedName === undefined ? undefined : String(s.qualifiedName))
      controlPublished++
      if (declaredIn(content, n).declares) controlDeclared++
    }
    let set = nameToFiles.get(n)
    if (!set) nameToFiles.set(n, (set = new Set()))
    set.add(f)
    const qn = s?.qualifiedName === undefined || s.qualifiedName === null ? "" : String(s.qualifiedName)
    if (qn && qn !== n) {
      let qs = qnToFiles.get(qn)
      if (!qs) qnToFiles.set(qn, (qs = new Set()))
      qs.add(f)
    }
  }
  for (const e of r?.relationships ?? []) {
    const t = String(e?.target ?? "")
    if (!t) continue
    const type = String(e?.type ?? "")
    const c = row(type)
    const md = (e?.metadata ?? {}) as Record<string, any>
    let edgeMarked = false
    if (md.zigExternalRef === true || md.zigImport === true || md.zigImportAlias === true) {
      markerCells.set(type, (markerCells.get(type) ?? 0) + 1)
    }
    const ts = md.targetScope === undefined ? "(none)" : String(md.targetScope)
    scopeCells.set(ts, (scopeCells.get(ts) ?? 0) + 1)
    // Z65 already answers cause C for the file tier: every target the file does not
    // publish is annotated `file-external`. So the marker predicate for the unresolved
    // classes is Z65's annotation, NOT the Z66 external-ref flags — an earlier run of
    // this instrument counted only the Z66 flags and under-reported the marked
    // population. Both are reported; the union is what `marked` means.
    if (md.targetScope === "file-external") {
      edgeMarked = true
      externalByType.set(type, (externalByType.get(type) ?? 0) + 1)
    }
    const leaf = leafOf(t)
    const dotted = t.includes(".")
    if (localNames.has(t)) {
      c.fileLocalExact++
    } else if (dotted && localNames.has(leaf)) {
      const leafQn = localNames.get(leaf)
      if (leafQn === t) {
        c.fileLocalLeaf++
        if (safeSamples.length < 60) {
          const hit = safeSamples.find((s) => s.target === t && s.file === f)
          if (hit) {
            if (!hit.types.includes(type)) hit.types.push(type)
          } else safeSamples.push({ file: f, target: t, leaf, qn: t, leafQn: t, types: [type] })
        }
      } else {
        c.fileLocalLeafX++
        if (unsafeSamples.length < 60) {
          const hit = unsafeSamples.find((s) => s.target === t && s.file === f)
          if (hit) {
            if (!hit.types.includes(type)) hit.types.push(type)
          } else unsafeSamples.push({ file: f, target: t, leaf, leafQn: leafQn ?? "(none)", types: [type] })
        }
      }
    } else if (nameToFiles.has(t)) {
      c.corpusExact++
    } else if (dotted && nameToFiles.has(leaf)) {
      c.corpusLeaf++
      unresolved.push({ cls: "corpusLeaf", type, target: t, file: f })
      noteUnresolved("corpusLeaf", t, edgeMarked)
    } else if (dotted) {
      c.absentDotted++
      unresolved.push({ cls: "absentDotted", type, target: t, file: f })
      noteUnresolved("absentDotted", t, edgeMarked)
      const r0 = rootOf(t)
      let e = absentDottedRoots.get(r0)
      if (!e) absentDottedRoots.set(r0, (e = { edges: 0, types: new Set() }))
      e.edges++
      e.types.add(type)
      absentDottedLeafPublished.set(leaf, (absentDottedLeafPublished.get(leaf) ?? 0) + 1)
    } else {
      c.absentBare++
      unresolved.push({ cls: "absentBare", type, target: t, file: f })
      noteUnresolved("absentBare", t, edgeMarked)
      const probe = declaredIn(content, t)
      if (probe.inText) absentBareInText++
      else absentBareNotInText++
      if (probe.inText && probe.declares) {
        absentBareDeclares++
        const key = `${f} ${t}`
        let g = gapSamples.get(key)
        if (!g) gapSamples.set(key, (g = { name: t, file: f, types: new Set(), kindHint: "" }))
        g.types.add(type)
        if (!g.kindHint) {
          const re2 = new RegExp(`((pub|export|inline|extern|comptime|noalias|const|var|fn)\\s+)+${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
          const mm = content.match(re2)
          g.kindHint = mm ? mm[0].replace(/\s+/g, " ").trim() : ""
        }
      }
    }
  }
}

const rows = [...cells.entries()]
  .map(([type, c]) => {
    const edges = CLASSES.reduce((a, k) => a + c[k], 0)
    return { type, edges, ...c, marked: markerCells.get(type) ?? 0 }
  })
  .sort((a, b) => b.edges - a.edges)

const totals = Object.fromEntries(CLASSES.map((k) => [k, 0])) as Record<string, number>
let edgeTotal = 0
let markedTotal = 0
for (const r of rows) {
  edgeTotal += r.edges
  markedTotal += r.marked
  for (const k of CLASSES) totals[k] += r[k] as number
}

const pct = (n: number) => (edgeTotal ? +((100 * n) / edgeTotal).toFixed(2) : 0)

/**
 * THE QN CROSS-TAB. Of every edge that did not resolve by bare name, how many name a
 * string the analyzer DID publish as a `qualifiedName`?
 *
 * This is the number that separates "the analyzer emits a wrong string" from "the
 * analyzer emits a right string the store cannot look up". The first is this lane's bug;
 * the second is shared machinery. Reporting only the aggregate miss count conflates them,
 * and conflating them is what makes a lane look broken when it is not.
 */
let qnResolvableTotal = 0
let qnResolvableSameFile = 0
const qnSamples: { target: string; cls: Class; type: string; publishedIn: string }[] = []
for (const u of unresolved) {
  const pubs = qnToFiles.get(u.target)
  if (!pubs) continue
  qnResolvableTotal++
  qnResolvable.set(u.type, (qnResolvable.get(u.type) ?? 0) + 1)
  qnByClass.set(u.cls, (qnByClass.get(u.cls) ?? 0) + 1)
  if (pubs.has(u.file)) qnResolvableSameFile++
  if (qnSamples.length < 40) qnSamples.push({ target: u.target, cls: u.cls, type: u.type, publishedIn: [...pubs][0] })
}

const report = {
  population: { root, filesListed: files.length, parsed, failed, symbols },
  classes: {
    fileLocalExact: "target is a published NAME in the edge's own file — resolved",
    fileLocalLeaf: "dotted target, leaf published in this file, leaf qualifiedName EQUALS the target — CAUSE B, retargetable",
    fileLocalLeafX: "dotted target, leaf published in this file, leaf qualifiedName DIFFERS — CAUSE B UNSAFE, retargeting would fabricate",
    corpusExact: "target is a published name in another file of the sample — resolved, ambiguous",
    corpusLeaf: "dotted target, leaf published only in another file — cause A",
    absentDotted: "dotted target, leaf published nowhere in the sample — cause C candidate",
    absentBare: "bare target, published nowhere in the sample — cause A or genuinely absent",
  },
  totals: {
    edges: edgeTotal,
    ...totals,
    markedZ66: markedTotal,
    targetScopeDistribution: Object.fromEntries([...scopeCells.entries()].sort((a,b)=>b[1]-a[1])),
    fileExternalByType: Object.fromEntries([...externalByType.entries()].sort((a,b)=>b[1]-a[1])),
    absentBareInText,
    absentBareDeclares,
    absentBareNotInText,
    qnResolvable: qnResolvableTotal,
    qnResolvableSameFile,
    pct: Object.fromEntries(CLASSES.map((k) => [k, pct(totals[k])])),
  },
  qnCrossTab: {
    note:
      "Of every edge that did NOT resolve by bare name: does its target string equal a " +
      "qualifiedName this analyzer published somewhere in the sample? Such an edge is CORRECT and " +
      "names a real declaration; it misses only because the store binds edges by `name`. " +
      "Counting these as analyzer misses is the conflation this table exists to prevent.",
    unresolvedTotal: unresolved.length,
    qnResolvable: qnResolvableTotal,
    qnResolvablePctOfUnresolved: unresolved.length ? +((100 * qnResolvableTotal) / unresolved.length).toFixed(2) : 0,
    qnResolvableSameFile,
    byClass: Object.fromEntries(CLASSES.map((k) => [k, qnByClass.get(k) ?? 0])),
    byType: Object.fromEntries([...qnResolvable.entries()]),
    samples: qnSamples,
  },
  perType: rows,
  absentDottedRoots: [...absentDottedRoots.entries()]
    .sort((a, b) => b[1].edges - a[1].edges)
    .slice(0, 30)
    .map(([root, e]) => ({ root, edges: e.edges, types: [...e.types] })),
  absentDottedTopLeaves: [...absentDottedLeafPublished.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
  absentBareGap: {
    note:
      "absentBare targets whose name IS DECLARED in the edge's own file's text and published by nothing. " +
      "This is the only class a repair in src/ast/real-zig-analyzer.ts can raise.",
    control: {
      note:
        "the SAME detector run against every name the analyzer DOES publish, from the same file's same " +
        "bytes. absentBareGap.edges is only a finding about the analyzer if this rate is high.",
      publishedNamesTested: controlPublished,
      detectorSaysDeclared: controlDeclared,
      rate: controlPublished ? +((100 * controlDeclared) / controlPublished).toFixed(2) : 0,
    },
    edges: absentBareDeclares,
    sites: [...gapSamples.values()]
      .map((g) => ({ name: g.name, file: g.file, declaration: g.kindHint, types: [...g.types] }))
      .sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name))
      .slice(0, 200),
  },
  unresolvedShape: {
    note:
      "Cause C, priced. markedByClass = edges already carrying zigExternalRef/zigImport/zigImportAlias, " +
      "i.e. already declared external and excludable. unmarkedByClass is the remainder that still reads as " +
      "a local miss. rootsByClass is the module PREFIX for the dotted classes and the NAME itself for the " +
      "bare class, so 'external' is a measurement of what the targets look like and not an assumption.",
    markedByClass: Object.fromEntries(markedByClass),
    unmarkedByClass: Object.fromEntries(unmarkedByClass),
    rootsByClass: Object.fromEntries(
      [...rootsByClass.entries()].map(([k, m]) => [
        k,
        [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([root, n]) => ({ root, n })),
      ]),
    ),
    topNamesByClass: Object.fromEntries(
      [...namesByClass.entries()].map(([k, m]) => [
        k,
        [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, n]) => ({ name, n })),
      ]),
    ),
  },
  safeSamples,
  unsafeSamples,
}

console.log(`population: ${files.length} files listed, ${parsed} parsed, ${failed} failed, ${symbols} symbols`)
console.log(`root: ${root}\n`)
console.log(`class              edges      pct`)
for (const k of CLASSES) console.log(`${k.padEnd(18)} ${String(totals[k]).padStart(8)} ${String(pct(totals[k])).padStart(8)}`)
console.log(`${"TOTAL".padEnd(18)} ${String(edgeTotal).padStart(8)} ${"100.00".padStart(8)}`)
console.log(`marked(Z66 flags)   ${String(markedTotal).padStart(8)}`)
let feTotal = 0
for (const v of externalByType.values()) feTotal += v
console.log(`marked(file-external, Z65) ${String(feTotal).padStart(8)}   <- the cause-C annotation`)
console.log(`targetScope distribution: ${JSON.stringify(Object.fromEntries([...scopeCells.entries()].sort((a,b)=>b[1]-a[1])))}`)
console.log(
  `\nabsentBare decomposed by whether the name occurs in the edge's own file text:\n` +
    `  in text          ${String(absentBareInText).padStart(8)}\n` +
    `  ...declares it   ${String(absentBareDeclares).padStart(8)}   <- the only repairable class\n` +
    `  ...not in text   ${String(absentBareNotInText).padStart(8)}`,
)
console.log(
  `\nCONTROL — same detector on names the analyzer DOES publish: ${controlDeclared} / ${controlPublished} ` +
    `(${(controlPublished ? (100 * controlDeclared) / controlPublished : 0).toFixed(2)}%)`,
)
console.log(`\nper type`)
console.log(
  `type              edges   fileLocalExact  fileLocalLeaf  fileLocalLeafX    corpusExact    corpusLeaf   absentDotted    absentBare        marked`,
)
for (const r of rows) {
  console.log(
    `${r.type.padEnd(16)} ${String(r.edges).padStart(6)} ${String(r.fileLocalExact).padStart(15)} ${String(r.fileLocalLeaf).padStart(14)} ${String(r.fileLocalLeafX).padStart(14)} ${String(r.corpusExact).padStart(12)} ${String(r.corpusLeaf).padStart(11)} ${String(r.absentDotted).padStart(13)} ${String(r.absentBare).padStart(12)} ${String(r.marked).padStart(12)}`,
  )
}
console.log(`\nabsentDotted top roots (a root measured here is not an assumption about externality):`)
for (const r of report.absentDottedRoots.slice(0, 15)) console.log(`  ${r.root.padEnd(14)} ${String(r.edges).padStart(7)}  ${r.types.join(",")}`)
console.log(`\nfileLocalLeaf samples (B-SAFE, retargetable) — up to ${safeSamples.length}:`)
for (const s of safeSamples.slice(0, 20)) console.log(`  ${s.target}  leafQn=${s.leafQn}  [${s.types.join(",")}]  ${s.file.replace(root + "/", "")}`)
console.log(`\nfileLocalLeafX samples (B-UNSAFE, must NOT be retargeted) — up to ${unsafeSamples.length}:`)
for (const s of unsafeSamples.slice(0, 20)) console.log(`  ${s.target}  leafQn=${s.leafQn}  [${s.types.join(",")}]  ${s.file.replace(root + "/", "")}`)
console.log(
  `\nabsentBare publication-gap sites (name declared in this file, published by nothing) — ${absentBareDeclares} edges:`,
)
for (const g of report.absentBareGap.sites.slice(0, 30)) {
  console.log(`  ${g.name.padEnd(28)} ${g.declaration.padEnd(34)} [${g.types.join(",")}]  ${g.file.replace(root + "/", "")}`)
}
console.log(
  `\nQN CROSS-TAB — of ${unresolved.length} edges that did not resolve by bare name, ` +
    `${qnResolvableTotal} name a string this analyzer DID publish as a qualifiedName ` +
    `(${(unresolved.length ? (100 * qnResolvableTotal) / unresolved.length : 0).toFixed(2)}%); ` +
    `${qnResolvableSameFile} of those are published by the edge's OWN file.`,
)
console.log(`  by class: ${JSON.stringify(report.qnCrossTab.byClass)}`)
console.log(`  by type:  ${JSON.stringify(report.qnCrossTab.byType)}`)
for (const s of qnSamples.slice(0, 15)) console.log(`  ${s.target}  [${s.cls}/${s.type}]  published by ${s.publishedIn.replace(root + "/", "")}`)
console.log(`\nUNRESOLVED SHAPE (cause C):`)
for (const cls of ["corpusLeaf", "absentDotted", "absentBare"] as Class[]) {
  const mk = markedByClass.get(cls) ?? 0
  const un = unmarkedByClass.get(cls) ?? 0
  console.log(`  ${cls.padEnd(14)} marked ${String(mk).padStart(6)}   unmarked ${String(un).padStart(6)}`)
  for (const r of (report.unresolvedShape.rootsByClass[cls] ?? []).slice(0, 8)) {
    console.log(`      ${String(r.n).padStart(6)}  ${cls === "absentBare" ? "name" : "root "} ${r.root}`)
  }
}

if (out) {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(report, null, 2))
  console.error(`\nwrote ${out}`)
}