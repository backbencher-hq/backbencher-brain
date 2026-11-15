// M72 — C# security spec (lane A, specs-a).
//
// WHAT THIS FILE IS — lexical source/sink rules for C# / .NET. A rule is a
// RegExp over the spec-masked symbol body (comments/strings blanked) plus the
// fields the flow engine needs.
//
// CONVENTIONS — a sink pattern ends at the callee's opening paren; the flow
// engine balances brackets and reads the argument text. Sanitizers are evaluated
// against the original (unmasked) call/argument text, so ADO.NET `@name`
// placeholders and PreparedStatement-style APIs are both usable as sanitizers.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "csharp",
  tier: "leads",
  tierReason: ".NET lexical rules only: no interprocedural flow, so a match is a lead to validate.",
  lexical: {
    lineComments: ["//"],
    blockComments: [["/*", "*/"]],
    // Raw string literals (C# 11 """…""") are listed before the normal double
    // quote so the longer delimiter wins; verbatim @"…" relies on the normal
    // quote scanner and is noted in limits.
    strings: [
      { delimiter: '"""', escape: "\\", multiline: true },
      { delimiter: '"', escape: "\\" },
      { delimiter: "'", escape: "\\" },
    ],
  },
  sources: [
    {
      id: "csharp.source.request",
      pattern: /\bRequest\.(?:QueryString|Form|Params|Query|Cookies|Headers)\b/,
      sourceType: "user_input",
      description: "ASP.NET Request.* collections carry client input",
    },
    {
      id: "csharp.source.console",
      pattern: /\bConsole\.ReadLine\s*\(/,
      sourceType: "user_input",
      description: "Console.ReadLine reads stdin",
    },
    {
      id: "csharp.source.getenv",
      pattern: /\bEnvironment\.GetEnvironmentVariable\s*\(/,
      sourceType: "env",
      description: "Environment.GetEnvironmentVariable reads a process environment variable",
    },
    {
      id: "csharp.source.args",
      pattern: /\bargs\s*\[/,
      sourceType: "cli",
      description: "Main(string[] args) element — command-line input",
    },
    {
      id: "csharp.source.file",
      pattern: /\bFile\.ReadAll(?:Text|Bytes|Lines)\s*\(/,
      sourceType: "file",
      description: "File.ReadAll* reads file content",
    },
  ],
  sinks: [
    {
      id: "csharp.sink.process-start",
      pattern: /\bProcess\.Start\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "all",
      description: "Process.Start launches an executable/arguments built at runtime",
    },
    {
      id: "csharp.sink.process-start-info",
      pattern: /\bProcessStartInfo\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "all",
      description: "ProcessStartInfo carries FileName/Arguments for Process.Start",
    },
    {
      id: "csharp.sink.ado-command",
      pattern: /\b(?:SqlCommand|NpgsqlCommand|MySqlCommand|SqliteCommand|OleDbCommand|OracleCommand)\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "database_exec",
      severity: "high",
      argument: "all",
      description: "ADO.NET command object built from a SQL string",
    },
    {
      id: "csharp.sink.ef-raw-sql",
      pattern: /\b(?:ExecuteSqlRaw|FromSqlRaw|ExecuteSqlCommand)\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "database_exec",
      severity: "high",
      argument: "all",
      description: "EF Core raw-SQL API — interpolated strings are concatenated SQL",
    },
    {
      id: "csharp.sink.assembly-load",
      pattern: /\bAssembly\.Load\s*\(/,
      vulnerability: "code_injection",
      sinkType: "dynamic_code_load",
      severity: "high",
      argument: "first",
      description: "Assembly.Load loads code from a runtime path or byte array",
    },
    {
      id: "csharp.sink.insecure-formatter",
      pattern: /\b(?:BinaryFormatter|LosFormatter|NetDataContractSerializer|ObjectStateFormatter|SoapFormatter)\s*\(/,
      vulnerability: "insecure_deserialization",
      sinkType: "deserialization",
      severity: "high",
      argument: "all",
      description: "unsafe .NET formatter — deserializing untrusted bytes can execute code",
    },
    {
      id: "csharp.sink.file-path",
      pattern: /\bFile\.(?:ReadAllText|ReadAllBytes|ReadAllLines|WriteAllText|Open|Delete|Copy|Move)\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_operation",
      severity: "medium",
      argument: "first",
      description: "file operation on a runtime path",
    },
    {
      id: "csharp.sink.html-raw",
      pattern: /\b(?:Html\.Raw|Response\.Write)\s*\(/,
      vulnerability: "xss",
      sinkType: "html_output",
      severity: "high",
      argument: "first",
      description: "unencoded HTML output (Html.Raw / Response.Write)",
    },
    {
      id: "csharp.sink.outbound-http",
      pattern: /\b(?:GetStringAsync|GetAsync|PostAsync|DownloadString)\s*\(/,
      vulnerability: "ssrf",
      sinkType: "outbound_http",
      severity: "medium",
      argument: "first",
      description: "outbound HTTP request — a URL from input is server-side request forgery",
    },
    {
      id: "csharp.sink.weak-crypto",
      pattern: /\b(?:MD5|SHA1|DES|RC2|TripleDES)\.Create\s*\(/,
      vulnerability: "weak_crypto",
      sinkType: "crypto_primitive",
      severity: "medium",
      argument: "any",
      description: "obsolete algorithm MD5/SHA-1/DES/RC2/TripleDES",
    },
  ],
  sanitizers: [
    {
      id: "csharp.sanitizer.sql-parameter",
      vulnerability: "sql_injection",
      pattern: /\b(?:SqlParameter|NpgsqlParameter|MySqlParameter|OleDbParameter|OracleParameter)\b|\bAddWithValue\s*\(|\bParameters\.Add\s*\(/,
      rationale: "ADO.NET parameters — values are bound, not concatenated into SQL",
    },
    {
      id: "csharp.sanitizer.sql-named-placeholder",
      vulnerability: "sql_injection",
      pattern: /@[A-Za-z_][A-Za-z0-9_]*/,
      rationale: "@name placeholder in the SQL text — values are bound, not interpolated",
    },
    {
      id: "csharp.sanitizer.html-encode",
      vulnerability: "xss",
      pattern: /\b(?:HtmlEncoder\.Default\.Encode|HttpUtility\.HtmlEncode|WebUtility\.HtmlEncode)\s*\(/,
      rationale: "HTML-encoding before output",
    },
    {
      id: "csharp.sanitizer.argument-list",
      vulnerability: "command_injection",
      pattern: /\bArgumentList\s*\.\s*Add\s*\(/,
      rationale: "ProcessStartInfo.ArgumentList passes argv entries without a shell",
    },
  ],
  limits: [
    "verbatim strings @\"…\" with doubled quotes can end masking early (see lexical note)",
    "no interprocedural flow: helper methods that call the sink are only leads at their own symbols",
    "EF Core LINQ parameterization is not modelled beyond the raw-SQL API names",
    "WebForms/ASP.NET MVC model binding, Razor output encoding and tag helpers are not modelled",
    "attribute routing/decorators are not read as sources",
  ],
}
