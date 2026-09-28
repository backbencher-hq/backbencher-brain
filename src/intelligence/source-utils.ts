import { readFile } from "node:fs/promises"

export async function readSymbolSnippet(
  filePath: string,
  lineStart: number | null | undefined,
  lineEnd: number | null | undefined,
  maxLines = 12,
): Promise<string | undefined> {
  if (!filePath || !lineStart) return undefined
  let text = ""
  try {
    text = await readFile(filePath, "utf8")
  } catch {
    return undefined
  }
  const end = Math.min(Math.max(lineEnd || lineStart, lineStart), lineStart + maxLines - 1)
  return text.split("\n").slice(lineStart - 1, end).join("\n")
}

export function parseJsonField<T>(value: unknown): T | undefined {
  if (typeof value !== "string" || !value) return undefined
  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}
