// M72 — Haskell security spec (lane A, specs-a).
//
// WHAT THIS FILE IS — lexical source/sink rules for Haskell. A rule is a RegExp
// over the spec-masked symbol body plus the fields the flow engine needs.
//
// CONVENTIONS — a sink pattern ends at the callee token plus the start of its
// application; the flow engine reads the balanced argument text from there.
// Sources and sinks stay distinct call/value shapes so self-pair rejection is
// testable.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "haskell",
  tier: "leads",
  tierReason: "Haskell lexical rules only: no laziness-aware data flow, so a match is a lead to validate.",
  lexical: {
    lineComments: ["--"],
    // Haskell block comments nest; the delimiter model does not, so a nested
    // {- -} ends the mask early (see limits).
    blockComments: [["{-", "-}"]],
    // Char literals are deliberately NOT declared: ' is also the identifier
    // prime (foldl') and the promoted-constructor tick, and masking it would
    // swallow real code.
    strings: [{ delimiter: '"', escape: "\\" }],
  },
  sources: [
    {
      id: "haskell.source.getArgs",
      pattern: /\bgetArgs\b/,
      sourceType: "cli",
      description: "System.Environment.getArgs returns command-line arguments",
    },
    {
      id: "haskell.source.getEnv",
      pattern: /\b(?:getEnv|lookupEnv)\b/,
      sourceType: "env",
      description: "lookupEnv/getEnv read process environment variables",
    },
    {
      id: "haskell.source.getLine",
      pattern: /\b(?:getLine|getContents|hGetLine|hGetContents)\b/,
      sourceType: "user_input",
      description: "stdin/stdout handle read — externally supplied input",
    },
    {
      id: "haskell.source.readFile",
      pattern: /\b(?:BS\.)?readFile\b|\bLBS\.readFile\b/,
      sourceType: "file",
      description: "readFile reads file content",
    },
  ],
  sinks: [
    {
      id: "haskell.sink.system",
      pattern: /\bsystem\s+[A-Za-z_(]/,
      vulnerability: "command_injection",
      sinkType: "shell_command",
      severity: "high",
      argument: "all",
      description: "System.Process.system runs its String through the shell",
    },
    {
      id: "haskell.sink.process-command",
      pattern: /\b(?:callCommand|callProcess|rawSystem|readProcess)\s+/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "all",
      description: "callCommand/callProcess/rawSystem launch an external program",
    },
    {
      id: "haskell.sink.createProcess",
      pattern: /\bcreateProcess\s+[A-Za-z_(]/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "all",
      description: "createProcess with a shell or runtime command",
    },
    {
      id: "haskell.sink.raw-sql",
      pattern: /\b(?:rawSql|runRaw)\s+[A-Za-z_(]|\bPQ\.exec\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "database_exec",
      severity: "high",
      argument: "all",
      description: "raw SQL execution (persistent rawSql / HDBC runRaw / libpq PQ.exec)",
    },
    {
      id: "haskell.sink.file-path",
      pattern: /\b(?:writeFile|appendFile|openFile|removeFile|renameFile|copyFile|createDirectory|removeDirectory)\s+[A-Za-z_(]/,
      vulnerability: "path_traversal",
      sinkType: "file_operation",
      severity: "medium",
      argument: "first",
      description: "file operation on a runtime path",
    },
    {
      id: "haskell.sink.raw-html",
      pattern: /\bpreEscapedToHtml\s+|\bpreEscapedString\b/,
      vulnerability: "xss",
      sinkType: "html_output",
      severity: "high",
      argument: "any",
      description: "blaze-html pre-escaped output — no escaping applied",
    },
    {
      id: "haskell.sink.outbound-http",
      pattern: /\b(?:simpleHTTP|httpLbs|httpNoBody)\s+[A-Za-z_(]/,
      vulnerability: "ssrf",
      sinkType: "outbound_http",
      severity: "medium",
      argument: "all",
      description: "outbound HTTP request — a URL from input is server-side request forgery",
    },
    {
      id: "haskell.sink.weak-crypto",
      pattern: /\bhashWith\s+(?:MD5|SHA1)\b/,
      vulnerability: "weak_crypto",
      sinkType: "crypto_primitive",
      severity: "medium",
      argument: "any",
      description: "cryptonite hashWith MD5/SHA1 — broken for security use",
    },
  ],
  sanitizers: [
    {
      id: "haskell.sanitizer.proc-argv",
      vulnerability: "command_injection",
      pattern: /\bproc\s+[A-Za-z"]/,
      rationale: "System.Process.proc builds an argv list without a shell",
    },
    {
      id: "haskell.sanitizer.exec-params",
      vulnerability: "sql_injection",
      pattern: /\bexecParams\b/,
      rationale: "PQ.execParams binds parameters instead of splicing SQL text",
    },
    {
      id: "haskell.sanitizer.sql-dollar-placeholder",
      vulnerability: "sql_injection",
      pattern: /\$\d+\b/,
      rationale: "positional placeholder ($1) in the SQL text — values are bound, not interpolated",
    },
    {
      id: "haskell.sanitizer.html-escape",
      vulnerability: "xss",
      pattern: /\b(?:toHtml|escapeHtml)\b/,
      rationale: "blaze/lucid toHtml escapes text before HTML emission",
    },
  ],
  limits: [
    "char literals ('x') are not masked, because ' is also the identifier prime and type-level tick",
    "nested {- … -} block comments are not modelled",
    "no monad/typeclass flow: a value threaded through a monad transformer stack is not tracked",
    "QuasiQuotes and Template Haskell splices are not expanded",
    "no base `eval` rule: dynamic code loading (hint/plugins) is not covered",
    "some sinks are matched through the callee token only (normal Haskell application is whitespace)"
  ],
}
