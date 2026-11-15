// M72 Phase 2b-6 — Svelte security spec (lane: component formats). DATA only:
// lexical syntax plus source/sink/sanitizer rules; the rebuild engine
// (matcher + flow) decides whether a sink becomes a lead.
// Frozen contract: ../spec-types.ts.
//
// WHAT THE ENGINE ACTUALLY RECEIVES — `src/ast/pool-worker.ts` classifies
//   `svelte` as a JS-family language (`JS_FAMILY = {javascript, typescript, tsx,
//   vue, svelte}`) and extracts each `<script>` / `<script lang="ts">` /
//   `<script setup>` block as ordinary symbols with real byte offsets. So these
//   rules are written against SCRIPT CONTENT, never against `.svelte` markup.
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/{PLAN,PHASE-2,PHASE-2B}.md,
//   validation/m72/fixtures/svelte/, validation/m72/results/density.json.
// CONTRACTS IT MUST NOT BREAK — template sinks (`{@html expr}`) are NOT claimed:
//   the extracted body does not contain them, so a rule that can never fire is a
//   defect, not coverage. `svelte` stays tier=leads: a lead is not a finding.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "svelte",
  tier: "leads",
  tierReason:
    "Svelte script blocks are real executable TypeScript/JavaScript, but reachability is intra-symbol and template markup is out of scope; output is a lead to validate.",
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
      id: "svelte.prop",
      pattern: /\bexport\s+let\s+(\w+)/,
      sourceType: "user_input",
      description: "Svelte 4 `export let` prop — a value supplied by the parent component",
      captureVariable: true,
    },
    {
      id: "svelte.runes",
      pattern: /\$(?:props|state|derived|bindable)\s*\(/,
      sourceType: "user_input",
      description: "Svelte 5 rune input — $props() is caller-supplied; $state/$derived carry reactive values",
    },
    {
      id: "svelte.browser",
      pattern: /\b(?:location\.(?:search|hash|href)|document\.(?:URL|referrer|cookie))\b/,
      sourceType: "user_input",
      description: "browser-controlled value (URL, referrer, cookie) readable inside onMount",
    },
    {
      id: "svelte.network",
      pattern: /\b(?:await\s+)?(?:fetch|XMLHttpRequest)\s*\(/,
      sourceType: "network",
      description: "a response body from fetch/XHR is network-controlled",
    },
    {
      id: "svelte.env",
      pattern: /\bimport\.meta\.env\b/,
      sourceType: "env",
      description: "build-time environment access (import.meta.env)",
    },
  ],
  sinks: [
    {
      id: "svelte.code.eval",
      pattern: /\beval\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "critical",
      argument: "first",
      description: "eval() executes a string as code",
    },
    {
      id: "svelte.code.new_function",
      pattern: /\bnew\s+Function\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "critical",
      argument: "all",
      description: "new Function() compiles a dynamic function body",
    },
    {
      id: "svelte.cmd.child_process",
      pattern: /\b(?:child_process\.)?(?:exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "critical",
      argument: "first",
      description: "child_process execution with a caller-influenced command",
    },
    {
      id: "svelte.xss.inner_html",
      pattern: /\.innerHTML\s*=/,
      vulnerability: "xss",
      sinkType: "html_output",
      severity: "high",
      argument: "any",
      description: "innerHTML assignment from a script value (DOM XSS)",
    },
    {
      id: "svelte.xss.document_write",
      pattern: /\bdocument\.write\s*\(/,
      vulnerability: "xss",
      sinkType: "html_output",
      severity: "high",
      argument: "first",
      description: "document.write() injects markup",
    },
    {
      id: "svelte.xss.insert_adjacent_html",
      pattern: /\.insertAdjacentHTML\s*\(/,
      vulnerability: "xss",
      sinkType: "html_output",
      severity: "high",
      argument: "any",
      description: "insertAdjacentHTML injects markup",
    },
    {
      id: "svelte.sql.query",
      pattern: /\b(?:connection|pool|client|db|knex)\.(?:query|raw|execute)\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "sql_exec",
      severity: "high",
      argument: "all",
      description: "database query execution on a dynamically built statement",
    },
    {
      id: "svelte.path.fs_mutation",
      pattern: /\bfs(?:\.promises)?\.(?:writeFile|appendFile|unlink|rm|rmdir|rename|copyFile|createWriteStream)\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_mutation",
      severity: "high",
      argument: "first",
      description: "filesystem write/delete/move on a caller-influenced path",
    },
    {
      id: "svelte.ssrf.fetch",
      pattern: /\b(?:fetch|axios\.(?:get|post|put|patch|delete|request))\s*\(\s*[`'"]?\s*\$\{/,
      vulnerability: "ssrf",
      sinkType: "http_request",
      severity: "high",
      argument: "first",
      description: "outbound request whose target is built by interpolation",
    },
    {
      id: "svelte.redirect.location",
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
      id: "svelte.sql.binding",
      vulnerability: "sql_injection",
      pattern: /\b(?:query|execute)\s*\([^,()]+,\s*[(\[]|\bvalues\s*:\s*\[/,
      rationale: "a bound-parameter array keeps values out of the SQL text",
    },
    {
      id: "svelte.sql.prepared",
      vulnerability: "sql_injection",
      pattern: /\.prepare\s*\(/,
      rationale: "prepared statement separates statement text from bound values",
    },
    {
      id: "svelte.cmd.argv_array",
      vulnerability: "command_injection",
      pattern: /\bexecFile(?:Sync)?\s*\([^,()]+,\s*\[/,
      rationale: "execFile with an argv array does not invoke a shell",
    },
    {
      id: "svelte.xss.dompurify",
      vulnerability: "xss",
      pattern: /\bDOMPurify\.sanitize\s*\(|\bsanitizeHtml\s*\(/,
      rationale: "DOMPurify/sanitize-html removes executable markup before insertion",
    },
    {
      id: "svelte.path.basename",
      vulnerability: "path_traversal",
      pattern: /\bpath\.(?:basename|normalize)\s*\(/,
      rationale: "basename/normalize constrain the path before the filesystem call",
    },
    {
      id: "svelte.deser.json_parse",
      vulnerability: "insecure_deserialization",
      pattern: /\bJSON\.parse\s*\(/,
      rationale: "JSON.parse produces plain data, never executable objects",
    },
  ],
  limits: [
    "the engine receives the extracted <script> body only: `{@html expr}` and other template sinks are NOT scanned, so a real Svelte XSS path through template markup is invisible here",
    "template expression interpolation (\"{value}\" text) is escaped by Svelte at the boundary and is deliberately not modelled",
    "reactive declarations ($: a = b, $derived) are treated as ordinary assignments; Svelte's dependency graph is not modelled",
    "store auto-subscription is matched by the `$name` token, so a local `$`-prefixed variable also matches — this over-reports by design (leads, not findings)",
    "only the script block is analysed: markup-derived values passed as props are sources, but markup callbacks (onclick=\"...\") are out of scope",
  ],
}