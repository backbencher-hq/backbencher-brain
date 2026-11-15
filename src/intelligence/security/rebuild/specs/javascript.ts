// M72 — JavaScript security spec (lane A, specs-a).
//
// WHAT THIS FILE IS — lexical source/sink rules for JavaScript (Node + browser).
// A rule is a RegExp over the spec-masked symbol body plus the fields the flow
// engine needs.
//
// CONVENTIONS — a sink pattern ends at the callee's opening paren; attribute
// writes (.innerHTML = …) use `argument:"any"` with the statement-tail fallback.
// Sanitizers are evaluated against the original (unmasked) call text, so `?`,
// `$1` and named placeholders inside SQL strings are visible.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "javascript",
  aliases: ["jsx", "mjs", "cjs"],
  tier: "leads",
  tierReason: "JS lexical rules only: no data-flow proof, so a match is a lead to validate.",
  lexical: {
    lineComments: ["//"],
    blockComments: [["/*", "*/"]],
    // Template literals are masked as strings; their ${…} expressions are code
    // but are masked with the literal (see limits).
    strings: [
      { delimiter: "`", escape: "\\", multiline: true },
      { delimiter: '"', escape: "\\" },
      { delimiter: "'", escape: "\\" },
    ],
  },
  sources: [
    {
      id: "javascript.source.express-request",
      pattern: /\breq(?:uest)?\.(?:query|body|params|headers|cookies)\b/,
      sourceType: "user_input",
      description: "Express/HTTP request fields — client-controlled input",
    },
    {
      id: "javascript.source.browser-location",
      pattern: /\b(?:window|document|globalThis)\.location\b|\blocation\.(?:search|href|hash)\b/,
      sourceType: "user_input",
      description: "browser location/URL — attacker-influenced in a page",
    },
    {
      id: "javascript.source.process-argv",
      pattern: /\bprocess\.argv\b/,
      sourceType: "cli",
      description: "process.argv — command-line input",
    },
    {
      id: "javascript.source.process-env",
      pattern: /\bprocess\.env\b/,
      sourceType: "env",
      description: "process.env — inherited environment variables",
    },
    {
      id: "javascript.source.stdin",
      pattern: /\bprocess\.stdin\b|\breadline\.createInterface\s*\(/,
      sourceType: "user_input",
      description: "stdin / readline input",
    },
    {
      id: "javascript.source.file-read",
      pattern: /\bfs\.(?:readFile|readFileSync|createReadStream)\s*\(/,
      sourceType: "file",
      description: "fs read — file content is untrusted relative to the process",
    },
    {
      id: "javascript.source.fetch",
      pattern: /\bfetch\s*\(/,
      sourceType: "network",
      description: "fetch response body is network input (the URL itself is covered by the ssrf note)",
    },
  ],
  sinks: [
    {
      id: "javascript.sink.child-process",
      pattern: /\bchild_process\.(?:exec|execFile|spawn|fork)(?:Sync)?\s*\(|(?<!\.)\b(?:exec|execFile|spawn|fork)(?:Sync)?\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "all",
      description: "child_process exec/spawn family runs an external command",
    },
    {
      id: "javascript.sink.sql-client",
      pattern: /\b(?:connection|conn|client|db|pool|sequelize|knex)\s*\.\s*(?:query|execute|raw|unsafe)\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "database_exec",
      severity: "high",
      argument: "all",
      description: "database client executes a SQL string (node-postgres/mysql/knex/sequelize names)",
    },
    {
      id: "javascript.sink.dynamic-code",
      pattern: /\beval\s*\(|\bnew\s+Function\s*\(|\bvm\.run(?:In(?:New|This)Context)?\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "high",
      argument: "all",
      description: "eval / new Function / vm.run* execute source text",
    },
    {
      id: "javascript.sink.html-output",
      pattern: /\.\s*(?:innerHTML|outerHTML)\s*=|\bdocument\.write(?:ln)?\s*\(|\binsertAdjacentHTML\s*\(|\b(?:res|response)\.(?:send|end|write)\s*\(/,
      vulnerability: "xss",
      sinkType: "html_output",
      severity: "high",
      argument: "any",
      description: "unencoded HTML output (DOM HTML sink or response body)",
    },
    {
      id: "javascript.sink.file-path",
      pattern: /\bfs(?:\.promises)?\.(?:readFile|writeFile|appendFile|readFileSync|writeFileSync|unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync|open|openSync|createReadStream|createWriteStream)\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_operation",
      severity: "medium",
      argument: "first",
      description: "fs operation on a runtime path",
    },
    {
      id: "javascript.sink.unserialize",
      pattern: /\bunserialize\s*\(|\byaml\.load\s*\(/,
      vulnerability: "insecure_deserialization",
      sinkType: "deserialization",
      severity: "high",
      argument: "first",
      description: "unsafe deserialization (node-serialize unserialize, js-yaml load with unsafe schema)",
    },
    {
      id: "javascript.sink.outbound-http",
      pattern: /\baxios\.(?:get|post|put|delete|head|request)\s*\(|\bgot\s*\(|\bhttps?\.(?:get|request)\s*\(/,
      vulnerability: "ssrf",
      sinkType: "outbound_http",
      severity: "medium",
      argument: "first",
      description: "outbound HTTP request — a URL from input is server-side request forgery",
    },
    {
      id: "javascript.sink.insecure-random",
      pattern: /\bMath\.random\s*\(/,
      vulnerability: "weak_crypto",
      sinkType: "crypto_primitive",
      severity: "medium",
      argument: "any",
      description: "Math.random is not a cryptographically secure source",
    },
  ],
  sanitizers: [
    {
      id: "javascript.sanitizer.sql-parameter-array",
      vulnerability: "sql_injection",
      pattern: /\b(?:query|execute)\s*\([^;)\n]*,\s*\[/,
      rationale: "query call with a parameter array — values are bound, not interpolated",
    },
    {
      id: "javascript.sanitizer.sql-question-placeholder",
      vulnerability: "sql_injection",
      pattern: /\?\s*(?:["'`]|,|\)|$)/m,
      rationale: "? placeholder in the SQL text — values are bound, not interpolated",
    },
    {
      id: "javascript.sanitizer.sql-dollar-placeholder",
      vulnerability: "sql_injection",
      pattern: /\$\d+\b/,
      rationale: "positional placeholder ($1) in the SQL text — values are bound, not interpolated",
    },
    {
      id: "javascript.sanitizer.html-escape",
      vulnerability: "xss",
      pattern: /\b(?:escapeHtml|escapeHTML|DOMPurify\.sanitize|he\.encode)\s*\(/,
      rationale: "HTML escaping/sanitization before output",
    },
  ],
  limits: [
    "template-literal ${…} expressions are masked together with the literal, so taint spliced through a template string is not seen",
    "express/koa middleware, validators and sanitizers defined in other symbols are not followed",
    "execFile/spawn are argv-based (no shell); a tainted non-program argument can be over-reported",
    "fetch() is declared as a network source only, so an SSRF through fetch(url) is not flagged (kept distinct to avoid a self-pair)",
    "no interprocedural flow: helper functions that call the sink are only leads at their own symbols",
    "prototype pollution and DOM-based flows are not modelled",
  ],
}
