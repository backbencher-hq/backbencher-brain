// M72 — Erlang security spec (lane A, specs-a).
//
// WHAT THIS FILE IS — lexical source/sink rules for Erlang. A rule is a RegExp
// over the spec-masked symbol body plus the fields the flow engine needs.
//
// CONVENTIONS — a sink pattern ends at the callee's opening paren; the flow
// engine balances brackets and reads the argument text. Sanitizers are evaluated
// against the original (unmasked) call text.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "erlang",
  tier: "leads",
  tierReason: "Erlang lexical rules only: no BEAM data-flow proof, so a match is a lead to validate.",
  lexical: {
    lineComments: ["%"],
    // Erlang has no block-comment syntax.
    blockComments: [],
    // Double quotes are strings; single quotes are atoms and are masked as
    // literals too. $<char> character literals are not masked (see limits).
    strings: [
      { delimiter: '"', escape: "\\" },
      { delimiter: "'", escape: "\\" },
    ],
  },
  sources: [
    {
      id: "erlang.source.os-getenv",
      pattern: /\bos:getenv\s*\(/,
      sourceType: "env",
      description: "os:getenv reads a process environment variable",
    },
    {
      id: "erlang.source.init-arguments",
      pattern: /\binit:get_(?:plain_)?arguments?\s*\(/,
      sourceType: "cli",
      description: "init:get_arguments/get_plain_arguments return command-line arguments",
    },
    {
      id: "erlang.source.io-read",
      pattern: /\bio:(?:get_line|read|fread)\s*\(/,
      sourceType: "user_input",
      description: "io:get_line/read reads stdin or a stream",
    },
    {
      id: "erlang.source.socket-recv",
      pattern: /\bgen_(?:tcp|udp):recv\s*\(/,
      sourceType: "network",
      description: "socket receive — network input",
    },
  ],
  sinks: [
    {
      id: "erlang.sink.os-cmd",
      pattern: /\bos:cmd\s*\(/,
      vulnerability: "command_injection",
      sinkType: "shell_command",
      severity: "high",
      argument: "first",
      description: "os:cmd passes its string to the shell",
    },
    {
      id: "erlang.sink.open-port",
      pattern: /\bopen_port\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "all",
      description: "open_port spawns an external program/port program",
    },
    {
      id: "erlang.sink.sql-driver",
      pattern: /\b(?:odbc|epgsql|mysql|pgsql|pgo|sqerl):(?:sql_query|equery|query|execute)\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "database_exec",
      severity: "high",
      argument: "all",
      description: "database driver call that executes a SQL string",
    },
    {
      id: "erlang.sink.binary-to-term",
      pattern: /\berlang:binary_to_term\s*\(/,
      vulnerability: "insecure_deserialization",
      sinkType: "deserialization",
      severity: "high",
      argument: "first",
      description: "erlang:binary_to_term on untrusted bytes constructs arbitrary terms",
    },
    {
      id: "erlang.sink.apply",
      pattern: /\berlang:apply\s*\(/,
      vulnerability: "code_injection",
      sinkType: "dynamic_call",
      severity: "high",
      argument: "all",
      description: "erlang:apply dispatches a call chosen at runtime",
    },
    {
      id: "erlang.sink.file-path",
      pattern: /\bfile:(?:read_file|write_file|delete|rename|copy|open)\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_operation",
      severity: "medium",
      argument: "first",
      description: "file operation on a runtime path",
    },
    {
      id: "erlang.sink.httpc-request",
      pattern: /\bhttpc:request\s*\(/,
      vulnerability: "ssrf",
      sinkType: "outbound_http",
      severity: "medium",
      argument: "all",
      description: "inets httpc request — a URL from input is server-side request forgery",
    },
    {
      id: "erlang.sink.weak-crypto",
      pattern: /\bcrypto:hash\s*\(\s*(?:md5|sha)\b/,
      vulnerability: "weak_crypto",
      sinkType: "crypto_primitive",
      severity: "medium",
      argument: "first",
      description: "crypto:hash with md5/sha — broken for security use",
    },
  ],
  sanitizers: [
    {
      id: "erlang.sanitizer.equery-params",
      vulnerability: "sql_injection",
      pattern: /\bepgsql:equery\s*\([^)\n]*,[^)\n]*,\s*\[/,
      rationale: "epgsql:equery with a params list — values are bound, not interpolated",
    },
    {
      id: "erlang.sanitizer.param-query",
      vulnerability: "sql_injection",
      pattern: /\bodbc:param_query\s*\(/,
      rationale: "odbc:param_query binds parameters rather than concatenating SQL text",
    },
    {
      id: "erlang.sanitizer.sql-dollar-placeholder",
      vulnerability: "sql_injection",
      pattern: /\$\d+\b/,
      rationale: "positional placeholder ($1) in the SQL text — values are bound, not interpolated",
    },
  ],
  limits: [
    "character literals ($c) are not masked; a $ inside code can end masking assumptions",
    "parse transforms and behaviour dispatch are not expanded",
    "no interprocedural flow: helper functions that call the sink are only leads at their own symbols",
    "Erlang process/port message passing is not modelled",
    "web-framework HTML escaping (cowboy templates, erlydtl) is not modelled; there is no xss sink rule",
  ],
}
