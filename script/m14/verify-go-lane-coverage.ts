// The go lane's own coverage gate — SELF-CHECKING, because the failure it exists
// to catch is invisible to every other gate in the repo.
//
// WHAT HAPPENED. Four times, another lane's commit removed the go oracles from
// `differential.ts` (d8823c13, and three commits after it). Every time the
// symptom was IDENTICAL and SILENT: the go lane still ran, still reported
// 100% covered / 0 MISSING / 0 unexplained, and was simply measuring FIVE
// labels instead of eight. A green differential cannot distinguish "the go lane
// is clean" from "the go lane is not being measured", so four deletions of the
// measurement passed as four clean runs. That is a worse failure than a red
// gate, because it is a gate reporting success about work nobody is doing.
//
// WHAT THIS CHECKS, and why each is a check and not a comment:
//   1. Every RelationshipType the go analyzer EMITS is in go's compared set.
//      Derived by reading the analyzer's own emission sites, so a new label
//      added to the analyzer cannot slip in uncompared. `overrides` is the one
//      recorded exception (GO41: the go analyzer emits zero of them, and a
//      compared label with no rows reads like a contract rather than a hole).
//   2. Every label in go's compared set has an ORACLE FUNCTION that exists.
//   3. Every oracle function is actually PUSHED into the go truth block — this
//      is the exact deletion that happened four times, and a defined-but-
//      unpushed oracle is the state a half-applied edit leaves behind.
//   4. The go analyzer contains NO REGEX. The lane's standing rule, stated in
//      its own header, enforced here rather than trusted.
//   5. Every go oracle is used by at least one committed instrument, so a probe
//      cannot drift into auditing nothing.
//
// It reads source text and parses it; it does not import differential.ts, because
// that module runs a corpus sweep on import.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "$HOME/mcp/backbencher-brain"
const ANALYZER = "src/ast/real-go-analyzer.ts"
const HARNESS = "script/m14/differential.ts"
const SPEC = "script/m14/spec/go-completeness.json"

/** Labels the go analyzer emits zero of, with the ruling that records why. */
const RULED_OUT: Record<string, { id: string; why: string }> = {
  Overrides: { id: "GO41", why: "Go has no override: dispatch is interface satisfaction (already `implements`) and embedding is already `contains` on the owner. Comparing a label with no rows reads like a contract rather than a hole." },
}

const fail: string[] = []
const warn: string[] = []
const note = (s: string): void => console.log(s)

async function main() {
  const analyzer = fs.readFileSync(path.join(ROOT, ANALYZER), "utf8")
  const harness = fs.readFileSync(path.join(ROOT, HARNESS), "utf8")

  // ── 1. labels the analyzer emits ─────────────────────────────────────────
  const emitted = new Map<string, number>()
  for (const m of analyzer.matchAll(/RelationshipType\.([A-Za-z]+)/g)) {
    emitted.set(m[1], (emitted.get(m[1]) ?? 0) + 1)
  }
  // The enum is NOT in the analyzer — `ASTEngine.RelationshipType` comes from
  // engine.ts. Reading it from the analyzer produced "?" for every label and
  // eight warnings, which is the instrument being wrong in a way that looks
  // like the lane being wrong.
  const typeMap = new Map<string, string>()
  for (const f of ["src/ast/engine.ts", "src/ast/graph.ts"]) {
    const p2 = path.join(ROOT, f)
    if (!fs.existsSync(p2)) continue
    for (const m of fs.readFileSync(p2, "utf8").matchAll(/enum RelationshipType\s*\{([\s\S]*?)\n\s*\}/g)) {
      for (const row of m[1].matchAll(/([A-Za-z]+)\s*=\s*["']([a-z_]+)["']/g)) {
        if (!typeMap.has(row[1])) typeMap.set(row[1], row[2])
      }
    }
  }
  if (typeMap.size === 0) fail.push("could not read the RelationshipType enum from engine.ts or graph.ts")
  note("go analyzer emission sites:")
  for (const [k, n] of [...emitted].sort()) note(`   RelationshipType.${k}  x${n}  -> wire label "${typeMap.get(k) ?? "?"}"`)
  if (emitted.size === 0) fail.push("could not read a single RelationshipType from the analyzer — the parse is wrong, not the lane")

  // ── 2. go's compared set, read out of the allowlist EXPRESSION ────────────
  // Evaluated rather than pattern-matched, because this file has been bitten by
  // a `//` comment on that expression deleting a live entry three times.
  const filt = harness.indexOf(".filter((r: any) =>")
  if (filt === -1) fail.push(`could not find the compared-label filter in ${HARNESS}`)
  let compared = new Set<string>()
  if (filt !== -1) {
    const arrow = harness.indexOf("=>", filt)
    const end = harness.indexOf(".includes(r.label)", filt)
    if (arrow === -1 || end === -1) fail.push("the compared-label filter has no arrow or no terminator")
    else {
      const expr = harness.slice(arrow + 2, end)
      const stripped = expr
        .split("\n")
        .map((l) => {
          const i = l.indexOf("//")
          return i === -1 ? l : l.slice(0, i)
        })
        .join("\n")
      try {
        // eslint-disable-next-line no-new-func
        // `.flat()` because the expression is a list of SPREADS, so `[[a,b],[c]]`
        // would otherwise set-ify to one comma-joined string and report a
        // 1-element compared set with 8 labels in it.
        const fn = new Function("lang", `return [${stripped}].flat();`)
        compared = new Set<string>(fn("go") as string[])
      } catch (e: any) {
        fail.push(`the go allowlist expression did not evaluate: ${e?.message ?? e}`)
      }
    }
  }
  note("")
  note(`go compared-label set (${compared.size}): ${[...compared].sort().join(", ")}`)

  // ── 3. every EMITTED label is compared, except the ruled-out ones ────────
  const expected = new Set<string>()
  for (const [sym, n] of emitted) {
    const wire = typeMap.get(sym)
    if (!wire) { warn.push(`RelationshipType.${sym} has no string value in the enum`); continue }
    if (n === 0) continue
    if (RULED_OUT[sym]) {
      if (compared.has(wire)) fail.push(`${wire} is ruled out by ${RULED_OUT[sym].id} but is still in go's compared set`)
      else note(`   ruled out: ${wire} — ${RULED_OUT[sym].id}: ${RULED_OUT[sym].why.slice(0, 90)}...`)
      continue
    }
    expected.add(wire)
    if (!compared.has(wire)) fail.push(`the analyzer EMITS \`${wire}\` (RelationshipType.${sym}) and it is NOT in go's compared set — the lane would report green while not measuring it`)
  }
  note("")
  note(`emitted-and-compared: ${[...expected].sort().join(", ")}`)

  // ── 4. every compared label has a defined AND PUSHED oracle ─────────────
  // The push check is the one that catches the four deletions.
  const oracleFor: Record<string, string> = {
    calls: "deriveGoEdges", extends: "deriveGoEdges", implements: "deriveGoImplements",
    instantiates: "deriveGoEdges", references: "deriveGoDeclaredTypeRefs",
    contains: "deriveGoContains", uses: "deriveGoUses", imports: "deriveGoImports",
  }
  for (const label of [...compared].sort()) {
    const fn = oracleFor[label]
    if (!fn) { fail.push(`go compares \`${label}\` and this file has no oracle mapped for it — add it to oracleFor or drop the label`); continue }
    if (!harness.includes(`function ${fn}(`)) fail.push(`go compares \`${label}\` via ${fn}, but ${fn} is not defined in ${HARNESS}`)
    const pushed = harness.includes(`for (const e of ${fn}(root`)
    if (!pushed) fail.push(`go compares \`${label}\` via ${fn}, but ${fn} is NEVER PUSHED into the truth block — this is the exact shape left by the four deletions, and the lane would read 100% while measuring nothing`)
  }

  // ── 5. no regex in the go analyzer ──────────────────────────────────────
  // Character-level, not a line grep: a doc comment mentioning a path with a
  // slash is not a regex, and `extractGoFunction(` is not `new Function(`.
  // Comments must be removed BEFORE the regex scan, and the removal has to be
  // STATEFUL across lines: a `/* ... */` block comment was only having its OPENING
  // two characters blanked, so its body leaked into the scan and a doc comment
  // containing `  /   /   /…  ` was reported as a regex literal in a file with no
  // regex in it. A gate that cries wolf on the real analyzer trains people to
  // ignore it.
  // The lexer state lives OUTSIDE the per-line callback. Declared inside it,
  // `inBlock` reset on every line, so a `/** ... */` doc comment spanning many
  // lines had only its first line blanked and the rest leaked into the scan —
  // which reported `gorm`/`zap`/`ent`/`…` in a prose sentence as a regex
  // literal, in an analyzer that has none.
  let inS = false
  let inD = false
  let inT = false
  let inBlock = false
  const codeLines = analyzer.split("\n").map((l) => {
    let out = ""
    for (let i = 0; i < l.length; i++) {
      const c = l[i]
      if (inBlock) {
        if (c === "*" && l[i + 1] === "/") { inBlock = false; out += "  "; i++; continue }
        out += " "
        continue
      }
      if (inS) { if (c === "\\") { out += "  "; i++; continue } if (c === "'") inS = false; out += " "; continue }
      if (inD) { if (c === "\\") { out += "  "; i++; continue } if (c === '"') inD = false; out += " "; continue }
      if (inT) { if (c === "\\") { out += "  "; i++; continue } if (c === "`") inT = false; out += " "; continue }
      if (c === "/" && l[i + 1] === "*") { inBlock = true; out += "  "; i++; continue }
      if (c === "/" && l[i + 1] === "/") break
      if (c === "'") { inS = true; out += " "; continue }
      if (c === '"') { inD = true; out += " "; continue }
      if (c === "`") { inT = true; out += " "; continue }
      out += c
    }
    return out
  })
  const code = codeLines.join("\n")
  const regexHits: string[] = []
  const patterns: Array<[string, RegExp]> = [
    ["new RegExp", /new\s+RegExp/g],
    [".match(", /\.match\s*\(/g],
    [".replace(", /\.replace\s*\(/g],
    [".search(", /\.search\s*\(/g],
    // The prefix was `[^\w$.]` rather than a fixed punctuation class. The class
    // version required the `/` to follow one of `= ( : , [` and friends, so
    // `return /^_/.test(v)` — a regex preceded by a WORD — was missed entirely and
    // the gate reported "no regex" while one was sitting in the file. A gate that
    // claims a ban it does not enforce is worse than no gate, so the negative
    // control for this one is the part that matters.
    // Regex-literal detection. Three earlier versions of this pattern were wrong,
    // and the negative control caught every one — which is the only reason this
    // comment is worth its length. v1 required the `/` to follow a fixed
    // punctuation class, so `return /^_/.test(v)` was MISSED and the gate
    // reported "no regex" with one in the file. v2 required trailing flags, so a
    // bare `/^_/` was missed. v3 treated any non-word char before the `/` as a
    // regex start, so `a / b` in `const half = a / b; return half + a / b`
    // was a FALSE POSITIVE. The rule that actually separates them: a regex
    // literal can only follow a keyword or an operator that cannot end an
    // expression — never an identifier, a literal, or a CLOSING bracket, which
    // is why `)` and `]` are excluded from the operator set and `(a + b) / 2`
    // stays silent. Verified against 19 discriminating cases including both
    // directions, and comments are removed before this runs at all.
    ["regex literal", /(?:^|[\n]|[(=,:[!&|?;{]\s*|\b(?:return|typeof|case|in|of|do|else|yield|await|delete|void|new|throw)\s+)\/(?![/*])(?:\\.|[^/\\\n]|\/(?![*\/\n]))+\/[gimsuyvd]*(?!\w)/g],
  ]
  for (const [name, re] of patterns) {
    for (const mm of code.matchAll(re)) {
      const idx = (mm.index ?? 0)
      const line = code.slice(0, idx).split("\n").length
      const src = codeLines[line - 1] ?? ""
      regexHits.push(`${name} at ${ANALYZER}:${line}  ${src.trim().slice(0, 80)}`)
    }
  }
  if (regexHits.length) for (const h of regexHits) fail.push(`REGEX in the go analyzer — ${h}`)
  note("")
  note(`regex scan: ${regexHits.length === 0 ? "clean (strings, template literals and comments excluded)" : `${regexHits.length} hit(s)`}`)

  // ── 6. every go oracle is exercised by a committed instrument ───────────
  const tmpDir = path.join(ROOT, "script/m14/tmp")
  const probes = fs.existsSync(tmpDir) ? fs.readdirSync(tmpDir).filter((f) => f.endsWith(".ts")) : []
  const probeText = probes.map((f) => fs.readFileSync(path.join(tmpDir, f), "utf8")).join("\n")
  for (const [label, fn] of Object.entries(oracleFor)) {
    if (!probes.some((f) => f.startsWith("go-"))) continue
    const used = probeText.includes(fn)
    if (!used) warn.push(`no committed go instrument references ${fn} (the \`${label}\` oracle) — it is gated but unexercised at full extent`)
  }

  // ── 7. the spec records the labels, so the ruling is not only in code ────
  if (fs.existsSync(path.join(ROOT, SPEC))) {
    const spec = fs.readFileSync(path.join(ROOT, SPEC), "utf8")
    for (const sym of Object.keys(RULED_OUT)) {
      // Look for the DECISION ID, not the prose: matching a sentence fragment
      // warned even when GO41 was in the spec verbatim.
      if (!spec.includes(`"${RULED_OUT[sym].id}"`)) {
        fail.push(`${sym} is ruled out in this file but decision ${RULED_OUT[sym].id} is not in ${SPEC} — a ruling that exists only in code is not a record`)
      }
    }
  }

  note("")
  for (const w of warn) note(`WARN  ${w}`)
  for (const f of fail) note(`FAIL  ${f}`)
  note("")
  if (fail.length === 0) {
    note(`go lane coverage: PASS — ${expected.size} emitted labels compared and pushed, ${Object.keys(RULED_OUT).length} ruled out, no regex`)
    process.exit(0)
  }
  note(`go lane coverage: ${fail.length} FAILURE(S) — the lane is either not measuring what it claims, or the analyzer grew a label`)
  process.exit(1)
}
main()
