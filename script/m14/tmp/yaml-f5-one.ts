// Single-file differential diagnostic: print the analyzer's key-tree paths and the
// oracle's side by side for ONE file, so a coverage number can be attributed to a
// normalization mistake rather than guessed at.
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const ORACLE = path.join(ROOT, "script/m14/tmp/yaml-f5-oracle.py")
const FILE = process.argv[2] ?? "<corpus-root>/bb_tests/repositories/grails-core/grails-core/src/test/resources/application.yml"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-yaml.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  const mod: any = await import(path.join(ROOT, "src/ast/real-yaml-analyzer.ts"))

  const content = fs.readFileSync(FILE, "utf8")
  const tree = parser.parse(content)
  const res: any = await new mod.RealYamlAnalyzer().analyze(tree.rootNode, content, FILE)
  const oracle = JSON.parse(execFileSync("python3", [ORACLE, JSON.stringify([FILE])], { encoding: "utf8", maxBuffer: 1 << 28 }))

  const stem = path.basename(FILE).replace(/\.(ya?ml)$/i, "")
  console.log("FILE      ", FILE)
  console.log("stem      ", JSON.stringify(stem))
  console.log("documents ", res.metadata?.documentCount, " analyzerPaths")
  console.log("oracle    ", JSON.stringify(oracle.totals), oracle.files[FILE]?.error ?? "")

  const syms = (res.symbols ?? []).map((s: any) => ({
    id: s.id, name: s.name, kind: s.kind, nodeType: s.metadata?.nodeType, isAnchor: !!s.metadata?.isAnchor,
    recovered: !!s.metadata?.recovered, isArrayItem: !!s.metadata?.isArrayItem, isDuplicateKey: !!s.metadata?.isDuplicateKey,
  }))
  console.log(`\nANALYZER SYMBOLS (${syms.length}):`)
  for (const s of syms.slice(0, 40)) console.log("  ", JSON.stringify(s))

  // The oracle reports ONE PATH SET PER DOCUMENT, and the analyzer names documents
  // `<stem>`, `<stem>#2`, ... in stream order, so the join is positional. This tool
  // read `oracle.files[FILE]?.paths`, which the oracle stopped emitting when it moved
  // to per-document path sets — so it printed "ORACLE PATHS (0)" and then reported
  // every analyzer symbol as ANALYZER-ONLY, which is the worst output a diagnostic can
  // produce: it looks like a finding and is a stale field name.
  //
  // It matters that this tool normalizes EXACTLY as yaml-f5-differential.ts does,
  // because that harness cites this file as the defence against the harness's own bug:
  // merging the oracle's documents into one flat list attributed every path in
  // documents 2..N to document 1, making a 5-document `application.yml` "disagree" on
  // 29 paths the two had in fact agreed on. A diagnostic that disagreed with the thing
  // it is diagnosing would send the next reader to the wrong file.
  const documentCount = Math.max(1, Number(res.metadata?.documentCount ?? 1))
  const oracleDocuments: string[][] = oracle.files[FILE]?.documents ?? []
  const oraclePaths: string[] = []
  for (let di = 0; di < Math.max(oracleDocuments.length, documentCount); di++) {
    for (const rel of oracleDocuments[di] ?? []) {
      const document = di === 0 ? stem : `${stem}#${di + 1}`
      oraclePaths.push(rel ? `${document}.${rel}` : document)
    }
  }
  if (oracleDocuments.length !== documentCount) {
    console.log(`\n!! DOCUMENT COUNT MISMATCH: analyzer=${documentCount} oracle=${oracleDocuments.length}`)
    console.log("   The positional join below cannot be trusted for this file — the two sides")
    console.log("   disagree about how many documents the stream has, which is itself the finding.")
  }
  console.log(`\nORACLE PATHS (${oraclePaths.length} across ${oracleDocuments.length} document(s)):`)
  for (const p of oraclePaths.slice(0, 40)) console.log("  ", JSON.stringify(p))

  const oracleAbs = new Set(oraclePaths)   // already absolute: see the positional join above
  const analyzerIds = new Set(syms.filter((s) => !s.isAnchor && !s.isDuplicateKey).map((s) => s.id))
  // A document ROOT has no oracle path — the oracle's path set holds key paths, and
  // the root of a document is not a key. The differential buckets exactly these as
  // `documentModule` (1,099 of them in the 8-corpus deep draw), so listing them beside
  // genuine disagreements would make every multi-document file look like a finding.
  const isDocumentRoot = (id: string) => id === stem || new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}#\\d+$`).test(id)
  const documentRoots = [...analyzerIds].filter(isDocumentRoot)
  const onlyA = [...analyzerIds].filter((i) => !oracleAbs.has(i) && !isDocumentRoot(i))
  const onlyO = [...oracleAbs].filter((i) => !analyzerIds.has(i))
  console.log(`\nDOCUMENT ROOTS (${documentRoots.length}) — expected analyzer-only, the oracle emits no path for a document root:`)
  for (const i of documentRoots.slice(0, 10)) console.log("  ", JSON.stringify(i))
  console.log(`\nANALYZER-ONLY (${onlyA.length}):`, JSON.stringify(onlyA.slice(0, 20)))
  console.log(`ORACLE-ONLY  (${onlyO.length}):`, JSON.stringify(onlyO.slice(0, 20)))
}
main()
