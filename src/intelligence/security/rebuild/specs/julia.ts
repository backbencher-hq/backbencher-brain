// M72 — Julia security spec (lane A, specs-a).
//
// WHAT THIS FILE IS — lexical source/sink rules for Julia. A rule is a RegExp
// over the spec-masked symbol body plus the fields the flow engine needs.
//
// CONVENTIONS — a sink pattern ends at the callee's opening paren (or the
// command-literal start); the flow engine reads the balanced argument text.
// Sources and sinks stay distinct so self-pair rejection is testable.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "julia",
  tier: "leads",
  tierReason: "Julia lexical rules only: macros are not expanded, so a match is a lead to validate.",
  lexical: {
    lineComments: ["#"],
    blockComments: [["#=", "=#"]],
    // Char literals are NOT declared: ' is the adjoint/postfix operator in
    // Julia, and masking it would swallow real code (see limits).
    strings: [
      { delimiter: '"""', escape: "\\", multiline: true },
      { delimiter: '"', escape: "\\" },
    ],
  },
  sources: [
    {
      id: "julia.source.args",
      pattern: /\bARGS\b/,
      sourceType: "cli",
      description: "ARGS holds the command-line arguments",
    },
    {
      id: "julia.source.env",
      pattern: /\bENV\s*\[/,
      sourceType: "env",
      description: "ENV dictionary holds process environment variables",
    },
    {
      id: "julia.source.readline",
      pattern: /\breadline\s*\(|\breadlines\s*\(|\beachline\s*\(/,
      sourceType: "user_input",
      description: "readline/readlines/eachline read stdin or a stream",
    },
    {
      id: "julia.source.stdin-read",
      pattern: /\bread\s*\(\s*stdin\b/,
      sourceType: "user_input",
      description: "read(stdin, …) reads attacker-controlled stdin",
    },
    {
      id: "julia.source.http",
      pattern: /\b(?:Downloads\.download|HTTP\.(?:get|post|request))\s*\(/,
      sourceType: "network",
      description: "Downloads/HTTP fetch — network content",
    },
  ],
  sinks: [
    {
      id: "julia.sink.run",
      pattern: /\brun\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "all",
      description: "run(cmd) executes an OS command",
    },
    {
      id: "julia.sink.command-literal",
      pattern: /`[^`\n]*\$[A-Za-z_]/,
      vulnerability: "command_injection",
      sinkType: "shell_command",
      severity: "medium",
      argument: "any",
      description: "backtick command literal with $interpolation — runtime text enters the command",
    },
    {
      id: "julia.sink.code-eval",
      pattern: /\beval\s*\(|\bMeta\.parse\s*\(|\binclude\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "high",
      argument: "all",
      description: "eval / Meta.parse / include evaluate source text or a runtime file",
    },
    {
      id: "julia.sink.db-execute",
      pattern: /\b(?:DBInterface|LibPQ)\.execute\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "database_exec",
      severity: "high",
      argument: "all",
      description: "DBInterface/LibPQ raw execution of a SQL string",
    },
    {
      id: "julia.sink.open-path",
      pattern: /(?<!\.)\bopen\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_operation",
      severity: "medium",
      argument: "first",
      description: "open(path) — a runtime path controls which file is opened",
    },
    {
      id: "julia.sink.deserialize",
      pattern: /\bdeserialize\s*\(/,
      vulnerability: "insecure_deserialization",
      sinkType: "deserialization",
      severity: "high",
      argument: "first",
      description: "Serialization.deserialize on untrusted bytes",
    },
    {
      id: "julia.sink.download",
      pattern: /\bDownloads\.download\s*\(/,
      vulnerability: "ssrf",
      sinkType: "outbound_http",
      severity: "medium",
      argument: "first",
      description: "Downloads.download fetches a runtime URL",
    },
  ],
  sanitizers: [
    {
      id: "julia.sanitizer.cmd-argv",
      vulnerability: "command_injection",
      pattern: /\bCmd\s*\(/,
      rationale: "Cmd([…]) builds an argv vector — run(Cmd) does not invoke a shell",
    },
    {
      id: "julia.sanitizer.db-params-vector",
      vulnerability: "sql_injection",
      pattern: /\bDBInterface\.execute\s*\([^)\n]*,\s*\[/,
      rationale: "DBInterface.execute with a params vector — values are bound, not interpolated",
    },
    {
      id: "julia.sanitizer.sql-question-placeholder",
      vulnerability: "sql_injection",
      pattern: /\?\s*(?:["']|,|\)|$)/m,
      rationale: "? placeholder in the SQL text — values are bound, not interpolated",
    },
    {
      id: "julia.sanitizer.sql-dollar-placeholder",
      vulnerability: "sql_injection",
      pattern: /\$\d+\b/,
      rationale: "positional placeholder ($1) in the SQL text — values are bound, not interpolated",
    },
  ],
  limits: [
    "char literals ('x') and the adjoint operator (A') are not masked; only double-quoted strings are",
    "macros are not expanded: a macro that wraps run/eval/db calls is invisible",
    "backtick command literals are CODE by design (not strings); only interpolated forms are rules",
    "the bare open() receiver is broad — IO-like wrapper objects can over-report path traversal",
    "no interprocedural flow: helper functions that call the sink are only leads at their own symbols",
    "Genie/HTTP.jl routing and DBConnection prepared statements beyond DBInterface names are not modelled",
  ],
}
