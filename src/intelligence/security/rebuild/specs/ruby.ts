// M72 — Ruby security spec (lane B). DATA only: lexical syntax plus
// source/sink/sanitizer rules; the rebuild engine (matcher + flow) decides
// whether a sink becomes a lead. Frozen contract: ../spec-types.ts.
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/{PLAN,LANGUAGES}.md,
//   validation/m72/fixtures/ruby/.
// CONTRACTS IT MUST NOT BREAK — sources are request/env/argv/file reads; sinks
//   are shell/SQL/code/deserialization/path APIs; compiled-in escaped variants
//   are sanitizers, not sinks.
// TIER — leads: lexical rules only; output is a lead to validate, not a finding.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "ruby",
  tier: "leads",
  tierReason: "Ruby source/sink rules; exec/backtick/SQL rules without data-flow proof",
  lexical: {
    lineComments: ["#"],
    blockComments: [["=begin", "=end"]],
    strings: [
      { delimiter: '"', escape: "\\" },
      { delimiter: "'", escape: "\\" },
    ],
  },
  sources: [
    {
      id: "ruby.params",
      pattern: /\bparams\s*\[/,
      sourceType: "user_input",
      description: "Rails request parameters hash",
      captureVariable: true,
    },
    {
      id: "ruby.env",
      pattern: /\bENV\s*\[/,
      sourceType: "env",
      description: "environment variable read via ENV[]",
    },
    {
      id: "ruby.argv",
      pattern: /\bARGV\b/,
      sourceType: "argv",
      description: "process argument vector ARGV",
    },
    {
      id: "ruby.stdin",
      pattern: /\bgets\b|\bSTDIN\b/,
      sourceType: "user_input",
      description: "standard-input read",
    },
    {
      id: "ruby.request",
      pattern: /\brequest\.(?:params|body|cookies|headers)\b/,
      sourceType: "user_input",
      description: "request object member (Rails/Sinatra)",
    },
    {
      id: "ruby.file_read",
      pattern: /\bFile\.(?:read|readlines)\s*\(/,
      sourceType: "file",
      description: "file contents read via File.read",
    },
  ],
  sinks: [
    {
      id: "ruby.cmd.process",
      pattern: /\b(?:system|exec|spawn)\s*\(/,
      vulnerability: "command_injection",
      sinkType: "shell_exec",
      severity: "critical",
      argument: "first",
      description: "Kernel#system/exec/spawn with a dynamic command string",
    },
    {
      id: "ruby.cmd.backtick",
      pattern: /`[^`\n]{0,240}\#\{/,
      vulnerability: "command_injection",
      sinkType: "shell_exec",
      severity: "critical",
      argument: "any",
      description: "backtick command with #{} interpolation",
    },
    {
      id: "ruby.cmd.percent_x",
      pattern: /%x[(\[{<]/,
      vulnerability: "command_injection",
      sinkType: "shell_exec",
      severity: "critical",
      argument: "any",
      description: "%x(...) shell-command literal",
    },
    {
      id: "ruby.code.eval",
      pattern: /\b(?:eval|instance_eval|class_eval|module_eval)\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "critical",
      argument: "first",
      description: "eval family compiles and runs Ruby source",
    },
    {
      id: "ruby.deser.marshal",
      pattern: /\bMarshal\.load\s*\(/,
      vulnerability: "insecure_deserialization",
      sinkType: "deserialize",
      severity: "high",
      argument: "first",
      description: "Marshal.load of untrusted bytes can instantiate arbitrary objects",
    },
    {
      id: "ruby.deser.yaml",
      pattern: /\bYAML\.(?:load|unsafe_load)\s*\(/,
      vulnerability: "insecure_deserialization",
      sinkType: "deserialize",
      severity: "high",
      argument: "first",
      description: "YAML.load/unsafe_load constructs arbitrary Ruby objects",
    },
    {
      id: "ruby.sql.statement",
      pattern: /\b(?:find_by_sql|execute|exec_query|exec_update)\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "sql_exec",
      severity: "high",
      argument: "all",
      description: "raw SQL execution on a dynamically built statement",
    },
    {
      id: "ruby.path.file_mutation",
      pattern: /\bFile\.(?:write|delete|rename)\s*\(|\bFileUtils\.(?:rm_rf|rm|mv|cp)\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_mutation",
      severity: "high",
      argument: "first",
      description: "file write/delete/move on a caller-influenced path",
    },
    {
      id: "ruby.ssrf.http",
      pattern: /\bURI\.open\s*\(|\bNet::HTTP\.(?:get|post|get_response|start)\s*\(/,
      vulnerability: "ssrf",
      sinkType: "http_request",
      severity: "high",
      argument: "first",
      description: "outbound HTTP request to a caller-controlled URL",
    },
  ],
  sanitizers: [
    {
      id: "ruby.cmd.shellwords",
      vulnerability: "command_injection",
      pattern: /\bShellwords\.(?:escape|shellescape|shellsplit|join)\s*\(/,
      rationale: "Shellwords escapes/joins arguments for a shell command line",
    },
    {
      id: "ruby.sql.bound",
      vulnerability: "sql_injection",
      pattern: /\b(?:where|having|find_by_sql)\s*\([^,()]+,\s*[^,()]+|\bsanitize_sql(?:_array|_for_database)?\s*\(/,
      rationale: "placeholder binding or sanitize_sql keeps values out of the SQL text",
    },
    {
      id: "ruby.xss.escape",
      vulnerability: "xss",
      pattern: /\b(?:ERB::Util\.html_escape|CGI\.escapeHTML)\s*\(/,
      rationale: "HTML entity encoding for the output context",
    },
    {
      id: "ruby.path.basename",
      vulnerability: "path_traversal",
      pattern: /\b(?:File\.basename|File\.expand_path)\s*\(/,
      rationale: "basename/expand_path constrain the path before the filesystem call",
    },
    {
      id: "ruby.deser.json",
      vulnerability: "insecure_deserialization",
      pattern: /\bJSON\.(?:parse|load)\s*\(/,
      rationale: "JSON parsing produces data objects only, never Ruby instances",
    },
    {
      id: "ruby.num.coerce",
      vulnerability: "*",
      pattern: /\b(?:Integer|Float)\s*\(/,
      rationale: "numeric coercion rejects non-numeric text before the sink",
    },
  ],
  limits: [
    "Ruby string interpolation (#{...}) is inside a masked literal, so a value assembled inside the string is only visible when a variable appears outside it",
    "backtick and %x command literals are treated as sinks rather than masked strings",
    "%q/%Q/%w percent literals and heredocs are not masked by the simple delimiter table",
    "Rails scope helpers and ActiveRecord models are matched lexically; model/schema awareness is not available",
  ],
}
