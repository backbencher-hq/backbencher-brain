// M72 — Kotlin security spec (lane A, specs-a).
//
// WHAT THIS FILE IS — lexical source/sink rules for Kotlin (JVM + Android).
// A rule is a RegExp over the spec-masked symbol body plus the fields the flow
// engine needs.
//
// CONVENTIONS — a sink pattern ends at the callee's opening paren; the flow
// engine balances brackets and reads the argument text. Sanitizers are evaluated
// against the original (unmasked) call text, so `?` placeholders are visible.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "kotlin",
  tier: "leads",
  tierReason: "Kotlin lexical rules only: no interprocedural flow, so a match is a lead to validate.",
  lexical: {
    lineComments: ["//"],
    // Kotlin block comments nest; the delimiter model does not, so a nested
    // /* */ ends the mask early (see limits).
    blockComments: [["/*", "*/"]],
    strings: [
      { delimiter: '"""', escape: "\\", multiline: true },
      { delimiter: '"', escape: "\\" },
      { delimiter: "'", escape: "\\" },
    ],
  },
  sources: [
    {
      id: "kotlin.source.servlet-request",
      pattern: /\brequest\.(?:getParameter\w*|getHeader\w*|getInputStream|getReader)\s*\(/,
      sourceType: "user_input",
      description: "servlet request parameter/header/body access",
    },
    {
      id: "kotlin.source.getenv",
      pattern: /\bSystem\.getenv\s*\(/,
      sourceType: "env",
      description: "System.getenv reads a process environment variable",
    },
    {
      id: "kotlin.source.args",
      pattern: /\bargs\s*\[/,
      sourceType: "cli",
      description: "main(args) element — command-line input",
    },
    {
      id: "kotlin.source.readline",
      pattern: /\breadLine\s*\(/,
      sourceType: "user_input",
      description: "readLine/stdin read — externally supplied input",
    },
    {
      id: "kotlin.source.file-read",
      pattern: /\bread(?:Text|Lines|Bytes)\s*\(/,
      sourceType: "file",
      description: "File.readText/readLines/readBytes — file content",
    },
    {
      id: "kotlin.source.spring-param",
      pattern: /@(?:RequestParam|PathVariable|RequestHeader|RequestBody)\b/,
      sourceType: "user_input",
      description: "Spring MVC annotation — the parameter is bound from the request",
    },
  ],
  sinks: [
    {
      id: "kotlin.sink.runtime-exec",
      // Anchored on the final `.exec(` token: a pattern starting at
      // `Runtime.getRuntime()` would make the engine read getRuntime()'s empty
      // argument list as the sink argument.
      pattern: /(?<=\.)\s*exec\s*\(/,
      vulnerability: "command_injection",
      sinkType: "shell_command",
      severity: "high",
      argument: "all",
      description: "exec(…) method call (Runtime.exec style) runs a command string through the shell",
    },
    {
      id: "kotlin.sink.process-builder",
      pattern: /\bProcessBuilder\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "all",
      description: "ProcessBuilder launches a runtime command",
    },
    {
      id: "kotlin.sink.jdbc-statement",
      pattern: /\.\s*execute(?:Query|Update|LargeUpdate)?\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "database_exec",
      severity: "high",
      argument: "all",
      description: "JDBC Statement.execute* runs a SQL string",
    },
    {
      id: "kotlin.sink.jpa-query",
      pattern: /\.\s*create(?:Native)?Query\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "database_exec",
      severity: "high",
      argument: "all",
      description: "JPA/Hibernate createQuery/createNativeQuery with dynamic query text",
    },
    {
      id: "kotlin.sink.script-eval",
      pattern: /\.\s*eval\s*\(|\bScriptEngineManager\b/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "high",
      argument: "all",
      description: "JSR-223 scripting eval executes source text",
    },
    {
      id: "kotlin.sink.insecure-deserialization",
      pattern: /\bObjectInputStream\s*\(|\.\s*readObject\s*\(|\.\s*fromXML\s*\(|\bYaml\s*\(\s*\)\s*\.\s*load\s*\(/,
      vulnerability: "insecure_deserialization",
      sinkType: "deserialization",
      severity: "high",
      argument: "all",
      description: "Java object deserialization of untrusted bytes",
    },
    {
      id: "kotlin.sink.file-path",
      pattern: /\bFile(?:InputStream|OutputStream|Reader|Writer)?\s*\(|\bPaths\.get\s*\(|\bFiles\.(?:delete|newInputStream|newOutputStream)\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_operation",
      severity: "medium",
      argument: "first",
      description: "file operation on a runtime path",
    },
    {
      id: "kotlin.sink.writer-output",
      // Anchored after the receiver so the argument list read is the print
      // call's, not the empty getWriter() list.
      pattern: /(?<=\))\s*\.\s*(?:print|println|write)\s*\(/,
      vulnerability: "xss",
      sinkType: "html_output",
      severity: "high",
      argument: "first",
      description: "response/stream writer output without HTML encoding (getWriter().print/println/write)",
    },
    {
      id: "kotlin.sink.url-open",
      pattern: /\bURL\s*\(|\bopenConnection\s*\(/,
      vulnerability: "ssrf",
      sinkType: "outbound_http",
      severity: "medium",
      argument: "first",
      description: "URL open — a URL from input is server-side request forgery",
    },
    {
      id: "kotlin.sink.insecure-random",
      pattern: /\bRandom\s*\(\s*\)/,
      vulnerability: "weak_crypto",
      sinkType: "crypto_primitive",
      severity: "medium",
      argument: "any",
      description: "kotlin.random.Random / java.util.Random is not a cryptographically secure source",
    },
  ],
  sanitizers: [
    {
      id: "kotlin.sanitizer.prepared-statement",
      vulnerability: "sql_injection",
      pattern: /\bprepareStatement\s*\(|\bsetString\s*\(|\bPreparedStatement\b/,
      rationale: "JDBC prepared statement — SQL structure is fixed, values are bound",
    },
    {
      id: "kotlin.sanitizer.sql-question-placeholder",
      vulnerability: "sql_injection",
      pattern: /\?\s*(?:["']|,|\)|$)/m,
      rationale: "? placeholder in the SQL text — values are bound, not interpolated",
    },
    {
      id: "kotlin.sanitizer.html-escape",
      vulnerability: "xss",
      pattern: /\b(?:escapeHtml4?|HtmlUtils\.htmlEscape|encodeForHTML)\s*\(/,
      rationale: "HTML escaping before output",
    },
    {
      id: "kotlin.sanitizer.process-argv-list",
      vulnerability: "command_injection",
      pattern: /\bProcessBuilder\s*\(\s*(?:listOf|mutableListOf|arrayListOf)\s*\(/,
      rationale: "ProcessBuilder with a listOf argv — no shell interpretation of arguments",
    },
  ],
  limits: [
    "string literals are masked, so SQL keyword text and crypto algorithm names are not visible to rules",
    "Kotlin DSLs, extension functions and operator overloading are not resolved",
    "coroutines and Flow do not change reachability rules here",
    "no interprocedural flow: helper functions that call the sink are only leads at their own symbols",
    "Android intents/content providers and Jetpack Compose output are not modelled",
  ],
}
