# Two proposals for `src/ast/file-claim.ts` — **BOTH LANDED 2026-10-11**

| proposal | landing | falsifier run |
|---|---|---|
| 1 — the root-landing hole | `8dc75a6b2` | toml's workaround REMOVED, row held at `13 / 318 / 0` |
| 2 — the size clause | `ba04c6b4c` | graphql `14/156/0` and scss `25/105/0`, both unchanged |
| 3 — the `magicConstants` note (below) | documentation only | php's row held at `3,544 / 6,443 / 0` |

They were landed by their AUTHOR under the Lead's delegation, because a half-applied change to a shared
guard is the one outcome the programme refuses; each is one commit with its own before/after and the
guard's controls re-run (now **21**, up from 15: the size clause gets two cases and the root pair three).

---


---

## Proposal 1 — the ROOT-LANDING hole (found by toml's own falsifier)

### What happened

The toml refactor was required to be **behaviour-neutral**: whole population, the lane's `imports` row
had to keep `extOK 318`, `extFAIL 0`. The first attempt produced **308**, so I diffed the old arithmetic
against the guard per edge: **10 LOST, 0 GAINED**, and every lost edge was the same shape.

```
../..   old=Project.toml   file=test/online/Project.toml
..      old=Project.toml   file=docs/Project.toml
../..   old=Project.toml   file=assets/html/Project.toml
```

Those `path` dependencies resolve **exactly to the project root**, whose project-relative form is the
EMPTY string. `foldProjectPath` answers `null` for that — correct on its own terms, because an empty
path is not a file — but the claim is about the manifest AT the root, and the gate verified all ten.

**The loss is invisible in every lane that has adopted the guard so far**, because every one of them
targets FILES. It appears only where a target names a DIRECTORY: toml's `path` dependencies, and any
future lane with directory-shaped targets. A lane that never has one cannot see the hole.

### The diff

`foldProjectPath` keeps its contract (an empty result is `null`, because it is not a file). The ROOT
becomes visible through a second exported function, and `fileClaimForTarget` is unchanged:

```diff
--- a/src/ast/file-claim.ts
+++ b/src/ast/file-claim.ts
@@
 export function foldProjectPath(baseDir: string, written: string): string | null {
+  const rel = projectRelativeOf(baseDir, written)
+  // AN EMPTY RESULT MEANS THE PROJECT ROOT, AND THE ROOT IS NOT A FILE. `foldProjectPath`'s callers
+  // want a path they can stat, so the root is not one — but a caller whose target names a DIRECTORY
+  // needs to know it reached the root, and that is what `projectRelativeOf` answers.
+  return rel !== null && rel.length > 0 ? rel : null
+}
+
+/**
+ * The same fold, with ONE difference that matters to directory-shaped targets: a path that lands
+ * exactly on the project root returns `""` rather than `null`.
+ *
+ * MEASURED, toml, whole population: `path = ".."` in `docs/Project.toml` and `"../.."` two levels
+ * down land on the root, and the manifest at the root is a claim the gate VERIFIES. Ten edges were
+ * lost to that case before it was handled. A file-shaped lane never produces it; a directory-shaped
+ * lane produces it on every `..` that reaches the top.
+ */
+export function projectRelativeOf(baseDir: string, written: string): string | null {
   const w = written.trim()
   if (w.length === 0 || w.length > 300) return null
   if (w.includes("://") || w.startsWith("/") || w.startsWith("~") || w.startsWith("\\")) return null
   for (const ch of NOT_A_PLAIN_PATH) if (w.includes(ch)) return null
   const out: string[] = []
   for (const seg of (baseDir + w).split("/")) {
     if (seg.length === 0 || seg === ".") continue
     if (seg === "..") { if (out.length === 0) return null; out.pop(); continue }
     out.push(seg)
   }
-  return out.length > 0 ? out.join("/") : null
+  return out.join("/")
 }
```

With that, toml's caller becomes the plain two-liner it should be — and the local workaround it
carries today (`path.resolve(path.dirname(filePath), written) === root`) disappears:

```ts
const posix = projectRelativeOf(dirOf(fileRel), written.trim())
const extra: string[] = []
if (posix !== null) {
  for (const m of DEPENDENCY_MANIFESTS) extra.push(posix.length === 0 ? m : `${posix}/${m}`)
  if (posix.length > 0) extra.push(posix)
}
```

**Falsifier for this proposal:** after it lands, toml's row must read `extOK 318 · extFAIL 0` with the
local workaround REMOVED. If it reads 308, the fold still loses the root.

---

## Proposal 2 — the SIZE clause (found by json-lane on zig; independent second sighting)

### What happened

`json-lane` measured **17 zig edges REFUTED** because the arbiter's admitted population excludes files
over the indexer's cap (`src/ast/parallel-indexer.ts:134`, `maxFileSizeBytes: 1 * 1024 * 1024`) while
the guard's test is extension + existence only. So the guard's admission is **necessary but not
sufficient**: a claim about a >1 MB file passes the guard and is REFUTED by the gate.

### The exposure, measured per lane

| lane | files over the 1 MB cap | gate's own population line |
|---|---|---|
| graphql | **4** | `4 over the 1 MB cap (largest 6.2 MB)` |
| scss | **2** | `2 over the 1 MB cap (largest 9.5 MB)` |
| protobuf | 0 | `0 over the 1 MB cap` |
| toml | 0 | `0 over the 1 MB cap` |
| php | 0 | `0 over the 1 MB cap` |
| clean | 0 | `0 over the 1 MB cap` |
| zig | (json-lane's) | — |

So the clause is moot for four of my lanes and **live for two**: graphql and scss each carry over-cap
files. Neither refuted in the rows I measured (`extFAIL 0` in both), so no claim landed on one — that is
luck about which files carry import edges, not a property of the guard.

### The diff

```diff
--- a/src/ast/file-claim.ts
+++ b/src/ast/file-claim.ts
@@
+/**
+ * THE INDEXER'S OWN ADMISSION CAP. `src/ast/parallel-indexer.ts` skips a file larger than
+ * `maxFileSizeBytes` (1 MB), so such a file is NOT in the population the arbiter checks a claim
+ * against — and a claim about it would be REFUTED, not merely unverified.
+ *
+ * MEASURED: json-lane's zig lane refuted 17 edges to exactly this hole before it was noticed here.
+ * Callers pass it; a caller that omits it keeps today's behaviour (existence only).
+ */
+export const FILE_CLAIM_MAX_BYTES = 1 * 1024 * 1024
+
 export type FileClaimInput = {
@@
   magicConstants?: Readonly<Record<string, string>>
+  /**
+   * The population's size cap, when the lane's admitted list has one. A candidate larger than this
+   * is not admitted, so it is not claimable: the guard refuses it exactly as it refuses a missing
+   * file, because a claim about it would be REFUTED.
+   */
+  maxFileSizeBytes?: number
 }
@@
     try {
-      if (!statSync(path.join(root, candidate)).isFile()) continue
+      const st = statSync(path.join(root, candidate))
+      if (!st.isFile()) continue
+      if (input.maxFileSizeBytes !== undefined && st.size > input.maxFileSizeBytes) continue
     } catch { continue }
     return candidate
```

**Why a parameter and not a constant inside the guard:** the cap is the INDEXER's fact, not the
guard's; a lane whose population is admitted by a different rule (a smaller cap, or none) must be able
to say so. `FILE_CLAIM_MAX_BYTES` is exported so the common case is one identifier rather than a magic
number re-typed per lane.

**Falsifier for this proposal:** a lane with an over-cap file that carries an import edge must show
`extFAIL 0` BEFORE and AFTER. graphql and scss are the lanes to run it on: if a claim about one of
their over-cap files appears, the guard refutes it today and this clause removes it.

---

## What both proposals share

Neither is a lane's local problem. **Proposal 1 cannot be seen by any file-shaped lane**; **Proposal 2
was found on zig and is live on graphql and scss**. Both are about the guard's admission matching the
ARBITER's facts exactly — extension, project boundary, existence, and size — because a claim that
misses is REFUTED and `extFAIL` must stay 0.


---

# Proposal 3 — the `magicConstants` note (documentation only, landed in `src/ast/file-claim.ts`)

**The values must be PROJECT-RELATIVE, and this is the first guard clause whose misuse produces NO
signal at all.** The substitution happens inside `fileClaimForTarget` and **BEFORE** its shape check, so
an absolute value — the obvious thing to pass, `path.dirname(filePath)` — makes the substituted target
begin with `/` and the guard refuses it as an absolute path.

**MEASURED:** php's include claim lost **145 of its 147 claims** (`extOK 6,443 -> 6,298`) the first time
it was put on this guard, with **no refutation, no error and no counter** — just a smaller number. `.`
is the spelling for a file at the project root; an empty string would leave a leading slash and
reintroduce the same loss.

A clause whose misuse is silent has to be documented where the parameter is declared, which is why this
one is a docstring rather than a proposal for code.
