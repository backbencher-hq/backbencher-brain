# THE `src/` READS — four files, all resolved, all **KEEP HEAD**, each because main REMOVED something

**These are the actual source files among the 481 differing paths, read on both sides.**

| file | main-only | head-only | verdict |
|---|---|---|---|
| `src/cli/index-progress.ts` | 15 | **116** | **KEEP HEAD** |
| `src/cli/index.ts` | 11 | **79** | **KEEP HEAD** |
| `src/lsp/hover.ts` | 1 | 1 | **KEEP HEAD** |
| `src/mcp/tool-handlers.ts` | 8 | **24** | **KEEP HEAD** |

## WHY EACH, WITH THE LINE THAT DECIDES IT

**`src/cli/index-progress.ts`** — *main deletes two guards and their reasons:*
```
-// Below this, even "a few minutes" is a lie: a 7-file project finishes in seconds.
-const TINY_PROJECT_FILES = 50
-// Encouragement bands below this file count are noise, not progress.
-const ENCOURAGEMENT_MIN_FILES = 50
```
**MAIN REMOVES PROGRESS-REPORTING BEHAVIOUR AND THE REASONING FOR IT.** *HEAD carries 116 lines main does not — the feature.* **Taking main would delete a feature and the note explaining why it exists.**

**`src/cli/index.ts`** — *main removes the comment that records what a wipe actually costs:*
```
+      wipeProjectData(raw)                      (main: bare call)
-      const wiped = wipeProjectData(raw)        (HEAD: keeps the result)
-      // A wipe deletes ROWS, not pages: the file keeps every byte it had, so a
-      // rebuild then writes into an 8 GB file that is almost entirely holes
```
**MAIN DROPS BOTH THE RETURN VALUE AND THE MEASURED CONSEQUENCE IN ITS OWN COMMENT.** *That comment is the finding — "a wipe deletes ROWS, not pages" — and main deleted it.*

**`src/lsp/hover.ts`** — *one line each way, and HEAD's is the defensive one:*
```
HEAD:  lines.push(`evidence: ${(data.evidenceTiers||[]).join(", ")}`)
main:  lines.push(`evidence: ${data.evidenceTiers.join(", ")}`)
```
**MAIN'S FORM THROWS IF `evidenceTiers` IS UNDEFINED; HEAD'S DOES NOT.** *A one-line difference in the direction that crashes.*

**`src/mcp/tool-handlers.ts`** — *main removes `renderVisualizationStudio` from the import and the HTML-results branch with it:*
```
-import { visualizeProject, formatVisualization, renderVisualizationStudio, ... }
+import { visualizeProject, formatVisualization, ... }
-    const htmlResults = request.format === "html" ? [ ...
```
**HEAD HAS THE STUDIO; MAIN REMOVED IT.** *And HEAD's own docs reference it — `README.md` points at "canonical tool metadata" and the visualization surface — so the removal is main losing a feature, not fixing one.*

## THE PATTERN, AND IT IS THE OPPOSITE OF `script/m60`

*In `script/m60` main held the fixes and HEAD held the broken forms. **Here main is the side that has been stripped** — progress guards, a measured comment, a null-guard, and a whole renderer.*

**SO THE DIRECTION IS NOT A PROPERTY OF "MAIN" OR OF "HEAD" — IT IS A PROPERTY OF THE INDIVIDUAL PATH.** *That is why the union could not be done by a rule, and it is what the 600 predicate-decided paths have not been checked for.*
