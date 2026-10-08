#!/usr/bin/env bun
/**
 * INCOMING_PY — RESOLUTION & DISPATCH CENSUS.
 *
 * THE QUESTION. `bb_graph`, `bb_impact` and `bb_migrate` all join an edge's target to
 * a symbol. An edge whose target is a NAME the analyzer chose rather than a SYMBOL the
 * parse produced joins to nothing, and it does so silently. The workstream requires
 * both endpoints of an emitted edge to resolve to real symbols, and for python
 * specifically requires the dynamic-dispatch case to be MEASURED rather than guessed:
 * in python a method resolved at runtime has no static target.
 *
 * FIVE BUCKETS, and the partition is computed from the parse, not from a typed list:
 *
 *   resolved-in-file   the target names a symbol THIS parse declared — by bare name
 *                      when exactly one symbol carries it, or by the `Owner.name`
 *                      pair when the edge's SOURCE already names the owner (which is
 *                      how `contains` and `overrides` are written).
 *   resolved-external  the target names something this file IMPORTED. Reachable
 *                      through the project index, not from this parse.
 *   ambiguous          the target bare name is carried by TWO OR MORE distinct
 *                      symbols and the source does not disambiguate. The edge is
 *                      real; which node it means is not decidable from one file.
 *   external-member    `recv.leaf` whose receiver this file named. The member exists
 *                      in code this parse has NOT read — `pa.Table` -> `Table`.
 *   unresolvable       none of the above. Nothing this parse declared, nothing it
 *                      imported, no reachable receiver.
 *
 * `external-member` is split from `unresolvable` deliberately. `Table` is a real
 * pyarrow class a reader can find; a callee reached through a parameter has no name
 * at all. Collapsing them would report thousands of reachable members as unresolvable
 * and bury the ones that genuinely cannot be named.
 *
 * ## THE DISPATCH PARTITION — why it is not a guess
 *
 * A `calls` edge names the callee AS WRITTEN. In python that written name is often
 * the only name there is: `self.m()` resolves at runtime through `type(self).__m__`,
 * and `cb()` where `cb` is a parameter resolves through whatever value the caller
 * passed. Both are facts about the source; neither has a static target. So each
 * `calls` edge is also classified by HOW its target is chosen:
 *
 *   in-file-symbol         the callee names a symbol this parse declared
 *   dispatch-on-parameter   `self.m()` / `cls.m()` — receiver is the implicit first
 *                           parameter, so the target class is a runtime fact
 *   dispatch-on-receiver    `recv.m()` where recv is a local/param/attribute
 *   dispatch-through-alias  `cb()` where cb is bound by a parameter or an assignment
 *                           — the target is a VALUE, and no name for it exists
 *   external-member         the receiver is imported
 *   bare-global             `f()` where f is not bound anywhere this parse can see:
 *                           a global, a builtin alias, or a name from `from x import *`
 *
 * WRITES NOTHING.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPOS = (process.env.BB_PY_REPOS ?? "python-codesql,swift-corpus,groovy,cpp-example,googletest,ruby,haskell,otp,csharp-sample").split(",")
const MAX_BYTES = 512 * 1024

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
for (const e of REPOS) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > MAX_BYTES) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "python") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}

type Bucket = "resolved-in-file" | "resolved-external" | "ambiguous" | "external-member" | "unresolvable"
type Dispatch = "in-file-symbol" | "dispatch-on-parameter" | "dispatch-on-receiver" | "dispatch-through-alias" | "external-member" | "bare-global" | "n/a"
const rows = new Map<Type, Record<Bucket, number>>()
const dispatch = new Map<Type, Record<Dispatch, number>>()
const confByType = new Map<Type, Map<string, number>>()
const evByType = new Map<Type, Map<string, number>>()
const reasonByType = new Map<Type, Map<string, number>>()
const edgeSamples = new Map<string, string[]>()
let r7Placeholders = 0
const r7Examples: string[] = []
let emptyNames = 0
const emptyNameExamples: string[] = []
let emptyEndpoints = 0
let totalEdges = 0

const zero = <T extends string>(k: T): Record<T, number> => Object.fromEntries(Object.keys(k as unknown as Record<T, number>).map(() => 0)) as Record<T, number>
const BUCKETS: Bucket[] = ["resolved-in-file", "resolved-external", "ambiguous", "external-member", "unresolvable"]
const DISPATCHES: Dispatch[] = ["in-file-symbol", "dispatch-on-parameter", "dispatch-on-receiver", "dispatch-through-alias", "external-member", "bare-global", "n/a"]
const dispZero = (): Record<Dispatch, number> => ({ "in-file-symbol": 0, "dispatch-on-parameter": 0, "dispatch-on-receiver": 0, "dispatch-through-alias": 0, "external-member": 0, "bare-global": 0, "n/a": 0 })

function bump(t: Type, b: Bucket) {
  const r = rows.get(t) ?? (Object.fromEntries(BUCKETS.map((x) => [x, 0])) as Record<Bucket, number>)
  r[b]++
  rows.set(t, r)
}
function bumpDispatch(t: Type, d: Dispatch) {
  const r = dispatch.get(t) ?? dispZero()
  r[d]++
  dispatch.set(t, r)
}
function bumpMap(m: Map<Type, Map<string, number>>, t: Type, k: string) {
  const inner = m.get(t) ?? new Map<string, number>()
  inner.set(k, (inner.get(k) ?? 0) + 1)
  m.set(t, inner)
}
function sample(key: string, s: string) {
  const arr = edgeSamples.get(key) ?? []
  if (arr.length < 4) arr.push(s)
  edgeSamples.set(key, arr)
}
void zero

{
  let idx = 0
  const results: any[] = new Array(files.length)
  const worker = async () => {
    while (true) {
      const i = idx++
      if (i >= files.length) return
      try { results[i] = await parseFile(files[i]!.abs, files[i]!.dir) } catch { /* counted as parse failure below */ }
    }
  }
  await Promise.all(Array.from({ length: 6 }, () => worker()))

  for (let i = 0; i < files.length; i++) {
    const f = files[i]!
    const r = results[i]
    if (!r) continue
    const tag = `${f.repo}/${f.rel}`

    const syms: any[] = r.symbols ?? []
    const byName = new Map<string, Set<string>>()
    const qualified = new Set<string>()
    const owners = new Set<string>()
    for (const s of syms) {
      if (typeof s.name !== "string" || s.name.length === 0) {
        emptyNames++
        if (emptyNameExamples.length < 6) emptyNameExamples.push(`${tag} symbol name=${JSON.stringify(s.name)} kind=${s.kind} @L${s.range?.startLine}`)
        continue
      }
      const owner = s.ownerName ?? ""
      if (!byName.has(s.name)) byName.set(s.name, new Set())
      byName.get(s.name)!.add(`${owner}:${s.kind}`)
      if (owner) { qualified.add(`${owner}.${s.name}`); owners.add(owner) }
    }
    const moduleName = path.basename(f.rel).replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_]/g, "_")

    // `pool-worker` republishes imports in its OWN shape ({name, path}) — read both.
    const importedNames = new Set<string>()
    const importedModules = new Set<string>()
    for (const im of r.imports ?? []) {
      if (im.path) importedModules.add(String(im.path))
      if (im.module) importedModules.add(String(im.module))
      for (const it of im.items ?? []) if (it && it !== "*") importedNames.add(String(it))
      if (im.name && im.name !== "*") importedNames.add(String(im.name))
    }
    const moduleRoots = new Set<string>()
    for (const m of [...importedModules, ...importedNames]) {
      const root = m.split(".")[0]!
      if (root) moduleRoots.add(root)
    }

    for (const x of r.relationships ?? []) {
      const t = String(x.type ?? x.relationshipType ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      totalEdges++
      bumpMap(confByType, t, String(x.confidence ?? "undefined"))
      bumpMap(evByType, t, String(x.metadata?.evidenceClass ?? "<none>"))
      bumpMap(reasonByType, t, String(x.metadata?.reasonCode ?? "<none>"))

      const src = String(x.source ?? "")
      const tgt = String(x.target ?? "")
      const q = String(x.metadata?.qualified ?? "")

      // ---- R7, the RUNTIME half. The register's own rule: convict a value only when
      // the FILE DOES NOT WRITE IT. A value that appears in the source is a real name
      // whatever it is spelled — `ExpectedResult.Type.UNKNOWN` publishes a member the
      // author wrote, and a value-only rule convicts it.
      for (const [field, v] of [["source", src], ["target", tgt]] as const) {
        if (v.trim().length === 0) {
          // An EMPTY endpoint is the worst case and it is easy to miss: a `!v` guard
          // reads like a check and skips the very value it looks for. `pushRel` has one
          // (`if (!source || !target) return`) but `extractDeclaredTypeRefs` builds its
          // rows directly, so the guard never saw this shape.
          r7Placeholders++
          emptyEndpoints++
          if (r7Examples.length < 10) r7Examples.push(`${t} ${field}=${JSON.stringify(v)} EMPTY in ${tag}`)
          continue
        }
        const sentinel = /^(<[^>]*>|\?|#|\$1|\bn\/a\b|global|anonymous)$/i.test(v.trim()) ||
          (v.length <= 2 && /[^A-Za-z0-9_]/.test(v))
        if (sentinel) {
          r7Placeholders++
          if (r7Examples.length < 10) r7Examples.push(`${t} ${field}=${JSON.stringify(v)} in ${tag}`)
        }
      }

      const isImportedName = (name: string): boolean => {
        if (importedNames.has(name) || importedModules.has(name)) return true
        const root = name.split(".")[0]!
        return moduleRoots.has(root)
      }

      // ---- resolution
      const candidates = byName.get(tgt)
      const sourceIsOwner = owners.has(src)
      let bucket: Bucket
      let disp: Dispatch = "n/a"
      // The receiver decides the DISPATCH class before anything else, and it must come
      // first: `self.m()` has no receiver the file can follow, so counting it as an
      // `external-member` because its leaf happens not to be declared would report the
      // most important python shape as the least important one.
      const receiverIsImplicitParam = q.startsWith("self.") || q.startsWith("cls.")
      if (t !== "imports" && tgt === moduleName) bucket = "resolved-in-file"
      else if (sourceIsOwner && qualified.has(`${src}.${tgt}`)) bucket = "resolved-in-file"
      else if (t === "overrides" && qualified.has(tgt)) bucket = "resolved-in-file"
      else if (t === "overrides" && isImportedName(tgt.includes(".") ? tgt.slice(0, tgt.lastIndexOf(".")) : tgt)) {
        // `Owner.method` where `Owner` is an import of THIS file. The base is a class
        // in code this parse has not read — which is precisely what a `first-parent-guess`
        // edge asserts, and precisely why the lane's oracle refutes so many of them.
        bucket = "resolved-external"
      } else if (candidates && candidates.size > 1) bucket = "ambiguous"
      else if (candidates && candidates.size === 1) bucket = "resolved-in-file"
      else if (t === "imports") {
        const m = tgt.split(":")[0]!
        bucket = importedModules.has(m) ? "resolved-external" : "unresolvable"
      } else if (isImportedName(tgt)) bucket = "resolved-external"
      else if (q.includes(".") && q !== tgt) {
        const recv = q.slice(0, q.lastIndexOf("."))
        const recvRoot = recv.split(".")[0]!
        bucket = "external-member"
        disp = "external-member"
        sample(`recv:${recvRoot}`, `${src} -> ${tgt} via receiver ${recv} in ${tag}`)
      } else bucket = "unresolvable"
      bump(t, bucket)

      // ---- dispatch classification for `calls`
      if (t === "calls") {
        const selfCall = receiverIsImplicitParam && q.includes(".")
        if (bucket === "resolved-in-file" && !selfCall) disp = "in-file-symbol"
        else if (selfCall && bucket === "resolved-in-file") disp = "in-file-symbol"
        else if (selfCall) disp = "dispatch-on-parameter"
        else if (bucket === "resolved-in-file") disp = "in-file-symbol"
        else if (bucket === "resolved-external") disp = "bare-global"
        else if (bucket === "external-member") disp = "external-member"
        else if (q === tgt) {
          // a BARE-NAME callee that resolves to nothing: the name is a value.
          const boundAsParam = new RegExp(`(^|[\\s,(])${tgt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[,):=]`).test(f.text)
          disp = boundAsParam ? "dispatch-through-alias" : "bare-global"
          if (disp === "dispatch-through-alias") sample("alias", `${src} -> ${tgt} (name is bound in the file, so the target is a VALUE) in ${tag}`)
        } else disp = "dispatch-on-receiver"
      }
      bumpDispatch(t, disp)
    }
  }
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`)
const sum = (r: Record<string, number> | undefined) => (r ? Object.values(r).reduce((a, b) => a + b, 0) : 0)

console.log("INCOMING_PY resolution & dispatch census")
console.log(`corpus: ${files.length} .py files across ${REPOS.length} repos   edges: ${totalEdges}\n`)
console.log("RESOLUTION PARTITION per type:")
console.log(`${"type".padEnd(13)}${"total".padStart(8)}${"in-file".padStart(9)}${"external".padStart(10)}${"ambiguous".padStart(11)}${"ext-member".padStart(11)}${"unresolv".padStart(10)}`)
for (const t of ALL_TYPES) {
  const r = rows.get(t)
  if (!r) { console.log(`${t.padEnd(13)}${"0".padStart(8)}`); continue }
  console.log(`${t.padEnd(13)}${String(sum(r)).padStart(8)}${String(r["resolved-in-file"]).padStart(9)}${String(r["resolved-external"]).padStart(10)}${String(r.ambiguous).padStart(11)}${String(r["external-member"]).padStart(11)}${String(r.unresolvable).padStart(10)}`)
}
console.log("\nRATIOS:")
for (const t of ALL_TYPES) {
  const r = rows.get(t)
  if (!r) continue
  const tot = sum(r)
  console.log(`  ${t.padEnd(13)} in-file ${pct(r["resolved-in-file"], tot).padStart(7)}   external ${pct(r["resolved-external"], tot).padStart(7)}   ambiguous ${pct(r.ambiguous, tot).padStart(6)}   ext-member ${pct(r["external-member"], tot).padStart(7)}   unresolvable ${pct(r.unresolvable, tot).padStart(7)}`)
}

console.log("\nDISPATCH CLASSIFICATION for `calls` (how the runtime target is chosen):")
{
  const r = dispatch.get("calls")
  const tot = sum(r as unknown as Record<Dispatch, number>)
  for (const d of DISPATCHES) {
    const n = r?.[d] ?? 0
    if (!n) continue
    console.log(`  ${d.padEnd(24)} ${String(n).padStart(7)}  ${pct(n, tot).padStart(7)}`)
  }
  console.log(`  ${"".padEnd(24)} ${"-".repeat(7)}  -------`)
  console.log(`  ${"TOTAL".padEnd(24)} ${String(tot).padStart(7)}`)
  const withStatic = tot - (r?.["dispatch-on-parameter"] ?? 0) - (r?.["dispatch-on-receiver"] ?? 0) - (r?.["dispatch-through-alias"] ?? 0)
  console.log(`\n  calls edges with NO statically-nameable target: ${tot - withStatic} (${pct(tot - withStatic, tot)})`)
}

console.log("\nCONFIDENCE per type (M14 §4: <1.0 needs a machine-readable reason code):")
for (const t of ALL_TYPES) {
  const m = confByType.get(t)
  if (!m) continue
  const parts = [...m.entries()].sort((a, b) => b[1] - a[1])
  const below = parts.filter(([k]) => Number(k) < 1 && k !== "undefined").reduce((a, b) => a + b[1], 0)
  const codes = reasonByType.get(t)
  const coded = codes ? [...codes.entries()].filter(([k]) => k !== "<none>").reduce((a, b) => a + b[1], 0) : 0
  console.log(`  ${t.padEnd(13)} ${parts.map(([k, v]) => `${k}x${v}`).join("  ")}`)
  if (below > 0) console.log(`  ${"".padEnd(13)}  -> ${below} below 1.0; ${coded} carry a reasonCode (${pct(coded, below)})${coded < below ? "   <<< §4 GAP" : ""}`)
}

console.log("\nEVIDENCE CLASS per type:")
for (const t of ALL_TYPES) {
  const m = evByType.get(t)
  if (!m) continue
  console.log(`  ${t.padEnd(13)} ${[...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}x${v}`).join("  ")}`)
}

console.log(`\nR7 runtime placeholder endpoints: ${r7Placeholders}`)
for (const s of r7Examples) console.log(`  ${s}`)
console.log(`EMPTY relationship endpoints: ${emptyEndpoints}`)
console.log(`EMPTY symbol names: ${emptyNames}`)
for (const s of emptyNameExamples) console.log(`  ${s}`)

const at = process.argv.indexOf("--json")
if (at > 0) {
  const { writeFileSync } = await import("node:fs")
  writeFileSync(process.argv[at + 1], JSON.stringify({
    corpus: { repos: REPOS, files: files.length },
    totalEdges,
    resolution: Object.fromEntries([...rows.entries()]),
    dispatch: Object.fromEntries([...dispatch.entries()]),
    confidence: Object.fromEntries([...confByType.entries()].map(([t, m]) => [t, Object.fromEntries(m)])),
    evidenceClass: Object.fromEntries([...evByType.entries()].map(([t, m]) => [t, Object.fromEntries(m)])),
    reasonCode: Object.fromEntries([...reasonByType.entries()].map(([t, m]) => [t, Object.fromEntries(m)])),
    r7Placeholders, r7Examples, emptyEndpoints, emptyNames, emptyNameExamples,
    samples: Object.fromEntries(edgeSamples),
  }, null, 2))
}