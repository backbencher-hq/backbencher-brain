// M72 — R security spec (lane B). DATA only: lexical syntax plus
// source/sink/sanitizer rules; the rebuild engine (matcher + flow) decides
// whether a sink becomes a lead. Frozen contract: ../spec-types.ts.
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/{PLAN,LANGUAGES}.md,
//   validation/m72/fixtures/r/.
// CONTRACTS IT MUST NOT BREAK — commandArgs/Sys.getenv/readline/Shiny input are
//   sources; system/eval/parse/DBI/deserialization are sinks; shQuote and DBI
//   bound parameters are the sanitized forms.
// TIER — leads: lexical rules only; output is a lead to validate, not a finding.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "r",
  tier: "leads",
  tierReason: "R source/sink rules; commandArgs/system/source rules without flow proof",
  lexical: {
    lineComments: ["#"],
    blockComments: [],
    strings: [
      { delimiter: '"', escape: "\\" },
      { delimiter: "'", escape: "\\" },
    ],
  },
  sources: [
    {
      id: "r.command_args",
      pattern: /\bcommandArgs\s*\(/,
      sourceType: "argv",
      description: "command-line arguments from commandArgs()",
    },
    {
      id: "r.env",
      pattern: /\bSys\.getenv\s*\(/,
      sourceType: "env",
      description: "environment variable read (Sys.getenv)",
    },
    {
      id: "r.readline",
      pattern: /\breadline\s*\(/,
      sourceType: "user_input",
      description: "console input from readline()",
    },
    {
      id: "r.file_read",
      pattern: /\breadLines\s*\(|\bread\.csv\s*\(/,
      sourceType: "file",
      description: "file contents read with readLines/read.csv",
    },
    {
      id: "r.shiny_input",
      pattern: /\binput\s*\$/,
      sourceType: "user_input",
      description: "Shiny reactive input value (input$name)",
      captureVariable: true,
    },
    {
      id: "r.http_response",
      pattern: /\bhttr::(?:GET|POST)\s*\(/,
      sourceType: "network",
      description: "HTTP response body fetched with httr",
    },
  ],
  sinks: [
    {
      id: "r.cmd.system",
      pattern: /\bsystem2?\s*\(/,
      vulnerability: "command_injection",
      sinkType: "shell_exec",
      severity: "critical",
      argument: "first",
      description: "system()/system2() runs an OS shell command",
    },
    {
      id: "r.cmd.shell",
      pattern: /\bshell\s*\(/,
      vulnerability: "command_injection",
      sinkType: "shell_exec",
      severity: "critical",
      argument: "first",
      description: "shell() runs a command through the OS shell",
    },
    {
      id: "r.code.eval",
      pattern: /\beval(?:q)?\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "critical",
      argument: "first",
      description: "eval()/evalq() evaluates a dynamic R expression",
    },
    {
      id: "r.code.parse",
      pattern: /\bparse\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "high",
      argument: "first",
      description: "parse() turns a dynamic string into evaluated code (eval(parse(text=...)))",
    },
    {
      id: "r.code.source",
      pattern: /\bsource\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "high",
      argument: "first",
      description: "source() executes an R file chosen at runtime",
    },
    {
      id: "r.sql.dbi",
      pattern: /\bdb(?:GetQuery|Execute|SendQuery)\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "sql_exec",
      severity: "high",
      argument: "all",
      description: "DBI statement execution on a dynamically built statement",
    },
    {
      id: "r.path.write",
      pattern: /\bwrite\.(?:csv|table|Lines)\s*\(|\bsaveRDS\s*\(|\bfile\.remove\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_mutation",
      severity: "high",
      argument: "first",
      description: "file write/delete on a caller-influenced path",
    },
    {
      id: "r.deser.rds",
      pattern: /\b(?:readRDS|load)\s*\(/,
      vulnerability: "insecure_deserialization",
      sinkType: "deserialize",
      severity: "high",
      argument: "first",
      description: "readRDS()/load() deserializes untrusted R objects",
    },
    {
      id: "r.ssrf.download",
      pattern: /\bdownload\.file\s*\(/,
      vulnerability: "ssrf",
      sinkType: "http_request",
      severity: "high",
      argument: "first",
      description: "download.file() fetches a caller-controlled URL",
    },
    {
      id: "r.xss.html",
      pattern: /\bHTML\s*\(/,
      vulnerability: "xss",
      sinkType: "html_output",
      severity: "medium",
      argument: "first",
      description: "shiny::HTML() marks a string as trusted markup output",
    },
  ],
  sanitizers: [
    {
      id: "r.sql.bound",
      vulnerability: "sql_injection",
      pattern: /\bdb(?:GetQuery|Execute|SendQuery)\s*\([^,()]+,[^,()]+,/,
      rationale: "DBI params= argument binds values instead of interpolating them",
    },
    {
      id: "r.cmd.sh_quote",
      vulnerability: "command_injection",
      pattern: /\bshQuote\s*\(/,
      rationale: "shQuote() returns a shell-quoted command string",
    },
    {
      id: "r.path.basename",
      vulnerability: "path_traversal",
      pattern: /\bbasename\s*\(/,
      rationale: "basename() strips directory components before the path is used",
    },
    {
      id: "r.validate.match_arg",
      vulnerability: "*",
      pattern: /\bmatch\.arg\s*\(/,
      rationale: "match.arg() restricts the value to an allowed argument set",
    },
    {
      id: "r.xss.html_escape",
      vulnerability: "xss",
      pattern: /\bhtmltools::(?:htmlEscape|escapeHtml)\s*\(/,
      rationale: "htmltools escaping encodes the value before markup output",
    },
  ],
  limits: [
    "R metaprogramming (do.call, rlang injection operators, substitute/bquote) is not resolved",
    "Shiny server modules pass input through closures; only input$NAME references are sources",
    "paste/paste0 string interpolation is not tracked; a value built into a command string is only visible when a variable appears outside a literal",
    "readRDS/load are reported as deserialization sinks even when the path is a trusted fixture",
  ],
}
