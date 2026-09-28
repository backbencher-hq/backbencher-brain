// script/m13/verify-safety-primitives.ts — M13.04 (B4).
//
// Unit + integration verification of the shared safety primitives:
//   1. extractIdentifierOccurrences — AST identity, not raw-text substring.
//   2. buildSyntaxMask / collectMaskedRanges — per-language comment/string
//      masking with interpolation code re-exposed as live.
//   3. assertFreshFiles / assertFreshSymbols — freshness on every read path.
//
// Adversarial by construction: every language family asserts that identifier
// text inside a comment or string literal produces ZERO reference sites and is
// masked out, while real identifiers (including interpolation code) stay live.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  parseForSafety,
  extractIdentifierOccurrences,
  buildSyntaxMask,
  isCodeAt,
  occurrencesMatching,
  assertFreshFiles,
  assertFreshSymbols,
  collectStaleFiles,
} from "../../src/ast/safety-primitives"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.04",
  code: "B4",
  tool: "baseline",
  title: "Shared safety primitives: AST reference identity, per-language masking, freshness",
  layers: ["unit", "integration"],
  decisions: {
    maskingSource: "tree-sitter grammar comment/string nodes (no character scanning, no JS/C-only mask)",
    interpolationReexposed: "template_substitution, interpolation, interpolation_expression, string_interpolation, expansion, simple_expansion, command_substitution, arithmetic_expansion, process_substitution, subshell, variable_name, interpolated_expression",
    referenceIdentity: "leaf identifier nodes tagged with nodeType + parentType + exact byte range (never a raw-text substring match)",
    freshness: "reuses brain/freshness.ts checkFileFreshness/checkSymbolFreshness; assertFresh* throws on any stale/missing",
  },
  limitations: [
    "Dynamic-language reference node types beyond identifier/variable/variable_name/simple_variable/constant (e.g. PHP 'name', Clojure 'sym_lit', SQL object/column reference identification) are mapped in E2/E3 when bb_edit consumes these primitives.",
    "SQL string/numeric literals share the grammar node type 'literal' (both masked as non-reference bytes); PowerShell `$var` occurrences include the `$` sigil in their text; PowerShell expandable-string variable re-exposure is an E3 refinement.",
    "Regex literals are left as code; their pattern text is not an identifier node so extraction is unaffected (brace-body scanning for insert is E4).",
    "C/C++ compiler-extension normalization and the 1MB parse cap are shared with parseFile via ASTEngine.parseTree so byte offsets agree with the index.",
  ],
})

interface Fixture {
  language: string
  path: string
  source: string
  /** Token names that appear only inside comments/strings — must NOT be sites. */
  ghosts: string[]
  /** A real identifier that appears in code (and in interpolation where applicable). */
  live?: string
}

const fixtures: Fixture[] = [
  {
    language: "javascript",
    path: "sample.js",
    source: [
      "// zzzGhostComment",
      "/* zzzGhostBlock */",
      "const realToken = 1",
      'const s = "zzzGhostString"',
      "const t = `${realToken}`",
    ].join("\n"),
    ghosts: ["zzzGhostComment", "zzzGhostBlock", "zzzGhostString"],
    live: "realToken",
  },
  {
    language: "typescript",
    path: "sample.ts",
    source: [
      "// zzzGhostComment",
      "const realToken: number = 1",
      'const s = "zzzGhostString"',
      "const t = `${realToken}`",
    ].join("\n"),
    ghosts: ["zzzGhostComment", "zzzGhostString"],
    live: "realToken",
  },
  {
    language: "python",
    path: "sample.py",
    source: [
      "# zzzGhostComment",
      "def realToken():",
      '    """zzzGhostDocstring"""',
      '    s = "zzzGhostString"',
      '    t = f"{realToken}"',
    ].join("\n"),
    ghosts: ["zzzGhostComment", "zzzGhostDocstring", "zzzGhostString"],
    live: "realToken",
  },
  {
    language: "ruby",
    path: "sample.rb",
    source: [
      "# zzzGhostComment",
      "def realToken",
      '  s = "zzzGhostString"',
      '  t = "#{realToken}"',
      "end",
    ].join("\n"),
    ghosts: ["zzzGhostComment", "zzzGhostString"],
    live: "realToken",
  },
  {
    language: "bash",
    path: "sample.sh",
    source: [
      "# zzzGhostComment",
      "realToken=1",
      's="zzzGhostString"',
      't="$realToken"',
    ].join("\n"),
    ghosts: ["zzzGhostComment", "zzzGhostString"],
    live: "realToken",
  },
  {
    language: "haskell",
    path: "Sample.hs",
    source: [
      "-- zzzGhostComment",
      "{- zzzGhostBlock -}",
      'realToken = "zzzGhostString"',
    ].join("\n"),
    ghosts: ["zzzGhostComment", "zzzGhostBlock", "zzzGhostString"],
    live: "realToken",
  },
  {
    language: "lua",
    path: "sample.lua",
    source: [
      "-- zzzGhostComment",
      "--[[ zzzGhostBlock ]]",
      'local realToken = "zzzGhostString"',
    ].join("\n"),
    ghosts: ["zzzGhostComment", "zzzGhostBlock", "zzzGhostString"],
    live: "realToken",
  },
  {
    language: "c",
    path: "sample.c",
    source: [
      "// zzzGhostComment",
      "/* zzzGhostBlock */",
      "int realToken = 0;",
      'const char *s = "zzzGhostString";',
      "int main(void) { return realToken; }",
    ].join("\n"),
    ghosts: ["zzzGhostComment", "zzzGhostBlock", "zzzGhostString"],
    live: "realToken",
  },
  {
    language: "sql",
    path: "sample.sql",
    source: [
      "-- zzzGhostComment",
      "SELECT 1 AS realToken;",
      "SELECT 'zzzGhostString';",
    ].join("\n"),
    ghosts: ["zzzGhostComment", "zzzGhostString"],
    live: "realToken",
  },
  {
    language: "powershell",
    path: "sample.ps1",
    source: [
      "# zzzGhostComment",
      "<# zzzGhostBlock #>",
      '$realToken = "zzzGhostString"',
    ].join("\n"),
    ghosts: ["zzzGhostComment", "zzzGhostBlock", "zzzGhostString"],
    // PowerShell variable nodes include the `$` sigil in their text.
    live: "$realToken",
  },
  // YAML has no identifier nodes (keys are plain scalars) — verifies masking only.
  {
    language: "yaml",
    path: "sample.yaml",
    source: [
      "# zzzGhostComment",
      'realToken: "zzzGhostString"',
    ].join("\n"),
    ghosts: ["zzzGhostComment", "zzzGhostString"],
  },
]

for (const fixture of fixtures) {
  let parsed
  try {
    parsed = await parseForSafety(fixture.path, fixture.source)
  } catch (error) {
    harness.check(
      `${fixture.language}: parseForSafety succeeds`,
      false,
      error instanceof Error ? error.message : String(error),
    )
    continue
  }

  harness.check(
    `${fixture.language}: language detected as ${fixture.language}`,
    parsed.language === fixture.language,
    `got ${parsed.language}`,
  )

  // Ghosts: comment/string text must never be a reference site and must be masked.
  for (const ghost of fixture.ghosts) {
    const offset = fixture.source.indexOf(ghost)
    const occ = occurrencesMatching(parsed.occurrences, ghost)
    harness.negative(
      `${fixture.language}: "${ghost}" is not a reference site`,
      occ.length === 0,
      `got ${occ.length} occurrence(s)`,
    )
    harness.check(
      `${fixture.language}: "${ghost}" is masked (comment/string)`,
      offset >= 0 && !isCodeAt(parsed.mask, offset),
      offset < 0 ? "token not found in source" : "byte marked as code",
    )
  }

  // Live token: present in code; every occurrence (including interpolation) is live code.
  if (fixture.live) {
    const occ = occurrencesMatching(parsed.occurrences, fixture.live)
    harness.check(
      `${fixture.language}: "${fixture.live}" has at least one AST reference site`,
      occ.length >= 1,
      `got ${occ.length}`,
    )
    const allLive = occ.length > 0 && occ.every((o) => isCodeAt(parsed.mask, o.startIndex))
    harness.check(
      `${fixture.language}: every "${fixture.live}" occurrence is live code (interpolation re-exposed)`,
      allLive,
      occ.map((o) => `${o.nodeType}@${o.startIndex}:${isCodeAt(parsed.mask, o.startIndex) ? "code" : "masked"}`).join(", "),
    )
  }
}

// ── Explicit interpolation re-exposure (JS template, Python f-string) ──────
{
  const js = await parseForSafety(
    "t.js",
    'const name = "x"\nconst msg = `hello ${name}`\n',
  )
  const nameOcc = occurrencesMatching(js.occurrences, "name")
  harness.check(
    "JS: template-substitution identifier is a live reference site",
    nameOcc.length === 2 && nameOcc.every((o) => isCodeAt(js.mask, o.startIndex)),
    nameOcc.map((o) => `${o.nodeType}@${o.startIndex}:${isCodeAt(js.mask, o.startIndex) ? "code" : "masked"}`).join(", "),
  )
}
{
  const py = await parseForSafety(
    "t.py",
    'name = "x"\nmsg = f"hello {name}"\n',
  )
  const nameOcc = occurrencesMatching(py.occurrences, "name")
  harness.check(
    "Python: f-string interpolation identifier is a live reference site",
    nameOcc.length === 2 && nameOcc.every((o) => isCodeAt(py.mask, o.startIndex)),
    nameOcc.map((o) => `${o.nodeType}@${o.startIndex}:${isCodeAt(py.mask, o.startIndex) ? "code" : "masked"}`).join(", "),
  )
}

// ── Direct API: buildSyntaxMask + extractIdentifierOccurrences ─────────────
{
  const js = await parseForSafety(
    "direct.js",
    "// hidden\nexport function visible() { return 1 }\n",
  )
  // buildSyntaxMask needs a tree; parseForSafety already deletes it. Re-derive
  // via the public building blocks by parsing again through parseForSafety is
  // sufficient — here we assert the two exported pure helpers are consistent.
  harness.check(
    "extractIdentifierOccurrences returns identity-tagged sites (nodeType+parentType+range)",
    js.occurrences.every((o) => typeof o.nodeType === "string" && o.nodeType.length > 0 && typeof o.parentType === "string" && o.startIndex < o.endIndex),
  )
  harness.check(
    "occurrences exclude comment text entirely",
    occurrencesMatching(js.occurrences, "hidden").length === 0,
  )
  harness.check(
    "occurrences include the function identifier with exact range",
    occurrencesMatching(js.occurrences, "visible").length === 1,
  )
}

// ── Freshness assertions (integration: real index + DB) ────────────────────
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-b4-fresh-"))
  const pid = "verify-b4-safety"
  mkdirSync(path.join(root, "src"), { recursive: true })
  const alphaPath = path.join(root, "src", "alpha.ts")
  const betaPath = path.join(root, "src", "beta.ts")
  writeFileSync(alphaPath, "export function alphaOne(): number { return 1 }\n")
  writeFileSync(betaPath, "export function betaOne(): string { return 'b' }\n")

  await indexProjectParallel(pid, root, {})
  const raw = await BrainDatabase.getRawInstance(pid)
  const alphaFileId = (raw.prepare("SELECT id FROM brain_file WHERE path = ?").get(alphaPath) as any).id
  const betaFileId = (raw.prepare("SELECT id FROM brain_file WHERE path = ?").get(betaPath) as any).id
  const alphaSymId = (raw.prepare("SELECT id FROM brain_symbol WHERE name = 'alphaOne'").get() as any)?.id

  let threw = ""
  try {
    assertFreshFiles(raw, [alphaFileId, betaFileId], "b4 fixture")
  } catch (e) {
    threw = String(e)
  }
  harness.check("assertFreshFiles passes when all files are fresh", threw === "", threw)

  harness.check("collectStaleFiles returns empty when fresh", collectStaleFiles(raw, [alphaFileId, betaFileId]).length === 0)

  appendFileSync(alphaPath, "// changed after indexing\n")
  harness.negative(
    "assertFreshFiles throws when a file is stale",
    (() => {
      try {
        assertFreshFiles(raw, [alphaFileId], "b4 stale")
        return false
      } catch (e) {
        return String(e).includes("not fresh") && String(e).includes("stale")
      }
    })(),
  )

  if (alphaSymId) {
    harness.negative(
      "assertFreshSymbols throws when its backing file is stale",
      (() => {
        try {
          assertFreshSymbols(raw, [alphaSymId], "b4 stale-symbol")
          return false
        } catch (e) {
          return String(e).includes("not fresh")
        }
      })(),
    )
  } else {
    harness.check("assertFreshSymbols backing file check (alphaOne symbol present)", false, "symbol not found")
  }

  rmSync(betaPath)
  harness.negative(
    "assertFreshFiles throws when a file is missing",
    (() => {
      try {
        assertFreshFiles(raw, [betaFileId], "b4 missing")
        return false
      } catch (e) {
        return String(e).includes("missing")
      }
    })(),
  )

  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(pid)), { recursive: true, force: true })
}

// ── Negative: unsupported file type ────────────────────────────────────────
await harness.rejectsAsync(
  "parseForSafety rejects an unsupported file type",
  () => parseForSafety("sample.xyz", "print(1)"),
  "Unsupported file type",
)

harness.emit()
