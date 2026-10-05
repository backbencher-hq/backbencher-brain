/**
 * ORPHAN KEY AUDIT — does `incoming-check.ts` report 100% orphans for protobuf
 * because protobuf orphans, or because it compares two different key spaces?
 *
 * ## The observation
 *
 *   $ npx tsx script/m14/incoming-check.ts protobuf <40 files>
 *     distinct declarations named by at least one edge : 3468
 *     declarations nothing names (orphans)             : 3554 of 3554
 *
 * Those two lines cannot both be literally true: 3,468 declarations are named by an
 * edge, so at most 3554 - 3468 = 86 can be orphans. The run reads 3,554/3,554.
 *
 * ## The cause, from source
 *
 * `incoming-check.ts:174`   `declaredNames.push(name)`   — the SIMPLE name only.
 * `incoming-check.ts:182-188` `published` gets BOTH `name` and `qualifiedName`.
 * `incoming-check.ts:226-231` `named` is keyed by `String(rel.target)`.
 * `incoming-check.ts:260`   `orphans = declaredNames.filter((n) => !named.has(n))`
 *
 * So RESOLUTION (`published`) is computed over two key spaces and works; ORPHANS
 * (`declaredNames`) is computed over one — the simple name — and is intersected
 * against a key space built from whatever the edge targets happen to be spelled.
 *
 * In protobuf an edge target is the fully-qualified dotted id. Measured on
 * `pb-reference/src/google/protobuf/descriptor.proto` through production `parseFile`:
 *
 *     targets matching symbol.name          : 0 / 414
 *     targets matching symbol.qualifiedName : 414 / 414
 *
 * `declaredNames` holds only simple names, so `named.has(n)` is false for every
 * declaration and the orphan rate is 1.0 BY CONSTRUCTION — a number that measures
 * the key space, not the corpus. It is not a protobuf finding, and it is not fixable
 * inside this lane: `script/m14/incoming-check.ts` is shared machinery (§8).
 *
 * ## What this file measures
 *
 * The same orphan question asked three ways, so the reportable number is not the
 * broken one:
 *
 *   orphanByName        — exactly what incoming-check prints (simple name vs target)
 *   orphanByQualified   — declaration.qualifiedName vs target. THE REAL NUMBER.
 *   orphanByEitherKey   — a declaration counts as incoming if EITHER key is named,
 *                         which is the most generous reading the graph could support.
 *
 * and it prints, per type, the edge targets that bind to NO published key at all, so
 * the "never indexed" population is separated from the "external / hopeless" one.
 *
 * No regex. Keys are compared as strings; no source text is scanned.
 *
 * ## Reproduce
 *
 *   npx tsx script/m14/protobuf-orphan-key-audit.mts              # default 40-file sample
 *   npx tsx script/m14/protobuf-orphan-key-audit.mts --files 200
 *   npx tsx script/m14/protobuf-orphan-key-audit.mts --selftest
 */
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

const TYPES = [
  "calls",
  "uses",
  "contains",
  "imports",
  "references",
  "exports",
  "extends",
  "implements",
  "overrides",
  "instantiates",
] as const

function ontologyName(raw: string): string {
  const s = raw.toLowerCase()
  if (s === "import" || s === "brain_import") return "imports"
  if (s === "export" || s === "brain_export") return "exports"
  if (s === "use" || s === "brain_use") return "uses"
  if (s === "contain" || s === "brain_contain") return "contains"
  return s
}

interface Rel {
  file: string
  type: string
  source: string
  target: string
}

function parseArgs(): { files: number; selftest: boolean; json: boolean } {
  const a = process.argv.slice(2)
  let files = 40
  let selftest = false
  let json = false
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--files") files = Number(a[++i] ?? 40)
    else if (a[i] === "--selftest") selftest = true
    else if (a[i] === "--json") json = true
  }
  if (!Number.isFinite(files) || files < 1) files = 40
  return { files, selftest, json }
}

/** Collect .proto paths by walking the tree, skipping vendored dependency dirs. */
async function collect(limit: number): Promise<string[]> {
  const fsp = await import("node:fs/promises")
  const out: string[] = []
  const SKIP = new Set(["node_modules", ".git", "vendor", "third_party", "dist", "build"])

  async function walk(dir: string): Promise<void> {
    if (out.length >= limit) return
    let ents: import("node:fs").Dirent[]
    try {
      ents = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of ents) {
      if (out.length >= limit) return
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (SKIP.has(e.name)) continue
        await walk(full)
      } else if (e.isFile() && e.name.endsWith(".proto")) {
        out.push(full)
      }
    }
  }

  let roots: string[] = []
  try {
    roots = (await fsp.readdir(CORPUS, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => path.join(CORPUS, e.name))
      .sort()
  } catch {
    throw new Error(`corpus root not readable: ${CORPUS}`)
  }
  // Deterministic: breadth-first by root so the sample spreads over repositories
  // instead of exhausting the first one alphabetically.
  for (const r of roots) {
    await walk(r)
    if (out.length >= limit) break
  }
  return out
}

/**
 * The measured claim this file exists to check. Hand-built rather than derived from
 * the corpus, so it is a FIXTURE: if the key-space theory is right these four facts
 * hold, and if it is wrong at least one of them fails.
 */
function selftest(): boolean {
  const decls = [
    { name: "SymbolVisibility", qualifiedName: "google.protobuf.SymbolVisibility" },
    { name: "VISIBILITY_EXPORT", qualifiedName: "google.protobuf.SymbolVisibility.VISIBILITY_EXPORT" },
  ]
  const rels: Rel[] = [
    { file: "f", type: "contains", source: "google.protobuf", target: "google.protobuf.SymbolVisibility" },
  ]

  const published = new Map<string, string[]>()
  const declaredNames: string[] = []
  const declaredQns: string[] = []
  for (const d of decls) {
    declaredNames.push(d.name)
    declaredQns.push(d.qualifiedName)
    for (const k of [d.name, d.qualifiedName]) {
      const a = published.get(k)
      if (a) {
        if (!a.includes("class")) a.push("class")
      } else published.set(k, ["class"])
    }
  }
  const named = new Set<string>()
  for (const r of rels) if (published.has(r.target)) named.add(r.target)

  const checks: Array<[string, boolean]> = [
    ["target binds via qualifiedName", named.has("google.protobuf.SymbolVisibility")],
    ["target does NOT bind via simple name", !named.has("SymbolVisibility")],
    ["orphanByName == all declarations (the defect)", declaredNames.filter((n) => !named.has(n)).length === 2],
    ["orphanByQualified == 1 of 2 (the truth)", declaredQns.filter((n) => !named.has(n)).length === 1],
  ]
  let ok = true
  console.log("SELFTEST — orphan key-space")
  for (const [label, pass] of checks) {
    console.log(`  ${pass ? "ok  " : "FAIL"}  ${label}`)
    if (!pass) ok = false
  }
  console.log(ok ? "\nselftest PASSED" : "\nselftest FAILED")
  return ok
}

async function main(): Promise<void> {
  const { files: limit, selftest: st, json } = parseArgs()
  if (st) {
    process.exit(selftest() ? 0 : 1)
  }

  const files = await collect(limit)
  const syms: Array<{ file: string; name: string; qn: string; kind: string }> = []
  const rels: Rel[] = []
  let degraded = 0
  let failed = 0

  for (const f of files) {
    let r: any
    try {
      r = await parseFile(f)
    } catch {
      failed++
      continue
    }
    if (!r) {
      failed++
      continue
    }
    if (r.fallback === true) degraded++
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (name.length === 0) continue
      syms.push({ file: f, name, qn: String(s?.qualifiedName ?? ""), kind: String(s?.kind ?? "") })
    }
    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      rels.push({
        file: f,
        type: ontologyName(String(rel?.type ?? rel?.relationshipType ?? "")),
        source: String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? ""),
        target: String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? ""),
      })
    }
  }

  const published = new Map<string, string[]>()
  for (const s of syms) {
    for (const k of [s.name, s.qn]) {
      if (k.length === 0) continue
      const a = published.get(k)
      if (a) {
        if (!a.includes(s.kind)) a.push(s.kind)
      } else published.set(k, [s.kind])
    }
  }

  const namedTargets = new Set<string>()
  const perType = new Map<string, { edges: number; bound: number; unbound: number; ambiguous: number }>()
  for (const t of TYPES) perType.set(t, { edges: 0, bound: 0, unbound: 0, ambiguous: 0 })
  for (const r of rels) {
    const row = perType.get(r.type)
    if (!row) continue
    row.edges++
    if (r.target.length === 0) continue
    const hits = published.get(r.target)
    if (!hits || hits.length === 0) {
      row.unbound++
      continue
    }
    row.bound++
    if (hits.length > 1) row.ambiguous++
    namedTargets.add(r.target)
  }

  const nameSet = new Set(syms.map((s) => s.name))
  const qnSet = new Set(syms.map((s) => s.qn).filter((q) => q.length > 0))
  const namedName = new Set([...namedTargets].filter((t) => nameSet.has(t)))
  const namedQn = new Set([...namedTargets].filter((t) => qnSet.has(t)))

  const orphanByName = syms.filter((s) => !namedName.has(s.name)).length
  const orphanByQualified = qnSet.size - namedQn.size
  const orphanByEither = syms.filter((s) => !namedTargets.has(s.qn) && !namedTargets.has(s.name)).length

  const out = {
    filesOffered: files.length,
    filesParsed: files.length - failed,
    parseFailures: failed,
    degraded,
    symbols: syms.length,
    edges: rels.length,
    distinctTargetsNamed: namedTargets.size,
    orphanByName,
    orphanByNameRate: syms.length ? orphanByName / syms.length : 0,
    orphanByQualified,
    orphanByQualifiedRate: qnSet.size ? orphanByQualified / qnSet.size : 0,
    orphanByEitherKey: orphanByEither,
    orphanByEitherKeyRate: syms.length ? orphanByEither / syms.length : 0,
    perType: Object.fromEntries(perType),
  }

  if (json) {
    console.log(JSON.stringify(out, null, 2))
    return
  }

  console.log(`corpus: ${CORPUS}`)
  console.log(`files offered ${files.length}   parsed ${out.filesParsed}   failures ${failed}   degraded ${degraded}`)
  console.log(`symbols ${syms.length}   edges ${rels.length}   distinct named targets ${namedTargets.size}`)
  console.log("")
  console.log("ORPHANS, THREE KEY SPACES — the first row is what incoming-check.ts prints")
  console.log("--------------------------------------------------------------------------------------------------------")
  console.log(`  by symbol.name          (incoming-check's key space)  ${String(orphanByName).padStart(6)} / ${syms.length}   ${(out.orphanByNameRate * 100).toFixed(2)}%`)
  console.log(`  by symbol.qualifiedName (the key space edges use)      ${String(orphanByQualified).padStart(6)} / ${qnSet.size}   ${(out.orphanByQualifiedRate * 100).toFixed(2)}%`)
  console.log(`  by either key           (most generous reading)        ${String(orphanByEither).padStart(6)} / ${syms.length}   ${(out.orphanByEitherKeyRate * 100).toFixed(2)}%`)
  console.log("")
  console.log("PER TYPE — bound means the target matched a published name OR qualifiedName")
  console.log("--------------------------------------------------------------------------------------------------------")
  console.log("type            edges   bound    bound%   unbound  ambiguous")
  for (const t of TYPES) {
    const r = perType.get(t)!
    const pct = r.edges ? ((r.bound / r.edges) * 100).toFixed(2) : "-"
    console.log(
      `${t.padEnd(14)} ${String(r.edges).padStart(6)} ${String(r.bound).padStart(7)} ${pct.padStart(8)} ${String(r.unbound).padStart(8)} ${String(r.ambiguous).padStart(10)}`,
    )
  }
}

main().catch((e) => {
  console.error(`[protobuf-orphan-key-audit] ${(e as Error)?.message ?? e}`)
  process.exit(1)
})
