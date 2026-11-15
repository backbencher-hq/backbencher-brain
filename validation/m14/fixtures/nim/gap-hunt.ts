/**
 * NIM DELTA HUNT — three MEASURED gaps between what the tree carries and what
 * the run published, each classified to a bucket so the delta is accounted for
 * rather than asserted away.
 *
 * ## Why
 *
 * The census gives one number per relationship type, and a number cannot tell a
 * correct filter from a silent bug. Three deltas are visible from the census
 * alone, and all three are the shape a real defect takes:
 *
 *   1. `extends`    920 `object_declaration.inherits` on the parse tree
 *                   against 547 `extends` edges. 373 occurrences unaccounted.
 *   2. `instantiates` 2,742 `bracket_expression`-in-callee-position occurrences
 *                   (Foo[int](x)) against 1,905 `instantiates` edges. 837
 *                   occurrences unaccounted.
 *   3. `overrides`  48 edges, emitted under a same-file rule, against a corpus
 *                   where most `method` receivers are declared in ANOTHER file.
 *
 * Each is bucketed below by the question that decides it, and every bucket is
 * either a defensible filter (with its reason) or an UNMATCHED count that names
 * the files, which is where a bug would be.
 *
 * ## Instrument
 *
 * Production `parseFile` for the edges, plus ONE tree-sitter parse per file for
 * the constructs. A second parse of the tree by the raw wasm parser, not by the
 * analyzer, so an analyzer bug cannot hide inside the counter. Node `type` and
 * `childForFieldName` only — no text pattern anywhere, because a string literal
 * can fake a construct and a comment can fake a keyword.
 *
 * READ-ONLY. Writes nothing except an optional JSON path in argv[2].
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

/** Corpus fan-out, and the reason it is a knob rather than a constant.
 *
 * The production path is non-deterministic under concurrency (the doc's
 * Limitations 8 / 11): the WASM parser exhausts its fixed heap on a
 * load-dependent set of files, and a file lost that way publishes symbols with
 * an EMPTY `kind` — a degraded walk whose counts are wrong and whose artifact is
 * otherwise indistinguishable from a clean one. Measured on this corpus at
 * `validation/m14/fixtures/nim/fallback.mts`: 1 worker -> 0 fallback files and 0
 * empty-kind symbols; 6 workers -> 2 and 4.
 *
 * So every number this lane quotes carries its worker count, and this is what
 * makes that count choosable rather than merely reported. Six is the default
 * because that is what every artifact on record was measured at, so an unpinned
 * invocation reproduces the committed figures. Lower it on a saturated box to
 * buy a clean walk; the spread is in the doc either way.
 */
const WORKERS = Math.max(1, Number(process.env.BB_NIM_WORKERS ?? 6) || 6)

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const ANALYZER = path.resolve((import.meta as any).dirname ?? ".", "../../../../src/ast/real-nim-analyzer.ts")
const analyzerHash = (): string => createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")
const HASH_BEFORE = analyzerHash()
const OUT = process.argv[2] && process.argv[2].endsWith(".json") ? process.argv[2] : null

// ─────────────────────────────────────────────────────────────── corpus walk
const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "nim") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
console.log(`files ${files.length}`)
console.log(`workers ${WORKERS} (BB_NIM_WORKERS; every count below is a function of this — see Limitations 8/11)`)
console.log(`analyzer    : ${path.relative(process.cwd(), ANALYZER)} sha256:${HASH_BEFORE.slice(0, 16)}`)

// ───────────────────────────────────────────────── per-file run facts
type FileRec = {
  label: string
  /** `owner.base` pairs the run published as `extends`. */
  extendsPairs: Set<string>
  extendsEdges: { src: string; tgt: string }[]
  /** names the run published as `instantiates` SOURCES. */
  instSources: Set<string>
  instTargets: Set<string>
  /** receiver-qualified overrides endpoints, `Recv.method`. */
  overridePairs: Set<string>
  overrideEdges: { src: string; tgt: string }[]
  typeNames: Set<string>
  callableNames: Set<string>
  /** every name published as a symbol, for the "is it in this file at all" test. */
  allNames: Set<string>
}
const recs = new Map<string, FileRec>()

let idx = 0
async function worker(): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    const label = `${f.repo}/${f.rel}`
    const rec: FileRec = {
      label, extendsPairs: new Set(), extendsEdges: [], instSources: new Set(), instTargets: new Set(),
      overridePairs: new Set(), overrideEdges: [], typeNames: new Set(), callableNames: new Set(), allNames: new Set(),
    }
    for (const s of r.symbols ?? []) {
      const nm = String(s.name ?? "")
      if (!nm) continue
      rec.allNames.add(nm)
      rec.allNames.add(nm.split(".").pop() ?? nm)
      const k = String(s.kind ?? "")
      // A TYPE is something a value can be constructed from. The kinds below are
      // the ones the analyzer publishes for a Nim `type X = …` declaration; a
      // `class`/`interface` is a distinct kind only for languages with classes,
      // and Nim has no class keyword, so both are kept because the corpus shows
      // them and a wrong bucket here would be my error, not the language's.
      if (["class", "struct", "type", "enum", "interface", "type_alias", "record", "object", "union"].includes(k)) rec.typeNames.add(nm)
      if (["function", "method", "macro", "template", "constructor"].includes(k)) rec.callableNames.add(nm)
    }
    for (const x of r.relationships ?? []) {
      const t = String(x.type ?? x.relationshipType ?? "")
      const s = String(x.source ?? "")
      const g = String(x.target ?? "")
      if (t === "extends") { rec.extendsEdges.push({ src: s, tgt: g }); rec.extendsPairs.add(`${s} ${g}`) }
      if (t === "instantiates") { rec.instSources.add(s); rec.instTargets.add(g) }
      if (t === "overrides") { rec.overrideEdges.push({ src: s, tgt: g }); rec.overridePairs.add(`${s} ${g}`) }
    }
    recs.set(label, rec)
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

// ───────────────────────────────────────────────── one raw parse per file
const wts: any = await import("web-tree-sitter")
const WSP: any = wts.Parser ?? wts.default
const WSL: any = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-nim.wasm"))))

/** The ancestor `type_declaration` name for a node, or null for an anonymous one.
 *
 *  The name is NOT a field of `type_declaration`: the grammar nests it as
 *  `type_declaration > type_symbol_declaration > name: identifier`, verified
 *  against wasm/tree-sitter-nim.wasm. The first version of this probe read
 *  `type_declaration.name`, got null for every node, and reported all 920
 *  inheritance occurrences as "anonymous" — a probe bug that reads exactly like
 *  an analyzer bug, which is why the owner is read off the tree here and never
 *  off the analyzer's own metadata. */
function ownerTypeName(n: any): string | null {
  let p = n.parent
  while (p) {
    if (p.type === "type_declaration") {
      for (let i = 0; i < p.namedChildCount; i++) {
        const c = p.namedChild(i)
        if (c.type === "type_symbol_declaration") {
          const nm = c.childForFieldName?.("name")
          if (!nm) return null
          // The name node is `identifier` for a private type and `exported_symbol`
          // for a public one, and `exported_symbol.text` INCLUDES the `*`
          // (`CFGParseError*`). A published symbol's name never does, so reading
          // the node text directly made every exported base count as unmatched —
          // 313 of them, all of them correct edges. The identifier is the name.
          if (nm.type === "exported_symbol") {
            const inner = nm.namedChildCount > 0 ? nm.namedChild(0) : null
            return inner ? String(inner.text) : null
          }
          return String(nm.text)
        }
      }
      return null
    }
    p = p.parent
  }
  return null
}
const NIM_COMPILER_ROOTS = new Set(["RootObj", "RootRef", "Object", "rootObj"])

/** The base TYPE as the run spells it: `H[M, D]` -> H, `rstgen.RstGenerator` ->
 *  RstGenerator, `ref RootObj` -> RootObj. Node-shape derivation, no text
 *  matching: the type expression is walked, and only when it is a plain named
 *  type with an optional bracket/qualifier wrapper is a leaf taken. */
function baseLeaf(raw: string): string {
  const seg = raw.split(".")
  const last = seg[seg.length - 1] ?? raw
  const bracket = last.indexOf("[")
  return (bracket === -1 ? last : last.slice(0, bracket)).trim()
}

// ───────────────────────────────────────────────────── Q1: the extends delta
const q1 = {
  onTree: 0,
  emitted: 0,
  anonymous: 0,      // an object with no named type_declaration ancestor
  selfNamed: 0,      // `type X = object of X` — a self-reference, not a supertype
  compilerRoot: 0,   // `ref object of RootRef` — the compiler's own root
  ownerNotPublished: 0, // the TYPE ITSELF was never published, so no edge is possible
  unmatched: 0,
}
const q1ex: Record<string, string[]> = { anonymous: [], selfNamed: [], compilerRoot: [], ownerNotPublished: [], unmatched: [] }
const addEx = (k: string, s: string): void => { const a = q1ex[k]; if (a && a.length < 10) a.push(s) }

// ──────────────────────────────────────────────── Q2: the instantiates delta
const q2 = {
  onTree: 0,
  emitted: 0,
  typeInFile: 0,        // Foo[int](x) where THIS file declares Foo as a type
  procInFile: 0,        // Foo[int](x) where THIS file declares Foo as a proc
  notInFile: 0,         // neither — an external or stdlib name
  bothTypeAndProc: 0,   // declared as BOTH in this file; ambiguous by construction
  alreadyEmitted: 0,
}
const q2ex: Record<string, string[]> = { typeInFile: [], procInFile: [], notInFile: [], bothTypeAndProc: [] }

// ───────────────────────────────────────────────── Q3: the overrides family
const q3 = {
  methodsOnTree: 0,
  recvInFile: 0,
  recvNotInFile: 0,
  recvNone: 0,
  /** `method Receiver.name()` — the receiver is written INTO the name. The
   *  pinned grammar puts it in an ERROR node, which is a parse shape, not a
   *  spelling, and the analyzer reads the receiver only from the first
   *  parameter. Counted here so the family has a denominator. */
  recvInErrorNode: 0,
  emitted: 0,
  emittedWithRecvInFile: 0,
  emittedWithRecvNotInFile: 0,
  /** same-file method pairs the tree shows and the run did NOT publish. */
  sameFileMissed: 0,
}
const q3ex: Record<string, string[]> = { sameFileMissed: [], recvNotInFile: [], recvInErrorNode: [], recvNone: [] }

let pidx = 0
let parseErr = 0
function treeWorker(): void {
  for (;;) {
    const i = pidx++
    if (i >= files.length) return
    const f = files[i]
    const label = `${f.repo}/${f.rel}`
    let t: any
    try { t = parser.parse(f.text) } catch { parseErr++; continue }
    if (!t) { parseErr++; continue }
    const rec = recs.get(label)

    // methods declared in this file, by receiver, for Q3
    const methodByRecv = new Map<string, string[]>()

    const walk = (n: any): void => {
      // ── Q1: every `object … of Base`
      if (n.type === "object_declaration") {
        const inh = n.childForFieldName?.("inherits")
        if (inh) {
          q1.onTree++
          const baseRaw = String(inh.text ?? "").trim()
          // The published target is the base TYPE, so compare on the same
          // spelling the run uses. `of H[M, D]` is an instantiation of H and
          // `of rstgen.RstGenerator` is a module-qualified RstGenerator; both are
          // published by leaf. Comparing the raw text made 93 correct edges read
          // as unmatched, so the leaf is derived here and the raw form is kept
          // for the examples.
          const base = baseLeaf(baseRaw)
          const owner = ownerTypeName(n)
          if (!owner) { q1.anonymous++; addEx("anonymous", `${label}: <anonymous> of ${baseRaw}`) }
          else if (owner === base) { q1.selfNamed++; addEx("selfNamed", `${label}: ${owner} of ${baseRaw}`) }
          else if (NIM_COMPILER_ROOTS.has(base)) { q1.compilerRoot++; addEx("compilerRoot", `${label}: ${owner} of ${baseRaw}`) }
          else if (rec?.extendsPairs.has(`${owner} ${base}`)) q1.emitted++
          else if (!rec?.allNames.has(owner)) {
            // The DECLARATION ITSELF was never published, so no edge can exist.
            // A different defect from a dropped edge, and the difference matters:
            // this one costs symbols as well.
            q1.ownerNotPublished++
            addEx("ownerNotPublished", `${label}: ${owner} of ${baseRaw}`)
          } else { q1.unmatched++; addEx("unmatched", `${label}: ${owner} of ${baseRaw}`) }
        }
      }

      // ── Q2: every `Name[...](…)` — a bracket_expression in callee position
      if (n.type === "call" || n.type === "dot_generic_call") {
        const fn = n.childForFieldName?.("function")
        if (fn && fn.type === "bracket_expression") {
          const l = fn.childForFieldName?.("left")
          if (l) {
            q2.onTree++
            const name = String(l.text ?? "").trim()
            const leaf = name.split(".").pop() ?? name
            const isType = !!rec?.typeNames.has(name) || !!rec?.typeNames.has(leaf)
            const isProc = !!rec?.callableNames.has(name) || !!rec?.callableNames.has(leaf)
            if (isType && isProc) { q2.bothTypeAndProc++; addEx("bothTypeAndProc", `${label}: ${name}`) }
            else if (isType) { q2.typeInFile++; addEx("typeInFile", `${label}: ${name}`) }
            else if (isProc) { q2.procInFile++; addEx("procInFile", `${label}: ${name}`) }
            else { q2.notInFile++; addEx("notInFile", `${label}: ${name}`) }
            if (rec?.instTargets.has(name) || rec?.instSources.has(name)) q2.alreadyEmitted++
          }
        }
      }

      // ── Q3: every `method` — the override family, in both receiver spellings
      if (n.type === "method_declaration") {
        q3.methodsOnTree++
        const nm = n.childForFieldName?.("name")
        const name = nm ? String(nm.text) : ""
        const first = receiverFromFirstParameter(n)
        const errRecv = receiverFromErrorNode(n)
        if (errRecv) {
          // The receiver-qualified spelling. Both spellings are legal Nim and a
          // file may use either for the same method name, so the family has to
          // read both or it silently publishes `describe` with no owner.
          q3.recvInErrorNode++
          addEx("recvInErrorNode", `${label}: method ${errRecv}.${name}()`)
          if (rec?.allNames.has(errRecv)) {
            q3.recvInFile++
            if (name) { const a = methodByRecv.get(errRecv) ?? []; a.push(name); methodByRecv.set(errRecv, a) }
          } else { q3.recvNotInFile++; addEx("recvNotInFile", `${label}: ${errRecv}.${name}`) }
        } else if (!first) {
          q3.recvNone++
          addEx("recvNone", `${label}: method ${name} with no readable receiver`)
        } else if (rec?.allNames.has(first)) {
          q3.recvInFile++
          if (name) { const a = methodByRecv.get(first) ?? []; a.push(name); methodByRecv.set(first, a) }
        } else { q3.recvNotInFile++; addEx("recvNotInFile", `${label}: ${first}.${name}`) }
      }
      for (let k = 0; k < n.childCount; k++) walk(n.child(k))
    }
    walk(t.rootNode)

    if (rec) {
      q3.emitted += rec.overrideEdges.length
      for (const e of rec.overrideEdges) {
        const recv = e.src.split(".")[0]
        if (rec.allNames.has(recv)) q3.emittedWithRecvInFile++
        else q3.emittedWithRecvNotInFile++
      }
      // A method name declared twice against the SAME receiver in one file is an
      // override the same-file rule should catch. Count the pairs it did not
      // publish, so "48 edges" can be compared against a denominator.
      for (const [recv, names] of methodByRecv) {
        const seen = new Set<string>()
        for (const n2 of names) {
          if (seen.has(n2)) {
            q3.sameFileMissed++
            addEx("sameFileMissed", `${label}: ${recv}.${n2} declared 2x`)
          }
          seen.add(n2)
        }
      }
    }
    t.delete?.()
  }
}

/** Receiver spelling A — dispatch through the first parameter's type, which is
 *  what the analyzer's `methodReceiverTypeLeaf` reads. Mirrored here so the two
 *  counts are comparable rather than the probe being a second opinion about a
 *  different rule. */
function receiverFromFirstParameter(methodNode: any): string {
  const params = methodNode.childForFieldName?.("parameters")
  if (!params) return ""
  for (let i = 0; i < params.namedChildCount; i++) {
    const p = params.namedChild(i)
    if (!p || p.type !== "parameter_declaration") continue
    const t = p.childForFieldName?.("type")
    if (!t) return ""
    const leaf = typeConstructorLeaf(t)
    return leaf ? String(leaf.text) : ""
  }
  return ""
}

/** Receiver spelling B — `method Receiver.name()`, where the receiver is written
 *  into the name. The pinned grammar does not give it a field; it parses the
 *  `Receiver.` prefix as an ERROR node immediately before the `name` field, so
 *  the only tree-readable form is: an ERROR child whose children are exactly a
 *  dotted chain of `identifier` and `.`, ending right where `name` begins.
 *
 *  The shape test is deliberately strict. An ERROR node can hold anything a
 *  broken file contains, and a receiver invented from arbitrary error text
 *  would be a fabricated `overrides` endpoint — the one mistake this workstream
 *  treats as most expensive. Only `ident(. ident)*` directly before the name
 *  passes. */
function receiverFromErrorNode(methodNode: any): string {
  for (let i = 0; i < methodNode.childCount; i++) {
    const c = methodNode.child(i)
    if (c.type !== "ERROR") continue
    const parts: string[] = []
    let ok = true
    for (let k = 0; k < c.childCount; k++) {
      const g = c.child(k)
      if (g.type === "identifier") parts.push(String(g.text))
      else if (g.type === ".") { if (parts.length === 0) { ok = false; break } }
      else { ok = false; break }
    }
    if (ok && parts.length >= 2) return parts.join(".")
  }
  return ""
}

/** The constructor name of a type expression: `ref object of T` -> T,
 *  `array[3, T]` -> array, `T[int]` -> T. A null return means the type expression
 *  is not a plain named type and therefore has no receiver leaf. */
function typeConstructorLeaf(t: any): any {
  switch (t.type) {
    case "type_expression":
    case "ref_type":
    case "object_type":
    case "distinct_type":
    case "pointer_type":
      for (let i = 0; i < t.namedChildCount; i++) {
        const c = t.namedChild(i)
        if (c.type === "identifier" || c.type === "type_qualifier") return c
        const nested = typeConstructorLeaf(c)
        if (nested) return nested
      }
      return null
    default:
      return null
  }
}

treeWorker()

const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`)
const w = (s: string, n: number): string => (s + " ".repeat(n)).slice(0, n)

console.log(`\n=== Q1  extends delta — every object_declaration.inherits on the tree`)
console.log(`  occurrences on the tree              : ${q1.onTree}`)
console.log(`  published as extends                 : ${q1.emitted}`)
console.log(`  anonymous object (no named owner)     : ${q1.anonymous}`)
console.log(`  self-named (type X = object of X)     : ${q1.selfNamed}`)
console.log(`  compiler root (of RootRef/Object)     : ${q1.compilerRoot}`)
console.log(`  owner symbol NOT published at all    : ${q1.ownerNotPublished}`)
console.log(`  UNMATCHED (owner published, no edge)  : ${q1.unmatched}`)
console.log(`  accounted                             : ${q1.emitted + q1.anonymous + q1.selfNamed + q1.compilerRoot + q1.ownerNotPublished + q1.unmatched} / ${q1.onTree}`)
for (const k of Object.keys(q1ex)) { if (q1ex[k].length) { console.log(`  ${k}:`); for (const e of q1ex[k]) console.log(`    ${e}`) } }

console.log(`\n=== Q2  instantiates delta — every bracket_expression in callee position`)
console.log(`  occurrences on the tree              : ${q2.onTree}`)
console.log(`  this file declares the name as a TYPE : ${q2.typeInFile}`)
console.log(`  this file declares the name as a PROC : ${q2.procInFile}`)
console.log(`  declared as BOTH (ambiguous)          : ${q2.bothTypeAndProc}`)
console.log(`  not declared in this file at all      : ${q2.notInFile}`)
console.log(`  of those, an instantiates edge exists : ${q2.alreadyEmitted}`)
for (const k of Object.keys(q2ex)) { if (q2ex[k].length) { console.log(`  ${k}:`); for (const e of q2ex[k]) console.log(`    ${e}`) } }

console.log(`\n=== Q3  overrides — the cross-file family`)
console.log(`  method_declarations on the tree      : ${q3.methodsOnTree}`)


console.log(`  receiver from the first parameter     : ${q3.recvInFile + q3.recvNotInFile - q3.recvInErrorNode}`)
console.log(`  receiver from the receiver-qualified spelling : ${q3.recvInErrorNode}  (an ERROR node — a parse shape, not a spelling)`)
console.log(`  receiver NOT readable at all          : ${q3.recvNone}`)
console.log(`  of the readable ones, declared in the SAME file : ${q3.recvInFile}`)
console.log(`  of the readable ones, declared in ANOTHER file : ${q3.recvNotInFile}`)
console.log(`  overrides edges the run published    : ${q3.emitted}  (recv in-file ${q3.emittedWithRecvInFile}, recv out-of-file ${q3.emittedWithRecvNotInFile})`)
console.log(`  same-receiver method declared twice, NOT published: ${q3.sameFileMissed}`)
for (const k of Object.keys(q3ex)) { if (q3ex[k].length) { console.log(`  ${k}:`); for (const e of q3ex[k]) console.log(`    ${e}`) } }
console.log(`\n  raw-parse failures: ${parseErr}`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    analyzerSha256: HASH_BEFORE, analyzerStableDuringRun: analyzerHash() === HASH_BEFORE,
    workers: WORKERS, files: files.length, rawParseFailures: parseErr, q1, q2, q3, q1ex, q2ex, q3ex }, null, 2))
  console.log(`analyzer sha256 after the walk : ${HASH_BEFORE.slice(0, 16)}${analyzerHash() === HASH_BEFORE ? "  (unchanged — every number above is tied to this analyzer state)" : "  CHANGED DURING THE RUN — the numbers above are a MIXTURE of two analyzer states and are not reproducible"}`)
  console.log(`wrote ${OUT}`)
}
