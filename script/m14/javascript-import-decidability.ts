/**
 * JAVASCRIPT IMPORT DECIDABILITY — how many emitted edges name a symbol the row's OWN
 * FILE IMPORTS, where the imported module is in the project and declares the item?
 *
 * WHY THIS QUESTION. `script/m14/javascript-store-resolution.mts` reads the real graph
 * back out of sqlite after `indexProjectParallel`, and on a closed population it reports
 * that a large share of edges attach only by NAME UNIQUENESS (`_res_name_unique ... HAVING
 * COUNT(*) = 1`) or not at all. Neither strategy can see the file's own import graph, so a
 * bare imported name read in one file and declared in another stays detached whenever the
 * name is not unique project-wide — which in real code is the common case. This instrument
 * measures that population, because it is the population a resolver CAN decide without
 * guessing: the import statement names the module, and the module names the symbol.
 *
 * THE ROUTES, each requiring the imported module to be IN the population and to carry the
 * item in its own declarations. Nothing here is inferred from a name's shape:
 *
 *   OWN_FILE   the row's file declares the leaf                        (expected 100%)
 *   NAMED      `import { x } from './m'`      and m declares x
 *   ALIAS      `import { x as y }`            and m declares x  (row target y)
 *   DEFAULT    `import y from './m'`          and m declares y
 *   NAMESPACE  `import * as ns from './m'`    and m declares the leaf of `ns.leaf`
 *
 * MEASURED (2026-10-10, `packages/svelte/src`, 368 admitted files — a CLOSED population of
 * real source, every file under the instrument's size cap). The FIRST reading of this kind
 * reported NAMED 2,542 / NAMESPACE 0 / IMPORT-DECIDABLE 2,581 (9.0%) and is superseded by
 * the table below; each change is named with the defect it came from, because a number that
 * moves without a recorded cause is a number nobody can re-derive.
 *
 *   uses         16,937 rows   1,438 own-file   900 named    6 default   0 namespace
 *   calls        11,618 rows   1,931 own-file 1,708 named    4 alias  32 default 479 namespace
 *   instantiates    105 rows      41 own-file    57 named    0 default   0 namespace
 *   references       21 rows       4 own-file     1 named    0 default   0 namespace
 *   ALL          28,681 rows   3,414 own-file 2,666 named    4 alias  38 default 479 namespace
 *
 *   IMPORT-DECIDABLE and not own-file: **3,187** (11.1% of the rows of these four labels)
 *   module outside the population   : 2,550 (candidate-counted; see the note below)
 *   shadowed by the row's own signature: 3,263
 *
 * WHY THE NUMBER MOVED FROM 2,581, and none of it is a change of rule:
 *
 *   +479 NAMESPACE and +14 alias-bound rows that were structurally invisible. The analyzer
 *   did not publish a namespace alias at all (`import * as w from './warnings.js'` was
 *   recorded `{name: "*", type: "named"}` — JSD41, fixed, gate
 *   `verify-js-import-seam.ts`), the binding map was keyed by `name` (the string `"*"`, which
 *   no receiver equals) instead of the local name, the receiver of `ns.member(...)` lives on
 *   `metadata.calleeExpression` and was read from the target alone, and the declared name of
 *   an alias lives on the file's `imports` edge while the instrument looked for a
 *   `localName` key that record does not carry. Four independent blind spots, each of which
 *   reported a REACHABLE route as an ABSENT one.
 *
 *   +124 NAMED rows from the STORE-side fix (JSD42, `parallel-indexer`): the import row id
 *   was `fileId:import:module:line`, so every member of one clause shared a key and
 *   `INSERT OR REPLACE` kept only the LAST — a binding the store never recorded is a binding
 *   no resolver can read.
 *
 *   −3,263 rows excluded as SHADOWED: a name that is a parameter of the row's own source
 *   symbol is bound locally and the import statement is not decisive for it. Same rule, same
 *   exclusion, as `javascript-import-landing.ts`, so the two denominators agree.
 *
 *   `module outside` counts candidates rather than rows (a row with two namespace bindings
 *   whose modules are both absent bumps twice), which is why it moves with the route
 *   arithmetic instead of staying fixed. It is a diagnostic, not a denominator.
 *
 * PAIRED WITH THE STORE — THE OUTCOME, which is the number that matters, measured by
 * `javascript-import-landing.ts` on the same closed population (368 files copied and indexed
 * through `indexProjectParallel`, then every bare-name row of the four labels classified
 * against expectations RECOMPUTED FROM THE SOURCE, never read from the resolver's own
 * return value):
 *
 *   route       decidable  landed  wrong-file  detached  % landed
 *   named           2,567   2,567           0         0    100.0%
 *   alias              14      14           0         0    100.0%
 *   default            38      38           0         0    100.0%
 *   namespace         474     474           0         0    100.0%
 *   ALL             3,093   3,093           0         0    100.0%
 *
 *   With the resolver UNWIRED the same instrument reads 2,796 of 3,093 (90.4%) with 283
 *   rows on a wrong file, 4 alias rows detached and 3 namespace rows on a namesake — the
 *   falsification arm, and the reason the 100% is attributable rather than incidental.
 *   The store-side population is 3,093 rather than the 3,187 above because the store holds
 *   only rows that survived indexing (noise filtering and files whose parse failed), and the
 *   difference is recorded here rather than smoothed away.
 *
 * A CORPUS CHOICE THAT MATTERS, recorded because it produced a wrong number first: the
 * lodash project is NOT closed for this measurement. 4 of its 55 tracked `.js` files exceed
 * the 512KB cap — including `lodash.js` itself at 546KB — so a run on it reported 1,602
 * "bindable" names (`isEqual`, `map`, `filter`) that are declared only in the files the run
 * never indexed. 1,602 was an artifact of the sample. `packages/svelte/src` is used instead:
 * 368 files, all real source, all under the cap.
 *
 * WRITES NOTHING. Reads shared files; owns no shared file.
 *
 *   bun run script/m14/javascript-import-decidability.ts --corpus=<dir> [--files=N]
 *   (default corpus: <svelte>/packages/svelte/src; --files defaults to all admitted)
 */
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const arg = (n: string, d?: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d
const CR = arg("corpus", "$HOME/fixtures/repositories/svelte/packages/svelte/src")!
const FILES = Number(arg("files", "0")) || Number.MAX_SAFE_INTEGER
const TYPES = ["calls", "uses", "references", "instantiates"]

const tracked: string[] = execFileSync("git", ["-C", CR, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 30 })
  .split("\0").filter(Boolean)
const admitted: string[] = []
for (const rel of tracked) {
  const abs = path.join(CR, rel)
  try {
    if (statSync(abs).size > 512 * 1024) continue
    if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "javascript") continue
  } catch { continue }
  admitted.push(rel)
}
admitted.sort()
const sample = admitted.slice(0, FILES)
const sampleSet = new Set(sample)

const leafOf = (t: string): string => {
  const noLine = String(t).replace(/:\d+$/, "")
  const seg = noLine.split(":").filter((s) => s.length > 0)
  const last = seg[seg.length - 1] ?? ""
  return last.split(".").pop() ?? ""
}
const receiverOf = (t: string): string | null => {
  const noLine = String(t).replace(/:\d+$/, "")
  const seg = noLine.split(":").filter((s) => s.length > 0)
  const last = seg[seg.length - 1] ?? ""
  const parts = last.split(".")
  return parts.length > 1 ? parts.slice(0, -1).join(".") : null
}

type Facts = { rel: string; declared: Set<string>; imports: any[]; rows: any[]; defaultExports: Set<string>; params: Map<string, string[]> }
const files: Facts[] = []
let idx = 0
async function worker(): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= sample.length) return
    const rel = sample[i]
    let res: any
    try { res = await parseFile(path.join(CR, rel), CR) } catch { continue }
    const declared = new Set<string>((res?.symbols ?? []).map((s: any) => String(s?.name ?? "")).filter(Boolean))
    const defaultExports = new Set<string>()
    for (const r of res?.relationships ?? []) {
      if (String(r.type ?? "").toLowerCase() !== "exports") continue
      if (String(r.metadata?.declaredKind ?? "") === "default" || leafOf(r.target) === "default") {
        defaultExports.add(String(r.source ?? ""))
      }
    }
    // The row's own source-symbol SIGNATURE: a name that is a parameter of the enclosing
    // symbol is bound locally, so the import statement is not decisive for it. Same rule as
    // the landing instrument, so the two denominators agree.
    const params = new Map<string, string[]>()
    for (const s of res?.symbols ?? []) {
      let raw = s?.parameters
      if (typeof raw === "string") { try { raw = JSON.parse(raw) } catch { raw = null } }
      if (!Array.isArray(raw)) continue
      params.set(String(s?.name ?? ""), raw.map((p: any) => String(typeof p === "string" ? p : p?.name ?? "")))
    }
    files.push({ rel, declared, imports: res?.imports ?? [], rows: res?.relationships ?? [], defaultExports, params })
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

const declaredIn = new Map<string, Set<string>>()
for (const f of files) {
  for (const n of f.declared) {
    const s = declaredIn.get(n) ?? new Set<string>()
    s.add(f.rel)
    declaredIn.set(n, s)
  }
}

/** Resolve a specifier from the importing file's own directory, requiring an exact file. */
const moduleFile = (fromRel: string, modulePath: string): string | null => {
  if (!modulePath.startsWith(".")) return null
  const p = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), modulePath))
  for (const c of [p, `${p}.js`, `${p}.mjs`, `${p}.cjs`, `${p}/index.js`, `${p}.jsx`]) if (sampleSet.has(c)) return c
  return null
}

type Counts = { rows: number; owned: number; named: number; alias: number; def: number; ns: number; ext: number; moduleOut: number }
const per = new Map<string, Counts>()
const bump = (t: string): Counts => {
  let c = per.get(t)
  if (!c) { c = { rows: 0, owned: 0, named: 0, alias: 0, def: 0, ns: 0, ext: 0, moduleOut: 0 }; per.set(t, c) }
  return c
}
const examples: Record<string, string[]> = { named: [], alias: [], def: [], ns: [] }
let shadowed = 0

for (const f of files) {
  // Keyed by the LOCAL name — the name the file's own source writes — because that is what
  // a row's bare leaf or a receiver can be equal to. `localName` is the binding; `name` is
  // the declared name for a plain named import and `*` for a namespace one, so keying by
  // `name` hid every namespace binding behind a key no identifier can match.
  const bindings = new Map<string, { module: string; kind: string; declared: string }[]>()
  // The DECLARED name of an aliased import is not on the import record (it holds the local
  // name); it is on the file's `imports` EDGE metadata, written by the same analyzer run.
  const declaredFor = new Map<string, string>()
  for (const r of f.rows) {
    if (String(r.type ?? "").toLowerCase() !== "imports") continue
    // The edge TARGET spells the local name (`.../index.js:get_store`) and the metadata
    // spells the declared one (`declaredName: "get"`). There is no `localName` key on this
    // record, so reading one left the map empty and the ALIAS route unreachable.
    const t = String(r.target ?? "")
    const local = t.slice(t.lastIndexOf(":") + 1)
    const declared = String(r.metadata?.declaredName ?? "")
    if (local && declared && declared !== "*" && declared !== local) declaredFor.set(local, declared)
  }
  for (const i of f.imports) {
    const mod = String(i?.path ?? i?.module ?? "")
    const local = String(i?.localName ?? i?.importedAs ?? i?.name ?? "")
    if (!local || local === "*") continue
    const arr = bindings.get(local) ?? []
    arr.push({
      module: mod,
      kind: String(i?.type ?? i?.importType ?? ""),
      declared: declaredFor.get(local) ?? local,
    })
    bindings.set(local, arr)
  }
  for (const r of f.rows) {
    const t = String(r.type ?? "").toLowerCase()
    if (!TYPES.includes(t)) continue
    const leaf = leafOf(r.target)
    if (!leaf) continue
    const c = bump(t)
    c.rows++
    if (f.declared.has(leaf)) { c.owned++; continue }
    // A parameter of the row's own source symbol binds the name: not import-decidable, and
    // removing it here is what keeps this instrument's denominator equal to the landing
    // instrument's (which excludes exactly the same rows).
    if (f.params.get(String(r.source ?? ""))?.includes(leaf)) { shadowed++; continue }
    // The receiver of `ns.member(...)` is NOT in the row's target (which spells the LEAF)
    // — it is on `metadata.calleeExpression`, the only place the analyzer records it. A
    // route that reads the target alone sees no receiver, so it reports the whole
    // namespace population as undecidable instead of as reachable.
    const recv = receiverOf(r.target) ?? receiverOf(String(r.metadata?.calleeExpression ?? ""))
    if (recv && bindings.has(recv)) {
      let done = false
      for (const h of bindings.get(recv)!.filter((b) => b.kind === "namespace")) {
        const mf = moduleFile(f.rel, h.module)
        if (!mf) { c.moduleOut++; continue }
        if (declaredIn.get(leaf)?.has(mf)) {
          done = true
          if (examples.ns.length < 6) examples.ns.push(`${t} ${r.source} -> ${r.target} : namespace ${recv} of ${h.module} declares ${leaf} [${f.rel}]`)
        }
      }
      if (done) { c.ns++; continue }
    }
    const b = bindings.get(leaf)
    if (b && b.length) {
      // ALIAS first: `import { get as get_store }` puts the LOCAL name on the row's leaf,
      // so the module declares the DECLARED name (get), not the leaf. Reading only the leaf
      // counted every aliased binding as undeclared — the route was invisible, not absent.
      let matched: "named" | "alias" | "def" | null = null
      for (const one of b) {
        const mf = moduleFile(f.rel, one.module)
        if (!mf) { c.moduleOut++; continue }
        if (declaredIn.get(leaf)?.has(mf)) { matched = one.kind === "default" ? "def" : "named"; break }
        if (one.declared !== leaf && declaredIn.get(one.declared)?.has(mf)) { matched = "alias"; break }
        if (one.kind === "default") {
          const target = files.find((x) => x.rel === mf)
          if (target && target.defaultExports.has(leaf)) matched = "def"
        }
      }
      if (matched) {
        c[matched]++
        if (examples[matched].length < 6) examples[matched].push(`${t} ${r.source} -> ${r.target} : ${matched} binding from ${b[0].module} [${f.rel}]`)
        continue
      }
    }
    c.ext++
  }
}

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`javascript import decidability — ${CR}`)
console.log(`admitted ${admitted.length}   sample ${sample.length}\n`)
console.log(`${pad("type", 14)}${pad("rows", 8)}${pad("OWN_FILE", 10)}${pad("NAMED", 8)}${pad("ALIAS", 8)}${pad("DEFAULT", 9)}${pad("NAMESPACE", 11)}${pad("other", 8)}${pad("module-outside", 15)}`)
let T: Counts = { rows: 0, owned: 0, named: 0, alias: 0, def: 0, ns: 0, ext: 0, moduleOut: 0 }
for (const [t, c] of [...per.entries()].sort((a, b) => b[1].rows - a[1].rows)) {
  for (const k of Object.keys(T) as (keyof Counts)[]) T[k] += c[k]
  console.log(`${pad(t, 14)}${pad(String(c.rows), 8)}${pad(String(c.owned), 10)}${pad(String(c.named), 8)}${pad(String(c.alias), 8)}${pad(String(c.def), 9)}${pad(String(c.ns), 11)}${pad(String(c.ext), 8)}${pad(String(c.moduleOut), 15)}`)
}
console.log(`${pad("ALL", 14)}${pad(String(T.rows), 8)}${pad(String(T.owned), 10)}${pad(String(T.named), 8)}${pad(String(T.alias), 8)}${pad(String(T.def), 9)}${pad(String(T.ns), 11)}${pad(String(T.ext), 8)}${pad(String(T.moduleOut), 15)}`)
const decidable = T.named + T.alias + T.def + T.ns
const pct = T.rows ? (100 * decidable) / T.rows : 0
console.log(`\nIMPORT-DECIDABLE and not own-file: ${decidable}  ${pct.toFixed(1)}% of these rows`)
console.log(`shadowed by the row's own signature (not decidable, and NOT the import): ${shadowed}`)
console.log(`own-file declared (the store already lands these): ${T.owned}`)
console.log(`\nexamples:`)
for (const [k, arr] of Object.entries(examples)) for (const e of arr) console.log(`  [${k}] ${e}`)
