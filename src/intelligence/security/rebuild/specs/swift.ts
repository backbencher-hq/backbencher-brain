// M72 — Swift security spec (lane B). DATA only: lexical syntax plus
// source/sink/sanitizer rules; the rebuild engine (matcher + flow) decides
// whether a sink becomes a lead. Frozen contract: ../spec-types.ts.
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/{PLAN,LANGUAGES}.md,
//   validation/m72/fixtures/swift/.
// CONTRACTS IT MUST NOT BREAK — Process/NSTask configuration is matched as
//   calls and assignments, and a launch with constant arguments is still not a
//   lead because the argument selector requires a dynamic value.
// TIER — leads: lexical rules only; output is a lead to validate, not a finding.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "swift",
  tier: "leads",
  tierReason: "Swift source/sink rules; Process/URLSession rules without data-flow proof",
  lexical: {
    lineComments: ["//"],
    blockComments: [["/*", "*/"]],
    strings: [
      { delimiter: '"', escape: "\\" },
      { delimiter: '"""', escape: "\\", multiline: true },
    ],
  },
  sources: [
    {
      id: "swift.env",
      pattern: /\bProcessInfo\.processInfo\.environment\b/,
      sourceType: "env",
      description: "process environment dictionary",
    },
    {
      id: "swift.argv",
      pattern: /\bCommandLine\.arguments\b/,
      sourceType: "argv",
      description: "process argument vector",
    },
    {
      id: "swift.stdin",
      pattern: /\breadLine\s*\(/,
      sourceType: "user_input",
      description: "standard-input line read",
    },
    {
      id: "swift.file_read",
      pattern: /\bcontentsOf(?:File|URL)\s*:/,
      sourceType: "file",
      description: "file/URL contents initializer (String(contentsOfFile:))",
    },
    {
      id: "swift.network",
      pattern: /\bdataTask\s*\(/,
      sourceType: "network",
      description: "URLSession data task response body",
    },
    {
      id: "swift.ui_text",
      pattern: /\b(?:textField|searchBar|textView)\.text\b/,
      sourceType: "user_input",
      description: "UIKit text-field/search-bar input value",
    },
  ],
  sinks: [
    {
      id: "swift.cmd.posix",
      pattern: /\b(?:system|popen)\s*\(/,
      vulnerability: "command_injection",
      sinkType: "shell_exec",
      severity: "critical",
      argument: "first",
      description: "Darwin system()/popen() shell execution",
    },
    {
      id: "swift.cmd.posix_spawn",
      pattern: /\bposix_spawn\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "critical",
      argument: "all",
      description: "posix_spawn of a runtime-chosen executable/argv",
    },
    {
      id: "swift.code.class_lookup",
      pattern: /\bNSClassFromString\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_load",
      severity: "high",
      argument: "first",
      description: "NSClassFromString resolves a runtime-chosen class",
    },
    {
      id: "swift.sql.sqlite",
      pattern: /\bsqlite3_exec\s*\(|\bsqlite3_prepare_v2\s*\(|\bdb\.run\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "sql_exec",
      severity: "high",
      argument: "all",
      description: "SQLite statement execution on a dynamically built statement",
    },
    {
      id: "swift.deser.keyed_unarchiver",
      pattern: /\bNSKeyedUnarchiver\b|\bunarchiveObject\b/,
      vulnerability: "insecure_deserialization",
      sinkType: "deserialize",
      severity: "high",
      argument: "all",
      description: "NSKeyedUnarchiver decoding of untrusted archive data",
    },
    {
      id: "swift.ssrf.urlsession",
      pattern: /\bURLSession\.(?:shared|ephemeral|configuration)?[^;\n]{0,60}?\.(?:data|dataTask|downloadTask)\s*\(/,
      vulnerability: "ssrf",
      sinkType: "http_request",
      severity: "high",
      argument: "any",
      description: "URLSession request to a caller-controlled URL",
    },
    {
      id: "swift.path.filemanager",
      pattern: /\bFileManager\.default\.(?:removeItem|moveItem|copyItem|createFile|createDirectory)\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_mutation",
      severity: "high",
      argument: "first",
      description: "FileManager mutation on a caller-influenced path",
    },
    {
      id: "swift.webview.evaluate_js",
      pattern: /\bevaluateJavaScript\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "high",
      argument: "first",
      description: "WKWebView evaluateJavaScript of a dynamic script string",
    },
    {
      id: "swift.crypto.insecure",
      pattern: /\b(?:CC_MD5|CC_SHA1|Insecure\.MD5|Insecure\.SHA1)\b/,
      vulnerability: "weak_crypto",
      sinkType: "weak_hash",
      severity: "medium",
      argument: "any",
      description: "CommonCrypto/CryptoKit insecure hash (MD5/SHA-1)",
    },
  ],
  sanitizers: [
    {
      id: "swift.cmd.arguments_array",
      vulnerability: "command_injection",
      pattern: /\b(?:Process|NSTask)\b[^;\n]{0,160}?\.arguments\s*=\s*\[/,
      rationale: "Process/NSTask .arguments = [...] separates arguments from the executable",
    },
    {
      id: "swift.sql.bind",
      vulnerability: "sql_injection",
      pattern: /\bsqlite3_bind_\w+\s*\(|\.prepare\s*\(/,
      rationale: "sqlite3_bind_* / prepared statements bind values instead of interpolating them",
    },
    {
      id: "swift.path.last_component",
      vulnerability: "path_traversal",
      pattern: /\blastPathComponent\b/,
      rationale: "lastPathComponent discards directory components before the path is used",
    },
    {
      id: "swift.deser.secure_coding",
      vulnerability: "insecure_deserialization",
      pattern: /requiringSecureCoding\s*:\s*true/,
      rationale: "requiringSecureCoding enforces NSSecureCoding classes during decoding",
    },
    {
      id: "swift.num.coerce",
      vulnerability: "*",
      pattern: /\b(?:Int|Double|UInt)\s*\(\s*[A-Za-z_]/,
      rationale: "numeric conversion rejects non-numeric text before the sink",
    },
  ],
  limits: [
    "Swift string interpolation (\\(...)) is inside a masked literal and not visible to the matcher",
    "protocol-oriented dispatch and Objective-C bridging hide the concrete sink",
    "Process/NSTask configuration spans statements; the rule matches the call/assignment shapes only",
    "UIKit/WebKit input surfaces beyond the listed text fields are not sources",
  ],
}
