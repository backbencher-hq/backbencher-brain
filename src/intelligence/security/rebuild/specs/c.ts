// M72 — C security spec (lane A, specs-a).
//
// WHAT THIS FILE IS — lexical source/sink rules for C. A rule is a RegExp over
// the spec-masked symbol body (comments/strings blanked), plus the semantic
// fields the flow engine needs: which argument must be dynamic and which
// sanitizer form makes the sink safe.
//
// CONVENTIONS — a sink pattern ends at the callee's opening paren; the flow
// engine balances brackets from there and reads the argument text. Sources and
// sinks stay distinct call/value shapes so self-pair rejection is testable.
// Limits are rendered in the answer and must stay honest.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "c",
  tier: "leads",
  tierReason: "C lexical rules only: no pointer/alias data flow, so a match is a lead to validate.",
  lexical: {
    lineComments: ["//"],
    blockComments: [["/*", "*/"]],
    strings: [
      { delimiter: '"', escape: "\\" },
      { delimiter: "'", escape: "\\" },
    ],
  },
  sources: [
    {
      id: "c.source.getenv",
      pattern: /\bgetenv\s*\(/,
      sourceType: "env",
      description: "getenv reads a caller-controlled environment variable",
    },
    {
      id: "c.source.argv",
      pattern: /\bargv\s*\[/,
      sourceType: "argv",
      description: "argv element — command-line input chosen by the caller",
    },
    {
      id: "c.source.stdio_read",
      pattern: /\b(?:gets|fgets|scanf|fscanf|sscanf|getline|read)\s*\(/,
      sourceType: "user_input",
      description: "stdio read into a buffer — attacker-controlled input",
    },
    {
      id: "c.source.recv",
      pattern: /\brecv(?:from)?\s*\(/,
      sourceType: "network",
      description: "socket receive — network input",
    },
    {
      id: "c.source.fread",
      pattern: /\bfread\s*\(/,
      sourceType: "file",
      description: "file read — contents are data, not code, but untrusted relative to the process",
    },
  ],
  sinks: [
    {
      id: "c.sink.system",
      pattern: /\bsystem\s*\(/,
      vulnerability: "command_injection",
      sinkType: "shell_command",
      severity: "high",
      argument: "first",
      description: "system() passes its string to the shell",
    },
    {
      id: "c.sink.popen",
      pattern: /\bpopen\s*\(/,
      vulnerability: "command_injection",
      sinkType: "shell_command",
      severity: "high",
      argument: "first",
      description: "popen() passes its string to the shell",
    },
    {
      id: "c.sink.exec_family",
      pattern: /\bexec(?:l|v)[a-z]*\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "all",
      description: "exec*(2) family launches a program built from its arguments",
    },
    {
      id: "c.sink.sql_exec",
      pattern: /\b(?:mysql_query|PQexec|sqlite3_exec)\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "database_exec",
      severity: "high",
      argument: "all",
      description: "client-library call that executes a SQL string",
    },
    {
      id: "c.sink.path_open",
      pattern: /\b(?:fopen|open|fopen64|remove|unlink|rename)\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_operation",
      severity: "medium",
      argument: "first",
      description: "file operation on a path argument",
    },
    {
      id: "c.sink.dlopen",
      pattern: /\bdlopen\s*\(/,
      vulnerability: "code_injection",
      sinkType: "dynamic_library_load",
      severity: "high",
      argument: "first",
      description: "dlopen loads a library from a path",
    },
    {
      id: "c.sink.curl_setopt",
      pattern: /\bcurl_easy_setopt\s*\(/,
      vulnerability: "ssrf",
      sinkType: "outbound_http",
      severity: "medium",
      argument: "all",
      description: "libcurl option set — a CURLOPT_URL built from input is server-side request forgery",
    },
    {
      id: "c.sink.weak_crypto",
      pattern: /\b(?:MD5_Init|SHA1_Init|DES_set_key|RC4_set_key)\s*\(/,
      vulnerability: "weak_crypto",
      sinkType: "crypto_primitive",
      severity: "medium",
      argument: "first",
      description: "OpenSSL primitive for MD5/SHA-1/DES/RC4 — broken for security use",
    },
  ],
  sanitizers: [
    {
      id: "c.sanitizer.prepared_statement",
      vulnerability: "sql_injection",
      pattern: /\b(?:mysql_stmt_prepare|PQprepare|sqlite3_prepare(?:_v2|_v3)?)\s*\(/,
      rationale: "prepared statement — the SQL structure is fixed and values are bound separately",
    },
    {
      id: "c.sanitizer.bind_params",
      vulnerability: "sql_injection",
      pattern: /\b(?:PQexecParams|mysql_stmt_bind_param|sqlite3_bind_\w+)\s*\(/,
      rationale: "bound parameters rather than concatenated SQL text",
    },
    {
      id: "c.sanitizer.sql_dollar_placeholder",
      vulnerability: "sql_injection",
      pattern: /\$\d+\b/,
      rationale: "positional placeholder ($1) in the SQL text — values are bound, not interpolated",
    },
    {
      id: "c.sanitizer.sql_question_placeholder",
      vulnerability: "sql_injection",
      pattern: /\?\s*(?:["']|,|\)|$)/m,
      rationale: "? placeholder in the SQL text — values are bound, not interpolated",
    },
  ],
  limits: [
    "no pointer, alias or struct-field data flow — a value copied through a struct is not followed",
    "macros and generated code are invisible; a macro that wraps system()/SQL is not modelled",
    "argv element semantics are not tracked: any argv read is treated as attacker-controlled",
    "no interprocedural flow: helper functions that call system() are only leads at their own symbols",
    "format-string bugs are not a vulnerability family in this engine",
  ],
}
