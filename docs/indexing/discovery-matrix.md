# What `bb index` actually scans

This page is the written form of the discovery matrix. It is verified by
`script/verify-index-discovery-matrix.ts`, which builds one fixture per case and asks the product's own
discovery function (`discoverIndexableFiles`, the same eligible-only walk behind `bb_health`) what it would
index. If a rule here changes without the doc and the gate moving together, the gate fails; the page cannot
silently drift from the walk.

The rules are enforced in this order (an explicit un-ignore is consulted first, so a user can always escape
a default with `.bbignore`):

| Case | Verdict | Rule |
| --- | --- | --- |
| A file whose extension maps to a supported language | **scanned** | `hasValidExtension` → `detectLanguageFromPath` (the language registry: TypeScript/JavaScript incl. `.mts`/`.cts`, Python, Go, Ruby, Rust, Java, Kotlin, Swift, C/C++, C#, PHP, Dart, Julia, R, Scala, Lua, shell, SQL, proto, GraphQL, and the structured-data/README extensions such as `.json`, `.yaml`, `.md`) |
| An extensionless file whose first 256 bytes are a shell `#!` line | **scanned** | bounded shebang read (`admitsShellShebang`); recognised extensions skip the read |
| A data file between 1 MB and 5 MB (e.g. `.json`) | **scanned** with structural extraction | size tier: full AST up to 1 MB; structural-only to 5 MB |
| A file over 5 MB | **skipped** | `> STRUCTURAL_LIMIT` skip in discovery; the file stays on disk, it is simply not indexed |
| A hidden directory (`.github`, `.vscode`, `.devcontainer`, `.hidden`, …) | **scanned** | hidden dirs are not skipped by default |
| Metadata/cache hidden dirs: `.git`, `.svn`, `.hg`, `.cache`, `.nyc_output`, `.venv`, `.next`, `.nuxt`, `.svelte-kit`, `.turbo` | **skipped** | fixed directory skip list |
| Default skip path segments: `Microbenchmarks/`, `wwwroot/`, `testassets/`, `benchmarkapps/`, `coverage/`, `testData/`, `node_modules/`, `dist/`, `build/`, `.git/`, `obj/`, `bin/` | **skipped** | built-in ignore globs + walk filter; `bin/` means the index does not re-index the launcher or build output |
| `vendor/`, `third_party/` | **scanned** | not on any skip list; vendored code is ordinary source |
| A file ignored by a `.gitignore` (root or nested) | **skipped** | `.gitignore` is respected at every directory level |
| A file ignored by `.gitignore` but re-included by a `.bbignore` `!pattern` | **scanned** | `.bbignore` is added after the gitignore layer; last match wins, so `!` un-ignores |
| A file listed in `.bbignore` | **skipped** | user-controlled exclusion, higher priority than `.gitignore` |
| A subdirectory containing its own `.git` (submodule / nested checkout / linked worktree) | **not walked** | nested project boundary; the subtree belongs to another index |
| A symlink | **not followed** | the walk admits regular files only; a symlinked file/dir is neither `isFile()` nor `isDirectory()` |
| A file deeper than 50 directory levels | **not walked** | depth cap 50 |
| A path matching `bb index --exclude <glob>` | **skipped for that run** | discovery exclusion, non-destructive: rows an earlier run stored are kept unless the file is genuinely gone |
| Anything else (binary, unknown extension, no shebang) | **skipped** | no language route |

Two consequences worth stating plainly:

- **The index is source plus structured text, not "everything".** A README, a `package.json` and a YAML
  config are indexed because a language route exists for them; a PNG, a lockfile of unknown type or a
  minified >5 MB bundle is not.
- **A nested repository is a boundary.** If a directory contains its own `.git`, its files belong to the
  index of that checkout, not this one. Worktrees and submodules behave the same way.

To see what the rules admit for a project without indexing it, use the same walk via
`discoverIndexableFiles(projectPath)` (the gate does exactly this). `bb_health`'s completeness question also
uses this function, so "missing from the index" and "not eligible" are the same rule set.
