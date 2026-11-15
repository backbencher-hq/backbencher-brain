// M72 — VBA (Office/classic ASP) security spec (lane B). DATA only: lexical
// syntax plus source/sink/sanitizer rules; the rebuild engine (matcher + flow)
// decides whether a sink becomes a lead. Frozen contract: ../spec-types.ts.
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/{PLAN,LANGUAGES}.md,
//   validation/m72/fixtures/vba/.
// CONTRACTS IT MUST NOT BREAK — VBA identifiers are case-insensitive (i flag);
//   Shell/Eval/ExecuteGlobal/CreateObject are the executable sinks; ADODB
//   parameters are the sanitized form.
// TIER — leads: lexical rules only; output is a lead to validate, not a finding.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "vba",
  tier: "leads",
  tierReason: "VBA source/sink rules; Shell/CreateObject rules without host-aware flow proof",
  lexical: {
    lineComments: ["'"],
    blockComments: [],
    strings: [{ delimiter: '"', escape: '"' }],
  },
  sources: [
    {
      id: "vba.input_box",
      pattern: /\bInputBox\s*\(/i,
      sourceType: "user_input",
      description: "interactive InputBox value",
    },
    {
      id: "vba.env",
      pattern: /\bEnviron\s*\(/i,
      sourceType: "env",
      description: "environment variable read (Environ)",
    },
    {
      id: "vba.command_line",
      pattern: /\bCommand\s*\(\s*\)/i,
      sourceType: "argv",
      description: "command-line arguments (Command())",
    },
    {
      id: "vba.range_value",
      pattern: /\bRange\s*\([^)\n]{0,120}\)\s*\.Value\b/i,
      sourceType: "user_input",
      description: "worksheet cell value (attacker-controlled in a macro-enabled document)",
      captureVariable: true,
    },
    {
      id: "vba.request",
      pattern: /\bRequest\.(?:QueryString|Form)\b/i,
      sourceType: "user_input",
      description: "classic-ASP request collection member",
    },
    {
      id: "vba.file_input",
      pattern: /\bOpen\s+[^;\n]{0,160}?\bFor\s+Input\b/i,
      sourceType: "file",
      description: "file opened For Input",
    },
  ],
  sinks: [
    {
      id: "vba.cmd.shell",
      pattern: /\bShell\s*\(/i,
      vulnerability: "command_injection",
      sinkType: "shell_exec",
      severity: "critical",
      argument: "first",
      description: "Shell() executes an OS command line",
    },
    {
      id: "vba.code.eval",
      pattern: /\bEval\s*\(/i,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "critical",
      argument: "first",
      description: "Eval() evaluates a dynamic VBA expression",
    },
    {
      id: "vba.code.execute",
      pattern: /\b(?:ExecuteGlobal|ExecuteExcel4Macro|Application\.Run)\s*\(/i,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "critical",
      argument: "all",
      description: "ExecuteGlobal/ExecuteExcel4Macro/Application.Run run dynamic code",
    },
    {
      id: "vba.code.create_object",
      pattern: /\bCreateObject\s*\(/i,
      vulnerability: "code_injection",
      sinkType: "code_load",
      severity: "high",
      argument: "first",
      description: "CreateObject instantiates a runtime-chosen COM class",
    },
    {
      id: "vba.sql.execute",
      pattern: /\b(?:CurrentDb\.Execute|OpenRecordset|DoCmd\.RunSQL)\s*\(/i,
      vulnerability: "sql_injection",
      sinkType: "sql_exec",
      severity: "high",
      argument: "all",
      description: "Access/DAO statement execution on a dynamically built statement",
    },
    {
      id: "vba.path.file_output",
      pattern: /\.(?:OpenTextFile|CreateTextFile)\s*\(/i,
      vulnerability: "path_traversal",
      sinkType: "file_write",
      severity: "high",
      argument: "first",
      description: "FileSystemObject text-file write on a caller-influenced path",
    },
    {
      id: "vba.ssrf.xml_http",
      pattern: /\b(?:MSXML2\.(?:XMLHTTP|ServerXMLHTTP)|WinHttp\.WinHttpRequest)\b/i,
      vulnerability: "ssrf",
      sinkType: "http_request",
      severity: "high",
      argument: "any",
      description: "HTTP request object fetching a caller-controlled URL",
    },
    {
      id: "vba.xss.response_write",
      pattern: /\bResponse\.Write\s*\(/i,
      vulnerability: "xss",
      sinkType: "html_output",
      severity: "medium",
      argument: "first",
      description: "classic-ASP direct response output of a dynamic value",
    },
  ],
  sanitizers: [
    {
      id: "vba.sql.parameters",
      vulnerability: "sql_injection",
      pattern: /\bCreateParameter\s*\(|\bParameters\.Append\s*\(/i,
      rationale: "ADODB CreateParameter/Parameters.Append binds values instead of interpolating them",
    },
    {
      id: "vba.path.get_file_name",
      vulnerability: "path_traversal",
      pattern: /\bGetFileName\s*\(/i,
      rationale: "FileSystemObject GetFileName strips directory components before use",
    },
    {
      id: "vba.cmd.numeric_validation",
      vulnerability: "command_injection",
      pattern: /\b(?:IsNumeric|CLng|CInt)\s*\(/i,
      rationale: "numeric validation/coercion rejects non-numeric text before the sink",
    },
  ],
  limits: [
    "VBA runs inside a host (Office / classic ASP); only the listed host input surfaces are sources",
    "COM methods reached through CreateObject are not resolved to their implementation",
    "macro-enabled document content is attacker-controlled: cell ranges count as sources only with .Value",
    "SendKeys, registry and shell APIs outside the list are not modelled",
  ],
}
