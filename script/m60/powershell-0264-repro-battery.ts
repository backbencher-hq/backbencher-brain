// script/m60/powershell-0264-repro-battery.ts — does tree-sitter-powershell 0.26.4
// close the 16 named grammar limits on the pinned corpus, without breaking a control?
//
// WHY A BATTERY AND NOT AN F11 A/B. The powershell corpus is the PowerShell
// repository itself, and 166 of its 182 grammar-error files are the repo's OWN
// intentionally-invalid parser-error test fixtures (`unexpectedErrorFiles: 0`).
// Running a whole-corpus A/B on a corpus that is mostly deliberate garbage measures
// the fixtures, not the grammar: G1's "newly damaged" would fire on a file designed
// to fail, for either grammar. The discriminating population is the other 16.
//
// Those 16 are already NAMED, with a reason each, in
// validation/m12/results/powershell-corpus-errors.json (`namedGrammarLimits`). This
// reduces them to minimal sources, one per distinct construct, each with a CONTROL
// that is the ordinary form of the same thing. The controls are what make the result
// a measurement rather than an assertion: a candidate that fixes `??` while breaking
// `$env:X` has moved the boundary, not improved anything.
//
// The battery is the instrument that decided fsharp (0.3.12 closes 0 of 6 named gaps)
// and it is the reason those two lanes were closed in seconds rather than a full
// A/B cycle. Read-only: two wasms, no file I/O, nothing written.
//
// Usage:
//   bun run script/m60/powershell-0264-repro-battery.ts
//   bun run script/m60/powershell-0264-repro-battery.ts --json
//   bun run script/m60/powershell-0264-repro-battery.ts --candidate /path/other.wasm
//
// Writes: nothing.

import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import * as WTS from "web-tree-sitter"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex")
const argv = process.argv.slice(2)
const argValue = (a: string, d?: string) => (argv.includes(a) ? argv[argv.indexOf(a) + 1] : d)
const AS_JSON = argv.includes("--json")

// The pinned artifact is whatever wasm/tree-sitter-powershell.wasm IS, and its
// identity is READ FROM THE PIN REGISTRY rather than written here.
//
// This was a hardcoded `{ version: "0.25.10" }` next to a `path.join(ROOT,
// "wasm", ...)` read, and that combination is a trap with a long fuse: the moment
// the wired wasm was upgraded to 0.26.4 the label kept saying 0.25.10 while the
// bytes it loaded were 0.26.4, and `--candidate` still defaulted to a scratch copy
// of 0.26.4. The run then compared 0.26.4 against 0.26.4 and printed "0.26.4
// closes NONE of the named limits" — a vacuous verdict about a comparison that
// never happened, from an instrument whose entire job is to decide that question.
// A hardcoded version next to a live path is a claim that cannot fail loudly.
//
// So: the identity comes from validation/m14/grammar-pins.json, which is gated, and
// the candidate is REQUIRED. There is no default, because a default is how the two
// paths silently became the same file.
const PINNED = path.join(ROOT, "wasm", "tree-sitter-powershell.wasm")

interface PinRecord { wired?: { file: string; sha256: string; bytes: number }; provenance?: { kind: string; package?: string; version?: string }; lanes?: Record<string, any> }
// The record has two halves and it matters which one answers this: `lanes` is the
// MEASURED half (wired bytes, surface, copies, vendored files, source↔wasm) and
// `decisions` is the AUTHORED half (provenance kind, package, version, the
// decision text). The version lives in `decisions`; the sha lives in `lanes`. A
// first attempt at this read both from `lanes` and printed "?" for the version
// while still reporting a confident-looking header — the sha check passed, so
// nothing looked wrong.
//
// And the provenance SHAPE depends on the lane's history, which is not something a
// reader should hardcode: `byte-identical-to-npm-tarball` carries `version`, while
// `local-rebuild-from-vendored-source` carries `base: { repo, version }` and no
// `version` at all. This reader originally assumed the first shape, so the moment
// the lane took its first grammar patch it printed `pinned undefined (423 types)`
// — a header that looks like a missing value rather than a wrong assumption, on an
// instrument whose job is to say which grammar it measured.
function readPinIdentity(): { package: string; version: string; sha256: string; evidence: string } {
  const regPath = path.join(ROOT, "validation/m14/grammar-pins.json")
  if (!existsSync(regPath)) return { package: "tree-sitter-powershell", version: "UNKNOWN (no pin record)", sha256: sha256(readFileSync(PINNED)), evidence: "no validation/m14/grammar-pins.json — the identity is UNVERIFIED" }
  const reg = JSON.parse(readFileSync(regPath, "utf8")) as any
  const prov = reg?.decisions?.powershell?.provenance
  const measured = reg?.lanes?.powershell?.wired
  const sha = sha256(readFileSync(PINNED))
  if (!prov) return { package: "tree-sitter-powershell", version: "UNPINNED", sha256: sha, evidence: "the pin record's decisions carry no powershell provenance" }
  if (measured?.sha256 !== sha) return { package: prov.package ?? prov.base?.repo ?? "?", version: "SHA MISMATCH", sha256: sha, evidence: `the pin records ${measured?.sha256} and the wired file is ${sha} — re-run verify-grammar-pins.ts --write` }
  // Read the version from whichever shape this lane's provenance actually has, and
  // say which: a patched lane is NOT the published release, and a header that says
  // only "0.26.4" for a patched build would be a false identity.
  const version = prov.version ?? prov.base?.version
  const pkg = prov.package ?? prov.base?.repo ?? "tree-sitter-powershell"
  const patched = prov.kind !== "byte-identical-to-npm-tarball"
  const patches = Array.isArray(prov.patches) && prov.patches.length ? ` + ${prov.patches.length} local patch(es): ${prov.patches.join("; ")}` : ""
  if (!version) return { package: pkg, version: "UNREADABLE PROVENANCE", sha256: sha, evidence: `the pin's provenance (${prov.kind}) carries neither 'version' nor 'base.version' — the reader is out of date with the shape` }
  return { package: pkg, version: `${version}${patched ? " (patched)" : ""}`, sha256: sha, evidence: `sha matches the gated pin record (${prov.kind})${patches}` }
}
const PINNED_IDENTITY = readPinIdentity()

const CANDIDATE = argValue("--candidate")
if (!CANDIDATE || !existsSync(CANDIDATE)) {
  console.error("usage: powershell-0264-repro-battery.ts --candidate <wasm> [--json]\n  --candidate is REQUIRED: a default here is how the pinned and candidate paths became the same file and the battery printed a vacuous verdict.")
  process.exit(2)
}

type Case = { id: string; construct: string; control: boolean; source: string; from?: string }
// Whether a case derived from a NAMED LIMIT actually reproduces in isolation. Measured
// after the first run: `ddash-quoted-range`, `backslash-path-1`, `backslash-path-2`,
// `scoped-interp` and `var-prefixed-path-2` all parse standalone, so the construct the
// M12 artifact names is not what breaks those files. The first run of this battery
// would have reported them as "still broken" and been wrong four times over.
const BATTERY: Case[] = [
  // --- null-coalescing / null-conditional (2 files) -------------------------
  { id: "null-coalescing", construct: "`$a ?? $b` (PS 7.4)", control: false, source: "$a = Get-Thing\n$b = $a ?? 'fallback'\n", from: ".github/actions/infrastructure/markdownlinks/Parse-MarkdownLink.ps1" },
  { id: "null-conditional", construct: "`$a?.b` (PS 7.4)", control: false, source: "$a = Get-Thing\n$b = $a?.Name\n", from: ".github/actions/infrastructure/markdownlinks/Verify-MarkdownLinks.ps1" },
  { id: "coalesce-control", construct: "CONTROL: ordinary fallback", control: true, source: "$a = Get-Thing\n$b = $a\nif ($null -eq $b) { $b = 'fallback' }\n" },

  // --- `#` inside an interpolated string (1 file) ---------------------------
  { id: "hash-in-interpolation", construct: "`\"$Repo#$PR\"` — `#` before `$PR`", control: false, source: "$Repo = 'o'\n$PR = 1\n$s = \"$Repo#$PR\"\n", from: ".github/skills/analyze-pester-failures/scripts/analyze-pr-test-failures.ps1" },
  { id: "hash-control", construct: "CONTROL: `/` instead of `#`", control: true, source: "$Repo = 'o'\n$PR = 1\n$s = \"$Repo/$PR\"\n" },

  // --- double-dash native flags with quoted interpolation (3 files) --------
  { id: "ddash-quoted-interp", construct: "`--git-dir=\"$RepoRoot/.git\"`", control: false, source: "$RepoRoot = '/r'\ngit --git-dir=\"$RepoRoot/.git\" status\n", from: "build.psm1" },
  { id: "ddash-quoted-range", construct: "`--merges \"$tag_hash..HEAD\"`", control: false, source: "$tag_hash = 'abc'\ngit --no-pager --merges \"$tag_hash..HEAD\"\n", from: "tools/releaseTools.psm1" },
  { id: "ddash-control", construct: "CONTROL: a double-dash flag with NO interpolated value", control: true, source: "git --no-pager status\n" },

  // --- backslash path continuation after a variable (4 files) ---------------
  { id: "backslash-path-1", construct: "`\"$PSScriptRoot\\ResxGen.psm1\"`", control: false, source: "& \"$PSScriptRoot\\ResxGen.psm1\"\n", from: "tools/ResxGen/ResxGen.ps1" },
  { id: "backslash-path-2", construct: "`\"$PSScriptRoot\\cgmanifest\"`", control: false, source: "Get-Content \"$PSScriptRoot\\cgmanifest\"\n", from: "tools/findMissingNotices.ps1" },
  { id: "backslash-path-3", construct: "`Import-Module $PSScriptRoot\\..\\..\\build.psm1`", control: false, source: "Import-Module $PSScriptRoot/../../../build.psm1\n", from: "tools/packaging/releaseTests/sbom.tests.ps1" },
  { id: "backslash-control", construct: "CONTROL: forward-slash path", control: true, source: "& \"$PSScriptRoot/ResxGen.psm1\"\n" },

  // --- comma-separated bare-argument lists (2 files) ------------------------
  { id: "bare-arg-list", construct: "`Export-ModuleMember A, B, C`", control: false, source: "function Get-A { }\nExport-ModuleMember A, B, C\n", from: "src/Modules/Windows/PSDiagnostics/PSDiagnostics.psm1" },
  { id: "bare-arg-list-2", construct: "`-Type deb, rpm, ...`", control: false, source: "Install-Package -Type deb, rpm, tar\n", from: "tools/ci.psm1" },
  { id: "bare-arg-control", construct: "CONTROL: a single -Parameter with one value", control: true, source: "function Get-A { }\nExport-ModuleMember -Name A\n" },

  // --- nested type literals (2 files) ---------------------------------------
  { id: "nested-type-literal", construct: "`[System.Environment+SpecialFolder]`", control: false, source: "$p = [System.Environment+SpecialFolder]::GetFolderPath(0)\n", from: "src/powershell-native/Install-PowerShellRemoting.ps1" },
  { id: "nested-generic", construct: "`[Dictionary[[string], [PkgVer[]]]]::new()`", control: false, source: "$d = [System.Collections.Generic.Dictionary[[string], [int]]]::new()\n", from: "tools/UpdateDotnetRuntime.ps1" },
  { id: "nested-type-control", construct: "CONTROL: simple type literal", control: true, source: "$p = [System.Environment]::GetFolderPath(0)\n" },

  // --- ternary + scoped interpolation (1 file) ------------------------------
  { id: "ternary", construct: "`$arm64 ? $a : $b` (PS 7)", control: false, source: "$arm64 = $true\n$a = 1\n$b = 2\n$c = $arm64 ? $a : $b\n", from: "tools/wix/wix.psm1" },
  { id: "scoped-interp", construct: "`\"${env:ProgramFiles(x86)}\\foo\"`", control: false, source: "$s = \"${env:ProgramFiles(x86)}\\foo\"\n", from: "tools/wix/wix.psm1" },
  // NOTE the three cases marked `reproduces: false` below: the M12 artifact names a
  // construct for a file, and that construct parses in isolation. The file therefore
  // fails for a DIFFERENT reason, and the named limit mis-attributes it. Recorded
  // rather than quietly kept as a "still broken" case.
  { id: "ternary-control", construct: "CONTROL: if/else", control: true, source: "$arm64 = $true\n$a = 1\n$b = 2\nif ($arm64) { $c = $a } else { $c = $b }\n" },

  // --- subexpression with static / member chains (1 file) ------------------
  { id: "subexpr-static-chain", construct: "`$([math]::Round($x))`", control: false, source: "$x = 1.5\n$s = \"$([math]::Round($x))\"\n", from: "tools/AttackSurfaceAnalyzer/Run-AttackSurfaceAnalyzer.ps1" },
  // RENAMED from `subexpr-member-chain`. That name said the class was about a
  // SUBEXPRESSION and a MEMBER CHAIN, and it is neither: `$($_.Length)` parses, and so
  // does `$($x/2)`. The real class is a numeric literal whose CASE-INsensitive multiplier
  // suffix was listed lowercase-only, which is invisible in an assignment (`$c = 1KB`
  // parses, because the token falls back to a generic one) and fatal in operand position.
  { id: "multiplier-suffix-case", construct: "`$($_.Length/1KB)` — UPPERCASE multiplier", control: false, source: "$items = 1..3 | ForEach-Object { $_ }\n$s = \"$($items.Length/1KB)\"\n" },
  // The lowercase control is the important one: an early fix used the grammar's own
  // caseInsensitive() helper and REGRESSED this ok into 3 ERROR. A battery that only
  // asserted the broken direction would have called that fix a success.
  { id: "multiplier-suffix-case-ctrl-lower", construct: "CONTROL: `$($x/1kb)` — lowercase worked before the fix", control: true, source: "$x = 5\n$c = $($x/1kb)\n" },
  { id: "multiplier-suffix-case-ctrl-plain", construct: "CONTROL: `$x/12`, `$x/1.5`, `$x/0x1F` — unsuffixed literals", control: true, source: "$x = 5\n$c = $x/12\n$d = $x/1.5\n$e = $x/0x1F\n" },
  { id: "subexpr-control", construct: "CONTROL: plain subexpression", control: true, source: "$x = 3\n$s = \"$($x)\"\n" },

  // --- variable-prefixed path as a command argument (2 files) ---------------
  // RENAMED from `var-prefixed-path`. That name said the class was about a VARIABLE,
  // and it is not: `& $Destination` alone parses, `& $Destination -x` parses, and a
  // LITERAL POSIX path fails identically. The cause is that `path_command_name_token`
  // allowed `\\` but not `/`, so a Windows path parsed and a POSIX one could not.
  // The controls below are the ones that make that separable from every theory that
  // was tried first (variables, trailing arguments, the operator itself).
  { id: "invokation-path-slash", construct: "`& $Destination/pwsh -x`", control: false, source: "$Destination = '/d'\n& $Destination/pwsh -x\n", from: "tools/install-powershell.ps1" },
  { id: "invokation-path-slash-literal", construct: "`& /usr/bin/pwsh` — no variable at all", control: false, source: "& /usr/bin/pwsh\n" },
  { id: "invokation-path-slash-ctrl-var", construct: "CONTROL: `& $Destination` — variable, no slash", control: true, source: "$Destination = '/d'\n& $Destination\n" },
  { id: "invokation-path-slash-ctrl-arg", construct: "CONTROL: `& $Destination -x` — variable, then a flag", control: true, source: "$Destination = '/d'\n& $Destination -x\n" },
  { id: "invokation-path-slash-ctrl-div", construct: "CONTROL: `$a/$b` — DIVISION must stay division", control: true, source: "$a = 1\n$b = 2\n$c = $a/$b\n" },
  { id: "invokation-path-slash-ctrl-argpath", construct: "CONTROL: `cd /tmp/x` — a path as an ARGUMENT already worked", control: true, source: "cd /tmp/x\n" },
  { id: "var-prefixed-path-2", construct: "`$PSHOME\\pwsh` as an argument", control: false, source: "$exe = \"$PSHOME\\pwsh\"\n& $exe -NoLogo\n" },
  { id: "var-prefixed-control", construct: "CONTROL: plain variable argument", control: true, source: "$Destination = '/d'\n& $Destination -x\n" },
]

await WTS.Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

function probe(lang: any, source: string) {
  const p = new (WTS.Parser as any)()
  p.setLanguage(lang)
  const t = p.parse(source)
  let errors = 0
  let missing = 0
  let first: string | null = null
  const st: any[] = [t.rootNode]
  while (st.length) {
    const n = st.pop()
    if (n.type === "ERROR") {
      errors++
      if (!first) first = source.split("\n")[n.startPosition.row]?.trim().slice(0, 64) ?? ""
    }
    if (n.isMissing) missing++
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) st.push(c)
    }
  }
  p.delete?.()
  return { breaks: errors > 0 || missing > 0, errors, missing, first }
}

const pinned = await WTS.Language.load(readFileSync(PINNED))
const cand = await WTS.Language.load(readFileSync(CANDIDATE))

const rows = BATTERY.map((c) => {
  const p = probe(pinned, c.source)
  const k = probe(cand, c.source)
  return {
    id: c.id,
    role: c.control ? "CONTROL (must keep parsing)" : "named limit (should parse)",
    construct: c.construct,
    from: c.from ?? null,
    pinned: { breaks: p.breaks, errors: p.errors, missing: p.missing },
    candidate: { breaks: k.breaks, errors: k.errors, missing: k.missing },
    outcome: p.breaks && !k.breaks ? "FIXED" : !p.breaks && k.breaks ? "REGRESSION" : p.breaks && k.breaks ? "still breaks" : "unchanged",
    // A case taken from a named limit that does NOT reproduce is a mis-attribution in
    // the source artifact, and it must not be counted as a limit the candidate failed
    // to fix — that would inflate the denominator and flatter the result.
    reproduces: c.control ? null : p.breaks,
    misattributed: !c.control && !p.breaks,
  }
})

const breaking = rows.filter((r) => !r.role.startsWith("CONTROL") && r.reproduces === true)
const misattributed = rows.filter((r) => r.misattributed)
const controls = rows.filter((r) => r.role.startsWith("CONTROL"))
const fixed = rows.filter((r) => r.outcome === "FIXED")
const regressed = rows.filter((r) => r.outcome === "REGRESSION")
const stillBroken = rows.filter((r) => r.outcome === "still breaks")

const report = {
  schemaVersion: 1,
  instrument: "m60-powershell-0264-repro-battery",
  question: "does 0.26.4 close the named grammar limits on the powershell corpus, without breaking a control?",
  pinned: { file: path.basename(PINNED), nodeTypes: pinned.nodeTypeCount, ...PINNED_IDENTITY },
  candidate: { file: path.basename(CANDIDATE), nodeTypes: cand.nodeTypeCount },
  corpus: {
    repo: "powershell",
    revision: "91ce9844e2a70e7184a8fcb26848f019eac151b4",
    tracked: 553,
    errorFiles: 182,
    ofWhichIntentionalTestData: 166,
    namedLimits: 16,
    note:
      "166 of the 182 error files are the PowerShell repository's OWN intentionally-invalid parser-error test fixtures, and `unexpectedErrorFiles` is 0. A whole-corpus A/B would measure those fixtures rather than the grammar, so the discriminating population is the 16 named limits and this battery reduces them to minimal sources. The controls are not filler: they are the ordinary form of each construct, and a candidate that fixes one while breaking another has moved the boundary.",
  },
  result: {
    cases: rows.length,
    namedLimits: breaking.length,
    controls: controls.length,
    fixed: fixed.length,
    regressed: regressed.length,
    stillBroken: stillBroken.length,
    controlsHeld: controls.filter((r) => !r.candidate.breaks).length,
    controlsTotal: controls.length,
    namedLimitsThatDoNotReproduce: misattributed.length,
  },
  rows,
  policy:
    "A screening battery, not a gate: minimal sources with no file I/O, replayed under both grammars. Acceptance remains M14.0.F11, and on this corpus F11's whole-corpus reading is dominated by intentional test data — so the battery is the cheaper and more discriminating instrument, and a clean battery is a reason to run F11, never a substitute for it. Constructs are drawn from the namedGrammarLimits already recorded in the M12 artifact; where this battery adds a case beyond those 16 files, the `from` field is null and the construct is a CONTROL or a restatement of a named one.",
}

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`powershell battery — pinned ${report.pinned.version} (${report.pinned.nodeTypes} types) vs ${path.basename(CANDIDATE)} (${report.candidate.nodeTypes} types)`)
  console.log(`corpus: ${report.corpus.tracked} tracked .ps1, ${report.corpus.namedLimits} NAMED limits (the other ${report.corpus.ofWhichIntentionalTestData} error files are the repo's own invalid-syntax fixtures)\n`)
  for (const r of rows) {
    const mark = r.outcome === "FIXED" ? "FIXED  " : r.outcome === "REGRESSION" ? "REGRESS " : r.outcome === "still breaks" ? "STILL  " : "  ok   "
    console.log(`  ${mark} ${r.id.padEnd(24)} pinned=${r.pinned.errors}e/${r.pinned.missing}m cand=${r.candidate.errors}e/${r.candidate.missing}m  ${r.construct.slice(0, 46)}`)
  }
  const v = report.result
  console.log(`\n  named limits that REPRODUCE in isolation : ${v.namedLimits} of the constructs tried`)
  console.log(`  FIXED ${v.fixed}/${v.namedLimits}   REGRESSIONS ${v.regressed}   still broken ${v.stillBroken}   controls held ${v.controlsHeld}/${v.controlsTotal}`)
  if (v.namedLimitsThatDoNotReproduce) console.log(`  MIS-ATTRIBUTED in the M12 artifact: ${v.namedLimitsThatDoNotReproduce} case(s) parse standalone, so the construct named for that file is not what breaks it`)
  console.log(
    `  ${v.fixed === v.namedLimits && v.regressed === 0
      ? `the candidate (${path.basename(CANDIDATE)}) closes EVERY named limit and holds every control — the lane owes an UPGRADE, not a patch.`
      : v.fixed > 0
        ? `the candidate (${path.basename(CANDIDATE)}) closes ${v.fixed} of ${v.namedLimits} named limits. The remaining ${v.stillBroken} owe a patch.`
        : `the candidate (${path.basename(CANDIDATE)}) closes NONE of the named limits — the lane owes a patch regardless.`}`,
  )
}
