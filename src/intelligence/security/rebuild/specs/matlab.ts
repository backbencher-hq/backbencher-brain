// M72 — MATLAB security spec (lane B). DATA only: lexical syntax plus
// source/sink/sanitizer rules; the rebuild engine (matcher + flow) decides
// whether a sink becomes a lead. Frozen contract: ../spec-types.ts.
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/{PLAN,LANGUAGES}.md,
//   validation/m72/fixtures/matlab/.
// CONTRACTS IT MUST NOT BREAK — system/unix/dos/eval/evalin are evaluated-code
//   or shell sinks; input/getenv/fileread are the external-input sources; a
//   constant command string is never a lead.
// TIER — leads: lexical rules only; output is a lead to validate, not a finding.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "matlab",
  tier: "leads",
  tierReason: "MATLAB source/sink rules; system/eval rules without data-flow proof",
  lexical: {
    lineComments: ["%"],
    blockComments: [["%{", "%}"]],
    strings: [
      { delimiter: "'", escape: "'" },
      { delimiter: '"', escape: '"' },
    ],
  },
  sources: [
    {
      id: "matlab.input",
      pattern: /\binput\s*\(/,
      sourceType: "user_input",
      description: "console prompt value from input()",
    },
    {
      id: "matlab.env",
      pattern: /\bgetenv\s*\(/,
      sourceType: "env",
      description: "environment variable read",
    },
    {
      id: "matlab.file_read",
      pattern: /\bfileread\s*\(/,
      sourceType: "file",
      description: "file contents read with fileread()",
    },
    {
      id: "matlab.network",
      pattern: /\bwebread\s*\(/,
      sourceType: "network",
      description: "HTTP response data from webread()",
    },
    {
      id: "matlab.varargin",
      pattern: /\bvarargin\b/,
      sourceType: "argv",
      description: "caller-supplied variadic argument cell (varargin)",
    },
  ],
  sinks: [
    {
      id: "matlab.cmd.system",
      pattern: /\bsystem\s*\(/,
      vulnerability: "command_injection",
      sinkType: "shell_exec",
      severity: "critical",
      argument: "first",
      description: "system() runs an OS shell command string",
    },
    {
      id: "matlab.cmd.unix",
      pattern: /\bunix\s*\(/,
      vulnerability: "command_injection",
      sinkType: "shell_exec",
      severity: "critical",
      argument: "first",
      description: "unix() runs a shell command string",
    },
    {
      id: "matlab.cmd.dos",
      pattern: /\bdos\s*\(/,
      vulnerability: "command_injection",
      sinkType: "shell_exec",
      severity: "critical",
      argument: "first",
      description: "dos() runs a Windows shell command string",
    },
    {
      id: "matlab.code.eval",
      pattern: /\beval\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "critical",
      argument: "first",
      description: "eval() executes a dynamic MATLAB expression",
    },
    {
      id: "matlab.code.evalin",
      pattern: /\bevalin\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "critical",
      argument: "all",
      description: "evalin() executes a dynamic expression in a workspace",
    },
    {
      id: "matlab.code.feval",
      pattern: /\bfeval\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "high",
      argument: "all",
      description: "feval() executes a function named by a dynamic value",
    },
    {
      id: "matlab.sql.exec",
      pattern: /\bexec\s*\(\s*[A-Za-z_]\w*\s*,/,
      vulnerability: "sql_injection",
      sinkType: "sql_exec",
      severity: "high",
      argument: "all",
      description: "database exec(conn, statement) on a dynamically built statement",
    },
    {
      id: "matlab.path.fopen",
      pattern: /\bfopen\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_open",
      severity: "high",
      argument: "first",
      description: "fopen() on a caller-influenced path",
    },
    {
      id: "matlab.path.save",
      pattern: /\bsave\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_write",
      severity: "medium",
      argument: "first",
      description: "save() writes a MAT-file to a caller-influenced path",
    },
    {
      id: "matlab.ssrf.webwrite",
      pattern: /\bwebwrite\s*\(/,
      vulnerability: "ssrf",
      sinkType: "http_request",
      severity: "medium",
      argument: "first",
      description: "webwrite() sends data to a caller-controlled URL",
    },
  ],
  sanitizers: [
    {
      id: "matlab.validate.attributes",
      vulnerability: "*",
      pattern: /\bvalidateattributes\s*\(/,
      rationale: "validateattributes enforces class/range constraints on the argument",
    },
    {
      id: "matlab.validate.member",
      vulnerability: "*",
      pattern: /\bmustBeMember\s*\(/,
      rationale: "mustBeMember restricts the value to an allowed set",
    },
    {
      id: "matlab.validate.string",
      vulnerability: "*",
      pattern: /\bvalidatestring\s*\(/,
      rationale: "validatestring matches the value against an allowed string set",
    },
    {
      id: "matlab.sql.bound",
      vulnerability: "sql_injection",
      pattern: /\bexec\s*\([^,()]+,[^,()]+,/,
      rationale: "exec(conn, statement, params) binds parameter values instead of interpolating them",
    },
    {
      id: "matlab.path.fileparts",
      vulnerability: "path_traversal",
      pattern: /\bfileparts\s*\(/,
      rationale: "fileparts splits the path so directory components can be rejected before use",
    },
  ],
  limits: [
    "MATLAB eval/evalin/feval receive code strings; the generated code is not analysed",
    "`%{` block comments are only meaningful at the start of a line; the matcher treats them as plain block delimiters",
    "web-app request objects (App Designer / matlab.net) vary by product version and are not modelled as sources",
    "fopen/save are path sinks only; whether the path actually escapes a root is not proven",
    "string arrays and cellstr conversions are not tracked, so a tainted value stored in a cell may be missed",
  ],
}
