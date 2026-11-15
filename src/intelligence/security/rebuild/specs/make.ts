// M72 Phase 2c — Makefile security spec (lane: build tooling). DATA only:
// lexical syntax plus source/sink/sanitizer rules; the rebuild engine
// (matcher + flow) decides whether a sink becomes a lead.
// Frozen contract: ../spec-types.ts.
//
// WHY THIS EXISTS
//   `make` was tier=unsupported with the reason "build recipes are shell text; make
//   is not parsed as an execution context". That was WRONG and is corrected here.
//   The production parser emits a `function` symbol per recipe whose body is real
//   shell, so a recipe can carry `$(VAR)` -> `sh -c` and that is command
//   injection. Verified body extraction (parseFile on a temp Makefile):
//
//     module Makefile (1-6), constant CMD (1-2), function run (2-6)
//     run body: "run:\n\t@echo \"$(CMD)\"\n\tsh -c \"$(CMD)\"\n"
//
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/COVERAGE.md (the measured
//   per-language coverage table), validation/m72/fixtures/make/.
// CONTRACTS IT MUST NOT BREAK — make has no comment-only or string masking in the
//   usual sense: `#` is a comment, and recipe lines start with TAB. A recipe line
//   is the executable unit; variable *assignments* outside recipes are data.
//   `make` stays tier=leads: a lead is not a finding.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "make",
  tier: "leads",
  tierReason:
    "Make recipes are real shell commands and recipe bodies are extracted as function symbols, so a make-variable reaching a shell/eval sink is a lead to validate; there is no interprocedural reachability and no sanitizer API.",
  lexical: {
    // `make` comments start with `#`; recipes are TAB-indented. No block comments
    // and no string delimiters (make has no string literal syntax of its own).
    lineComments: ["#"],
    blockComments: [],
    strings: [],
  },
  sources: [
    {
      id: "make.var_expansion",
      pattern: /\$\((?:[A-Za-z_][\w.-]*)\)|\$\{[A-Za-z_][\w.-]*\}/,
      sourceType: "user_input",
      description: "a make-variable expansion ($(VAR) / ${VAR}) — from the environment, a command-line override, or an included file",
    },
    {
      id: "make.env_import",
      pattern: /^\s*(?:export|unexport)\s+[A-Za-z_]/m,
      sourceType: "env",
      description: "an exported variable inherited from the invoking environment",
    },
    {
      id: "make.shell_function",
      pattern: /\$\((?:shell|wildcard)\s+/,
      sourceType: "user_input",
      description: "$(shell ...) / $(wildcard ...) run at parse time and return their output as text",
    },
  ],
  sinks: [
    {
      id: "make.cmd.shell_dash_c",
      pattern: /\b(?:sh|bash|zsh|dash|ksh)\s+-c\b/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "critical",
      argument: "any",
      description: "a shell -c invocation inside a recipe — the command string is executed by the shell",
    },
    {
      id: "make.cmd.eval",
      pattern: /\beval\s+/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "critical",
      argument: "any",
      description: "make's $(eval ...) or shell eval of a dynamic string",
    },
    {
      id: "make.cmd.exec",
      pattern: /^\s*(?:exec)\s+/m,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "critical",
      argument: "any",
      description: "a recipe line that execs a command",
    },
    {
      id: "make.cmd.recursive_make",
      pattern: /\$\((?:MAKE|MAKE)\s*\)|\bmake\s+-C\b/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "any",
      description: "recursive make ($(MAKE) / make -C) — a target name that reaches the command line is a command-injection vector",
    },
    {
      id: "make.cmd.curl_wget",
      pattern: /\b(?:curl|wget)\s+/,
      vulnerability: "ssrf",
      sinkType: "http_request",
      severity: "high",
      argument: "any",
      description: "a downloader in a recipe whose URL is variable-influenced",
    },
  ],
  sanitizers: [
    {
      // MEASURED DEFECT THIS RULE HAD: the pattern also matched double-quoted spans
      // (`"$(CMD)"`), which in shell DO expand `$(...)`. Treating them as safe
      // suppressed the primary make command-injection shape: a recipe line
      // `sh -c "$(CMD)"` was rejected as `sanitized` and produced no lead.
      // Only SINGLE quotes suppress expansion, so only they are a sanitizer here.
      id: "make.sanitizer.single_quoted",
      vulnerability: "command_injection",
      pattern: /'[^'$`\\]*'/,
      rationale: "a single-quoted shell word suppresses variable and command substitution, so a single-quoted constant is not a dynamic command; double quotes DO expand and are deliberately not a sanitizer",
    },
  ],
  limits: [
    "no interprocedural flow: a variable set in one included .mk file and used in a recipe in another is not connected",
    "make's own functions ($(subst), $(patsubst)) are not modelled as transformations; a value that passes through them is still treated as the source value",
    "recipe lines are matched as text; line continuations (`\`) are not joined, so a command split across lines may be missed",
    "$(shell ...) is treated as a source, not a sink, so its *argument* being dynamic is not itself a lead",
  ],
}