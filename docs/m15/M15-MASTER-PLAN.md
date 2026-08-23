# M15: Tool Deep Audit — Master Plan

## Milestone

- **GitHub:** https://github.com/backbencher-hq/backbencher-brain/milestone/15
- **ID:** #15 (#17430911)
- **Issues:** 78 (6 cross-cutting + 8 complex tools × 8 + 2 simple tools × 4)

## Scope

Every classification path, regex, substring rule, and cross-language assumption across **32 source files (6,102 lines)** is audited line-by-line with per-language adversary fixtures.

## Issue Groups

| Code | Tool | Lines | Issues |
|------|------|-------|--------|
| C1-C6 | Cross-cutting | 1,500+ | 6 |
| E1-E8 | bb_edit | 425 | 8 |
| S1-S8 | bb_search | 872 | 8 |
| A1-A8 | bb_ask | 693 | 8 |
| H1-H8 | bb_health | 181 | 8 |
| P1-P8 | bb_patterns | 340 | 8 |
| X1-X8 | bb_security | 238 | 8 |
| D1-D8 | bb_doc | 320 | 8 |
| N1-N8 | bb_analyze | 693 | 8 |
| V1-V4 | bb_visualize | 63 | 4 |
| M1-M4 | bb_migrate | 41 | 4 |

## Per-Issue Protocol

Every issue follows this template:

### Title format
`M15.[CODE] tool: [specific concern]`

### Body
```
## Scope
[file:line-range] — [what's being audited]

## Acceptance
- [ ] [specific check]: [what must be true]
- [ ] [specific check]: [what must be true]

## Closure Requirements
1. All acceptance checkboxes ticked
2. `npm run typecheck` passes
3. All existing M13 verifiers for this tool pass (zero regressions)
4. Evidence written to `validation/m15/results/[code].json`
5. Quality gate includes this verifier and passes
6. Tool doc regenerated and committed if changed
```

### Evidence schema
```json
{
  "issue": "M15.[CODE]",
  "code": "[CODE]",
  "tool": "[tool name]",
  "verified": true,
  "checks": [{ "name": "...", "pass": true, "detail": "..." }],
  "negatives": 0,
  "adversaries": [{ "language": "...", "fixture": "...", "expected": "...", "actual": "..." }],
  "generatedAt": "ISO8601"
}
```

## Attack Priority

1. **C4: Safety primitives** — shared foundation for all tools. Fix here cascades.
2. **E1-E8: bb_edit** — only destructive tool. Most dangerous.
3. **C1-C3: Contracts + registry + handlers** — boundary enforcement.
4. **S1-S8: bb_search** — most complex (872 lines, 5 files).
5. **N1-N8: bb_analyze** — similar complexity to search (693 lines, 6 files).
6. **A1-A8: bb_ask** — same (693 lines).
7. **D1-D8: bb_doc** — 320 lines.
8. **P1-P8: bb_patterns** — 340 lines.
9. **X1-X8: bb_security** — 238 lines.
10. **H1-H8: bb_health** — 181 lines.
11. **V1-V4: bb_visualize** — 63 lines.
12. **M1-M4: bb_migrate** — 41 lines.
13. **C5: Global real-repo matrix** — all 29+ repos, all tools, all modes.
14. **C6: Language coverage + closure** — 40+ languages proven, milestone closed.

## Gate Wiring

After each issue group, wire the verifier into:
- `script/verify-quality-gate.ts` — add to `M15_VERIFIERS` array
- `package.json` — add to `verify:m15` script

### Quality gate additions
```ts
const M15_VERIFIERS = [
  { code: "C4", script: "script/m15/verify-safety-primitives.ts" },
  { code: "E1", script: "script/m15/verify-edit-classification.ts" },
  // ... added incrementally
]
```

## Real Repositories

Available in `$HOME/fixtures/repositories/` (29 repos, 20+ languages):

| Language | Repos |
|----------|-------|
| TypeScript | graphql-js, svelte, vue-core, element-plus, TypeScript, VSCode |
| Python | cython, dplyr |
| Ruby | rake |
| Go | go-tools |
| Rust | cargo |
| Java | grails-core |
| Scala | scala3 |
| Kotlin | (needs cloning) |
| C# | fsharp (C# files) |
| C++ | (needs cloning) |
| C | (needs cloning) |
| Haskell | cabal |
| Elixir | elixir |
| Clojure | clojure |
| Erlang | rebar3 |
| Lua | luarocks |
| PHP | phpunit |
| PowerShell | powershell |
| Zig | zig |
| Swift | swift-nio |
| F# | fsharp |
| Clean | clean-stdlib, tree-sitter-clean |
| HCL | terraform |
| R | dplyr (partial) |
| SQL | (needs cloning) |
| Groovy | grails-core |
| Dart | (needs cloning) |
| Perl | (needs cloning) |
| Bash | (needs cloning) |
| Objective-C | (needs cloning) |
| Mojo | mojo |
| YAML | (config files) |
| JSON | (config files) |
| HTML/CSS | element-plus, vue-core, svelte |
| XML | (needs cloning) |
| Markdown | (docs) |
| Make | (needs cloning) |

Additional repos in `$HOME/`: TypeScript, VSCode, openclaw, paperclip, proxicall.

Gap languages needing fresh clones: Kotlin, C++, C, Dart, Perl, Bash, Objective-C, SQL, XML, Make.

## No-Go Rules

1. **Failures block progress.** An issue with a failing test cannot be closed with "documented limitation."
2. **Genuinely stuck?** Comment on the issue explaining the obstruction. Leave it open. Come back.
3. **No silent regex substitution.** Every regex must be justified or replaced with tree-sitter.
4. **No substring-matching false positives.** Every `t.includes`/`t.endsWith` must be proven correct with adversary fixtures.
5. **No hidden O(n²).** Every nested loop must be measured or justified.