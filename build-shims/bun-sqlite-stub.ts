// Node-build stub for bun:sqlite. db.bun.ts is never executed under Node
// (the #db import resolves to db.node.ts); this only satisfies the bundler.
export const Database = class Database {
  constructor() {
    throw new Error("bun:sqlite is only available under Bun")
  }
}
