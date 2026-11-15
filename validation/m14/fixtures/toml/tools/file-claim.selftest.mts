/**
 * CONTROL for the proposed shared guard (`file-claim.ts`) — the falsifier for every clause in it.
 *
 * Each case states what the guard MUST return and, for the negative ones, WHICH clause refuses it.
 * The point is not that the guard is exercised; it is that each clause has a case that would FAIL if
 * the clause were dropped, because dropping the extension clause is exactly what refuted 392 edges in
 * the five-lane pricing.
 *
 *   npx tsx validation/m14/fixtures/toml/tools/file-claim.selftest.mts
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
// IT CONTROLS THE **SHIPPED** MODULE, not the copy this directory keeps as the proposal's record.
// Until the guard landed that copy WAS the only thing to test; now the thing to test is
// `src/ast/file-claim.ts`, and a control pointed at a stale copy would pass while the shipped module
// regressed — which is the failure this file exists to prevent.
import { FILE_CLAIM_MAX_BYTES, fileClaimForTarget, foldProjectPath, projectRelativeOf } from "../../../../../src/ast/file-claim.ts"

const root = mkdtempSync(path.join(tmpdir(), "file-claim-"))
const touch = (rel: string) => {
  const abs = path.join(root, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, "x")
}
touch("src/build/main.zig")
touch("src/styles/_variables.scss")
touch("Cocoa/Foundation.icl")
touch("build.zig.zon")
touch("src/styles/_all.sass")
touch("partials/base.scss")

let pass = 0
let fail = 0
const check = (name: string, got: unknown, want: unknown, why: string) => {
  const ok = got === want
  if (ok) pass++; else fail++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      got ${JSON.stringify(got)}${ok ? "" : ` WANT ${JSON.stringify(want)}`}  — ${why}`)
}

const at = (rel: string) => path.join(root, rel)

// --- the clause that took refutations from 392 to 0 ---------------------------------------------
check("zig `@import(\"build.zig.zon\")` is REFUSED",
  fileClaimForTarget({ projectRoot: root, filePath: at("build.zig"), written: "build.zig.zon", admittedExtensions: ["zig"] }),
  null,
  "the file EXISTS and is a path — only the admitted-extension clause refuses it, and this is the shape that refuted 368 zig edges")

check("scss `_all.sass` is REFUSED for the scss lane",
  fileClaimForTarget({ projectRoot: root, filePath: at("src/styles/app.scss"), written: "_all.sass", admittedExtensions: ["scss"] }),
  null,
  "`.sass` routes to language `sass`, NOT to scss, so the scss population cannot hold it (24 scss refutations)")

check("the SAME file is CLAIMED when the lane admits `.sass`",
  fileClaimForTarget({ projectRoot: root, filePath: at("src/styles/app.scss"), written: "_all.sass", admittedExtensions: ["sass"] }),
  "src/styles/_all.sass",
  "the clause is about the LANE'S admitted list, not about the extension being 'wrong'")

// --- the positive path ---------------------------------------------------------------------------
check("a plain relative path that exists is CLAIMED",
  fileClaimForTarget({ projectRoot: root, filePath: at("build.zig"), written: "src/build/main.zig", admittedExtensions: ["zig"] }),
  "src/build/main.zig",
  "the ordinary case")

check("an extension-less Sass specifier resolves through `extraCandidates`",
  fileClaimForTarget({
    projectRoot: root,
    filePath: at("src/styles/app.scss"),
    written: "partials/base",
    admittedExtensions: ["scss"],
    extraCandidates: ["partials/base.scss"],
  }),
  "partials/base.scss",
  "lane arithmetic is the CALLER'S, and the guard honours it without knowing Sass")

check("a Clean `Module:item` target claims the MODULE file",
  fileClaimForTarget({
    projectRoot: root,
    filePath: at("Clyde.icl"),
    written: "Cocoa.Foundation:NSApplication",
    admittedExtensions: ["icl", "dcl"],
    extraCandidates: ["Cocoa/Foundation.icl"],
  }),
  "Cocoa/Foundation.icl",
  "clean is not a path lane; its candidate arithmetic strips the `:item` suffix")

// --- the refusals that keep a claim from being FALSE --------------------------------------------
check("a path that does NOT exist is REFUSED",
  fileClaimForTarget({ projectRoot: root, filePath: at("build.zig"), written: "src/missing.zig", admittedExtensions: ["zig"] }),
  null,
  "statSync clause — an unconfirmed claim is what REFUTES")

check("a path that ESCAPES the project is REFUSED",
  fileClaimForTarget({ projectRoot: root, filePath: at("build.zig"), written: "../../etc/passwd.zig", admittedExtensions: ["zig"] }),
  null,
  "fold clause — the claim would name a file outside the project's own facts")

check("an absolute path is REFUSED",
  fileClaimForTarget({ projectRoot: root, filePath: at("build.zig"), written: "/etc/hosts.zig", admittedExtensions: ["zig"] }),
  null,
  "shape clause")

check("a URL is REFUSED",
  fileClaimForTarget({ projectRoot: root, filePath: at("build.zig"), written: "https://example.com/x.zig", admittedExtensions: ["zig"] }),
  null,
  "shape clause — a URL is not a project path")

check("a glob is REFUSED",
  fileClaimForTarget({ projectRoot: root, filePath: at("build.zig"), written: "src/*.zig", admittedExtensions: ["zig"] }),
  null,
  "shape clause")

check("no admitted extensions means NO claim",
  fileClaimForTarget({ projectRoot: root, filePath: at("build.zig"), written: "src/build/main.zig", admittedExtensions: [] }),
  null,
  "a lane that has not stated its admitted list cannot claim anything")

// --- the SIZE cap: a candidate the population would not have admitted ---------------------------------
// `src/ast/parallel-indexer.ts` skips a file over `maxFileSizeBytes`, so a claim about one is
// REFUTED by the gate rather than unverified — json-lane measured 17 zig edges to exactly this. The
// fixture files are ONE byte (`touch` writes "x"), so the cap that refuses them is ZERO: the clause is
// `size > cap`, and my first version of this control passed a cap of 1 — which ADMITS a 1-byte file.
// The control was wrong about the rule, not the rule about the code.
check("a candidate over the cap is REFUSED when the cap is passed",
  fileClaimForTarget({ projectRoot: root, filePath: at("build.zig"), written: "src/build/main.zig", admittedExtensions: ["zig"], maxFileSizeBytes: 0 }),
  null,
  "the size clause — the file EXISTS and carries the admitted extension, so only the cap refuses it")

check("the SAME candidate is CLAIMED when no cap is passed",
  fileClaimForTarget({ projectRoot: root, filePath: at("build.zig"), written: "src/build/main.zig", admittedExtensions: ["zig"] }),
  "src/build/main.zig",
  "the clause is opt-in: a lane whose population has no cap must not be silently clamped")

check("a lane passing the indexer's own constant claims an ordinary file",
  fileClaimForTarget({ projectRoot: root, filePath: at("build.zig"), written: "src/build/main.zig", admittedExtensions: ["zig"], maxFileSizeBytes: FILE_CLAIM_MAX_BYTES }),
  "src/build/main.zig",
  "the exported constant admits everything under 1 MB, which is every file these lanes claim")

// --- the ROOT case, which file-shaped lanes never produce ---------------------------------------------
check("projectRelativeOf answers \"\" for a path landing on the project root",
  projectRelativeOf("docs/", ".."),
  "",
  "toml's `path = \"..\"`: the root IS the answer, and `foldProjectPath` is the function that refuses it")

check("foldProjectPath still refuses the root, because the root is not a file",
  foldProjectPath("docs/", ".."),
  null,
  "the two functions differ in exactly this one case, which is the whole point of the pair")

check("projectRelativeOf refuses an escape past the base, like the fold",
  projectRelativeOf("a/b/", "../../../x"),
  null,
  "the root is reachable; the outside is not")

// --- magic constants ------------------------------------------------------------------------------
check("`dirname(__FILE__)` resolves before `__FILE__`",
  fileClaimForTarget({
    projectRoot: root,
    filePath: at("src/styles/app.scss"),
    written: "__DIR__/_variables.scss",
    admittedExtensions: ["scss"],
    magicConstants: { __DIR__: "src/styles", __FILE__: "src/styles/app.scss" },
  }),
  "src/styles/_variables.scss",
  "longest-key-first substitution, the php case")

// --- the pure fold, exercised directly --------------------------------------------------------------
// THE BASE IS REPO-RELATIVE, so consuming it lands on the PROJECT ROOT, which is still inside the
// project: `a/b/` + `../../x` is `x`, and that is correct rather than a bug. Escaping requires MORE
// `..` than the base has segments — and that is the case the guard must refuse.
check("foldProjectPath consumes the base without escaping",
  foldProjectPath("a/b/", "../../x"),
  "x",
  "the base is inside the project, so popping it yields the root and the result is still project-relative")

check("foldProjectPath refuses an escape PAST the base",
  foldProjectPath("a/b/", "../../../x"),
  null,
  "one `..` more than the base has segments leaves the project, and the fold refuses rather than clamping")

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — file-claim guard self-test: ${pass} pass, ${fail} fail`)
if (fail > 0) process.exit(1)
