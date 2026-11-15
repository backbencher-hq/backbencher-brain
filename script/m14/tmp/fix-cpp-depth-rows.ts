// fix-cpp-depth-rows.ts — repair the cpp rows of depth-probes.json the way the
// file's own convention requires: historical rows are EVIDENCE, so they are kept
// verbatim (marked `supersededBy`, exactly as the go round marked its own) and the
// new measurements are APPENDED — never overwritten, and never deleted.
//
// The first cut of record-cpp-family-depth.ts filtered every existing cpp row and
// pushed the new ones, which (a) deleted a `sqlite` cpp draw that is not this
// round's at all, and (b) rewrote the numbers of two historical rows (`fmt` 73 and
// `nlohmann-json` 17) — i.e. it made old evidence agree with new code, the exact
// dishonesty this file exists to prevent. This restores the originals from HEAD
// and explains, per row, why they no longer reproduce.
import * as fs from "fs"
import { execFileSync } from "child_process"

const P = "validation/m60/results/depth-probes.json"
const head = JSON.parse(execFileSync("git", ["show", `HEAD:${P}`], { maxBuffer: 64 << 20 }).toString())
const cur = JSON.parse(fs.readFileSync(P, "utf8"))

const cppOf = (d: any, k: string) => (d[k] ?? []).filter((r: any) => r.lang === "cpp")
const others = (d: any, k: string) => (d[k] ?? []).filter((r: any) => r.lang !== "cpp")

// The three rows HEAD carried, verbatim.
const HIST = cppOf(head, "draws")
const byRepo = (repo: string, files: number) => HIST.find((r: any) => r.repo === repo && r.files === files)
const fmtOld = byRepo("fmt", 73)
const nlohmannOld = byRepo("nlohmann-json", 17)
const sqliteOld = byRepo("sqlite", 42)
if (!fmtOld || !nlohmannOld || !sqliteOld) {
  throw new Error(`expected 3 historical cpp rows (fmt73/nlohmann17/sqlite42), got ${JSON.stringify(HIST.map((r: any) => [r.repo, r.files]))}`)
}

// Mark — never rewrite — the two this round re-measures in the corrected universe.
fmtOld.supersededBy =
  "the same draw (73 files) re-measured this round: HEAD's oracle derives 5335 (this row's 5372 does not reproduce at HEAD, so the row predates the oracle revisions that removed the false template-declaration uses), and the round's fix takes it to 5328 — see the appended row"
nlohmannOld.supersededBy =
  "the same repo at FULL EXTENT under the corrected sampling universe (496 files, appended below); this 17-file row is what the OLD universe (`ext: \"cc,h\"`) could draw, and its 1016 truth does not reproduce at HEAD (1001 on the same 17 files) for the same reason"

// The rows this round measured, with their own numbers (unchanged from the
// recorder, which is where the `[repo] cpp:` lines live).
const NEW = {
  fmt: cppOf(cur, "draws").find((r: any) => r.repo === "fmt" && r.files === 73),
  nlohmann: cppOf(cur, "draws").find((r: any) => r.repo === "nlohmann-json" && r.files === 496),
}
if (!NEW.fmt || !NEW.nlohmann) throw new Error("the new fmt/nlohmann rows are missing from the file")

cur.draws = [...others(cur, "draws"), fmtOld, nlohmannOld, sqliteOld, NEW.fmt, NEW.nlohmann]
// `current` = the lane's depth picture now: the untouched sqlite row plus this
// round's two measurements. The superseded rows stay in `draws` (their numbers
// intact) so the before/after is auditable from one artifact.
cur.current = [...others(cur, "current"), sqliteOld, NEW.fmt, NEW.nlohmann]

fs.writeFileSync(P, JSON.stringify(cur, null, 2) + "\n")

console.log("draws cpp rows (order preserved, historical verbatim):")
for (const r of cppOf(cur, "draws")) {
  console.log(`  ${r.repo.padEnd(14)} ${String(r.files).padStart(4)}f truth=${String(r.truth).padStart(5)} missing=${r.missing} unexp=${r.unexplained}${r.supersededBy ? "  [superseded]" : ""}`)
}
console.log("current cpp rows:")
for (const r of cppOf(cur, "current")) console.log(`  ${r.repo.padEnd(14)} ${String(r.files).padStart(4)}f truth=${r.truth}`)
console.log(`totals: draws ${cur.draws.length} | current ${cur.current.length}`)
