# Contributing to Backbencher Brain

Thanks for helping. This is a local-first code-intelligence engine: a CLI, an MCP
server, an LSP server, and 53 language analyzers over a SQLite index. The rules below
exist because the product's claim is evidence, and evidence is what keeps it honest.

- [Five-minute setup](#five-minute-setup)
- [The evidence rule](#the-evidence-rule)
- [Where work is wanted](#where-work-is-wanted)
- [Website and generated-data sync](#website-and-generated-data-sync)
- [Issues and pull requests](#issues-and-pull-requests)
- [Commits, sign-off and licence](#commits-sign-off-and-licence)
- [Security and conduct](#security-and-conduct)

## Five-minute setup

Node.js 18 or newer, and a POSIX shell (Linux/macOS; WSL works on Windows). `bun` is
only needed for some of the long-running audits, not for the fast loop.

```bash
git clone https://github.com/backbencher-hq/backbencher-brain.git
cd backbencher-brain
npm ci              # exact dependency tree from package-lock.json
npm run build       # tsup -> dist/ (the CLI entry point is bin/bb)
npm run verify:fast # the ≤2-minute gate chain a PR must keep green
```

Useful next steps:

```bash
npm test                  # contract, engine, schema, registry, public-surface checks
bb --version              # run the CLI from the repo: ./bin/bb --version
npm run docs:verify       # tool-doc and docs-truth gates
npm run verify            # the full gate suite (long; needs bun and native deps)
```

`npm run verify:fast` is the bar for a normal PR. If you change an analyzer, a gate
script, the MCP surface, the install path or the site, run the matching deeper gate too
— the fast chain tells you what it covers, and the full `npm run verify` is the union.

## The evidence rule

**Every claim needs a record, and the gates are the review.**

- If you change behaviour, change the evidence that proves it: a fixture under
  `validation/`, a gate under `script/`, a test corpus entry. A behaviour change with
  no gate that would fail on a regression is not finished.
- The gates are the review. A PR is not merged on prose, confidence, or "it works on
  my machine"; it is merged on the checks that pin the behaviour.
- Claims in docs are claims too. Do not type a number, version, count or capability
  into a page — read it from generated data (see the next section).
- Honesty fields are load-bearing: a `stale` flag, a `truncated` reason, a declared
  bound or an unsupported-mode answer is part of the contract. Removing or softening
  one is a breaking change, not a cleanup.

## Where work is wanted

**1. Analyzer and language onboarding.** Add a language (a tree-sitter grammar and an
analyzer) or improve an existing one's precision — imports, symbols, relationships,
call extraction. Use the **Language onboarding** issue form: it carries the wave
checklist the gates expect, including grammar provenance and the upstream licence. New
languages join the LSP launch set only through the recorded wave protocol
(`src/lsp/launch_languages.ts`, `validation/m29/results/wave-*-approval.json`).

**2. Ruled relationships.** Relationship extraction is rule-driven: a caller edge, an
import, an inheritance link or a cross-language bridge is only emitted by a ruled
table with evidence, and the ruling tables are gated (M14/M57/M65). If you find a
relationship that is missing, wrong, or over-claimed, the fix is a ruling — a rule,
its scope, and the fixture that proves both directions — not a heuristic patch.

**3. Docs and site sync.** Fix a wrong docs page by fixing its generator, then
regenerating. "Good first issue" and "help wanted" labels mark work that is ready to
take; issues that ask for an agent report have `needs-repro` or `needs-evidence` until
the report carries a version, `bb doctor` output and a reproduction.

## Website and generated-data sync

The site renders facts; it must never hand-type them. If a change touches a fact that
appears on `website/` (or in `docs/tools/`, `docs/data/`), regenerate the dependent
artifacts from their generators and commit the source change WITH the regenerated
output. The generators and their outputs:

| Output | Regenerate | Check |
|---|---|---|
| `docs/data/public-tools.json`, `docs/tools/*.md`, `website/src/data/tools.generated.ts` | `npm run docs:generate` | `npm run docs:verify` |
| `website/src/data/truth.generated.ts` (version, tool/language counts, CLI commands, installer facts) | `npx tsx script/m41/generate-site-truth.ts` | `npx tsx script/m41/generate-site-truth.ts --check` |
| `website/src/data/brain-languages.ts` (language dataset) | `npx tsx script/site-truth/generate-languages.ts` | `npx tsx script/site-truth/generate-languages.ts --check` |
| `website/src/data/editors.generated.ts` | `npx tsx script/m56/generate-editors.ts --write` | same without `--write` |
| `website/src/data/docs.generated.ts` | `npx tsx script/m56/generate-docs-data.ts --write` | same without `--write` |
| `website/src/data/support.generated.ts` (FAQ) | `npx tsx script/m56/generate-support-data.ts` | `npx tsx script/m56/verify-support-page.ts` |

Then validate the rendered surface and the gate chain:

```bash
cd website && npm run build   # static generation fails on inconsistent data
cd .. && npx tsx script/m41/generate-site-truth.ts --check
npx tsx script/m41/verify-truth-pipeline.ts
npx tsx script/m41/verify-site-truth.ts && npx tsx script/m41/verify-site-truth.ts --label T3
npx tsx script/m41/verify-seo.ts
npx tsx script/m56/verify-tools-truth.ts
npx tsx script/m56/verify-editors-page.ts
npx tsx script/m56/verify-languages-surface.ts
npx tsx script/m56/verify-docs-completeness.ts
npx tsx script/m56/verify-support-page.ts
```

`docs/website/TRUTH-PIPELINE.md` is the full map of every generated file, its generator
and its gate. A data change without regeneration is a red gate — that is the intended
signal, not an obstacle. Never hand-edit a file whose header says it is generated.

## Issues and pull requests

- **Bugs**: the **Bug report** form. Include `bb --version`, your platform, the exact
  command or MCP call, and the output. `bb doctor` and `bb health` cover most of it.
- **AI-agent reports**: use the **Agent report** form. It asks for the version,
  `bb doctor` output, the tool that was called, index freshness, expected vs actual,
  and the evidence. A report without those is not reproducible and will be labelled
  `needs-repro`.
- **Language onboarding**: the **Language onboarding** form.
- **Docs/site drift**: the **Docs/site sync** form.
- Security issues: **never** open a public issue; see [SECURITY.md](SECURITY.md).

Pull requests:

- Keep the diff focused; one behaviour change per PR is reviewable, a refactor plus a
  fix is not.
- Run `npm run verify:fast` before pushing, and the matching deeper gates for the
  area you touched.
- Add a `CHANGELOG.md` entry under **Unreleased** for a user-visible change. Generated
  files are committed with their source, never instead of it.
- Do not commit `node_modules/`, build output, index databases, or local scratch
  files. `dist/` is built, not committed.

## Commits, sign-off and licence

This project uses the [Developer Certificate of Origin 1.1](https://developercertificate.org/).
Sign every commit so the PR carries a DCO check:

```bash
git commit -s -m "analyzer(python): extract decorator calls"
```

`-s` appends a `Signed-off-by:` line certifying you wrote the change (or have the right
to submit it) under the project's licence. There is no CLA. Keep the commit message
yours: do not add tool or agent attribution trailers — the author is the person who
submitted the change.

Contributions are accepted under the MIT licence (see [LICENSE](LICENSE)). Third-party
grammars and vendored assets keep their own upstream licences; a contributed grammar
must carry its licence file and attribution, and must be recorded where the grammar
pins live.

## Security and conduct

- Report vulnerabilities privately per [SECURITY.md](SECURITY.md); never in a public
  issue, PR comment, or agent transcript.
- Be decent to each other. This project follows the
  [Contributor Covenant 2.1](CODE_OF_CONDUCT.md); enforcement contact is listed there.
