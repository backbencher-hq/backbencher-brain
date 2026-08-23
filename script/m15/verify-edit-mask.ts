// script/m15/verify-edit-mask.ts — M15.E3
// Per-language comment/string masking adversary fixtures.
// Prove buildSyntaxMask + collectMaskedRanges correctly mask comments/strings
// AND re-expose interpolation code across 20+ languages.

import { writeFileSync } from "node:fs"
import path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { buildSyntaxMask, parseForSafety } from "../../src/ast/safety-primitives"

let checks = 0, passed = 0, failed = 0, negatives = 0, negativePassed = 0
function ck(l: string, c: boolean, d?: string) { checks++; if (c) passed++; else { failed++; console.log("  FAIL: " + l + (d ? " — " + d : "")) } }
function nk(l: string, c: boolean, d?: string) { negatives++; if (c) negativePassed++; else { failed++; console.log("  FAIL: " + l + " (negative)" + (d ? " — " + d : "")) } }
function emit() {
  const total = passed + negativePassed
  const v = failed === 0 ? "VERIFIED" : "KNOWN-GAP"
  const e = { issue: "M15.E3", code: "E3", tool: "bb_edit", verified: failed === 0, checks: checks, passed: total, failed: failed, negatives: negatives, generatedAt: new Date().toISOString() }
  writeFileSync(path.resolve("validation/m15/results/e3.json"), JSON.stringify(e, null, 2) + "\n")
  console.log("\nE3: " + v + " (" + total + "/" + checks + " passed, " + negatives + " negatives)")
  process.exit(failed > 0 ? 1 : 0)
}

// Helper: verify that `code` inside a fixture has the `name` identifier at mask[idx]==1 or 0
async function verifyMask(lang: string, ext: string, code: string, name: string, shouldBeLive: boolean) {
  try {
    const p = await parseForSafety(lang + "." + ext, code)
    const idx = p.content.indexOf(name)
    if (idx < 0) { ck(lang + ": '" + name + "' found in content", false, "not found"); return }
    const maskVal = p.mask[idx]
    ck(lang + ": '" + name + "' mask=" + maskVal + " (expect " + (shouldBeLive ? "1" : "0") + ")",
       maskVal === (shouldBeLive ? 1 : 0),
       "code=\"" + p.content.substring(Math.max(0,idx-10), idx+name.length+10).replace(/\n/g,"\\n") + "\"")
  } catch (e: any) {
    ck(lang + ": parse succeeds", false, e.message?.slice(0, 80))
  }
}

(async () => {
  // ═══════════════════════════════════════════════════════════════════════
  // 1. Comments masked — per language comment syntax
  // ═══════════════════════════════════════════════════════════════════════

  const commentMaskFixtures: Array<[string, string, string, string]> = [
    ["TypeScript", "ts", "// target in comment\nconst x = 1", "target"],
    ["Python", "py", "# target in comment\nx = 1", "target"],
    ["Ruby", "rb", "# target in comment\nx = 1", "target"],
    ["Rust", "rs", "// target in comment\nlet x = 1;", "target"],
    ["Java", "java", "class X{}// target in comment", "target"],
    ["Go", "go", "package p\n// target in comment", "target"],
    ["Haskell", "hs", "-- target in comment\nx = 1", "target"],
    ["Lua", "lua", "-- target in comment\nx = 1", "target"],
    ["Bash", "sh", "# target in comment", "target"],
    ["SQL", "sql", "-- target in comment", "target"],
    ["Perl", "pl", "# target in comment", "target"],
    ["Elixir", "ex", "# target in comment", "target"],
    ["Clojure", "clj", "; target in comment", "target"],
    ["Erlang", "erl", "% target in comment", "target"],
    ["PHP", "php", "<?php\n// target in comment", "target"],
    ["PowerShell", "ps1", "# target in comment", "target"],
    ["YAML", "yaml", "# target in comment", "target"],
    ["Dart", "dart", "// target in comment", "target"],
    ["Swift", "swift", "// target in comment", "target"],
    ["Kotlin", "kt", "// target in comment", "target"],
    ["C#", "cs", "// target in comment", "target"],
    ["F#", "fs", "// target in comment", "target"],
    ["Zig", "zig", "// target in comment", "target"],
  ]

  for (const [lang, ext, code, name] of commentMaskFixtures) {
    await verifyMask(lang, ext, code, name, false) // comments must be masked (mask=0)
  }

  // Block comments
  for (const [lang, ext, code, name] of [
    ["TypeScript", "ts", "/* target in block */\nconst x = 1", "target"],
    ["Rust", "rs", "/* target in block */\nlet x = 1;", "target"],
    ["Java", "java", "/* target */ class X{}", "target"],
    ["Go", "go", "package p\n/* target */", "target"],
    ["Haskell", "hs", "{- target in block -}\nx = 1", "target"],
    ["Lua", "lua", "--[[ target in block ]]\nx = 1", "target"],
    ["SQL", "sql", "/* target in block */", "target"],
    ["HTML", "html", "<!-- target in block -->", "target"],
    ["PowerShell", "ps1", "<# target in block #>", "target"],
    ["F#", "fs", "(* target in block *)", "target"],
  ]) {
    await verifyMask(lang, ext, code, name, false)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. String literals masked — per language string syntax
  // ═══════════════════════════════════════════════════════════════════════

  for (const [lang, ext, code, name] of [
    ["TypeScript", "ts", 'const s = "target in string"', "target"],
    ["Python", "py", 'x = "target in string"', "target"],
    ["Ruby", "rb", 'x = "target in string"', "target"],
    ["Rust", "rs", 'let s = "target in string";', "target"],
    ["Java", "java", 'class X{String s="target in string";}', "target"],
    ["Go", "go", 'package p\nvar s = "target in string"', "target"],
    ["Haskell", "hs", 'x = "target in string"', "target"],
    ["Lua", "lua", 'x = "target in string"', "target"],
    ["Elixir", "ex", 'x = "target in string"', "target"],
    ["Dart", "dart", 'var s = "target in string";', "target"],
    ["Swift", "swift", 'let s = "target in string"', "target"],
    ["Kotlin", "kt", 'val s = "target in string"', "target"],
    ["C#", "cs", 'var s = "target in string";', "target"],
    ["Zig", "zig", 'const s = "target in string";', "target"],
  ]) {
    await verifyMask(lang, ext, code, name, false) // strings must be masked (mask=0)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Interpolation code re-exposed as LIVE (mask=1)
  // ═══════════════════════════════════════════════════════════════════════

  for (const [lang, ext, code, name] of [
    ["TypeScript", "ts", "const s = `hello ${target()}`", "target"],
    ["Python", "py", 'x = f"hello {target()}"', "target"],
    ["Ruby", "rb", 'x = "hello #{target()}"', "target"],
  ]) {
    await verifyMask(lang, ext, code, name, true) // interpolation must be LIVE (mask=1)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Adversaries — code must NOT be masked
  // ═══════════════════════════════════════════════════════════════════════

  for (const [lang, ext, code, name] of [
    ["TypeScript", "ts", "const target = 1", "target"],
    ["Python", "py", "target = 1", "target"],
    ["Rust", "rs", "let target = 1;", "target"],
    ["Go", "go", "package p\nvar target = 1", "target"],
  ]) {
    await verifyMask(lang, ext, code, name, true) // normal code must be LIVE (mask=1)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Adversary: comment syntax inside strings is still string (masked)
  // ═══════════════════════════════════════════════════════════════════════

  {
    const p = await parseForSafety("a.ts", 'const s = "// target in string"')
    const idx = p.content.indexOf("target")
    ck("TS: 'target' inside string that looks like comment is masked (mask=0)",
       idx >= 0 && p.mask[idx] === 0)
  }
  {
    const p = await parseForSafety("a.py", 'x = "# target in string"')
    const idx = p.content.indexOf("target")
    ck("Python: 'target' inside string that looks like # comment is masked",
       idx >= 0 && p.mask[idx] === 0)
  }

  // ── Adversary: code after comment must be live ──
  {
    const p = await parseForSafety("a.ts", "// comment\nconst target = 1")
    const idx = p.content.indexOf("target")
    nk("mask: code AFTER comment is live (mask=1)",
       idx >= 0 && p.mask[idx] === 1)
  }

  emit()
})()