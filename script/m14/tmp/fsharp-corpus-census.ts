// M60 functional-family / fsharp corpus census (first honest measurement of the
// lane, 2026-09-25).
//
// fsharp has NO differential lane: it is in neither `LANGS` nor the oracle table
// of script/m14/differential.ts, so its only corpus evidence was the census cell
// in the completion matrix. Per the ER3 lesson (a mirror oracle is blind to a bug
// it shares), the first act is a measurement of what the analyzer emits over the
// whole corpus, with the two defect classes the family has already paid for:
//
//   A. DANGLING ENDPOINTS — an edge whose source or target names no symbol of
//     the file (the ER3 `job -> id` class; also the haskell local-identity class).
//   B. PATH-VALUED NAMES — an edge endpoint that is a filesystem path (the ER3
//     `fileSource` class: an absolute checkout path published as an identity).
//
// plus the distribution of symbol kinds and relationship types, so the lane's
// contract can be compared with what is actually emitted.
//
// Usage: bun script/m14/tmp/fsharp-corpus-census.ts [--limit N] [--out file] [roots...]
import { Parser, Language } from "web-tree-sitter"
import { RealFsharpAnalyzer } from "../../../src/ast/real-fsharp-analyzer"
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import { execSync } from "node:child_process"
import { join, dirname, relative } from "node:path"

const CORPUS = "<corpus-root>/bb_tests/repositories/fsharp"
const argv = process.argv.slice(2)
const limitIdx = argv.indexOf("--limit")
const LIMIT = limitIdx >= 0 ? parseInt(argv[limitIdx + 1]) : Infinity
const outIdx = argv.indexOf("--out")
const OUT = outIdx >= 0 ? argv[outIdx + 1] : "validation/m14/results/archive/fsharp-corpus-census.json"
const roots = (() => {
  const rest = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--limit" && argv[i - 1] !== "--out")
  return rest.length ? rest : [CORPUS]
})()

const SKIP_DIRS = new Set([".git", "node_modules", "artifacts", "obj", "bin", "packages", ".fsproj"])

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue
    const p = join(dir, e)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(p, out)
    else if (e.endsWith(".fs") || e.endsWith(".fsi") || e.endsWith(".fsx")) out.push(p)
  }
  return out
}

// `--merge a.json,b.json,...` sums shard artifacts into one — the run is longer
// than the terminal's 10-minute cap, and the erlang ER3 census precedent is to
// shard and MERGE rather than to sample. Merged rows carry `mergedFromShards`.
async function mergeShards(paths: string[], out: string) {
  // Null-prototype: `{}["constructor"]` is Object.prototype.constructor, so the
  // merged histogram concatenated a function's source text for the `constructor`
  // symbol kind ("function Object() { [native code] }140"). Same bug as the
  // per-file histogram had; measured on the first merge, not assumed absent.
  const summed: Record<string, number> = Object.create(null)
  const addAll = (dst: Record<string, number>, src: Record<string, number> | undefined) => {
    for (const [k, v] of Object.entries(src ?? {})) dst[k] = (dst[k] ?? 0) + Number(v)
  }
  const counts = new Map<string, number>()
  const ambiguous = new Map<string, number>()
  const pathNames = new Map<string, number>()
  const worst: any[] = []
  const samples: any[] = []
  const bucketMerge: Record<string, { files: number; errorFiles: number; symbols: number; relationships: number }> =
    Object.create(null)
  let files = 0
  const kinds: Record<string, number> = Object.create(null)
  const types: Record<string, number> = Object.create(null)
  for (const p of paths) {
    const j = JSON.parse(readFileSync(p, "utf8"))
    files += Number(j.corpus?.files ?? 0)
    addAll(summed, j.totals)
    addAll(kinds, j.symbolKinds)
    addAll(types, j.relationshipTypes)
    for (const row of j.topDanglingNames ?? []) counts.set(row.name, (counts.get(row.name) ?? 0) + Number(row.count))
    for (const row of j.qualifiedSourceNames ?? []) ambiguous.set(row.name, (ambiguous.get(row.name) ?? 0) + Number(row.count))
    for (const row of j.pathEndpointNames ?? []) pathNames.set(row.name, (pathNames.get(row.name) ?? 0) + Number(row.count))
    for (const [k, v] of Object.entries(j.buckets ?? {})) {
      const t = (bucketMerge[k] ??= { files: 0, errorFiles: 0, symbols: 0, relationships: 0 })
      t.files += Number((v as any).files ?? 0)
      t.errorFiles += Number((v as any).errorFiles ?? 0)
      t.symbols += Number((v as any).symbols ?? 0)
      t.relationships += Number((v as any).relationships ?? 0)
    }
    worst.push(...(j.worstFiles ?? []))
    samples.push(...(j.samples ?? []))
  }
  const artifact = {
    schemaVersion: 1,
    kind: "m60-fsharp-corpus-census",
    generatedAt: new Date().toISOString(),
    mergedFromShards: paths,
    note: "Merged from per-shard census artifacts (the full-extent run exceeds one terminal command). Shard artifacts remain on disk; this row is the sum of their counters. TWO INSTRUMENT BUGS found and fixed in the probe while producing this row, recorded because an unaudited instrument is not evidence: (1) the symbol-kind histogram used plain objects, so the `constructor` key inherited Object.prototype.constructor and reported 'function Object() { [native code] }140' instead of a count — same bug reappeared in the merge path and was fixed there too; (2) an 'ambiguous leaf' counter was DEAD CODE (`!names.has(n)` then `names.has(n)` can never both hold) and was removed rather than published. The path-endpoint test was also tightened: F# quoted identifiers (`` ``test description with / (https://…)`` ``) and dotted names ending in .Fsi are legal names, not filesystem paths — the first cut reported 331 'path endpoints', all of that shape.",
    buckets: bucketMerge,
    corpus: { root: CORPUS, files, shards: paths.length },
    totals: summed,
    symbolKinds: { ...kinds },
    relationshipTypes: { ...types },
    topDanglingNames: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([name, count]) => ({ name, count })),
    qualifiedSourceNames: [...ambiguous.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([name, count]) => ({ name, count })),
    pathEndpointNames: [...pathNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, count]) => ({ name, count })),
    worstFiles: worst.sort((a, b) => b.dangling - a.dangling).slice(0, 40),
    samples: samples.slice(0, 25),
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(artifact, null, 2) + "\n")
  console.log(`merged ${paths.length} shards (${files} files) -> ${out}`)
  console.log(JSON.stringify(summed, null, 2))
  console.log(`symbolKinds: ${JSON.stringify(kinds)}`)
  console.log(`relationshipTypes: ${JSON.stringify(types)}`)
}

async function main() {
  if (argv[0] === "--merge") {
    const list = (argv[1] ?? "").split(",").filter(Boolean)
    if (!list.length) throw new Error("usage: --merge a.json,b.json [--out merged.json]")
    await mergeShards(list, OUT)
    return
  }
  await Parser.init()
  const parser = new Parser()
  parser.setLanguage(await Language.load(new URL("../../../wasm/tree-sitter-fsharp.wasm", import.meta.url).pathname))

  // `--filelist <path>`: an explicit newline-delimited file list. The corpus is
  // larger than one terminal command, so the shard boundaries are computed by a
  // chunker over a full walk (script/m14/tmp/fsharp-census-chunks.ts) rather than
  // hand-assigned to directories, where a truncated directory listing would
  // silently drop files.
  const listIdx = argv.indexOf("--filelist")
  const all = listIdx >= 0
    ? readFileSync(argv[listIdx + 1], "utf8").split("\n").map((s) => s.trim()).filter(Boolean).sort()
    : roots.flatMap((r) => walk(r)).sort()
  const files = all.slice(0, LIMIT)
  console.log(`files=${files.length}${LIMIT !== Infinity ? ` (of ${all.length}, --limit)` : ""} roots=${roots.join(",")}`)

  // Null-prototype maps: a plain `{}` inherits `constructor` from Object.prototype,
  // so `symByKind["constructor"] + 1` concatenated a FUNCTION's source text into the
  // histogram (caught by the 250-file smoke run: `"constructor":"function Object() {…}1"`).
  const relByType: Record<string, number> = Object.create(null)
  const symByKind: Record<string, number> = Object.create(null)
  const danglingNames = new Map<string, number>()
  // SOURCE-SPELLING MISMATCH: an edge whose source names no symbol of the file,
  // while its LAST dotted segment does — e.g. `overrides "Module.P1" -> "P1"` in a
  // file whose symbol is `P1`. The caller identity then resolves to nothing even
  // though the entity exists (the ER3 dangling-endpoint class, source side).
  // Measured on the SOURCE only: a qualified TARGET (`M.lookup`) is intentional
  // under the leaf-target contract, so the same test there would be noise.
  // (An earlier name-only "ambiguous leaf" counter was dead code — `!names.has(n)`
  // then `names.has(n)` can never both hold — and was removed rather than published.)
  const qualifiedSourceNames = new Map<string, number>()
  let qualifiedSourceMismatches = 0
  const lastSegment = (n: string) => (n.includes(".") ? n.slice(n.lastIndexOf(".") + 1) : n)
  const pathNames = new Map<string, number>()
  const samples: any[] = []
  let symbols = 0
  let relationships = 0
  let danglingSource = 0
  let danglingTarget = 0
  let pathEndpoints = 0
  let parsedErrors = 0
  let threw = 0
  // Per-bucket (first path segment under the corpus): a corpus-wide ERROR-node
  // rate is unreadable on this repo — `tests/**/resources/tests/Diagnostics` and
  // the Conformance negative cases are INTENTIONALLY invalid F# — so the rate has
  // to be reported for the real-source trees separately.
  const buckets: Record<string, { files: number; errorFiles: number; symbols: number; relationships: number }> =
    Object.create(null)
  const worst: { file: string; dangling: number; total: number }[] = []
  const started = Date.now()

  for (const file of files) {
    let src: string
    try {
      src = readFileSync(file, "utf8")
    } catch {
      continue
    }
    const bucket = relative(CORPUS, file).split("/")[0] || "(root)"
    const b = (buckets[bucket] ??= { files: 0, errorFiles: 0, symbols: 0, relationships: 0 })
    b.files++
    const tree = parser.parse(src)
    if (!tree) {
      parsedErrors++
      b.errorFiles++
      continue
    }
    if (tree.rootNode.hasError) {
      parsedErrors++
      b.errorFiles++
    }
    let res: any
    try {
      res = new RealFsharpAnalyzer().analyze(tree.rootNode, src, file)
    } catch (e) {
      threw++
      tree.delete()
      continue
    }
    tree.delete()

    const names = new Set<string>()
    for (const s of res.symbols ?? []) {
      symbols++
      b.symbols++
      const k = String(s?.kind ?? "?")
      symByKind[k] = (symByKind[k] ?? 0) + 1
      if (s?.name) names.add(String(s.name))
    }
    let perFileDangling = 0
    for (const r of res.relationships ?? []) {
      relationships++
      b.relationships++
      const t = String(r.type ?? "?")
      relByType[t] = (relByType[t] ?? 0) + 1
      const s = String(r.source ?? "")
      const tg = String(r.target ?? "")
      // A FILESYSTEM PATH, not "any name containing a slash": F# quoted
      // identifiers (`` ``text with / and (https://…)`` ``) are legal names and
      // dominated the first cut (331 hits, mostly test descriptions), and dotted
      // F# names ending in `.Fsi` (CompilerOptions.Fsi) are not paths either.
      const isPath = (n: string) => /^([A-Za-z]:[\\/]|\/|\.\.?\/)/.test(n) || /[\\/][^\\/]*\.(fs|fsi|fsx)$/i.test(n)
      if (isPath(s) || isPath(tg)) {
        pathEndpoints++
        const p = isPath(s) ? s : tg
        pathNames.set(p, (pathNames.get(p) ?? 0) + 1)
        if (samples.length < 25)
          samples.push({
            class: "path-endpoint",
            file: relative(CORPUS, file),
            type: t,
            source: s,
            target: tg,
            line: (r.metadata ?? {}).line ?? r.metadata?.lineNumber ?? null,
          })
      }
      if (!names.has(s)) {
        danglingSource++
        perFileDangling++
        danglingNames.set(s, (danglingNames.get(s) ?? 0) + 1)
        if (s.includes(".") && names.has(lastSegment(s))) {
          qualifiedSourceMismatches++
          qualifiedSourceNames.set(s, (qualifiedSourceNames.get(s) ?? 0) + 1)
        }
        if (samples.length < 25 && s)
          samples.push({
            class: "dangling-source",
            file: relative(CORPUS, file),
            type: t,
            source: s,
            target: tg,
            line: (r.metadata ?? {}).line ?? r.metadata?.lineNumber ?? null,
          })
      }
      if (!names.has(tg)) {
        danglingTarget++
        perFileDangling++
        danglingNames.set(tg, (danglingNames.get(tg) ?? 0) + 1)
        if (samples.length < 25 && tg)
          samples.push({
            class: "dangling-target",
            file: relative(CORPUS, file),
            type: t,
            source: s,
            target: tg,
            line: (r.metadata ?? {}).line ?? r.metadata?.lineNumber ?? null,
          })
      }
    }
    if (perFileDangling) worst.push({ file: relative(CORPUS, file), dangling: perFileDangling, total: (res.relationships ?? []).length })
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  const top = (m: Map<string, number>, n = 20) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)

  console.log(`\nfiles=${files.length} parseErrorsOrHasError=${parsedErrors} analyzerThrew=${threw}`)
  console.log(`symbols=${symbols} relationships=${relationships}  elapsed=${elapsed}s`)
  console.log(`DANGLING source=${danglingSource} target=${danglingTarget}  PATH-ENDPOINTS=${pathEndpoints}`)
  console.log(`SOURCE-SPELLING MISMATCH (source not a symbol, last dotted segment is) = ${qualifiedSourceMismatches}`)
  console.log(`\nsymbol kinds: ${JSON.stringify(symByKind)}`)
  console.log(`relationship types: ${JSON.stringify(relByType)}`)
  console.log(`\n--- top dangling names ---`)
  for (const [n, c] of top(danglingNames)) console.log(`  ${String(c).padStart(6)}  ${n}`)
  console.log(`\n--- worst files by dangling endpoints (top 12) ---`)
  for (const w of worst.sort((a, b) => b.dangling - a.dangling).slice(0, 12)) console.log(`  ${String(w.dangling).padStart(5)}/${String(w.total).padStart(4)}  ${w.file}`)
  console.log(`\n--- path endpoints (top 10) ---`)
  for (const [n, c] of top(pathNames, 10)) console.log(`  ${String(c).padStart(6)}  ${n}`)
  console.log(`\n--- samples ---`)
  for (const s of samples.slice(0, 20)) console.log(`  ${s.class.padEnd(16)} ${s.type.padEnd(14)} ${String(s.source).slice(0, 34).padEnd(34)} -> ${String(s.target).slice(0, 34).padEnd(34)} ${s.file}:${s.line ?? ""}`)

  const artifact = {
    schemaVersion: 1,
    kind: "m60-fsharp-corpus-census",
    generatedAt: new Date().toISOString(),
    corpus: {
      root: CORPUS,
      roots,
      files: files.length,
      discovered: all.length,
      repoRevision: (() => {
        try {
          return execSync("git rev-parse HEAD", { cwd: CORPUS, stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
        } catch {
          return null
        }
      })(),
      dirty: (() => {
        try {
          return execSync("git status --porcelain", { cwd: CORPUS, stdio: ["ignore", "pipe", "ignore"] }).toString().trim().length > 0
        } catch {
          return null
        }
      })(),
    },
    note: "First honest corpus measurement of the fsharp lane (no differential lane exists: fsharp is in neither LANGS nor the oracle table of script/m14/differential.ts). Measures exit distribution, symbol kinds, relationship types, dangling endpoints (edge endpoint naming no symbol of the file) and path-valued endpoints. Not an oracle comparison — a census.",
    totals: {
      symbols,
      relationships,
      danglingSource,
      danglingTarget,
      qualifiedSourceMismatches,
      pathEndpoints,
      parseErrorsOrHasError: parsedErrors,
      analyzerThrew: threw,
    },
    symbolKinds: { ...symByKind },
    relationshipTypes: relByType,
    topDanglingNames: top(danglingNames, 40).map(([name, count]) => ({ name, count })),
    qualifiedSourceNames: top(qualifiedSourceNames, 30).map(([name, count]) => ({ name, count })),
    pathEndpointNames: top(pathNames, 20).map(([name, count]) => ({ name, count })),
    buckets,
    worstFiles: worst.sort((a, b) => b.dangling - a.dangling).slice(0, 40),
    samples: samples.slice(0, 25),
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n")
  console.log(`\nwrote ${OUT}`)

  parser.delete()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
