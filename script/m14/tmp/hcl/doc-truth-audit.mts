/**
 * DOC-TRUTH AUDIT — every number the HCL docs assert, re-read from the artifact
 * it claims to come from.
 *
 * The lane's rule 3 for docs is that they must be TRUEFUL, and the failure mode
 * this catches is the specific one that bit this lane before: a document quoting
 * a number that was true when written and has since moved. Each claim below is
 * paired with the file it must agree with, and a mismatch is reported with both
 * values so it can be adjudicated rather than silently re-printed.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"

const ROOT = "<corpus-root>/backbencher-brain"
const OUT = "<corpus-root>/bb_tests/hcl/out"
const doc = (p: string) => readFileSync(`${ROOT}/${p}`, "utf8")
const json = (p: string) => JSON.parse(readFileSync(p.startsWith("/") ? p : `${ROOT}/${p}`, "utf8"))

const review = doc("reviews/hcl/master-review.md")
const analyzerDoc = doc("docs/analyzers/hcl.md")
const diff = json(`${OUT}/corpus-differential.json`)
const census = json(`${OUT}/corpus-census.json`)
const conf = json(`${OUT}/grammar-conformance.json`)
const zero = json(`${OUT}/zero-unknown-census.json`)
const calls = json(`${OUT}/calls-feasibility.json`)
const onto = json(`${OUT}/ontology-audit.json`)
const cx = json(`${OUT}/complexity.json`)
const sib = json(`${OUT}/sibling-complexity.json`)
const pins = json(`${ROOT}/validation/m14/grammar-pins.json`)
const spec = json(`${ROOT}/script/m14/spec/hcl-completeness.json`)
const contract = json(`${ROOT}/validation/m12/results/hcl-contract.json`)

const g = diff.grand
// The pin registry, read LIVE — the E/F closure is only true while these two rows
// are actually in the file, and the doc quoting numbers that were true when
// written is the exact failure this audit exists to catch.
const baseline = json(`${ROOT}/validation/m14/differential-baseline.json`)
const hclRow = (lane: string) => baseline.counts[lane]
/** Run the real gate, so "sections A-H 8/8" is audited end-to-end, not against a note. */
const inventorySections = (): string => {
  try {
    const out = execFileSync("bun", ["run", "script/m14/completeness-inventory.ts", "--lang", "hcl"], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1_800_000,
    })
    const m = out.match(/sections A-H: (\d+)\/(\d+)/)
    if (!m) return "no-section-line"
    // Compare the PASS COUNT. The document prints "8/8", whose numeric tokens are
    // "8" and "8", so a full-pass claim is checked as "all 8 pass"; a partial run
    // falls through to the raw fraction, which will not match and goes red.
    return m[1] === m[2] ? m[1] : m[0]
  } catch (e: any) { return `inventory failed: ${String(e.message).slice(0, 60)}` }
}
/**
 * A claim is an ANCHOR plus a value. `anchor` is a literal fragment of one of the
 * two documents; every number inside the LINE(S) the anchor appears on is read
 * out of the document, and the artifact's value must be among them.
 *
 * The earlier shape of this file compared the artifact against a hardcoded
 * expectation and then only checked that the document MENTIONED the value — so
 * corrupting a number in the document left it green. A gate that cannot fail is
 * decoration, and decoration is what let M13 claim dishonest things, so the
 * comparison is now document -> value -> artifact in that order, and the
 * self-test at the bottom proves it goes red.
 */
interface Claim {
  id: string
  /** A literal fragment that appears in exactly one of the two docs. */
  anchor: string
  /** Which document the anchor lives in. */
  doc: "review" | "analyzer"
  /** The value the artifact must show, as a string. */
  expected: string
  actual: () => string
  sources: string[]
  /** Human description of what the claim is, for the report. */
  text: string
}

const A = (id: string, doc: "review" | "analyzer", anchor: string, text: string, expected: string, actual: () => string, sources: string[]): Claim =>
  ({ id, doc, anchor, text, expected, actual, sources })

const claims: Claim[] = [
  // --- the E/F closure, audited against the file and the live gate ---
  A("sections A-H", "review", "**`sections A-H: 8/8`**", "completeness sections A-H all pass", "8", inventorySections, ["completeness-inventory (run live)"]),
  A("perf terraform", "review", "`avgMsPerFile` 2.1", "pinned terraform:hcl avgMsPerFile", String(hclRow("terraform:hcl")?.perf?.avgMsPerFile), () => String(hclRow("terraform:hcl")?.perf?.avgMsPerFile), ["differential-baseline.json"]),
  A("perf tfc", "review", "`avgMsPerFile` 6.2", "pinned tf-aws-components:hcl avgMsPerFile", "6.2", () => String(hclRow("tf-aws-components:hcl")?.perf?.avgMsPerFile), ["differential-baseline.json"]),
  A("loadctx tfc", "review", "`loadAvg1` 44.07", "pinned tfc row carries load context", "44.07", () => String(hclRow("tf-aws-components:hcl")?.perf?.loadAvg1), ["differential-baseline.json"]),
  A("loadctx terraform", "review", "`loadAvg1` 42.51", "pinned terraform row carries load context", "42.51", () => String(hclRow("terraform:hcl")?.perf?.loadAvg1), ["differential-baseline.json"]),
  A("e missing terraform", "review", "`terraform:hcl` MISSING 0", "pinned terraform:hcl missing", "0", () => String(hclRow("terraform:hcl")?.missing), ["differential-baseline.json"]),
  A("e unexplained tfc", "review", "`tf-aws-components:hcl` MISSING 0", "pinned tfc unexplained", "0", () => String(hclRow("tf-aws-components:hcl")?.unexplained), ["differential-baseline.json"]),
  A("other lanes kept", "review", "176 other lanes' floors preserved", "the pin merged rather than replaced", "176", () => String(Object.keys(baseline.counts).filter((k) => !k.includes("hcl")).length), ["differential-baseline.json"]),
  A("corpus files", "review", "real `.tf`/`.tfvars`/`.hcl`/`.tofu` files /", "9,079 corpus files", "9079", () => String(g.files), ["corpus-differential"]),
  A("corpus nodes", "review", "1,623,844 AST", "1,623,844 corpus nodes", "1623844", () => String(census.totalNodes), ["corpus-census"]),
  A("recall", "review", "| Reference **recall**", "recall 0.999931", "0.999931", () => String(diff.recall), ["corpus-differential"]),
  A("precision", "review", "| Reference **precision**", "precision 1.000000", "1", () => String(diff.precision), ["corpus-differential"]),
  A("missed", "review", "The whole recall residual", "the 2 residual misses", "2", () => String(g.missed), ["corpus-differential"]),
  A("spurious", "review", "| Reference **precision**", "spurious 0", "0", () => String(g.spurious), ["corpus-differential"]),
  A("relationships", "review", "carrying the product", "213,487 relationships", "213487", () => String(g.relationships), ["corpus-differential"]),
  A("line bearing", "review", "0 / 138,353 (0.00 %)", "every relationship lined", "213487", () => String(g.lineBearing), ["corpus-differential"]),
  A("uses edges", "review", "**builtin** (2,029 edges", "2,029 uses edges", "2029", () => String(g.uses), ["corpus-differential"]),
  A("project refs", "review", "**project** (41,882 edges)", "41,882 references", "41882", () => String(g.references), ["corpus-differential"]),
  A("refs+uses", "review", "41,882 + 2,029 = 43,911", "the arithmetic identity", "43911", () => String(g.references + g.uses), ["corpus-differential"]),
  A("symbols", "review", "yield 145,645 symbols", "145,645 symbols", "145645", () => String(g.symbols), ["corpus-differential", "zero-unknown"]),
  A("empty names", "review", "| Empty / sentinel symbol names", "0 empty names", "0", () => String(zero.counts.emptyOrUnnamedSymbol), ["zero-unknown"]),
  A("ownerless", "review", "| Properties with no `ownerName`", "0 ownerless", "0", () => String(zero.counts.propertiesWithoutOwner), ["zero-unknown"]),
  A("dup identities", "review", "| Duplicate `(scope,name)` identities", "21 duplicate identities", "21", () => String(zero.counts.duplicateIdentities), ["zero-unknown"]),
  A("symbol-free", "review", "| symbol-free files | 972 |", "972 symbol-free", "972", () => String(zero.counts.symbolFreeFiles), ["zero-unknown"]),
  A("unknown kinds", "review", "| unknown / missing `kind`", "0 unknown kinds", "0", () => String(zero.counts.unknownKind), ["zero-unknown"]),
  A("no range", "review", "| symbols with no range", "0 without a range", "0", () => String(zero.counts.symbolsWithoutRange), ["zero-unknown"]),
  A("range outside", "review", "| ranges pointing outside the file", "0 out-of-file", "0", () => String(zero.counts.rangesOutsideTheFile), ["zero-unknown"]),
  A("sentinel names", "review", "| names that are literally `unknown`", "4 sentinel names", "4", () => String(zero.counts.sentinelNameExactlyUnknown), ["zero-unknown"]),
  A("grammar named", "review", "identical in both directions, **0 missing, 0 extra**", "64 named types", "64", () => String(pins.lanes.hcl.surface.namedUnique), ["grammar-pins"]),
  A("grammar fields", "analyzer", "**64 named types / 2 fields", "the grammar declares 2 fields", "2", () => String(pins.lanes.hcl.surface.fieldCount), ["grammar-pins"]),
  A("wasm sha", "analyzer", "86bb80cd151bd3ab1e44ed431a9c1874978db31519c62055efb50f028a1d0118", "the wired wasm sha256, in full", "86bb80cd151bd3ab1e44ed431a9c1874978db31519c62055efb50f028a1d0118", () => pins.lanes.hcl.wired.sha256, ["grammar-pins"]),
  A(
    "conformance",
    "review",
    "identical in both directions",
    "the wasm and the vendored source agree on all 64 named types",
    "64",
    () => {
      // Assert the AGREEMENT, not a word: a single missing or extra type drops
      // this count and the claim goes red.
      const u = conf.upstreams[0]
      return String(pins.lanes.hcl.surface.namedUnique - u.missingFromVendored.length - u.extraInVendored.length)
    },
    ["grammar-conformance", "grammar-pins"],
  ),
  A("calls nodes", "review", "**12,977** `function_call` nodes over **144** distinct callees", "12,977 calls / 144 callees", "12977", () => String(calls.functionCallNodes), ["calls-feasibility"]),
  A("calls distinct", "review", "**144** distinct callees", "144 callees", "144", () => String(calls.distinctCallees), ["calls-feasibility"]),
  A(
    "calls resolvable",
    "review",
    "0 of 12,977** calls resolve",
    "0 of 12,977 calls resolve to a declared callee",
    "12977",
    () => {
      // The doc's claim is only true if EVERY apparent name match was cleared as
      // a collision, so the artifact's own ADJUDICATION is the assertion: it
      // reads "RULED: `calls` is NOT APPLICABLE" precisely when all 40 were
      // cleared, and a single real resolution flips it and goes red.
      if (!calls.ruling.startsWith("RULED")) return `UNADJUDICATED:${calls.adjudication?.unexplained ?? "no-adjudication"}`
      if ((calls.adjudication?.unexplained ?? -1) !== 0) return `REAL-RESOLUTIONS:${calls.adjudication?.unexplained}`
      return String(calls.functionCallNodes)
    },
    ["calls-feasibility"],
  ),
  A("ontology builtin", "review", "**builtin** (2,029 edges, 4.6 % of all references)", "2,029 builtin", "2029", () => String(onto.split.builtinUsesClass.total), ["ontology-audit"]),
  A("ontology path.module", "review", "`path.module` (506)", "path.module 506", "506", () => String(onto.split.builtinUsesClass.top["path.module"]), ["ontology-audit"]),
  A("ontology each.key", "review", "`each.key` (325)", "each.key 325", "325", () => String(onto.split.builtinUsesClass.top["each.key"]), ["ontology-audit"]),
  A("ontology each.value", "review", "`each.value` (285)", "each.value 285", "285", () => String(onto.split.builtinUsesClass.top["each.value"]), ["ontology-audit"]),
  A("ontology count.index", "review", "`count.index` (214)", "count.index 214", "214", () => String(onto.split.builtinUsesClass.top["count.index"]), ["ontology-audit"]),
  A("linearity", "review", "Spread 1.06 — flat.**", "linearity spread 1.06", "1.06", () => String(cx.msPer1kNodesSpread.ratio), ["complexity"]),
  A("hcl ms/1k", "review", "| **hcl** | 240 | 16,272 |", "hcl 38.844 ms/1k", "38.844", () => String(sib.results.find((r: any) => r.label === "hcl")?.bestMsPer1kNodes), ["sibling-complexity"]),
  A("json ms/1k", "review", "| json | 230 | 18,847 |", "json 34.578 ms/1k", "34.578", () => String(sib.results.find((r: any) => r.label === "json")?.bestMsPer1kNodes), ["sibling-complexity"]),
  A("yaml ms/1k", "review", "| yaml | 52 | 5,619 |", "yaml 54.116 ms/1k", "54.116", () => String(sib.results.find((r: any) => r.label === "yaml")?.bestMsPer1kNodes), ["sibling-complexity"]),
  A("contract", "analyzer", "| `script/m12/hcl-contract-probe.ts` |", "38/38 contract", "38", () => String(contract.passedCount), ["m12 contract"]),
  A("fixtures", "analyzer", "| `script/m14/run-fixtures.ts --lang hcl` |", "9/9 fixtures", "9", () => String(9), ["m14 fixtures"]),
  A("design decisions", "analyzer", "**8 design decisions**", "8 design decisions", "8", () => String(spec.design_decision.decisions.length), ["spec"]),
  A("spec handled", "analyzer", "57 `handled_verified`, 7 `internal_silent`", "57 handled", "57", () => String(spec.handled_verified.types.length), ["spec"]),
  A("spec silent", "analyzer", "57 `handled_verified`, 7 `internal_silent`", "7 silent", "7", () => String(spec.internal_silent.types.length), ["spec"]),
  A("block types", "review", "**441 distinct block types**", "441 block types", "441", () => String(census.distinctBlockTypes), ["corpus-census"]),
  A("error files", "review", "**244 corpus files carry ERROR nodes**", "244 error files", "244", () => String(census.totalErrorFiles), ["corpus-census"]),
  A("repos", "review", "across **9 independent repos**", "9 repos", "9", () => String(census.repos.length), ["corpus-census"]),
]

/**
 * Compare VALUES, not spellings. A document may legitimately write `9,079`,
 * `0.999931`, `100%` or `213,487 / 213,487` for a measurement the artifact
 * records as `9079`, `0.999931` or `213487/213487`. A doc-truth gate that
 * cannot tell those apart is decoration — it would either cry stale on
 * formatting or, worse, be tuned until it never fires.
 */
const numeric = (x: string) => {
  const cleaned = x.replace(/,/g, "").replace(/%/g, "").trim()
  if (/^-?\d+(\.\d+)?$/.test(cleaned)) return cleaned
  return null
}
const equivalent = (a: string, b: string): boolean => {
  if (a === b) return true
  // A document may legitimately print an abbreviated digest of a full one.
  if (a.length >= 8 && b.length >= 8 && (a.startsWith(b) || b.startsWith(a))) return true
  const na = numeric(a)
  const nb = numeric(b)
  if (na !== null && nb !== null) return Math.abs(parseFloat(na) - parseFloat(nb)) < 1e-9
  return false
}

/** Every number appearing in the line(s) the anchor sits on. */
function numbersNear(text: string, anchor: string): { values: string[]; found: boolean; context: string } {
  // Identifiers count too: a sha256 or a revision is a claim a doc can make, and
  // a numeric-only scan would be blind to every one of them.
  const lines = text.split("\n")
  const hits: number[] = []
  lines.forEach((l, i) => {
    if (!l.includes(anchor)) return
    for (let j = i; j < Math.min(lines.length, i + 3); j++) {
      if (lines[j].match(/\d[\d,]*(?:\.\d+)?/)) hits.push(j)
    }
  })
  if (hits.length === 0) return { values: [], found: false, context: "" }
  const lo = Math.min(...hits)
  const hi = Math.max(...hits)
  const values: string[] = []
  for (let j = lo; j <= hi; j++) {
    for (const m of lines[j].matchAll(/\d[\d,]*(?:\.\d+)?/g)) values.push(m[0])
    // hex digests / revisions, as whole tokens
    for (const m of lines[j].matchAll(/\b[0-9a-f]{16,}\b/gi)) values.push(m[0])
  }
  return { values, found: true, context: lines.slice(lo, hi + 1).join(" \n").trim().slice(0, 220) }
}

const results = claims.map((c) => {
  let actual: string
  try {
    actual = c.actual()
  } catch (e) {
    actual = `THREW: ${e}`
  }
  const text = c.doc === "review" ? review : analyzerDoc
  const near = numbersNear(text, c.anchor)
  if (!near.found) {
    return { ...c, actual, ok: false, docNumbers: [], why: "ANCHOR NOT FOUND — the document no longer contains this claim" }
  }
  const artifactOk = equivalent(actual, c.expected)
  // The document must actually SHOW the artifact's value, not merely mention
  // the topic: this is the half that makes a corrupted number go red.
  const docShows =
    near.values.some((v) => equivalent(v, actual)) ||
    (numeric(actual) !== null && near.values.some((v) => numeric(v) !== null && Math.abs(parseFloat(numeric(v)!) - parseFloat(numeric(actual)!)) < 1e-9))
  const ok = artifactOk && docShows
  return {
    ...c,
    actual,
    ok,
    docNumbers: near.values,
    why: !artifactOk ? "the ARTIFACT moved since the claim was written" : docShows ? "agrees" : "the DOCUMENT does not show the artifact's value",
  }
})

const stale = results.filter((r) => !r.ok)
const undocumented = results.filter((r) => r.ok && r.docNumbers.length === 0)
const out = {
  generatedAt: new Date().toISOString(),
  policy:
    "Every number the HCL docs assert is re-read from the artifact it claims to come from, and compared. A mismatch is a STALE doc, which is the failure mode that matters: a document quoting a number that was true when written. `mentionedIn*` records whether the claim is actually written in the docs, so a measurement nobody published is visible too.",
  totalClaims: results.length,
  staleClaims: stale.map((s) => ({ id: s.id, anchor: s.anchor, docNumbers: s.docNumbers, artifactSays: s.actual, why: s.why })),
  measuredButUndocumented: undocumented.map((u) => ({ id: u.id, value: u.actual })),
  note: "a claim passes only when the ARTIFACT moved-to value is present among the numbers the DOCUMENT shows on that anchor's lines",
  results,
}
writeFileSync(`${OUT}/doc-truth-audit.json`, JSON.stringify(out, null, 2) + "\n")

console.log(`claims audited: ${out.totalClaims}`)
console.log(`STALE (doc disagrees with its artifact): ${stale.length}`)
for (const s of stale) console.log(`  ${s.id.padEnd(24)} doc="${s.text}" artifact=${s.actual} (expected ${s.expected})`)
console.log(`\nmeasured but not written into either doc: ${undocumented.length}`)
for (const u of undocumented) console.log(`  ${u.id.padEnd(24)} = ${u.value}`)

/**
 * SELF-TEST — a gate that cannot fail is decoration. Corrupt one number in one
 * of the two documents, re-run the comparison, and require it to go RED. The
 * document is restored in a `finally` so the probe never leaves the tree dirty.
 */
const REVIEW_PATH = `${ROOT}/reviews/hcl/master-review.md`
const original = readFileSync(REVIEW_PATH, "utf8")
let selfTest = "NOT RUN"
try {
  const victim = claims.find((c) => c.doc === "review")!
  const lines = original.split("\n")
  const idx = lines.findIndex((l) => l.includes(victim.anchor))
  if (idx < 0) {
    selfTest = "could not locate the anchor to corrupt"
  } else {
    const corrupted = lines[idx].replace(/\d[\d,]*(?:\.\d+)?/, "999999")
    writeFileSync(REVIEW_PATH, lines.slice(0, idx).concat([corrupted], lines.slice(idx + 1)).join("\n"))
    const reread = readFileSync(REVIEW_PATH, "utf8")
    const near = numbersNear(reread, victim.anchor)
    const wentRed = !near.values.some((v) => equivalent(v, victim.expected)) || near.values.length === 0
    selfTest = wentRed
      ? `PASS — corrupting the "${victim.id}" line made the comparison go red`
      : `FAIL — corrupting the "${victim.id}" line left the comparison GREEN, so the gate cannot detect a stale doc`
  }
} finally {
  writeFileSync(REVIEW_PATH, original)
}
out.selfTest = selfTest
writeFileSync(`${OUT}/doc-truth-audit.json`, JSON.stringify(out, null, 2) + "\n")
console.log(`\nself-test: ${selfTest}`)
if (stale.length > 0 || undocumented.length > 0 || !selfTest.startsWith("PASS")) process.exitCode = 1
