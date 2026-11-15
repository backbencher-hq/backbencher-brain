// M72 — Java security spec (lane A, specs-a).
//
// WHAT THIS FILE IS — lexical source/sink rules for Java. A rule is a RegExp
// over the spec-masked symbol body (comments/strings blanked) plus the fields
// the flow engine needs.
//
// CONVENTIONS — a sink pattern ends at the callee's opening paren; the flow
// engine balances brackets and reads the argument text. Sanitizers are evaluated
// against the original (unmasked) call text, so `?` placeholders and
// PreparedStatement APIs are both usable.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "java",
  tier: "leads",
  tierReason: "Java lexical rules only: no interprocedural flow, so a match is a lead to validate.",
  lexical: {
    lineComments: ["//"],
    blockComments: [["/*", "*/"]],
    strings: [
      { delimiter: '"""', escape: "\\", multiline: true },
      { delimiter: '"', escape: "\\" },
      { delimiter: "'", escape: "\\" },
    ],
  },
  sources: [
    {
      id: "java.source.servlet-request",
      pattern: /\brequest\.(?:getParameter\w*|getHeader\w*|getInputStream|getReader)\s*\(/,
      sourceType: "user_input",
      description: "HttpServletRequest parameter/header/body access",
    },
    {
      id: "java.source.getenv",
      pattern: /\bSystem\.getenv\s*\(/,
      sourceType: "env",
      description: "System.getenv reads a process environment variable",
    },
    {
      id: "java.source.args",
      pattern: /\bargs\s*\[/,
      sourceType: "cli",
      description: "main(String[] args) element — command-line input",
    },
    {
      id: "java.source.console",
      pattern: /\bSystem\.console\s*\(\s*\)\s*\.\s*readLine\s*\(/,
      sourceType: "user_input",
      description: "System.console().readLine reads stdin",
    },
    {
      id: "java.source.file",
      pattern: /\bFiles\.read(?:AllBytes|AllLines|AllString|String)\s*\(/,
      sourceType: "file",
      description: "java.nio.file.Files read — file content",
    },
    {
      id: "java.source.spring-param",
      pattern: /@(?:RequestParam|PathVariable|RequestHeader|RequestBody)\b/,
      sourceType: "user_input",
      description: "Spring MVC annotation — the parameter is bound from the request",
    },
  ],
  sinks: [
    {
      id: "java.sink.runtime-exec",
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
      id: "java.sink.process-builder",
      pattern: /\bnew\s+ProcessBuilder\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "all",
      description: "ProcessBuilder launches a runtime command",
    },
    {
      id: "java.sink.jdbc-statement",
      pattern: /\.\s*execute(?:Query|Update|LargeUpdate)?\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "database_exec",
      severity: "high",
      argument: "all",
      description: "JDBC Statement.execute* runs a SQL string",
    },
    {
      id: "java.sink.jpa-query",
      pattern: /\.\s*create(?:Native)?Query\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "database_exec",
      severity: "high",
      argument: "all",
      description: "JPA/Hibernate createQuery/createNativeQuery with dynamic query text",
    },
    {
      id: "java.sink.script-eval",
      pattern: /\.\s*eval\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "high",
      argument: "all",
      description: "ScriptEngine.eval executes source text",
    },
    {
      id: "java.sink.insecure-deserialization",
      pattern: /\bnew\s+(?:ObjectInputStream|XMLDecoder)\s*\(|\.\s*readObject\s*\(|\.\s*fromXML\s*\(/,
      vulnerability: "insecure_deserialization",
      sinkType: "deserialization",
      severity: "high",
      argument: "all",
      description: "Java object deserialization of untrusted bytes (ObjectInputStream/XMLDecoder/XStream)",
    },
    {
      id: "java.sink.file-path",
      pattern: /\bnew\s+(?:File|FileInputStream|FileOutputStream|FileReader|FileWriter)\s*\(|\bPaths\.get\s*\(|\bFiles\.(?:delete|newInputStream|newOutputStream)\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_operation",
      severity: "medium",
      argument: "first",
      description: "file operation on a runtime path",
    },
    {
      id: "java.sink.writer-output",
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
      id: "java.sink.url-open",
      pattern: /\bnew\s+URL\s*\(|\bopenConnection\s*\(/,
      vulnerability: "ssrf",
      sinkType: "outbound_http",
      severity: "medium",
      argument: "first",
      description: "URL open — a URL from input is server-side request forgery",
    },
    {
      id: "java.sink.rest-template",
      pattern: /\brestTemplate\.(?:getForObject|getForEntity|exchange|postForObject|postForEntity)\s*\(/,
      vulnerability: "ssrf",
      sinkType: "outbound_http",
      severity: "medium",
      argument: "first",
      description: "Spring RestTemplate request to a runtime URL",
    },
    {
      id: "java.sink.insecure-random",
      pattern: /\bnew\s+Random\s*\(\s*\)/,
      vulnerability: "weak_crypto",
      sinkType: "crypto_primitive",
      severity: "medium",
      argument: "any",
      description: "java.util.Random is not a cryptographically secure source",
    },
  ],
  sanitizers: [
    {
      id: "java.sanitizer.prepared-statement",
      vulnerability: "sql_injection",
      pattern: /\bprepareStatement\s*\(|\bsetString\s*\(|\bPreparedStatement\b/,
      rationale: "JDBC prepared statement — SQL structure is fixed, values are bound",
    },
    {
      id: "java.sanitizer.sql-question-placeholder",
      vulnerability: "sql_injection",
      pattern: /\?\s*(?:["']|,|\)|$)/m,
      rationale: "? placeholder in the SQL text — values are bound, not interpolated",
    },
    {
      id: "java.sanitizer.html-escape",
      vulnerability: "xss",
      pattern: /\b(?:escapeHtml4?|HtmlUtils\.htmlEscape|encodeForHTML)\s*\(/,
      rationale: "HTML escaping before output",
    },
    {
      id: "java.sanitizer.process-argv-list",
      vulnerability: "command_injection",
      pattern: /\bnew\s+ProcessBuilder\s*\(\s*(?:List|Arrays\.asList|java\.util\.List)/,
      rationale: "ProcessBuilder with an argv list — no shell interpretation of arguments",
    },
  ],
  limits: [
    "string literals are masked, so SQL keyword text and crypto algorithm names are not visible to rules",
    "reflection and dynamic proxies are not modelled",
    "Spring Data derived queries, MyBatis XML and JPQL string builders are not covered",
    "no interprocedural flow: helper methods that call the sink are only leads at their own symbols",
    "ProcessBuilder with a single String is flagged even though it is argv-based (only the shell form is injection)",
  ],
}
