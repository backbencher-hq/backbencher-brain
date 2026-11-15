// M72 — Elixir security spec (lane A, specs-a).
//
// WHAT THIS FILE IS — lexical source/sink rules for Elixir. A rule is a RegExp
// over the spec-masked symbol body plus the fields the flow engine needs.
//
// CONVENTIONS — a sink pattern ends at the callee's opening paren; the flow
// engine balances brackets and reads the argument text. Sanitizers are evaluated
// against the original (unmasked) call text, so `$1` placeholders inside a
// Repo.query string are visible.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "elixir",
  tier: "leads",
  tierReason: "Elixir lexical rules only: no BEAM data-flow proof, so a match is a lead to validate.",
  lexical: {
    lineComments: ["#"],
    // Elixir has no block-comment syntax (only # line comments).
    blockComments: [],
    // Heredocs are listed before plain quotes. Sigils (~s/~r/~w…) are not
    // masked by this model; see limits.
    strings: [
      { delimiter: '"""', escape: "\\", multiline: true },
      { delimiter: "'''", escape: "\\", multiline: true },
      { delimiter: '"', escape: "\\" },
      { delimiter: "'", escape: "\\" },
    ],
  },
  sources: [
    {
      id: "elixir.source.get-env",
      pattern: /\bSystem\.get_env\s*\(/,
      sourceType: "env",
      description: "System.get_env reads a process environment variable",
    },
    {
      id: "elixir.source.argv",
      pattern: /\bSystem\.argv\s*\(/,
      sourceType: "cli",
      description: "System.argv returns command-line arguments",
    },
    {
      id: "elixir.source.io-read",
      pattern: /\bIO\.(?:gets|read|binread)\s*\(/,
      sourceType: "user_input",
      description: "IO.gets/read reads stdin",
    },
    {
      id: "elixir.source.conn-params",
      pattern: /\bconn\.(?:params|query_params|body_params|path_params)\b/,
      sourceType: "user_input",
      description: "Plug.Conn params carry client input",
    },
    {
      id: "elixir.source.file-read",
      pattern: /\bFile\.read!\s*\(/,
      sourceType: "file",
      description: "File.read! reads file content",
    },
  ],
  sinks: [
    {
      id: "elixir.sink.system-cmd",
      pattern: /\bSystem\.cmd\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "all",
      description: "System.cmd launches an executable from its argv list",
    },
    {
      id: "elixir.sink.port-open",
      pattern: /\bPort\.open\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "all",
      description: "Port.open spawns an external program or port program",
    },
    {
      id: "elixir.sink.repo-query",
      pattern: /\b(?:Ecto\.Adapters\.SQL|Repo|repo)\.query\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "database_exec",
      severity: "high",
      argument: "all",
      description: "raw SQL execution through Repo/Ecto.Adapters.SQL",
    },
    {
      id: "elixir.sink.code-eval",
      pattern: /\bCode\.(?:eval_string|eval_file|eval_quoted|compile_string)\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "high",
      argument: "first",
      description: "Code.eval_* compiles and runs source text",
    },
    {
      id: "elixir.sink.binary-to-term",
      pattern: /\b:erlang\.binary_to_term\s*\(/,
      vulnerability: "insecure_deserialization",
      sinkType: "deserialization",
      severity: "high",
      argument: "first",
      description: ":erlang.binary_to_term on untrusted bytes can construct arbitrary terms",
    },
    {
      id: "elixir.sink.file-path",
      pattern: /\bFile\.(?:read!|write!|rm!|cp!|rename!|stream!)\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_operation",
      severity: "medium",
      argument: "first",
      description: "file operation on a runtime path",
    },
    {
      id: "elixir.sink.raw-html",
      pattern: /\b(?:Phoenix\.HTML\.)?raw\s*\(/,
      vulnerability: "xss",
      sinkType: "html_output",
      severity: "high",
      argument: "first",
      description: "Phoenix.HTML.raw marks content as already-safe HTML (no escaping)",
    },
    {
      id: "elixir.sink.outbound-http",
      pattern: /\b(?:HTTPoison|Req|Finch|Tesla)\.(?:get|post|request|get!)\s*\(/,
      vulnerability: "ssrf",
      sinkType: "outbound_http",
      severity: "medium",
      argument: "all",
      description: "outbound HTTP request — a URL from input is server-side request forgery",
    },
    {
      id: "elixir.sink.weak-crypto",
      pattern: /\b:crypto\.hash\s*\(\s*:(?:md5|sha)\b/,
      vulnerability: "weak_crypto",
      sinkType: "crypto_primitive",
      severity: "medium",
      argument: "first",
      description: ":crypto.hash with :md5/:sha1-ish atom — broken for security use",
    },
  ],
  sanitizers: [
    {
      id: "elixir.sanitizer.repository-params",
      vulnerability: "sql_injection",
      pattern: /\b(?:Repo|repo)\.query\s*\([^)\n]*,\s*\[/,
      rationale: "Repo.query with an explicit params list — values are bound, not interpolated",
    },
    {
      id: "elixir.sanitizer.ecto-query-macro",
      vulnerability: "sql_injection",
      pattern: /\(\s*from\s+[a-zA-Z_][a-zA-Z0-9_]*\s+in\b/,
      rationale: "Ecto `from … in` query macro parameterizes the query",
    },
    {
      id: "elixir.sanitizer.sql-dollar-placeholder",
      vulnerability: "sql_injection",
      pattern: /\$\d+\b/,
      rationale: "positional placeholder ($1) in the SQL text — values are bound, not interpolated",
    },
    {
      id: "elixir.sanitizer.html-escape",
      vulnerability: "xss",
      pattern: /\b(?:Phoenix\.HTML\.)?html_escape\s*\(/,
      rationale: "html_escape encodes content before HTML emission",
    },
  ],
  limits: [
    "sigils (~s, ~r, ~w, custom) are not masked and not modelled",
    "macros (Ecto, Phoenix) are not expanded; only their call shapes are matched",
    "no interprocedural flow: helper functions that call the sink are only leads at their own symbols",
    "Phoenix templates (.heex/.eex) are not analysed by this spec",
    "only common HTTP-client module names are matched (a wrapper module is missed)",
  ],
}
