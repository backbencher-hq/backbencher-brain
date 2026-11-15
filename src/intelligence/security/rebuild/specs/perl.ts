// M72 — Perl security spec (lane B). DATA only: lexical syntax plus
// source/sink/sanitizer rules; the rebuild engine (matcher + flow) decides
// whether a sink becomes a lead. Frozen contract: ../spec-types.ts.
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/{PLAN,LANGUAGES}.md,
//   validation/m72/fixtures/perl/.
// CONTRACTS IT MUST NOT BREAK — @ARGV/$ENV/stdin are sources; system/exec/qx/eval
//   and DBI statement methods are sinks; interpolation inside a masked literal
//   is therefore not visible to the matcher.
// TIER — leads: lexical rules only; output is a lead to validate, not a finding.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "perl",
  tier: "leads",
  tierReason: "Perl source/sink rules; ARGV/system rules without data-flow proof",
  lexical: {
    lineComments: ["#"],
    blockComments: [
      ["=pod", "=cut"],
      ["=head1", "=cut"],
    ],
    strings: [
      { delimiter: '"', escape: "\\" },
      { delimiter: "'", escape: "\\" },
    ],
  },
  sources: [
    {
      id: "perl.stdin",
      pattern: /<STDIN>/,
      sourceType: "user_input",
      description: "STDIN line read",
    },
    {
      id: "perl.env",
      pattern: /\$ENV\s*\{/,
      sourceType: "env",
      description: "environment hash read",
    },
    {
      id: "perl.argv",
      pattern: /@ARGV\b|\$ARGV\b/,
      sourceType: "argv",
      description: "command-line argument vector",
    },
    {
      id: "perl.readline",
      pattern: /\breadline\s*\(/,
      sourceType: "user_input",
      description: "readline() of a handle",
    },
    {
      id: "perl.cgi_param",
      pattern: /\bparam\s*\(/,
      sourceType: "user_input",
      description: "CGI.pm param() request value",
      captureVariable: true,
    },
  ],
  sinks: [
    {
      id: "perl.cmd.process",
      pattern: /\b(?:system|exec)\s*\(/,
      vulnerability: "command_injection",
      sinkType: "shell_exec",
      severity: "critical",
      argument: "first",
      description: "system()/exec() with a dynamic command string",
    },
    {
      id: "perl.cmd.qx",
      pattern: /\bqx\s*[(\[{<]/,
      vulnerability: "command_injection",
      sinkType: "shell_exec",
      severity: "critical",
      argument: "any",
      description: "qx() shell-command literal",
    },
    {
      id: "perl.cmd.readpipe",
      pattern: /\breadpipe\s*\(/,
      vulnerability: "command_injection",
      sinkType: "shell_exec",
      severity: "critical",
      argument: "first",
      description: "readpipe() executes a command string",
    },
    {
      id: "perl.code.eval",
      pattern: /\beval\s*(?:\(|\$)/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "critical",
      argument: "any",
      description: "string eval() compiles and runs Perl source",
    },
    {
      id: "perl.sql.dbi",
      pattern: /->\s*(?:do|prepare|selectall_arrayref|selectrow_array|selectrow_hashref|selectcol_arrayref)\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "sql_exec",
      severity: "high",
      argument: "all",
      description: "DBI statement execution on a dynamically built statement",
    },
    {
      id: "perl.path.file_mutation",
      pattern: /\b(?:unlink|rename|rmtree)\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_mutation",
      severity: "high",
      argument: "first",
      description: "delete/rename of a caller-influenced path",
    },
    {
      id: "perl.deser.storable_yaml",
      pattern: /\bStorable\s*::\s*(?:thaw|retrieve)\s*\(|\bYAML\s*::\s*(?:Load|load)\s*\(/,
      vulnerability: "insecure_deserialization",
      sinkType: "deserialize",
      severity: "high",
      argument: "first",
      description: "Storable/YAML load of untrusted bytes can instantiate arbitrary objects",
    },
    {
      id: "perl.ssrf.lwp",
      pattern: /\b(?:LWP::UserAgent|HTTP::Tiny|Mojo::UserAgent)\b[^;\n]{0,160}?->\s*(?:get|post|request)\s*\(/,
      vulnerability: "ssrf",
      sinkType: "http_request",
      severity: "high",
      argument: "any",
      description: "HTTP client request to a caller-controlled URL",
    },
  ],
  sanitizers: [
    {
      id: "perl.sql.bind",
      vulnerability: "sql_injection",
      pattern: /\bbind_param\s*\(/,
      rationale: "DBI bind_param keeps values out of the statement text",
    },
    {
      id: "perl.cmd.shell_quote",
      vulnerability: "command_injection",
      pattern: /\bshell_quote\s*\(/,
      rationale: "String::ShellQuote shell_quote escapes the value for a shell command line",
    },
    {
      id: "perl.path.basename",
      vulnerability: "path_traversal",
      pattern: /\bbasename\s*\(/,
      rationale: "File::Basename strips directory components before the path is used",
    },
    {
      id: "perl.xss.encode_entities",
      vulnerability: "xss",
      pattern: /\bencode_entities\s*\(|\bHTML::Entities\b/,
      rationale: "HTML::Entities encodes the value for HTML output",
    },
    {
      id: "perl.code.safe",
      vulnerability: "code_injection",
      pattern: /\bSafe\s*->\s*new\b/,
      rationale: "Safe compartment restricts which operations evaluated code can perform",
    },
    {
      id: "perl.deser.json",
      vulnerability: "insecure_deserialization",
      pattern: /\bJSON::(?:PP\.)?(?:decode|decode_json)\s*\(/,
      rationale: "JSON decoding produces data only, never Perl objects",
    },
  ],
  limits: [
    "Perl interpolates variables inside double-quoted and qq strings; masked literals hide values assembled there, so the fixtures assign the tainted value before the sink",
    "q/qq/qw literals and heredocs are not masked by the simple delimiter table",
    "two-argument open() pipe forms (open FH, \"|cmd\") are not modelled as sinks because the mode is inside a masked literal",
    "dynamic method names, autoload and string eval of generated code are not resolved",
  ],
}
