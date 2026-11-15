// M72 — Objective-C security spec (lane B). DATA only: lexical syntax plus
// source/sink/sanitizer rules; the rebuild engine (matcher + flow) decides
// whether a sink becomes a lead. Frozen contract: ../spec-types.ts.
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/{PLAN,LANGUAGES}.md,
//   validation/m72/fixtures/objective-c/.
// CONTRACTS IT MUST NOT BREAK — message sends are matched by their real
//   selector shape; user-interface text and process/environment values are
//   sources; launch/exec, SQL, archive and path APIs are sinks.
// TIER — leads: lexical rules only; output is a lead to validate, not a finding.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "objective-c",
  tier: "leads",
  tierReason: "Obj-C source/sink rules; message-send rules without dispatch/flow proof",
  lexical: {
    lineComments: ["//"],
    blockComments: [["/*", "*/"]],
    strings: [
      { delimiter: '"', escape: "\\" },
      { delimiter: "'", escape: "\\" },
    ],
  },
  sources: [
    {
      id: "objc.env",
      pattern: /\bgetenv\s*\(/,
      sourceType: "env",
      description: "environment variable read",
    },
    {
      id: "objc.argv",
      pattern: /\bNSProcessInfo\b[^;\n]{0,80}\barguments\b/,
      sourceType: "argv",
      description: "process argument vector ([NSProcessInfo processInfo].arguments)",
    },
    {
      id: "objc.file_read",
      pattern: /\bcontentsOf(?:File|URL)\s*:/,
      sourceType: "file",
      description: "file/URL contents initializer",
    },
    {
      id: "objc.network",
      pattern: /\bdataTaskWith(?:Request|URL)\b/,
      sourceType: "network",
      description: "NSURLSession response data",
    },
    {
      id: "objc.ui_text",
      pattern: /\b(?:UITextField|UITextView|NSTextField)\b[^;\n]{0,160}?\.text\b/,
      sourceType: "user_input",
      description: "text entered into a UI text field",
    },
  ],
  sinks: [
    {
      id: "objc.cmd.system",
      pattern: /\b(?:system|popen)\s*\(/,
      vulnerability: "command_injection",
      sinkType: "shell_exec",
      severity: "critical",
      argument: "first",
      description: "system()/popen() shell execution",
    },
    {
      id: "objc.cmd.nstask_launch",
      pattern: /\bNSTask\b[^;\n]{0,120}?\blaunch\b/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "any",
      description: "NSTask launch with a dynamically configured executable/arguments",
    },
    {
      id: "objc.code.perform_selector",
      pattern: /\bperformSelector\s*:/,
      vulnerability: "code_injection",
      sinkType: "code_load",
      severity: "high",
      argument: "any",
      description: "performSelector: invokes a runtime-chosen selector",
    },
    {
      id: "objc.code.class_lookup",
      pattern: /\bNSClassFromString\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_load",
      severity: "high",
      argument: "first",
      description: "NSClassFromString resolves a runtime-chosen class",
    },
    {
      id: "objc.sql.execute",
      pattern: /\bexecute(?:Query|Update)\s*:/,
      vulnerability: "sql_injection",
      sinkType: "sql_exec",
      severity: "high",
      argument: "any",
      description: "FMDB executeQuery:/executeUpdate: on a dynamically built statement",
    },
    {
      id: "objc.path.write_file",
      pattern: /\bwriteToFile\s*:/,
      vulnerability: "path_traversal",
      sinkType: "file_write",
      severity: "high",
      argument: "any",
      description: "writeToFile: on a caller-influenced path",
    },
    {
      id: "objc.deser.unarchiver",
      pattern: /\bNSKeyedUnarchiver\b|\bunarchiveObject\b/,
      vulnerability: "insecure_deserialization",
      sinkType: "deserialize",
      severity: "high",
      argument: "all",
      description: "NSKeyedUnarchiver decoding of untrusted archive data",
    },
    {
      id: "objc.ssrf.url_load",
      pattern: /\bdataWithContentsOfURL\s*:/,
      vulnerability: "ssrf",
      sinkType: "http_request",
      severity: "high",
      argument: "any",
      description: "synchronous request to a caller-controlled URL",
    },
    {
      id: "objc.code.evaluate_javascript",
      pattern: /\bevaluateJavaScript\s*:/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "high",
      argument: "any",
      description: "WKWebView evaluateJavaScript: of a dynamic script string",
    },
  ],
  sanitizers: [
    {
      id: "objc.sql.bound_arguments",
      vulnerability: "sql_injection",
      pattern: /withArgumentsInArray\s*:|withParameterDictionary\s*:/,
      rationale: "FMDB withArgumentsInArray:/withParameterDictionary: binds values instead of interpolating them",
    },
    {
      id: "objc.path.last_component",
      vulnerability: "path_traversal",
      pattern: /\.lastPathComponent\b/,
      rationale: "lastPathComponent discards directory components before the path is used",
    },
    {
      id: "objc.cmd.posix_spawn",
      vulnerability: "command_injection",
      pattern: /\bposix_spawn\s*\(/,
      rationale: "posix_spawn passes an argv array without a shell",
    },
    {
      id: "objc.num.coerce",
      vulnerability: "*",
      pattern: /\.(?:integerValue|intValue|longLongValue|boolValue)\b/,
      rationale: "numeric property conversion rejects non-numeric text before the sink",
    },
    {
      id: "objc.url.percent_encoding",
      vulnerability: "*",
      pattern: /stringByAddingPercentEncodingWithAllowedCharacters/,
      rationale: "percent encoding constrains URL/path construction from a value",
    },
  ],
  limits: [
    "Objective-C message sends are matched lexically; dynamic dispatch through `id` cannot be resolved",
    "blocks and categories can perform the sink elsewhere; no interprocedural flow",
    "process launch configuration spans statements (launchPath/arguments); only the listed selector shapes are matched",
    "the spec targets Foundation/UIKit/WKWebView and FMDB; third-party frameworks are not modelled",
  ],
}
