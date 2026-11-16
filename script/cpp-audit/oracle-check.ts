/**
 * M65 — the cpp `part_of` ORACLE, checked against the analyzer it is supposed to be independent of.
 *
 * WHAT THIS PROVES. An oracle that agrees with the analyzer by CONSTRUCTION is worth nothing (#916:
 * a second copy of a rule is a second answer, and two sides that cancel out of every count is how a
 * wrong edge survives a year of gates). So this harness measures the two sides separately and reports
 * three numbers, not one:
 *
 *   agree        rows both sides produce
 *   analyzerOnly rows the analyzer emits and the oracle does not  -> a candidate analyzer defect
 *   oracleOnly   rows the oracle derives and the analyzer does not -> a candidate analyzer LOSS
 *
 * It reads the tree with the SAME parser the differential uses (`parser.parse(content).rootNode`) and
 * walks it with the ORACLE'S OWN recursion, while the analyzer runs through the production entry
 * (`ASTEngine.parseFile`). Neither side imports the other.
 *
 * Usage: bun run script/cpp-audit/oracle-check.ts [--json]
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, extname } from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { deriveCppPartOfTruth } from "../m14/oracles/cpp-part-of"

const CPP_EXTS = new Set([".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx", ".ipp", ".inl", ".cu", ".h"])

function walk(dir: string, out: string[], cap: number): void {
  if (out.length >= cap) return
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return }
  for (const e of entries) {
    if (out.length >= cap) return
    if (e === ".git" || e === "node_modules" || e === "build" || e === "third_party") continue
    const p = join(dir, e)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out, cap)
    else if (st.isFile() && CPP_EXTS.has(extname(e))) out.push(p)
  }
}

async function main(): Promise<void> {
  const asJson = process.argv.includes("--json")
  const files: string[] = []
  for (const repo of ["fmt", "nlohmann-json"]) walk(join(process.cwd(), ".cpp-corpus", repo), files, 1_000_000)
  files.sort()

  // The same parser class the differential uses, loaded the same way.
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new ParserClass()
  parser.setLanguage(await Language.load(readFileSync(join(process.cwd(), "wasm", "tree-sitter-cpp.wasm"))))

  let agree = 0
  let analyzerOnly = 0
  let oracleOnly = 0
  let filesChecked = 0
  let parseFails = 0
  const analyzerOnlySamples: string[] = []
  const oracleOnlySamples: string[] = []
  const byLabel: Record<string, { agree: number; analyzerOnly: number; oracleOnly: number }> = {}

  /** Per-key occurrence counts. The comparison is a MULTISET comparison because the contract is
   *  "one edge per (kind, target)" — a count, not a membership. A set comparison cannot see a
   *  duplicated row, which is the defect this harness was written to catch. */
  const countBy = (keys: string[]): Map<string, number> => {
    const m = new Map<string, number>()
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1)
    return m
  }

  for (const f of files) {
    let content: string
    try {
      const buf = readFileSync(f)
      if (buf.length > 1_000_000) continue
      content = buf.toString("utf8")
    } catch { continue }

    const rel = f.replace(process.cwd() + "/", "")

    // ── side A: the analyzer, through production
    let analyzerRows: Array<{ label: string; target: string }> = []
    try {
      const res: any = await ASTEngine.parseFile(f, content)
      if (res.language !== "cpp") continue
      for (const r of res.relationships ?? []) {
        if (r.type === "part_of" || r.type === "imports") analyzerRows.push({ label: String(r.type), target: String(r.target) })
      }
    } catch { parseFails++; continue }

    // ── side B: the oracle, over its own walk of the same tree
    let tree: any = null
    try { tree = parser.parse(content) } catch { tree = null }
    const root = tree?.rootNode
    if (!root) { try { tree?.delete?.() } catch { /* nothing to free */ } ; continue }
    filesChecked++
    const oracleRows = deriveCppPartOfTruth(root)
    try { tree?.delete?.() } catch { /* best effort */ }

    const aCounts = countBy(analyzerRows.map((r) => `${r.label}\u0000${r.target}`))
    const oCounts = countBy(oracleRows.map((r) => `${r.label}\u0000${r.target}`))

    // ★ MULTISET, NOT SET. The first version of this harness compared SETS, and that made it blind
    // to the very defect it was written for: defect (1) published the SAME (label,target) row twice,
    // and a set of one element equals a set of two. Measured proof — the harness reported
    // `agree 2328, analyzerOnly 0, oracleOnly 0` identically for the PRE-fix and the POST-fix
    // analyzer, which is exactly the "agrees by construction" failure this file exists to prevent.
    // Counting per-file occurrences is what makes the duplicate visible: the analyzer says 2, the
    // oracle says 1, and the row is reported as an analyzer EXTRA.
    for (const [k, n] of aCounts) {
      const [label] = k.split("\u0000")
      byLabel[label] ??= { agree: 0, analyzerOnly: 0, oracleOnly: 0 }
      const want = oCounts.get(k) ?? 0
      const hit = Math.min(n, want)
      agree += hit; byLabel[label].agree += hit
      if (n > want) {
        const extra = n - want
        analyzerOnly += extra; byLabel[label].analyzerOnly += extra
        if (analyzerOnlySamples.length < 12) analyzerOnlySamples.push(`${rel}: ${k.replace("\u0000", " -> ")} x${n} (oracle ${want})`)
      }
    }
    for (const [k, n] of oCounts) {
      const [label] = k.split("\u0000")
      byLabel[label] ??= { agree: 0, analyzerOnly: 0, oracleOnly: 0 }
      const got = aCounts.get(k) ?? 0
      if (n > got) {
        const missing = n - got
        oracleOnly += missing; byLabel[label].oracleOnly += missing
        if (oracleOnlySamples.length < 12) oracleOnlySamples.push(`${rel}: ${k.replace("\u0000", " -> ")} x${n} (analyzer ${got})`)
      }
    }
  }

  const out = {
    filesChecked,
    parseFails,
    agree,
    analyzerOnly,
    oracleOnly,
    byLabel,
    analyzerOnlySamples,
    oracleOnlySamples,
  }
  if (asJson) console.log(JSON.stringify(out, null, 2))
  else {
    console.log(`files ${filesChecked} (parse failures ${parseFails})`)
    console.log(`agree ${agree} · analyzerOnly ${analyzerOnly} · oracleOnly ${oracleOnly}`)
    console.log("\nper label:")
    for (const [l, v] of Object.entries(byLabel)) {
      console.log(`  ${l.padEnd(10)} agree=${String(v.agree).padStart(5)} analyzerOnly=${String(v.analyzerOnly).padStart(4)} oracleOnly=${String(v.oracleOnly).padStart(4)}`)
    }
    if (analyzerOnlySamples.length) {
      console.log("\nanalyzer-only rows (analyzer emits, oracle does not):")
      for (const s of analyzerOnlySamples) console.log(`  ${s}`)
    }
    if (oracleOnlySamples.length) {
      console.log("\noracle-only rows (oracle derives, analyzer does not):")
      for (const s of oracleOnlySamples) console.log(`  ${s}`)
    }
  }
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1) })