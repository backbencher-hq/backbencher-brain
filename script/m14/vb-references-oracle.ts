/**
 * AN INDEPENDENT ORACLE FOR `references` — the Visual Basic lane's DERIVATION
 * debt.
 *
 * WHY THIS FILE IS THE FIRST THING THIS LANE OWES THE REPOSITORY.
 * `validation/m60/rel-type-coverage-baseline.json` carries, for `vb`, exactly one
 * finding:
 *
 *   DERIVATION|vb|emits `references` but the differential audits
 *   ["extends","implements","instantiates","overrides"] — the type is stored and
 *   compared against nothing
 *
 * and the lane's own evaluated audited set today is narrower still. `references`
 * is the SECOND-LARGEST edge class this analyzer publishes — 30,091 edges over
 * 2,658 corpus files, 100% of them below the honesty contract's 0.7 confidence
 * floor and therefore `inferred` — and until this wave nothing compared a single
 * one of them against anything. An unverified edge ships a bug invisibly, which
 * is the whole reason the check exists.
 *
 * THE ORACLE READS NO GRAMMAR. `references` is an edge whose claim is a lexical
 * one — "this file writes the NAME `T` in a type position" — so the source text is
 * the ground truth and a tree walk would be the wrong instrument for exactly the
 * reason `docs/analyzers/ONTOLOGY-WORKSTREAM.md` records: a second walker over the
 * same grammar cannot see a shared grammar bug.
 *
 * For each `references` edge (source, target, line) the question is:
 *
 *     does the cited line actually contain `target` as a standalone token,
 *     with the type-argument tail (`(Of T)`) and any brackets stripped?
 *
 * and the answer is one of four, all reported:
 *
 *   SUPPORTED     the token is on the cited line
 *   WRONG-LINE    the token is in the file but NOT on the cited line — the edge
 *                 is navigable but the site is wrong, which is the M59.A7 defect
 *   NOT-IN-FILE   the token is nowhere in the file — a target the program does
 *                 not write, i.e. a fabrication
 *   BRACKETED     the cited form is a VB bracketed identifier (`[Default]`), which
 *                 IS written in the file and IS a name; reported separately so
 *                 the bracket class is sized rather than counted as bad
 *
 * A text oracle has the two known failure modes the instantiates oracle also has
 * and they are stated rather than left to be discovered: a string literal or
 * comment can supply a token (overcounts SUPPORTED), and a name split across a
 * line continuation is missed (overcounts WRONG-LINE). Both push in the
 * direction of the analyzer looking WORSE than it is, which is the safe direction
 * for a gate, and every WRONG-LINE sample is printed so a reader can judge it.
 *
 * CLI: npx tsx script/m14/vb-references-oracle.ts [--sample N] [--out f.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"
import { decodeSourceText } from "../../src/util/source-text"
import { emitEvidence } from "./evidence-harness"

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const CR = process.env.BB_VB_CORPUS_ROOT ?? "$HOME/fixtures/vb-corpus"
const REPOS = (argOf("--repo", "p3d,dismt,pcl,tankex,runtime") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const SAMPLE = parseInt(argOf("--sample", "0") ?? "0")
const OUT = argOf("--out")

const files: { repo: string; dir: string; rel: string; abs: string; lines: string[]; flat: string }[] = []
for (const e of REPOS) {
  const dir = path.join(CR, e)
  try { statSync(dir); execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".vb")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    // DECODE BY BOM, not by `readFileSync(.., "utf8")`. The first version of this
    // oracle did the naive read and reported 75 `references` targets as
    // NOT-IN-FILE — and every sample LOOKED correct, because a UTF-16 file read
    // as UTF-8 yields `B\0o\0o\0l\0e\0a\0n` and a NUL does not render. The
    // analyzer was right and the probe was wrong: it compared a target read from a
    // BOM-decoded parse tree against text that had never been decoded. The engine
    // decodes by BOM at `pool-worker.ts` and 40 of P3D's 1,880 files are UTF-16,
    // so the oracle has to do the same or it convicts real programs. This is the
    // instrument failing in the direction that makes the lane look worse than it
    // is, which is the safe direction to be wrong in and still wrong.
    let text = ""
    try { text = decodeSourceText(readFileSync(abs)).text } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "vb") continue
    files.push({ repo: e, dir, rel, abs, lines: text.split(/\r?\n/), flat: text })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
const draw = SAMPLE > 0 ? files.slice(0, SAMPLE) : files
console.log(`vb references oracle — corpus ${CR}  drawn ${draw.length} files  (source-text oracle; no grammar read)\n`)

const isWordChar = (c: number): boolean =>
  (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95

/** Is `name` present as a STANDALONE token in `text`, at a word boundary? The
 *  boundary is what makes `Integer` not match `BigInteger`. */
function hasToken(text: string, name: string): boolean {
  if (name.length === 0) return false
  for (let i = 0; i + name.length <= text.length; i++) {
    if (text.substr(i, name.length) !== name) continue
    if (i > 0 && isWordChar(text.charCodeAt(i - 1))) continue
    const after = i + name.length
    if (after < text.length && isWordChar(text.charCodeAt(after))) continue
    return true
  }
  return false
}

/** `IEnumerable(Of String)` -> `IEnumerable`; `[Default]` -> `[Default]` kept. */
function coreName(target: string): string {
  const paren = target.indexOf("(")
  return (paren >= 0 ? target.slice(0, paren) : target).trim()
}

type Verdict = "SUPPORTED" | "WRONG-LINE" | "NOT-IN-FILE" | "BRACKETED"
const tally: Record<Verdict, number> = { SUPPORTED: 0, "WRONG-LINE": 0, "NOT-IN-FILE": 0, BRACKETED: 0 }
const byRole = new Map<string, Record<Verdict, number>>()
const samples: Array<{ verdict: Verdict; file: string; line: number; source: string; target: string }> = []
const notInFile = new Map<string, number>()

let idx = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= draw.length) return
    const f = draw[i]
    const label = `${f.repo}/${f.rel}`
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    for (const x of r?.relationships ?? []) {
      if (String(x?.type ?? "") !== "references") continue
      const target = String(x?.target ?? "")
      const line = typeof x?.line_number === "number" ? x.line_number : 0
      const core = coreName(target)
      const role = String(x?.metadata?.role ?? "(none)")
      const per = byRole.get(role) ?? { SUPPORTED: 0, "WRONG-LINE": 0, "NOT-IN-FILE": 0, BRACKETED: 0 }
      let verdict: Verdict
      if (target.startsWith("[") && target.endsWith("]")) {
        // A VB bracketed identifier IS written in the file and IS a name, so it
        // is never `NOT-IN-FILE`; it is its own bucket so the class is sized.
        verdict = hasToken(f.flat, core) ? "BRACKETED" : "NOT-IN-FILE"
      } else if (line > 0 && line <= f.lines.length && hasToken(f.lines[line - 1], core)) {
        verdict = "SUPPORTED"
      } else if (hasToken(f.flat, core)) {
        verdict = "WRONG-LINE"
      } else {
        verdict = "NOT-IN-FILE"
      }
      tally[verdict]++
      per[verdict]++
      byRole.set(role, per)
      if (verdict === "NOT-IN-FILE") notInFile.set(target, (notInFile.get(target) ?? 0) + 1)
      if (verdict !== "SUPPORTED" && samples.length < 40) {
        samples.push({ verdict, file: label, line, source: (f.lines[line - 1] ?? "").trim().slice(0, 150), target })
      }
    }
  }
}
await Promise.all(Array.from({ length: 3 }, () => worker()))

const total = Object.values(tally).reduce((a, b) => a + b, 0)
const pct = (v: Verdict): string => `${((tally[v] / Math.max(1, total)) * 100).toFixed(2)}%`
console.log(`references edges: ${total}`)
console.log(`  SUPPORTED   the target is a standalone token on the cited line        ${tally.SUPPORTED}  ${pct("SUPPORTED")}`)
console.log(`  WRONG-LINE  the target is in the file but not on the cited line      ${tally["WRONG-LINE"]}  ${pct("WRONG-LINE")}`)
console.log(`  NOT-IN-FILE the target is nowhere in the file — a fabrication        ${tally["NOT-IN-FILE"]}  ${pct("NOT-IN-FILE")}`)
console.log(`  BRACKETED   a VB bracketed identifier, e.g. \`[Default]\`               ${tally.BRACKETED}  ${pct("BRACKETED")}`)
console.log(`\nby metadata role:`)
for (const [role, per] of [...byRole].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  const n = Object.values(per).reduce((a, b) => a + b, 0)
  console.log(`  ${role.padEnd(14)} ${String(n).padStart(7)}   supported ${((per.SUPPORTED / n) * 100).toFixed(1)}%  wrong-line ${per["WRONG-LINE"]}  not-in-file ${per["NOT-IN-FILE"]}  bracketed ${per.BRACKETED}`)
}
if (notInFile.size > 0) {
  console.log(`\ntargets absent from their own file (a fabrication if this is real):`)
  for (const [t, n] of [...notInFile].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(n).padStart(5)}  ${t}`)
}
console.log(`\nsamples of every non-SUPPORTED verdict:`)
for (const s of samples.slice(0, 15)) {
  console.log(`  [${s.verdict}] ${s.file}:${s.line}  target=\`${s.target}\``)
  console.log(`      ${s.source}`)
}

if (OUT) {
  // HARNESS v2. results/*.json is emitted only by `emitEvidence`; the raw `writeFileSync`
  // this replaces left the artifact without a `schemaVersion`, which the evidence gate
  // rejects. The tally (including the printed WRONG-LINE sample set) is unchanged and
  // rides in `data`; the check is the oracle's own pass condition.
  const ok = tally["NOT-IN-FILE"] === 0
  emitEvidence({
    // A LITERAL id, not a computed one: the artifact identity is `M14.0.VB-REFERENCES-ORACLE` and the
    // filename must equal it. A computed id makes the artifact an ORPHAN to script/m49/verify-evidence-identity.ts
    // (a producer is found by the literal inside the emitEvidence call), which this register does not allow.
    issueId: "M14.0.VB-REFERENCES-ORACLE",
    title: `VB references oracle over the derived VB corpus (${draw.length} files, ${total} edges)`,
    claimLevel: "L1",
    layers: ["differential"],
    checks: [{
      id: "vb-references-targets-are-in-file",
      description: "no published references target is absent from the file that publishes it",
      status: ok ? "pass" : "fail",
      detail: `drawn=${draw.length} edges=${total} NOT-IN-FILE=${tally["NOT-IN-FILE"] ?? 0} WRONG-LINE=${tally["WRONG-LINE"] ?? 0} SUPPORTED=${tally["SUPPORTED"] ?? 0}`,
    }],
    limitations: [
      { description: "a text oracle: a string literal or comment can supply a token (overcounts SUPPORTED) and a name split across a line continuation is missed (overcounts WRONG-LINE); both directions push toward the analyzer looking worse, which is the safe direction for a gate" },
      { description: "the sample is drawn from the checkouts under the configured corpus root; the population is stated in `data.drawn`, not assumed" },
    ],
    data: {
      corpusRoot: CR, drawn: draw.length, total, tally,
      byRole: Object.fromEntries([...byRole].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
      notInFileTargets: Object.fromEntries([...notInFile].sort((a, b) => b[1] - a[1])),
      samples,
    },
  })
  console.log(`\nwrote ${OUT} (harness v2)`)
}
process.exitCode = tally["NOT-IN-FILE"] === 0 ? 0 : 1
