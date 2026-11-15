// M72 — Python security spec (lane B). DATA only: lexical syntax plus
// source/sink/sanitizer rules; the rebuild engine (matcher + flow) decides
// whether a sink becomes a lead. Frozen contract: ../spec-types.ts.
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/{PLAN,LANGUAGES}.md,
//   validation/m72/fixtures/python/.
// CONTRACTS IT MUST NOT BREAK — every sink is a real API with an argument
//   selector; sources and sinks are distinct call shapes; a constant argument
//   is never a lead.
// TIER — leads: lexical rules only; output is a lead to validate, not a finding.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "python",
  tier: "leads",
  tierReason: "Python source/sink rules; no interprocedural or attribute-flow proof",
  lexical: {
    lineComments: ["#"],
    blockComments: [],
    strings: [
      { delimiter: '"', escape: "\\" },
      { delimiter: "'", escape: "\\" },
      { delimiter: '"""', escape: "\\", multiline: true },
      { delimiter: "'''", escape: "\\", multiline: true },
    ],
  },
  sources: [
    {
      id: "python.input",
      pattern: /\binput\s*\(/,
      sourceType: "user_input",
      description: "console/stdin value from input()",
    },
    {
      id: "python.argv",
      pattern: /\bsys\.argv\b/,
      sourceType: "argv",
      description: "process argument vector sys.argv",
    },
    {
      id: "python.env",
      pattern: /\bos\.(?:environ|getenv)\b/,
      sourceType: "env",
      description: "environment variable read",
    },
    {
      id: "python.request",
      pattern: /\brequest\.(?:args|form|json|values|files|data|GET|POST|COOKIE)\b/,
      sourceType: "user_input",
      description: "web request parameter/body access on the request object",
      captureVariable: true,
    },
    {
      id: "python.stdin",
      pattern: /\bsys\.stdin\.read(?:line)?\s*\(/,
      sourceType: "user_input",
      description: "standard-input read",
    },
    {
      id: "python.file",
      pattern: /\bopen\s*\(/,
      sourceType: "file",
      description: "contents of a file opened with open()",
    },
  ],
  sinks: [
    {
      id: "python.cmd.os_shell",
      pattern: /\bos\.(?:system|popen)\s*\(/,
      vulnerability: "command_injection",
      sinkType: "shell_exec",
      severity: "critical",
      argument: "first",
      description: "os.system/os.popen execute a shell command string",
    },
    {
      id: "python.cmd.subprocess_shell",
      pattern: /\bsubprocess\.(?:run|call|Popen|check_output|check_call)\s*\([^;\n]{0,300}?shell\s*=\s*True/,
      vulnerability: "command_injection",
      sinkType: "shell_exec",
      severity: "critical",
      argument: "all",
      description: "subprocess call with shell=True runs a shell command string",
    },
    {
      id: "python.code.eval",
      pattern: /\beval\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "critical",
      argument: "first",
      description: "eval() executes a Python expression",
    },
    {
      id: "python.code.exec",
      pattern: /\bexec\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "critical",
      argument: "first",
      description: "exec() executes a Python statement block",
    },
    {
      id: "python.deser.pickle",
      pattern: /\b(?:pickle|cPickle|dill|marshal)\.loads?\s*\(/,
      vulnerability: "insecure_deserialization",
      sinkType: "deserialize",
      severity: "high",
      argument: "first",
      description: "pickle/marshal load of untrusted bytes can execute code",
    },
    {
      id: "python.deser.yaml",
      pattern: /\byaml\.load\s*\(/,
      vulnerability: "insecure_deserialization",
      sinkType: "deserialize",
      severity: "high",
      argument: "first",
      description: "yaml.load without SafeLoader constructs arbitrary objects",
    },
    {
      id: "python.sql.execute",
      pattern: /\b(?:cursor|conn|connection)\.execute(?:many|script)?\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "sql_exec",
      severity: "high",
      argument: "all",
      description: "DB-API execute/executemany of a dynamically built statement",
    },
    {
      id: "python.ssrf.requests",
      pattern: /\b(?:requests|httpx)\.(?:get|post|put|patch|delete|request)\s*\(/,
      vulnerability: "ssrf",
      sinkType: "http_request",
      severity: "high",
      argument: "first",
      description: "outbound HTTP request to a caller-controlled URL",
    },
    {
      id: "python.path.fs_mutation",
      pattern: /\b(?:shutil\.rmtree|os\.(?:remove|unlink|rmdir|rename)|shutil\.move)\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_mutation",
      severity: "high",
      argument: "first",
      description: "filesystem mutation on a caller-influenced path",
    },
    {
      id: "python.crypto.weak_hash",
      pattern: /\bhashlib\.(?:md5|sha1)\s*\(/,
      vulnerability: "weak_crypto",
      sinkType: "weak_hash",
      severity: "medium",
      argument: "first",
      description: "MD5/SHA-1 hashing of data from an untrusted source",
    },
  ],
  sanitizers: [
    {
      id: "python.sql.bound_parameters",
      vulnerability: "sql_injection",
      pattern: /\bexecute(?:many)?\s*\([^,()]+,\s*[(\[]/,
      rationale: "DB-API placeholder binding (execute(sql, params)) keeps values out of the SQL text",
    },
    {
      id: "python.cmd.shlex_quote",
      vulnerability: "command_injection",
      pattern: /\bshlex\.quote\s*\(/,
      rationale: "shlex.quote shell-escapes the value before interpolation",
    },
    {
      id: "python.cmd.argv_list",
      vulnerability: "command_injection",
      pattern: /\bsubprocess\.(?:run|call|Popen|check_output|check_call)\s*\(\s*\[/,
      rationale: "argv-list subprocess invocation does not invoke a shell",
    },
    {
      id: "python.deser.safe_loader",
      vulnerability: "insecure_deserialization",
      pattern: /\byaml\.SafeLoader\b/,
      rationale: "yaml.load with SafeLoader restricts construction to safe types",
    },
    {
      id: "python.code.literal_eval",
      vulnerability: "code_injection",
      pattern: /\bast\.literal_eval\s*\(/,
      rationale: "ast.literal_eval parses only literal structures, never code",
    },
    {
      id: "python.path.basename",
      vulnerability: "path_traversal",
      pattern: /\bos\.path\.basename\s*\(/,
      rationale: "basename discards directory components before the path is used",
    },
  ],
  limits: [
    "f-strings and string concatenation are masked as literals: a command/query assembled inside an f-string is only visible when a variable appears outside the literal",
    "attribute and cross-function flow is not modelled; a value passed to a helper and executed there is missed (leads tier)",
    "framework request objects are only recognised by the request.* member list; parsed bodies, ORM expressions and template contexts are not sources",
    "subprocess with shell=False is treated as argv-safe; it never emits a command lead",
  ],
}
