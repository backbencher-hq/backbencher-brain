import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "cli/index": "src/cli/index.ts",
    "mcp/server": "src/mcp/server.ts",
    "lsp/server": "src/lsp/server.ts",
    // Stable worker entry for the parallel indexer pool. Forked directly by
    // the compiled dist: node dist/pool-worker.js (self-executing worker).
    "pool-worker": "src/ast/pool-worker.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node20",
  bundle: true,
  external: ["better-sqlite3", "../brain/worker/client", "web-tree-sitter"],
  outDir: "dist",
  sourcemap: false,
  clean: true,
  // The #db conditional import (bun:sqlite / better-sqlite3) resolves to the
  // node driver at build time; Bun users can still run from source.
  esbuildOptions(options) {
    options.conditions = ["node"]
    options.alias = { "#db": "./src/storage/db.node.ts", "bun:sqlite": "./build-shims/bun-sqlite-stub.ts" }
  },
})
