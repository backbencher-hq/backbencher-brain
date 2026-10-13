#!/usr/bin/env tsx
// script/m62/verify-duplicate-cores.ts — two copies of the same decision core, and
// whether they still agree.
//
// FOUND 2026-10-10 while clearing TS2353/TS2339 in script/m61/verify-governance.ts.
// That gate imports LedgerIssue from ./governance_core.ts (m61). The compiler
// reported `recordCommit` as a field that does not exist. It does exist — in
// script/m62/governance_core.ts, where the same type is declared a second time with
// `recordCommit`/`recordSealedAt` where m61 has `blockedReason`.
//
// So there are two `governance_core.ts` files:
//
//   script/m61/governance_core.ts   354 lines
//   script/m62/governance_core.ts   331 lines
//   496 differing lines between them
//
// Their LedgerIssue.evidence shapes are each a SUBSET of what the real ledger on
// disk carries. Measured, not assumed — validation/m61/results/manifest.json, 8
// issues:
//
//   key            present   in m61 type   in m62 type
//   recordCommit   8/8       NO            yes
//   blockedReason  6/8       yes           NO
//   recordSealedAt 0/8       NO            yes
//   negativeCases  0/8       yes           yes
//
// NEITHER type matches the data. Each is missing a key the other has, and both
// declare `negativeCases`, which no record carries. Whichever gate imports which copy
// compiles against a shape the ledger does not have.
//
// WHY THIS MATTERS MORE THAN A DUPLICATE. Six of the eight shared functions have
// DIVERGED, and two of them decide whether the governance ledger is honest:
//
//   entryDrift(disk, derived) — "is this ledger entry hand-typed rather than derived
//     from the record it points at?" The m61 copy checks 10 owned keys. The m62 copy
//     checks ELEVEN — it adds `recordSealedAt`. So the same ledger entry is drift
//     under one copy and not under the other.
//
//   projectionMoved(disk, derived) — "is this merely a stale projection that should
//     be healed rather than called drift?" The m62 copy added a re-seal check the m61
//     copy has no equivalent of. A ledger entry the m62 copy heals is reported as
//     drift by the m61 copy.
//
// A governance gate whose two implementations disagree is not verifying anything. It
// is reporting whichever answer the importing file happened to pick.
//
// THIS GATE FAILS while more than one copy exists. It does not decide which copy is
// correct — that is a question about which milestone's rules are current, and it
// belongs to whoever owns them. What it refuses to do is let the duplication sit
// silent while both halves report green.

import { readFileSync } from "node:fs"
import path from "node:path"

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name} — ${detail}`)
}

const ROOT = process.cwd()

const COPIES = ["script/m61/governance_core.ts", "script/m62/governance_core.ts"]

// --- 1. Are there more than one? ------------------------------------------------
const present = COPIES.filter((p) => {
  try {
    readFileSync(path.join(ROOT, p), "utf8")
    return true
  } catch {
    return false
  }
})

check(
  "there is exactly ONE governance decision core (not one per milestone)",
  present.length <= 1,
  present.length <= 1
    ? "a single owner; nothing to reconcile"
    : `*** ${present.length} copies exist: ${present.join(", ")}. Two gates importing two copies can disagree about whether the ledger is honest, and will. ***`,
)

// --- 2. Do the shared functions still agree? -----------------------------------
/** Extract every `export function name(...) { ... }` body, brace-balanced, so a
 *  comment or a nested block cannot truncate the comparison. */
function exportedFunctions(src: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /export function (\w+)\s*\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    const open = src.indexOf("{", m.index)
    if (open === -1) continue
    let depth = 0
    let i = open
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++
      else if (src[i] === "}") {
        depth--
        if (depth === 0) break
      }
    }
    // Strip comments so a re-worded comment is not reported as a behavioural change.
    const body = src
      .slice(open + 1, i)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/\s+/g, " ")
      .trim()
    out.set(m[1]!, body)
  }
  return out
}

/** The keys a ledger entry's evidence is checked against — the list that decides
 *  drift. Extracted from the code, not from the type, because the FUNCTION is what
 *  runs. A type that disagrees with its function is a third thing to report. */
function ownedKeyList(body: string): string[] | null {
  const m = body.match(/const owned\s*=\s*\[([^\]]*)\]/)
  if (!m) return null
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!)
}

if (present.length >= 2) {
  const [a, b] = present as [string, string]
  const fa = exportedFunctions(readFileSync(path.join(ROOT, a), "utf8"))
  const fb = exportedFunctions(readFileSync(path.join(ROOT, b), "utf8"))

  const shared = [...fa.keys()].filter((k) => fb.has(k)).sort()
  const diverged = shared.filter((k) => fa.get(k) !== fb.get(k))
  const onlyA = [...fa.keys()].filter((k) => !fb.has(k)).sort()
  const onlyB = [...fb.keys()].filter((k) => !fa.has(k)).sort()


// WHICH COPY IS AHEAD, PER FUNCTION. "They differ" is true and useless for a ruling: the
// owner is asked to choose, and the gate has already measured most of the answer.
//
// The original report said only "6 of 8 shared functions have DIVERGED". Every one of those
// six was then examined by hand, and they are NOT six of a kind:
//
//   entryDrift      m62 is a SUPERSET — same code plus the recordSealedAt key. m61's only
//                   extra is a four-line COMMENT explaining why a stale projection is not
//                   drift. Adopting m61 would LOSE a drift key.
//   ledgerEntryFrom m62 is a SUPERSET — three more optional evidence fields.
//   projectionMoved m62 is a SUPERSET — a re-seal check on recordSealedAt.
//   validateLedger  NOT DRIFT. Both are milestone-specific on purpose: m61 hardcodes
//                   M61/M29/M44/script\/m61, m62 hardcodes M62/M55/M61/script\/m62. m62's is
//                   the more general shape (module constants and an ordering loop over the
//                   code list, where m61 hardcodes V1..V6).
//   laneViolations  m62 is BEHIND, cosmetically: its D-7 message drops the
//                   `script\/m<lane>\/` path that m61 prints, so the violation is harder to
//                   locate. One line, worth carrying over.
//   isClosable      A REAL POLICY DIFFERENCE, and the only genuine question here. m61 lets a
//                   BLOCKED issue close when its evidence carries a non-empty blockedReason;
//                   m62 has no such branch, so only verified issues close.
//
// So the tally is 3 supersets for m62, 1 cosmetic regression, 1 milestone-specific pair, and
// exactly ONE policy decision. Reporting only the divergence count hid all of that.
function rawFunctionBodies(src: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const m of src.matchAll(/export function (\w+)\s*\(/g)) {
    const open = src.indexOf("{", m.index)
    if (open === -1) continue
    let depth = 0
    let i = open
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++
      else if (src[i] === "}") {
        depth--
        if (depth === 0) break
      }
    }
    const body = src
      .slice(open + 1, i)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, "").replace(/\s+/g, " ").trim())
      .filter((l) => l !== "")
    out.set(m[1]!, body)
  }
  return out
}

/**
 * Classify one diverged function by which copy is ahead, or say plainly that it is a
 * judgement call. Extracted as a PURE function over two line arrays so it can be tested
 * without touching either core on disk — three attempts to canary this by editing
 * governance_core.ts in place all failed to produce a usable signal: one left the file
 * unparseable, and two moved the function out of the diverged set entirely, so the
 * classifier was never actually invoked. A self-test is both cheaper and permanent.
 */
function classifySide(sa: string[], sb: string[]): "A-superset" | "B-superset" | "neither" {
  const aInB = sa.every((l) => sb.includes(l))
  const bInA = sb.every((l) => sa.includes(l))
  if (aInB && !bInA) return "B-superset"
  if (bInA && !aInB) return "A-superset"
  return "neither"
}

function directionReport(
  aPath: string,
  bPath: string,
  fa: Map<string, string>,
  fb: Map<string, string>,
  diverged: string[],
): string {
  const label = (p: string): string => (p.includes("/m61/") ? "m61" : "m62")
  const ra = rawFunctionBodies(readFileSync(path.join(ROOT, aPath), "utf8"))
  const rb = rawFunctionBodies(readFileSync(path.join(ROOT, bPath), "utf8"))
  const lines: string[] = []
  for (const f of diverged) {
    const sa = ra.get(f) ?? []
    const sb = rb.get(f) ?? []
    if (sa.length === 0 || sb.length === 0) {
      lines.push(`      ${f}: could not extract one side`)
      continue
    }
    const side = classifySide(sa, sb)
    const rel =
      side === "B-superset"
        ? `${label(bPath)} is a SUPERSET (+${sb.length - sa.length} code line(s))`
        : side === "A-superset"
          ? `${label(aPath)} is a SUPERSET (+${sa.length - sb.length} code line(s))`
          : Math.abs(sa.length - sb.length) <= 1
            ? "same shape, different text — READ BOTH, this one is a judgement call"
            : `${label(sa.length > sb.length ? aPath : bPath)} is longer by ${Math.abs(sa.length - sb.length)} code line(s)`
    lines.push(`      ${f}: ${rel}  [m61 ${sa.length} lines, m62 ${sb.length}]`)
  }
  return (
    "    WHICH WAY each one goes, by comparing code lines with comments stripped:\n" + lines.join("\n")
  )
}



  check(
    "every shared function has ONE body across the copies",
    diverged.length === 0,
    diverged.length === 0
      ? `${shared.length} shared function(s), all byte-identical after comment stripping`
      : `*** ${diverged.length} of ${shared.length} shared functions have DIVERGED: ${diverged.join(", ")} ***` +
        (diverged.length > 0 ? `\n${directionReport(a, b, fa, fb, diverged)}` : ""),
  )

  // --- self-tests for the classifier, so the direction report cannot quietly rot -------
// A direction report that always said "READ BOTH" would be harmless-looking and useless,
// and one that always named the same side would be worse than wrong. The real data does
// exercise one branch — three functions are m62 supersets — but the other two are only
// reachable by construction, so they are constructed here.
const SELF_TESTS: Array<{ name: string; got: string; want: string }> = [
  { name: "a strict subset of b is B-superset", got: classifySide(["x", "y"], ["x", "y", "z"]), want: "B-superset" },
  { name: "a strict superset of b is A-superset", got: classifySide(["x", "y", "z"], ["x", "y"]), want: "A-superset" },
  { name: "each side having a unique line is NEITHER, not whichever is longer", got: classifySide(["x", "z"], ["x", "y"]), want: "neither" },
  { name: "identical sides are NEITHER", got: classifySide(["x"], ["x"]), want: "neither" },
  { name: "equal length with different content is NEITHER", got: classifySide(["x"], ["y"]), want: "neither" },
]
for (const t of SELF_TESTS) {
  check(
    `the direction classifier: ${t.name}`,
    t.got === t.want,
    t.got === t.want ? t.got : `got ${t.got}, wanted ${t.want}`,
  )
}

// The specific divergence that decides whether a ledger entry is honest.
  const driftA = ownedKeyList(fa.get("entryDrift") ?? "")
  const driftB = ownedKeyList(fb.get("entryDrift") ?? "")
  check(
    "the drift rule checks the SAME ledger keys in both copies",
    driftA !== null && driftB !== null && driftA.join() === driftB.join(),
    driftA === null || driftB === null
      ? "could not read an `owned` key list from one of the copies"
      : driftA.join() === driftB.join()
        ? `both check ${driftA.length} keys: ${driftA.join(", ")}`
        : `*** THE DRIFT RULES DIFFER. ${a} checks ${driftA.length} keys, ${b} checks ${driftB.length}. ` +
          `Only in ${a}: ${(driftA ?? []).filter((k) => !(driftB ?? []).includes(k)).join(", ") || "none"}. ` +
          `Only in ${b}: ${(driftB ?? []).filter((k) => !(driftA ?? []).includes(k)).join(", ") || "none"}. ` +
          `The same ledger entry is drift under one and not the other. ***`,
  )

  console.log(
    `\n  only in ${a}: ${onlyA.join(", ") || "none"}\n  only in ${b}: ${onlyB.join(", ") || "none"}`,
  )

  // --- 3. Does either copy's type match the data on disk? ------------------------
  const manifest = path.join(ROOT, "validation/m61/results/manifest.json")
  try {
    const issues = (JSON.parse(readFileSync(manifest, "utf8")) as { issues?: Array<{ evidence?: Record<string, unknown> }> })
      .issues ?? []
    const presentKeys = new Map<string, number>()
    for (const i of issues) for (const k of Object.keys(i.evidence ?? {})) presentKeys.set(k, (presentKeys.get(k) ?? 0) + 1)

    const typeKeys = (file: string): Set<string> => {
      const src = readFileSync(path.join(ROOT, file), "utf8")
      const m = src.match(/evidence\?:\s*\{([\s\S]*?)\n\s{2}\}/)
      const block = m?.[1] ?? ""
      return new Set([...block.matchAll(/^\s*(\w+)\??:/gm)].map((x) => x[1]!))
    }

    for (const f of present) {
      const declared = typeKeys(f)
      const missing = [...presentKeys.keys()].filter((k) => !declared.has(k)).sort()
      check(
        `${path.basename(path.dirname(f))}/${path.basename(f)}: its LedgerIssue.evidence declares every key the real ledger carries`,
        missing.length === 0,
        missing.length === 0
          ? `${declared.size} declared, all ${presentKeys.size} real keys covered`
          : `*** the real ledger carries ${missing.join(", ")} and this type does not declare ${missing.length === 1 ? "it" : "them"} (${missing.length === 1 ? "it appears on" : "they appear on"} ${presentKeys.get(missing[0]!)}/${issues.length} issues) ***`,
      )
    }
  } catch (e) {
    check(
      "the real ledger could be read to compare against the declared types",
      false,
      `*** could not read ${path.relative(ROOT, manifest)}: ${(e as Error).message}. A comparison that reads nothing proves nothing. ***`,
    )
  }
}

const failed = checks.filter((c) => !c.ok).length
console.log(
  `\nDUPLICATE DECISION CORES: ${failed === 0 ? "PASS" : `FAILED (${failed}) — see above`}` +
    (failed > 0
      ? "\n\n  This gate stays red on purpose. Choosing which copy is current is a decision about which\n  milestone's rules govern, and it is not mine to make from a type error. Until it is made, every\n  governance result is an artefact of which file imported which copy."
      : ""),
)
process.exit(failed === 0 ? 0 : 1)