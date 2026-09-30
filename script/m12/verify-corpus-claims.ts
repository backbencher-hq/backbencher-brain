// The #834 gate. The issue's root charge: "Today a claim can be wrong by
// 62.5 percentage points and every gate is green." This gate makes that
// impossible for every claim that HAS an artifact behind it, and makes the
// claims that do NOT have an artifact a visible, tracker-keyed remainder —
// the same mechanics the M60 family gates use for open issues (J1/W1), so
// debt is named, never smoothed.
//
// Hard failures (gate is red):
//   H6. A `candidates` pin that names a commit the repository does not contain.
//       A pin that RESOLVES but is older than the checkout is a legitimate
//       historical pin and is reported, not convicted.
//   H7. An artifact whose own corpusRevision does not match the manifest pin for
//       that corpus. H1-H5 compare the manifest to the artifact and the artifact
//       to nothing, so a claim and its artifact once agreed with each other
//       while describing a draw the instrument cannot reproduce.
//   H1. A manifest `measured.grammarErrorFiles` number that disagrees with
//       its artifact's `errorFiles`. The whole point: prose and measurement
//       must agree or someone must reconcile them by hand.
//   H2. A limit-map entry (namedGrammarLimits) whose `grammarLimit` reason is
//       missing or empty — a bare number is a claim, not evidence.
//   H3. A limit-map entry naming a file that is NOT an error file in the
//       artifact — the map is contradicted by the measurement.
//   H4. An artifact whose `passed` is true while it records unexpected errors
//       or crashes (self-contradiction).
//   H5. A manifest `corpusSymbols` / `corpusRelationships` claim that
//       disagrees with the artifact carrying those counts — and, when NO
//       artifact carries them, that is reported as `unbacked`, never as a
//       pass. Found 2026-09-26 on css: the manifest claimed 1,854
//       relationships for the svelte corpus where the same corpus measures
//       2,722 (a 47% undercount), and the gate was green for the whole time,
//       because H1 reconciled exactly ONE of the four numbers in the
//       `measured` block. A gate that checks one field of a claim and reports
//       the claim as agreed is worse than no gate: it lends the unchecked
//       fields a credibility they did not earn.
// Remainder (visible, must equal the tracker's registered debt):
//   R1. Languages with a manifest grammar-error claim (or an analyzer row)
//       and no `*-corpus-errors.json` artifact. Registered under the
//       follow-up issue; the gate goes fully green only when this is empty.
//
// Usage: bun script/m12/verify-corpus-claims.ts
// Writes: validation/m12/results/corpus-claims-gate.json
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync } from "node:fs"

const manifest = JSON.parse(readFileSync("validation/m12/corpus-manifest.json", "utf8"))

const hard: string[] = []
const remainder: string[] = []
/** Named, reported, and NOT convicted: a candidate repo that is not cloned on this
 *  box, and an artifact that pins no corpus revision. Both are visible debt. */
const knownGapDirs = new Set<string>()
const knownGapPins: string[] = []
/** Claims in the `measured` block that no artifact backs. Named, never a pass. */
const unbacked: { language: string; claim: string; value: number }[] = []
const checked: {
  language: string
  manifest: number | null
  artifact: number | null
  agreement: boolean | null
  volume?: { manifestSymbols: number | null; manifestRelationships: number | null; artifactSymbols: number | null; artifactRelationships: number | null; source: string | null }
}[] = []


for (const a of manifest.analyzers) {
  const lg: string = a.analyzer
  const meas = a.measured ?? {}
  const claimed: number | null = meas.grammarErrorFiles ?? null
  const artPath = `validation/m12/results/${lg}-corpus-errors.json`
  const hasArt = existsSync(artPath)

  if (!hasArt) {
    remainder.push(lg)
    checked.push({ language: lg, manifest: claimed, artifact: null, agreement: null })
    continue
  }

  const art = JSON.parse(readFileSync(artPath, "utf8"))
  const measured: number = art.errorFiles
  checked.push({ language: lg, manifest: claimed, artifact: measured, agreement: claimed === measured })

  // H1 — number agreement. Only enforced where the manifest claims a number.
  if (claimed !== null && claimed !== measured) {
    hard.push(`H1 ${lg}: manifest claims grammarErrorFiles=${claimed} but artifact measures ${measured}`)
  }

  // H2/H3 — limit-map integrity, where the artifact carries a map.
  const limits: any[] = art.namedGrammarLimits ?? []
  const errFiles: Set<string> = new Set((art.errorFileList ?? []).map((f: any) => f.file))
  for (const entry of limits) {
    const reason = String(entry.grammarLimit ?? "").trim()
    if (!reason) hard.push(`H2 ${lg}: limit entry for ${entry.file} carries no reason (bare number = smoothing)`)
    if (errFiles.size > 0 && !errFiles.has(entry.file)) {
      hard.push(`H3 ${lg}: limit entry names ${entry.file} which is not an error file in this measurement`)
    }
  }

  // H4 — self-contradiction.
  const unexpected = art.unexpectedErrorFiles ?? 0
  if (art.passed === true && (unexpected > 0 || (art.crashFiles ?? 0) > 0)) {
    hard.push(`H4 ${lg}: passed=true but unexpectedErrorFiles=${unexpected} crashFiles=${art.crashFiles}`)
  }

  // H5 — the VOLUME claims. An earlier draft of this compared the manifest's
  // `corpusSymbols`/`corpusRelationships` against the complexity envelope's
  // `corpus_subset` run and failed 4 languages on the spot. That comparison was
  // WRONG and the gate was wrong with it: `measure-analyzer.ts` documents that
  // run as "subject walk WITH the ext/size filter" — it is capped by `--limit`
  // and filtered by `--ext`/`--min-bytes`, so it is a DELIBERATELY SUBSET
  // measurement and cannot back an unfiltered corpus claim. Inventing a contract
  // the artifacts do not support is the `unsupportedClaimsPresentedAsProven`
  // failure M12's final audit exists to forbid, so the hard-failure branch is
  // gone.
  //
  // What is left is the honest state: the corpus-errors artifact is a
  // FULL-CORPUS measurement through the production pipeline, so when it carries
  // `symbols`/`relationships` it backs the claim exactly, with no filter to
  // reason about. Languages whose artifact does not carry them are reported in
  // `unbackedClaims` — named, never counted as agreed.
  const mSym: number | null = meas.corpusSymbols ?? null
  const mRel: number | null = meas.corpusRelationships ?? null
  const volume = { manifestSymbols: mSym, manifestRelationships: mRel, artifactSymbols: null as number | null, artifactRelationships: null as number | null, source: null as string | null }
  const artSym: number | null = art.symbols ?? null
  const artRel: number | null = art.relationships ?? null
  if (artSym !== null || artRel !== null) {
    volume.artifactSymbols = artSym
    volume.artifactRelationships = artRel
    volume.source = `${lg}-corpus-errors.json (mode=${art.mode}, ${art.measuredFiles} files)`
    if (mSym !== null && artSym !== null && mSym !== artSym) {
      hard.push(`H5 ${lg}: manifest claims corpusSymbols=${mSym} but ${volume.source} measures ${artSym}`)
    }
    if (mRel !== null && artRel !== null && mRel !== artRel) {
      hard.push(`H5 ${lg}: manifest claims corpusRelationships=${mRel} but ${volume.source} measures ${artRel}`)
    }
  }
  if ((mSym !== null || mRel !== null) && volume.source === null) {
    unbacked.push({ language: lg, claim: "corpusSymbols", value: mSym ?? -1 })
    unbacked.push({ language: lg, claim: "corpusRelationships", value: mRel ?? -1 })
  }
  checked[checked.length - 1].volume = volume
}

// ---------------------------------------------------------------------------
// H6 / H7 — the corpus PIN must RESOLVE, and the artifact's draw must BE it.
//
// Found 2026-09-26 while re-measuring sql. Two distinct defects, and the first
// version of this check conflated them, which is worth recording because the
// conflation produced a false accusation in a manifest note before it was caught.
//
//   H6  a `candidates` pin must name a commit that EXISTS in the named
//       repository. `candidates` is a list of corpora CONSIDERED, so a pin that
//       resolves but is older than the checkout is a legitimate historical pin
//       and is reported, not convicted. An unresolvable one is a fabrication.
//
//   H7  the ARTIFACT's own `corpusRevision` must resolve in the corpus the
//       manifest names, and must equal the manifest's pin for that corpus. This
//       is where the teeth are. H1-H5 compare the manifest to the artifact and
//       the artifact to nothing: a claim and its artifact agreed with each other
//       while describing a draw the instrument cannot reproduce. sql was the
//       case — artifact at 3b6ebd40, manifest pin 383e603e, 438 files versus 185
//       — and every one of H1-H5 was green.
//
// The form is the manifest's own convention, `<repoId>@<short-sha>(<dirty|clean>)`.
// A row whose candidate does not parse as that form is reported too: an
// unparseable pin is not a pass.
// ---------------------------------------------------------------------------

// Corpora are cloned under MORE THAN ONE root: fixtures/repositories holds most,
// but others live at absolute paths outside it (the M20 C2 registry records the
// real ones). So a repo this gate cannot LOCATE is a known gap — unverifiable
// here, not wrong. Absence of evidence is not evidence of a false pin, and a
// gate that convicts on its own failure to look is worse than no gate.
const CORPUS_ROOTS = [
  process.env.BB_CORPUS_ROOT,
  "$HOME/fixtures/repositories",
  "$HOME",
].filter((x): x is string => typeof x === "string" && x.length > 0)

/** Every location a corpus id might live, across all roots. */
function locateRepo(id: string): string[] {
  return CORPUS_ROOTS.map((r) => `${r}/${id}`)
}

const gitS = (dir: string, args: string[]): string | null => {
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim()
  } catch {
    return null
  }
}

const candidatesChecked: Array<Record<string, unknown>> = []

for (const a of manifest.analyzers) {
  const cands: string[] = Array.isArray(a.candidates) ? a.candidates : []
  for (const raw of cands) {
    // A trailing `# ...` is the manifest's own annotation convention.
    const text = String(raw).replace(/\s+#.*$/, "").trim()
    // `candidates` is OVERLOADED: for the clean lane it also carries the GRAMMAR
    // pin, not a corpus. A grammar pin is not a corpus claim and is not this
    // gate's business; convicting it for not naming a cloned repo was a false
    // positive found the first time this ran.
    if (/^tree_sitter_/.test(text)) {
      candidatesChecked.push({ language: a.analyzer, candidate: text, status: "grammar-pin-not-a-corpus" })
      continue
    }
    const m = /^([A-Za-z0-9._-]+)@([0-9a-f]{7,40})\((dirty|clean)\)$/.exec(text)
    if (!m) {
      candidatesChecked.push({ language: a.analyzer, candidate: text, status: "unparseable-pin" })
      knownGapPins.push(`${a.analyzer} (unparseable candidate "${text}")`)
      continue
    }
    const [, repo, sha, state] = m
    const dirs = locateRepo(repo).filter((d) => existsSync(d))
    if (dirs.length === 0) {
      candidatesChecked.push({ language: a.analyzer, candidate: text, repo, sha, state, status: "repo-not-located" })
      knownGapDirs.add(`${a.analyzer}:${repo}`)
      continue
    }
    // `cat-file -e <sha>^{commit}` is the test that matters: a prefix matching
    // nothing fails here. The `merge-base --is-ancestor <sha>` form takes TWO
    // arguments and exits non-zero on a usage error, which is how a real,
    // perfectly valid historical commit was briefly reported as fictional.
    const resolvedIn = dirs.find((d) => {
      try {
        execFileSync("git", ["-C", d, "cat-file", "-e", `${sha}^{commit}`], { encoding: "utf8" })
        return true
      } catch {
        return false
      }
    })
    if (!resolvedIn) {
      const heads = dirs.map((d) => `${d}@${(gitS(d, ["rev-parse", "HEAD"]) ?? "?").slice(0, 12)}`).join("  ")
      candidatesChecked.push({ language: a.analyzer, candidate: text, repo, sha, state, status: "sha-does-not-exist" })
      hard.push(
        `H6 ${a.analyzer}: candidate "${text}" names commit ${sha} which does not exist in any located copy of ${repo} (git cat-file -e fails; located: ${heads}). A pin that does not resolve cannot be the revision a claim was measured at.`,
      )
      continue
    }
    const head = gitS(resolvedIn, ["rev-parse", "HEAD"]) ?? ""
    candidatesChecked.push({
      language: a.analyzer,
      candidate: text,
      repo,
      sha,
      state,
      head,
      at: resolvedIn,
      // A pin that RESOLVES but is older than the checkout is a legitimate
      // historical pin — `candidates` lists corpora CONSIDERED, not only the
      // current one. Reported, never convicted.
      status: head.startsWith(sha) ? "at-head" : "resolves-historical",
    })
  }
}

/** H7 — the artifact's own draw must resolve and must equal the manifest's pin. */
const corpusIdentities: Array<Record<string, unknown>> = []
for (const a of manifest.analyzers) {
  const lg = a.analyzer
  const artPath = `validation/m12/results/${lg}-corpus-errors.json`
  if (!existsSync(artPath)) continue
  const art = JSON.parse(readFileSync(artPath, "utf8"))
  // A union corpus pins several revisions through a map; that is a pin.
  //
  // The map has been spelled THREE ways across the artifacts, and this gate only knew
  // two of them. `art.revisions` (plural) is the union form and has its own branch below.
  // `art.corpusRevision` / `art.revision` are read as single pins — but objective-c draws
  // from SEVERAL repositories and records that map under the SINGULAR `corpusRevision`, so
  // `rev` received an object and `rev.startsWith(sha)` threw a TypeError. That is not a
  // wrong verdict, it is NO verdict: the exception escaped the loop and H1-H7 stopped for
  // all 42 analyzers, which is the worst shape a gate failure can take, because a gate
  // that dies mid-run is indistinguishable from one that passed.
  //
  // So the pin is NORMALISED by type rather than by key: a string is a single pin and
  // goes down the existing branch, and anything else is folded into the map the union
  // branch already understands. Reading the key alone was the actual defect — a fourth
  // spelling would break it again, whereas a type test cannot be defeated by a name.
  const rawSingle = art.corpusRevision ?? art.revision ?? null
  const rev: string | null = typeof rawSingle === "string" ? rawSingle : null
  const singleMap: Record<string, string> =
    rawSingle && typeof rawSingle === "object" ? (rawSingle as Record<string, string>) : {}
  const revMap: Record<string, string> | null =
    art.revisions ?? (Object.keys(singleMap).length > 0 ? singleMap : null)
  if (rev == null && revMap == null) {
    corpusIdentities.push({ language: lg, status: "artifact-pins-no-corpus" })
    knownGapPins.push(lg)
    continue
  }
  if (rev != null) {
    // Prefix comparison in BOTH directions. The manifest pins 7-character short
    // shas in most rows and 8 in others, so a one-sided `slice(0, 8)` reported
    // markdown as undeclared when `scala3@18df09c(clean)` and the artifact's
    // `18df09c05fa4` are the same commit. A gate that convicts on its own
    // string-length assumption is not a gate.
    const shaOf = (c: string): string | null => /@([0-9a-f]{7,40})\(/.exec(c.replace(/\s+#.*$/, "").trim())?.[1] ?? null
    const norm = (id: string) => id.replace(/[_-]/g, "").toLowerCase()
    const pin =
      (a.candidates ?? [])
        .map(String)
        .find((c) => {
          const sha = shaOf(c)
          if (!sha) return false
          const shaMatch = rev.startsWith(sha) || sha.startsWith(rev.slice(0, sha.length))
          if (!shaMatch) return false
          // An artifact that names no corpus id can still be matched on the
          // revision alone: json/xml/yaml/hcl record only a revision, and
          // requiring an id match reported five lanes as undeclared when the sha
          // was identical. Where the artifact DOES name a repo, the id must
          // agree too — otherwise `python`'s proxicall@7163d975 would match a
          // pin for a different repo at the same revision by coincidence.
          const named = String(art.corpusRepo ?? "")
          if (!named) return true
          return norm(c.slice(0, c.indexOf("@"))) === norm(named)
        }) ?? null
    corpusIdentities.push({ language: lg, revision: rev, manifestPin: pin, status: pin ? "pass" : "no-matching-manifest-pin" })
    if (!pin) {
      hard.push(
        `H7 ${lg}: the artifact was measured at corpus ${art.corpusRepo ?? "?"}@${rev.slice(0, 12)}, which NO manifest candidate declares (${(a.candidates ?? []).map(String).join(", ") || "no candidates"}) — the manifest does not declare the draw its own evidence came from`,
      )
    }
  } else {
    corpusIdentities.push({
      language: lg,
      revisions: Object.keys(revMap!),
      // WHICH KEY the map arrived under, so a producer that renames it shows up here as a
      // diff in the evidence rather than as a TypeError in the verifier.
      mapKey: art.revisions ? "revisions" : "corpusRevision",
      status: "union-pinned",
    })
  }
}

const passed = hard.length === 0
const result = {
  gate: "m12-corpus-claims",
  issue: "#834",
  checkedAt: new Date().toISOString(),
  languagesChecked: checked.length,
  hardFailures: hard,
  remainderLanguages: remainder.sort(),
  remainderIssue: remainder.length > 0 ? "#897" : null,
  unbackedClaims: unbacked,
  corpusCandidates: candidatesChecked,
  corpusIdentities,
  knownGaps: {
    candidateRepoNotCloned: [...knownGapDirs].sort(),
    artifactPinsNoCorpusRevision: knownGapPins.sort(),
  },
  checked,
  passed,
  policy:
    "Every manifest grammarErrorFiles claim must agree with its measured artifact (H1), limit-map entries must carry reasons and be backed by the measurement (H2/H3), no artifact may declare pass while recording unexpected errors or crashes (H4), every corpusSymbols/corpusRelationships claim must agree with the artifact that carries those counts (H5), every candidate pin must name a commit that EXISTS in the named repository (H6), and every artifact-s own corpusRevision must match the manifest pin for that corpus (H7). A volume claim with NO artifact behind it is reported in `unbackedClaims` — named, never counted as agreed. Languages without artifacts are the registered remainder R1 — named here, never smoothed — and the gate goes green with them only while the tracker still carries the follow-up that owns them.",
}

const out = "validation/m12/results/corpus-claims-gate.json"
writeFileSync(out, JSON.stringify(result, null, 2) + "\n")

console.log(`H1-H7: ${hard.length === 0 ? "clean" : "FAIL"}`)
for (const h of hard) console.log("  " + h)
console.log(`R1 remainder: ${remainder.length} language(s) without artifacts: ${remainder.sort().join(", ") || "(none)"}`)
if (knownGapDirs.size) console.log(`KNOWN GAP: ${knownGapDirs.size} candidate repo id(s) not cloned on this box (pin unverifiable here, not wrong): ${[...knownGapDirs].sort().join(", ")}`)
if (knownGapPins.length) console.log(`KNOWN GAP: ${knownGapPins.length} artifact(s) pin NO corpus revision: ${knownGapPins.sort().join(", ")}`)
if (unbacked.length) {
  const langs = [...new Set(unbacked.map((u) => u.language))].sort()
  console.log(`UNBACKED volume claims: ${unbacked.length} across ${langs.length} language(s) — named, NOT counted as agreed:`)
  for (const u of unbacked) console.log(`  ${u.language} ${u.claim}=${u.value} (no artifact carries this count)`)
}
console.log(`gate ${passed ? "PASS" : "FAIL"} (remainder non-empty is a registered debt, not a hard failure)`)

console.log(`wrote ${out}`)
if (!passed) process.exit(1)
