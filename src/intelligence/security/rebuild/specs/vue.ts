// M72 Phase 2b-6 — Vue security spec (lane: component formats). DATA only:
// lexical syntax plus source/sink/sanitizer rules; the rebuild engine
// (matcher + flow) decides whether a sink becomes a lead.
// Frozen contract: ../spec-types.ts.
//
// WHAT THE ENGINE ACTUALLY RECEIVES — `src/ast/pool-worker.ts` classifies `vue`
//   as a JS-family language and extracts `<script>` / `<script setup lang="ts">`
//   blocks as ordinary symbols with real byte offsets. These rules are written
//   against SCRIPT CONTENT, never against `.vue` template markup.
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/{PLAN,PHASE-2,PHASE-2B}.md,
//   validation/m72/fixtures/vue/, validation/m72/results/density.json.
// CONTRACTS IT MUST NOT BREAK — `v-html` is a real XSS sink but it lives in the
//   TEMPLATE, which the extracted body does not contain; declaring it as a rule
//   would be coverage that can never fire. It is recorded as a limit instead.
//   `vue` stays tier=leads: a lead is not a finding.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "vue",
  tier: "leads",
  tierReason:
    "Vue script blocks are real executable TypeScript/JavaScript, but reachability is intra-symbol and template directives (v-html) are out of scope; output is a lead to validate.",
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
      id: "vue.props",
      pattern: /\bdefineProps\s*[<(]/,
      sourceType: "user_input",
      description: "a declared prop set (defineProps) — the whole prop object is caller-supplied",
    },
    {
      // Separate rule on purpose: `captureVariable` on the declaration form captures
      // the literal `defineProps`, which then never matches the `props.x` reads a
      // sink consumes. This rule captures the receiver instead.
      id: "vue.props_read",
      pattern: /\bprops\.\w+/,
      sourceType: "user_input",
      description: "a `props.x` member read — caller-supplied by the parent component",
      captureVariable: true,
    },
    {
      id: "vue.route",
      pattern: /\b(?:route|useRoute)\b\s*(?:\.\s*query|\.\s*params|\.\s*fullPath)?|[^.\w]\$route\b/,
      sourceType: "user_input",
      description: "Vue Router route query/params — URL-controlled",
    },
    {
      id: "vue.browser",
      pattern: /\b(?:location\.(?:search|hash|href)|document\.(?:URL|referrer|cookie))\b/,
      sourceType: "user_input",
      description: "browser-controlled value (URL, referrer, cookie)",
    },
    {
      id: "vue.network",
      pattern: /\b(?:await\s+)?(?:fetch|axios(?:\.\w+)?|XMLHttpRequest)\s*\(/,
      sourceType: "network",
      description: "an HTTP response body is network-controlled",
    },
    {
      id: "vue.env",
      pattern: /\bimport\.meta\.env\b/,
      sourceType: "env",
      description: "build-time environment access (import.meta.env)",
    },
  ],
  sinks: [
    {
      id: "vue.code.eval",
      pattern: /\beval\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "critical",
      argument: "first",
      description: "eval() executes a string as code",
    },
    {
      id: "vue.code.new_function",
      pattern: /\bnew\s+Function\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "critical",
      argument: "all",
      description: "new Function() compiles a dynamic function body",
    },
    {
      id: "vue.cmd.child_process",
      pattern: /\b(?:child_process\.)?(?:exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "critical",
      argument: "first",
      description: "child_process execution with a caller-influenced command",
    },
    {
      id: "vue.xss.inner_html",
      pattern: /\.innerHTML\s*=/,
      vulnerability: "xss",
      sinkType: "html_output",
      severity: "high",
      argument: "any",
      description: "innerHTML assignment from a script value (DOM XSS)",
    },
    {
      id: "vue.xss.document_write",
      pattern: /\bdocument\.write\s*\(/,
      vulnerability: "xss",
      sinkType: "html_output",
      severity: "high",
      argument: "first",
      description: "document.write() injects markup",
    },
    {
      id: "vue.xss.insert_adjacent_html",
      pattern: /\.insertAdjacentHTML\s*\(/,
      vulnerability: "xss",
      sinkType: "html_output",
      severity: "high",
      argument: "any",
      description: "insertAdjacentHTML injects markup",
    },
    {
      id: "vue.sql.query",
      pattern: /\b(?:connection|pool|client|db|knex)\.(?:query|raw|execute)\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "sql_exec",
      severity: "high",
      argument: "all",
      description: "database query execution on a dynamically built statement",
    },
    {
      id: "vue.path.fs_mutation",
      pattern: /\bfs(?:\.promises)?\.(?:writeFile|appendFile|unlink|rm|rmdir|rename|copyFile|createWriteStream)\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_mutation",
      severity: "high",
      argument: "first",
      description: "filesystem write/delete/move on a caller-influenced path",
    },
    {
      id: "vue.ssrf.fetch",
      pattern: /\b(?:fetch|axios\.(?:get|post|put|patch|delete|request))\s*\(\s*[`'"]?\s*\$\{/,
      vulnerability: "ssrf",
      sinkType: "http_request",
      severity: "high",
      argument: "first",
      description: "outbound request whose target is built by interpolation",
    },
    {
      id: "vue.redirect.location",
      pattern: /\blocation\.(?:href\s*=|assign\s*\()/,
      vulnerability: "open_redirect",
      sinkType: "http_redirect",
      severity: "medium",
      argument: "any",
      description: "navigation to a caller-influenced URL",
    },
  ],
  sanitizers: [
    {
      id: "vue.sql.binding",
      vulnerability: "sql_injection",
      pattern: /\b(?:query|execute)\s*\([^,()]+,\s*[(\[]|\bvalues\s*:\s*\[/,
      rationale: "a bound-parameter array keeps values out of the SQL text",
    },
    {
      id: "vue.sql.prepared",
      vulnerability: "sql_injection",
      pattern: /\.prepare\s*\(/,
      rationale: "prepared statement separates statement text from bound values",
    },
    {
      id: "vue.cmd.argv_array",
      vulnerability: "command_injection",
      pattern: /\bexecFile(?:Sync)?\s*\([^,()]+,\s*\[/,
      rationale: "execFile with an argv array does not invoke a shell",
    },
    {
      id: "vue.xss.dompurify",
      vulnerability: "xss",
      pattern: /\bDOMPurify\.sanitize\s*\(|\bsanitizeHtml\s*\(/,
      rationale: "DOMPurify/sanitize-html removes executable markup before insertion",
    },
    {
      id: "vue.path.basename",
      vulnerability: "path_traversal",
      pattern: /\bpath\.(?:basename|normalize)\s*\(/,
      rationale: "basename/normalize constrain the path before the filesystem call",
    },
    {
      id: "vue.deser.json_parse",
      vulnerability: "insecure_deserialization",
      pattern: /\bJSON\.parse\s*\(/,
      rationale: "JSON.parse produces plain data, never executable objects",
    },
  ],
  limits: [
    "the engine receives the extracted <script> body only: `v-html=\"expr\"` is a real XSS sink but lives in the template, which is NOT scanned — so a Vue XSS path through v-html is invisible here",
    "template interpolation (\"{{ value }}\") is escaped by Vue at the boundary and is deliberately not modelled",
    "Composition API refs (`ref`, `reactive`, `computed`) are ordinary identifiers to the flow engine; `.value` unwrapping is not modelled",
    "props are matched by `defineProps` / `props.x`; `inject()` values and provide/inject chains are out of scope",
    "only the script block is analysed: template-only components with no `<script>` produce no symbols and therefore no leads",
  ],
}