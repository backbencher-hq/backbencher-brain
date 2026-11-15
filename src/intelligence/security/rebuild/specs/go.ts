// M72 — Go security spec (lane A, specs-a).
//
// WHAT THIS FILE IS — lexical source/sink rules for Go. A rule is a RegExp over
// the spec-masked symbol body (comments/strings blanked) plus the fields the
// flow engine needs.
//
// CONVENTIONS — a sink pattern ends at the callee's opening paren; the flow
// engine balances brackets and reads the argument text. Sanitizers are evaluated
// against the original (unmasked) call text, so $1 / ? placeholders are visible.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "go",
  tier: "leads",
  tierReason: "Go lexical rules only: no SSA/alias data flow, so a match is a lead to validate.",
  lexical: {
    lineComments: ["//"],
    blockComments: [["/*", "*/"]],
    strings: [
      { delimiter: "`", multiline: true },
      { delimiter: '"', escape: "\\" },
      { delimiter: "'", escape: "\\" },
    ],
  },
  sources: [
    {
      id: "go.source.http-request",
      pattern: /\b(?:r|req|request)\.(?:FormValue|PostFormValue|URL|Form|PostForm|MultipartForm|Body|Header|Cookie)\b/,
      sourceType: "user_input",
      description: "net/http request field or FormValue — client-controlled input",
    },
    {
      id: "go.source.getenv",
      pattern: /\bos\.(?:Getenv|Environ)\s*\(/,
      sourceType: "env",
      description: "os.Getenv/os.Environ read process environment variables",
    },
    {
      id: "go.source.args",
      pattern: /\bos\.Args\b|\bflag\.Args?\s*\(/,
      sourceType: "cli",
      description: "os.Args / flag.Arg — command-line input",
    },
    {
      id: "go.source.stdin",
      pattern: /\bfmt\.(?:Scan|Scanf|Scanln|Fscan|Fscanf)\s*\(|\bbufio\.NewReader\s*\(\s*os\.Stdin\b/,
      sourceType: "user_input",
      description: "stdin scan/reader — externally supplied input",
    },
    {
      id: "go.source.file-read",
      pattern: /\bos\.(?:Open|ReadFile)\s*\(|\bioutil\.ReadFile\s*\(/,
      sourceType: "file",
      description: "file open/read — content is untrusted relative to the process",
    },
  ],
  sinks: [
    {
      id: "go.sink.exec-command",
      pattern: /\bexec\.Command(?:Context)?\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "all",
      description: "os/exec Command — a runtime program/argv reaches process launch",
    },
    {
      id: "go.sink.syscall-exec",
      pattern: /\bsyscall\.Exec\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "all",
      description: "syscall.Exec replaces the process with a runtime program",
    },
    {
      id: "go.sink.database-exec",
      pattern: /\b(?:db|tx|conn|database)\.(?:Query|QueryContext|QueryRow|QueryRowContext|Exec|ExecContext)\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "database_exec",
      severity: "high",
      argument: "all",
      description: "database/sql call that executes a SQL string",
    },
    {
      id: "go.sink.gorm-raw",
      pattern: /\bdb\.Raw\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "database_exec",
      severity: "high",
      argument: "all",
      description: "gorm Raw executes a SQL string",
    },
    {
      id: "go.sink.file-path",
      pattern: /\bos\.(?:Open|OpenFile|Create|Remove|RemoveAll|ReadFile|WriteFile|MkdirAll)\s*\(|\bioutil\.(?:ReadFile|WriteFile)\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_operation",
      severity: "medium",
      argument: "first",
      description: "file operation on a runtime path",
    },
    {
      id: "go.sink.template-html",
      pattern: /\btemplate\.HTML\s*\(/,
      vulnerability: "xss",
      sinkType: "html_output",
      severity: "high",
      argument: "first",
      description: "template.HTML marks a string as already-safe HTML (no escaping)",
    },
    {
      id: "go.sink.outbound-http",
      pattern: /\bhttp\.(?:Get|Post|Head|NewRequest)\s*\(/,
      vulnerability: "ssrf",
      sinkType: "outbound_http",
      severity: "medium",
      argument: "first",
      description: "outbound HTTP request — a URL from input is server-side request forgery",
    },
    {
      id: "go.sink.plugin-open",
      pattern: /\bplugin\.Open\s*\(/,
      vulnerability: "code_injection",
      sinkType: "dynamic_library_load",
      severity: "high",
      argument: "first",
      description: "plugin.Open loads a shared object from a runtime path",
    },
    {
      id: "go.sink.weak-crypto",
      pattern: /\b(?:md5|sha1)\.(?:New|Sum)\s*\(/,
      vulnerability: "weak_crypto",
      sinkType: "crypto_primitive",
      severity: "medium",
      argument: "any",
      description: "crypto/md5 or crypto/sha1 constructor — broken for security use",
    },
    {
      id: "go.sink.gob-decode",
      pattern: /\bgob\.NewDecoder\s*\(/,
      vulnerability: "insecure_deserialization",
      sinkType: "deserialization",
      severity: "medium",
      argument: "first",
      description: "gob decode of an untrusted stream",
    },
  ],
  sanitizers: [
    {
      id: "go.sanitizer.prepared-statement",
      vulnerability: "sql_injection",
      pattern: /\b(?:Prepare|PrepareContext)\s*\(/,
      rationale: "database/sql prepared statement — SQL structure is fixed, values are bound",
    },
    {
      id: "go.sanitizer.parameterized-call",
      vulnerability: "sql_injection",
      pattern: /\b(?:Query|QueryRow|Exec)(?:Context)?\s*\([^)\n]*,\s*[A-Za-z_]/,
      rationale: "query call with a separate argument — the driver binds it instead of splicing SQL text",
    },
    {
      id: "go.sanitizer.sql-dollar-placeholder",
      vulnerability: "sql_injection",
      pattern: /\$\d+\b/,
      rationale: "positional placeholder ($1) in the SQL text — values are bound, not interpolated",
    },
    {
      id: "go.sanitizer.sql-question-placeholder",
      vulnerability: "sql_injection",
      pattern: /\?\s*(?:["']|,|\)|$)/m,
      rationale: "? placeholder in the SQL text — values are bound, not interpolated",
    },
    {
      id: "go.sanitizer.html-escape",
      vulnerability: "xss",
      pattern: /\bhtml\.EscapeString\s*\(/,
      rationale: "html.EscapeString escapes text before HTML emission",
    },
  ],
  limits: [
    "no SSA/alias/interface data flow: values through structs, maps and interfaces are not followed",
    "exec.Command is argv-based (no shell); a tainted non-program argument can be over-reported as command injection",
    "HTTP handlers/middleware are not modelled; only net/http request fields are sources",
    "no interprocedural flow: helper functions that call the sink are only leads at their own symbols",
    "framework routers (gin/echo/chi) and ORMs (gorm query builder) are not modelled beyond db.Raw",
  ],
}
