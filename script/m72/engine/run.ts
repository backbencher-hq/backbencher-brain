// script/m72/engine/run.ts — assertion suite for the M72 spec-driven security engine.
//
// WHY THIS FILE EXISTS
//
// The engine replaces a detector whose measured precision was 16.0% and whose
// false positives are named in docs/m72-security-rebuild/PLAN.md: `RegExp.exec`
// paired with a command sink, `r.URL.Query()` treated as SQL, `fopen("/etc/x")`
// as path traversal, comment text and string literals as tokens, and a hardcoded
// `critical` for SQL/command sinks. The suite below pins each of those failure
// modes as a NEGATIVE case (the engine must not emit a lead) next to the
// positive case that proves the rule still fires when the flow is real.
//
// The specs here are SYNTHETIC and tiny on purpose: the engine is spec-driven, so
// the suite must not depend on the real spec lanes being present. A language with
// no spec returns [] — that is asserted, not assumed.
//
// WHAT IT DOES NOT CLAIM — this is not a fixture/oracle gate (that is the
// per-language matrix gate) and it does not measure precision on a corpus. It is
// the unit contract for matcher.ts + flow.ts + engine.ts.
//
// Run: npx tsx script/m72/engine/run.ts
// Exit: non-zero if any assertion fails.

import type { LanguageSecuritySpec, LexicalSyntax } from "../../../src/intelligence/security/rebuild/spec-types"
import {
  analyzeSymbol,
  analyzeSymbols,
  analysisSpecFor,
  compareSecurityLeads,
  normalizeAnalysisLanguage,
  toSecurityLeadInput,
  ENGINE_VERSION,
} from "../../../src/intelligence/security/rebuild/engine"
import { matchSymbol, maskSource } from "../../../src/intelligence/security/rebuild/matcher"
import {
  evaluateSinkFlow,
  extractAssignments,
  isDynamicExpression,
  isSelfPair,
  securitySeverity,
} from "../../../src/intelligence/security/rebuild/flow"

// ── synthetic specs (spec-driven: no real lane spec is imported) ─────────────

const JAVASCRIPT_LEXICAL: LexicalSyntax = {
  lineComments: ["//"],
  blockComments: [["/*", "*/"]],
  strings: [
    { delimiter: "`", escape: "\\", multiline: true },
    { delimiter: '"', escape: "\\" },
    { delimiter: "'", escape: "\\" },
  ],
}

const JAVASCRIPT_SPEC: LanguageSecuritySpec = {
  language: "javascript",
  aliases: ["js"],
  tier: "leads",
  tierReason: "synthetic spec for the engine assertion suite",
  lexical: JAVASCRIPT_LEXICAL,
  sources: [
    { id: "js.express.body", pattern: /req\.body\b/, sourceType: "user_input", description: "Express request body" },
    { id: "js.express.query", pattern: /req\.query\b/, sourceType: "user_input", description: "Express query string" },
    {
      id: "js.regexp.exec",
      pattern: /\.exec\s*\(/,
      sourceType: "unknown",
      description: "RegExp.exec match data (self-pair probe)",
    },
  ],
  sinks: [
    {
      id: "js.sql.query",
      pattern: /db\.query\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "database_write",
      severity: "critical",
      argument: "first",
      description: "db.query with a selected first argument",
    },
    {
      id: "js.sql.execute",
      pattern: /db\.execute\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "database_write",
      severity: "high",
      argument: "all",
      description: "db.execute with any argument",
    },
    {
      id: "js.cmd.exec",
      pattern: /\bexec(?:Sync)?\s*\(/,
      vulnerability: "command_injection",
      sinkType: "command_exec",
      severity: "critical",
      argument: "first",
      description: "child-process exec",
    },
    {
      id: "js.code.eval",
      pattern: /\beval\s*\(/,
      vulnerability: "code_injection",
      sinkType: "dynamic_code",
      severity: "critical",
      argument: "first",
      description: "eval",
    },
    {
      id: "js.xss.innerHTML",
      pattern: /\.innerHTML\s*=\s*/,
      vulnerability: "xss",
      sinkType: "html_write",
      severity: "high",
      argument: "any",
      description: "innerHTML assignment (attribute write)",
    },
  ],
  sanitizers: [
    {
      id: "js.sql.parameterized",
      vulnerability: "sql_injection",
      pattern: /\?\s*(?:["'`]\s*)?[,)]/,
      rationale: "SQL placeholder is parameterized",
    },
    {
      id: "js.sql.numbered",
      vulnerability: "sql_injection",
      pattern: /\$\d+\b/,
      rationale: "numbered SQL placeholder",
    },
    {
      id: "js.prepared",
      vulnerability: "sql_injection",
      pattern: /\.prepare\s*\(/,
      rationale: "prepared statement",
    },
    { id: "js.escape", vulnerability: "*", pattern: /\bescape\w*\s*\(/, rationale: "escaped input" },
  ],
  limits: ["synthetic JavaScript spec — not a shipped lane spec"],
}

const GO_SPEC: LanguageSecuritySpec = {
  language: "go",
  tier: "leads",
  tierReason: "synthetic spec for the engine assertion suite",
  lexical: {
    lineComments: ["//"],
    blockComments: [["/*", "*/"]],
    strings: [{ delimiter: "`", escape: "\\", multiline: true }, { delimiter: '"', escape: "\\" }],
  },
  sources: [
    {
      id: "go.http.query",
      pattern: /r\.URL\.Query\s*\(/,
      sourceType: "user_input",
      description: "request URL query",
      captureVariable: true,
    },
  ],
  sinks: [
    {
      id: "go.sql.query",
      pattern: /\bQuery\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "database_write",
      severity: "high",
      argument: "first",
      description: "database Query",
    },
  ],
  sanitizers: [
    {
      id: "go.sql.parameterized",
      vulnerability: "sql_injection",
      pattern: /\?\s*(?:["'`]\s*)?[,)]/,
      rationale: "SQL placeholder is parameterized",
    },
    {
      id: "go.sql.numbered",
      vulnerability: "sql_injection",
      pattern: /\$\d+\b/,
      rationale: "numbered SQL placeholder",
    },
  ],
  limits: ["synthetic Go spec — not a shipped lane spec"],
}

const C_SPEC: LanguageSecuritySpec = {
  language: "c",
  tier: "leads",
  tierReason: "synthetic spec for the engine assertion suite",
  lexical: {
    lineComments: ["//"],
    blockComments: [["/*", "*/"]],
    strings: [{ delimiter: '"', escape: "\\" }, { delimiter: "'", escape: "\\" }],
  },
  sources: [
    { id: "c.argv", pattern: /\bargv\s*\[/, sourceType: "argv", description: "process argv" },
    { id: "c.getenv", pattern: /\bgetenv\s*\(/, sourceType: "env", description: "environment variable" },
  ],
  sinks: [
    {
      id: "c.path.fopen",
      pattern: /\bfopen\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_open",
      severity: "medium",
      argument: "first",
      description: "fopen",
    },
  ],
  sanitizers: [
    { id: "c.path.realpath", vulnerability: "path_traversal", pattern: /\brealpath\s*\(/, rationale: "canonicalised path" },
  ],
  limits: ["synthetic C spec — not a shipped lane spec"],
}

const RUST_LEXICAL: LexicalSyntax = {
  lineComments: ["//"],
  blockComments: [["/*", "*/"]],
  strings: [{ delimiter: '"', escape: "\\" }, { delimiter: "'", escape: "\\" }],
}

const RUST_SOURCES: LanguageSecuritySpec["sources"] = [
  {
    id: "rust.env.argv",
    pattern: /\bstd::env::args\s*\(/,
    sourceType: "argv",
    description: "process arguments",
  },
]

const RUST_WITH_COMMAND: LanguageSecuritySpec = {
  language: "rust",
  tier: "leads",
  tierReason: "synthetic spec for the engine assertion suite (declares Command::new)",
  lexical: RUST_LEXICAL,
  sources: RUST_SOURCES,
  sinks: [
    {
      id: "rust.cmd.new",
      pattern: /\bCommand::new\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_spawn",
      severity: "critical",
      argument: "any",
      description: "Command::new",
    },
  ],
  sanitizers: [],
  limits: ["synthetic Rust spec — not a shipped lane spec"],
}

const RUST_WITHOUT_COMMAND: LanguageSecuritySpec = {
  language: "rust",
  tier: "leads",
  tierReason: "synthetic spec for the engine assertion suite (does not declare Command::new)",
  lexical: RUST_LEXICAL,
  sources: RUST_SOURCES,
  sinks: [
    {
      id: "rust.fs.read",
      pattern: /\bstd::fs::read\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_read",
      severity: "medium",
      argument: "first",
      description: "std::fs::read",
    },
  ],
  sanitizers: [],
  limits: ["synthetic Rust spec — not a shipped lane spec"],
}

const UNSUPPORTED_SPEC: LanguageSecuritySpec = {
  language: "synthetic-unsupported",
  tier: "unsupported",
  tierReason: "no executable source/sink model",
  lexical: { lineComments: [], blockComments: [], strings: [] },
  sources: [{ id: "u.source", pattern: /\binput\b/, sourceType: "unknown", description: "input" }],
  sinks: [
    {
      id: "u.sink",
      pattern: /\bdanger\s*\(/,
      vulnerability: "command_injection",
      sinkType: "command_exec",
      severity: "critical",
      argument: "first",
      description: "danger",
    },
  ],
  sanitizers: [],
  limits: [],
}

const CONSTANT_FLAG_SPEC: LanguageSecuritySpec = {
  language: "synthetic-flag",
  tier: "leads",
  tierReason: "synthetic",
  lexical: { lineComments: [], blockComments: [], strings: [{ delimiter: '"', escape: "\\" }] },
  sources: [{ id: "f.source", pattern: /\binput\b/, sourceType: "unknown", description: "input" }],
  sinks: [
    {
      id: "f.sink",
      pattern: /\bdanger\s*\(/,
      vulnerability: "command_injection",
      sinkType: "command_exec",
      severity: "critical",
      argument: "first",
      requiresDynamicArgument: false,
      description: "danger (flag opt-out is tested, contract still rejects constants)",
    },
  ],
  sanitizers: [],
  limits: [],
}

// ── assertion harness ────────────────────────────────────────────────────────

let checks = 0
const failures: string[] = []

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualText = JSON.stringify(actual)
  const expectedText = JSON.stringify(expected)
  if (actualText !== expectedText) throw new Error(`${message}: expected ${expectedText}, got ${actualText}`)
}

function check(label: string, body: () => void): void {
  checks += 1
  try {
    body()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failures.push(`${label}: ${message}`)
    console.log(`FAIL ${label}`)
    console.log(`     ${message}`)
  }
}

const FIXTURE_FILE = "fixture.ts"
const FIXTURE_SYMBOL = "fixture:symbol:1"

function run(
  spec: LanguageSecuritySpec,
  source: string,
  options: { maxReachDepth?: number } = {},
) {
  return analyzeSymbol(
    {
      language: spec.language,
      source,
      file: FIXTURE_FILE,
      symbolId: FIXTURE_SYMBOL,
      symbolLine: 10,
    },
    { spec, ...options },
  )
}

/** The first sink's flow decision, for asserting WHY a case produced no lead. */
function decisionFor(spec: LanguageSecuritySpec, source: string) {
  const match = matchSymbol(spec, source)
  assert(match.sinks.length > 0, "expected at least one sink match")
  const assignments = extractAssignments(match)
  return { match, sink: match.sinks[0]!, decision: evaluateSinkFlow(spec, match, match.sinks[0]!, assignments) }
}

// ── 1. masking ───────────────────────────────────────────────────────────────

check("mask: comment/string contents are blanked, offsets and lines survive", () => {
  const source = 'const a = "req.body"; // req.body\nconst b = db.query("x"); /* db.query( */'
  const masked = maskSource(JAVASCRIPT_LEXICAL, source)
  assertEqual(masked.masked.length, source.length, "masked text keeps the source length")
  assertEqual(masked.masked.split("\n").length, source.split("\n").length, "newlines survive masking")
  assertEqual(masked.strings.length, 2, "two string spans")
  assertEqual(masked.comments.length, 2, "one line + one block comment span")
  assertEqual(masked.masked.indexOf("req.body"), -1, "string/comment contents are not matchable")
  const codeMatches = masked.masked.match(/db\.query\(/g) ?? []
  assertEqual(codeMatches.length, 1, "only the code occurrence of db.query( survives")
  assert(masked.masked.includes('"'), "string delimiters stay visible for literal checks")
})

check("mask: an unterminated quote is punctuation, not a mask-to-EOF", () => {
  const source = "const lifetime = 'a; // still a comment\nconst q = db.query(req.body.x)"
  const masked = maskSource(JAVASCRIPT_LEXICAL, source)
  assertEqual(masked.strings.length, 0, "no string span without a closer")
  assertEqual(masked.comments.length, 1, "the line comment is still masked")
  assert(masked.masked.includes("'a"), "the stray quote is left as code")
  assert(masked.masked.includes("db.query(req.body.x)"), "code after the stray quote is still visible")
})

// ── 2. offsets and lines ────────────────────────────────────────────────────

check("match: byte offsets are UTF-8 and lines are symbol-relative one-based", () => {
  const source = "// héllo\nconst q = req.body.q\ndb.query(q)\n"
  const match = matchSymbol(JAVASCRIPT_SPEC, source)
  const sourceMatch = match.sources.find((candidate) => candidate.ruleId === "js.express.body")
  assert(sourceMatch, "source match present")
  const sink = match.sinks.find((candidate) => candidate.ruleId === "js.sql.query")
  assert(sink, "sink match present")
  assertEqual(sourceMatch.line, 2, "source line")
  assertEqual(sink.line, 3, "sink line")
  assertEqual(
    sourceMatch.byteStart,
    Buffer.byteLength(source.slice(0, source.indexOf("req.body"))),
    "source byteStart is a UTF-8 byte offset",
  )
  assertEqual(sink.byteStart, Buffer.byteLength(source.slice(0, source.indexOf("db.query"))), "sink byteStart")
  assertEqual(sourceMatch.byteStart - sourceMatch.charStart, 1, "the é before the match adds one byte")
})

// ── 3. self-pair: RegExp .exec() ────────────────────────────────────────────

check("self-pair: RegExp .exec() is not paired as a command/SQL flow", () => {
  const source = "const re = /foo/; re.exec(payload)"
  const match = matchSymbol(JAVASCRIPT_SPEC, source)
  assertEqual(match.sources.length, 1, "the regex-result source matched the same token")
  assertEqual(match.sinks.length, 1, "the command sink matched the same token")
  assert(isSelfPair(match.sources[0]!, match.sinks[0]!), "the two matches share a span")
  const { decision } = decisionFor(JAVASCRIPT_SPEC, source)
  assertEqual(decision.accepted, false, "no flow is accepted")
  assertEqual(decision.rejection, "self_pair", "rejection reason is self_pair")
  assertEqual(run(JAVASCRIPT_SPEC, source).length, 0, "no lead emitted")
})

check("self-pair: distinct source/sink spans are not a self-pair", () => {
  const match = matchSymbol(JAVASCRIPT_SPEC, "const sql = req.body.sql\ndb.query(sql)")
  const sourceMatch = match.sources.find((candidate) => candidate.ruleId === "js.express.body")
  const sink = match.sinks.find((candidate) => candidate.ruleId === "js.sql.query")
  assert(sourceMatch && sink, "both matches present")
  assertEqual(isSelfPair(sourceMatch, sink), false, "disjoint matches are a real flow candidate")
})

// ── 4. Go: r.URL.Query() is not a SQL sink ──────────────────────────────────

check("go: r.URL.Query() matches the Query sink but never emits a lead", () => {
  const source = "q := r.URL.Query()"
  const match = matchSymbol(GO_SPEC, source)
  assertEqual(match.sinks.length, 1, "the SQL-shaped sink token is present")
  assertEqual(match.sinks[0]!.vulnerability, "sql_injection", "and it is a sql_injection sink")
  const { decision } = decisionFor(GO_SPEC, source)
  assertEqual(decision.accepted, false, "no flow is accepted")
  assertEqual(decision.rejection, "self_pair", "the URL-query source covers the same token")
  assertEqual(run(GO_SPEC, source).length, 0, "no lead emitted")
})

check("go: a tainted db.Query still produces a sql_injection lead (control)", () => {
  const source = 'id := r.URL.Query().Get("id")\ndb.Query("SELECT * FROM t WHERE id = " + id)'
  const leads = run(GO_SPEC, source)
  assertEqual(leads.length, 1, "one lead")
  assertEqual(leads[0]!.vulnerability, "sql_injection", "vulnerability")
  assertEqual(leads[0]!.ruleId, "go.sql.query", "sink rule id")
  assertEqual(leads[0]!.severity, "high", "rule-defined severity")
  assertEqual(leads[0]!.evidence.source.ruleId, "go.http.query", "source rule id")
  assertEqual(leads[0]!.evidence.reachPath[0], "go.http.query", "reach path starts with the source rule")
})

// ── 5. constant arguments ───────────────────────────────────────────────────

check('constant: fopen("/etc/shadow") is not path traversal', () => {
  const source = 'FILE *f = fopen("/etc/shadow", "r");'
  const { decision } = decisionFor(C_SPEC, source)
  assertEqual(decision.dynamic, false, "the selected argument is a literal")
  assertEqual(decision.rejection, "constant_argument", "rejection reason")
  assertEqual(run(C_SPEC, source).length, 0, "no lead emitted")
})

check('constant: exec("ls -la") is rejected as a constant argument', () => {
  const source = 'exec("ls -la")'
  const { decision } = decisionFor(JAVASCRIPT_SPEC, source)
  assertEqual(decision.rejection, "constant_argument", "rejection reason")
  assertEqual(run(JAVASCRIPT_SPEC, source).length, 0, "no lead emitted")
})

check("constant: requiresDynamicArgument:false cannot opt a literal into a lead", () => {
  const source = 'danger("constant")'
  const { decision } = decisionFor(CONSTANT_FLAG_SPEC, source)
  assertEqual(decision.rejection, "constant_argument", "the frozen contract rejects constants regardless of the flag")
  assertEqual(run(CONSTANT_FLAG_SPEC, source).length, 0, "no lead emitted")
})

check("constant: a tainted fopen(path) does lead (positive control)", () => {
  const source = ['const char *path = argv[1];', 'FILE *f = fopen(path, "r");'].join("\n")
  const leads = run(C_SPEC, source)
  assertEqual(leads.length, 1, "one lead")
  assertEqual(leads[0]!.vulnerability, "path_traversal", "vulnerability")
  assertEqual(leads[0]!.severity, "medium", "rule-defined severity stays medium")
})

// ── 6. dynamic source -> sink leads and severity ────────────────────────────

check("lead: req.body -> concatenated db.query is an sql_injection lead", () => {
  const source = [
    "const name = req.body.name",
    'db.query("SELECT * FROM users WHERE name = \'" + name + "\'")',
  ].join("\n")
  const leads = run(JAVASCRIPT_SPEC, source)
  assertEqual(leads.length, 1, "one lead")
  const lead = leads[0]!
  assertEqual(lead.vulnerability, "sql_injection", "vulnerability")
  assertEqual(lead.ruleId, "js.sql.query", "sink rule id")
  assertEqual(lead.tier, "leads", "tier comes from the spec")
  assertEqual(lead.state, "lead", "lexical output is a lead, not a candidate")
  assertEqual(lead.evidence.source.ruleId, "js.express.body", "source rule id")
  assertEqual(lead.evidence.dynamic, true, "argument is dynamic")
  assert(lead.evidence.argumentText.includes("SELECT * FROM users"), "argument text is the inspected SQL expression")
  assertEqual(lead.evidence.reachPath.length, 2, "source rule + one assignment hop")
  assert(lead.evidence.reachPath[1]!.includes("name = req.body.name"), "assignment chain is evidence")
})

check("severity: an sql_injection rule claiming critical is clamped to high", () => {
  const source = "const id = req.body.id\ndb.query(\"SELECT * FROM t WHERE id = '\" + id + \"'\")"
  const leads = run(JAVASCRIPT_SPEC, source)
  assertEqual(leads.length, 1, "one lead")
  assertEqual(leads[0]!.severity, "high", "sql_injection may not be critical")
})

check("lead: command injection stays critical when dynamic and unsanitized", () => {
  const command = run(JAVASCRIPT_SPEC, "child_process.exec(req.body.cmd)")
  assertEqual(command.length, 1, "command lead")
  assertEqual(command[0]!.vulnerability, "command_injection", "vulnerability")
  assertEqual(command[0]!.severity, "critical", "command execution with dynamic input is critical")
  const code = run(JAVASCRIPT_SPEC, "eval(req.body.code)")
  assertEqual(code.length, 1, "code lead")
  assertEqual(code[0]!.vulnerability, "code_injection", "vulnerability")
  assertEqual(code[0]!.severity, "critical", "code execution with dynamic input is critical")
})

check("lead: a source call inside the sink argument is a direct flow", () => {
  const leads = run(JAVASCRIPT_SPEC, "db.query(buildSql(req.body.q))")
  assertEqual(leads.length, 1, "one lead")
  assertDeepEqual(leads[0]!.evidence.reachPath, ["js.express.body"], "direct flow has no assignment hops")
})

// ── 7. parameterized / sanitized sinks ──────────────────────────────────────

check("sanitized: a parameterized ? placeholder excludes the sink", () => {
  const source = 'db.execute("SELECT * FROM users WHERE id = ?", [req.body.id])'
  const { decision } = decisionFor(JAVASCRIPT_SPEC, source)
  assertEqual(decision.accepted, false, "no flow accepted")
  assertEqual(decision.rejection, "sanitized", "rejection reason")
  assertEqual(decision.sanitizer?.ruleId, "js.sql.parameterized", "sanitizer rule id")
  assertEqual(run(JAVASCRIPT_SPEC, source).length, 0, "no lead emitted")
})

check("sanitized: a numbered $1 placeholder excludes the sink", () => {
  const source = 'db.execute("SELECT * FROM users WHERE id = $1", [req.body.id])'
  const { decision } = decisionFor(JAVASCRIPT_SPEC, source)
  assertEqual(decision.rejection, "sanitized", "rejection reason")
  assertEqual(decision.sanitizer?.ruleId, "js.sql.numbered", "sanitizer rule id")
  assertEqual(run(JAVASCRIPT_SPEC, source).length, 0, "no lead emitted")
})

check("sanitized: the same shape without a placeholder still leads (control)", () => {
  const source = 'db.execute("SELECT * FROM users WHERE id = " + req.body.id, [])'
  const leads = run(JAVASCRIPT_SPEC, source)
  assertEqual(leads.length, 1, "one lead")
  assertEqual(leads[0]!.ruleId, "js.sql.execute", "sink rule id")
})

// ── 8. comment-only tokens ─────────────────────────────────────────────────

check("comment: comment-only and string-only tokens produce no matches or leads", () => {
  const source = [
    "// db.query(req.body.login)",
    "/* req.body -> db.query( */",
    'const note = "db.query(req.body.login)"',
  ].join("\n")
  const match = matchSymbol(JAVASCRIPT_SPEC, source)
  assertEqual(match.sources.length, 0, "no source matched inside comments/strings")
  assertEqual(match.sinks.length, 0, "no sink matched inside comments/strings")
  assertEqual(run(JAVASCRIPT_SPEC, source).length, 0, "no lead emitted")
})

// ── 9. Rust: recognized only when the spec declares it ─────────────────────

function rustBody(): string {
  return ["fn run() {", "  let input = std::env::args().nth(1).unwrap();", "  Command::new(input);", "}"].join("\n")
}

check("rust: Command::new leads only when the spec declares that sink", () => {
  const withSpec = run(RUST_WITH_COMMAND, rustBody())
  assertEqual(withSpec.length, 1, "the declaring spec produces a lead")
  assertEqual(withSpec[0]!.vulnerability, "command_injection", "vulnerability")
  assertEqual(withSpec[0]!.ruleId, "rust.cmd.new", "sink rule id")
  assertEqual(withSpec[0]!.severity, "critical", "dynamic command execution is critical")
  const withoutSpec = run(RUST_WITHOUT_COMMAND, rustBody())
  assertEqual(withoutSpec.length, 0, "the same code is NOT a lead when the spec does not declare Command::new")
})

check('rust: chained Command::new("sh").arg(input) is covered by argument:"any"', () => {
  const source = [
    "fn run() {",
    "  let input = std::env::args().nth(1).unwrap();",
    '  Command::new("sh").arg(input);',
    "}",
  ].join("\n")
  const leads = run(RUST_WITH_COMMAND, source)
  assertEqual(leads.length, 1, "the trailing call chain is inspected")
  assertEqual(leads[0]!.evidence.argumentText.includes(".arg(input)"), true, "chained arg is the inspected argument")
})

check('rust: constant Command::new("sh") is not a lead', () => {
  const source = ["fn run() {", '  Command::new("sh");', "}"].join("\n")
  assertEqual(run(RUST_WITH_COMMAND, source).length, 0, "no dynamic argument, no lead")
})

// ── 10. reachability ────────────────────────────────────────────────────────

check("reachability: a two-hop assignment chain is proven", () => {
  const source = [
    "const a = req.body.value",
    'const b = "SELECT " + a',
    "db.query(b)",
  ].join("\n")
  const leads = run(JAVASCRIPT_SPEC, source)
  assertEqual(leads.length, 1, "one lead")
  const path = leads[0]!.evidence.reachPath
  assertEqual(path.length, 3, "source rule + two assignment hops")
  assertEqual(path[0], "js.express.body", "path starts at the source rule")
  assert(path[1]!.startsWith("b = "), "nearest assignment first")
  assert(path[2]!.startsWith("a = "), "source assignment last")
})

check("reachability: co-located source with an unreachable sink argument is not a lead", () => {
  const source = ['const sql = "SELECT 1"', "const u = req.body.x", "db.query(sql)"].join("\n")
  const { decision } = decisionFor(JAVASCRIPT_SPEC, source)
  assertEqual(decision.rejection, "no_reaching_source", "rejection reason")
  assertEqual(run(JAVASCRIPT_SPEC, source).length, 0, "co-location alone is not a flow")
})

check("reachability: assignment hops are bounded (default 3, option can widen)", () => {
  const source = [
    "const a = req.body.x",
    'const b = "x" + a',
    'const c = "y" + b',
    'const d = "z" + c',
    "db.query(d)",
  ].join("\n")
  assertEqual(run(JAVASCRIPT_SPEC, source).length, 0, "four hops exceed the default bound")
  const widened = run(JAVASCRIPT_SPEC, source, { maxReachDepth: 4 })
  assertEqual(widened.length, 1, "the same flow is proven with a wider bound")
  assertEqual(widened[0]!.evidence.reachPath.length, 5, "source rule + four assignment hops")
})

check("determinism: one lead per sink, earliest reaching source wins (no cartesian)", () => {
  const source = [
    "const a = req.body.a",
    "const b = req.query.b",
    'db.query("SELECT " + a + b)',
  ].join("\n")
  const leads = run(JAVASCRIPT_SPEC, source)
  assertEqual(leads.length, 1, "two sources, one sink -> exactly one lead")
  assertEqual(leads[0]!.evidence.source.ruleId, "js.express.body", "deterministic source selection")
})

// ── 11. selectors and attribute writes ─────────────────────────────────────

check('any: an attribute write (.innerHTML = req.body) is a lead', () => {
  const leads = run(JAVASCRIPT_SPEC, "el.innerHTML = req.body.bio")
  assertEqual(leads.length, 1, "one lead")
  assertEqual(leads[0]!.vulnerability, "xss", "vulnerability")
  assertEqual(leads[0]!.severity, "high", "rule-defined severity")
  assertEqual(leads[0]!.evidence.argumentText, "req.body.bio", "the write's expression is the argument")
})

check('all: a dynamic non-first argument qualifies, and first ignores later args', () => {
  const secondArgument = run(JAVASCRIPT_SPEC, 'db.execute("SELECT 1", req.body.id)')
  assertEqual(secondArgument.length, 1, 'argument:"all" inspects later arguments')
  assertEqual(secondArgument[0]!.vulnerability, "sql_injection", "vulnerability")
  const firstOnly = run(JAVASCRIPT_SPEC, 'db.query("SELECT 1", req.body.id)')
  assertEqual(firstOnly.length, 0, 'argument:"first" does not pair a later argument')
})

// ── 12. severity / dynamic unit contracts ──────────────────────────────────

check("severity: securitySeverity contract is honored", () => {
  assertEqual(securitySeverity({ vulnerability: "sql_injection", severity: "critical" }, true, false), "high", "sql")
  assertEqual(securitySeverity({ vulnerability: "command_injection", severity: "critical" }, true, false), "critical", "command")
  assertEqual(securitySeverity({ vulnerability: "command_injection", severity: "critical" }, true, true), "high", "sanitized")
  assertEqual(securitySeverity({ vulnerability: "path_traversal", severity: "medium" }, true, false), "medium", "medium")
})

check("dynamic: literal-only expressions are constant, identifiers are dynamic", () => {
  // isDynamicExpression consumes MASKED text (string contents already blanked by
  // the matcher); these inputs are exactly what the flow engine passes it.
  assertEqual(isDynamicExpression('"           "'), false, "string literal")
  assertEqual(isDynamicExpression('"  " + " "'), false, "concatenated literals")
  assertEqual(isDynamicExpression("12345"), false, "number")
  assertEqual(isDynamicExpression(""), false, "empty")
  assertEqual(isDynamicExpression('"  " + name'), true, "identifier")
  assertEqual(isDynamicExpression("[userId]"), true, "array of a variable")
})

// ── 13. spec-driven gating ──────────────────────────────────────────────────

check("spec: a missing spec returns [] and analysisSpecFor is null", () => {
  assertEqual(analysisSpecFor("not-a-language"), null, "no spec")
  const leads = analyzeSymbol({ language: "not-a-language", source: "db.query(req.body.x)", file: "x", symbolId: "x" })
  assertEqual(leads.length, 0, "unsupported/missing spec never invents a lead")
})

check("spec: tier unsupported returns [] even when rules would match", () => {
  const source = ['const input = "x"', "danger(input)"].join("\n")
  const supportedCopy: LanguageSecuritySpec = { ...UNSUPPORTED_SPEC, language: "synthetic-supported", tier: "leads" }
  // Prove the body exercises the rules: only the tier gate can make this empty.
  assertEqual(run(supportedCopy, source).length, 1, "the synthetic rules do fire when the tier allows leads")
  assertEqual(run(UNSUPPORTED_SPEC, source).length, 0, "an unsupported spec produces no leads")
})

check("api: language ids normalize through the registry alias table", () => {
  assertEqual(normalizeAnalysisLanguage("TSX"), "typescript", "tsx alias")
  assertEqual(normalizeAnalysisLanguage(" jsx "), "javascript", "jsx alias")
  assertEqual(normalizeAnalysisLanguage("Python"), "python", "case folding")
  assertEqual(normalizeAnalysisLanguage(""), "", "empty id")
})

check("api: toSecurityLeadInput carries evidence and the declaration line", () => {
  const leads = run(JAVASCRIPT_SPEC, "const id = req.body.id\ndb.query(\"SELECT * FROM t WHERE id = '\" + id + \"'\")")
  assertEqual(leads.length, 1, "one lead")
  const row = toSecurityLeadInput(leads[0]!, 42)
  assertEqual(row.symbolLine, 42, "symbol line")
  assertEqual(row.language, leads[0]!.language, "language")
  assertEqual(row.symbolId, leads[0]!.symbolId, "symbol id")
  assertEqual(row.file, leads[0]!.file, "file")
  assert(row.evidence === leads[0]!.evidence, "evidence is the same plain data")
  assert(JSON.stringify(JSON.parse(JSON.stringify(row))).length > 0, "row is JSON-serializable")
})

check("api: analyzeSymbols sorts globally, deterministically and repeatably", () => {
  const body = "const id = req.body.id\ndb.query(\"SELECT * FROM t WHERE id = '\" + id + \"'\")"
  const inputA = { language: "javascript", source: body, file: "a.ts", symbolId: "sym:a", symbolLine: 3 }
  const inputB = { language: "javascript", source: body, file: "b.ts", symbolId: "sym:b", symbolLine: 3 }
  const leads = analyzeSymbols([inputB, inputA], { spec: JAVASCRIPT_SPEC })
  assertEqual(leads.length, 2, "two leads")
  assertEqual(leads[0]!.file, "a.ts", "global sort by file")
  for (let i = 1; i < leads.length; i++) {
    assert(compareSecurityLeads(leads[i - 1]!, leads[i]!) <= 0, "comparator order holds")
  }
  assertDeepEqual(analyzeSymbols([inputB, inputA], { spec: JAVASCRIPT_SPEC }), leads, "repeatable")
  assertDeepEqual(
    analyzeSymbols([inputA, inputB], { spec: JAVASCRIPT_SPEC }),
    leads,
    "input order does not change the output",
  )
})

check("api: ENGINE_VERSION is declared and analyses are repeatable", () => {
  assert(typeof ENGINE_VERSION === "string" && ENGINE_VERSION.length > 0, "engine version is declared")
  const source = "const id = req.body.id\ndb.query(\"SELECT * FROM t WHERE id = '\" + id + \"'\")"
  assertDeepEqual(run(JAVASCRIPT_SPEC, source), run(JAVASCRIPT_SPEC, source), "same input, same output")
})

check("empty: an empty or non-string source returns []", () => {
  assertEqual(run(JAVASCRIPT_SPEC, "").length, 0, "empty source")
  assertEqual(run(JAVASCRIPT_SPEC, "   \n\t ").length, 0, "whitespace-only source")
  const nonString = analyzeSymbol(
    { language: "javascript", source: undefined as unknown as string, file: FIXTURE_FILE, symbolId: FIXTURE_SYMBOL },
    { spec: JAVASCRIPT_SPEC },
  )
  assertEqual(nonString.length, 0, "non-string source")
})

// ── summary ─────────────────────────────────────────────────────────────────

const passed = checks - failures.length
console.log(`M72 security engine — matcher/flow/engine assertion suite (${ENGINE_VERSION})`)
console.log(`${checks} checks, ${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.log("FAILED:")
  for (const failure of failures) console.log(`  - ${failure}`)
  process.exitCode = 1
} else {
  console.log("OK — every assertion passed")
  process.exitCode = 0
}
