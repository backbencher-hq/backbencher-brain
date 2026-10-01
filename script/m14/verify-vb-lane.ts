/**
 * Is the VB lane DONE? A checklist that can be run, not an opinion.
 *
 * This exists because "the analyzer is finished" is a question that keeps getting
 * answered by assertion. Every number in this lane's documentation was true when
 * it was written, and several of them stopped being true without anybody noticing
 * — the sampler silently stopped drawing fresh files for a whole session, and a
 * `100 %` on one 60-file set was reported as though it were a corpus result. The
 * only defence that worked all session was auditing a CLAIM rather than
 * re-running a test, and that should be a command.
 *
 * It checks, in the order a reviewer would ask:
 *
 *   1. zero regex in the analyzer          — a load-bearing claim, proven not asserted
 *   2. no unknown symbol kinds             — and none against the product's own enum
 *   3. no empty symbol names
 *   4. every relationship has a 1-based line
 *   5. every relationship's line is CORRECT — the target name is actually there
 *   6. no unexplained relationships        — the F5 differential, whole corpora
 *   7. every node type is classified       — the census
 *   8. every declaration yields a symbol   — the yield audit
 *   9. no repeated field read as singular  — the field-read contract
 *   10. every mutant is caught             — the suite can fail
 *  11. the F5 artifact is committed        — a scoped run must not write it
 *  12. M60 surfaces carry the lane
 *  13. the documentation matches the code
 *  14. the grammar pin is intact
 *
 * Exit 0 only when every criterion passes. It is EXPECTED TO FAIL today, and the
 * failures are the answer to "are we done".
 */
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { execFileSync } from "node:child_process"

const ANALYZER = "src/ast/real-vb-analyzer.ts"
const DOC = "docs/vb.md"
const ANALYZER_DOC = "docs/analyzers/real-vb-analyzer.md"
const REVIEW = "reviews/vb/master-review.md"
const PIN = "validation/m14/grammar-pins.json"
const PROBE = "$HOME/fixtures/probes/vb-linecheck.ts"
const CORPUS = "$HOME/fixtures/vb-corpus/p3d"

type Row = { n: number; name: string; ok: boolean; detail: string; blocking: boolean }
const rows: Row[] = []
const add = (n: number, name: string, ok: boolean, detail: string, blocking = true) =>
  rows.push({ n, name, ok, detail, blocking })

const run = (cmd: string, args: string[], env: Record<string, string> = {}): { code: number; out: string } => {
  try {
    const out = execFileSync(cmd, args, {
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    })
    return { code: 0, out }
  } catch (e: any) {
    return { code: typeof e.status === "number" ? e.status : 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }
  }
}

const src = readFileSync(ANALYZER, "utf8")
const doc = readFileSync(DOC, "utf8")

// 1 — zero regex, proven
{
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n")
  const patterns: string[] = []
  if (/new RegExp/.test(code)) patterns.push("new RegExp")
  if (/\.(match|matchAll|replace|replaceAll|split|search)\(\s*[\/'"`]/.test(code)) patterns.push("pattern-taking string method")
  if (/\.(test|exec)\(\s*[\/'"`]/.test(code)) patterns.push("RegExp.test/exec")
  add(1, "zero regex in the analyzer", patterns.length === 0,
    patterns.length ? `found: ${patterns.join(", ")}` : `no RegExp and no pattern-taking method in ${src.split("\n").length} lines`)
}

// 2/3/4/5 — the analyzer's own output, through the product entry
{
  if (!existsSync(PROBE)) {
    for (const [n, name] of [[2, "no unknown symbol kinds"], [3, "no empty symbol names"],
      [4, "every relationship has a 1-based line"], [5, "relationship lines are CORRECT"]] as const)
      add(n, name, false, `probe missing at ${PROBE}`)
  } else {
    const { out } = run("./node_modules/.bin/tsx", [PROBE, CORPUS])
    const num = (label: string): number => {
      const m = new RegExp(`^${label}\\s+(\\d+)`, "m").exec(out)
      return m ? Number(m[1]) : NaN
    }
    const syms = num("symbols"), empty = num("empty symbol names"), unknown = num("unknown symbol kinds")
    const unlined = num("without a 1-based line"), beyond = num("line beyond EOF")
    // the probe's line carries a "+/-3 lines" between the label and the number,
    // so match up to the colon rather than straight to the digits
    const wrong = Number(/target name not within[^:]*:\s*(\d+)/.exec(out)?.[1] ?? "NaN")
    const kinds = /^kinds\s+(.*)$/m.exec(out)?.[1]?.trim() ?? ""
    add(2, "no unknown symbol kinds", unknown === 0, `${unknown} of ${syms} symbols have a kind outside the product's own set`)
    add(3, "no empty symbol names", empty === 0, `${empty} of ${syms} symbols have an empty name`)
    add(4, "every relationship has a 1-based line", unlined === 0, `${unlined} without a line`)
    add(5, "relationship lines are CORRECT", wrong === 0 && beyond === 0,
      `${wrong} cite a line where the target name is absent, ${beyond} beyond EOF ` +
      `(contract literals excluded: a constructor is named \`constructor\`, the source says \`New\`)`)
    void kinds
  }
}

// 6 — the differential, whole corpora, all seven labels
{
  const logs = ["/tmp/opencode/f5-p3d-final.log", "/tmp/opencode/f5-dismt-final.log"]
  const have = logs.filter(existsSync)
  if (have.length === 0) {
    add(6, "no unexplained relationships (F5, whole corpora)", false, "no full-corpus F5 log found")
  } else {
    const rowsOut: string[] = []
    let unexplained = 0, missing = 0, files = 0, truth = 0
    for (const l of have) {
      const t = readFileSync(l, "utf8")
      const m = /files=(\d+) tree-truth=(\d+) covered=\d+ \([\d.]+%\)(?: covered)? MISSING=(\d+).*unexplained=(\d+)/.exec(t)
      if (!m) continue
      files += Number(m[1]); truth += Number(m[2]); missing += Number(m[3]); unexplained += Number(m[4])
      rowsOut.push(`${m[1]} files: ${Number(m[2])} truth, MISSING=${m[3]}, unexplained=${m[4]}`)
    }
    add(6, "no unexplained relationships (F5, whole corpora)", unexplained === 0 && rowsOut.length === 2,
      rowsOut.length === 2
        ? `${files} files, ${truth} audited truth edges, MISSING=${missing}, unexplained=${unexplained} (${rowsOut.join("; ")})`
        : `only ${rowsOut.length} of 2 whole-corpus logs parsed`)
  }
}

// 7/8/9 — the structural gates
for (const [n, name, script] of [
  [7, "every node type is classified", "vb-node-type-census.ts"],
  [8, "every declaration yields a symbol", "vb-node-type-yield.ts"],
  [9, "no repeated field read as singular", "verify-field-reads.ts"],
] as const) {
  const { code, out } = run("bun", ["run", `script/m14/${script}`])
  const last = out.trim().split("\n").filter(Boolean).slice(-1)[0] ?? ""
  add(n, name, code === 0, last.slice(0, 110))
}

// 10 — mutants
{
  const { out } = run("bun", ["run", "script/m14/mutate-analyzer.ts"], { BB_MUTANT_ONLY: "vb/" })
  const all = /all (\d+) mutants caught/.exec(out)
  const surv = /(\d+) SURVIVING/.exec(out)
  add(10, "every mutant is caught", !!all && !surv, all ? `${all[1]} mutants, 0 surviving` : "no 'all caught' line — survivors or no mutants ran")
}

// 11 — the canonical F5 artifact
{
  const f5 = "validation/m14/results/M14.0.F5.json"
  const has = existsSync(f5)
  let laneRow = "artifact absent"
  if (has) {
    const j = JSON.parse(readFileSync(f5, "utf8"))
    const rows_ = j.rows ?? j.results ?? []
    laneRow = rows_.find((r: any) => r.lang === "vb" || r.language === "vb") ? "artifact present and carries a vb row" : "artifact present but NO vb row"
  }
  add(11, "M14.0.F5 artifact carries the lane", has && laneRow.includes("carries a vb row"),
    `${laneRow} — a scoped \`--lang vb\` run deliberately refuses to write it, so this needs the 30-language sweep`)
}

// 12 — M60 surfaces
{
  const gaps: string[] = []
  const art = "validation/m60/vb/lane-surface-audit.json"
  if (!existsSync("validation/m60/vb")) gaps.push("no validation/m60/vb/ lane directory")
  let detail = "no lane artifact"
  if (existsSync(art)) {
    const j = JSON.parse(readFileSync(art, "utf8"))
    const rows = Array.isArray(j) ? j : j.rows ?? [j]
    const r = rows.find((x: any) => x.lang === "vb") ?? rows[0]
    const labels = Object.keys(r?.labels ?? {}).length
    const bad = (r?.badNames ?? []).length
    const ghosts = r?.ghostCount ?? 0
    const contract = (r?.contractNameCount ?? 0) + (r?.contractTargetCount ?? 0)
    detail = `${r?.files} files, ${r?.edges} edges over ${labels} labels, ` +
      `${bad} names-not-in-source, ${ghosts} ghost targets, ${contract} contract literals disclosed`
    if (bad > 0) gaps.push(`${bad} symbol names not written in their own file`)
    if (ghosts > 0) gaps.push(`${ghosts} relationship targets whose name is in no source file`)
    if (labels < 5) gaps.push(`only ${labels} relationship labels exercised`)
  } else {
    gaps.push("no validation/m60/vb/lane-surface-audit.json")
  }
  // the ledger and the framework-surface register are FAMILY-WIDE indexes; the
  // per-lane surface artifact is what this lane owes, and it is checked above.
  add(12, "M60 surfaces carry the lane", gaps.length === 0, gaps.length ? gaps.join("; ") : detail)
}

// 13 — docs match the code
{
  const rels = /relationships \| \*\*([\d,]+)\*\*/.exec(doc)?.[1] ?? "?"
  const facts = [
    ["docs/vb.md", existsSync(DOC) && /node-type census/.test(doc)],
    ["docs/analyzers/real-vb-analyzer.md", existsSync(ANALYZER_DOC) && /M14\.0\.F8/.test(readFileSync(ANALYZER_DOC, "utf8"))],
    ["reviews/vb/master-review.md", existsSync(REVIEW)],
  ].filter(([, ok]) => !ok).map(([n]) => `missing: ${n}`)
  add(13, "documentation present and current", facts.length === 0,
    facts.length ? facts.join("; ") : `all three present; docs/vb.md quotes ${rels} relationships`)
}

// 14 — the grammar pin
{
  const pin = existsSync(PIN) ? JSON.parse(readFileSync(PIN, "utf8")) : null
  const lane = pin?.lanes?.vb
  const dirty = run("git", ["status", "--short", "grammars/tree-sitter-vbnet", "wasm/tree-sitter-vbnet.wasm"]).out.trim()
  add(14, "grammar pin intact and unmodified", !!lane && dirty === "",
    lane ? `pinned, ${dirty === "" ? "working tree clean" : `DIRTY: ${dirty}`}` : "no pin entry for vb")
}

// ---------------------------------------------------------------------------
const blocking = rows.filter((r) => !r.ok && r.blocking)
const width = Math.max(...rows.map((r) => r.name.length))
console.log(`VB lane completion audit — ${rows.length - blocking.length}/${rows.length} criteria met\n`)
for (const r of rows) {
  console.log(`  ${String(r.n).padStart(2)}. ${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${r.detail}`)
}
console.log("")
if (blocking.length) {
  console.log(`NOT DONE. ${blocking.length} criterion/criteria open: ${blocking.map((r) => r.n).join(", ")}`)
  process.exit(2)
}
console.log("Every criterion met. The lane is done by this checklist's definition.")
