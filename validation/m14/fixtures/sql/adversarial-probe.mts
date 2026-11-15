/**
 * SQL PASS-2 ADVERSARIAL PROBE — for each type the analyzer emits, look for a case
 * where the LABEL IS WRONG. Pass 1 measured counts; this measures correctness, and
 * it is deliberately built so that a broken probe cannot also report a clean result.
 *
 * WHY THIS IS A SEPARATE FILE. `ontology-census.mts` tallies. Every question here
 * needs the tree as well as the edges, because the defect classes are all of the
 * form "the edge exists and the count is right and the edge is still false". The
 * CSS lane found 7,257 of 25,181 containment edges (28.8 %) pointing at a symbol
 * that did not contain the rule, and the census could not have seen it.
 *
 * WHAT IS PROBED, and why each one is the strongest available attack:
 *
 *  A1 `contains` RANGE — is the member's span inside the owner's span? This is the
 *     CSS DEFECT 2 shape: a containment edge whose target does not contain the
 *     member. Range is the only ground truth available from `parseFile`, which
 *     flattens to startLine/endLine and carries no range OBJECT — a probe that
 *     reads `symbol.range.start.line` finds nothing and returns 0 violations,
 *     which is the same number a correct probe returns. So this probe reads the
 *     FLATTENED fields and asserts they are present first.
 *  A2 `contains` OWNERSHIP — does the target's `ownerName` equal the edge source?
 *  A3 `calls` QUALIFIED — `evidenceClassFor` returns `reference_qualified` when
 *     `metadata.qualified` is set, and `processCalls` passes NO metadata at all,
 *     so `metadata.qualified` is never set on a call. If any call in the corpus is
 *     written `schema.func(...)` it is emitted as `usage_contextual` and the
 *     `reference_qualified` tier is unreachable for `calls`. Counted on the tree.
 *  A4 `uses` QUALIFIED — the same metadata IS passed by `addTableEdge`, and
 *     `evidenceClassFor` hardcodes `usage_contextual` for `uses` without looking
 *     at it. Asymmetry between two arms of the same switch, measured.
 *  A5 `overrides` CROSS-KIND — the documented rule is "a name this file already
 *     declared OF THE SAME KIND", and `state.redeclared` is keyed on the NAME
 *     ALONE. `CREATE FUNCTION v()` then `CREATE VIEW v` would satisfy the key and
 *     be published as an override. Pass 1's construct probe counted 15 same-kind
 *     OR REPLACE redeclarations; the analyzer emits 22. This accounts for the 7.
 *  A6 `instantiates` COVERAGE — `processInstantiations` is reached only from
 *     `processQueryDependencies`, so a `ROW(...)::t` outside a query node emits no
 *     edge. Counted on the tree: how many construction-shaped casts with a
 *     `custom_type` field sit OUTSIDE any query node.
 *  A7 `imports` RESOLVABILITY — the 22 psql include targets are paths relative to
 *     the including script. Does the file actually exist when joined? If it does,
 *     the edge is resolvable and the doc's "a consumer must join them" is a
 *     missing join rather than a property of the construct.
 *  A8 `uses` LEAKED CTE — pass 1 fixed one CTE leak in the declaration sweep.
 *     Whether any remain is a question, not an assumption.
 *  A9 `references` SLOT — every `references` target must sit in a
 *     grammar-mandated slot. `referencesTarget` reads it; this re-derives it
 *     independently and reports the ones that do not.
 *
 * USAGE:
 *   npx tsx validation/m14/fixtures/sql/adversarial-probe.mts [--out FILE] [--limit N]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from "node:fs"
import * as path from "node:path"
import { Parser, Language } from "web-tree-sitter"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile, keepSymbol, nameTheSymbolRule } from "../../../../src/ast/pool-worker"
import { SQL_BUILTINS, SQL_KEYWORDS } from "../../../../src/ast/real-sql-analyzer"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const OUT = argOf("--out")
const LIMIT = argOf("--limit") ? Number(argOf("--limit")) : Infinity
const SIZE_CAP = 512 * 1024

/** The one corpus file whose wasm parse faults and then hangs; see ontology-census.mts. */
const EXCLUDE = process.argv.includes("--exclude-hanging") ? ["duckdb/extension/tpcds/dsdgen/queries/83.sql"] : []

// ------------------------------------------------------------------ discovery
const admitted: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
for (const entry of readdirSync(CR)) {
  const dir = path.join(CR, entry)
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
    try { if (statSync(abs).size > SIZE_CAP) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "sql") continue
    if (EXCLUDE.some((s) => abs.endsWith(s))) continue
    admitted.push({ repo: entry, dir, rel, abs, text })
  }
}
const universe = admitted.length
const pool = admitted
const selected = LIMIT >= universe ? pool : Array.from({ length: LIMIT }, (_, i) => pool[Math.floor((i * universe) / LIMIT)])

await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-sql.wasm")))
const parser = new Parser()
parser.setLanguage(language as any)

// ------------------------------------------------------------------ tallies
type Probe = { n: number; files: Set<string>; examples: string[] }
const P: Record<string, Probe> = {}
const bump = (k: string, label: string, detail: string) => {
  const row = (P[k] ??= { n: 0, files: new Set<string>(), examples: [] })
  row.n++
  row.files.add(label)
  if (row.examples.length < 5) row.examples.push(`${label}: ${detail}`)
}

let idx = 0
const treeJobs: Promise<void>[] = []
async function worker() {
  for (;;) {
    const i = idx++
    if (i >= selected.length) return
    const f = selected[i]
    const label = `${f.repo}/${f.rel}`
    // ---- production edges, via parseFile
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { bump("parse-failures", label, "parseFile threw"); continue }
    // DEGRADATION DISCLOSURE, added in pass 3 after this probe reported a number its own log
    // contradicted. A file the ENGINE degraded contributes no edges, so every "the analyzer did not
    // emit this" probe below counts its invocations as misses: a run logged four analyzer timeouts
    // (`postgrest/test/io/fixtures/{db_config,big_schema,privileges,load}.sql`) and reported
    // `A3-qualified-invocation-NOT-emitted-for-another-reason 70`, while
    // `pass3-invocation-why.mts` — which checks the same markers and buckets the causes — reports 0
    // for the same corpus. The 70 were four degraded files, not a defect. Both classes are counted
    // here so the artifact says which files were not measured.
    if (r?.fallback === true) bump("degraded-regex-fallback", label, "pool-worker returned extractFallback for a real parse error")
    for (const e of Array.isArray(r?.errors) ? r.errors : []) {
      const m = String(e?.message ?? "").toLowerCase()
      if (m.includes("timeout")) { bump("degraded-engine-timeout", label, "engine.ts answered its 120s analyzer budget with a basic parse result"); break }
    }
    const symbols: any[] = Array.isArray(r?.symbols) ? r.symbols : []
    const rels: any[] = Array.isArray(r?.relationships) ? r.relationships : []
    const byName = new Map<string, any[]>()
    for (const s of symbols) {
      const list = byName.get(String(s?.name ?? "")) ?? []
      list.push(s)
      byName.set(String(s?.name ?? ""), list)
    }

    // ---- A0: the flattened range fields MUST be present, or every range check below
    // is vacuous. CSS pass 2 shipped a probe that read `symbol.range.start.line`,
    // which parseFile never returns, and reported 0 violations from it.
    for (const s of symbols) {
      if (s.startLine === undefined || s.endLine === undefined) bump("A0-symbol-without-flattened-range", label, `${s.name}:${s.kind}`)
    }

    for (const rel of rels) {
      const type = String(rel?.type ?? "").toLowerCase()
      const source = String(rel?.source ?? "")
      const target = String(rel?.target ?? "")
      const meta = (rel?.metadata ?? {}) as Record<string, any>

      // ---- A1/A2: containment range and ownership
      //
      // DISAMBIGUATION IS LOAD-BEARING, and getting it wrong manufactures the CSS
      // defect this probe is looking for. `id` is a `property` on every table in the
      // file, so matching `contains orders -> id` against EVERY `id` symbol reports a
      // violation for each table's copy — a shape mismatch, not a containment
      // defect. The member is therefore resolved FIRST by `ownerName === source`,
      // which is the field the analyzer actually sets, and the shape-mismatch
      // population is counted under its own probe so the two can never be confused.
      if (type === "contains") {
        const owner = (byName.get(source) ?? []).filter((s) => String(s.kind) === "class" || String(s.kind) === "namespace")
        const all = byName.get(target) ?? []
        const owned = all.filter((m) => String(m.ownerName ?? "") === source)
        if (owned.length === 0) {
          bump("A2-contains-target-ownerName-mismatch", label, `${source}->${target}, candidates' ownerName=${all.map((m) => String(m.ownerName ?? "(none)")).join("/") || "(no candidate)"}`)
        } else {
          bump("A1-contains-member-resolved-by-ownerName", label, `${source}->${target}`)
        }
        if (all.length > 1) bump("A2-contains-target-name-is-ambiguous-in-this-file", label, `${source}->${target} has ${all.length} same-named symbols`)
        if (owned.length === 0 || owner.length === 0) continue
        let inside = 0
        for (const o of owner) {
          if (typeof o.startLine !== "number" || typeof o.endLine !== "number") continue
          for (const m of owned) {
            if (typeof m.startLine !== "number" || typeof m.endLine !== "number") continue
            inside++
            if (m.startLine < o.startLine || m.endLine > o.endLine) {
              bump("A1-contains-member-outside-owner", label, `${source}(${o.startLine}-${o.endLine}) contains ${target}(${m.startLine}-${m.endLine})`)
            }
          }
        }
        if (inside === 0) bump("A1-contains-no-comparable-range-pair", label, `${source}->${target} — a flattened startLine/endLine was missing, so this check would have been vacuous`)
      }

      // ---- A3/A4: the evidence tier must AGREE with the metadata the edge carries.
      //
      // The expected tier is derived HERE rather than read from the analyzer's own
      // table, because a probe that reads that table cannot disagree with it. A
      // qualified reference names its own schema; a bare slot does not.
      const wantTier = meta.qualified ? "reference_qualified" : "usage_contextual"
      if (type === "calls" || type === "uses") {
        const tag = type === "calls" ? "A3" : "A4"
        if (meta.evidenceClass === wantTier) bump(`${tag}-tier-AGREES-with-the-metadata`, label, `${type} ${source}->${target} qualified=${meta.qualified ?? "(none)"} tier=${meta.evidenceClass}`)
        else bump(`${tag}-tier-DISAGREES-with-the-metadata`, label, `${type} ${source}->${target} qualified=${meta.qualified ?? "(none)"} tier=${meta.evidenceClass}`)
        if (meta.evidenceClass === "reference_qualified" && !meta.qualified) bump(`${tag}-reference_qualified-with-no-qualified-name`, label, `${type} ${source}->${target}`)
        if (meta.evidenceClass === "usage_contextual" && meta.qualified) bump(`${tag}-usage_contextual-on-a-QUALIFIED-name`, label, `${type} ${source}->${target} qualified=${meta.qualified}`)
      }

      // ---- A13: an edge whose endpoint symbol the SHARED machinery deletes.
      // `keepSymbol`'s UNIVERSAL denylist in `src/ast/pool-worker.ts` holds
      // `program` — the grammar's ROOT node type — beside `root`,
      // `module_declaration` and `source_file`. `program` is also a legal SQL
      // column name, so `keepSymbol` drops the symbol while the `contains` edge
      // naming it survives: the loss is not a missing symbol, it is a DANGLING EDGE
      // that names something no consumer can resolve. SQL-G13 recorded the dropped
      // symbol half; this is the half that corrupts a graph, and it is a §8 item
      // because `pool-worker.ts` is shared.
      if (type === "contains") {
        for (const m of byName.get(target) ?? []) {
          if (keepSymbol(m, "sql")) continue
          bump("A13-contains-edge-names-a-symbol-keepSymbol-deletes", label, `${source}->${target} kind=${m.kind} rule=${nameTheSymbolRule(m, "sql")}`)
        }
      }

      // ---- A7: does a psql include target exist on disk?
      if (type === "imports" && meta.psqlInclude) {
        const joined = path.resolve(path.dirname(f.abs), target)
        if (existsSync(joined)) bump("A7-psql-include-target-exists-after-join", label, `${target} -> ${path.relative(f.dir, joined)}`)
        else bump("A7-psql-include-target-missing-after-join", label, `${target} joined to ${path.relative(f.dir, joined)}`)
      }
    }

    // ---- tree-side probes, one parse
    const tree = parser.parse(f.text)
    if (!tree) { treeJobs.length; bump("tree-parse-fail", label, "parser.parse returned null"); continue }
    const root = tree.rootNode
    const walk = (n: any, fn: (n: any) => void) => {
      const stack = [n]
      while (stack.length) {
        const c = stack.pop()
        fn(c)
        for (let i = 0; i < c.childCount; i++) stack.push(c.child(i))
      }
    }

    // A3 — a `calls` edge the analyzer emits for a QUALIFIED invocation. If this is
    // non-zero then `evidenceClassFor`'s `reference_qualified` arm is unreachable for
    // calls and every one of these edges is under-claimed.
    const emittedCalls = new Set<string>()
    for (const rel of rels) if (String(rel?.type ?? "").toLowerCase() === "calls") emittedCalls.add(String(rel?.target ?? ""))
    walk(root, (n) => {
      if (n.type !== "invocation" || n.hasError) return
      const obj = (n.namedChildren ?? []).find((c: any) => c.type === "object_reference")
      if (!obj) return
      const parts = (obj.namedChildren ?? []).filter((c: any) => c.type === "identifier" || c.type === "literal")
      if (parts.length < 2) return
      const leaf = parts[parts.length - 1].text.replace(/^["`[]|["`\]]$/g, "")
      // Splitting "not emitted" matters. `pg_catalog.pg_table_is_visible(...)` is a
      // PostgreSQL catalog call that `SQL_BUILTINS` deliberately suppresses, and a
      // probe that lumped it in with a genuinely dropped edge would report a defect
      // that is a guard working. The guard sets are imported from the ANALYZER, so
      // this cannot drift from what the guard actually tests.
      const bucket = emittedCalls.has(leaf)
        ? "A3-qualified-invocation-EMITTED"
        : SQL_KEYWORDS.has(leaf.toLowerCase()) || SQL_BUILTINS.has(leaf.toLowerCase())
          ? "A3-qualified-invocation-suppressed-as-keyword-or-builtin"
          : "A3-qualified-invocation-NOT-emitted-for-another-reason"
      bump(bucket, label, `${parts.map((p: any) => p.text).join(".")}(...)`)
    })

    // A4 — a qualified `from`/`relation` reference, which `addTableEdge` records in
    // metadata. The tree count bounds how many `uses` edges carry a qualified name.
    walk(root, (n) => {
      if (n.type !== "object_reference") return
      if (n.parent?.type !== "from" && n.parent?.type !== "relation") return
      const parts = (n.namedChildren ?? []).filter((c: any) => c.type === "identifier" || c.type === "literal")
      if (parts.length < 2) return
      bump("A4-qualified-table-reference-on-tree", label, `${parts.map((p: any) => p.text).join(".")} in ${n.parent!.type}`)
      const emittedUses = new Set<string>()
      for (const rel of rels) if (String(rel?.type ?? "").toLowerCase() === "uses") emittedUses.add(String(rel?.target ?? "").replace(/^["`[]|["`\]]$/g, ""))
      const leafText = parts[parts.length - 1].text.replace(/^["`[]|["`\]]$/g, "")
      if (!emittedUses.has(leafText)) {
        bump("A4-qualified-table-reference-without-a-uses-edge", label, `${parts.map((p: any) => p.text).join(".")} in ${n.parent!.type}`)
      }
    })

    // A5 — declarations keyed by name alone, per file, exactly as `state.redeclared`
    // is. The second occurrence of a NAME whose two occurrences are of DIFFERENT
    // declaration kinds is a cross-kind pair the key cannot distinguish.
    const REPLACEABLE = new Set(["create_function", "create_procedure", "create_view", "create_materialized_view"])
    const seenByName = new Map<string, { kind: string; line: number; orReplace: boolean }>()
    walk(root, (n) => {
      if (!REPLACEABLE.has(n.type)) return
      const obj = (n.descendantsOfType?.("object_reference") ?? [])[0] as any
      const leaves: any[] = obj ? [...obj.descendantsOfType("identifier"), ...obj.descendantsOfType("literal")].sort((a, b) => a.startIndex - b.startIndex) : []
      if (leaves.length === 0) return
      const name = leaves[leaves.length - 1].text.replace(/^["`[]/, "").replace(/["`\]]$/, "")
      if (!name) return
      const orReplace = n.text.slice(0, 48).toUpperCase().includes("OR REPLACE")
      const prior = seenByName.get(name)
      if (prior) {
        if (prior.kind !== n.type) bump("A5-cross-kind-name-collision", label, `${name}: ${prior.kind}@L${prior.line} then ${n.type}@L${n.startPosition.row + 1}${orReplace ? " (OR REPLACE)" : ""}`)
        if (orReplace) bump("A5-or-replace-name-seen-before", label, `${name} kind=${n.type}${prior.kind === n.type ? "" : ` PRIOR-KIND=${prior.kind}`}`)
      }
      seenByName.set(name, { kind: n.type, line: n.startPosition.row + 1, orReplace })
    })

    // A6 — construction-shaped casts with a `custom_type` field, and whether they sit
    // under a query node. `processInstantiations` is reached only from
    // `processQueryDependencies`, so an unreachable one is a silent under-emission.
    const queryTypes = new Set(["select", "set_operation", "create_query", "subquery", "cte"])
    const emittedInst = new Set<string>()
    for (const rel of rels) if (String(rel?.type ?? "").toLowerCase() === "instantiates") emittedInst.add(String(rel?.target ?? "").toLowerCase())
    walk(root, (n) => {
      if (n.type !== "cast") return
      const target = n.childForFieldName?.("custom_type") as any
      if (!target) return
      const leaves: any[] = [...target.descendantsOfType("identifier"), ...target.descendantsOfType("literal")].sort((a, b) => a.startIndex - b.startIndex)
      if (leaves.length === 0) return
      const name = leaves[leaves.length - 1].text.replace(/^["`[]/, "").replace(/["`\]]$/, "").toLowerCase()
      let left: any = null
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c.type === "::") break
        if (c.isNamed) left = c
      }
      if (!left || left.hasError) return
      const constructed = left.type === "list" || left.type === "array" ||
        (left.type === "invocation" && ((left.namedChildren ?? []).find((c: any) => c.type === "object_reference")?.text ?? "").toLowerCase() === "row")
      if (!constructed) return
      let under = n.parent
      let inQuery = false
      while (under) { if (queryTypes.has(under.type)) { inQuery = true; break } under = under.parent }
      bump(inQuery ? "A6-construction-cast-inside-query" : "A6-construction-cast-OUTSIDE-query", label, `::${name} from a ${left.type} node; emitted=${emittedInst.has(name)}`)
    })

    // A8 — a `uses` edge whose target is the name of a CTE in the same file. Pass 1
    // fixed one such leak in the declaration sweep; this asks whether any remain.
    //
    // The interesting half is WHICH cte node the name came from. Pass 1's fix gave
    // the sweep the CTE scope of `ancestorStatement(current)`, which is the nearest
    // enclosing `statement`. A CTE's OWN body is a `statement` INSIDE that `cte`, so
    // for a reference inside it the scope is the body — and the body does not contain
    // the `cte` node that declares the name being referenced. That is a different leak
    // from the one pass 1 fixed, with the same wrong output, so it is counted with
    // the nesting depth it was found at.
    const cteNames = new Set<string>()
    const cteNodesAtDepth: { name: string; ancestors: string }[] = []
    walk(root, (n) => {
      if (n.type !== "cte") return
      const first = (n.namedChildren ?? []).find((c: any) => c.type === "identifier" || c.type === "literal")
      if (!first) return
      const name = first.text.replace(/^["`[]/, "").replace(/["`\]]$/, "")
      cteNames.add(name)
      let anc = n.parent
      const chain: string[] = []
      while (anc) { chain.push(anc.type); anc = anc.parent }
      cteNodesAtDepth.push({ name, ancestors: chain.join(">") })
    })
    for (const rel of rels) {
      const type = String(rel?.type ?? "").toLowerCase()
      if (type !== "uses" && type !== "references" && type !== "calls") continue
      const t = String(rel?.target ?? "")
      if (!cteNames.has(t)) continue
      // Is the same name ALSO reached by a QUALIFIED reference in this file? If so
      // the bare edge is not purely a fabrication — it is an AMBIGUITY the
      // (type, source, target) key cannot represent. Counted separately, because
      // calling it a fabrication would be the wrong word.
      let qualifiedReach = false
      walk(root, (n) => {
        if (n.type !== "object_reference") return
        if (n.parent?.type !== "from" && n.parent?.type !== "relation") return
        const parts = (n.namedChildren ?? []).filter((c: any) => c.type === "identifier" || c.type === "literal")
        if (parts.length >= 2 && parts[parts.length - 1].text.replace(/^["`[]|["`\]]$/g, "") === t) qualifiedReach = true
      })
      bump(qualifiedReach ? "A8-CTE-named-edge-also-reached-by-a-QUALIFIED-reference" : "A8-CTE-named-edge-with-no-qualified-reach", label, `${type} ${rel?.source}->${t}`)
    }
    // Also: the same file declaring a TABLE with that name means the edge is
    // ambiguous rather than wrong, so it is counted separately rather than as a defect.
    for (const rel of rels) {
      if (String(rel?.type ?? "").toLowerCase() !== "uses") continue
      const t = String(rel?.target ?? "")
      if (!cteNames.has(t)) continue
      if (byName.get(t)?.some((s) => String(s.kind) === "class")) bump("A8-CTE-name-also-a-table-in-this-file", label, `uses ->${t}`)
    }

    // A10 — `contains` edges whose member symbol does not record the owner. The
    // edge and the symbol's own metadata then disagree, and `bb_graph`'s
    // owner-cascade and `bb_impact`'s reverse walk both read `ownerName`.
    for (const rel of rels) {
      if (String(rel?.type ?? "").toLowerCase() !== "contains") continue
      const m = (byName.get(String(rel?.target ?? "")) ?? [])
      if (m.length === 0) { bump("A10-contains-target-has-no-symbol-in-this-file", label, `${rel?.source}->${rel?.target}`); continue }
      if (m.some((s) => String(s.ownerName ?? "") === String(rel?.source))) continue
      bump("A10-contains-member-symbol-does-not-name-its-owner", label, `${rel?.source}->${rel?.target} kinds=${[...new Set(m.map((s) => String(s.kind)))].join("/")} ownerName=${[...new Set(m.map((s) => String(s.ownerName ?? "(none)")))].join("/")}`)
    }

    // A11 — the `extends` ruling's stress test. PostgreSQL has TWO constructs that
    // make one table a subtype of another, and pass 1 tested only one of them:
    //
    //   CREATE TABLE c (…) INHERITS (p)          — the classic form
    //   CREATE TABLE c PARTITION OF p FOR VALUES … — declarative partitioning, and
    //     since PostgreSQL 11 the partition inherits the parent's columns without
    //     needing INHERITS at all
    //
    // If the wired grammar can represent the second one, then `extends` is NOT
    // ruled — it is merely unread, which is a different verdict. Probed as a
    // capability test on synthetic input AND as a corpus count.
    walk(root, (n) => {
      // A11 — the `extends` ruling's stress test. PostgreSQL has TWO constructs that
      // make one table a subtype of another, and pass 1 tested only one of them:
      //
      //   CREATE TABLE c (…) INHERITS (p)          — the classic form
      //   CREATE TABLE c PARTITION OF p FOR VALUES … — declarative partitioning, and
      //     since PostgreSQL 11 the partition inherits the parent's columns without
      //     needing INHERITS at all
      //
      // If the wired grammar can represent the second one, then `extends` is NOT
      // ruled — it is merely unread, which is a different verdict. Counted on the
      // corpus; the capability half (does the grammar express it at all) is the
      // A12 section below, because a corpus count cannot answer it.
      if (n.type !== "create_table") return
      const tp = (n.descendantsOfType?.("table_partition") ?? [])[0] as any
      if (!tp) return
      const toks = new Set<string>()
      walk(tp, (c) => { if (c.childCount === 0) toks.add(c.text.toUpperCase()) })
      if (!toks.has("PARTITION")) return
      // Character scan, not /\bOF\b/: the test is "is there an `OF` token in this ERROR node", and
      // a word-boundary regex would also fire on `OFFSET`, `OFF` and any identifier containing those
      // letters — which is the gate header's `class voice` failure in a different costume.
      const hasOf = (tp.namedChildren ?? []).some((c: any) => {
        if (c.type !== "ERROR") return false
        const stack = [c]
        while (stack.length) {
          const n = stack.pop()!
          if (n.childCount === 0 && String(n.text).toUpperCase() === "OF") return true
          for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
        }
        return false
      })
      bump(hasOf ? "A11-PARTITION-OF-is-an-ERROR-node" : "A11-PARTITION-BY-parsed-cleanly", label, collapse(tp.text.slice(0, 70)))
    })
    // A14 — a `uses` edge emitted from inside a CTE whose OWN subtree carries an
    // ERROR. The scope fix settles sibling and self references, but it cannot settle
    // this: when error recovery swallows a WITH list, the names in it never become
    // `cte` nodes at all, so the scope set is complete and still wrong.
    //
    // The measured case is DuckDB's `USING KEY`, which the wired grammar has no rule
    // for. `WITH RECURSIVE parse(i, s, a, b) USING KEY (s, a, b) AS ( … UNION ALL (
    // WITH candidates AS (…), new_facts AS (… FROM candidates …) ) )` puts
    // `(keyword_key)` in an ERROR that runs to the end of the outer body, so
    // `candidates` is inside the ERROR and is not a `cte` node. `FROM candidates`
    // then publishes `uses global->candidates` — a name that is a CTE in SQL and a
    // table in the analyzer's output.
    //
    // Counted rather than suppressed here: the fix would have to decide that ANY
    // error inside a CTE body means the WITH list was lost, and that decision
    // suppresses true table edges for every file with an unrelated unparseable
    // expression in a CTE. The population is the measurement.
    const errorCteLeaves = new Set<string>()
    walk(root, (n) => {
      if (n.type !== "cte" || !n.hasError) return
      walk(n, (m) => {
        if (m.type !== "from" && m.type !== "relation") return
        const obj = (m.namedChildren ?? []).find((c: any) => c.type === "object_reference")
        if (!obj) return
        const parts = (obj.namedChildren ?? []).filter((c: any) => c.type === "identifier" || c.type === "literal")
        if (parts.length !== 1) return
        errorCteLeaves.add(parts[0].text.replace(/^["`[]|["`\]]$/g, ""))
      })
    })
    if (errorCteLeaves.size > 0) {
      bump("A14-file-has-a-CTE-subtree-containing-an-ERROR", label, `${errorCteLeaves.size} unqualified references inside an error-bearing CTE: ${[...errorCteLeaves].slice(0, 5).join(", ")}`)
      for (const rel of rels) {
        if (String(rel?.type ?? "").toLowerCase() !== "uses") continue
        const t = String(rel?.target ?? "")
        if (errorCteLeaves.has(t)) bump("A14-uses-edge-from-inside-an-error-bearing-CTE", label, `uses ${rel?.source}->${t}`)
      }
    }
    tree.delete?.()
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

// ------------------------------------------------------------------ A12: capability tests
//
// A RULED verdict that says "the grammar cannot express this" is a claim about a
// `.wasm`, so it is settled by PARSING the construct, not by counting its absence
// over a corpus. Pass 1 established that for `CREATE TABLE c (…) INHERITS (p)`. It
// tested only that one form, and PostgreSQL has a second: since PG11 a
// `PARTITION OF` child inherits the parent's columns with no `INHERITS` clause at
// all, so a grammar could grow the clause and make `extends` derivable WITHOUT
// producing a node named for inheritance. That would leave the pass-1 overturn
// condition ("a keyword_inherits/inherits_clause node inside create_table") reading
// 0 on a corpus where the construct is present and readable — a ruling that would
// still be wrong, and would still sound right.
//
// So both forms are parsed here and the resulting node shape is reported.
/**
 * THE CAPABILITY BATTERY, rewritten to ask the TREE instead of a string.
 *
 * WHY THIS EXISTS. Pass 2's version rendered each parse with `rootNode.toString()` and then asked
 * REGEXES of the rendered shape — `/\bINHERITS\b/`, `/column_definition[^)]*custom_type/`,
 * `/ATTACH[\s\S]*PARTITION/`. That is the instrument the ontology gate's own header rejects, and in
 * this lane it had already produced one wrong verdict: a `CREATE TABLE c (LIKE p)` case searched the
 * shape for `(LIKE`, found nothing (the renderer prints `(column_definition custom_type: (object_reference))`),
 * and reported NOT EXPRESSIBLE for a clause the grammar reads. Pass 2 corrected the verdict and left
 * the mechanism, so the battery was one edit away from the same class of error and still carried
 * seven regexes this lane owns.
 *
 * WHAT REPLACES IT. Each case is decided by the node types the grammar actually produced, read
 * through `node.type` and named children. There is no rendered string to match against, so
 * "the token is present somewhere in a 400-character dump" is no longer a question that can be asked,
 * and the shape-vs-role confusion has no surface to occur on. The rendered shape is still RECORDED,
 * because it is the evidence a reader checks the node-type verdict against — it is evidence, not the
 * instrument.
 *
 * `hasToken` collects leaf TOKENS by their node type and text, which is what `PARTITION BY` needs:
 * `PARTITION` and `BY` are separate keyword tokens, and a node-type test for a node that does not
 * exist is the only honest way to ask whether the grammar has one.
 */
const CAPABILITY: { construct: string; sql: string; shape: string; nodeTypes: string[]; verdict: string }[] = []

/** Leaf tokens by UPPERCASE text, read from the tree. Character work, no regex. */
function leafTokens(root: any): Map<string, number> {
  const toks = new Map<string, number>()
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n.childCount === 0) {
      const t = String(n.text).toUpperCase()
      toks.set(t, (toks.get(t) ?? 0) + 1)
    }
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
  }
  return toks
}

function nodeTypeSet(root: any): Set<string> {
  const out = new Set<string>()
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()!
    out.add(n.type)
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
  }
  return out
}

function findFirst(root: any, type: string): any {
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === type) return n
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
  }
  return null
}

function collapse(s: string): string {
  let out = ""
  let space = false
  for (const ch of s) {
    if (ch === " " || ch === "\n" || ch === "\t" || ch === "\r") { space = true; continue }
    if (space && out.length) out += " "
    space = false
    out += ch
  }
  return out
}

/**
 * The `LIKE p` question, asked exactly. The first tree-based version of this battery asked "is there a
 * `column_definition` with a `custom_type` CHILD" and answered NO for a clause that parses cleanly,
 * because `custom_type` is a FIELD on `column_definition`, not a node type: the node's named children
 * are `[identifier, object_reference]` and the field points at the latter. So the honest test is the
 * field plus the name, which says more than the old regex did — not just that a `custom_type` appears
 * near a `column_definition`, but WHICH column_definition and what its declared name is.
 */
function likeClauseColumn(root: any): any | null {
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "column_definition") {
      const name = n.childForFieldName?.("name")
      const customType = n.childForFieldName?.("custom_type")
      if (name && customType && String(name.text).toUpperCase() === "LIKE") return n
    }
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
  }
  return null
}

/**
 * The `ATTACH PARTITION` question. The grammar cannot express it, and the way it MISREADS it is the
 * evidence: `ALTER TABLE p ATTACH PARTITION c FOR VALUES FROM (1) TO (10)` parses as an `alter_table`
 * whose only action is an `add_column` whose `column_definition` has `name: ATTACH` and
 * `custom_type: PARTITION`, with `FOR VALUES …` in a top-level ERROR. So the attachment clause
 * becomes a phantom added column — the same shape class as pass 2's DEFECT 1, one grammar level up.
 * A test that only asked "is the word ATTACH outside an ERROR" answers YES and calls the construct
 * expressible, which is why the first tree version of this battery was wrong and this one is not.
 */
function attachMisreadAsColumn(root: any): any | null {
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "column_definition") {
      const name = n.childForFieldName?.("name")
      if (name && String(name.text).toUpperCase() === "ATTACH") return n
    }
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
  }
  return null
}

/**
 * The ancestor chain ABOVE the first node of `type`, nearest parent first, stopping at the root. The
 * question `partition_by` needs is not "does a node with this name exist" — a substring search
 * already answers that — but "what KIND of thing is it an instance of", and only the chain says
 * that. Read through `node.parent` and `node.type`; no rendered string is matched.
 */
function ancestorTypes(root: any, type: string): string[] {
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === type) {
      const chain: string[] = []
      let p = n.parent
      while (p) { chain.push(p.type); p = p.parent }
      return chain
    }
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
  }
  return []
}

const capability = (construct: string, sql: string, verdict: (facts: { toks: Map<string, number>; types: Set<string>; root: any }) => string) => {
  const t = parser.parse(sql)!
  const facts = { toks: leafTokens(t.rootNode), types: nodeTypeSet(t.rootNode), root: t.rootNode }
  const shape = collapse(t.rootNode.toString().slice(0, 400))
  CAPABILITY.push({
    construct,
    sql: collapse(sql.trim()),
    shape,
    nodeTypes: [...facts.types].sort(),
    verdict: verdict(facts),
  })
  t.delete?.()
}

// Decided by NODE TYPE and by whether the clause's own tokens sit inside an ERROR node. The previous
// text-matched forms are kept as the recorded `shape` so a reader can audit the node-type verdict
// against the render.
const clauseSurvives = (root: any, token: string): boolean => {
  // Does `token` appear as a leaf that is NOT inside an ERROR node?
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n.childCount === 0 && String(n.text).toUpperCase() === token) {
      let p = n.parent
      while (p) { if (p.type === "ERROR") return false; p = p.parent }
      return true
    }
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
  }
  return false
}

capability(
  "CREATE TABLE ... INHERITS (p)",
  "CREATE TABLE c (id int) INHERITS (p);",
  (f) => (f.toks.has("INHERITS") && clauseSurvives(f.root, "INHERITS")
    ? "EXPRESSIBLE"
    : "NOT EXPRESSIBLE — the clause does not survive the parse"),
)
capability(
  "CREATE TABLE c PARTITION OF p FOR VALUES ...",
  "CREATE TABLE c PARTITION OF p FOR VALUES FROM (1) TO (10);",
  (f) => {
    // The discriminator is WHERE the `OF` token sits. `PARTITION BY` puts both tokens outside any
    // ERROR; `PARTITION OF` puts `OF` inside one, and a node type cannot tell those apart because
    // both are the same `keyword_of`-less bare token under `table_partition`.
    const ofOutside = clauseSurvives(f.root, "OF")
    const ofInside = f.toks.has("OF") && !ofOutside
    return ofOutside
      ? "EXPRESSIBLE"
      : ofInside
        ? "NOT EXPRESSIBLE — `OF <parent>` is absorbed by an ERROR node"
        : "NOT EXPRESSIBLE"
  },
)
capability(
  "CREATE TABLE c PARTITION BY RANGE (x)",
  "CREATE TABLE p (ts timestamptz) PARTITION BY RANGE (ts);",
  (f) => (f.types.has("table_partition")
    ? "EXPRESSIBLE — `table_partition` is the PARTITION BY form, which names no parent"
    : "NOT EXPRESSIBLE"),
)
capability(
  "ALTER TABLE c ATTACH PARTITION c2 FOR VALUES ...",
  "ALTER TABLE p ATTACH PARTITION c FOR VALUES FROM (1) TO (10);",
  (f) => {
    const misread = attachMisreadAsColumn(f.root)
    if (misread) {
      return "NOT EXPRESSIBLE — the grammar reads `ATTACH PARTITION c` as an ADD COLUMN whose name is `ATTACH` and whose type is `PARTITION`, and `FOR VALUES ...` lands in a top-level ERROR, so the attachment is not represented at all"
    }
    return f.toks.has("ATTACH") && clauseSurvives(f.root, "ATTACH")
      ? "EXPRESSIBLE"
      : "NOT EXPRESSIBLE"
  },
)
capability(
  "CREATE TABLE c (LIKE p)",
  "CREATE TABLE c (LIKE p);",
  // Decided by the SHAPE OF THE NODE, which is what pass 2 already concluded and what the old regex
  // could only approximate: `LIKE p` arrives as a `column_definition` whose `custom_type` is the
  // source table, because `LIKE` is a bare token with no node of its own. Asked directly — is there a
  // `column_definition` with a `custom_type` child? — rather than by matching a rendered dump for
  // `column_definition ... custom_type`, which is the same question asked through a lossy channel.
  (f) => {
    const cd = likeClauseColumn(f.root)
    return cd
      ? "EXPRESSIBLE — `LIKE p` arrives as a column_definition whose `custom_type` field is `p`, i.e. a structural COPY: the two tables evolve independently, so it is not inheritance"
      : "NOT EXPRESSIBLE"
  },
)
capability(
  "CREATE TABLE c (LIKE p INCLUDING ALL)",
  "CREATE TABLE c (LIKE p INCLUDING ALL);",
  (f) => (likeClauseColumn(f.root)
    ? "PARTIALLY EXPRESSIBLE — LIKE survives as a column_definition; `INCLUDING ALL` lands in an ERROR node, which is why the census counts 9 `keyword_like` nodes inside a `create_table` and not more"
    : "NOT EXPRESSIBLE"),
)
capability(
  "SELECT sum(x) OVER (PARTITION BY y) — the OTHER `PARTITION BY`",
  "SELECT sum(x) OVER (PARTITION BY y) FROM t;",
  // ADDED AT PASS 8, and it is the strongest candidate a reader could raise against the `extends`
  // ruling that pass 3 did not answer: the grammar has a node type whose NAME is `partition_by`, it
  // occurs 44 times corpus-wide, and a substring search for `partition` finds it. A page that reported
  // "the `partition` hits are `table_partition` and `keyword_partition`" was reporting TWO of the
  // THREE, and the omitted one is the only one whose name is not qualified by `table_`.
  //
  // So it is parsed here rather than argued about. The verdict is read off the PARENT CHAIN, which
  // is the only thing that distinguishes the two meanings of `PARTITION BY`: this node's parent is
  // `window_specification`, and a window-function partition names an ordering key, not a parent
  // table. Measured over the corpus by `partition-by-sites.mts`: 44 of 44 sites sit under
  // `window_specification`, and 0 sit under a `create_table` or `alter_table`.
  (f) => {
    const chain = ancestorTypes(f.root, "partition_by")
    if (!chain.length) return "NOT PRESENT — the grammar produced no `partition_by` node for this text"
    const underWindow = chain.includes("window_specification") || chain.includes("window_clause")
    return underWindow
      ? `EXPRESSIBLE, but it is the WINDOW-FUNCTION clause — parent chain ${chain.slice(0, 4).join(" > ")} — so it names an ordering key and not a parent table; it is not the construct`
      : `EXPRESSIBLE and UNEXPLAINED — parent chain ${chain.slice(0, 4).join(" > ")} is neither a window_specification nor a create/alter_table, so this node needs explaining before the \`extends\` ruling stands`
  },
)

// ------------------------------------------------------------------ report
const report: any = {
  instrument: "validation/m14/fixtures/sql/adversarial-probe.mts",
  corpusRoot: CR,
  admittedFilesTotal: universe,
  sampledFiles: selected.length,
  sampling: LIMIT >= universe ? "all admitted files" : `deterministic every-k slice, k=${(universe / LIMIT).toFixed(2)}`,
  excluded: EXCLUDE,
  probes: {},
}
console.log("SQL pass-2 adversarial probe")
console.log(`corpus          ${universe} admitted files, sampled ${selected.length} (${report.sampling})`)
console.log("")
const order = Object.keys(P).sort()
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`${w("probe", 46)}${w("count", 10)}files`)
console.log("-".repeat(80))
for (const k of order) {
  const row = P[k]
  console.log(`${w(k, 46)}${w(String(row.n), 10)}${row.files.size}`)
  report.probes[k] = { count: row.n, files: row.files.size, fileList: [...row.files].slice(0, 12), examples: row.examples }
}
console.log("-".repeat(80))
console.log("")
console.log("--- A12 capability tests: can the WIRED GRAMMAR express the construct at all? ---")
for (const c of CAPABILITY) {
  console.log(`  ${c.construct}`)
  console.log(`    ${c.verdict}`)
  console.log(`    shape: ${c.shape.slice(0, 260)}`)
}

if (OUT) {
  mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true })
  writeFileSync(path.resolve(OUT), `${JSON.stringify({ ...report, capabilityTests: CAPABILITY }, null, 2)}\n`)
  console.log(`\nwrote ${OUT}`)
}