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

  check(
    "every shared function has ONE body across the copies",
    diverged.length === 0,
    diverged.length === 0
      ? `${shared.length} shared function(s), all byte-identical after comment stripping`
      : `*** ${diverged.length} of ${shared.length} shared functions have DIVERGED: ${diverged.join(", ")} ***`,
  )

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