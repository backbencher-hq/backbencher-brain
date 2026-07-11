// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.

const log = Log.create({ service: "parser-pool" })

/**
 * 🏊 Parser Pool for Tree-sitter Parsers
 * Prevents memory leaks by reusing and properly cleaning up parsers
 */

// Parser entry with metadata
interface ParserEntry {
  parser: any
  language: string
  lastUsed: number
  useCount: number
}

// Pool configuration
const POOL_CONFIG = {
  maxParsersPerLanguage: 3,
  maxTotalParsers: 20,
  idleTimeoutMs: 60000, // 60 seconds
  cleanupIntervalMs: 30000, // 30 seconds
}

// The parser pools by language
const parserPools = new Map<string, ParserEntry[]>()
const languageModules = new Map<string, any>()

// Track total parsers
let totalParsers = 0

/**
 * Initialize parser pool for a language
 */
export async function initializeParser(language: string): Promise<any> {
  // Check if we have an available parser in the pool
  const pool = parserPools.get(language) || []
  
  // Try to reuse an existing parser
  const availableParser = pool.find((p) => p.useCount < 100)
  if (availableParser) {
    availableParser.lastUsed = Date.now()
    availableParser.useCount++
    return availableParser.parser
  }

  // Check pool limits
  if (pool.length >= POOL_CONFIG.maxParsersPerLanguage) {
    // Clean oldest parser and reuse slot
    const oldest = pool.sort((a, b) => a.lastUsed - b.lastUsed)[0]
    await destroyParser(oldest.parser)
    pool.shift()
    totalParsers--
  }

  if (totalParsers >= POOL_CONFIG.maxTotalParsers) {
    // Global cleanup - remove oldest parsers across all languages
    await cleanupOldestParsers(5)
  }

  // Load language module if needed
  let langModule = languageModules.get(language)
  if (!langModule) {
    try {
      const { ASTEngine } = await import("./engine")
      langModule = await (ASTEngine as any).loadLanguage(language)
      if (langModule) {
        languageModules.set(language, langModule)
      }
    } catch (e) {
      log.error(`Failed to load language module for ${language}`, { error: e })
      return null
    }
  }

  if (!langModule) {
    return null
  }

  // Create new parser
  try {
    const { Parser } = await import("web-tree-sitter")
    const parser = new Parser()
    parser.setLanguage(langModule)
    
    const entry: ParserEntry = {
      parser,
      language,
      lastUsed: Date.now(),
      useCount: 1,
    }
    
    pool.push(entry)
    parserPools.set(language, pool)
    totalParsers++
    
    log.debug(`Created parser for ${language}, total parsers: ${totalParsers}`)
    return parser
  } catch (e) {
    log.error(`Failed to create parser for ${language}`, { error: e })
    return null
  }
}

/**
 * Get a parser from the pool
 */
export async function getParser(language: string): Promise<any | null> {
  return initializeParser(language)
}

/**
 * Release a parser back to the pool (mark as available)
 * This doesn't actually destroy the parser, just updates metadata
 */
export function releaseParser(parser: any): void {
  // Parser is automatically reused - no action needed
  // Cleanup is handled by the periodic cleanup task
}

/**
 * Destroy a parser and free memory
 */
async function destroyParser(parser: any): Promise<void> {
  try {
    if (parser && typeof parser.delete === "function") {
      parser.delete()
    }
  } catch (e) {
    log.warn("Error destroying parser", { error: e })
  }
}

/**
 * Cleanup oldest parsers to free memory
 */
async function cleanupOldestParsers(count: number): Promise<void> {
  const allParsers: { entry: ParserEntry; language: string }[] = []
  
  for (const [lang, pool] of parserPools) {
    for (const entry of pool) {
      allParsers.push({ entry, language: lang })
    }
  }
  
  // Sort by last used time
  allParsers.sort((a, b) => a.entry.lastUsed - b.entry.lastUsed)
  
  // Remove oldest
  const toRemove = allParsers.slice(0, count)
  for (const { entry, language } of toRemove) {
    await destroyParser(entry.parser)
    const pool = parserPools.get(language) || []
    const idx = pool.indexOf(entry)
    if (idx >= 0) {
      pool.splice(idx, 1)
      totalParsers--
    }
  }
  
  log.debug(`Cleaned up ${toRemove.length} old parsers, total: ${totalParsers}`)
}

/**
 * Cleanup idle parsers periodically
 */
export function startCleanupTimer(): void {
  setInterval(async () => {
    const now = Date.now()
    let cleaned = 0
    
    for (const [lang, pool] of parserPools) {
      const idleParsers = pool.filter(
        (p) => now - p.lastUsed > POOL_CONFIG.idleTimeoutMs && p.useCount > 0
      )
      
      for (const entry of idleParsers) {
        await destroyParser(entry.parser)
        const idx = pool.indexOf(entry)
        if (idx >= 0) {
          pool.splice(idx, 1)
          totalParsers--
          cleaned++
        }
      }
    }
    
    if (cleaned > 0) {
      log.debug(`Cleaned up ${cleaned} idle parsers`)
    }
  }, POOL_CONFIG.cleanupIntervalMs)
}

/**
 * Get pool statistics
 */
export function getPoolStats(): {
  totalParsers: number
  parsersByLanguage: Record<string, number>
} {
  const byLang: Record<string, number> = {}
  for (const [lang, pool] of parserPools) {
    byLang[lang] = pool.length
  }
  return {
    totalParsers,
    parsersByLanguage: byLang,
  }
}

/**
 * Force cleanup all parsers (useful for tests)
 */
export async function cleanupAllParsers(): Promise<void> {
  for (const [lang, pool] of parserPools) {
    for (const entry of pool) {
      await destroyParser(entry.parser)
    }
    pool.length = 0
  }
  totalParsers = 0
  languageModules.clear()
  log.debug("All parsers cleaned up")
}

// Start cleanup timer
startCleanupTimer()
