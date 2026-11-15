/**
 * PY-D19 (round 10) — THE STAR-IMPORT AXIS, EXERCISED IN BOTH DIRECTIONS WITHOUT A CORPUS RUN.
 *
 * WHY THIS GATE EXISTS. The verdict (`script/m14/python-endpoint-resolution.ts`) is an 11,488-file
 * census that cannot be imported without running one, so before round 10 every decision inside it was
 * protected only by a number in an artefact. The number cannot tell a rule that fired correctly from
 * a rule that fired too often — and this axis has a firing-too-often failure that would look
 * IDENTICAL in the artefact: excusing a bare name because the file star-imports a module THE
 * PROJECT DECLARES would be a false external declaration, and it would only ever show up as a
 * slightly larger explanation count. Round 9's lesson (a guard with no falsifier is a claim with no
 * evidence) is why the decision now lives in `script/m14/python-star-axis.ts` and why this gate
 * pins all of its directions:
 *
 *   1  a bare name in a file whose every star module is out of view          -> EXCUSED
 *   2  the SAME bare name, with a star module the population declares       -> NOT excused
 *   2b ...by its DOTTED module path                                          -> NOT excused
 *   2c ...by a PACKAGE PREFIX (a path under it)                              -> NOT excused
 *   2d a module SCOPE (file stem) collision in an UNRELATED repo            -> EXCUSED (the fix)
 *   3  a relative star (`from . import *`) — in view by construction         -> NOT excused
 *   4  an empty star module name                                             -> NOT excused
 *   5  a DOTTED target (not a wildcard spelling)                             -> NOT excused
 *   6  a `module:item` target (an import-graph endpoint)                     -> NOT excused
 *   7  a file with no star imports at all                                    -> NOT excused
 *
 * 2 is the row the round exists for; 2b/2c are the two spellings of "the population declares this
 * module" and both must block. 2d is the row the CORPUS convicted the first version of the rule
 * with: it used file stems, and over the round-9 residual it blocked 169 of the 171 priced rows on
 * name collisions between unrelated repositories (stdlib `dataclasses` against some repo's
 * `dataclasses.py`). 5/6 keep the axis from absorbing shapes it does not own.
 *
 * The second half of the gate reads the pinned artefact and reports the axis's count per label from
 * the LAST real run — a number, not an assertion, because 0 and 171 are both legitimate states for
 * it and a gate that demanded one of them would be measuring the corpus rather than the rule. It
 * FAILS only when the artefact names no such axis at all, which is the state in which the excuse is
 * still being reported as a DEFECT (UNEXPLAINED) and the round would read as having done nothing.
 *
 * Usage: bun validation/m14/fixtures/python/star-import-axis-gate.mts
 */
import { existsSync, readFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..", "..", "..")
const { starImportBindsOutOfView } = (await import(path.join(ROOT, "script/m14/python-star-axis.ts"))) as any

// THE POPULATION'S DOTTED MODULE PATHS — the spelling an import writes, built by the verdict from
// file paths. NOT file stems: see case 2d.
const PROJECT = new Set(["requests", "mypkg.util", "vendorpkg.util", "pyspark.sql.types"])

interface Case {
  id: string
  stars: string[] | undefined
  target: string
  want: boolean
  what: string
}

const CASES: Case[] = [
  {
    id: "1-excused",
    stars: ["thirdparty.utils"],
    target: "StructField",
    want: true,
    what: "every star module is out of view (no path in the population spells `thirdparty.utils`, and no path lives under it) and the target is a bare name: the excuse is the axis's whole content",
  },
  {
    id: "2-declared-module",
    stars: ["mypkg.util"],
    target: "Helper",
    want: false,
    what: "the star module IS a module this population declares — checkable, so the residual row proves it does NOT bind the name, and excusing it would be a false external",
  },
  {
    id: "2b-dotted-in-view",
    stars: ["vendorpkg.util"],
    target: "Helper",
    want: false,
    what: "the same shape one package deeper: the dotted path exists and must block, while 1's out-of-view module differs only in that no path spells it",
  },
  {
    id: "2c-package-prefix",
    stars: ["pyspark.sql"],
    target: "StructField",
    want: false,
    what: "`pyspark/sql/` is a PACKAGE DIRECTORY — the population declares every path under `pyspark.sql.`, so the package is checkable even though no file spells the path exactly",
  },
  {
    id: "2d-scope-collision",
    stars: ["dataclasses"],
    target: "make_dataclass",
    want: true,
    what: "THE CORPUS-CONVICTED ROW. cython deliberately stars the STANDARD LIBRARY `dataclasses`; some unrelated repo in the population has a file spelled `dataclasses.py` somewhere in its tree, and the retired stem test blocked this row for that reason alone. No path in this population spells `dataclasses`, so nothing here can check the module, and the row is excused. The corpus measurement behind it: 169 of the 171 priced rows were blocked this way",
  },
  {
    id: "3-relative",
    stars: [".models"],
    target: "Whatever",
    want: false,
    what: "a relative star is this project by construction; `from . import *` cannot be out of view",
  },
  {
    id: "4-empty-module",
    stars: [""],
    target: "Whatever",
    want: false,
    what: "an unnamed module is not evidence of anything, so it cannot carry an excuse",
  },
  {
    id: "5-dotted-target",
    stars: ["pyspark.sql.types"],
    target: "types.StructField",
    want: false,
    what: "a wildcard binds BARE names; a dotted target has its own route and is not this axis's",
  },
  {
    id: "6-module-item-target",
    stars: ["pyspark.sql.types"],
    target: "types:StructField",
    want: false,
    what: "`module:item` is an import-graph endpoint, resolved by the store's import resolution rather than by a wildcard",
  },
  {
    id: "7-no-stars",
    stars: [],
    target: "StructField",
    want: false,
    what: "a file with no star import has no wildcard route at all — the control that makes 1 a statement about `from M import *`",
  },
]

const failures: string[] = []
console.log("python star-import axis gate (PY-D19) — the decision, both directions")
for (const c of CASES) {
  const got = starImportBindsOutOfView(c.stars, PROJECT, c.target)
  const ok = got === c.want
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.id.padEnd(20)} stars=${JSON.stringify(c.stars ?? null)} target=${JSON.stringify(c.target)} -> ${got} (want ${c.want})`)
  console.log(`      ${c.what}`)
  if (!ok) failures.push(c.id)
}

// ---- the artefact: the axis must EXIST in the verdict's own output -------------------------
const ARTEFACT = path.join(HERE, "resolution-verdict.current.json")
if (!existsSync(ARTEFACT)) {
  console.log("FAIL  artefact present — no resolution-verdict.current.json to read the axis from")
  failures.push("artefact-missing")
} else {
  const v = JSON.parse(readFileSync(ARTEFACT, "utf8")) as any
  const LABELS = ["calls", "uses", "references", "exports", "extends", "implements", "overrides", "instantiates", "contains", "imports"]
  const rows = LABELS
    .map((t) => [t, v.types?.[t]?.unresolvedClass?.["star-import-external"]] as const)
    .filter(([, n]) => n !== undefined)
  if (rows.length === 0) {
    console.log("FAIL  the verdict artefact names no `star-import-external` axis — the excuse is still being counted as UNEXPLAINED")
    console.log(`      the artefact's axes, per label: ${JSON.stringify(LABELS.map((t) => [t, v.types?.[t]?.unresolvedClass ?? null]))}`)
    failures.push("axis-absent")
  } else {
    console.log(`PASS  the verdict artefact carries the axis: ${rows.map(([t, n]) => `${t}:${n}`).join(" ")}`)
    const total = rows.reduce((a, [, n]) => a + Number(n ?? 0), 0)
    console.log(`      ${total} incoming target(s) explained as star-import-external in the last pinned run (a number, not a pin: 0 and a positive count are both legitimate states of the corpus)`)
  }
}

console.log(`\n${failures.length === 0 ? "PASS" : `FAIL — ${failures.join("; ")}`}`)
process.exit(failures.length === 0 ? 0 : 1)
