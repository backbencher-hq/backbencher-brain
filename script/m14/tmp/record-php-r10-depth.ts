// script/m14/tmp/record-php-r10-depth.ts — append the R10 round's php draws to
// validation/m60/results/depth-probes.json (the artifact the lane-completion
// matrix reads for the `depth` cell), and record what the round closed.
//
// Both draws keep the hash of their PRE-fix counterpart, so they are strict
// same-files before/afters rather than fresh samplings: the drawn set is pinned
// per repo and the harness re-uses it.
import * as fs from "fs"

const P = "validation/m60/results/depth-probes.json"
const d = JSON.parse(fs.readFileSync(P, "utf8"))

const PHPUNIT = {
  repo: "phpunit",
  lang: "php",
  files: 2907,
  truth: 29046,
  covered: 29046,
  missing: 0,
  unexplained: 0,
  note:
    "R10 round, FULL EXTENT (2,907/2,907 .php files). hash 7feec2ffa6626bca — identical to the previous round's draw, so same files. truth 29,064 -> 29,046 and analyzer 33,821 -> 33,803: BOTH sides moved by exactly -18, reconciling with a measurement of the two narrowed classes rather than an assertion — 17 per-file distinct call targets dropped by the dynamic-callee rule (script/m14/tmp/php-dynamic-callee-pairs.ts: 77 syntactic sites, 72 (owner,target) pairs, 17 distinct (label,target) per file, which is the key the harness dedupes on) plus 1 dynamic include path (script/m14/tmp/php-include-dropped-classes.ts: 112 include expressions across both corpora, 99 kept, 3 dropped, each classified by operand shape). 0 MISSING, 0 unexplained, 100% coverage.",
}
const PHPMYADMIN = {
  repo: "phpmyadmin",
  lang: "php",
  files: 1232,
  truth: 42377,
  covered: 42377,
  missing: 0,
  unexplained: 0,
  note:
    "R10 round, FULL EXTENT (1,232/1,232 .php files, whole second pinned corpus). hash ef6aa3cce6f906d4 — identical to the pre-fix draw. truth 42,558 -> 42,377 and analyzer moving with it: the -181 reconciles exactly as 179 per-file distinct dropped call targets (240 syntactic dynamic-callee sites, 177 distinct (owner,target) pairs, of which 125 are `variable_name` and 112 `parenthesized_expression` — `(self::$getAllHeaders)()` and friends) plus 2 dropped dynamic include paths (`$this->baseDir.'/revision-info.php'` at src/Git.php:551 and `ROOT_PATH.UrlParams::$goto` at src/Controllers/Import/ImportController.php:724). 0 MISSING, 0 unexplained, 100% coverage.",
}

d.draws.push(PHPUNIT, PHPMYADMIN)
d.current = (d.current ?? []).filter((x: any) => !(x.lang === "php" && x.repo !== "phpunit" && x.repo !== "phpmyadmin"))
d.current.push(PHPUNIT, PHPMYADMIN)
d.worstPerLang = d.worstPerLang ?? {}
d.worstPerLang.php = {
  maxSample: 2907,
  missing: 0,
  unexplained: 0,
  drawsRed: 2,
  issue: "#835 (php lane)",
  note:
    "Two full-extent draws, both 100% coverage with 0 fabrication after the R10 round's two fixes, both keeping the pre-fix hash (same files). The round's red draws were phpunit MISSING=2/unexplained=13 in the previous round and, for R10, phpmyadmin MISSING=4 then 0/0 — the R10 defects were found by the target-spelling census (script/m60/target-spelling-census.ts), which is the instrument that can see a spelling BOTH sides fabricate.",
}
d.closedInThisRound = d.closedInThisRound ?? {}
d.closedInThisRound["#835 (php lane) — R10: the target-spelling contract (include paths and callable names)"] =
  "R10's first pass found two live php defects that no per-edge gate could see, because the differential oracle derived the same truth from the same rules and therefore AGREED with the analyzer. (1) `extractIncludePath` returned the RAW TEXT of any `binary_expression`, so `include $this->baseDir . 'revision-info.php'` (phpmyadmin src/Git.php:551) published a reconstructed EXPRESSION as the import module and as a `references` target — a spelling carrying `$`, `->`, `.` and a quote that no php symbol can be named. A path is now emitted only when EVERY operand is statically known (string, `__DIR__`/`__FILE__`/name constant, interpolated strings refused, only `.` composing), and the rule lives at module level (`phpStaticIncludePath`) so the oracle imports the analyzer's own function instead of mirroring it. (2) `processFunctionCall` took the callee node's raw text, so `$callable()` published `calls -> $callable` / `calls -> $controller` (LicenseControllerTest.php:23) — a VALUE callee published as a callee NAME. `phpStaticCallableName` now requires a name-shaped callee (probe: over 400 real files, 1,047 `name` callees and `variable_name` the ONLY non-name shape reaching the rule), and the value's read survives as the variable pass's `uses` edge. Pinned by php/include-paths (6 static paths expected, 4 pre-fix spellings forbidden — the forbids transcribed from a replay of the OLD rule, script/m14/tmp/php-include-prefix-rule.ts) and php/dynamic-callee (the honest `uses -> handler` expected AND `calls -> handler` forbidden, so the fix must move the edge, not lose it); both defects have reverting mutants, all 40 php mutants caught. phpunit FULL EXTENT 2,907/2,907 and phpmyadmin FULL EXTENT 1,232/1,232 both 100% covered, 0 MISSING, 0 unexplained, both on the pre-fix hash."

fs.writeFileSync(P, JSON.stringify(d, null, 1) + "\n")
console.log("draws:", d.draws.length, "current:", d.current.length)
console.log("php worst:", JSON.stringify(d.worstPerLang.php).slice(0, 140))
