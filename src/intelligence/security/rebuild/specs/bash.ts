// M72 — bash security spec (lane A, specs-a).
//
// WHAT THIS FILE IS — lexical source/sink rules for shell scripts. A rule is a
// RegExp over the spec-masked symbol text (comments and strings blanked), plus
// the semantic fields the flow engine needs: which argument must be dynamic and
// which sanitizer/escape form makes the sink safe.
//
// CONVENTIONS (shared with every lane-A spec):
//   • A sink pattern ends at the callee's opening paren — the flow engine reads
//     the argument text from the match end. Never match the arguments.
//   • Sources and sinks are distinct call/value shapes so the engine's
//     self-pair rejection is testable.
//   • `limits` records what these lexical rules cannot see; it is rendered in
//     the answer and must stay honest.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "bash",
  tier: "leads",
  tierReason: "Shell lexical rules only: no shell data-flow proof, so a match is a lead to validate.",
  // Shell comments run from an unquoted '#' to end of line. Single quotes take
  // no escapes; double quotes honour backslash escapes. Backtick command
  // substitution and $() are CODE, not strings, and are deliberately not masked.
  lexical: {
    lineComments: ["#"],
    blockComments: [],
    strings: [{ delimiter: "'" }, { delimiter: '"', escape: "\\" }],
  },
  sources: [
    {
      id: "bash.source.positional",
      pattern: /\$\{?[1-9][0-9]*\}?|\$\{?[@*]\}?/,
      sourceType: "cli",
      description: "positional argument or the full argument vector ($1, $@, $*) — caller controlled",
    },
    {
      id: "bash.source.env",
      pattern: /\$\{?[A-Z_][A-Z0-9_]*\}?/,
      sourceType: "env",
      description: "environment variable ($HOME-style name) — inherited from the caller's environment",
    },
    {
      id: "bash.source.read",
      pattern: /\bread\s+(?:-[a-zA-Z]+\s+)*[A-Za-z_][A-Za-z0-9_]*/,
      sourceType: "user_input",
      description: "read builtin binding a variable from stdin — externally supplied input",
      captureVariable: true,
    },
    {
      id: "bash.source.http",
      pattern: /\b(?:curl|wget)\s+/,
      sourceType: "network",
      description: "curl/wget fetches remote content — the response body is attacker-influenced",
    },
  ],
  sinks: [
    {
      id: "bash.sink.eval",
      pattern: /\beval\s+/,
      vulnerability: "code_injection",
      sinkType: "shell_eval",
      severity: "high",
      argument: "any",
      description: "eval re-parses its arguments as shell code",
    },
    {
      id: "bash.sink.shell_dash_c",
      pattern: /\b(?:bash|sh|zsh|ksh|dash)\s+(?:-[a-zA-Z]+\s+)*-[cC]\s+/,
      vulnerability: "command_injection",
      sinkType: "shell_command",
      severity: "high",
      argument: "any",
      description: "sh -c (bash -c) interprets its command string as shell",
    },
    {
      id: "bash.sink.command_substitution",
      pattern: /\$\(/,
      vulnerability: "code_injection",
      sinkType: "shell_command_substitution",
      severity: "high",
      argument: "all",
      description: "command substitution executes its contents as a shell command",
    },
    {
      id: "bash.sink.exec",
      pattern: /\bexec\s+/,
      vulnerability: "command_injection",
      sinkType: "shell_exec",
      severity: "high",
      argument: "any",
      description: "exec replaces the shell with a command built from its arguments",
    },
    {
      id: "bash.sink.source",
      pattern: /\b(?:source|\.)\s+[A-Za-z_$\/.]/,
      vulnerability: "code_injection",
      sinkType: "shell_load",
      severity: "high",
      argument: "all",
      description: "source/. evaluates another file as shell code",
    },
    {
      id: "bash.sink.sql_cli",
      pattern: /\b(?:mysql|psql|sqlite3)\s+(?:-[A-Za-z]+\s+)*-[eE]\s+/,
      vulnerability: "sql_injection",
      sinkType: "database_cli",
      severity: "high",
      argument: "any",
      description: "database CLI -e/-c executes the supplied SQL string",
    },
    {
      id: "bash.sink.redirect_path",
      pattern: /[>]{1,2}\s*"?\$\{?[A-Za-z_]/,
      vulnerability: "path_traversal",
      sinkType: "file_write",
      severity: "medium",
      argument: "any",
      description: "output redirection to a computed path",
    },
    {
      id: "bash.sink.file_op_dynamic",
      pattern: /\b(?:cat|cp|mv|rm|chmod|chown|head|tail|tee)\s+(?:-[A-Za-z]+\s+)*\$\{?[A-Za-z_]/,
      vulnerability: "path_traversal",
      sinkType: "file_operation",
      severity: "medium",
      argument: "any",
      description: "file operation on an unquoted, computed path",
    },
  ],
  sanitizers: [
    {
      id: "bash.sanitizer.printf_q",
      vulnerability: "command_injection",
      pattern: /\bprintf\s+-v\s+[A-Za-z_][A-Za-z0-9_]*\s+/,
      rationale: "printf -v with a %q format shell-quotes the value before use",
    },
    {
      id: "bash.sanitizer.printf_q_code",
      vulnerability: "code_injection",
      pattern: /\bprintf\s+-v\s+[A-Za-z_][A-Za-z0-9_]*\s+/,
      rationale: "printf -v with a %q format shell-quotes a value before eval re-parses it",
    },
    {
      id: "bash.sanitizer.case_allowlist",
      vulnerability: "command_injection",
      pattern: /\bcase\s+[^;\n]*\bin\b/,
      rationale: "case dispatch over an explicit pattern list — only if the arms are constants (manual review)",
    },
  ],
  limits: [
    "no data-flow proof: a lead is dynamic-argument proximity, not a proven path",
    "heredocs, backtick command substitution and $() bodies are not treated as strings (code is visible by design, but heredoc text is not masked)",
    "$VAR cannot be told apart from a local variable; uppercase local variables can produce env false positives",
    "word-splitting/globbing, aliases, sourced functions and function bodies are not followed",
    "quoted paths (\"$dir/$file\") are masked as strings, so dynamic path traversal inside quotes is not detected",
    "arithmetic expansion and parameter-expansion operators are not modelled",
  ],
}
