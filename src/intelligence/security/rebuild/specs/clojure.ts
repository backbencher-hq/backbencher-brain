// M72 — Clojure security spec (lane A, specs-a).
//
// WHAT THIS FILE IS — lexical source/sink rules for Clojure. A rule is a RegExp
// over the spec-masked symbol body (comments/strings blanked) plus the fields
// the flow engine needs. Clojure sinks are library calls: clojure.java.shell,
// clojure.java.jdbc / next.jdbc, eval/load-string, spit, hiccup raw output.
//
// CONVENTIONS — a sink pattern ends at the callee's opening paren; the flow
// engine balances brackets and reads the argument text. A sanitizer is evaluated
// against the original (unmasked) call text, so `?` placeholders inside a
// jdbc/query vector are visible even though they sit in a string literal.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "clojure",
  tier: "leads",
  tierReason: "Clojure lexical rules only: macros and dispatch are not expanded, so a match is a lead to validate.",
  lexical: {
    lineComments: [";"],
    // Clojure has no block-comment syntax: `#_` is a reader discard form, not a
    // region delimiter, so it is deliberately absent here (see limits).
    blockComments: [],
    strings: [{ delimiter: '"', escape: "\\" }],
  },
  sources: [
    {
      id: "clojure.source.read-line",
      pattern: /\(\s*read-line\b/,
      sourceType: "user_input",
      description: "read-line reads stdin — external input",
    },
    {
      id: "clojure.source.slurp",
      pattern: /\(\s*slurp\b/,
      sourceType: "file",
      description: "slurp returns file/URL content as a string",
    },
    {
      id: "clojure.source.getenv",
      pattern: /\(\s*System\/getenv\b/,
      sourceType: "env",
      description: "System/getenv reads an environment variable",
    },
    {
      id: "clojure.source.command-line-args",
      pattern: /\*command-line-args\*/,
      sourceType: "cli",
      description: "*command-line-args* holds the process arguments",
    },
    {
      id: "clojure.source.ring-params",
      pattern: /:(?:query-params|form-params|path-params|params)\b/,
      sourceType: "user_input",
      description: "Ring request map keys carrying client input",
    },
    {
      id: "clojure.source.io-reader",
      pattern: /\(\s*clojure\.java\.io\/reader\b/,
      sourceType: "file",
      description: "clojure.java.io/reader opens a path/stream for reading",
    },
  ],
  sinks: [
    {
      id: "clojure.sink.shell-sh",
      pattern: /\(\s*clojure\.java\.shell\/sh\b/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "all",
      description: "clojure.java.shell/sh launches an external process from its argv vector",
    },
    {
      id: "clojure.sink.runtime-exec",
      pattern: /\(\s*\.exec\b/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "all",
      description: "(.exec rt cmd) interop form runs a command through java.lang.Runtime",
    },
    {
      id: "clojure.sink.jdbc-query",
      pattern: /\(\s*(?:clojure\.java\.jdbc|next\.jdbc|jdbc)\/[a-z!?-]+\b/,
      vulnerability: "sql_injection",
      sinkType: "database_exec",
      severity: "high",
      argument: "all",
      description: "jdbc/query or jdbc/execute! runs a SQL string",
    },
    {
      id: "clojure.sink.eval",
      pattern: /\(\s*eval\s+/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "high",
      argument: "first",
      description: "eval executes a Clojure form built at runtime",
    },
    {
      id: "clojure.sink.load-string",
      pattern: /\(\s*load-string\b/,
      vulnerability: "code_injection",
      sinkType: "code_load",
      severity: "high",
      argument: "first",
      description: "load-string reads and evaluates Clojure source text",
    },
    {
      id: "clojure.sink.read-string",
      pattern: /\(\s*read-string\b/,
      vulnerability: "insecure_deserialization",
      sinkType: "reader_deserialization",
      severity: "high",
      argument: "first",
      description: "read-string parses untrusted text into data with reader forms",
    },
    {
      id: "clojure.sink.spit",
      pattern: /\(\s*spit\b/,
      vulnerability: "path_traversal",
      sinkType: "file_write",
      severity: "medium",
      argument: "first",
      description: "spit writes to a path chosen at runtime",
    },
    {
      id: "clojure.sink.hiccup-raw",
      pattern: /\(\s*(?:hiccup\.util|hiccup\.core)\/raw(?:-string)?\b/,
      vulnerability: "xss",
      sinkType: "html_output",
      severity: "high",
      argument: "first",
      description: "hiccup raw/raw-string emits unescaped HTML",
    },
    {
      id: "clojure.sink.browse-url",
      pattern: /\(\s*clojure\.java\.browse\/browse-url\b/,
      vulnerability: "open_redirect",
      sinkType: "outbound_navigation",
      severity: "medium",
      argument: "first",
      description: "browse-url opens a caller-influenced URL",
    },
  ],
  sanitizers: [
    {
      id: "clojure.sanitizer.jdbc-vector-params",
      vulnerability: "sql_injection",
      pattern: /\(\s*(?:clojure\.java\.jdbc|next\.jdbc|jdbc)\/[a-z!?-]+\s+[^\s()]+\s+\[/,
      rationale: "jdbc call with a vector SQL-params argument — the SQL text is fixed and values are bound",
    },
    {
      id: "clojure.sanitizer.sql-question-placeholder",
      vulnerability: "sql_injection",
      pattern: /\?\s*(?:["']|,|\)|$)/m,
      rationale: "? placeholder in the original SQL text — values are bound, not interpolated",
    },
    {
      id: "clojure.sanitizer.html-escape",
      vulnerability: "xss",
      pattern: /(?:hiccup\.util\/)?escape-html\b/,
      rationale: "hiccup escape-html escapes text before HTML emission",
    },
  ],
  limits: [
    "macros are not expanded: a macro that wraps shell/sh, jdbc or eval is invisible",
    "reader discard/eval forms (#_, #=) are not masked and not modelled",
    "no interprocedural flow: helper fns that call the sink are only leads at their own symbol",
    "only the common jdbc/next.jdbc aliases are matched; other namespace aliases for the same APIs are missed",
    "clojure.java.shell/sh is an argv vector (no shell), so a tainted non-program argument can be over-reported as command injection",
    "Ring input is detected by keyword name, not by the request-map binding",
  ],
}
