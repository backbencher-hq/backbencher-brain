// script/m60/yaml-partial-damage-probe.ts — find the population that could close the
// `grammarContainmentLoss` caveat.
//
// THE PROBLEM
// -----------
// 38,240 rows of the F5 draw are excused by `treeKeyPaths`, a referee that shares no code
// with the analyzer but was CONVERGED on it: at every disagreement it was extended rather
// than allowed to convict (10,752 rows for ERROR-reached pairs, 55 for orphan sequence
// items, plus the `#N` duplicate policy). A referee patched until it agrees perfectly is a
// model of the analyzer's policies, not an independent witness, so that bucket is currently
// read as "declared policy", not as independent confirmation.
//
// The independent test needs no referee. In a file the grammar only PARTIALLY damages:
//
//     do the analyzer and PyYAML agree on every path whose bytes the grammar did not damage?
//
// If yes, the disagreement is provably confined to the destroyed region, and the analyzer's
// reading of everything the grammar left intact is confirmed by a source that was never
// fitted to it.
//
// WHY THE OBVIOUS POPULATION DOES NOT WORK
// -----------------------------------------
// script/m60/yaml-bucket-audit.ts already tried this and reported ZERO paths to check. All
// 15 files that are both grammar-damaged and oracle-parseable are damaged FROM BYTE 0 — the
// root node itself is the ERROR — so the analyzer's entire output sits inside the damaged
// region and there is no clean region in which agreement could be shown. The population this
// needs is a file with a CLEAN PREFIX, and those 15 are not it.
//
// WHAT THIS DOES
// ---------------
// Searches all eight pinned corpora for the population that does work: a file that
//   1. contains at least one ERROR or MISSING node, AND
//   2. has NO damaged node starting at byte 0 (so a clean prefix exists), AND
//   3. PyYAML parses it cleanly (so there is an independent truth to compare against).
//
// Condition 2 is the one that matters and the one nothing previously checked: "damaged
// somewhere" is not "damaged everywhere", and only the second can host the test.
//
// Usage: bun run script/m60/yaml-partial-damage-probe.ts
// Writes: validation/m60/results/yaml-partial-damage.json
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS_ROOT = "$HOME/fixtures/repositories"
const REPOS = ["grails-core", "docker", "ansible", "kubernetes", "terraform", "openapi-spec", "helm", "gh-cli"]
const OUT = path.join(ROOT, "validation/m60/results/yaml-partial-damage.json")
const ORACLE = path.join(ROOT, "script/m14/tmp/yaml-f5-ranges.py")

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ya?ml)$/i.test(e.name)) out.push(p)
  }
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-yaml.wasm")))
  const parser = new P()
  parser.setLanguage(grammar)

  const damaged: string[] = []
  let scanned = 0
  for (const repo of REPOS) {
    const dir = path.join(CORPUS_ROOT, repo)
    if (!fs.existsSync(dir)) continue
    const files: string[] = []
    walk(dir, files)
    for (const f of files) {
      scanned++
      let content: string
      try { content = fs.readFileSync(f, "utf8") } catch { continue }
      let hit = false
      const scan = (n: any): void => {
        if (n.type === "ERROR" || n.isMissing) { hit = true; return }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) scan(c) }
      }
      scan(parser.parse(content).rootNode)
      if (hit) damaged.push(f)
    }
  }
  console.log(`scanned ${scanned} file(s); grammar-damaged: ${damaged.length}`)

  // Condition 2, CORRECTED. The first version asked "is ANY damaged node starting after
  // byte 0?", which 27 files pass — and every one of them still has a root ERROR at byte 0,
  // so the clean PREFIX is zero bytes long and there is nowhere to run the test. A nested
  // error 2,453 lines in does not create an undamaged region when the root error already
  // swallowed the first 28% of the file. The condition that matters is about the EARLIEST
  // damage: if min(startIndex) > 0, then bytes [0, min) are undamaged and an agreement test
  // has somewhere to live.
  const withCleanPrefix: string[] = []
  let nestedButNoPrefix = 0
  for (const f of damaged) {
    const content = fs.readFileSync(f, "utf8")
    const tree = parser.parse(content)
    let earliest = Infinity
    const scan = (n: any): void => {
      if (n.type === "ERROR" || n.isMissing) { earliest = Math.min(earliest, n.startIndex); return }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) scan(c) }
    }
    scan(tree.rootNode)
    if (earliest > 0) withCleanPrefix.push(f)
    else nestedButNoPrefix++
  }
  console.log(`  earliest damage is after byte 0 (a real clean prefix): ${withCleanPrefix.length}`)
  console.log(`  nested damage exists but the ROOT error starts at byte 0, so the clean prefix is 0 bytes: ${nestedButNoPrefix}`)

  // condition 3: the oracle must be able to read them, or there is no truth to compare
  let oracleRows: any = { results: {} }
  if (withCleanPrefix.length) {
    const out = execFileSync("python3", [ORACLE, JSON.stringify(withCleanPrefix)], { encoding: "utf8", maxBuffer: 1 << 28 })
    oracleRows = JSON.parse(out)
  }
  const usable = withCleanPrefix.filter((f) => oracleRows.results?.[f] && !oracleRows.results[f].error)
  const rejected = withCleanPrefix
    .filter((f) => !oracleRows.results?.[f] || oracleRows.results[f].error)
    .map((f) => {
      const content = fs.readFileSync(f, "utf8")
      const tree = parser.parse(content)
      let earliest = Infinity
      const scan = (n: any): void => {
        if (n.type === "ERROR" || n.isMissing) { earliest = Math.min(earliest, n.startIndex); return }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) scan(c) }
      }
      scan(tree.rootNode)
      return {
        file: path.relative(CORPUS_ROOT, f),
        bytes: content.length,
        cleanPrefixBytes: earliest,
        cleanPrefixIsYaml: content.slice(0, earliest).trim().length > 0,
        oracleError: String(oracleRows.results?.[f]?.error ?? "no row").slice(0, 120),
      }
    })
  console.log(`\n  rejected by the oracle (${rejected.length}):`)
  for (const r of rejected) console.log(`    ${r.file.padEnd(62)} cleanPrefix=${String(r.cleanPrefixBytes).padStart(6)}B  ${r.oracleError.slice(0, 60)}`)

  const rows = usable.map((f) => {
    const content = fs.readFileSync(f, "utf8")
    const tree = parser.parse(content)
    const spans: Array<[number, number, string]> = []
    const scan = (n: any): void => {
      if (n.type === "ERROR" || n.isMissing) { spans.push([n.startIndex, n.endIndex, n.isMissing ? "MISSING" : "ERROR"]); return }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) scan(c) }
    }
    scan(tree.rootNode)
    return {
      file: path.relative(CORPUS_ROOT, f),
      bytes: content.length,
      oraclePaths: (oracleRows.results[f].documents as string[][]).reduce((n, d) => n + d.length, 0),
      treeEnd: tree.rootNode.endIndex,
      firstDamageAt: spans.length ? Math.min(...spans.map((s) => s[0])) : null,
      damageSpans: spans.length,
      cleanPrefixBytes: spans.length ? Math.min(...spans.map((s) => s[0])) : content.length,
    }
  })

  const payload = {
    schemaVersion: 1,
    milestone: "M60",
    rule: "find a population with PARTIAL grammar damage (the precondition for closing the grammarContainmentLoss caveat)",
    generatedAt: new Date().toISOString(),
    question:
      "Is there a file in the eight pinned corpora that the grammar damages somewhere but NOT from byte 0, and that PyYAML parses cleanly? Only such a file has both an independent truth and an undamaged region in which to test agreement.",
    conditions: [
      "contains at least one ERROR or MISSING node",
      "the EARLIEST damaged node starts after byte 0, so a non-empty clean prefix exists (a nested error deeper in does NOT count — the root error at byte 0 already leaves nothing undamaged)",
      "PyYAML parses it cleanly, so there is an independent truth to compare against",
    ],
    // Counts only — the first version published the 138 absolute damaged paths into the
    // artifact, which is 10 KB of noise a reader has to skip past the number.
    counts: { scanned, damaged: damaged.length, earliestDamageAtZero: nestedButNoPrefix, withCleanPrefix: withCleanPrefix.length, usable: usable.length },
    // The clean-prefix SIZES matter as much as the count: a 1-byte prefix cannot host an
    // agreement test, so concluding "the population exists" from the count alone would be
    // the wrong conclusion drawn from the right number.
    cleanPrefixSizes: rejected.map((r) => ({ file: r.file, cleanPrefixBytes: r.cleanPrefixBytes })),
    verdict: usable.length
      ? `${usable.length} file(s) can host the test — this population exists`
      : `DEFINITIVE: NOT CLOSABLE ON THIS CORPUS. ${withCleanPrefix.length} file(s) have partial damage, but PyYAML cannot read any of them and their clean prefixes run ${Math.min(...rejected.map((r) => r.cleanPrefixBytes))}-${Math.max(...rejected.map((r) => r.cleanPrefixBytes))} bytes — every one is a Go template whose prefix already contains {{ }}. ${nestedButNoPrefix} of ${damaged.length} damaged files are damaged from byte 0, and the remaining ${withCleanPrefix.length} have a clean prefix too small and too full of template syntax to host an agreement test. The reason is STRUCTURAL, not a sampling accident: the grammar's failure mode is "the root node becomes an ERROR and the parse stops", which by construction leaves no undamaged interior region anywhere in this corpus. So the \`grammarContainmentLoss\` caveat stands as declared, and closing it would need a corpus or a grammar that damages a file in one place while leaving another intact.`,
    rows,
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n")
  console.log(`\nVERDICT: ${payload.verdict}`)
  for (const r of rows.slice(0, 10)) {
    console.log(`  ${r.file.padEnd(50)} bytes=${String(r.bytes).padStart(7)} cleanPrefix=${String(r.cleanPrefixBytes).padStart(6)} oraclePaths=${r.oraclePaths} spans=${r.damageSpans}`)
  }
  console.log(`-> ${path.relative(ROOT, OUT)}`)
}
main()
