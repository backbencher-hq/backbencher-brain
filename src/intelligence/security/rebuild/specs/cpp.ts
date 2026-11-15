// M72 — C++ security spec (lane A, specs-a).
//
// WHAT THIS FILE IS — lexical source/sink rules for C++. Same shape as the C
// spec but with the std:: spellings and the C++ IO objects.
//
// CONVENTIONS — sink patterns end at the callee's opening paren; the flow engine
// balances brackets and reads the argument text. Limits are rendered in the answer.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "cpp",
  tier: "leads",
  tierReason: "C++ lexical rules only: no template/alias data flow, so a match is a lead to validate.",
  lexical: {
    lineComments: ["//"],
    blockComments: [["/*", "*/"]],
    // Raw string literals R"(...)" are not masked by this delimiter model
    // (they need a paired )" terminator); see limits.
    strings: [
      { delimiter: '"', escape: "\\" },
      { delimiter: "'", escape: "\\" },
    ],
  },
  sources: [
    {
      id: "cpp.source.getenv",
      pattern: /\b(?:std::)?getenv\s*\(/,
      sourceType: "env",
      description: "getenv reads a caller-controlled environment variable",
    },
    {
      id: "cpp.source.argv",
      pattern: /\bargv\s*\[/,
      sourceType: "argv",
      description: "argv element — command-line input chosen by the caller",
    },
    {
      id: "cpp.source.stdin-getline",
      pattern: /\bstd::getline\s*\(\s*std::cin\b/,
      sourceType: "user_input",
      description: "std::getline(std::cin, …) reads attacker-controlled stdin",
    },
    {
      id: "cpp.source.cin",
      pattern: /\bstd::cin\s*>>/,
      sourceType: "user_input",
      description: "std::cin extraction reads attacker-controlled stdin",
    },
    {
      id: "cpp.source.recv",
      pattern: /\brecv(?:from)?\s*\(/,
      sourceType: "network",
      description: "socket receive — network input",
    },
    {
      id: "cpp.source.ifstream",
      pattern: /\bstd::ifstream\s+\w+\s*\(/,
      sourceType: "file",
      description: "std::ifstream opens a file for reading",
    },
  ],
  sinks: [
    {
      id: "cpp.sink.system",
      pattern: /\bstd::system\s*\(/,
      vulnerability: "command_injection",
      sinkType: "shell_command",
      severity: "high",
      argument: "first",
      description: "std::system passes its string to the shell",
    },
    {
      id: "cpp.sink.popen",
      pattern: /\bpopen\s*\(/,
      vulnerability: "command_injection",
      sinkType: "shell_command",
      severity: "high",
      argument: "first",
      description: "popen() passes its string to the shell",
    },
    {
      id: "cpp.sink.exec_family",
      pattern: /\bexec(?:l|v)[a-z]*\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "all",
      description: "exec*(2) family launches a program built from its arguments",
    },
    {
      id: "cpp.sink.sql_exec",
      pattern: /\b(?:mysql_query|PQexec|sqlite3_exec)\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "database_exec",
      severity: "high",
      argument: "all",
      description: "client-library call that executes a SQL string",
    },
    {
      id: "cpp.sink.path_open",
      pattern: /\b(?:fopen|open|remove|rename)\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_operation",
      severity: "medium",
      argument: "first",
      description: "file operation on a path argument",
    },
    {
      id: "cpp.sink.dlopen",
      pattern: /\bdlopen\s*\(/,
      vulnerability: "code_injection",
      sinkType: "dynamic_library_load",
      severity: "high",
      argument: "first",
      description: "dlopen loads a library from a path",
    },
    {
      id: "cpp.sink.curl_setopt",
      pattern: /\bcurl_easy_setopt\s*\(/,
      vulnerability: "ssrf",
      sinkType: "outbound_http",
      severity: "medium",
      argument: "all",
      description: "libcurl option set — a CURLOPT_URL built from input is server-side request forgery",
    },
    {
      id: "cpp.sink.weak_crypto",
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
      id: "cpp.sanitizer.prepared_statement",
      vulnerability: "sql_injection",
      pattern: /\b(?:mysql_stmt_prepare|PQprepare|sqlite3_prepare(?:_v2|_v3)?)\s*\(/,
      rationale: "prepared statement — the SQL structure is fixed and values are bound separately",
    },
    {
      id: "cpp.sanitizer.bind_params",
      vulnerability: "sql_injection",
      pattern: /\b(?:PQexecParams|mysql_stmt_bind_param|sqlite3_bind_\w+)\s*\(/,
      rationale: "bound parameters rather than concatenated SQL text",
    },
    {
      id: "cpp.sanitizer.sql_dollar_placeholder",
      vulnerability: "sql_injection",
      pattern: /\$\d+\b/,
      rationale: "positional placeholder ($1) in the SQL text — values are bound, not interpolated",
    },
    {
      id: "cpp.sanitizer.sql_question_placeholder",
      vulnerability: "sql_injection",
      pattern: /\?\s*(?:["']|,|\)|$)/m,
      rationale: "? placeholder in the SQL text — values are bound, not interpolated",
    },
  ],
  limits: [
    "raw string literals R\"(…)\" are not masked (the delimiter model cannot express their terminator)",
    "no template, pointer or alias data flow — containers and smart pointers are not followed",
    "macros, operator overloading and generated code are invisible",
    "no interprocedural flow: helper functions that call system() are only leads at their own symbols",
    "std::process / std::filesystem C++17 APIs are not covered yet",
  ],
}
