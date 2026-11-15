// M72 — Nim security spec (lane B). DATA only: lexical syntax plus
// source/sink/sanitizer rules; the rebuild engine (matcher + flow) decides
// whether a sink becomes a lead. Frozen contract: ../spec-types.ts.
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/{PLAN,LANGUAGES}.md,
//   validation/m72/fixtures/nim/.
// CONTRACTS IT MUST NOT BREAK — paramStr/getEnv/readLine/readFile are sources;
//   osproc exec family, db exec and file mutation are sinks; argv-sequence
//   process calls are the sanitized form.
// TIER — leads: lexical rules only; output is a lead to validate, not a finding.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "nim",
  tier: "leads",
  tierReason: "Nim source/sink rules; execProcess rules without data-flow proof",
  lexical: {
    lineComments: ["#"],
    blockComments: [["#[", "]#"]],
    strings: [
      { delimiter: '"', escape: "\\" },
      { delimiter: '"""', escape: "\\", multiline: true },
      { delimiter: "'", escape: "\\" },
    ],
  },
  sources: [
    {
      id: "nim.stdin",
      pattern: /\breadLine\s*\(\s*stdin\s*\)/,
      sourceType: "user_input",
      description: "readLine(stdin) standard-input value",
    },
    {
      id: "nim.env",
      pattern: /\bgetEnv\s*\(/,
      sourceType: "env",
      description: "environment variable read (os.getEnv)",
    },
    {
      id: "nim.argv",
      pattern: /\bparamStr\s*\(/,
      sourceType: "argv",
      description: "command-line argument (os.paramStr)",
    },
    {
      id: "nim.argc",
      pattern: /\bparamCount\s*\(/,
      sourceType: "argv",
      description: "command-line argument count (os.paramCount)",
    },
    {
      id: "nim.file_read",
      pattern: /\breadFile\s*\(/,
      sourceType: "file",
      description: "file contents read with readFile()",
    },
    {
      id: "nim.network",
      pattern: /\.getContent\s*\(/,
      sourceType: "network",
      description: "HTTP response body from HttpClient getContent",
    },
  ],
  sinks: [
    {
      id: "nim.cmd.exec_shell",
      pattern: /\bexecShellCmd\s*\(/,
      vulnerability: "command_injection",
      sinkType: "shell_exec",
      severity: "critical",
      argument: "first",
      description: "os.execShellCmd runs a command through the shell",
    },
    {
      id: "nim.cmd.exec_process",
      pattern: /\bexecProcess\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "critical",
      argument: "first",
      description: "osproc.execProcess with a dynamically built command line",
    },
    {
      id: "nim.cmd.exec_cmd",
      pattern: /\bexecCmd(?:Ex)?\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "critical",
      argument: "first",
      description: "osproc.execCmd/execCmdEx executes a command line",
    },
    {
      id: "nim.cmd.start_process",
      pattern: /\bstartProcess\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "all",
      description: "osproc.startProcess with caller-influenced program/arguments",
    },
    {
      id: "nim.sql.exec",
      pattern: /\b(?:db|conn|database)\.(?:exec|rawExec|execSQL)\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "sql_exec",
      severity: "high",
      argument: "all",
      description: "db_sqlite statement execution on a dynamically built statement",
    },
    {
      id: "nim.path.write_file",
      pattern: /\bwriteFile\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_mutation",
      severity: "high",
      argument: "first",
      description: "writeFile on a caller-influenced path",
    },
    {
      id: "nim.path.remove_file",
      pattern: /\b(?:removeFile|removeDir|moveFile)\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_mutation",
      severity: "high",
      argument: "first",
      description: "file removal/move on a caller-influenced path",
    },
    {
      id: "nim.ssrf.http_client",
      pattern: /\b(?:client|http|request)\.(?:get|post|request)\s*\(/,
      vulnerability: "ssrf",
      sinkType: "http_request",
      severity: "high",
      argument: "first",
      description: "HTTP client request to a caller-controlled URL",
    },
    {
      id: "nim.crypto.weak_hash",
      pattern: /\bgetMD5\s*\(|\bsecureHash\s*\(/,
      vulnerability: "weak_crypto",
      sinkType: "weak_hash",
      severity: "medium",
      argument: "first",
      description: "MD5/SHA-1 hashing of untrusted data",
    },
  ],
  sanitizers: [
    {
      id: "nim.sql.params",
      vulnerability: "sql_injection",
      pattern: /\.exec\s*\([^,()]+,[^,()]+/,
      rationale: "db.exec(sql, args) binds parameters instead of interpolating them",
    },
    {
      id: "nim.cmd.argv_literal",
      vulnerability: "command_injection",
      pattern: /\b(?:execProcess|startProcess)\s*\(\s*@\[|\bstartProcess\s*\([^,()]+,\s*(?:args\s*=\s*)?@?\[/,
      rationale: "sequence/args form passes argv separately instead of a shell command line",
    },
    {
      id: "nim.path.extract_filename",
      vulnerability: "path_traversal",
      pattern: /\b(?:extractFilename|splitFile)\s*\(/,
      rationale: "extractFilename/splitFile strip directory components before use",
    },
    {
      id: "nim.num.parse_int",
      vulnerability: "*",
      pattern: /\b(?:parseInt|parseFloat|parseBiggestInt)\s*\(/,
      rationale: "numeric parsing rejects values that are not the expected number",
    },
    {
      id: "nim.code.compile_time",
      vulnerability: "code_injection",
      pattern: /\b(?:staticExec|parseStmt|parseExpr)\s*\(/,
      rationale: "these run at compile time; the generated statement is not executed at runtime by this path",
    },
  ],
  limits: [
    "Nim is compiled: there is no runtime eval, so code injection is only reachable through compile-time/macro helpers not modelled here",
    "raw string literals (r\"...\") and & string concatenation/interpolation are not fully masked",
    "execProcess/execCmd always go through a shell on POSIX; the argv-sequence form is treated as sanitized",
    "the spec targets the standard library (os, osproc, db_sqlite, httpclient); third-party packages are not modelled",
  ],
}
