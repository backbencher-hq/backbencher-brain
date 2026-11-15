// M72 — Visual Basic (.NET) security spec (lane B). DATA only: lexical syntax
// plus source/sink/sanitizer rules; the rebuild engine (matcher + flow) decides
// whether a sink becomes a lead. Frozen contract: ../spec-types.ts.
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/{PLAN,LANGUAGES}.md,
//   validation/m72/fixtures/vb/.
// CONTRACTS IT MUST NOT BREAK — VB identifiers are case-insensitive (i flag);
//   Process.Start/Shell are command sinks; parameterized ADO.NET is the
//   sanitized form.
// TIER — leads: lexical rules only; output is a lead to validate, not a finding.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "vb",
  tier: "leads",
  tierReason: "VB source/sink rules; Process/File/SQL rules without data-flow proof",
  lexical: {
    lineComments: ["'"],
    blockComments: [],
    strings: [{ delimiter: '"', escape: '"' }],
  },
  sources: [
    {
      id: "vb.console_readline",
      pattern: /\bConsole\.ReadLine\s*\(/i,
      sourceType: "user_input",
      description: "console input from Console.ReadLine",
    },
    {
      id: "vb.env",
      pattern: /\bEnvironment\.GetEnvironmentVariable\s*\(/i,
      sourceType: "env",
      description: "environment variable read",
    },
    {
      id: "vb.command_line",
      pattern: /\b(?:My\.Application\.CommandLineArgs|Environment\.GetCommandLineArgs)\b/i,
      sourceType: "argv",
      description: "process command-line arguments",
    },
    {
      id: "vb.request",
      pattern: /\bRequest\.(?:QueryString|Form|Params|Cookies)\b/i,
      sourceType: "user_input",
      description: "ASP.NET request collection member",
      captureVariable: true,
    },
    {
      id: "vb.file_read",
      pattern: /\bFile\.ReadAll(?:Text|Lines)\s*\(/i,
      sourceType: "file",
      description: "file contents read with File.ReadAllText/ReadAllLines",
    },
  ],
  sinks: [
    {
      id: "vb.cmd.process_start",
      pattern: /\bProcess\.Start\s*\(/i,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "critical",
      argument: "all",
      description: "Process.Start of a caller-influenced executable/arguments",
    },
    {
      id: "vb.cmd.shell",
      pattern: /\bShell\s*\(/i,
      vulnerability: "command_injection",
      sinkType: "shell_exec",
      severity: "critical",
      argument: "first",
      description: "Shell() executes a command line",
    },
    {
      id: "vb.code.assembly_load",
      pattern: /\bAssembly\.Load(?:From|File)?\s*\(/i,
      vulnerability: "code_injection",
      sinkType: "code_load",
      severity: "critical",
      argument: "first",
      description: "Assembly.Load loads and executes runtime-chosen code",
    },
    {
      id: "vb.sql.execute",
      pattern: /\b(?:ExecuteReader|ExecuteNonQuery|ExecuteScalar)\s*\(/i,
      vulnerability: "sql_injection",
      sinkType: "sql_exec",
      severity: "high",
      argument: "all",
      description: "ADO.NET command execution on a dynamically built statement",
    },
    {
      id: "vb.sql.command_text",
      pattern: /\bCommandText\s*=/i,
      vulnerability: "sql_injection",
      sinkType: "sql_exec",
      severity: "high",
      argument: "any",
      description: "CommandText built from a dynamic string",
    },
    {
      id: "vb.path.file_mutation",
      pattern: /\b(?:File\.WriteAllText|File\.WriteAllLines|File\.Delete|File\.Move|File\.Copy|Directory\.Delete)\s*\(/i,
      vulnerability: "path_traversal",
      sinkType: "file_mutation",
      severity: "high",
      argument: "first",
      description: "file write/delete/move on a caller-influenced path",
    },
    {
      id: "vb.deser.binary_formatter",
      pattern: /\bBinaryFormatter\b|\.Deserialize\s*\(/i,
      vulnerability: "insecure_deserialization",
      sinkType: "deserialize",
      severity: "high",
      argument: "any",
      description: "BinaryFormatter/Deserialize of untrusted data",
    },
    {
      id: "vb.ssrf.web_client",
      pattern: /\b(?:WebClient|HttpClient)\b[^;\n]{0,120}?\.(?:DownloadString|DownloadData|GetStringAsync|GetAsync|SendAsync)\s*\(/i,
      vulnerability: "ssrf",
      sinkType: "http_request",
      severity: "high",
      argument: "any",
      description: "outbound HTTP request to a caller-controlled URL",
    },
    {
      id: "vb.redirect.response",
      pattern: /\bResponse\.Redirect\s*\(/i,
      vulnerability: "open_redirect",
      sinkType: "http_redirect",
      severity: "medium",
      argument: "first",
      description: "HTTP redirect to a caller-influenced location",
    },
    {
      id: "vb.xss.response_write",
      pattern: /\bResponse\.Write\s*\(/i,
      vulnerability: "xss",
      sinkType: "html_output",
      severity: "medium",
      argument: "first",
      description: "direct response output of a dynamic value",
    },
  ],
  sanitizers: [
    {
      id: "vb.sql.parameters",
      vulnerability: "sql_injection",
      pattern: /\bParameters\.(?:Add|AddWithValue)\s*\(/i,
      rationale: "ADO.NET command parameters bind values instead of interpolating them",
    },
    {
      id: "vb.cmd.argument_list",
      vulnerability: "command_injection",
      pattern: /\bArgumentList\.Add\s*\(/i,
      rationale: "ProcessStartInfo.ArgumentList passes arguments separately from the program",
    },
    {
      id: "vb.xss.html_encode",
      vulnerability: "xss",
      pattern: /\b(?:HttpUtility|WebUtility)\.HtmlEncode\s*\(|\bServer\.HtmlEncode\s*\(/i,
      rationale: "HTML encoding for the response context",
    },
    {
      id: "vb.path.get_file_name",
      vulnerability: "path_traversal",
      pattern: /\bPath\.GetFileName\s*\(/i,
      rationale: "GetFileName strips directory components before the path is used",
    },
    {
      id: "vb.deser.typed_serializer",
      vulnerability: "insecure_deserialization",
      pattern: /\b(?:XmlSerializer|DataContractSerializer|JsonSerializer)\b/i,
      rationale: "typed serializers do not reconstruct arbitrary runtime types",
    },
    {
      id: "vb.redirect.local_url",
      vulnerability: "open_redirect",
      pattern: /\bUrl\.IsLocalUrl\s*\(/i,
      rationale: "Url.IsLocalUrl rejects absolute/off-site redirect targets",
    },
  ],
  limits: [
    "VB.NET events, partial classes and late binding hide the concrete sink",
    "Process.Start/Shell take a command line string; argv-separated ArgumentList is the sanitized form",
    "ASP.NET Request members beyond the listed collections are not sources",
    "no interprocedural flow; a helper that performs the sink is not followed",
  ],
}
