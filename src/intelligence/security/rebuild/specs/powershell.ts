// M72 — PowerShell security spec (lane B). DATA only: lexical syntax plus
// source/sink/sanitizer rules; the rebuild engine (matcher + flow) decides
// whether a sink becomes a lead. Frozen contract: ../spec-types.ts.
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/{PLAN,LANGUAGES}.md,
//   validation/m72/fixtures/powershell/.
// CONTRACTS IT MUST NOT BREAK — cmdlet names are case-insensitive (i flag);
//   here-strings are a masking gap declared in `limits`, not silently ignored.
// TIER — leads: lexical rules only; output is a lead to validate, not a finding.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "powershell",
  tier: "leads",
  tierReason: "PowerShell source/sink rules; Invoke-Expression/Start-Process rules without flow proof",
  lexical: {
    lineComments: ["#"],
    blockComments: [["<#", "#>"]],
    strings: [
      { delimiter: '"', escape: "`" },
      { delimiter: "'", escape: "'" },
    ],
  },
  sources: [
    {
      id: "powershell.param",
      pattern: /\bparam\s*\(/i,
      sourceType: "argv",
      description: "script/function param() values supplied by the caller",
    },
    {
      id: "powershell.args",
      pattern: /\$args\b/i,
      sourceType: "argv",
      description: "automatic $args argument array",
    },
    {
      id: "powershell.env",
      pattern: /\$env:[A-Za-z_]/i,
      sourceType: "env",
      description: "environment variable read via $env:NAME",
    },
    {
      id: "powershell.readhost",
      pattern: /\bRead-Host\b/i,
      sourceType: "user_input",
      description: "interactive Read-Host value",
    },
    {
      id: "powershell.request",
      pattern: /\$Request\.(?:QueryString|Form|Params)\b/i,
      sourceType: "user_input",
      description: "ASP.NET/PSWeb request collection member",
      captureVariable: true,
    },
    {
      id: "powershell.file_read",
      pattern: /\bGet-Content\b/i,
      sourceType: "file",
      description: "file contents read with Get-Content",
    },
  ],
  sinks: [
    {
      id: "powershell.code.invoke_expression",
      pattern: /\bInvoke-Expression\b|\biex\s+/i,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "critical",
      argument: "any",
      description: "Invoke-Expression/iex evaluates a string as PowerShell code",
    },
    {
      id: "powershell.code.scriptblock_create",
      pattern: /\[scriptblock\]\s*::\s*Create\s*\(/i,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "critical",
      argument: "first",
      description: "[scriptblock]::Create compiles a dynamic code string",
    },
    {
      id: "powershell.code.add_type",
      pattern: /\bAdd-Type\b/i,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "critical",
      argument: "any",
      description: "Add-Type compiles caller-supplied source into the session",
    },
    {
      id: "powershell.cmd.start_process",
      pattern: /\bStart-Process\b/i,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "critical",
      argument: "any",
      description: "Start-Process launches a caller-influenced executable/arguments",
    },
    {
      id: "powershell.cmd.call_operator",
      pattern: /&\s*\$\w/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "critical",
      argument: "any",
      description: "call operator on a variable executes a runtime-chosen command",
    },
    {
      id: "powershell.sql.invoke_sqlcmd",
      pattern: /\bInvoke-Sqlcmd\b/i,
      vulnerability: "sql_injection",
      sinkType: "sql_exec",
      severity: "high",
      argument: "any",
      description: "Invoke-Sqlcmd executes a dynamically built query",
    },
    {
      id: "powershell.path.file_mutation",
      pattern: /\b(?:Set-Content|Out-File|Remove-Item)\b/i,
      vulnerability: "path_traversal",
      sinkType: "file_mutation",
      severity: "high",
      argument: "any",
      description: "write/delete of a caller-influenced path",
    },
    {
      id: "powershell.ssrf.invoke_webrequest",
      pattern: /\bInvoke-WebRequest\b/i,
      vulnerability: "ssrf",
      sinkType: "http_request",
      severity: "high",
      argument: "any",
      description: "Invoke-WebRequest to a caller-controlled URL",
    },
    {
      id: "powershell.deser.import_clixml",
      pattern: /\bImport-Clixml\b/i,
      vulnerability: "insecure_deserialization",
      sinkType: "deserialize",
      severity: "high",
      argument: "any",
      description: "Import-Clixml deserializes CLIXML, which can reconstruct objects",
    },
  ],
  sanitizers: [
    {
      id: "powershell.code.parser_ast",
      vulnerability: "code_injection",
      pattern: /Parser\s*\]\s*::\s*ParseInput\s*\(/i,
      rationale: "Parser::ParseInput only parses the text into an AST; nothing is executed",
    },
    {
      id: "powershell.cmd.validated_parameter",
      vulnerability: "*",
      pattern: /\[Validate(?:Set|Pattern|Script|Range|Length)\s*\(/i,
      rationale: "a Validate* attribute restricts the value before the parameter is used",
    },
    {
      id: "powershell.cmd.argument_list",
      vulnerability: "command_injection",
      pattern: /-ArgumentList\s+@\(/i,
      rationale: "Start-Process -ArgumentList @(...) passes an array instead of one command line string",
    },
    {
      id: "powershell.sql.variables",
      vulnerability: "sql_injection",
      pattern: /-Variable\b/i,
      rationale: "Invoke-Sqlcmd -Variable binds values instead of interpolating them into the query",
    },
    {
      id: "powershell.path.getfilename",
      vulnerability: "path_traversal",
      pattern: /\[System\.IO\.Path\]\s*::\s*GetFileName\s*\(/i,
      rationale: "GetFileName strips directory components before the path is used",
    },
  ],
  limits: [
    "PowerShell here-strings (@\"...\"@ / @'...'@) are not masked by the simple delimiter table",
    "aliases and provider indirection are not resolved (gci, custom functions, module-qualified names)",
    "the call operator & is a sink only when its target is a variable; indirect scriptblock callables are not traced",
    "job/WMI/remoting execution paths and dynamic module loading are not modelled",
  ],
}
