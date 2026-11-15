// M72 — PHP security spec (lane B). DATA only: lexical syntax plus
// source/sink/sanitizer rules; the rebuild engine (matcher + flow) decides
// whether a sink becomes a lead. Frozen contract: ../spec-types.ts.
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/{PLAN,LANGUAGES}.md,
//   validation/m72/fixtures/php/.
// CONTRACTS IT MUST NOT BREAK — superglobals are sources, not sinks; every sink
//   is a real PHP API with an argument selector; PHP function names are
//   case-insensitive, so the rules carry the i flag.
// TIER — leads: lexical rules only; output is a lead to validate, not a finding.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "php",
  tier: "leads",
  tierReason: "PHP source/sink rules; superglobal/shell rules without data-flow proof",
  lexical: {
    lineComments: ["//", "#"],
    blockComments: [["/*", "*/"]],
    strings: [
      { delimiter: '"', escape: "\\" },
      { delimiter: "'", escape: "\\" },
    ],
  },
  sources: [
    {
      id: "php.superglobal",
      pattern: /\$_(?:GET|POST|REQUEST|COOKIE|FILES|SERVER)\b/i,
      sourceType: "user_input",
      description: "PHP request superglobal ($_GET/$_POST/$_REQUEST/...)",
      captureVariable: true,
    },
    {
      id: "php.env",
      pattern: /\bgetenv\s*\(/i,
      sourceType: "env",
      description: "environment variable read",
    },
    {
      id: "php.argv",
      pattern: /\$argv\b/i,
      sourceType: "argv",
      description: "CLI argument vector",
    },
    {
      id: "php.stdin",
      pattern: /\bSTDIN\b/i,
      sourceType: "user_input",
      description: "standard-input stream",
    },
    {
      id: "php.filter_input",
      pattern: /\bfilter_input\s*\(/i,
      sourceType: "user_input",
      description: "filter_input() input value (unvalidated unless a FILTER_VALIDATE_* flag is checked)",
    },
  ],
  sinks: [
    {
      id: "php.cmd.shell",
      pattern: /\b(?:system|exec|shell_exec|passthru|proc_open|popen)\s*\(/i,
      vulnerability: "command_injection",
      sinkType: "shell_exec",
      severity: "critical",
      argument: "first",
      description: "PHP shell execution family (system/exec/shell_exec/... )",
    },
    {
      id: "php.cmd.backtick",
      pattern: /`[^`\n]{0,240}\$/,
      vulnerability: "command_injection",
      sinkType: "shell_exec",
      severity: "critical",
      argument: "any",
      description: "backtick operator executes a shell command string",
    },
    {
      id: "php.code.eval",
      pattern: /\beval\s*\(/i,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "critical",
      argument: "first",
      description: "eval() executes PHP code",
    },
    {
      id: "php.code.include",
      pattern: /\b(?:include|include_once|require|require_once)\b\s*\(?\s*\$/i,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "high",
      argument: "any",
      description: "dynamic include/require of a caller-influenced path",
    },
    {
      id: "php.sql.query",
      pattern: /\b(?:mysqli_query|mysql_query|pg_query|sqlite_query)\s*\(|->\s*(?:query|exec)\s*\(/i,
      vulnerability: "sql_injection",
      sinkType: "sql_exec",
      severity: "high",
      argument: "all",
      description: "query execution on a dynamically built statement (mysqli/pg/PDO)",
    },
    {
      id: "php.deser.unserialize",
      pattern: /\bunserialize\s*\(/i,
      vulnerability: "insecure_deserialization",
      sinkType: "deserialize",
      severity: "high",
      argument: "first",
      description: "unserialize() of untrusted data can instantiate arbitrary objects",
    },
    {
      id: "php.path.file_mutation",
      pattern: /\b(?:file_put_contents|fwrite|unlink|rename|move_uploaded_file)\s*\(/i,
      vulnerability: "path_traversal",
      sinkType: "file_mutation",
      severity: "high",
      argument: "first",
      description: "file write/delete/move on a caller-influenced path",
    },
    {
      id: "php.ssrf.curl",
      pattern: /\bcurl_init\s*\(/i,
      vulnerability: "ssrf",
      sinkType: "http_request",
      severity: "high",
      argument: "first",
      description: "cURL request to a caller-controlled URL",
    },
    {
      id: "php.xss.output",
      pattern: /\becho\b\s+\$|\becho\s*\(\s*\$|\bprintf\s*\(/i,
      vulnerability: "xss",
      sinkType: "html_output",
      severity: "medium",
      argument: "any",
      description: "direct output of a PHP variable into the response body",
    },
    {
      id: "php.crypto.weak_hash",
      pattern: /\b(?:md5|sha1)\s*\(/i,
      vulnerability: "weak_crypto",
      sinkType: "weak_hash",
      severity: "medium",
      argument: "first",
      description: "MD5/SHA-1 hash of untrusted data",
    },
  ],
  sanitizers: [
    {
      id: "php.sql.escape",
      vulnerability: "sql_injection",
      pattern: /\b(?:mysqli_real_escape_string|mysql_real_escape_string|pg_escape_string)\s*\(/i,
      rationale: "driver-level string escaping for the active connection",
    },
    {
      id: "php.sql.prepared",
      vulnerability: "sql_injection",
      pattern: /->\s*prepare\s*\(|\bPDO::prepare\s*\(/i,
      rationale: "prepared statement keeps the statement text separate from bound values",
    },
    {
      id: "php.cmd.escape",
      vulnerability: "command_injection",
      pattern: /\b(?:escapeshellarg|escapeshellcmd)\s*\(/i,
      rationale: "escapeshellarg/escapeshellcmd shell-escape the value before use",
    },
    {
      id: "php.xss.escape",
      vulnerability: "xss",
      pattern: /\b(?:htmlspecialchars|htmlentities)\s*\(/i,
      rationale: "HTML entity encoding for the response context",
    },
    {
      id: "php.path.basename",
      vulnerability: "path_traversal",
      pattern: /\bbasename\s*\(/i,
      rationale: "basename strips directory components before the path is used",
    },
    {
      id: "php.code.realpath",
      vulnerability: "code_injection",
      pattern: /\brealpath\s*\(/i,
      rationale: "realpath resolves a path inside the filesystem before it is included",
    },
    {
      id: "php.input.filter_validate",
      vulnerability: "*",
      pattern: /\bfilter_var\s*\([^)]*FILTER_VALIDATE/i,
      rationale: "FILTER_VALIDATE_* rejects values that do not match the expected type",
    },
  ],
  limits: [
    "heredoc/nowdoc literals are not masked by the simple delimiter table; text inside them can match rules",
    "backtick shell execution is treated as a sink rather than a masked string literal",
    "variable variables ($$name), dynamic function names ($fn()) and included templates are not resolved",
    "framework input helpers beyond the superglobals (Laravel request(), Symfony Request) are not sources yet",
    "include/require is reported as code_injection when the path is dynamic; whether the target is code is not proven",
  ],
}
