// M72 — Lua security spec (lane A, specs-a).
//
// WHAT THIS FILE IS — lexical source/sink rules for Lua (plain Lua + OpenResty).
// A rule is a RegExp over the spec-masked symbol body plus the fields the flow
// engine needs.
//
// CONVENTIONS — a sink pattern ends at the callee's opening paren; the flow
// engine balances brackets and reads the argument text. Sanitizers are evaluated
// against the original (unmasked) call text.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "lua",
  tier: "leads",
  tierReason: "Lua lexical rules only: metatables and dynamic dispatch are not resolved.",
  lexical: {
    lineComments: ["--"],
    // Long-bracket comments are --[[ … ]]; the --[=[ … ]=] variants are not
    // expressible in this delimiter model (see limits).
    blockComments: [["--[[", "]]"]],
    // Long-bracket strings [[ … ]] are not expressible either; only quoted
    // strings are masked.
    strings: [
      { delimiter: '"', escape: "\\" },
      { delimiter: "'", escape: "\\" },
    ],
  },
  sources: [
    {
      id: "lua.source.arg",
      pattern: /\barg\s*\[/,
      sourceType: "cli",
      description: "the arg table holds script arguments",
    },
    {
      id: "lua.source.getenv",
      pattern: /\bos\.getenv\s*\(/,
      sourceType: "env",
      description: "os.getenv reads a process environment variable",
    },
    {
      id: "lua.source.io-read",
      pattern: /\bio\.read\s*\(/,
      sourceType: "user_input",
      description: "io.read reads stdin",
    },
    {
      id: "lua.source.ngx-request",
      pattern: /\bngx\.(?:req|var)\b/,
      sourceType: "network",
      description: "OpenResty ngx.req / ngx.var expose HTTP request data",
    },
    {
      id: "lua.source.io-lines",
      pattern: /\bio\.lines\s*\(/,
      sourceType: "file",
      description: "io.lines reads a file line by line",
    },
  ],
  sinks: [
    {
      id: "lua.sink.os-execute",
      pattern: /\bos\.execute\s*\(/,
      vulnerability: "command_injection",
      sinkType: "shell_command",
      severity: "high",
      argument: "all",
      description: "os.execute passes its string to the shell",
    },
    {
      id: "lua.sink.io-popen",
      pattern: /\bio\.popen\s*\(/,
      vulnerability: "command_injection",
      sinkType: "shell_command",
      severity: "high",
      argument: "first",
      description: "io.popen passes its command string to the shell",
    },
    {
      id: "lua.sink.code-load",
      pattern: /\b(?:loadstring|loadfile|dofile)\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_load",
      severity: "high",
      argument: "first",
      description: "loadstring/loadfile/dofile loads and runs code text or a runtime file",
    },
    {
      id: "lua.sink.sql-execute",
      pattern: /\b(?:conn|connection|db|cur|cursor)\s*[:.]\s*(?:execute|query)\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "database_exec",
      severity: "high",
      argument: "all",
      description: "LuaSQL execute/query runs a SQL string",
    },
    {
      id: "lua.sink.file-path",
      pattern: /\bio\.open\s*\(|\bos\.remove\s*\(|\bos\.rename\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_operation",
      severity: "medium",
      argument: "first",
      description: "file open/remove/rename on a runtime path",
    },
    {
      id: "lua.sink.ngx-output",
      pattern: /\bngx\.(?:say|print)\s*\(/,
      vulnerability: "xss",
      sinkType: "html_output",
      severity: "high",
      argument: "first",
      description: "OpenResty ngx.say/ngx.print writes raw response content (no HTML escaping)",
    },
    {
      id: "lua.sink.ngx-subrequest",
      pattern: /\bngx\.location(?:\.capture)?\s*\(|\bhttpc\s*:\s*request\s*\(/,
      vulnerability: "ssrf",
      sinkType: "outbound_http",
      severity: "medium",
      argument: "all",
      description: "OpenResty subrequest / lua-resty-http request to a runtime URL",
    },
    {
      id: "lua.sink.weak-crypto",
      pattern: /\bngx\.(?:md5|sha1)\s*\(|\bmd5\.sum\s*\(/,
      vulnerability: "weak_crypto",
      sinkType: "crypto_primitive",
      severity: "medium",
      argument: "any",
      description: "MD5/SHA-1 digest — broken for security use",
    },
  ],
  sanitizers: [
    {
      id: "lua.sanitizer.prepared-statement",
      vulnerability: "sql_injection",
      pattern: /\bconn\s*:\s*prepare\s*\(/,
      rationale: "LuaSQL prepared statement — SQL structure is fixed, values are bound",
    },
    {
      id: "lua.sanitizer.sql-question-placeholder",
      vulnerability: "sql_injection",
      pattern: /\?\s*(?:["']|,|\)|$)/m,
      rationale: "? placeholder in the SQL text — values are bound, not interpolated",
    },
    {
      id: "lua.sanitizer.html-escape",
      vulnerability: "xss",
      pattern: /\bescape_html\s*\(|\bngx\.escape_html\s*\(/,
      rationale: "template HTML-escape helper before response output",
    },
  ],
  limits: [
    "long-bracket strings ([[ … ]]) and comments (--[=[ … ]=]) are not masked",
    "metatables, __index dispatch and sandboxed environments are not resolved",
    "no interprocedural flow: helper functions that call the sink are only leads at their own symbols",
    "plain Lua and OpenResty APIs are mixed in one spec; a project using one runtime sees rules for the other",
    "the HTML-escape helper name is framework-specific (lua-resty-template style) and may not exist in a given project",
  ],
}
