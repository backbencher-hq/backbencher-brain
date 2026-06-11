// brain_undo — Restore file from backup
import { registerTool } from "../server.js"
import { restoreBackup } from "../ast/patcher.js"
import { reindexFiles } from "../indexer/parallel.js"
import { existsSync, readdirSync, statSync } from "fs"
import { join, basename, resolve, relative } from "path"

registerTool({
  name: "brain_undo",
  description: "Restore a file to its previous state from the most recent backup. Backups are created automatically before every brain_update, brain_insert, brain_delete, brain_refactor, and brain_write operation.",
  inputSchema: {
    type: "object",
    properties: {
      filePath: { type: "string", description: "File path to restore" },
    },
    required: ["filePath"],
  },
  handler: async (args: any, ctx: any) => {
    const filepath = resolve(ctx.projectPath, args.filePath)
    const backupDir = join(ctx.projectPath, ".bb_backups")

    if (!existsSync(backupDir)) {
      return { error: { code: "NO_BACKUPS", message: "No backup directory found. Write tools create backups automatically." } }
    }

    // Find most recent backup for this file
    const fileName = basename(filepath)
    const backups = readdirSync(backupDir)
      .filter(f => f.startsWith(fileName) && f.endsWith(".bak"))
      .map(f => ({ name: f, mtime: statSync(join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)

    if (backups.length === 0) {
      return { error: { code: "NO_BACKUPS", message: `No backups found for ${fileName}` } }
    }

    const latestBackup = join(backupDir, backups[0]!.name)
    const restored = restoreBackup(latestBackup, filepath)

    if (restored) {
      reindexFiles(ctx.projectPath, ctx.db, [{ path: filepath, type: "modified" }]).catch(() => {})
      return { data: { success: true, file: relative(ctx.projectPath, filepath), backup: backups[0]!.name } }
    }

    return { error: { code: "RESTORE_FAILED", message: "Failed to restore backup" } }
  },
})
