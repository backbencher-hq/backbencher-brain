// script/lib/optional-corpus.ts — corpora that only exist on SOME machines.
//
// WHY THIS IS SEPARATE FROM corpus-root.ts. The fixture corpus is expected
// everywhere and its location is settled (script/lib/corpus-root.ts). The large
// checkouts used by the m19 scale gates — intellij-community, aspnetcore, paperclip —
// are external clones: they exist on the machine that has them and nowhere else. A
// gate that hardcodes their path measures nothing on any other machine, and what it
// does instead varies by file:
//
//   script/m19/verify-giant-intellij.ts   crashed outright
//   script/m19/verify-retrieval-scale.ts  reported 5/7 with the corpus legs missing
//   script/m19/verify-scale-bench.ts      reported 0/16 — nothing ran
//
// Three shapes for one condition is the definition of a bug nobody can reproduce. The
// honest behaviour is the same everywhere: RESOLVE it if it is here, and if it is not,
// record a DECLARED BLOCK naming every location searched, so a reader can tell the
// difference between "this gate has nothing to measure" and "the measurement failed".
//
// The env override comes first. `BB_GIANT_REPO` and friends let a machine that HAS the
// clone use it without editing a gate, and let CI point at a checkout.

import { existsSync } from "node:fs"
import path from "node:path"

/** Every place a named external corpus may live, in the order searched. */
export function optionalCorpusCandidates(name: string, envVar?: string): string[] {
  const home = process.env.HOME ?? ""
  return [
    envVar ? process.env[envVar] : undefined,
    // The natural per-user clone location. No absolute path for a specific user is
    // listed: a helper that assumes one machine's home directory reports a corpus
    // absent on every other machine, which is the defect this module exists to fix.
    path.join(home, name),
    // A sibling of the repo, inside the fixture-corpus group directory. An earlier
    // version of this list claimed to handle "the layout this workspace uses" but built
    // `../<name>` — so where the corpus really is `../fixtures/repositories`, the
    // resolver reported it absent. A declared block that is declared because the helper
    // looked in the wrong place is worse than no helper: it turns "this machine cannot
    // run this gate" into a claim, and the gate reports it as fact.
    // In the reference workspace the repo and the corpus group are siblings, so the
    // sibling-of-repo candidate is TWO levels up, not one. The one-level form stays as
    // a fallback for a checkout that sits directly beside the corpus group.
    path.resolve(process.cwd(), `../../fixtures/${name}`),
    path.resolve(process.cwd(), `../fixtures/${name}`),
    path.resolve(process.cwd(), `../${name}`),
    path.resolve(process.cwd(), name),
  ].filter((c): c is string => typeof c === "string" && c.length > 0)
}

/** The corpus root if it exists here, else null. */
export function resolveOptionalCorpus(name: string, envVar?: string): string | null {
  for (const c of optionalCorpusCandidates(name, envVar)) {
    try {
      if (existsSync(c)) return c
    } catch {
      // unreadable is not a match
    }
  }
  return null
}

/**
 * A one-line DECLARED BLOCK for a gate whose subject is absent.
 *
 * The wording is fixed on purpose: the same phrase everywhere is what makes it
 * recognisable in a log, and it distinguishes "not available here" from "failed".
 */
export function optionalCorpusMissingMessage(name: string, envVar?: string): string {
  const searched = optionalCorpusCandidates(name, envVar)
  return (
    `${name} is not present on this machine. Set ${envVar ?? `BB_${name.toUpperCase().replace(/-/g, "_")}_REPO`} ` +
    `to its checkout. Searched: ${searched.join(", ")}`
  )
}
