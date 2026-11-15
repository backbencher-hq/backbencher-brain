// script/m14/tmp/record-php-depth.ts — append the php lane's depth draws to
// validation/m60/results/depth-probes.json (the artifact the LCM reads for the
// `depth` cell). php's cell was UNMEASURED before this round; history is kept,
// so the two full-extent draws below are the lane's first recorded draws.
import * as fs from "fs"

const P = "validation/m60/results/depth-probes.json"
const d = JSON.parse(fs.readFileSync(P, "utf8"))

const PHPUNIT_FULL = {
  repo: "phpunit",
  lang: "php",
  files: 2907,
  truth: 29064,
  covered: 29064,
  missing: 0,
  unexplained: 0,
  note:
    "FULL EXTENT (2,907/2,907 .php files — the whole pinned corpus, not a sample). First measurement of the lane's depth cell. hash 7feec2ffa6626bca — the SAME drawn set as the draw that found the round's defects (MISSING=2 / unexplained=13), so this is a strict same-files before/after: the 11 fabricated `calls -> \\builtin` edges are gone and the argument-reading header edge is in. analyzer-edges 33,832 -> 33,821 (−11 fabricated, +1 header read) on identical truth.",
}
const PHPMYADMIN_FULL = {
  repo: "phpmyadmin",
  lang: "php",
  files: 1232,
  truth: 42558,
  covered: 42558,
  missing: 0,
  unexplained: 0,
  note:
    "FULL EXTENT (1,232/1,232 .php files, whole second pinned corpus). hash ef6aa3cce6f906d4 — same set as the draw that read MISSING=4, so strict before/after. The 4 were the truth side's raw name-field text published as a target (`uses -> $param`, `uses -> $key`) where the analyzer emitted nothing: truth 42,562 -> 42,558, analyzer unchanged, both defects in one rule (script/m14/tmp/php-dynamic-member-shapes.ts).",
}

d.draws.push(PHPUNIT_FULL, PHPMYADMIN_FULL)
d.current = (d.current ?? []).filter((x: any) => !(x.lang === "php"))
d.current.push(PHPUNIT_FULL, PHPMYADMIN_FULL)
d.worstPerLang = d.worstPerLang ?? {}
d.worstPerLang.php = {
  maxSample: 2907,
  missing: 0,
  unexplained: 0,
  drawsRed: 2,
  issue: "#835 (php lane)",
  note:
    "Two full-extent draws, both 100% coverage with 0 fabrication after the round's fixes; both were RED before it (phpunit MISSING=2/unexplained=13, phpmyadmin MISSING=4) and both keep their pre-fix hash, so they are same-files before/afters rather than fresh samplings.",
}
d.closedInThisRound = d.closedInThisRound ?? {}
d.closedInThisRound["#835 (php lane) — declared-type graph, fully-qualified calls, and the callable-header read boundary"] =
  "Three defects, all found by measurement. (1) The R9 declared-type graph the lane owed was implemented (phpDeclaredTypeRefs, shared by the analyzer and the differential oracle so the class is comparable), pinned by php/declared-type-graph; its own first measurement corrected `function copy(): self`, which had published the METHOD's name as its type. (2) A fully-qualified call took its callee from RAW text, so `PHP_BUILTINS.has(\"\\\\is_file\")` was false (the set holds bare names), a builtin escaped the filter and the lane published a target no other edge can spell: phpunit FULL EXTENT, 12 such edges, 10 of them builtins. (3) The oracle gates reads on `inBody`, whose boundary is the callable SUBTREE — the parameter list and attribute list included — while the analyzer's extracted walk visited those positions with a subset of its read rules: phpunit's only non-`calls` MISSING edge was `Result::from(..., int $shellExitCode = self::SUCCESS)`. Fixing (3) and re-drawing exposed a fourth class the mirror could never show — `$o->{'lit'}` / `$o->{2}` published a STRING and INTEGER LITERAL as symbol names identically on BOTH sides, while `$postParams->$param` had the analyzer silent and the oracle emitting `uses -> $param` (phpmyadmin MISSING=4). One rule now states it on both sides: a member read names a member only when the name is a static `name` node (the `{` token discriminates, probe-verified), and a braced field's own expression reads come from the ordinary rules."

fs.writeFileSync(P, JSON.stringify(d, null, 1) + "\n")
console.log("draws:", d.draws.length, "current:", d.current.length)
console.log("php worst:", JSON.stringify(d.worstPerLang.php).slice(0, 120))
