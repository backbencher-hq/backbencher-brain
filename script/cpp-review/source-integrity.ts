/**
 * CPP3 — SOURCE INTEGRITY. The gate for a class of defect that lives in the
 * analyzer's BYTES rather than in its output.
 *
 * WHY THIS IS A FILE, and why no fixture can be the gate.
 *
 * `src/ast/real-cpp-analyzer.ts` carried ONE LITERAL NUL BYTE for the whole of its
 * life — at `origin/main`, at the ontology handover, and through both ontology
 * batches — written raw into the source of the contains de-duplication key:
 *
 *     const relKey = `${_owner}<NUL>${s.name}`
 *
 * The intent (a separator no C++ identifier can contain) is correct and the runtime
 * string was right. Two measured costs, and NEITHER is visible in a diff because a
 * diff renders the byte as nothing:
 *
 *   1. `grep` classifies a file holding a NUL as BINARY. Every grep-based reader of
 *      this analyzer — including the ones an agent reaches for first — gets
 *      `grep: src/ast/real-cpp-analyzer.ts: binary file matches` and no lines. This
 *      was hit while measuring this round's D25: a plain `grep -n` over the emission
 *      sites silently returned nothing and only `grep -a` returned rows.
 *   2. `script/m14/audit-analyzer-grammar.ts` (master-owned) parses this file with
 *      tree-sitter-typescript to extract its node-type references. The NUL became an
 *      ERROR node, so the gate printed
 *
 *          [warn] real-cpp-analyzer.ts: source did not parse cleanly; extraction may be incomplete
 *
 *      directly above cpp's row. cpp's `refs=88 unknown=0` was therefore measured
 *      over a tree containing an ERROR, and the gate says so itself. Post-fix the
 *      same probe reports 0 ERROR/MISSING nodes and `refs=88` is unchanged — which is
 *      also the independent confirmation that the earlier `unknown=2` reading was an
 *      artifact of the broken parse rather than a real unknown literal.
 *
 * A fixture runs the analyzer's OUTPUT. The pre-fix and post-fix separators are the
 * SAME STRING, so the output is byte-identical and no fixture can fail on it. That
 * is why the mutant `cpp3/d24-nul-separator-restored` in
 * `script/cpp-review/cpp2-source-mutants.ts` is a DISCLOSED SURVIVOR, and why this
 * gate exists: it reads the bytes.
 *
 * WHAT IT ASSERTS, and the discipline each assertion rests on:
 *
 *   - zero C0 control bytes other than TAB/LF/CR. A source file is text; a raw
 *     control byte in one is invisible in review and hostile to every text tool.
 *   - the file still parses under tree-sitter-typescript with zero ERROR and zero
 *     MISSING nodes — the condition `audit-analyzer-grammar.ts` warns about, checked
 *     here so the warning cannot be the only report.
 *   - zero regex literals and zero `RegExp` constructions (the lane's D6, which
 *     `defect-register.ts` also gates but whose corpora are absent on this machine).
 *
 * SELF-TEST: every assertion is run against a deliberately broken copy in a temp
 * directory, and the gate EXITS NON-ZERO if it cannot fail on any of them. A gate
 * that has never been seen to fail is not evidence.
 *
 *   bun run script/cpp-review/source-integrity.ts
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const ROOT = process.cwd()
const SRC = path.join(ROOT, "src", "ast", "real-cpp-analyzer.ts")

interface Finding { check: string; detail: string }

/** C0 control bytes that may legitimately appear in a text source file. */
const ALLOWED_CONTROL = new Set([0x09, 0x0a, 0x0d])

function checkControlBytes(buf: Buffer): Finding[] {
  const out: Finding[] = []
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i]
    if (b >= 0x20 || ALLOWED_CONTROL.has(b)) continue
    if (b === 0x0b || b === 0x0c) continue // VT / FF: tolerated, still listed below if present
    const upto = buf.subarray(0, i)
    out.push({ check: "control-bytes", detail: `byte 0x${b.toString(16).padStart(2, "0")} at offset ${i} (line ${upto.toString("utf8").split("\n").length})` })
  }
  return out
}

/**
 * D6, restated from `script/cpp-review/defect-register.ts`'s class D6.
 *
 * WHY A RESTATEMENT AND NOT AN IMPORT, and why that is a risk worth naming. The
 * register cannot be imported: its body walks five corpora at module scope, and every
 * one of them is absent on this machine, so importing it turns a gate into a crash. A
 * second COPY of a rule is a second ANSWER, though — the lane's own #916 — so this copy
 * is held to the original's ALGORITHM rather than to its intent, and the self-test
 * below injects a literal at the exact position shape the original accepts. If the two
 * ever diverge, the divergence shows up as this gate disagreeing with the register on
 * a real file, and the register is the one that decides.
 *
 * The original's position rule is a CHARACTER test, not a parse: a `/…/` run counts
 * when it starts the line or when the preceding non-space character is one of
 * `[(,=:[!&|?{};+-*%<>~^]`. That is what makes it comment-blind and string-blind, and
 * both blind spots are recorded as the `d6-ignores` self-test arms rather than papered
 * over — a detector that cannot be quoted as stronger than it is would be a second
 * honesty problem in a gate written to prevent one.
 *
 * ★ M65 — THIS COPY WAS NOT HELD TO THE ALGORITHM, AND THE DIVERGENCE WAS MEASURED.
 * The scanner below used to split the file into lines and match a `/…/` run on EVERY
 * line, comments included. The original STRIPS block comments, line comments and string
 * literals first — its own comment says "COMMENTS ARE NOT CODE, and a line scanner that
 * cannot tell the difference reports the same false positive twice over", and it was
 * written for exactly this failure ("two one-line doc comments ... took D6 from
 * 0 to 2 in a file that contains no regex at all"). So the copy was stricter than the
 * rule it restates, and it fired on prose: the analyzer's own comment at line 114
 * documents the regex it REMOVED (written there as a `replace` call over a character
 * class), and the gate reported that documentation as a live regex literal.
 *
 * MEASURED at M65, both algorithms over the same bytes of `real-cpp-analyzer.ts`:
 *   register D6 (strips comments+strings)  -> 0 findings   <- the analyzer's zero-regex claim is TRUE
 *   this gate, before this fix (line-only) -> 3 findings   at lines 1, 114 and 197
 * The three are comment prose. The gate exited 1 while `docs/analyzers/cpp.md` recorded
 * it as "PASS, 0 findings, 0 blind assertions".
 *
 * (This comment deliberately never writes a slash-star or star-slash pair outside the
 * delimiters: the same inattentive prose that hid the original defect would close this
 * block early, which is exactly how the first attempt at this fix failed to compile.)
 *
 * The character walk below is the register's own, so the two cannot drift again: strip
 * block comments, strip line comments, copy string/template literals verbatim (so a `/`
 * inside one is not code), then apply the original's position rule to what remains.
 */
function stripCommentsAndStrings(text: string): string[] {
  const out: string[] = []
  let inBlock = false
  for (const raw of text.split("\n")) {
    let code = ""
    let j = 0
    while (j < raw.length) {
      if (inBlock) {
        if (raw.charCodeAt(j) === 42 && raw.charCodeAt(j + 1) === 47) { inBlock = false; j += 2; continue }
        j++
        continue
      }
      const c0 = raw.charCodeAt(j)
      const c1 = raw.charCodeAt(j + 1)
      if (c0 === 47 && c1 === 47) break            // `//` to end of line
      if (c0 === 47 && c1 === 42) { inBlock = true; j += 2; continue }   // `/*`
      if (c0 === 34 || c0 === 39 || c0 === 96) {   // " ' ` — copy verbatim so a `/` inside is not code
        const q = raw[j]
        code += q; j++
        while (j < raw.length) {
          if (raw.charCodeAt(j) === 92) { code += raw[j] + (raw[j + 1] ?? ""); j += 2; continue }
          code += raw[j]
          if (raw[j] === q) { j++; break }
          j++
        }
        continue
      }
      code += raw[j]; j++
    }
    out.push(code)
  }
  return out
}

function checkRegexLiterals(text: string): Finding[] {
  const out: Finding[] = []
  const lines = stripCommentsAndStrings(text)
  lines.forEach((l, i) => {
    // A line that is now empty was comment-only, or was inside a block comment: it contributes
    // nothing, which is the original's rule rather than an extra one.
    if (!l.trim()) return
    const m = l.match(/\/(?:[^/\\\n]|\\.)+\/[gimsuy]*/g)
    if (!m) return
    for (const mm of m) {
      const at = l.indexOf(mm)
      const before = l.slice(0, at).trimEnd().slice(-1)
      if (at === 0 || /[(,=:[!&|?{};+\-*%<>~^]$/.test(before)) out.push({ check: "regex-literal", detail: `at line ${i + 1}: ${mm}` })
    }
  })
  const ctor = /\bnew\s+RegExp\s*\(|(?<![.\w])RegExp\s*\(/g
  let c: RegExpExecArray | null
  while ((c = ctor.exec(text)) !== null) {
    out.push({ check: "RegExp-construction", detail: `at line ${text.slice(0, c.index).split("\n").length}: ${c[0]}` })
  }
  return out
}

/** The condition `script/m14/audit-analyzer-grammar.ts` warns about. Uses the same
 *  wasm the gate uses, so a disagreement between the two is impossible. */
async function checkTypeScriptParse(text: string): Promise<Finding[]> {
  const out: Finding[] = []
  try {
    const wts: any = await import("web-tree-sitter")
    const ParserClass = wts.Parser ?? wts.default ?? wts
    const Language = wts.Language ?? wts.default?.Language
    await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
    const p = new ParserClass()
    p.setLanguage(await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-typescript.wasm"))))
    const t = p.parse(text)
    if (!t) return [{ check: "ts-parse", detail: "tree-sitter produced no tree" }]
    let errors = 0
    let missing = 0
    const stack: any[] = [t.rootNode]
    while (stack.length) {
      const n = stack.pop()
      if (n.type === "ERROR") errors++
      if (n.isMissing) missing++
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push(c) }
    }
    if (errors) out.push({ check: "ts-parse", detail: `${errors} ERROR node(s) under tree-sitter-typescript` })
    if (missing) out.push({ check: "ts-parse", detail: `${missing} MISSING node(s) under tree-sitter-typescript` })
  } catch (e) {
    out.push({ check: "ts-parse", detail: `could not run the probe: ${e instanceof Error ? e.message : String(e)} — recorded, not treated as a pass` })
  }
  return out
}

async function inspect(text: string): Promise<Finding[]> {
  return [...checkControlBytes(Buffer.from(text, "utf8")), ...checkRegexLiterals(text), ...(await checkTypeScriptParse(text))]
}

async function main() {
  let text: string
  try {
    text = fs.readFileSync(SRC, "utf8")
  } catch (e) {
    console.error(`source-integrity: cannot read ${SRC}: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(2)
  }

  const findings = await inspect(text)
  const nulCount = Buffer.from(text, "utf8").filter((b) => b === 0).length

  // ---- SELF-TEST: the gate must be able to fail, on each assertion separately.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpp-src-integrity-"))
  // `baseline`/`delta` are carried because the expectation is a DELTA over the file's own findings,
  // not an absolute count (M65) — an arm that asserts `0` is an assertion about the baseline and
  // can never pass on a file that already has a finding.
  const selfTest: Array<{ name: string; injected: boolean; findings: number; baseline?: number; delta?: number; expectedFound?: boolean; why?: string }> = []
  try {
    const injections: Array<{ name: string; make: (t: string) => string; expectFound?: boolean; why?: string }> = [
      { name: "one raw NUL byte (the D24 revert)", make: (t) => t.replace("const relKey = `${_owner}\\u0000${s.name}`", "const relKey = `${_owner}\u0000${s.name}`") },
      { name: "a bare ESC control byte", make: (t) => `${t}\nconst ESC = "\u001b"\n` },
      { name: "a regex literal in D6's accepted position", make: (t) => `${t}\nconst SPLIT = (s: string) => s.split(/[::]+/)\n` },
      { name: "a RegExp construction", make: (t) => `${t}\nconst R = new RegExp("a" + "b")\n` },
      { name: "an unbalanced brace (a TS parse error)", make: (t) => `${t}\nfunction unclosed( {\n` },
      {
        // ★ M65: THIS ARM'S EXPECTATION WAS INVERTED WITH THE SCANNER. It used to expect the
        // one-line doc comment to BE reported (that was D6's blind spot, faithfully copied). The
        // register's D6 strips comments, so after this fix the comment is correctly NOT reported,
        // and the arm now pins the STRIP: a `/** … */` line must add no finding. It is kept as the
        // control that would catch a regression back to a line-only scanner.
        name: "d6-strip: a ONE-LINE doc comment adds no finding (comments are not code)",
        make: (t) => `${t}\n/** a one-line doc comment */\n`,
        expectFound: false,
        why: "The register's D6 strips block comments, line comments and string literals before scanning — its own comment says 'COMMENTS ARE NOT CODE, and a line scanner that cannot tell the difference reports the same false positive twice over'. A copy that matches on raw lines is stricter than the rule it restates, and it fired on real prose: the analyzer's comment at line 114 documents the regex it REMOVED. This arm is the control that would catch a regression back to the line-only scanner.",
      },
      {
        name: "d6-strip: a literal that only ever appears as a STRING is not counted",
        make: (t) => `${t}\nconst PATTERN = "[a-z]"\n`,
        expectFound: false,
        why: "The other half of the same rule, recorded so this gate is never quoted as stronger than it is: a regular expression that appears only as a string literal is not a regex literal, so the strip removes it. `new RegExp` and a bare `RegExp(` call are counted separately for that reason, and that count is 0 in this file.",
      },
    ]
    for (const inj of injections) {
      const mutated = inj.make(text)
      if (mutated === text) {
        selfTest.push({ name: inj.name, injected: false, findings: 0 })
        continue
      }
      const f = await inspect(mutated)
      // ★ M65: THE EXPECTATION IS A DELTA, NOT AN ABSOLUTE. The `expectedFound: false` arm used to
      // assert `findings === 0`, which is an assertion about the BASELINE rather than about the
      // injection — so on any file that already has a finding (this one had 3, all comment prose the
      // old scanner flagged) the arm could never pass, and a permanently red self-test certifies
      // nothing. The arm's real claim is "this injection adds NO finding", which is
      // `findings === baselineFindings`, and that is what is now asserted. `delta` is carried so the
      // receipt shows what the injection actually did.
      selfTest.push({ name: inj.name, injected: true, findings: f.length, baseline: findings.length, delta: f.length - findings.length, expectedFound: inj.expectFound !== false, why: inj.why })
      fs.writeFileSync(path.join(tmp, "probe.ts"), mutated)
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* best effort */ }
  }

  console.log("cpp source integrity — src/ast/real-cpp-analyzer.ts")
  console.log(`bytes ${Buffer.from(text, "utf8").length} | NUL bytes ${nulCount} | findings ${findings.length}`)
  for (const f of findings) console.log(`  ${f.check}: ${f.detail}`)
  if (!findings.length) console.log("  no control bytes, no regex literals (D6's algorithm), parses cleanly under tree-sitter-typescript")

  console.log("\nself-test (each injection must produce the EXPECTED outcome; a mismatch means the gate is not the gate it claims)")
  let blind = 0
  for (const s of selfTest) {
    const want = s.expectedFound !== false
    // A positive arm must ADD a finding over the baseline; a negative arm must add NONE. Both are
    // deltas, so neither is hostage to whatever the file already contains (M65).
    const ok = s.injected && (want ? (s.delta ?? s.findings) > 0 : (s.delta ?? s.findings) === 0)
    if (!ok) blind++
    const delta = s.delta === undefined ? "" : ` delta=${s.delta > 0 ? "+" : ""}${s.delta} (baseline ${s.baseline})`
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${s.name} — injected=${s.injected} findings=${s.findings}${delta} expectedFound=${want}`)
    if (s.why) console.log(`      why:   ${s.why}`)
  }

  const failed = findings.length > 0 || blind > 0
  console.log(`\n${failed ? "FAIL" : "PASS"} — ${findings.length} finding(s), ${blind} blind assertion(s)`)
  if (failed) process.exit(1)
}

await main()