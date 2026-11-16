/**
 * script/m14/tmp/fsharp-grammar-ab.ts
 *
 * The fsharp pin's behavioural half: parse every git-tracked .fs/.fsi/.fsx file of
 * the lane's corpus with BOTH the wired wasm (0.3.11 + the two vendored grammar
 * rules) and the npm tree-sitter-fsharp@0.3.11 wasm (unpatched), and compare:
 *
 *   - damage under each (ERROR nodes, MISSING tokens),
 *   - an ORDERED tree digest (type + field + token text, position-free), so "the
 *     patch changed this file's tree" is measured rather than inferred,
 *   - a sentinel for the manifest's scanner claim: whether the parse tree contains
 *     a `union_type_cases` node where an `interface_implementation` belongs.
 *
 * Sharded because the corpus is 6.6k files and each grammar is 12.6 MB:
 *   bun script/m14/tmp/fsharp-grammar-ab.ts --shard 0 --shards 4
 *   bun script/m14/tmp/fsharp-grammar-ab.ts --merge
 */
import * as fs from "fs"
import * as path from "path"
import { createHash } from "crypto"
import { execSync } from "child_process"

const ROOT = path.resolve(import.meta.dir ?? path.dirname(Bun.main), "..", "..", "..")
const HOME = process.env.HOME ?? ""
const REPO = "<corpus-root>/bb_tests/repositories/fsharp"
const OUT = path.join(ROOT, "validation/m14/results/archive/fsharp-grammar-ab.json")
const shardFile = (i: number) => path.join(ROOT, `validation/m14/results/fsharp-grammar-ab.shard${i}.json`)
const sha256Text = (s: string) => createHash("sha256").update(s).digest("hex")

const GRAMMARS = [
  { label: "wired", file: path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"), provenance: "repo wasm/ — 0.3.11 + module_val_declaration + nullable_type (see validation/m14/results/archive/fsharp-pin-evidence.json)" },
  { label: "npm-0.3.11-unpatched", file: path.join(HOME, ".bun/install/cache/tree-sitter-fsharp@0.3.11@@@1/tree-sitter-fsharp.wasm"), provenance: "npm tree-sitter-fsharp@0.3.11 tarball wasm" },
]

const SENTINELS = ["module_val_declaration", "nullable_type", "union_type_cases", "interface_implementation", "union_type_case"]

/**
 * Ordered digest, hashed INCREMENTALLY (the first draft built one giant string per
 * tree and spent most of its wall time concatenating; this version feeds the hash
 * as it walks).
 */
function measure(root: any) {
  const hash = createHash("sha256")
  let errors = 0
  let missing = 0
  const sentinels: Record<string, number> = {}
  const stack: Array<[any, string]> = [[root, ""]]
  while (stack.length) {
    const [n, field] = stack.pop()!
    if (n.type === "ERROR") errors++
    if (n.isMissing) missing++
    if (SENTINELS.includes(n.type)) sentinels[n.type] = (sentinels[n.type] ?? 0) + 1
    if (n.childCount === 0) {
      hash.update(`\u0001${n.type}\u0002${n.text}`)
    } else {
      hash.update(`(${n.type}${field ? `[${field}]` : ""}`)
      for (let i = n.childCount - 1; i >= 0; i--) {
        const c = n.child(i)
        if (c) stack.push([c, n.fieldNameForChild(i) ?? ""])
      }
    }
  }
  return { digest: hash.digest("hex"), errors, missing, sentinels }
}

async function main() {
  const shardIdx = process.argv.includes("--shard") ? parseInt(process.argv[process.argv.indexOf("--shard") + 1]) : 0
  const shards = process.argv.includes("--shards") ? parseInt(process.argv[process.argv.indexOf("--shards") + 1]) : 1
  const merge = process.argv.includes("--merge")

  const head = execSync("git rev-parse HEAD", { cwd: REPO }).toString().trim()
  const fullCorpus = execSync("git ls-files '*.fs' '*.fsi' '*.fsx'", { cwd: REPO }).toString().trim().split("\n").filter(Boolean)
  const sampleArg = process.argv.includes("--sample") ? process.argv[process.argv.indexOf("--sample") + 1] : null
  const samplePath = sampleArg ? path.resolve(ROOT, sampleArg) : null
  const all = samplePath ? fs.readFileSync(samplePath, "utf8").trim().split("\n").filter(Boolean) : fullCorpus
  const basis = samplePath
    ? { kind: "recorded-sample", sampleFile: path.relative(ROOT, samplePath), sampleSize: all.length, corpusFiles: fullCorpus.length }
    : { kind: "full-corpus", corpusFiles: fullCorpus.length }

  if (merge) {
    const rows: any[] = []
    const perGrammar: Record<string, any> = {}
    for (const g of GRAMMARS) perGrammar[g.label] = { files: 0, damagedFiles: 0, errorNodes: 0, missingTokens: 0, crashes: 0, sentinels: {} }
    for (let i = 0; i < shards; i++) {
      const p = shardFile(i)
      if (!fs.existsSync(p)) continue
      const part = JSON.parse(fs.readFileSync(p, "utf8"))
      rows.push(...part.rows)
      for (const g of GRAMMARS) {
        const a = part.perGrammar[g.label]
        const t = perGrammar[g.label]
        t.files += a.files
        t.damagedFiles += a.damagedFiles
        t.errorNodes += a.errorNodes
        t.missingTokens += a.missingTokens
        t.crashes += a.crashes
        for (const [k, v] of Object.entries(a.sentinels ?? {})) t.sentinels[k] = (t.sentinels[k] ?? 0) + (v as number)
      }
    }
    const adjudication: any = {
      files: rows.length,
      bothParsed: 0,
      treesIdentical: 0,
      treesDiffer: 0,
      damagedOnlyUnderWired: [],
      damagedOnlyUnderBase: [],
      damagedUnderBoth: [],
      sentinelUnionTypeCasesWhereInterfaceExpected: [],
      scannedShards: shards,
    }
    for (const r of rows) {
      const a = r.wired
      const b = r["npm-0.3.11-unpatched"]
      if (!a || !b || a.crash || b.crash) continue
      adjudication.bothParsed++
      if (a.digest === b.digest) adjudication.treesIdentical++
      else adjudication.treesDiffer++
      const da = a.errors > 0 || a.missing > 0
      const db = b.errors > 0 || b.missing > 0
      if (da && !db) adjudication.damagedOnlyUnderWired.push({ file: r.file, wired: a, base: b })
      if (db && !da) adjudication.damagedOnlyUnderBase.push({ file: r.file, wired: a, base: b })
      if (da && db) adjudication.damagedUnderBoth.push({ file: r.file, wired: a, base: b })
      const wiredUnion = a.sentinels["union_type_cases"] ?? 0
      const baseUnion = b.sentinels["union_type_cases"] ?? 0
      const wiredImpl = a.sentinels["interface_implementation"] ?? 0
      const baseImpl = b.sentinels["interface_implementation"] ?? 0
      if (baseUnion > wiredUnion || wiredImpl > baseImpl) {
        adjudication.sentinelUnionTypeCasesWhereInterfaceExpected.push({ file: r.file, wiredUnion, baseUnion, wiredImpl, baseImpl, treesDiffer: a.digest !== b.digest })
      }
    }
    const out = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      commit: execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(),
      corpus: { repo: "fsharp", head, files: all.length, basis },
          grammars: GRAMMARS.map((g) => ({ label: g.label, file: path.relative(ROOT, g.file), provenance: g.provenance, sha256: createHash("sha256").update(fs.readFileSync(g.file)).digest("hex") })),
      method: {
        damage: "ERROR nodes and MISSING tokens over all children",
        digest: "ordered serialization of the whole tree: type + field name + leaf token text, positions excluded",
        sentinel: "union_type_cases / interface_implementation / union_type_case counts per file, for the manifest's scanner claim",
      },
      perGrammar,
      adjudication,
      differingFiles: rows.filter((r) => r.wired && r["npm-0.3.11-unpatched"] && r.wired.digest !== r["npm-0.3.11-unpatched"].digest).map((r) => r.file),
    }
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")
    console.log(`files=${adjudication.files} identical=${adjudication.treesIdentical} differ=${adjudication.treesDiffer}`)
    console.log(`damaged only under wired=${adjudication.damagedOnlyUnderWired.length} only under base=${adjudication.damagedOnlyUnderBase.length} both=${adjudication.damagedUnderBoth.length}`)
    console.log(`scanner sentinel hits (base union_type_cases > wired, or wired interface_implementation > base): ${adjudication.sentinelUnionTypeCasesWhereInterfaceExpected.length}`)
    for (const g of GRAMMARS) {
      const t = perGrammar[g.label]
      console.log(`  ${g.label.padEnd(24)} damaged=${t.damagedFiles}/${t.files} ERROR=${t.errorNodes} MISSING=${t.missingTokens} crashes=${t.crashes} union_type_cases=${t.sentinels["union_type_cases"] ?? 0} interface_implementation=${t.sentinels["interface_implementation"] ?? 0}`)
    }
    console.log(`wrote ${path.relative(ROOT, OUT)}`)
    return
  }

  const mine = all.filter((_, i) => i % shards === shardIdx)
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const langs: Record<string, any> = {}
  for (const g of GRAMMARS) langs[g.label] = await Language.load(fs.readFileSync(g.file))

  const rows: any[] = []
  const perGrammar: Record<string, any> = {}
  for (const g of GRAMMARS) perGrammar[g.label] = { files: 0, damagedFiles: 0, errorNodes: 0, missingTokens: 0, crashes: 0, sentinels: {} }
  let done = 0
  const started = Date.now()
  for (const rel of mine) {
    let src: string
    try {
      src = fs.readFileSync(path.join(REPO, rel), "utf8")
    } catch {
      continue
    }
    if (++done % 25 === 0) {
      const rate = done / ((Date.now() - started) / 1000)
      console.log(`  ${done}/${mine.length} files (${rate.toFixed(1)}/s, eta ${Math.round((mine.length - done) / rate)}s)`)
    }
    const row: any = { file: rel }
    for (const g of GRAMMARS) {
      const p = new ParserClass()
      p.setLanguage(langs[g.label])
      try {
        const tree = p.parse(src)
        row[g.label] = measure(tree.rootNode)
        tree.delete?.()
      } catch (e: any) {
        row[g.label] = { crash: String(e?.message ?? e) }
        perGrammar[g.label].crashes++
      }
      p.delete?.()
      const m = row[g.label]
      if (!m.crash) {
        const t = perGrammar[g.label]
        t.files++
        t.errorNodes += m.errors
        t.missingTokens += m.missing
        if (m.errors > 0 || m.missing > 0) t.damagedFiles++
        for (const [k, v] of Object.entries(m.sentinels)) t.sentinels[k] = (t.sentinels[k] ?? 0) + (v as number)
      }
    }
    rows.push(row)
  }
  fs.writeFileSync(shardFile(shardIdx), JSON.stringify({ schemaVersion: 1, shard: shardIdx, shards, head, files: mine.length, perGrammar, rows }, null, 2) + "\n")
  console.log(`shard ${shardIdx}/${shards}: ${rows.length} files`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
