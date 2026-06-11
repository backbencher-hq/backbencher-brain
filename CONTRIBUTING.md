# Contributing to Backbencher Brain

## Project Structure

```
src/
├── ast/           # Tree-sitter engine + 40 language analyzers
│   ├── engine.ts  # detectLanguage, getParser, parseFile
│   ├── types.ts   # UniversalSymbol, ParseResult, LanguageAnalyzer
│   ├── wasm.ts    # WASM loader, LRU cache
│   ├── patcher.ts # Byte-precise file editing
│   ├── imports.ts # Import injection + pruning
│   └── analyzers/ # One file per language (38 files)
├── indexer/       # Parallel project indexing
│   ├── discover.ts # File discovery with .gitignore/.bbignore
│   ├── worker.ts   # Child process file parser
│   ├── store.ts    # Batch SQLite storage
│   └── parallel.ts # Master orchestrator
├── graph/
│   └── query.ts   # 15 SQL query functions
├── sql/
│   └── schema.ts  # CREATE TABLE statements + migrations
├── tools/         # MCP tool implementations
│   ├── read-tools.ts  # 9 read tools
│   ├── write-tools.ts # 5 write tools
│   └── undo.ts        # brain_undo
├── cli/
│   └── commands.ts # CLI interface
├── server.ts      # MCP server over stdio
├── database.ts    # SQLite connection management
└── util/          # Errors, logging
```

## Analyzer Sync Workflow

When you fix or improve an analyzer in the main backbencher repo, sync it here:

```bash
./scripts/sync-analyzers.sh /path/to/backbencher
```

**What the script does:**
1. Finds all `real-*-analyzer.ts` files in the source
2. Copies them to `src/ast/analyzers/`
3. Replaces `import { ASTEngine } from "./engine"` with our local type imports
4. Strips opencode-specific deps (Log, Config, Bus, BrainDatabase)
5. Adds `@ts-nocheck` to preserve structural identity
6. Records source git SHA in `.analyzer-sync-version`

**After sync:**
```bash
npx tsc --noEmit    # Verify compilation
npm test             # Run tests
git diff             # Review changes
git commit -m "sync: update analyzers from backbencher"
```

## Adding a New Analyzer

1. Create `src/ast/analyzers/<language>.ts`
2. Implement `LanguageAnalyzer` interface:
   ```typescript
   export class RealXxxAnalyzer implements LanguageAnalyzer {
     analyze(rootNode: any, content: string, filePath: string) {
       return { symbols: [], relationships: [], imports: [], exports: [], errors: [], metadata: {} }
     }
   }
   ```
3. Register in `src/ast/analyzers/index.ts`
4. Add WASM path to `src/ast/wasm.ts` WASM_PACKAGES

## Code Conventions

- TypeScript strict mode throughout
- `@ts-nocheck` only on ported analyzers
- Raw SQL with `better-sqlite3` (no ORM)
- All logs to stderr (stdout reserved for MCP)
- Use `createLogger("module-name")` for module-scoped logging

## Testing

```bash
npm test                    # Run all tests
npx tsx tests/e2e-parser.ts # E2E parser test
npx tsx tests/indexer-test.ts # Indexer test
```

## PR Process

1. Fork, branch, implement, test
2. Ensure `npx tsc --noEmit` passes
3. Open PR with description of changes
