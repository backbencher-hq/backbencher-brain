#!/usr/bin/env tsx
/**
 * JAVASCRIPT lane — STORE RESOLUTION: which symbol an emitted edge ACTUALLY lands on,
 * read back from sqlite after the real indexer ran.
 *
 * ## Why this exists, and why it is not the incoming gate
 *
 * `script/m14/incoming-gate.ts` compares a target STRING against declaration strings in
 * the sampled files. That is a worklist, not the product: the store has a multi-strategy
 * resolver (`parallel-indexer.ts`, the `_res_qname` / `_res_name_unique` passes plus
 * `resolveImportTargets` and `retargetCrossFileOverrides`) that the gate does not run. So
 * the gate can report `imports 0/430 resolved` while the store resolves 99% of them
 * through `<module>:<item>` metadata, and it can report `overrides` as unresolved while
 * the store's cross-file retarget re-points them at a declaring ancestor.
 *
 * This instrument indexes a JS-only project through `indexProjectParallel` into a temp
 * data dir and reads `brain_relationship.target_symbol_id` / `source_symbol_id` back.
 * Every number is the graph a consumer queries.
 *
 * ## What it can and cannot claim
 *
 * An attached target is CORRECT when the declaration it names is in the edge's own
 * source file and the edge's target is that file's declaration (decidable: the source
 * file's own symbols). When the target is not declared in the source file, the right
 * module is not decidable from one file, so the row is reported as UNVERIFIABLE beside
 * the scored ones and never added to them. A DETACHED row (target_external set,
 * target_symbol_id NULL) is the real "incoming unresolved" population.
 *
 * ## The residue is CLASSIFIED, not counted
 *
 * A detached total is a population that has not been asked why, so every detached row is
 * assigned exactly one reason code, and every NULL-source row is split the same way. The
 * classes are mutually exclusive and exhaustive BY CONSTRUCTION, and each table prints its
 * own sum against its total, so a class that stops matching shows up as a non-zero
 * `unclassified` remainder rather than as a quieter total:
 *
 *   1  the SOURCE is unattributed          2  the label is out of the resolver's scope
 *   3  the target is a PARAMETER of the row's own source (a binding, so DETACHED is right)
 *   4  the row's file records NO binding for the leaf     5  the binding's module is EXTERNAL
 *   6  the module is relative but resolves OUTSIDE the draw (the sample boundary)
 *   7  the module is INSIDE the draw AND DECLARES the leaf  <- the ONLY class that is this
 *      lane's open work. It reads 0 on both draws measured; the two corrections that got
 *      it there (the draw-boundary test, and BINDING vs DECLARATION for a namespace or
 *      default binding whose module declares no symbol of that name) are recorded in
 *      `docs/analyzers/real-javascript-analyzer.md` and JSD47 in the lane's spec.
 *   8  the module is INSIDE the draw but declares NO symbol of that name (the binding case)
 *
 * Class 4 (no binding for the leaf) is sub-split four ways — stdlib name · a name the draw
 * DOES declare · a chain segment · a bare read — because "no binding" lumps a prototype
 * method, a property read and a declarable name into one number. Class 1 defers to the
 * OUTGOING table, so the two tables are cross-checked for closure and the agreement is
 * printed (rows with BOTH ends unattributed vs class 1).
 *
 * The classes are written into `--json` under `diagnosis.nameSpelledByReason`,
 * `detachedByReason`, `noBindingSubClasses` and `noBindingByShape`, WITH the zero-valued
 * keys included: a key absent because it matched nothing and a key absent because the code
 * stopped emitting it are the same JSON, and a consumer would read the second as the first.
 *
 * ## Usage
 *
 *   bun run script/m14/javascript-store-resolution.mts [--corpus=<dir>] [--files=250] [--json=<out>]
 *
 * Default corpus is the pinned JS corpus (svelte). The sample is the deterministic FIRST
 * `--files` of the sorted admitted list, so two runs are comparable.
 *
 * Numbers from this instrument are reproducible to a bound, and the variance is LOCALIZED:
 * it indexes through `indexProjectParallel`, so class 1 (whose source resolution is a race
 * between workers) moves by a few rows between runs while every other class is
 * byte-identical. Cite the classes, not a single detached total.
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const FILES = Number(arg("files") ?? "250")
const CORPUS = arg("corpus") ?? "$HOME/fixtures/repositories/svelte"
const JSON_OUT = arg("json")

const TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const

const JS_EXTS = /\.(js|mjs|cjs)$/

/**
 * The ECMAScript standard library surface, ENUMERATED FROM THE RUNNING ENGINE rather than
 * typed from memory: every own property of every built-in prototype, every static member
 * of every built-in constructor, and every global. The list is a by-product of executing
 * this program, so it cannot rot into a stale hand-copy, and "is this name part of the
 * language's standard library" becomes a question the runtime answers.
 *
 * It is deliberately the ENGINE's surface and not a specification scrape. A name this set
 * does not contain is not thereby "not standard" — it is simply not adjudicated here, and
 * the report keeps the two apart rather than implying the second from the first.
 */
function ecmaStdlibNames(): Set<string> {
  const names = new Set<string>()
  const addAll = (o: any) => { if (o) for (const n of Object.getOwnPropertyNames(o)) names.add(n) }
  const protos = [
    Object.prototype, Function.prototype, Array.prototype, String.prototype,
    Number.prototype, Boolean.prototype, Symbol.prototype, BigInt.prototype,
    Date.prototype, RegExp.prototype, Error.prototype, Promise.prototype,
    Map.prototype, Set.prototype, WeakMap.prototype, WeakSet.prototype,
    ArrayBuffer.prototype, DataView.prototype,
  ]
  for (const p of protos) addAll(p)
  // Read the constructors by NAME off the global object rather than by bare reference:
  // `AsyncIterator` is not a global in every engine, and a bare reference to a missing
  // one throws here rather than measuring anything. A name the engine does not define is
  // simply absent from the set.
  const ctorNames = [
    "Object", "Function", "Array", "String", "Number", "Boolean", "Symbol", "BigInt",
    "Date", "RegExp", "Error", "TypeError", "RangeError", "SyntaxError", "EvalError",
    "ReferenceError", "URIError", "AggregateError", "Promise", "Map", "Set", "WeakMap",
    "WeakSet", "WeakRef", "FinalizationRegistry", "JSON", "Math", "Reflect", "Proxy",
    "ArrayBuffer", "SharedArrayBuffer", "DataView", "Int8Array", "Uint8Array",
    "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array",
    "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array", "Iterator",
    "AsyncIterator", "Atomics", "Intl", "WebAssembly",
  ]
  for (const key of ctorNames) {
    const v = (globalThis as any)[key]
    if (!v) continue
    addAll(v)
    if (v.prototype) addAll(v.prototype)
  }
  addAll(globalThis)
  return names
}

/** git-tracked js-family files under one corpus, size-capped, sorted (deterministic). */
function admitted(): string[] {
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", CORPUS, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 })
      .split("\0").filter(Boolean)
  } catch {
    console.error(`not a git checkout: ${CORPUS}`)
    process.exit(1)
  }
  const out: string[] = []
  for (const rel of tracked.sort()) {
    if (!JS_EXTS.test(rel)) continue
    const abs = path.join(CORPUS, rel)
    try { if (fs.statSync(abs).size > 512 * 1024) continue } catch { continue }
    out.push(abs)
  }
  return out
}

async function main() {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-js-res-"))
  const projDir = path.join(workdir, "proj")
  fs.mkdirSync(projDir, { recursive: true })
  const taken = admitted().slice(0, FILES)
  if (taken.length === 0) { console.error(`no js files under ${CORPUS}`); process.exit(1) }
  for (const f of taken) {
    // keep the corpus-relative path so the sample stays a folder tree the indexer walks
    const rel = path.relative(CORPUS, f)
    const dest = path.join(projDir, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, fs.readFileSync(f))
  }
  const dataDir = path.join(workdir, "data")
  fs.mkdirSync(dataDir, { recursive: true })
  process.env.BB_DATA_DIR = dataDir

  console.log(`javascript store resolution`)
  console.log(`corpus:        ${CORPUS}`)
  console.log(`files indexed: ${taken.length} (deterministic FIRST of the sorted admitted list)`)
  console.log(`project dir:   ${projDir}\n`)

  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const pid = getProjectId(projDir) as any
  const t0 = Date.now()
  const stats = await indexProjectParallel(pid, projDir, { onProgress: () => {} })
  const ms = Date.now() - t0
  console.log(`indexed in ${ms} ms: ${JSON.stringify(stats)}\n`)

  const raw: any = await BrainDatabase.getRawInstance(pid)
  const q = (sql: string, ...a: any[]) => raw.prepare(sql).all(...a) as any[]

  const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
  /** relpath -> name -> set(lines) the ANALYZER published (the source-file oracle) */
  const declAtLine = new Map<string, Map<string, Set<number>>>()
  /** name -> files in the sample that publish it. The cross-file candidate index: a
   *  detached target whose name IS here is a binding that SHOULD have happened; one whose
   *  name is nowhere in the sample names something the sample cannot contain. */
  const declByName = new Map<string, Set<string>>()
  let analyzerEdges = 0
  const analyzerByType: Record<string, number> = {}
  for (const f of taken) {
    // The PROJECT-relative path, which is the spelling the store stores: the file was
    // COPIED to `projDir/<corpus-relative>` above, and the store's own `relativePath`
    // for every row is that same string. `path.relative(projDir, f)` (the corpus path
    // against the temp dir) is a `../../…` string that matches nothing in the DB — it
    // silently emptied every `declAtLine.get(sourceFile)` lookup below and made the
    // file-level membership test unsatisfiable.
    const rel = path.relative(CORPUS, f)
    let r: any
    try { r = await parseFile(f, rel, undefined as any) } catch { continue }
    const perFile = declAtLine.get(rel) ?? new Map<string, Set<number>>()
    for (const s of r?.symbols ?? []) {
      let lines = perFile.get(String(s.name))
      if (!lines) perFile.set(String(s.name), (lines = new Set()))
      lines.add(s.range?.startLine ?? 0)
      let files = declByName.get(String(s.name))
      if (!files) declByName.set(String(s.name), (files = new Set()))
      files.add(rel)
    }
    declAtLine.set(rel, perFile)
    for (const e of r?.relationships ?? []) {
      analyzerEdges++
      const t = String(e.type ?? "")
      analyzerByType[t] = (analyzerByType[t] ?? 0) + 1
    }
  }

  const relRows = q(`
    SELECT r.relationship_type AS t,
           r.target_external  AS tgt,
           r.source_external  AS src,
           r.line_number      AS line,
           r.source_symbol_id AS sid,
           r.target_symbol_id AS tid,
           r.metadata         AS md,
           ss.qualified_name  AS sqname,
           ss.name            AS sname,
           ss.parameters      AS sparams,
           sf.relative_path   AS sfile,
           tf.relative_path   AS tfile,
           ts.name            AS tname
    FROM brain_relationship r
    LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
    LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
    LEFT JOIN brain_file sf ON sf.id = s.file_id
    LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
    LEFT JOIN brain_file tf ON tf.id = ts.file_id
    WHERE r.project_id = ?
  `, pid) as any[]

  // ── OVERRIDES: IS THE TARGET AN ANCESTOR THAT DECLARES THE METHOD? ──
  //
  // The one question an `overrides` edge has to answer for itself, and the one the
  // store's `retargetCrossFileOverrides` pass exists to make answerable: the target
  // must be a DECLARING ANCESTOR of the source, not merely a same-named symbol. This is
  // recomputed here from the written index rather than from the pass's return value, so
  // it measures the stored graph and not the pass's opinion of it.
  const symRows = q(
    `SELECT id, name, qualified_name, symbol_type, super_types, file_id FROM brain_symbol WHERE project_id = ?`, pid,
  ) as any[]
  const fileById = new Map<string, string>()
  for (const f of q(`SELECT id, relative_path FROM brain_file WHERE project_id = ?`, pid) as any[]) {
    fileById.set(String(f.id), String(f.relative_path))
  }
  // the leaf-candidate census below needs name AND the file that declares it
  const storedNamesAnywhere = new Map<string, number>()
  const storedNamesByFile = new Map<string, Set<string>>()
  for (const s of symRows) {
    const nm = String(s.name ?? "")
    if (!nm) continue
    storedNamesAnywhere.set(nm, (storedNamesAnywhere.get(nm) ?? 0) + 1)
    const fp = fileById.get(String(s.file_id)) ?? ""
    if (!fp) continue
    let names = storedNamesByFile.get(fp)
    if (!names) storedNamesByFile.set(fp, (names = new Set()))
    names.add(nm)
  }
  // The names each file BINDS — `brain_import` is the resolver's evidence, so a detached
  // row with no binding for its leaf in its own file is not a resolver failure at all, and
  // the reason table below needs exactly that distinction to be a classification rather
  // than a count. `imported_as ?? imported_name` is the same expression `patterns.ts` uses.
  // name -> the MODULES it is bound from, because "a binding exists" is not the same
  // question as "the import statement can name a project file": `const fs = require('fs')`
  // binds `fs`, and no resolver can turn that into a symbol — measured, this distinction
  // moved most of what first looked like resolver-eligible residue into a class that is
  // correctly refused, which is the whole point of classifying instead of counting.
  const bindingsByFile = new Map<string, Map<string, string[]>>()
  for (const i of q(
    `SELECT f.relative_path AS file, i.imported_as AS as_, i.imported_name AS nm, i.import_path AS path
       FROM brain_import i JOIN brain_file f ON f.id = i.file_id WHERE i.project_id = ?`, pid,
  ) as any[]) {
    const file = String(i.file ?? "")
    const name = String(i.as_ ?? i.nm ?? "")
    if (!file || !name) continue
    let byName = bindingsByFile.get(file)
    if (!byName) bindingsByFile.set(file, (byName = new Map()))
    const arr = byName.get(name) ?? []
    arr.push(String(i.path ?? ""))
    byName.set(name, arr)
  }

  const supertypes = new Map<string, string[]>()
  const qnameById = new Map<string, string>()
  const nameById = new Map<string, string>()
  for (const s of symRows) {
    const id = String(s.id)
    qnameById.set(id, String(s.qualified_name ?? ""))
    nameById.set(id, String(s.name ?? ""))
    if (!s.super_types) continue
    try {
      const arr = JSON.parse(String(s.super_types))
      if (Array.isArray(arr)) {
        const names = arr.filter((x): x is string => typeof x === "string" && x.length > 0)
        if (names.length) supertypes.set(String(s.name), names)
      }
    } catch { /* a row that will not parse is not heritage */ }
  }
  /** owner -> member names it declares, from the container-qualified qualified_name. */
  const methodsByOwner = new Map<string, Set<string>>()
  for (const s of symRows) {
    if (String(s.symbol_type) !== "method") continue
    const qn = qnameById.get(String(s.id)) ?? ""
    const nm = String(s.name ?? "")
    if (!nm || !qn.endsWith(`.${nm}`)) continue
    const owner = qn.slice(0, qn.length - nm.length - 1)
    if (!owner) continue
    let set = methodsByOwner.get(owner)
    if (!set) methodsByOwner.set(owner, (set = new Set()))
    set.add(nm)
  }
  /** Every ancestor of `start`, breadth-first, bounded (scala3 measured depth 14). */
  const ancestorsOf = (start: string): Set<string> => {
    const seen = new Set<string>()
    let frontier = supertypes.get(start) ?? []
    let depth = 0
    while (frontier.length && depth < 16) {
      const next: string[] = []
      for (const t of frontier) {
        if (!t || seen.has(t)) continue
        seen.add(t)
        next.push(...(supertypes.get(t) ?? []))
      }
      frontier = [...new Set(next)]
      depth++
    }
    return seen
  }

  const ovRows = relRows.filter((r) => r.t === "overrides")
  let ovNoOwner = 0
  let ovNoHierarchy = 0
  let ovVerified = 0
  let ovUnverified = 0
  const ovWrong: string[] = []
  for (const r of ovRows) {
    // The source's owner: the analyzer's own spelling, or the identity of the symbol
    // the source resolved to when there is no external spelling (the same two reads
    // the retarget makes).
    let owner = ""
    const ext = String(r.src ?? "")
    const qn = String(r.sqname ?? "")
    const srcName = String(r.sname ?? "")
    const dotted = ext.includes(".") ? ext : qn.includes(".") ? qn : ""
    if (dotted) owner = dotted.slice(0, dotted.lastIndexOf("."))
    if (!owner) {
      // a bare external spelling IS the owner when the row names a class, but a member
      // row that reached here named only its method and cannot be attributed.
      owner = ext || srcName
      if (!owner) { ovNoOwner++; continue }
    }
    const anc = ancestorsOf(owner)
    if (anc.size === 0) { ovNoHierarchy++; continue }
    const tgtName = String(r.tname ?? "") || String(r.tgt ?? "").split(".").pop() || ""
    let verified = false
    for (const a of anc) if (methodsByOwner.get(a)?.has(tgtName)) { verified = true; break }
    if (verified) ovVerified++
    else {
      ovUnverified++
      if (ovWrong.length < 10) ovWrong.push(`${owner} --overrides--> ${String(r.tgt)} (resolved to ${String(r.tname ?? "-")})`)
    }
  }

  console.log(`analyzer edges: ${analyzerEdges}   stored edges: ${relRows.length}`)
  console.log(`per-label analyzer vs stored:`)
  for (const t of TYPES) {
    const a = analyzerByType[t] ?? 0
    const s2 = relRows.filter((r) => r.t === t).length
    console.log(`  ${t.padEnd(13)} analyzer ${String(a).padStart(7)}   stored ${String(s2).padStart(7)}   ${a === s2 ? "match" : "DIFFER"}`)
  }

  type Row = { n: number; nullTarget: number; detached: number; wrongFile: number; correct: number; unverifiable: number; nullSource: number }
  const rows: Record<string, Row> = {}
  for (const t of TYPES) rows[t] = { n: 0, nullTarget: 0, detached: 0, wrongFile: 0, correct: 0, unverifiable: 0, nullSource: 0 }

  // Incoming side: attached target symbols and how many inbound edges each carries.
  const inboundCount = new Map<string, number>()

  for (const r of relRows) {
    const k = rows[r.t]
    if (!k) continue
    k.n++
    if (!r.sid) k.nullSource++
    if (r.tgt == null) { k.nullTarget++; continue }
    if (r.tid == null) { k.detached++; continue }
    inboundCount.set(String(r.tid), (inboundCount.get(String(r.tid)) ?? 0) + 1)
    if (r.sfile && r.tfile && r.sfile !== r.tfile) {
      const perFile = declAtLine.get(r.sfile)
      const declaredHere = !!perFile?.has(String(r.tgt))
      if (declaredHere) k.wrongFile++
      else k.unverifiable++
    } else {
      k.correct++
    }
  }

  /** Incoming: distinct target symbols carrying >= 1 attached edge, and the whole graph's
   *  attached/total ratio — the number a consumer experiences as "links resolve". */
  const symbolsTotal = (q(`SELECT count(*) AS c FROM brain_symbol WHERE project_id = ?`, pid)[0] as any)?.c ?? 0
  const symbolsWithInbound = inboundCount.size

  const pad = (n: number) => String(n).padStart(7)
  console.log(`\nWHERE THE EDGE LANDED — per label (outgoing source / incoming target)`)
  console.log(`type            edges  nullTgt  detached  wrongFile  correct  unverifiable  nullSrc  attached%`)
  console.log(`-`.repeat(100))
  let T: Row = { n: 0, nullTarget: 0, detached: 0, wrongFile: 0, correct: 0, unverifiable: 0, nullSource: 0 }
  for (const t of TYPES) {
    const k = rows[t]
    if (!k.n) { console.log(`${t.padEnd(13)} ${"(not emitted)".padStart(37)}`); continue }
    for (const key of Object.keys(T) as (keyof Row)[]) T[key] += k[key]
    const attached = k.n - k.nullTarget - k.detached
    const pct = k.n ? (100 * attached / k.n).toFixed(1) + "%" : "n/a"
    console.log(`${t.padEnd(13)}${pad(k.n)}${pad(k.nullTarget)}${pad(k.detached)}${pad(k.wrongFile)}${pad(k.correct)}${pad(k.unverifiable)}${pad(k.nullSource)}   ${pct.padStart(6)}`)
  }
  console.log(`-`.repeat(100))
  {
    const k = T
    const attached = k.n - k.nullTarget - k.detached
    const pct = k.n ? (100 * attached / k.n).toFixed(1) + "%" : "n/a"
    console.log(`${"ALL".padEnd(13)}${pad(k.n)}${pad(k.nullTarget)}${pad(k.detached)}${pad(k.wrongFile)}${pad(k.correct)}${pad(k.unverifiable)}${pad(k.nullSource)}   ${pct.padStart(6)}`)
  }

  // ── DIAGNOSIS: WHICH detached target names are BINDABLE, and which are not ──
  //
  // A detached row is `target_external` set with `target_symbol_id` NULL. Two very
  // different populations wear that shape, and separating them is the whole question:
  //
  //   BINDABLE   the name is published by at least one file IN THE SAMPLE, so a
  //              resolver that saw the whole sample had a candidate and did not take
  //              it — should-bind-but-didn't, i.e. a real defect.
  //   NOWHERE    the name is published by NO file in the sample. The sample cannot
  //              contain the declaration, so one file's evidence cannot place it.
  const detachedByType: Record<string, { bindable: number; nowhere: number; n: number }> = {}
  const bindableTop = new Map<string, number>()
  const nowhereTop = new Map<string, number>()
  /** the SAME counts, but over EVERY nowhere name rather than the top 25 shown above. */
  const nowhereTopAll = new Map<string, number>()
  for (const r of relRows) {
    if (r.tgt == null || r.tid != null) continue
    const k = (detachedByType[r.t] ??= { bindable: 0, nowhere: 0, n: 0 })
    k.n++
    const name = String(r.tgt)
    const where = declByName.has(name) ? bindableTop : nowhereTop
    where.set(name, (where.get(name) ?? 0) + 1)
    if (declByName.has(name)) k.bindable++
    else { k.nowhere++; nowhereTopAll.set(name, (nowhereTopAll.get(name) ?? 0) + 1) }
  }
  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)

  console.log(`\nDETACHED TARGET split — is the name published by ANY file in the sample?`)
  console.log(`type            detached  bindable  nowhere`)
  console.log(`-`.repeat(48))
  let DT = { n: 0, bindable: 0, nowhere: 0 }
  for (const t of TYPES) {
    const k = detachedByType[t]
    if (!k) continue
    DT.n += k.n; DT.bindable += k.bindable; DT.nowhere += k.nowhere
    console.log(`${t.padEnd(13)}${pad(k.n)}${pad(k.bindable)}${pad(k.nowhere)}`)
  }
  console.log(`-`.repeat(48))
  console.log(`${`ALL`.padEnd(13)}${pad(DT.n)}${pad(DT.bindable)}${pad(DT.nowhere)}`)
  console.log(`\nBINDABLE detached targets (declared in the sample, still unbound) — top 20:`)
  for (const [name, c] of top(bindableTop, 20)) console.log(`  ${String(c).padStart(6)}  ${name}`)
  console.log(`\nNOWHERE detached targets (no file in the sample publishes this name) — top 25:`)
  for (const [name, c] of top(nowhereTop, 25)) console.log(`  ${String(c).padStart(6)}  ${name}`)

  // ── HOW MUCH OF "NOWHERE" IS THE LANGUAGE'S OWN STANDARD LIBRARY? ──
  //
  // A detached target naming `substring`, `hasOwnProperty`, `preventDefault` or `length`
  // is not a broken project reference and not a project declaration either: it names a
  // member of the LANGUAGE's standard library, which no file in any corpus declares.
  // Counted against the set enumerated from the running engine above, so the number is
  // reproducible here and does not depend on a list someone maintained.
  const std = ecmaStdlibNames()
  let nowhereStd = 0
  let nowhereOther = 0
  const nowhereStdTop = new Map<string, number>()
  const nowhereOtherTop = new Map<string, number>()
  for (const [name, c] of nowhereTopAll) {
    if (std.has(name)) { nowhereStd += c; nowhereStdTop.set(name, c) }
    else { nowhereOther += c; nowhereOtherTop.set(name, c) }
  }
  console.log(`\nNOWHERE split against the ECMAScript standard library (enumerated from the engine):`)
  console.log(`  standard-library member names : ${nowhereStd}  ${DT.nowhere ? (100 * nowhereStd / DT.nowhere).toFixed(1) : "n/a"}%`)
  console.log(`  NOT in that set               : ${nowhereOther}  ${DT.nowhere ? (100 * nowhereOther / DT.nowhere).toFixed(1) : "n/a"}%`)
  console.log(`\n  standard-library target names — top 20:`)
  for (const [name, c] of top(nowhereStdTop, 20)) console.log(`  ${String(c).padStart(6)}  ${name}`)
  console.log(`\n  NOT-in-set target names — top 25:`)
  for (const [name, c] of top(nowhereOtherTop, 25)) console.log(`  ${String(c).padStart(6)}  ${name}`)

  // ── DIAGNOSIS: WHICH SOURCES ARE DANGLING, AND WHICH ARE THE FILE ──
  //
  // `source_symbol_id IS NULL` means the edge names an actor that is not a stored
  // symbol: `source_external` holds the analyzer's spelling. TWO populations wear that
  // shape and they mean OPPOSITE things, which is why this is a SPLIT and not one
  // `NULL` count — the number alone cannot tell a lost actor from a file:
  //
  //   FILE-LEVEL   `source_external` IS this row's project-relative path. The actor is
  //                the FILE, the store has no symbol row for a file, and the row IS
  //                attributed: `graph_request.ts` selects exactly these rows by
  //                `source_external = <path>` (M60/#910), which is how "what does this
  //                file depend on" is answered. The analyzers reach it by spelling the
  //                actor with the family's file-level sentinel (`(file)` — rust, scala,
  //                kotlin, zig, graphql, nim) and stamping `metadata.fileLevel`, on a
  //                row whose source name matched no symbol (the store's branch is
  //                `!sourceSymbol && metadata.fileLevel`).
  //   NAME-SPELLED `source_external` is a bare NAME that matched no declaration in its
  //                own file. This is the real outgoing defect.
  //
  // A source string that HAPPENS to equal a sample path is treated as file-level; the
  // membership test is against the sample's own path set, so it cannot be satisfied by a
  // name, and a path-spelled source is not something a name-spelling analyzer produces.
  const samplePaths = new Set(declAtLine.keys())
  const danglingTop = new Map<string, number>()
  const nameSpelledTop = new Map<string, number>()
  const fileLevelByType = new Map<string, number>()
  let fileLevelRows = 0
  let nameSpelledRows = 0
  let sentinelRows = 0
  // REASON CODES for the defect half, so the residue is CLASSIFIED rather than counted.
  // Each class is decidable from this draw alone (the stored names, the engine's own
  // standard-library set, and the spelling itself) and the classes are exhaustive by
  // construction — which is what lets the sum check below print `unclassified: 0`
  // instead of an "other" bucket.
  const nameSpelledReason = new Map<string, number>()
  const REASON_KEYWORD = "a keyword actor (this/super) — refused by the name register, so it can never be a symbol row"
  const REASON_DECLARED = "a name the sample DOES declare — a source-side attachment the name pass did not make"
  const REASON_STDLIB = "an ECMAScript standard-library member name — no project file declares it by construction"
  const REASON_NEITHER = "neither — an external surface (DOM/node/browser) or a local binding the language does not publish"
  for (const r of relRows) {
    if (r.sid != null) continue
    const src = String(r.src ?? "(null)")
    const key = `${String(r.t).padEnd(12)} ${src}`
    danglingTop.set(key, (danglingTop.get(key) ?? 0) + 1)
    if (src === "(file)") sentinelRows++
    if (samplePaths.has(src)) {
      fileLevelRows++
      fileLevelByType.set(String(r.t), (fileLevelByType.get(String(r.t)) ?? 0) + 1)
      continue
    }
    nameSpelledRows++
    nameSpelledTop.set(key, (nameSpelledTop.get(key) ?? 0) + 1)
    const reason = src === "this" || src === "super"
      ? REASON_KEYWORD
      : storedNamesAnywhere.has(src)
        ? REASON_DECLARED
        : std.has(src) ? REASON_STDLIB : REASON_NEITHER
    nameSpelledReason.set(reason, (nameSpelledReason.get(reason) ?? 0) + 1)
  }
  console.log(`\nOUTGOING SPLIT — source_symbol_id NULL, ${T.nullSource} row(s), two populations that mean opposite things:`)
  console.log(`  FILE-LEVEL  source_external IS this row's project-relative path (attributed) : ${fileLevelRows}`)
  // This one must be ZERO: the store's file-level branch (M60/#910) rewrites the source
  // to the project-relative path, so a raw sentinel still sitting in `source_external`
  // would mean the branch did NOT fire — i.e. the name-resolution lookup matched the
  // sentinel, or `metadata.fileLevel` never survived the seam. It is a check on the
  // store's half of the contract, not a population count.
  console.log(`    rows where the store did NOT rewrite the sentinel (must be 0)               : ${sentinelRows}`)
  console.log(`  NAME-SPELLED a name no declaration in its own file carries (the defect)      : ${nameSpelledRows}`)
  if (fileLevelByType.size) {
    console.log(`  file-level rows by label: ${[...fileLevelByType.entries()].sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t} ${c}`).join(", ")}`)
  }
  console.log(`\nNAME-SPELLED SOURCES (a lost actor, not a file) — top 25 of ${nameSpelledRows}:`)
  for (const [name, c] of top(nameSpelledTop, 25)) console.log(`  ${String(c).padStart(6)}  ${name}`)
  console.log(`\n  NAME-SPELLED BY REASON — every row of the ${nameSpelledRows} above, classified:`)
  let nsClassified = 0
  for (const [reason, c] of [...nameSpelledReason.entries()].sort((a, b) => b[1] - a[1])) {
    nsClassified += c
    console.log(`    ${String(c).padStart(6)}  ${reason}`)
  }
  console.log(`    ${String(nsClassified).padStart(6)}  = total; unclassified: ${nameSpelledRows - nsClassified}`)

  // ── INCOMING: WHAT THE DETACHED TARGETS NAME, AND WHAT COULD EVER BIND THEM ──
  //
  // The counterpart of the outgoing split above, and the reason the lane's
  // remaining work is not "more of the same". A detached `uses` row carries the
  // analyzer's own shape flags, and each shape has ONE legitimate route to a
  // binding — or none:
  //
  //   chain SEGMENT   a property name (`node.attributes` -> `attributes`). The
  //                   only honest route is the RECEIVER'S TYPE: the file must
  //                   state it (JSDoc `@param {Type} node`), the type must be
  //                   declared here, and the member must be declared by it.
  //   BARE read       a name the file reads but does not declare
  //                   (`if (flag)`). If it is a global it is EXTERNAL by
  //                   construction; if it is a local binding it is NOT a symbol
  //                   and may not become one — see the contract note below.
  //   chain ROOT /    the receiver of a read or a call. Same two cases as a bare
  //   call RECEIVER   read, and `document`/`window` land in the external one.
  //
  // The parameter column is the measurement that closes the design question
  // rather than leaving it open: for each detached row it asks whether the
  // target IS a parameter of the row's own source symbol. That is the population
  // a "publish parameters as symbols" design would have bound, and publishing
  // them is FORBIDDEN repo-wide (`SymbolKind` has no Parameter member; csharp
  // removed its own under ParamsAreNotSymbols/LocalsAreNotSymbols, and
  // swift/kotlin/julia record the removal). A binding is not a declaration, so
  // the number is a bound on a route that is closed — reported so nobody has to
  // re-derive that, and so the open route (receiver typing) is sized against it.
  const shapeOf = (r: any): string => {
    let md: any = {}
    try { md = typeof r.md === "string" ? JSON.parse(r.md) : (r.md ?? {}) } catch { md = {} }
    if (r.t === "uses") {
      if (md.isTemplateInterpolation) return "uses template read"
      if (md.callReceiver) return "uses call RECEIVER root"
      if (md.chainRoot) return "uses chain ROOT"
      if (md.isFieldAccess && !md.bareRead) return "uses chain SEGMENT (property name)"
      if (md.bareRead) return "uses BARE read"
      return "uses other"
    }
    return `${String(r.t)} row`
  }
  const shapeTotals = new Map<string, number>()
  const shapeByLabel = new Map<string, number>()
  let paramOfEnclosing = 0
  let leafCandidateAnywhere = 0
  let leafCandidateOwnFile = 0
  const paramExamples: string[] = []
  const leafCandidateExamples: string[] = []
  const exampleNames = new Set<string>()
  // DETACHED is a TARGET-side fact (`target_symbol_id` NULL, a name in `target_external`),
  // so the skip is on the TARGET. The first version of this block reused the outgoing
  // loop's test (`sid != null` -> skip) and therefore censused only the 2,894 rows whose
  // SOURCE is also unattributed — a population in which, by construction, almost no row
  // has an enclosing function with parameters, which is how it printed "0 parameters"
  // next to a SQL count of 1,358. The two numbers must agree; they now do.
  for (const r of relRows) {
    if (r.tid != null || r.tgt == null) continue
    const shape = shapeOf(r)
    shapeTotals.set(shape, (shapeTotals.get(shape) ?? 0) + 1)
    shapeByLabel.set(String(r.t), (shapeByLabel.get(String(r.t)) ?? 0) + 1)
    // `parameters` is the source symbol's own signature — the enclosing
    // declaration the edge's source resolved to.
    let params: string[] = []
    try {
      const v = JSON.parse(String(r.sparams ?? "[]"))
      if (Array.isArray(v)) params = v.map((p: any) => (typeof p === "string" ? p : String(p?.name ?? "")))
    } catch { /* a signature that will not parse names no parameter */ }
    const leaf = String(r.tgt).split(/[:.]/).filter(Boolean).pop() ?? ""
    if (leaf && params.includes(leaf)) {
      paramOfEnclosing++
      if (paramExamples.length < 5) paramExamples.push(`${r.t}  ${String(r.sfile ?? "?")}  ${shape} -> ${leaf}`)
    }
    if (leaf && storedNamesAnywhere.has(leaf)) {
      leafCandidateAnywhere++
      const own = String(r.sfile ?? "")
      if (own && storedNamesByFile.get(own)?.has(leaf)) {
        leafCandidateOwnFile++
        if (leafCandidateExamples.length < 8) leafCandidateExamples.push(`${r.t} -> ${leaf}  (${own})`)
      }
    } else if (leaf && !params.includes(leaf)) {
      if (exampleNames.size < 10) exampleNames.add(leaf)
    }
  }
  console.log(`\nDETACHED TARGETS BY SHAPE — ${T.detached} rows, and the route each one has:`)
  for (const [shape, c] of [...shapeTotals.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(c).padStart(6)}  ${shape}`)
  }
  console.log(`\n  of the detached rows, target IS A PARAMETER of the row's own source symbol: ${paramOfEnclosing}`)
  console.log(`  (that population is a BINDING, not a declaration: publishing it as a symbol is forbidden repo-wide,`)
  console.log(`   so it is reported as a closed route and excluded from every resolution claim this instrument makes)`)
  for (const e of paramExamples) console.log(`      ${e}`)
  console.log(`\n  ----------------------------------------------------------------`)
  console.log(`  CAN ANYTHING ELSE BIND THE REST? the store resolves by NAME, so the question is`)
  console.log(`  whether a name-keyed candidate EXISTS for these rows. Measured on this draw:`)
  console.log(`    detached rows whose leaf names a STORED symbol anywhere in the sample : ${leafCandidateAnywhere}`)
  console.log(`    …and that symbol is declared in the row's OWN file (a real miss)      : ${leafCandidateOwnFile}`)
  if (leafCandidateExamples.length) {
    for (const e of leafCandidateExamples) console.log(`      own-file miss: ${e}`)
  }
  console.log(`  A row with no candidate is not a resolution failure — it is a name the sample cannot`)
  console.log(`  declare (the language's own surface: ${[...exampleNames].join(", ")}, or a local binding that may`)
  console.log(`  not become a symbol). What remains genuinely bindable is the own-file column above, plus`)
  console.log(`  whatever RECEIVER TYPING can turn a property-name target into a declared member.`)

  // ── EVERY DETACHED ROW GETS A REASON CODE, AND THE CODES SUM TO THE TOTAL ──
  //
  // A count of `DETACHED: 14,342` is not a measurement of anything: it is a population
  // that has not been asked why. The five classes below are mutually exclusive by
  // construction and exhaustive by construction, each is decidable from THIS draw, and the
  // sum check is printed so a class that silently stops matching shows up as a number
  // rather than as a quieter total. Class 5 is the only one that names a row this lane's
  // resolver was eligible to decide and did not — which is what makes the residue readable
  // as work instead of as a remainder.
  const COVERED = new Set(["calls", "uses", "instantiates", "references", "extends", "exports"])
  const detachedReason = new Map<string, number>()
  const R_SOURCE = "1. the SOURCE itself is unattributed — it belongs to the outgoing table above, not to the resolver"
  const R_LABEL = "2. the label is outside the resolver's scope (contains/overrides) — a different pass owns it"
  const R_PARAM = "3. the target IS a parameter of the row's own source symbol — a binding, provably not the import, so DETACHED is the correct state"
  const R_NOBIND = "4. the row's file records no binding for the leaf — the import statement cannot decide it (name pass territory)"
  const R_EXTERNAL = "5. the binding's module is EXTERNAL (a package or a node builtin) — there is no project file for the statement to name, so refusing is correct"
  const R_OUTSIDE = "6. the binding's module is RELATIVE but resolves to a file OUTSIDE this draw — the boundary of the sample, not a resolver gap"
  const R_ELIGIBLE = "7. the binding's module is relative, INSIDE the draw, and that module DECLARES the leaf — RESOLVER-ELIGIBLE rows still detached (the lane's real open work)"
  const R_MODULEBIND = "8. the binding's module is relative and INSIDE the draw, but it declares NO symbol of that name — the edge names an import BINDING (namespace/default), whose route is the `imports` edge, so refusing is correct"
  // Class 4's own split. "no binding for the leaf" is a population, not a verdict: a
  // prototype method, a property name read off a local object, and a name the draw does
  // declare all land there and none of them is the same kind of work. Four sub-classes,
  // exhaustive by construction (the last is a named catch-all, not an "other" bucket).
  const N_STDLIB = "a) ECMAScript standard-library name (enumerated from the running engine) — no project file declares it"
  const N_DECLARED = "b) the draw DOES declare that name — reachable only by receiver typing, not by the import statement"
  const N_SEGMENT = "c) a chain SEGMENT (isFieldAccess, not a bare read) of a name the draw declares NOWHERE — a member of a local object or of an external surface; no import statement can decide it"
  const N_BARE = "d) a BARE read of a name no file in the draw declares — a local binding that may not become a symbol, or an external surface"
  // The draw's own file set, so "the module is in the project" can be asked of THIS draw.
  // Without it the class above absorbed rows whose declaring module the sample never
  // loaded — measured on the first run, where every sampled example turned out to be a
  // module outside the sample (`utils.js`, `compiler/state.js`), which is exactly the
  // false-positive a classification has to exclude rather than report as work.
  const sampleFilePaths = new Set<string>(fileById.values())
  // Returns the sample-relative path the module names (or null), not a boolean: the
  // declaring side of the classification below needs to ask the RESOLVED module what it
  // declares, and a boolean would force that lookup to re-derive the path.
  const inDrawPath = (rowFile: string, module: string): string | null => {
    if (!module.startsWith(".")) return null
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(rowFile), module))
    for (const suffix of ["", ".js", ".mjs", ".cjs", ".jsx", ".ts", "/index.js", "/index.mjs"]) {
      if (sampleFilePaths.has(base + suffix)) return base + suffix
    }
    return null
  }
  const resolvesInsideDraw = (rowFile: string, module: string) => inDrawPath(rowFile, module) !== null
  const eligibleExamples: string[] = []
  const eligibleByLabel = new Map<string, number>()
  const nobindSplit = new Map<string, number>()
  const nobindByShape = new Map<string, number>()
  for (const r of relRows) {
    if (r.tid != null || r.tgt == null) continue
    const leaf = String(r.tgt).split(/[:.]/).filter(Boolean).pop() ?? ""
    const sfile = String(r.sfile ?? "")
    let params: string[] = []
    try {
      const v = JSON.parse(String(r.sparams ?? "[]"))
      if (Array.isArray(v)) params = v.map((p: any) => (typeof p === "string" ? p : String(p?.name ?? "")))
    } catch { /* an unparseable signature names no parameter */ }
    const reason = !sfile
      ? R_SOURCE
      : !COVERED.has(String(r.t))
        ? R_LABEL
        : leaf && params.includes(leaf)
          ? R_PARAM
          : !bindingsByFile.get(sfile)?.has(leaf)
            ? R_NOBIND
            : (() => {
                const mods = bindingsByFile.get(sfile)?.get(leaf) ?? []
                if (!mods.some((m) => m.startsWith("."))) return R_EXTERNAL
                const internal = mods
                  .map((m) => inDrawPath(sfile, m))
                  .filter((p): p is string => typeof p === "string")
                if (!internal.length) return R_OUTSIDE
                // A BINDING IS NOT A DECLARATION. `import * as acorn from '../acorn.js'`
                // binds `acorn` in a module this draw contains, and acorn.js declares no
                // symbol of that name — measured (its symbols are `parse`, `remove_parens`,
                // …), so the edge names a MODULE and its route is the `imports` edge that
                // already exists. Filing that as "open work" would invent a target; the
                // split makes the two populations tell themselves apart by number.
                const declares = internal.some((p) => storedNamesByFile.get(p)?.has(leaf))
                return declares ? R_ELIGIBLE : R_MODULEBIND
              })()
    detachedReason.set(reason, (detachedReason.get(reason) ?? 0) + 1)
    if (reason === R_NOBIND) {
      const shape = shapeOf(r)
      nobindByShape.set(shape, (nobindByShape.get(shape) ?? 0) + 1)
      const sub = std.has(leaf)
        ? N_STDLIB
        : storedNamesAnywhere.has(leaf)
          ? N_DECLARED
          : shape === "uses chain SEGMENT (property name)"
            ? N_SEGMENT
            : N_BARE
      nobindSplit.set(sub, (nobindSplit.get(sub) ?? 0) + 1)
    }
    if (reason === R_ELIGIBLE) {
      eligibleByLabel.set(String(r.t), (eligibleByLabel.get(String(r.t)) ?? 0) + 1)
      if (eligibleExamples.length < 8) {
        eligibleExamples.push(`${r.t} -> ${r.tgt}  (${sfile})`)
      }
    }
  }
  console.log(`\nDETACHED BY REASON — every one of the ${T.detached} detached rows, classified:`)
  // ALL FIVE classes print, including the ones this draw has none of: a class that is
  // absent because it matched nothing and a class that is absent because the code stopped
  // emitting it look identical in a table that only prints what it saw.
  let drClassified = 0
  for (const reason of [R_SOURCE, R_LABEL, R_PARAM, R_NOBIND, R_EXTERNAL, R_OUTSIDE, R_ELIGIBLE, R_MODULEBIND]) {
    const c = detachedReason.get(reason) ?? 0
    drClassified += c
    console.log(`  ${String(c).padStart(6)}  ${reason}`)
    // Class 4 is a third of the graph, so printing its sub-classes HERE (rather than in a
    // separate section) keeps the row's own class and its composition in one place; the
    // sub-classes sum to the class or the mismatch prints as a number.
    if (reason === R_NOBIND && c > 0) {
      let sub = 0
      for (const k of [N_STDLIB, N_DECLARED, N_SEGMENT, N_BARE]) {
        const sc = nobindSplit.get(k) ?? 0
        sub += sc
        console.log(`        ${String(sc).padStart(6)}  ${k}`)
      }
      const shapes = [...nobindByShape.entries()].sort((a, b) => b[1] - a[1]).map(([sh, n]) => `${sh} ${n}`).join(", ")
      console.log(`        ${String(sub).padStart(6)}  = class 4 total; unclassified: ${c - sub}`)
      console.log(`        class 4 by shape: ${shapes}`)
    }
  }
  if (eligibleByLabel.size) {
    console.log(`  class 7 by label: ${[...eligibleByLabel.entries()].sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t} ${c}`).join(", ")}`)
  }
  console.log(`  ${String(drClassified).padStart(6)}  = total; unclassified: ${T.detached - drClassified}`)
  // CLOSURE ACROSS THE TWO TABLES. Class 1 defers its rows to the OUTGOING table rather
  // than judging them, so the classification is only complete if those rows really are
  // classified there — i.e. if every row with BOTH ends unattributed appears in the
  // outgoing split above. Printing the intersection against class 1 makes the claim
  // checkable instead of asserted: they are the same number, so no row escapes both
  // tables, and a row that stopped being counted would show up as a non-zero remainder.
  const bothEndsNull = relRows.filter((r) => r.sid == null && r.tid == null && r.tgt != null).length
  const classOne = detachedReason.get(R_SOURCE) ?? 0
  console.log(`  rows with BOTH ends unattributed (counted independently) : ${bothEndsNull}`)
  console.log(`  class 1 above (the SAME population, by the reason loop)   : ${classOne}  ${bothEndsNull === classOne ? "— the two tables agree, nothing escapes both" : "— MISMATCH: a row is classified in one table and not the other"}`)
  if (eligibleExamples.length) {
    console.log(`  resolver-eligible examples (class 7):`)
    for (const e of eligibleExamples) console.log(`      ${e}`)
  }

  // ── OVERRIDES, resolved against the written hierarchy ──
  //
  // `resolved` here means the stored target is a METHOD DECLARED BY AN ANCESTOR of the
  // source's owner. That is the only reading under which an `overrides` edge is true;
  // "attached to a same-named symbol" is not.
  const ovPad = (n: number) => String(n).padStart(6)
  console.log(`\nOVERRIDES — is the target an ancestor that DECLARES the method?`)
  console.log(`  symbols carrying super_types (heritage persisted): ${supertypes.size}`)
  console.log(`  containers with a method index                   : ${methodsByOwner.size}`)
  console.log(`  overrides rows                                   : ${ovRows.length}`)
  console.log(`    no owner derivable                             : ${ovPad(ovNoOwner)}`)
  console.log(`    owner has no persisted hierarchy               : ${ovPad(ovNoHierarchy)}`)
  console.log(`    VERIFIED (target declared by an ancestor)      : ${ovPad(ovVerified)}`)
  console.log(`    NOT verified                                   : ${ovPad(ovUnverified)}`)
  for (const line of ovWrong) console.log(`      ${line}`)

  const decidable = T.correct + T.wrongFile
  const attachedTotal = T.n - T.nullTarget - T.detached
  console.log(`\nINCOMING (target side)`)
  console.log(`  target symbols published            : ${symbolsTotal}`)
  console.log(`  target symbols with >=1 inbound edge: ${symbolsWithInbound}  ${symbolsTotal ? (100 * symbolsWithInbound / symbolsTotal).toFixed(1) : "n/a"}%`)
  console.log(`  attached edges (target_symbol_id set): ${attachedTotal} of ${T.n}  ${T.n ? (100 * attachedTotal / T.n).toFixed(1) : "n/a"}%`)
  console.log(`  DETACHED (target_external, no symbol): ${T.detached}`)
  console.log(`\nOUTGOING (source side)`)
  console.log(`  source_symbol_id NULL               : ${T.nullSource} of ${T.n}`)
  console.log(`\nDECIDABLE rows (target declared in the source's own file): ${decidable}`)
  console.log(`  landed in the source file : ${T.correct}  ${decidable ? (100 * T.correct / decidable).toFixed(1) : "n/a"}%`)
  console.log(`  landed ELSEWHERE          : ${T.wrongFile}  ${decidable ? (100 * T.wrongFile / decidable).toFixed(1) : "n/a"}%`)
  console.log(`UNVERIFIABLE (target not declared in the source file — no per-file claim): ${T.unverifiable}`)

  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({
      corpus: CORPUS, files: taken.length,
      analyzerEdges, storedEdges: relRows.length, analyzerByType,
      perType: rows, totals: T,
      incoming: { symbolsTotal, symbolsWithInbound, attachedTotal },
      decidable, correctRate: decidable ? T.correct / decidable : null,
      // The diagnosis, in machine-readable form so a follow-up scan can ask a
      // question of EVERY name rather than of the 25 the report had room to print.
      // `nowhereNames` is the full list: a name the SAMPLE publishes no declaration
      // for. Whether the CORPUS declares it is a different question this file cannot
      // answer from a partial index, and it is deliberately not implied here.
      diagnosis: {
        detached: { bindable: DT.bindable, nowhere: DT.nowhere },
        detachedByType,
        bindableNames: top(bindableTop, 200).map(([name, count]) => ({ name, count })),
        nowhereNames: [...nowhereTopAll.entries()]
          .sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
        nowhereStdlibNames: top(nowhereStdTop, 200).map(([name, count]) => ({ name, count })),
        nowhereOtherNames: top(nowhereOtherTop, 200).map(([name, count]) => ({ name, count })),
        danglingSourceNames: top(danglingTop, 200).map(([name, count]) => ({ name, count })),
        // The outgoing split, machine-readable: `fileLevel` rows are ATTRIBUTED (the
        // actor is the file, found by path) and `nameSpelled` rows are the defect.
        outgoing: {
          fileLevel: fileLevelRows,
          sentinel: sentinelRows,
          nameSpelled: nameSpelledRows,
          fileLevelByType: Object.fromEntries(fileLevelByType),
        },
        nameSpelledSourceNames: top(nameSpelledTop, 200).map(([name, count]) => ({ name, count })),
        // The reason codes, machine-readable: the outgoing defect half by class, and every
        // detached row by class. Both are exhaustive, so a future reader can compare the
        // classes against the totals rather than trusting the table's arithmetic.
        // EVERY class is written, including the ones this draw has none of: a key that is
        // absent because it matched nothing and a key that is absent because the code
        // stopped emitting it are the same JSON, and a consumer would read the second as
        // the first. Zero stays zero, explicitly.
        nameSpelledByReason: Object.fromEntries(
          [REASON_KEYWORD, REASON_DECLARED, REASON_STDLIB, REASON_NEITHER]
            .map((k) => [k, nameSpelledReason.get(k) ?? 0]),
        ),
        detachedByReason: Object.fromEntries(
          [R_SOURCE, R_LABEL, R_PARAM, R_NOBIND, R_EXTERNAL, R_OUTSIDE, R_ELIGIBLE, R_MODULEBIND]
            .map((k) => [k, detachedReason.get(k) ?? 0]),
        ),
        // Class 4's composition, for the same reason: the class is a third of the graph and
        // "no binding for the leaf" only becomes readable once its sub-classes are named.
        noBindingSubClasses: Object.fromEntries(
          [N_STDLIB, N_DECLARED, N_SEGMENT, N_BARE].map((k) => [k, nobindSplit.get(k) ?? 0]),
        ),
        noBindingByShape: Object.fromEntries(nobindByShape),
        // Incoming diagnosis, machine-readable: the shape census of the detached
        // population and the size of the route house rules close.
        detachedByShape: Object.fromEntries(shapeTotals),
        detachedByLabel: Object.fromEntries(shapeByLabel),
        targetIsParameterOfSource: paramOfEnclosing,
        overrides: {
          rows: ovRows.length,
          noOwner: ovNoOwner,
          noHierarchy: ovNoHierarchy,
          verified: ovVerified,
          unverified: ovUnverified,
          symbolsWithSuperTypes: supertypes.size,
          containersWithMethodIndex: methodsByOwner.size,
        },
        nowhereTotals: { stdlib: nowhereStd, other: nowhereOther, stdlibSetSize: std.size },
      },
    }, null, 2))
    console.log(`\nJSON written: ${JSON_OUT}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
