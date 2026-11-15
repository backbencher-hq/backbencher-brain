// M72 — Dart security spec (lane A, specs-a).
//
// WHAT THIS FILE IS — lexical source/sink rules for Dart (Flutter + server
// Dart). A rule is a RegExp over the spec-masked symbol body plus the fields the
// flow engine needs.
//
// CONVENTIONS — a sink pattern ends at the callee's opening paren; the flow
// engine balances brackets and reads the argument text. Sanitizers are evaluated
// against the original (unmasked) call text, so `?` placeholders and `whereArgs:`
// are visible.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "dart",
  tier: "leads",
  tierReason: "Dart lexical rules only: Process/DB/file APIs are covered by spec, no data-flow proof.",
  lexical: {
    lineComments: ["//"],
    // Dart block comments nest, but the delimiter model does not model nesting;
    // a nested /* inside a comment ends the mask early (see limits).
    blockComments: [["/*", "*/"]],
    // Triple-quoted strings are listed before single quotes. Raw strings r"…"
    // do not honour backslash escapes; the delimiter scanner still masks them,
    // but a backslash before the closing quote can overrun (see limits).
    strings: [
      { delimiter: '"""', escape: "\\", multiline: true },
      { delimiter: "'''", escape: "\\", multiline: true },
      { delimiter: '"', escape: "\\" },
      { delimiter: "'", escape: "\\" },
    ],
  },
  sources: [
    {
      id: "dart.source.platform-environment",
      pattern: /\bPlatform\.environment\s*\[/,
      sourceType: "env",
      description: "Platform.environment exposes process environment variables",
    },
    {
      id: "dart.source.stdin",
      pattern: /\bstdin\s*\.\s*readLineSync\s*\(/,
      sourceType: "user_input",
      description: "stdin.readLineSync reads attacker-controlled stdin",
    },
    {
      id: "dart.source.request",
      pattern: /\b(?:request|req)\.(?:url|uri|headers|body)\b/,
      sourceType: "network",
      description: "shelf/server request URL/headers/body — network input",
    },
    {
      id: "dart.source.args",
      pattern: /\bargs\s*\[/,
      sourceType: "cli",
      description: "main(List<String> args) element — command-line input",
    },
    {
      id: "dart.source.file-read",
      pattern: /\breadAs(?:String|Bytes)(?:Sync)?\s*\(/,
      sourceType: "file",
      description: "File.readAs* reads file content",
    },
  ],
  sinks: [
    {
      id: "dart.sink.process-run",
      pattern: /\bProcess\.run(?:Sync)?\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "all",
      description: "Process.run executes a program and arguments built at runtime",
    },
    {
      id: "dart.sink.process-start",
      pattern: /\bProcess\.start\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "all",
      description: "Process.start launches a runtime program path",
    },
    {
      id: "dart.sink.db-execute",
      pattern: /\b(?:db|database|connection)\s*\.\s*(?:execute|query|rawQuery|rawInsert|rawUpdate|rawDelete)\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "database_exec",
      severity: "high",
      argument: "all",
      description: "database client executes a SQL string (sqflite-style receiver names)",
    },
    {
      id: "dart.sink.file-path",
      pattern: /\b(?:File|Directory|Link)\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_operation",
      severity: "medium",
      argument: "first",
      description: "File/Directory constructed from a runtime path",
    },
    {
      id: "dart.sink.outbound-http",
      pattern: /\b(?:HttpClient|http)\s*\.\s*(?:get|post|put|delete|getUrl|openUrl|request)\s*\(/,
      vulnerability: "ssrf",
      sinkType: "outbound_http",
      severity: "medium",
      argument: "all",
      description: "outbound HTTP request — a URL from input is server-side request forgery",
    },
    {
      id: "dart.sink.inner-html",
      pattern: /\.innerHtml\s*=/,
      vulnerability: "xss",
      sinkType: "html_output",
      severity: "high",
      argument: "any",
      description: "innerHtml assignment injects raw HTML (package:html / dart:html)",
    },
    {
      id: "dart.sink.weak-crypto",
      pattern: /\b(?:md5|sha1)\s*\.\s*convert\s*\(/,
      vulnerability: "weak_crypto",
      sinkType: "crypto_primitive",
      severity: "medium",
      argument: "first",
      description: "package:crypto MD5/SHA-1 digest — broken for security use",
    },
  ],
  sanitizers: [
    {
      id: "dart.sanitizer.where-args",
      vulnerability: "sql_injection",
      pattern: /\bwhereArgs\s*:/,
      rationale: "sqflite whereArgs binds values instead of interpolating them into SQL",
    },
    {
      id: "dart.sanitizer.parameter-vector",
      vulnerability: "sql_injection",
      pattern: /\brawQuery\s*\([^)\n]*,\s*\[/,
      rationale: "rawQuery with a parameter vector — values are bound, not interpolated",
    },
    {
      id: "dart.sanitizer.sql-question-placeholder",
      vulnerability: "sql_injection",
      pattern: /\?\s*(?:["']|,|\)|$)/m,
      rationale: "? placeholder in the SQL text — values are bound, not interpolated",
    },
    {
      id: "dart.sanitizer.html-escape",
      vulnerability: "xss",
      pattern: /\bHtmlEscape\b|\bhtmlEscape\s*\(/,
      rationale: "HtmlEscape encodes text before HTML emission",
    },
  ],
  limits: [
    "raw strings do not honour backslash escapes; a backslash before the closing quote can end masking early",
    "nested block comments are not modelled",
    "Flutter widget trees and package-specific DB clients other than sqflite-style names are not covered",
    "no interprocedural flow: helper functions that call the sink are only leads at their own symbols",
    "shelf/Phoenix-style middleware and ORM query builders are not modelled",
  ],
}
