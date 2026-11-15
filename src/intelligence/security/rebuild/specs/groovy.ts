// M72 — Groovy security spec (lane A, specs-a).
//
// WHAT THIS FILE IS — lexical source/sink rules for Groovy (Grails, Gradle
// scripts, Jenkins pipelines). A rule is a RegExp over the spec-masked symbol
// body plus the fields the flow engine needs.
//
// CONVENTIONS — a sink pattern ends at the callee's opening paren; the flow
// engine balances brackets and reads the argument text. Sanitizers are evaluated
// against the original (unmasked) call text.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "groovy",
  tier: "leads",
  tierReason: "Groovy lexical rules only: dynamic dispatch and GDK methods are not resolved.",
  lexical: {
    lineComments: ["//"],
    blockComments: [["/*", "*/"]],
    // Triple-quoted GStrings are listed before plain quotes. Slashy strings
    // (/…/) and dollar-slashy strings are not masked; see limits.
    strings: [
      { delimiter: '"""', escape: "\\", multiline: true },
      { delimiter: "'''", escape: "\\", multiline: true },
      { delimiter: '"', escape: "\\" },
      { delimiter: "'", escape: "\\" },
    ],
  },
  sources: [
    {
      id: "groovy.source.params",
      pattern: /\bparams\s*[.[]/,
      sourceType: "user_input",
      description: "Grails params map — request parameters",
    },
    {
      id: "groovy.source.request",
      pattern: /\brequest\.(?:getParameter|getParameterValues|getHeader|getInputStream|getReader)\s*\(/,
      sourceType: "user_input",
      description: "servlet request parameter/header/body access",
    },
    {
      id: "groovy.source.getenv",
      pattern: /\bSystem\.getenv\s*\(/,
      sourceType: "env",
      description: "System.getenv reads a process environment variable",
    },
    {
      id: "groovy.source.args",
      pattern: /\bargs\s*\[/,
      sourceType: "cli",
      description: "script args[] — command-line input",
    },
    {
      id: "groovy.source.file-read",
      pattern: /\bnew\s+File(?:Reader|InputStream)\s*\(/,
      sourceType: "file",
      description: "file reader/stream — file content is untrusted relative to the process",
    },
  ],
  sinks: [
    {
      id: "groovy.sink.process-builder",
      pattern: /\bProcessBuilder\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "all",
      description: "ProcessBuilder launches a runtime command",
    },
    {
      id: "groovy.sink.runtime-exec",
      // Anchored on the final `.exec(` token: a pattern starting at
      // `Runtime.getRuntime()` would make the engine read getRuntime()'s empty
      // argument list as the sink argument.
      pattern: /(?<=\.)\s*exec\s*\(/,
      vulnerability: "command_injection",
      sinkType: "shell_command",
      severity: "high",
      argument: "all",
      description: "Runtime.exec-style exec(…) runs a command string through the shell",
    },
    {
      id: "groovy.sink.jdbc-statement",
      pattern: /\b(?:executeQuery|executeUpdate|executeLargeUpdate)\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "database_exec",
      severity: "high",
      argument: "all",
      description: "JDBC Statement executes a SQL string",
    },
    {
      id: "groovy.sink.groovy-sql",
      pattern: /\bsql\s*\.\s*(?:firstRow|rows|eachRow|execute|executeInsert|executeUpdate)\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "database_exec",
      severity: "high",
      argument: "all",
      description: "groovy.sql.Sql executes a SQL string",
    },
    {
      id: "groovy.sink.code-eval",
      pattern: /\b(?:GroovyShell|GroovyClassLoader)\s*\(|\bEval\.(?:me|x|xy|xyz)\s*\(|\bevaluate\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "high",
      argument: "all",
      description: "Groovy dynamic evaluation (GroovyShell/Eval/evaluate)",
    },
    {
      id: "groovy.sink.outbound-url",
      pattern: /\bnew\s+(?:URL|URI)\s*\(|\bopenConnection\s*\(/,
      vulnerability: "ssrf",
      sinkType: "outbound_http",
      severity: "medium",
      argument: "all",
      description: "URL open — a URL from input is server-side request forgery",
    },
    {
      id: "groovy.sink.file-path",
      pattern: /\bnew\s+(?:File|FileInputStream|FileOutputStream|FileReader|FileWriter|RandomAccessFile)\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_operation",
      severity: "medium",
      argument: "first",
      description: "file constructed from a runtime path",
    },
    {
      id: "groovy.sink.object-input",
      pattern: /\bnew\s+ObjectInputStream\s*\(|\breadObject\s*\(/,
      vulnerability: "insecure_deserialization",
      sinkType: "deserialization",
      severity: "high",
      argument: "all",
      description: "Java object deserialization of untrusted bytes",
    },
    {
      id: "groovy.sink.unescaped-markup",
      pattern: /\byieldUnescaped\s*\(/,
      vulnerability: "xss",
      sinkType: "html_output",
      severity: "high",
      argument: "first",
      description: "MarkupBuilder yieldUnescaped emits raw markup",
    },
  ],
  sanitizers: [
    {
      id: "groovy.sanitizer.prepared-statement",
      vulnerability: "sql_injection",
      pattern: /\bprepareStatement\s*\(|\bPreparedStatement\b/,
      rationale: "prepared statement — SQL structure is fixed, values are bound",
    },
    {
      id: "groovy.sanitizer.sql-params-list",
      vulnerability: "sql_injection",
      pattern: /\bsql\s*\.\s*(?:firstRow|rows|eachRow|execute|executeUpdate)\s*\([^)\n]*,\s*\[/,
      rationale: "groovy.sql.Sql call with a params list — values are bound, not interpolated",
    },
    {
      id: "groovy.sanitizer.sql-question-placeholder",
      vulnerability: "sql_injection",
      pattern: /\?\s*(?:["']|,|\)|$)/m,
      rationale: "? placeholder in the SQL text — values are bound, not interpolated",
    },
    {
      id: "groovy.sanitizer.html-escape",
      vulnerability: "xss",
      pattern: /\b(?:HtmlUtils\.htmlEscape|StringEscapeUtils\.escapeHtml4?)\s*\(/,
      rationale: "Spring/Commons HTML escaping before output",
    },
  ],
  limits: [
    "GDK String.execute() is not detected: the command text is the call's receiver, before the matched token, so there is no sink argument to inspect",
    "GString interpolation (\"$var\") is inside a masked string, so taint spliced through interpolation is not seen",
    "slashy strings (/…/) are not masked",
    "dynamic dispatch, methodMissing and AST transforms are not resolved",
    "no interprocedural flow: helper methods that call the sink are only leads at their own symbols",
    "Jenkins pipeline steps and Gradle plugins are not modelled",
  ],
}
