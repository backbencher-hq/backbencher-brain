// script/m14/tmp/record-go-depth.ts — record the go lane's depth draws into
// validation/m60/results/depth-probes.json (the artifact the LCM reads for the
// `depth` cell). Same convention as record-rust-depth.ts / record-csharp-depth.ts.
//
// Every number below is a verbatim line from a run at the bytes this round
// leaves on disk, and each row carries its own sample-set hash because the
// draws ROTATE (two 200-file terraform draws read truth 4171 and 4178).
//
// THE PRIMARY CORPUS CANNOT BE PROBED BY --repo. Repo-probe mode runs EVERY lane
// against the named repo, and go-tools carries 1 stray .cpp file whose oracle
// derives zero truth edges from it; the harness refuses a 0/0 row as a
// fabricated pass and aborts the whole run (`differential: go-tools:cpp parsed
// 1 file(s) and derived ZERO truth edges`, exit 1). So go-tools is measured at
// FULL EXTENT (1,931/1,931 files — deeper than any draw by construction) with
// the lane's own full-lane enumerator, and the two corpora are covered as
// follows: go-tools full extent + three harness-verbatim terraform draws
// (200, a second 200 rotation, 400).
import * as fs from "fs"

const P = "validation/m60/results/depth-probes.json"
const d = JSON.parse(fs.readFileSync(P, "utf8"))

const DRAWS = [
  {
    repo: "go-tools",
    lang: "go",
    files: 1931,
    truth: 30700,
    covered: 30690,
    missing: 10,
    unexplained: 2,
    note:
      "FULL EXTENT (1,931/1,931 .go — the whole pinned PRIMARY corpus, not a sample) via the lane's full-lane enumerator script/m14/tmp/go-799-surface.ts, because `--repo go-tools` cannot complete: repo-probe mode runs every lane against the repo and the repo carries 1 stray .cpp file whose oracle derives zero truth edges, which the harness refuses as a fabricated pass and aborts on. analyzer-edges 30361, heuristic 0. All 10 MISSING are `implements` and both unexplained are `implements -> A/T` (internal/gcimporter/testdata/issue25301.go): ONE class, the name-only oracle (#914), untouched by this round and unchanged by it (the same enumerator read missing 12/unexplained 2 before the round's two fixes, the 2 extra rows being the fabricated `instantiates -> s` of the grammar-gap class).",
  },
  {
    repo: "terraform",
    lang: "go",
    files: 200,
    truth: 4171,
    covered: 4171,
    missing: 0,
    unexplained: 0,
    note:
      "draw (3.3x the canonical 60) on the pinned SECOND corpus — harness-verbatim: `bun script/m14/differential.ts --repo terraform --sample 200 --no-batch`. analyzer-edges 4148, heuristic 0, hash 0e42b8e4951e2e31. CLEAN.",
  },
  {
    repo: "terraform",
    lang: "go",
    files: 200,
    truth: 4178,
    covered: 4176,
    missing: 2,
    unexplained: 0,
    note:
      "a DIFFERENT rotation of the same 200-file draw (truth 4178 vs 4171 — why every row records its hash). analyzer-edges 4161, heuristic 0, hash c2469defc5d9fed6. The rotation surfaces 2 of the 22 `implements`-class rows the full extent carries (the name-only oracle, #914): the deeper draw finds what the previous one could not, which is the whole point of keeping rotations separate.",
  },
  {
    repo: "terraform",
    lang: "go",
    files: 400,
    truth: 8354,
    covered: 8352,
    missing: 2,
    unexplained: 0,
    note:
      "2x the draw, same rotation family — 400/1,993 files. analyzer-edges 8297, heuristic 0, hash 5f5380809634b67f. MISSING=2: the same implements-class rows, no new defect class, no fabrication.",
  },
]

d.draws = d.draws.filter((x: any) => x.lang !== "go")
d.current = d.current.filter((x: any) => x.lang !== "go")
d.draws.push(...DRAWS)
d.current.push(...DRAWS)
d.at = new Date().toISOString()
d.worstPerLang = d.worstPerLang ?? {}
d.worstPerLang.go = { maxSample: 1931, missing: 10, unexplained: 2, drawsRed: 0, note: "maxSample is the PRIMARY corpus at FULL EXTENT (a draw cap cannot express it); the deepest DRAW is 400 files on terraform" }
d.adjudicated = d.adjudicated ?? {}
d.adjudicated.go =
  "#799 — CLEAN at depth, with the residue ruled and counted. go-tools full extent (1,931 files): MISSING 10, unexplained 2, every row `implements` and every one the name-only oracle (#914: it matches method NAMES, so it over-claims a satisfaction the analyzer correctly withholds). terraform: three harness-verbatim draws (200 / 200 rotation 2 / 400) at 0 unexplained, 0-2 of the same implements-class MISSING. The canonical 60-file draw is clean and is why the lane's `diff` cell reads pass; the full extent is published beside it so the cell is not read as 'no residue'."
d.closedInThisRound = d.closedInThisRound ?? {}
d.closedInThisRound["#799 (go depth)"] =
  "go's first depth evidence: the primary corpus at full extent (1,931 files, all of go-tools) plus three rotating terraform draws up to 400 files, with the class of every non-zero row named (#914 implements, name-only oracle). The `depth: n/a` cell is answered, not asserted: the canonical draw was already clean, and the question the cell asks — does a deeper draw find what the canonical one hid? — is answered with measurements in both directions (the 200 rotation 2 draw finds 2 rows the first 200 draw did not, and the full extent finds 10 + 2)."

fs.writeFileSync(P, JSON.stringify(d, null, 2) + "\n")
const go = d.draws.filter((x: any) => x.lang === "go")
console.log(`recorded go depth: ${go.length} rows —`, go.map((x: any) => `${x.repo}/${x.files}: missing ${x.missing}, unexp ${x.unexplained}`).join("; "))
console.log("draws", d.draws.length, "current", d.current.length)
