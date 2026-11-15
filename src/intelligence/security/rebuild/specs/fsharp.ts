// M72 — F# security spec (lane A, specs-a).
//
// WHAT THIS FILE IS — lexical source/sink rules for F# / .NET. A rule is a
// RegExp over the spec-masked symbol body plus the fields the flow engine needs.
//
// CONVENTIONS — a sink pattern ends at the callee's opening paren; the flow
// engine balances brackets and reads the argument text. Sanitizers are evaluated
// against the original (unmasked) call text.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "fsharp",
  tier: "leads",
  tierReason: ".NET F# lexical rules only: no interprocedural flow, so a match is a lead to validate.",
  lexical: {
    lineComments: ["//"],
    // F# block comments nest; the delimiter model does not, so a nested (* *)
    // ends the mask early (see limits).
    blockComments: [["(*", "*)"]],
    // Char literals are deliberately NOT declared: the same ' character is the
    // generic-type-parameter prefix ('T), and masking it would swallow real code.
    strings: [
      { delimiter: '"""', escape: "\\", multiline: true },
      { delimiter: '"', escape: "\\" },
    ],
  },
  sources: [
    {
      id: "fsharp.source.getenv",
      pattern: /\bEnvironment\.GetEnvironmentVariable\s*\(/,
      sourceType: "env",
      description: "Environment.GetEnvironmentVariable reads a process environment variable",
    },
    {
      id: "fsharp.source.commandline",
      pattern: /\b(?:fsi\.CommandLineArgs|Environment\.GetCommandLineArgs)\b/,
      sourceType: "cli",
      description: "script/process command-line arguments",
    },
    {
      id: "fsharp.source.console",
      pattern: /\bConsole\.ReadLine\s*\(/,
      sourceType: "user_input",
      description: "Console.ReadLine reads stdin",
    },
    {
      id: "fsharp.source.file",
      pattern: /\bFile\.ReadAll(?:Text|Lines|Bytes)\s*\(/,
      sourceType: "file",
      description: "File.ReadAll* reads file content",
    },
    {
      id: "fsharp.source.request",
      pattern: /\bRequest\.(?:QueryString|Form|Params|Query)\b/,
      sourceType: "user_input",
      description: "ASP.NET Request.* collections carry client input",
    },
  ],
  sinks: [
    {
      id: "fsharp.sink.process-start",
      pattern: /\b(?:Process\.Start|ProcessStartInfo)\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "all",
      description: "Process.Start / ProcessStartInfo launches an executable built at runtime",
    },
    {
      id: "fsharp.sink.ado-command",
      pattern: /\b(?:SqlCommand|NpgsqlCommand|MySqlCommand|OleDbCommand)\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "database_exec",
      severity: "high",
      argument: "all",
      description: "ADO.NET command object built from a SQL string",
    },
    {
      id: "fsharp.sink.ef-raw-sql",
      pattern: /\b(?:ExecuteSqlRaw|FromSqlRaw|ExecuteSqlCommand)\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "database_exec",
      severity: "high",
      argument: "all",
      description: "EF Core raw-SQL API — interpolated strings are concatenated SQL",
    },
    {
      id: "fsharp.sink.assembly-load",
      pattern: /\bAssembly\.Load\s*\(/,
      vulnerability: "code_injection",
      sinkType: "dynamic_code_load",
      severity: "high",
      argument: "first",
      description: "Assembly.Load loads code from a runtime path or byte array",
    },
    {
      id: "fsharp.sink.insecure-formatter",
      pattern: /\b(?:BinaryFormatter|NetDataContractSerializer|LosFormatter)\s*\(/,
      vulnerability: "insecure_deserialization",
      sinkType: "deserialization",
      severity: "high",
      argument: "all",
      description: "unsafe .NET formatter — untrusted bytes can execute code",
    },
    {
      id: "fsharp.sink.file-path",
      pattern: /\bFile\.(?:ReadAllText|WriteAllText|ReadAllLines|Open|Delete|Copy|Move)\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_operation",
      severity: "medium",
      argument: "first",
      description: "file operation on a runtime path",
    },
    {
      id: "fsharp.sink.html-raw",
      pattern: /\b(?:Html\.Raw|HtmlString|Response\.Write)\s*\(/,
      vulnerability: "xss",
      sinkType: "html_output",
      severity: "high",
      argument: "first",
      description: "unencoded HTML output (Html.Raw / HtmlString / Response.Write)",
    },
    {
      id: "fsharp.sink.outbound-http",
      pattern: /\b(?:GetStringAsync|GetAsync|DownloadString)\s*\(/,
      vulnerability: "ssrf",
      sinkType: "outbound_http",
      severity: "medium",
      argument: "first",
      description: "outbound HTTP request — a URL from input is server-side request forgery",
    },
    {
      id: "fsharp.sink.weak-crypto",
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
      id: "fsharp.sanitizer.sql-parameter",
      vulnerability: "sql_injection",
      pattern: /\b(?:SqlParameter|AddWithValue|Parameters\.Add)\b/,
      rationale: "ADO.NET parameters — values are bound, not concatenated into SQL",
    },
    {
      id: "fsharp.sanitizer.sql-named-placeholder",
      vulnerability: "sql_injection",
      pattern: /@[A-Za-z_][A-Za-z0-9_]*/,
      rationale: "@name placeholder in the SQL text — values are bound, not interpolated",
    },
    {
      id: "fsharp.sanitizer.html-encode",
      vulnerability: "xss",
      pattern: /\b(?:HtmlEncode|WebUtility\.HtmlEncode|HtmlEncoder\.Default\.Encode)\s*\(/,
      rationale: "HTML-encoding before output",
    },
    {
      id: "fsharp.sanitizer.argument-list",
      vulnerability: "command_injection",
      pattern: /\bArgumentList\s*\.\s*Add\s*\(/,
      rationale: "ProcessStartInfo.ArgumentList passes argv entries without a shell",
    },
  ],
  limits: [
    "char literals ('x') are not masked, because ' also prefixes generic type parameters",
    "nested (* … *) block comments are not modelled",
    "offside-rule/indentation structure is not analysed; only token rules apply",
    "no interprocedural flow: helper functions that call the sink are only leads at their own symbols",
    "type providers, computation expressions and quotations are not expanded",
  ],
}
