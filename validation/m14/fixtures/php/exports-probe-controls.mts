/**
 * POSITIVE CONTROLS for the `exports` probe — and the reason this file exists.
 *
 * ## The defect it caught
 *
 * The probe's R2/P4 test (`define('NAME', …)` publishes a global constant) read
 * **0 occurrences over 4,642 corpus files**, printed next to a count of 6,140 for
 * P1a with nothing marking it as broken. It was not a measurement. tree-sitter-php
 * puts an `argument` node between `arguments` and the value:
 *
 *   function_call_expression
 *     name "define"
 *     arguments
 *       argument           <- namedChild(0) returned THIS
 *         encapsed_string  <- the node the test actually wanted
 *
 * so the test compared an `argument` node against `string` / `encapsed_string` and
 * could never match. **No corpus can falsify that number**, because no corpus makes
 * it non-zero — which is exactly the failure mode a corpus sweep cannot see and a
 * synthetic positive can. The control file `define("MY_GLOBAL_CONST", 42);` read 0.
 *
 * The identical bug was in BOTH copies of the probe at the time (`exports-probe.mts`
 * and the `countOnTree` the arbiter ran from `script/m14/php-ruled.ts`) — which is why
 * there was a control asserting the two agree, and why the fix was applied to both. The
 * ruling copy is gone now (see (C) below); the corpus copy carries the fix.
 *
 * ## What this asserts
 *
 *   (A) every probe FIRES on a corpus built to contain its construct — a probe that
 *       can only read zero is not evidence of absence.
 *   (B) the SPLIT probes discriminate: an unqualified `use function array_merge;`
 *       counts as P1a and NOT as P1b, so the qualified/unqualified split that the
 *       `exports` verdict rests on is shown to be a split and not a rename.
 *   (C) — WITHDRAWN, and said so rather than quietly deleted. This file used to assert
 *       that the corpus probe and a second copy of it inside the lane's ruling table
 *       (`script/m14/php-ruled.ts`, fed to the arbiter as `countOnTree`) agreed counter
 *       for counter. That second copy existed ONLY to feed a ruling row, and when
 *       measurement falsified the `exports` ruling the row was withdrawn — so there is one
 *       probe now, not two, and the anti-drift assertion has nothing to compare. A
 *       control for a copy that no longer exists is not a control; it is a comment.
 *
 * Run: npx tsx validation/m14/fixtures/php/exports-probe-controls.mts
 * Exits non-zero on any mismatch. Runs in seconds — no corpus required.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const CORPUS = "/tmp/opencode/php/exports-controls-corpus"

/**
 * The control corpus. Every file exists to make ONE probe fire or to prove a split
 * discriminates. Nothing here is a PHP idiom; the point is that the probe must read
 * non-zero when the construct is present.
 */
const CONTROLS: Record<string, string> = {
  // (A) P3 — an export performed by a call: publishes a name no declaration writes.
  "p/alias.php": `<?php
class_alias('Original\\\\Widget', 'Widget');
`,
  // (A) P4 — the construct the corpus sweep read 0 on, and (B) P4b — its negative.
  "p/define.php": `<?php
define("MY_GLOBAL_CONST", 42);
define($dynamic, 1);
`,
  // (A) the DEFINE-AUDIT's three callee RESOLUTIONS, one file, so the audit's
  // publication SET can be asserted rather than its count alone: `\define` publishes
  // (fully qualified, no namespace lookup), `namespace\define` resolves to the CURRENT
  // namespace and does NOT fall back (the fallback is a rule for unqualified names),
  // and `Other\define` is a userland function. Written inside a namespace on purpose:
  // in the GLOBAL namespace the manual strips the `namespace\` prefix, so the relative
  // spelling would resolve to the global function there — a distinction the population
  // has never exercised (0 relative occurrences) and which is recorded, not implemented.
  // NOTE ON THE ESCAPING, because getting it wrong is how this control first
  // failed: this is a TS template literal, so a SINGLE backslash in the source is an
  // escape and the PHP file on disk gets a bare `define` (which parses fine, as a
  // different — unqualified — call, so the control read `bare=2, absolute-fq=0` and
  // the assertions below caught it). PHP needs ONE leading backslash, so the template
  // needs TWO. Every other `\\` in this file is the same rule.
  "p/define-callee-shapes.php": `<?php
namespace Ctl;
\\define("ABS_CONST", 1);
namespace\\define("REL_CONST", 2);
Other\\define("QUAL_CONST", 3);
`,
  // (A) the R3 FALSIFIER: a qualified `use function` whose leaf the SAME file declares.
  "p/reexport.php": `<?php
namespace App;
use function Vendor\\pkg\\someHelper;
function someHelper(): int { return 1; }
`,
  // (A) P1b without the redeclaration — the corpus's actual shape.
  "p/qualified-no-redeclare.php": `<?php
namespace Other;
use function Vendor\\pkg\\otherHelper;
use const Vendor\\pkg\\OTHER_CONST;
`,
  // (B) the unqualified form must land in P1a, never in P1b.
  "p/globals-use.php": `<?php
namespace Third;
use function array_merge;
use const PHP_EOL;
`,
  // (A) P2b — a file-level return of a value.
  "p/filelevel.php": `<?php
return [1, 2, 3];
`,
  // (A) P2a — a file-level return a consumer cannot name.
  "p/filelevel-scalar.php": `<?php
return true;
`,
}

{
  rmSync(CORPUS, { recursive: true, force: true })
  mkdirSync(path.join(CORPUS, "p"), { recursive: true })
  for (const [rel, src] of Object.entries(CONTROLS)) writeFileSync(path.join(CORPUS, rel), src)
  const g = (a: string[]) => execFileSync("git", ["-C", CORPUS, ...a], { stdio: ["ignore", "pipe", "pipe"] })
  g(["init", "-q", "."])
  g(["add", "-A"])
  g(["-c", "user.email=control@local", "-c", "user.name=control", "commit", "-qm", "controls"])
}

let failures = 0
const check = (name: string, got: unknown, want: unknown): void => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name.padEnd(52)} got ${JSON.stringify(got)}${ok ? "" : `  want ${JSON.stringify(want)}`}`)
}

// ------------------------------------------------------------------ (A)+(B) the corpus probe
console.log("(A)+(B) exports-probe.mts on the control corpus — every probe must FIRE, and the split must discriminate")
const probeOut = execFileSync("npx", ["tsx", path.join(ROOT, "validation/m14/fixtures/php/exports-probe.mts")], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, BB_CORPUS_ROOT: CORPUS, BB_WORKERS: "1", BB_JSON: "1" },
})
const p = JSON.parse(probeOut) as any
check("files admitted", p.filesScanned, 8)
check("P1a global-builtin import (unqualified use)", p.probes["P1a-global-builtin-import"].occurrences, 2)
check("P1b qualified re-export", p.probes["P1b-qualified-reexport"].occurrences, 3)
check("P1a does NOT absorb P1b", p.probes["P1b-qualified-reexport"].occurrences === 3, true)
check("P2a file-level return, nothing nameable", p.probes["P2a-file-level-return-no-named-value"].occurrences, 1)
check("P2b file-level return naming a value", p.probes["P2b-file-level-return-named-value"].occurrences, 1)
check("P3 class_alias", p.probes["P3-alias-call"].occurrences, 1)
check("P4 define() with a LITERAL name  [was 0 on the corpus: the vacuous zero]", p.probes["P4-define-literal"].occurrences, 1)
check("P4b define() with a non-literal name", p.probes["P4b-define-non-literal"].occurrences, 1)
check("P1b distinct targets", p.p1Targets.list, ["Vendor\\pkg\\OTHER_CONST", "Vendor\\pkg\\otherHelper", "Vendor\\pkg\\someHelper"])
check("R3 falsifier: same file DECLARES the imported leaf", p.p1bRedeclaredByFile.count, 1)

// ------------------------------------------------------------------ (D) the DEFINE-AUDIT
// The audit is the instrument that found the `\define` edge the analyzer was missing,
// so it gets its own positive controls: an audit that can only read zero would have
// "confirmed" the old 57 edges forever. Every assertion below fails on the pre-audit
// probe (which had no `defineAudit` block at all).
console.log("")
console.log("(D) the define-AUDIT — the publication set, not just a count")
{
  const audit = p.defineAudit as any
  const byShape = audit.byShapeScopeName as Record<string, number>
  const names = (audit.publications as any[]).map((r) => r.name).sort()
  check("publications the tree implies", audit.publicationsExpected, 2)
  check("  and they are the two file-scope literal publications", names, ["ABS_CONST", "MY_GLOBAL_CONST"])
  check("bare|file-level|literal (the analyzer's original rule)", byShape["bare|file-level|literal"], 1)
  check("absolute-fq|file-level|literal (the shape the corpus had and the rule refused)", byShape["absolute-fq|file-level|literal"], 1)
  check("namespace-relative|file-level|literal — counted, NOT a publication", byShape["namespace-relative|file-level|literal"], 1)
  check("namespaced-other|file-level|literal — a different function, NOT a publication", byShape["namespaced-other|file-level|literal"], 1)
  check("non-literal name (P4b) is not a publication for the same reason", byShape["bare|file-level|non-literal"], 1)
  check("files declaring their OWN `define` (the bare test's only unsoundness)", audit.filesDeclaringTheirOwnDefine.length, 0)
  // The alias call's PUBLISHED name is the SECOND argument (`class_alias(from, to)`),
  // so the audit counts argument 1 — one file-scope literal alias call exists in this
  // control corpus, and it publishes `Widget`.
  check("class_alias/function_alias at file scope with a literal PUBLISHED name", audit.aliasCalls.fileLevelLiteral, 1)
  check("  and the published name is the SECOND argument", (audit.aliasCalls.rows as any[])[0]?.published, "Widget")
}

console.log("")
console.log("(C) withdrawn — the ruling-table copy of this probe no longer exists, so there is nothing to cross-check")
console.log("")
console.log(failures === 0 ? "all controls pass" : `${failures} CONTROL(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)