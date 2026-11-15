# PROPOSAL (powershell) — W9: THE GATE RESOLVES A RUNTIME-VARIABLE PATH, AND ALL 123 ROWS GET A DISPOSITION

**From:** powershell lane owner · **date:** 2026-10-20 · **branch:** `analyzers/ontology-laptop-b`
**Touches:** `script/m14/incoming-rule.ts` (the arbiter) and `script/m14/incoming-gate.ts` (the gate) —
**the Lead's instruments, not this lane's.** This is a proposal and not an edit.
**Instrument:** `validation/m14/fixtures/powershell/runtime-variable-disposition.mts` — the per-row
disposition, reproducible, on BOTH corpus roots, and it measures the patch's effect against both the
unpatched and the patched arbiter.
**Measurements:** `validation/m14/fixtures/powershell/measurements/w9-disposition-farm.json`,
`w9-disposition-default.json`, `w9-disposition-patched.json`.

---

## 0. WHAT THIS PROPOSAL CORRECTS, FIRST, BECAUSE THE EARLIER VERSION OF IT WAS WRONG

**THE EARLIER VERSION OF THIS PROPOSAL SAID "55 ROWS: 37 FALSE, 18 TRUE" AND PROMISED THAT THE 18
WOULD BECOME VERIFIED CLAIMS AND LIFT THE VERIFIED CLASS FROM 60.4361 % TO 60.4450 %. BOTH CLAIMS
ARE WRONG, AND THE INSTRUMENT THAT SETTLES IT IS THE ONE BELOW.**

- **THE WHOLE SHAPE IS 123 ROWS, NOT 55.** The 55 came from the arms' 33 changed rows plus the
  resolution probe's set — a SUBSET, and a subset of a subset. The instrument scans the whole
  admitted population.
- **THE 18 WOULD NOT BECOME VERIFIED CLAIMS.** Under the arbiter's OWN semantics, a resolved path
  that is **not** in the admitted list is **case 2** — "a path that exists NOWHERE in the corpus →
  genuinely outside OR dangling; the corpus cannot tell those apart, so it stays a **REFUSAL**". So
  **the verified class DOES NOT MOVE AT ALL: `(resolved + extOK) / edges` STAYS 60.4361 %, AND THE
  TOTAL WALL STAYS 80,051.** The earlier promise of a +18 rise was a promise the arbiter's own rule
  does not keep, and it is withdrawn here, in the open.
- **THE 37 WAS AN UNDERCOUNT: THE TRUE NUMBER IS 58.**

## 1. THE QUESTION, AND WHY THE ARBITER CANNOT ANSWER IT

A path that begins with a RUNTIME VARIABLE — `$PSScriptRoot\..\..\X.psm1` — is resolved at RUN TIME,
against a directory the project does not know. The gate's project facts are REPO-RELATIVE
(`projectFactsForFiles`: `path.relative(repoRoot, abs)`), so such a path is not in the admitted list
and cannot be, and `pathTargetInProject` has nothing to compare it against. **The arbiter's answer is
`externalUnverified` — a THIRD answer, neither TRUE nor FALSE.**

**THE GATE KNOWS BOTH HALVES OF WHAT IT NEEDS: the row's OWN SOURCE FILE (so its directory, so
`$PSScriptRoot`) and the PROJECT'S ADMITTED FILE LIST.** The row's own file is already carried to
the arbiter — `classifyEdge`'s `edgeFile` parameter, and the gate already passes it
(`incoming-gate.ts:1998` and `:2034`, `e.srcFile`) — so the missing half is the REPO-RELATIVE
spelling, because `edgeFile` is the ABSOLUTE path and `facts.files` is repo-relative.

## 2. THE MEASURED DISPOSITION — EVERY ROW, AND THE POPULATION NAMED

**POPULATION: 1,181 files parsed of 1,184 discovered, 30 repos, at the FARM ROOT
(`/home/ishaq2321/mcp/backbencher-brain/.corpus`).** **A PATH IS NOT A POPULATION, SO THE ROOT IS
NAMED AND THE SECOND ROOT IS MEASURED: the DEFAULT root
(`/home/ishaq2321/bb_tests/repositories`) reads IDENTICALLY — 1,181 parsed, 30 repos, 123 rows, 58
resolved, 65 named — so this disposition is ROOT-INDEPENDENT, measured on the rows themselves and not
only on the file multiset.** (The c lane measured 23,237 against 7,435 files across the fleet's whole
population; powershell is the lane the root does not touch.)

**123 ROWS OF THIS SHAPE — every one of them dispositioned:**

| disposition | rows | what it means |
|---|---|---|
| **RESOLVED · PROJECT FILE** | **58** | the resolved path IS in the repo's admitted file list, so the externality claim is **FALSE** and the arbiter's case 1 REFUTES it |
| **NAMED REASON · case 2** | **18** | the resolved path is not in the admitted list, and **THE PROJECT CANNOT TELL AN EXTERNAL MODULE FROM A DANGLING PATH** — the arbiter's own case 2, which is a REFUSAL, recorded and never silence |
| **RESOLVED · a BUILT-IN** | **30** | the variable is `$PSHOME` — **the PowerShell INSTALLATION directory** — and the file it names is the installation's own (26 × `pwsh`, 3 × `pwsh.exe`, 1 × `RegisterManifest.ps1`), so the claim is TRUE and no project owns the installation |
| **RESOLVED · NOT A SOURCE FILE** | **11** | the variable **is assigned in the row's own file** (`$pwshDir` ×3, `$publishPath` ×2, `$moduleDirectory` ×2, `$dotnetRoot`, `$targetPsHome`, `$scriptModuleName`, `$psBinPath`), and the file it names is `pwsh`, `pwsh.exe`, `dotnet.exe` or a `.dll` — **NOT a source file, while the admitted set is a set of SOURCE files, so these are not project files BY KIND** |
| **NAMED REASON · the ANALYZER's one-file question** | **1** | `$ProjectRoot\build.ps1` — the variable IS assigned in its own file, so the path is derivable by a **ONE-FILE** rule, and a ONE-FILE rule is **the ANALYZER's question, not the gate's** |
| **NAMED REASON · a built-in or a received value** | **5** | the variable is neither the file's own directory nor assigned in the file: `$env:` ×2, `$ShimDirectory`, `$TestDrive`, `$testdrive` — a built-in or a value the file receives, and neither is the project's |

**THE ARBITER'S VERDICT ON THE 123 ROWS, BEFORE AND AFTER THE RESOLUTION: `externalUnverified` 123
→ `externalRefuted` 58 · `externalUnverified` 65.**

## 3. THE PATCH — AND IT IS MEASURED, NOT ASSERTED

**THE PATCH'S EFFECT, MEASURED BY THE SAME INSTRUMENT AGAINST BOTH ARBITERS:**

| arbiter | the instrument's own answer | the patch's effect |
|---|---|---|
| **the tree's arbiter, unpatched** | `externalUnverified` 123 | **0 of 123 rows change verdict** |
| **a copy with the patch applied** | `externalRefuted` 58 · `externalUnverified` 65 | **58 of 123 rows change verdict** |

**AND THE PATCHED ARBITER'S ANSWER AGREES WITH THE INSTRUMENT'S OWN RESOLUTION, ROW FOR ROW (58 / 65)
— so the text below is FAITHFUL: applying it to the Lead's arbiter produces exactly the disposition
in §2, and not an approximation of it.**

### 3.1 THE ARBITER (`script/m14/incoming-rule.ts`)

```ts
/**
 * W9 — THE RUNTIME-VARIABLE PATH RESOLUTION.
 *
 * A path that begins with a RUNTIME VARIABLE (`$PSScriptRoot\..\..\X.psm1`) is resolved at RUN
 * TIME, against a directory the project does not know, so it is not in the repo-relative admitted
 * list and `pathTargetInProject` has nothing to compare it against. The edge's OWN FILE is the
 * other half: `$PSScriptRoot` IS that file's directory, so the path IS derivable — and the gate
 * knows both halves.
 *
 * `edgeFile` is REPO-RELATIVE (the spelling `facts.files` holds). `null` means the row cannot be
 * resolved, and the caller then keeps its UNVERIFIABLE answer.
 */
export function resolveRuntimePath(src: string, edgeFile: string | undefined): string | null {
  if (edgeFile === undefined) return null
  if (src.charCodeAt(0) !== 36 /* $ */) return null
  let i = 1
  while (i < src.length) {
    const c = src.charCodeAt(i)
    const isWord = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95
    if (!isWord) break
    i++
  }
  if (i === 1) return null
  const variable = src.slice(1, i)
  const rest = src.slice(i)
  if (variable.toLowerCase() !== "psscriptroot") return null
  if (!(rest.startsWith("/") || rest.startsWith("\\") || rest.startsWith(":"))) return null
  const dir = edgeFile.split("/").slice(0, -1).join("/")
  const segs = (dir + "/" + rest.replace(/\\/g, "/").replace(/^:/, "")).split("/")
  const out: string[] = []
  for (const seg of segs) {
    if (seg === "" || seg === ".") continue
    if (seg === "..") { if (out.length === 0) return null; out.pop(); continue }
    out.push(seg)
  }
  const joined = out.join("/")
  return joined.length > 0 ? joined : null
}

export function pathTargetInProject(facts: ProjectFacts, tgt: string, edgeFile?: string): boolean {
  const norm = tgt.replace(/\\/g, "/").replace(/^\.\//, "").trim()
  if (norm === "" || norm.endsWith("/")) return false
  for (const f of facts.files) {
    const nf = f.replace(/\\/g, "/")
    if (nf === norm || nf.endsWith(`/${norm}`)) return true
  }
  // W9 — AND THE RUNTIME-VARIABLE PATH, RESOLVED AGAINST THE EDGE'S OWN FILE.
  const resolved = resolveRuntimePath(tgt, edgeFile)
  if (resolved !== null && facts.files.has(resolved)) return true
  return false
}
```

**AND `verifyExternalClaim` GAINS THE PARAMETER AND PASSES IT THROUGH** (the case-1 path question):

```ts
  facts?: ProjectFacts,
  /** W9 — THE EDGE'S OWN FILE, repo-relative, so a runtime-variable path can be resolved. */
  edgeFile?: string,
): "externalVerified" | "externalRefuted" | "externalUnverified" {
  ...
    if (facts) return pathTargetInProject(facts, tgt, edgeFile) ? "externalRefuted" : "externalUnverified"
```

### 3.2 THE GATE (`script/m14/incoming-gate.ts`)

**THE GATE MUST PASS THE EDGE'S REPO-RELATIVE FILE**, because `edgeFile` is the ABSOLUTE path and
`facts.files` is repo-relative. The gate already computes that spelling for the facts
(`path.relative(repoRoot, abs)` in `projectFactsForFiles`), and it already knows each edge's repo
(`repoOf(f)`).

## 4. WHAT THE PATCH BUYS, AND WHAT IT DOES NOT — STATED PLAINLY

**THE PATCH DOES NOT CHANGE THE VERIFIED CLASS, AND IT DOES NOT CHANGE THE TOTAL WALL.** The 58 rows
become `externalRefuted` — a **VISIBLE** false claim instead of an invisible wall — and the 65 stay
unverifiable, 18 of them by the arbiter's own case 2 and 47 of them because the variable is not
derivable. **NO ROW BECOMES `externalVerified`, so `(resolved + extOK) / edges` STAYS 60.4361 % AND
THE TOTAL WALL STAYS 80,051.**

**SO WHAT DOES IT BUY? THREE THINGS, AND THE THIRD IS THE ONE THAT MATTERS.**

1. **58 INVISIBLE WALLS BECOME 58 ANSWERED ROWS.** A wall that is answered is a wall that is
   DISPOSITIONED, and the floor's definition is "every wall dispositioned".
2. **THE LANE'S OWN RULE STOPS BEING A JUDGEMENT AND BECOMES THE ARBITER'S VERDICT.** The lane's
   analyzer drops the externality reading on this shape because a ONE-FILE parse cannot judge it.
   **WITH THE PATCH, THE GATE JUDGES IT, AND THE GATE'S ANSWER ON 58 OF THE 76 DERIVABLE ROWS IS
   "THE CLAIM IS FALSE" — WHICH IS EXACTLY WHY THE LANE'S RULE IS RIGHT, AND NOW IT IS THE ARBITER'S
   ANSWER RATHER THAN THE LANE'S OPINION.**
3. **THE 65 GET NAMED REASONS INSTEAD OF A BLANK.** 18 are the arbiter's own case 2 (the project
   cannot tell an external module from a dangling path) and 47 name their variable — and **a row that
   is NAMED BUT NOT DECIDED IS NOT A DISPOSITION, so these 65 are the rows that still need a DECISION,
   and the decision is the Lead's**: either a second resolution rule (a variable the project declares
   — `$ProjectRoot` and friends are often assigned in the same file) or an explicit exemption.

## 4a. THE RESIDUAL, COUNTED

**OF THE 123 ROWS: 99 ARE DECIDED (58 false claims, 30 true claims, 11 true-by-kind), 24 ARE NAMED
WITH A REASON, AND THE RESIDUAL IS EXACTLY ONE ROW** — `$ProjectRoot\build.ps1`, whose variable is
assigned in its own file and whose target is a source file, so it is answerable by a **one-file rule in
the analyzer** and by nothing else in the pipeline. **A WALL THAT IS NAMED BUT NOT DECIDED IS NOT A
DISPOSITION, SO THAT ONE ROW IS THE LANE'S OWN RESIDUAL WORK ITEM, AND IT IS NAMED RATHER THAN LEFT.**

## 5. WHAT IS ASKED

**NOT AN EDIT. A DECISION.**

1. **THE GATE RESOLVES A RUNTIME-VARIABLE PATH** — the patch in §3, measured in §3 — and the 123
   rows read 58 answered and 65 named.
2. **THE 65 GET A SECOND RULE OR AN EXEMPTION** — the 18 case-2 rows and the 47 not-derivable rows
   are DISPOSITIONED but not DECIDED, and the Lead's own rule says a named-but-undecided row is a
   give-up.
3. **OR NOTHING CHANGES**, the 123 rows stay walls, and **that is a legitimate outcome PROVIDED IT IS
   CHOSEN AND RECORDED rather than left as a hole** — and this lane's price is on the record in the
   analyzer's own comment and in the verdict page: **58 false claims removed, 18 true claims lost, and
   the verified class and the total wall identical either way.**

**THE LANE ASKS FOR (1) AND (2) IF THEY ARE SMALL ENOUGH, AND (3) IF THEY ARE NOT** — and, either
way, **the 123 and the 58 and the 18 and the 47 on the record**, so that the next reader knows the
price of the current rule and does not have to re-derive it.

## 6. A HAZARD, HIT BY ME, IN THE OPEN — `cp -al` IS NOT A COPY FOR AN IN-PLACE WRITE

**THE PATCH WAS MEASURED IN A HARD-LINKED COPY OF THE TREE (`cp -al`), AND THE FIRST ATTEMPT TO
PATCH IT WROTE THROUGH THE HARD LINK INTO THE LEAD'S REAL ARBITER — `script/m14/incoming-rule.ts`
WAS MODIFIED FOR ABOUT A MINUTE, BY THIS LANE, IN THE LEAD'S FILE.** It was reverted with
`git checkout` and the tree is clean (`git status --short -- script/m14/incoming-rule.ts` is empty),
and the copy was rebuilt with `rm` + write so the patched file is a NEW INODE — the inodes are now
proved to differ (`44201` for the copy, `29495750` for the tree).

**THE ARMS' RUNNER ALREADY HAD THIS DISCIPLINE** — it replaces the analyzer with `rm` + write, a NEW
INODE, precisely so a write cannot reach the shared tree — **AND I RE-USED THE COPY WITHOUT RE-USING
THE DISCIPLINE. THE LESSON IS NOW PROVEN TWICE, BY THE SAME LANE, IN OPPOSITE DIRECTIONS: ONCE AS A
SWAP WINDOW AND ONCE AS A HARD LINK.** The proposal
`validation/m14/proposals/lane-swap-exposure-and-the-copy-fix.md` carries the fleet's lesson; this is
its second proof, and the second proof was mine.
