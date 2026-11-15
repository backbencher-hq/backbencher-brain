/**
 * GUARD F SOUNDNESS — does the predicate fire on a VALID parse?
 *
 * `guard-f-bash-imports.mts` measures what guard F1/F2 REMOVE on the corpus (5
 * edges, 0 real calls). Removal cost is only half of a guard decision: a guard
 * that also fires on valid bash is a guard that deletes real edges on files this
 * sample never drew.
 *
 * This file answers the other half, by asking the predicate directly about node
 * SHAPES rather than about corpus counts. The snippets are the ones where a `)`
 * can legitimately follow a command name:
 *
 *   - a bare `)` as a word argument:        `echo )`
 *   - a `)` between arguments:              `echo one two ) three`
 *   - `:` followed by `)`:                  `: )`
 *   - a subshell:                           `(echo hi)`
 *   - a command substitution:               `v=$(echo hi)`
 *   - a function whose body is a subshell:  `foo() ( echo subshell_body )`
 *   - a normally-parsed `case` arm:         `y) echo matched ;;`
 *   - a nested subshell `( (cmd) )`:        the shape `isDoubleParen` must NOT claim
 *   - a real arithmetic command:            `((x++))`, `((x < 5))`
 *
 * Each is reported with the predicate's own verdict AND the direct children of
 * the `command` node, so a reader can see why rather than trust a count.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/guard-f-soundness.mts
 */

import { ASTEngine } from "../../../../src/ast/engine"

const parser = await ASTEngine.getParser("bash")

/**
 * Collapse newlines so a damaged node's text fits one report line.
 *
 * This was `text.replace(/\n/g, "\\n")`. A char-code loop instead of a regex, per
 * the workstream's rule that a census script contains none —
 * `probe-bash-no-regex.mts` counts regex literals across this lane and counted this
 * one. CR (13) is folded with LF (10) because a bare carriage return in a report
 * line is the same nuisance and the original did not handle it either.
 */
const oneLine = (text: string): string => {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 10 || c === 13) {
      out += "\\n"
      continue
    }
    out += text[i]
  }
  return out
}

const cases: { label: string; src: string }[] = [
  { label: "bare ) as the only argument", src: "echo )\n" },
  { label: "bare ) between arguments", src: "echo one two ) three\n" },
  { label: "colon then )", src: ": )\n" },
  { label: "subshell", src: "(echo hi)\n" },
  { label: "command substitution", src: "v=$(echo hi)\n" },
  { label: "substitution nested in a double-quoted arg", src: "echo \"$(date +%s)\"\n" },
  { label: "function whose body is a subshell", src: "foo() ( echo subshell_body )\n" },
  { label: "nested subshell with a space", src: "( (echo hi) )\n" },
  { label: "normally-parsed case arm", src: "case x in\n  y) echo matched ;;\n  *) echo other ;;\nesac\n" },
  { label: "case arm whose pattern is quoted", src: "case x in\n  \"y\") echo matched ;;\nesac\n" },
  { label: "real arithmetic increment", src: "((x++))\n" },
  { label: "real arithmetic comparison", src: "if ((x < 5)); then echo s; fi\n" },
  { label: "real arithmetic with a command substitution inside", src: "v=$(( $(wc -l < f) + 1 ))\n" },
  { label: "the defect: case under !", src: "if ! case \"$t\" in\n  binary) _e binary ;;\n  source) _e source ;;\nesac; then echo y; fi\n" },
  // ---- second wave: every other shape where `)` can appear near a command name
  { label: "adjacent closing paren after a substitution", src: "echo $(foo) )\n" },
  { label: "adjacent closing paren glued to a word", src: "echo a)b\n" },
  { label: "closing paren inside single quotes", src: "echo ')'\n" },
  { label: "closing paren inside a [[ ]] pattern", src: "[[ $x == *')'* ]] && echo y\n" },
  { label: "closing paren produced by a substitution", src: "echo \"$(printf ')')\"\n" },
  { label: "array literal with closing paren", src: "arr=(a b)\necho \"${arr[0]}\"\n" },
  { label: "associative array literal", src: "declare -A m=([a]=1)\necho \"${m[a]}\"\n" },
  { label: "a case arm whose body is the null builtin", src: "case $x in\n  a) : ;;\nesac\n" },
  { label: "a case arm whose body is a pipeline", src: "case $x in\n  a) cat f | wc -l ;;\nesac\n" },
  { label: "time applied to a subshell", src: "time (echo hi)\n" },
  { label: "coproc with a block body", src: "coproc foo { echo hi; }\n" },
  { label: "select loop", src: "select x in a b; do echo \"$x\"; done\n" },
  { label: "until loop with a subshell condition", src: "until (echo x); do :; done\n" },
  { label: "process substitution", src: "diff <(echo a) <(echo b)\n" },
  { label: "function definition with a subshell body and a call", src: "foo() ( echo hi )\nfoo\n" },
  { label: "a redirect target that is a paren", src: "echo hi > out)\n" },
  { label: "a command whose only argument is a subshell", src: "echo (echo nested)\n" },
  { label: "multiple commands one line", src: "echo a; echo b; echo c\n" },
  { label: "an and-or list ending in a subshell", src: "true && (echo x)\n" },
  { label: "background subshell", src: "(echo x) &\n" },
  { label: "a negated subshell", src: "! (echo x)\n" },
  { label: "a here-doc after a command", src: "cat <<EOF\nbody\nEOF\n" },
  { label: "an escaped closing paren", src: "echo \\)\n" },
]

const f1 = (cmd: any): boolean => {
  for (let i = 0; i < cmd.childCount; i++) {
    const c = cmd.child(i)
    if (c && (c.type === "ERROR" || c.isMissing) && c.text === ")") return true
  }
  return false
}
const f2 = (cmd: any): boolean => {
  let cn: any = null
  for (let i = 0; i < cmd.namedChildCount; i++) {
    const c = cmd.namedChild(i)
    if (c && c.type === "command_name") { cn = c; break }
  }
  if (!cn) return false
  const after = cn.nextSibling
  return !!after && (after.type === "ERROR" || after.isMissing) && after.text.startsWith(")")
}

console.log(`GUARD F SOUNDNESS — F1 and F2 asked about node SHAPES, not corpus counts`)
console.log(`predicate F1: the command has a DIRECT child that is ERROR/missing with text exactly ")"`)
console.log(`predicate F2: the child immediately AFTER command_name is ERROR/missing and its text begins with ")"`)
console.log(`F1 fires on valid bash  -> the guard is unsound and must not be implemented`)
console.log(`F2 fires on valid bash  -> the guard is unsound and must not be implemented`)
console.log(`neither fires except on the defect -> implementable, at the removal cost guard-f measured`)
console.log("")

let f1Bad = 0
let f2Bad = 0
for (const c of cases) {
  const tree = parser!.parse(c.src)
  const rows: string[] = []
  const visit = (n: any): void => {
    if (n.type === "command") {
      let cn: any = null
      for (let i = 0; i < n.namedChildCount; i++) {
        const x = n.namedChild(i)
        if (x && x.type === "command_name") { cn = x; break }
      }
      const kids: string[] = []
      for (let i = 0; i < n.childCount; i++) {
        const x = n.child(i)
        if (x) kids.push(`${x.type}${x.isMissing ? "(MISSING)" : ""}[${oneLine(x.text).slice(0, 18)}]`)
      }
      rows.push(`      command_name=${cn ? cn.text : "(none)"}  children: ${kids.join(" ") || "(none)"}  F1=${f1(n)} F2=${f2(n)}`)
      if (f1(n) || f2(n)) {
        const isDefect = c.label.startsWith("the defect")
        if (!isDefect) {
          if (f1(n)) f1Bad++
          if (f2(n)) f2Bad++
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const x = n.child(i)
      if (x) visit(x)
    }
  }
  visit(tree.rootNode)
  console.log(`  ${c.label}`)
  console.log(`    src: ${JSON.stringify(c.src)}`)
  if (rows.length === 0) console.log(`      (no command node)`)
  for (const r of rows) console.log(r)
  tree.delete?.()
}
console.log("")
console.log(`F1 fired on ${f1Bad} VALID-parse command nodes  <- F1 is REJECTED; this firing is why`)
console.log(`F2 fired on ${f2Bad} VALID-parse command nodes  <- F2 is IMPLEMENTED; must be 0`)
// The exit code gates on F2 only. F1 is the predicate the A/B rejected, and its
// firing on `awk one two ) three` is the recorded reason for that rejection — so
// counting it as a failure would make this probe red for the rest of its life over
// a decision that is already closed. F2 is the guard in the analyzer, and a
// non-zero here means a real call would be deleted.
process.exit(f2Bad > 0 ? 1 : 0)