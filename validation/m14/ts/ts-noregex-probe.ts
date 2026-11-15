/**
 * NO-REGEX PROBE for this lane's files, with a NEGATIVE CONTROL.
 *
 * ## What it checks
 *
 * Rule 1 of this lane: not one regular expression in the analyzer, the census
 * scripts, or the oracles. The check is an AST census, not a text scan, because
 * a text scan cannot tell a regex from a newline escape inside a string
 * literal — the shipped `script/m14/no-regex-gate.sh` documents 187 reported
 * where the truth was 5, and that gate trains its readers to ignore it.
 *
 * ## Three node SHAPES, because a sniffer convicts itself
 *
 * The first draft of this probe looked for the string "new RegExp" among
 * `string` nodes and convicted ITSELF three times — the detector matching the
 * detector's own literal, which is the same false-positive shape this programme
 * has paid for repeatedly. So there is no string matching here at all. Three
 * shapes:
 *
 *   1. a `regex` node                              — the literal syntax
 *   2. a `new_expression` whose constructor is RegExp — `new RegExp(...)`
 *   3. a member call to match / matchAll / test / search / replaceAll / replace
 *      / split WITH A REGEX ARGUMENT. The first version keyed on the RECEIVER
 *      and reported 21 false positives on this lane's own files — the shipped
 *      gate's documented failure reproduced inside the fix for it. The
 *      discriminator is the argument, because that is where a regex lives:
 *      `"a,b".split(/,/)` is a regex split, `"a,b".split(",")` is not.
 *
 * ## The control, and why a zero without one means nothing
 *
 * The probe is run twice: once over the lane's own files, once over a file that
 * is KNOWN to contain regexes. If the control finds nothing, the probe is blind
 * and the lane's zero is not evidence. An earlier CSS lane probe reported "0
 * violations" for 18 months' worth of reasons, one of which was that the probe
 * itself was broken.
 *
 * USAGE
 *   bun run validation/m14/ts/ts-noregex-probe.ts [--out path.json]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import * as path from "node:path"
import { getParser } from "../../../src/ast/engine"

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const OUT = argOf("--out")
const REPO_ROOT = path.resolve(path.dirname(process.argv[1]!), "..", "..", "..")

/** The lane's files. A hand-written list is a defect the moment a file is added
 *  beside it, so it is checked against the directory: if a `ts-*.ts` or a
 *  `real-typescript-analyzer.ts` exists in `script/m14` that is not listed, the
 *  probe FAILS rather than reporting a smaller N as though it were the whole. */
const DECLARED = [
  "src/ast/real-typescript-analyzer.ts",
  "script/m14/ts-ontology-census.ts",
  "script/m14/ts-construct-probe.ts",
  "script/m14/ts-construct-census-fleet.ts",
  "script/m14/ts-deriv-oracle-audit.ts",
  "script/m14/ts-deriv-mutants.ts",
  "script/m14/ts-deriv-mutant-run.ts",
  "script/m14/ts-r7-endpoint-probe.ts",
  "script/m14/ts-type-mention-label-probe.ts",
  "script/m14/derivation-findings.ts",
  "validation/m14/ts/ts-incoming-resolve.ts",
  // The probe is a lane file too. A no-regex probe that exempts itself is a
  // probe with an unmeasured hole in the exact shape this rule exists to close,
  // and the run below proved it: its own first verdict was FAIL for naming a
  // lane file it did not scan — itself.
  "validation/m14/ts/ts-noregex-probe.ts",
]
const { readdirSync } = await import("node:fs")
const onDisk = new Set<string>()
for (const e of readdirSync(path.join(REPO_ROOT, "script/m14"))) {
  if (e.startsWith("ts-") && e.endsWith(".ts")) onDisk.add(`script/m14/${e}`)
}
onDisk.add("src/ast/real-typescript-analyzer.ts")
for (const e of readdirSync(path.join(REPO_ROOT, "validation/m14/ts"))) {
  if (e.endsWith(".ts")) onDisk.add(`validation/m14/ts/${e}`)
}
const missingFromList = [...onDisk].filter((f) => !DECLARED.includes(f))

/** The control: files that DO contain regexes, so a blind probe is caught. The
 *  first entry is the harness's own `replace(/\\(.)/g, ...)` in the oracle. */
const CONTROL = [
  { label: "shared differential (known regex user)", rel: "script/m14/differential.ts" },
  { label: "typescript imports/exports oracle (known regex user)", rel: "script/m14/oracles/typescript-imports-exports.ts" },
]

const REGEX_METHODS = new Set(["match", "matchAll", "test", "search", "replaceAll", "replace", "split"])
type Finding = { file: string; line: number; shape: string; detail: string }

/** Named children of a node whose type is in `types`. Node-API only — no text. */
function namedChildrenOfType(n: any, type: string): any[] {
  const out: any[] = []
  for (let i = 0; i < (n.namedChildCount ?? 0); i++) { const c = n.namedChild(i); if (c && c.type === type) out.push(c) }
  return out
}

async function probe(rel: string): Promise<{ findings: Finding[]; lines: number }> {
  const abs = path.join(REPO_ROOT, rel)
  if (!existsSync(abs)) return { findings: [{ file: rel, line: 0, shape: "MISSING", detail: "declared file not on disk" }], lines: 0 }
  const content = readFileSync(abs, "utf8")
  const findings: Finding[] = []
  const parser = await getParser("typescript")
  const tree = parser.parse(content, abs)
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "regex") {
      findings.push({ file: rel, line: (n.startPosition?.row ?? 0) + 1, shape: "regex-literal", detail: String(n.text ?? "").slice(0, 60) })
    }
    if (n.type === "new_expression") {
      const ctor = n.childForFieldName?.("constructor")
      if (ctor && String(ctor.text ?? "") === "RegExp") {
        findings.push({ file: rel, line: (n.startPosition?.row ?? 0) + 1, shape: "new-RegExp", detail: String(n.text ?? "").slice(0, 60) })
      }
    }
    if (n.type === "call_expression") {
      const fn = n.childForFieldName?.("function")
      if (fn && fn.type === "member_expression") {
        const prop = fn.childForFieldName?.("property")
        const method = prop ? String(prop.text ?? "") : ""
        if (REGEX_METHODS.has(method)) {
          // SHAPE 3, CORRECTED. The first version keyed on the RECEIVER — a
          // non-literal receiver meant `symbol.name.split("")` and
          // `child.type.replace("_declaration", "")` were reported, 21 false
          // positives on this lane's own files, which is the shipped gate's
          // documented failure mode reproduced inside the fix for it.
          //
          // The discriminator is the ARGUMENT, because that is where a regex
          // lives: `"a,b".split(/,/)` is a regex split and `"a,b".split(",")` is
          // not, and the receiver is a string either way. `n.split("\0")` on a
          // git ls-files result is a string split. So: flag the call only when an
          // argument IS a regex node or a `new RegExp`.
          const args = namedChildrenOfType(n, "regex")
          const newRegExpArgs = namedChildrenOfType(n, "new_expression").filter((c: any) => {
            const ctor = c.childForFieldName?.("constructor")
            return ctor && String(ctor.text ?? "") === "RegExp"
          })
          if (args.length > 0 || newRegExpArgs.length > 0) {
            findings.push({
              file: rel,
              line: (n.startPosition?.row ?? 0) + 1,
              shape: `regex-argument-to:${method}`,
              detail: String(n.text ?? "").slice(0, 70),
            })
          }
        }
      }
    }
    for (let i = (n.childCount ?? 0) - 1; i >= 0; i--) { const c = n.child(i); if (c) stack.push(c) }
  }
  return { findings, lines: content.split("\n").length }
}

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`no-regex probe — typescript lane, 3 node shapes, no string matching\n`)

let laneFindings = 0
let laneLines = 0
const laneRows: { rel: string; lines: number; findings: Finding[] }[] = []
console.log(`${w("file", 58)}${w("lines", 8)}findings`)
console.log("-".repeat(90))
for (const rel of DECLARED) {
  const r = await probe(rel)
  laneLines += r.lines
  laneFindings += r.findings.length
  laneRows.push({ rel, lines: r.lines, findings: r.findings })
  console.log(`${w(rel, 58)}${w(String(r.lines), 8)}${r.findings.length === 0 ? "0" : r.findings.length}`)
  for (const f of r.findings.slice(0, 6)) console.log(`      line ${f.line}  ${f.shape}  ${f.detail}`)
}

console.log(`\nlane total: ${DECLARED.length} files, ${laneLines} lines, ${laneFindings} findings`)

let controlFindings = 0
const controlRows: { label: string; rel: string; count: number; findings: Finding[] }[] = []
console.log(`\nNEGATIVE CONTROL — the probe must find regexes in these, or it is blind:`)
for (const c of CONTROL) {
  const r = await probe(c.rel)
  controlFindings += r.findings.length
  controlRows.push({ ...c, count: r.findings.length, findings: r.findings.slice(0, 40) })
  console.log(`  ${w(c.label, 58)}${r.findings.length} findings  ${r.findings.length > 0 ? "PROBE SEES" : "PROBE IS BLIND"}`)
  for (const f of r.findings.slice(0, 3)) console.log(`      line ${f.line}  ${f.shape}  ${f.detail}`)
}

const out: any = {
  at: new Date().toISOString(),
  shapes: ["regex-literal", "new-RegExp", "regex-argument-to:<method>"],
  laneFiles: DECLARED,
  laneFilesOnDisk: [...onDisk].sort(),
  laneFilesMissingFromDeclaredList: missingFromList,
  laneLines,
  laneFindings,
  // A count a reader cannot point at is the failure docs/M14-HONESTY-CONTRACT.md's
  // closing rule was written about, so the FINDINGS are carried, not just the
  // total. The first run of this probe printed 4 and named none of them.
  laneFindingsByFile: laneRows.filter((r) => r.findings.length > 0).map((r) => ({ rel: r.rel, findings: r.findings })),
  control: controlRows,
  controlFindings,
  verdict: missingFromList.length > 0 ? "FAIL — a lane file exists that the probe does not scan"
    : controlFindings === 0 ? "FAIL — the probe found nothing in files known to contain regexes, so its zero is not evidence"
    : laneFindings > 0 ? "FAIL — regex use in a lane file"
    : "PASS — 0 findings over the listed lane files, control non-zero",
}
console.log(`\nfiles on disk but not in the probe's list: ${missingFromList.length ? missingFromList.join(", ") : "(none)"}`)
console.log(`\nVERDICT: ${out.verdict}`)
if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`wrote ${OUT}`) }
process.exit(out.verdict.startsWith("PASS") ? 0 : 1)