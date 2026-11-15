// M72 — TypeScript security spec (lane B, owner of the tsx alias). DATA only:
// lexical syntax plus source/sink/sanitizer rules; the rebuild engine
// (matcher + flow) decides whether a sink becomes a lead.
// Frozen contract: ../spec-types.ts.
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/{PLAN,LANGUAGES}.md,
//   validation/m72/fixtures/typescript/, validation/m72/fixtures/tsx/.
// CONTRACTS IT MUST NOT BREAK — template literals are masked as strings, so a
//   value interpolated inside ${...} is not visible; framework request shapes
//   not named req/request are declared as a limit.
// TIER — leads: lexical rules only; output is a lead to validate, not a finding.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "typescript",
  aliases: ["tsx"],
  tier: "leads",
  tierReason: "TypeScript source/sink rules; AST source/sink then reachability is not wired yet",
  lexical: {
    lineComments: ["//"],
    blockComments: [["/*", "*/"]],
    strings: [
      { delimiter: '"', escape: "\\" },
      { delimiter: "'", escape: "\\" },
      { delimiter: "`", escape: "\\", multiline: true },
    ],
  },
  sources: [
    {
      id: "typescript.request",
      pattern: /\b(?:req|request)\.(?:query|body|params|headers|cookies)\b/,
      sourceType: "user_input",
      description: "Express/Node request member (req.query, req.body, ...)",
      captureVariable: true,
    },
    {
      id: "typescript.env",
      pattern: /\bprocess\.env\b/,
      sourceType: "env",
      description: "environment variable read",
    },
    {
      id: "typescript.argv",
      pattern: /\bprocess\.argv\b/,
      sourceType: "argv",
      description: "process argument vector",
    },
    {
      id: "typescript.stdin",
      pattern: /\bprocess\.stdin\b/,
      sourceType: "user_input",
      description: "standard-input stream",
    },
    {
      id: "typescript.fs_read",
      pattern: /\bfs(?:\.promises)?\.(?:readFile|readFileSync|readdir|readdirSync|createReadStream)\s*\(/,
      sourceType: "file",
      description: "file contents read from the filesystem",
    },
    {
      id: "typescript.browser",
      pattern: /\b(?:location\.(?:search|hash|href)|document\.cookie)\b/,
      sourceType: "user_input",
      description: "browser location/cookie value",
    },
  ],
  sinks: [
    {
      id: "typescript.cmd.child_process",
      pattern: /\b(?:child_process\.)?(?:exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "critical",
      argument: "first",
      description: "child_process execution with a caller-influenced command",
    },
    {
      id: "typescript.code.eval",
      pattern: /\beval\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "critical",
      argument: "first",
      description: "eval() executes a JavaScript expression",
    },
    {
      id: "typescript.code.new_function",
      pattern: /\bnew\s+Function\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "critical",
      argument: "all",
      description: "new Function() compiles a dynamic function body",
    },
    {
      id: "typescript.code.vm",
      pattern: /\bvm\.(?:runInNewContext|runInThisContext|runInContext|compileFunction|createScript)\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "critical",
      argument: "first",
      description: "node:vm script compilation/execution of a dynamic string",
    },
    {
      id: "typescript.sql.query",
      pattern: /\b(?:connection|pool|client|db)\.(?:query|execute|raw)\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "sql_exec",
      severity: "high",
      argument: "all",
      description: "database query execution on a dynamically built statement",
    },
    {
      id: "typescript.deser.unserialize",
      pattern: /\bunserialize\s*\(/,
      vulnerability: "insecure_deserialization",
      sinkType: "deserialize",
      severity: "high",
      argument: "first",
      description: "unserialize() of untrusted data (node-serialize style)",
    },
    {
      id: "typescript.path.fs_mutation",
      pattern: /\bfs(?:\.promises)?\.(?:writeFile|appendFile|unlink|rm|rmdir|rename|copyFile|createWriteStream)\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_mutation",
      severity: "high",
      argument: "first",
      description: "filesystem write/delete/move on a caller-influenced path",
    },
    {
      id: "typescript.ssrf.fetch",
      pattern: /\b(?:fetch|axios\.(?:get|post|put|patch|delete|request)|https?\.(?:get|request))\s*\(/,
      vulnerability: "ssrf",
      sinkType: "http_request",
      severity: "high",
      argument: "first",
      description: "outbound HTTP request to a caller-controlled URL",
    },
    {
      id: "typescript.xss.dom_sink",
      pattern: /\.innerHTML\s*=|\bdangerouslySetInnerHTML\b|\.insertAdjacentHTML\s*\(/,
      vulnerability: "xss",
      sinkType: "html_output",
      severity: "high",
      argument: "any",
      description: "raw HTML injection point (innerHTML/dangerouslySetInnerHTML/insertAdjacentHTML)",
    },
    {
      id: "typescript.redirect.response",
      pattern: /\b(?:res|response)\.redirect\s*\(/,
      vulnerability: "open_redirect",
      sinkType: "http_redirect",
      severity: "medium",
      argument: "first",
      description: "HTTP redirect to a caller-influenced location",
    },
  ],
  sanitizers: [
    {
      id: "typescript.sql.binding",
      vulnerability: "sql_injection",
      pattern: /\b(?:query|execute)\s*\([^,()]+,\s*[(\[]|\bvalues\s*:\s*\[/,
      rationale: "parameter array/values binding keeps values out of the SQL text",
    },
    {
      id: "typescript.sql.prepared",
      vulnerability: "sql_injection",
      pattern: /\.prepare\s*\(/,
      rationale: "prepared statement separates statement text from bound values",
    },
    {
      id: "typescript.cmd.argv_array",
      vulnerability: "command_injection",
      pattern: /\bexecFile(?:Sync)?\s*\([^,()]+,\s*\[/,
      rationale: "execFile with an argv array does not invoke a shell",
    },
    {
      id: "typescript.xss.dompurify",
      vulnerability: "xss",
      pattern: /\bDOMPurify\.sanitize\s*\(|\bsanitizeHtml\s*\(/,
      rationale: "DOMPurify/sanitize-html removes executable markup before insertion",
    },
    {
      id: "typescript.path.basename",
      vulnerability: "path_traversal",
      pattern: /\bpath\.(?:basename|normalize)\s*\(/,
      rationale: "basename/normalize constrain the path before the filesystem call",
    },
    {
      id: "typescript.deser.json_parse",
      vulnerability: "insecure_deserialization",
      pattern: /\bJSON\.parse\s*\(/,
      rationale: "JSON.parse produces plain data, never executable objects",
    },
    {
      id: "typescript.redirect.allowlist",
      vulnerability: "open_redirect",
      pattern: /\b(?:isSafeRedirect|allowedRedirect|safeRedirect)\s*\(/,
      rationale: "an explicit allowlist check constrains the redirect target",
    },
  ],
  limits: [
    "template literals are masked: a statement/command assembled inside ${...} is only visible when a variable appears outside the literal",
    "only req/request-shaped request members are sources; framework-specific shapes (event.body, ctx.request, NextRequest) are not",
    "TypeScript structural typing and cross-function data flow are not modelled; leads only",
    "res.redirect is reported regardless of caller-side allowlists unless a listed sanitizer is present",
    "tsx files resolve to this spec; JSX event handlers and component props are not modelled as sources",
  ],
}
