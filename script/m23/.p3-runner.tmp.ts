import { runCli } from "$HOME/mcp/backbencher-brain/src/cli/index.ts"
await runCli(["index","/tmp/bb-p3-ixF4o3/project-c-import","--import","/tmp/bb-p3-ixF4o3/nope/brain.db"]).catch(() => process.exit(1))
