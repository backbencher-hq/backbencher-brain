# Backbencher Brain (bb_lsp) — VS Code extension

Honest code navigation from the Backbencher index: hover with evidence tier and
staleness, definition, references, document symbols, workspace symbols, and call
hierarchy for Java, Groovy, Kotlin, Scala, and TypeScript.

**A complement to your editor's own language servers — graph, navigation, and
evidence only.** No completion, no diagnostics, no rename (declared scope,
contract §7.1).

## Features and claim levels

Every feature carries its declared claim level — the UI shows the same table
(`Backbencher: Show status`):

| Language  | Hover | Definition | References | Symbols | Call hierarchy |
|-----------|-------|------------|------------|---------|----------------|
| java      | I1    | I1         | I1         | I1      | I1             |
| groovy    | I1    | I1         | I1         | I1      | I1             |
| kotlin    | I1    | I1         | I1         | I1      | I1             |
| scala     | I1    | I1         | I1         | I1      | I1             |
| typescript| I1    | I1         | I1         | I1      | I1             |

I1 = protocol-passed (see the honesty contract in the repository: `docs/IDE-HONESTY-CONTRACT.md`).
The claim table shipped in this extension is drift-gated against the
machine-generated tool document at verify time — the UI can never claim more
than the evidence chain recorded.

## Version compatibility matrix (extension ↔ server)

| extension | min bb_lsp server | notes |
|-----------|-------------------|-------|
| 0.1.x     | 0.3.0             | declared in `bbLsp.minServerVersion`; a server that won't state its version is never trusted (fail closed) |

Rules:
- The server version comes from the single source (`BACKBENCHER_BRAIN_VERSION`).
- A mismatch disables features **with a visible message and a restart action** — never silent absence.
- The minimum is raised only in a major/minor that needs a newer server capability.

## Settings

| Setting | Default | Meaning |
|---------|---------|---------|
| `bbLsp.serverPath` | empty | explicit server entry override (validated, never guessed) |
| `bbLsp.sourceMode` | auto | compiled dist preferred; source via bun is a declared fallback |
| `bbLsp.minServerVersion` | 0.3.0 | minimum server version accepted |
| `bbLsp.activationBudgetMs` | 150 | declared activation budget (contract §7.3); a miss is a failed gate |
| `bbLsp.autoIndexMode` | ask | consent before building an index; `never` is a declared no-op |

## Indexing

On workspace open the extension detects an existing index
(`<BB_DATA_DIR or ~/.bb>/projects/<sha1-of-path>/brain.db`). If none exists it
asks **with the scale estimate in view** and never indexes without explicit
consent. Progress is cancellable; a cancelled index resumes on reopen without
re-asking. The editor is never blocked during activation or indexing.

## Commands

- `Backbencher: Restart bb_lsp server`
- `Backbencher: Show status (evidence levels, staleness)`
- `Backbencher: Index this workspace now`
