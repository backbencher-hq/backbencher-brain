// Generate the two R10 php expectations from the analyzer's own measurement
// (no transcription), plus the forbids transcribed from
// script/m14/tmp/php-include-prefix-rule.ts (a measurement of the PRE-fix rule),
// so every forbid is a spelling the old code really produced.
import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const dir = path.join(ROOT, "validation/m14/fixtures/php")

const measure = async (base: string) => {
  const file = path.join(dir, `${base}.php`)
  const res: any = await ASTEngine.parseFile(file, fs.readFileSync(file, "utf8"))
  return res
}

// ---- include-paths ---------------------------------------------------------
{
  const res = await measure("include-paths")
  const imports = (res.imports ?? []).map((i: any) => ({ module: i.module, "meta.includeType": i.metadata?.includeType }))
  const rels = (res.relationships ?? []).map((r: any) => {
    const out: any = { type: r.type, from: r.source, target: r.target }
    for (const k of ["isConstRead", "isMemberRead", "isLocalRead", "isInterpolationRead", "isContained"]) {
      if (r.metadata?.[k] === true) out[`meta.${k}`] = true
    }
    return out
  })
  const exp = {
    fixtureId: "php/include-paths",
    language: "php",
    authoredBeforeAnalyzerRun: true,
    rationale:
      "R10 (#835) — the include-path spelling contract. The pre-R10 rule read the RAW TEXT of any `binary_expression` in an include/require position, so a concatenation with a runtime operand published a reconstructed EXPRESSION as the import module AND as a `references` target. Measured on phpmyadmin src/Git.php:97 (`include $this->baseDir . 'revision-info.php'`) and reproduced on this fixture by script/m14/tmp/php-include-prefix-rule.ts, which replays the OLD rule: it emitted `$this->baseDir.'/revision-info.php'`, `$dir.'/x.php'`, `{$dir}/interpolated.php` and `__DIR__.$suffix` — spellings carrying `$`, `->`, `.` and a quote that no php symbol can ever be named. The oracle derived its truth from the same rule, so BOTH sides agreed and every per-edge gate read clean; a target-spelling fixture that does not depend on the mirror is the only instrument that can hold it. The rule now requires every operand to be statically known: the six static paths below are unchanged (including `__DIR__.'/nested/'.'deeper.php'`, so the narrowing did not also narrow legitimate concatenation), and the four dynamic spellings are forbidden. `include $dir` (a bare variable) was ALREADY skipped pre-fix and is pinned here so it stays that way. The dynamic operands' own reads are still emitted — that is the point: a dynamic include loses the fabricated PATH, not the value reads.",
    expectImports: imports,
    expectRelationships: rels,
    forbidImports: [
      { module: "$this->baseDir.'/revision-info.php'", note: "pre-fix: an expression published as a module path" },
      { module: "$dir.'/x.php'", note: "pre-fix: a variable operand collapsed into a path" },
      { module: "{$dir}/interpolated.php", note: "pre-fix: an interpolated string's text used as a path" },
      { module: "__DIR__.$suffix", note: "pre-fix: a runtime suffix concatenated into a path" },
    ],
    forbidRelationships: [
      { type: "references", target: "$this->baseDir.'/revision-info.php'", note: "pre-fix: the fabricated path target, both sides" },
      { type: "references", target: "$dir.'/x.php'", note: "same" },
      { type: "references", target: "{$dir}/interpolated.php", note: "same" },
      { type: "references", target: "__DIR__.$suffix", note: "same" },
    ],
  }
  fs.writeFileSync(path.join(dir, "include-paths.expectation.json"), JSON.stringify(exp, null, 2) + "\n")
  console.log("wrote include-paths.expectation.json", JSON.stringify({ imports: imports.length, rels: rels.length }))
}

// ---- dynamic-callee --------------------------------------------------------
{
  const res = await measure("dynamic-callee")
  const rels = (res.relationships ?? []).map((r: any) => {
    const out: any = { type: r.type, from: r.source, target: r.target }
    for (const k of ["isLocalRead", "isContained"]) if (r.metadata?.[k] === true) out[`meta.${k}`] = true
    return out
  })
  const exp = {
    fixtureId: "php/dynamic-callee",
    language: "php",
    authoredBeforeAnalyzerRun: true,
    rationale:
      "R10 (#835) — the dynamic-callee spelling contract. A `calls` target is the name of a CALLEE; `$callable()` names nothing, because the callee is a runtime VALUE. The pre-R10 rule took the callee node's raw text, so the lane published `calls -> $callable` (measured in phpmyadmin's tests: `calls -> $controller` in LicenseControllerTest.php:23) — again IDENTICALLY on both sides, because the oracle's truth came from the same shape. A probe over 400 real php files (phpunit/src, phpmyadmin/src + tests) found 1,047 `name` callees and `variable_name` the ONLY non-name shape reaching the rule (1 site), so this narrows a fabrication rather than a capability. What the call EVALUATES is still read, and that read is the variable pass's `uses` edge — the fix adds the honest edge's owner and removes the fabricated name in the same move, which is why the fixture requires both halves: `uses -> handler` MUST be present and `calls -> handler` MUST be absent, while a named callee in the same method (`$this->run(...)`) still emits its `calls` edge.",
    expectRelationships: rels,
    forbidRelationships: [
      { type: "calls", target: "handler", note: "the fabricated callee name (pre-fix: raw callee text, from \"$handler\")" },
      { type: "calls", target: "$handler", note: "and not the sigil spelling either" },
    ],
  }
  fs.writeFileSync(path.join(dir, "dynamic-callee.expectation.json"), JSON.stringify(exp, null, 2) + "\n")
  console.log("wrote dynamic-callee.expectation.json", JSON.stringify({ rels: rels.length }))
}
