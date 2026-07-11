// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
import * as Log from "../tool/brain-log.js"
import path from "path"
import fs from "fs/promises"
import { createHash } from "crypto"
import { extractFallback } from "./pool-worker"

const log = Log.create({ service: "dependency-skimmer" })

export class DependencySkimmer {
  static async skim(projectPath: string): Promise<any[]> {
    const results: any[] = []
    
    // 1. Node.js (package.json)
    try {
      const pkgPath = path.join(projectPath, "package.json")
      const pkgContent = await fs.readFile(pkgPath, "utf8")
      const pkg = JSON.parse(pkgContent)
      
      const deps = { ...pkg.dependencies }
      const depNames = Object.keys(deps).slice(0, 50) // Top 50 to avoid bloat
      
      for (const dep of depNames) {
        try {
          const depPkgPath = path.join(projectPath, "node_modules", dep, "package.json")
          const depPkgContent = await fs.readFile(depPkgPath, "utf8")
          const depPkg = JSON.parse(depPkgContent)
          
          let typesPath = depPkg.types || depPkg.typings || "index.d.ts"
          const fullTypesPath = path.join(projectPath, "node_modules", dep, typesPath)
          
          try {
            const typesContent = await fs.readFile(fullTypesPath, "utf8")
            // Truncate to 100kb for speed
            const truncated = typesContent.substring(0, 100 * 1024)
            const hash = createHash("sha256").update(truncated).digest("hex").slice(0, 16)
            
            const extraction = extractFallback(truncated, "typescript", hash, truncated.length, Date.now())
            
            // Tag them as external
            for (const sym of extraction.symbols) {
              (sym as any).scope = `external:${dep}`;
              (sym as any).type = `external_${(sym as any).type}`;
            }
            
            results.push({
              filePath: fullTypesPath,
              success: true,
              language: "typescript",
              fileHash: hash,
              sizeBytes: truncated.length,
              lastModified: Date.now(),
              symbols: extraction.symbols,
              relationships: [],
              imports: [],
              errors: []
            })
            
            log.debug(`skimmed types for ${dep}`)
          } catch (e) {
            // Types file not found, try @types
            const definiteTypesPath = path.join(projectPath, "node_modules", "@types", dep, "index.d.ts")
            try {
              const typesContent = await fs.readFile(definiteTypesPath, "utf8")
              const truncated = typesContent.substring(0, 100 * 1024)
              const hash = createHash("sha256").update(truncated).digest("hex").slice(0, 16)
              
              const extraction = extractFallback(truncated, "typescript", hash, truncated.length, Date.now())
              
              for (const sym of extraction.symbols) {
                (sym as any).scope = `external:${dep}`;
                (sym as any).type = `external_${(sym as any).type}`;
              }
              
              results.push({
                filePath: definiteTypesPath,
                success: true,
                language: "typescript",
                fileHash: hash,
                sizeBytes: truncated.length,
                lastModified: Date.now(),
                symbols: extraction.symbols,
                relationships: [],
                imports: [],
                errors: []
              })
              log.debug(`skimmed @types for ${dep}`)
            } catch (err) {
              // Ignore
            }
          }
        } catch (e) {
          // Dependency not installed in node_modules
        }
      }
    } catch (e) {
      // No package.json
    }
    
    // 2. Python (requirements.txt / pyproject.toml) - basic support
    try {
      const reqPath = path.join(projectPath, "requirements.txt")
      const reqContent = await fs.readFile(reqPath, "utf8")
      // Extract library names and just inject basic boundary knowledge
      const libs = reqContent.split('\n').map(l => l.split('==')[0].trim()).filter(l => l && !l.startsWith('#'))
      
      // Since we don't have node_modules for python easily mapped without running pip show,
      // we can just add a fake 'boundary' file for python.
      if (libs.length > 0) {
        const symbols = libs.map((lib, i) => ({
          name: lib,
          type: "external_module",
          startLine: i + 1,
          endLine: i + 1,
          scope: "external"
        }))
        
        results.push({
          filePath: reqPath + ".boundary",
          success: true,
          language: "python",
          fileHash: "boundary",
          sizeBytes: reqContent.length,
          lastModified: Date.now(),
          symbols,
          relationships: [],
          imports: [],
          errors: []
        })
      }
    } catch(e) {
       // no requirements.txt
    }

    // 3. Rust (Cargo.toml)
    try {
      const cargoPath = path.join(projectPath, "Cargo.toml")
      const cargoContent = await fs.readFile(cargoPath, "utf8")
      const lines = cargoContent.split('\n')
      let inDeps = false
      const libs: string[] = []

      for (const line of lines) {
        const t = line.trim()
        if (t.startsWith("[dependencies]")) {
           inDeps = true
           continue
        }
        if (t.startsWith("[")) {
           inDeps = false
        }
        if (inDeps && t && !t.startsWith("#")) {
           const parts = t.split("=")
           if (parts.length > 1) {
              libs.push(parts[0].trim())
           }
        }
      }

      if (libs.length > 0) {
        const symbols = libs.map((lib, i) => ({
          name: lib,
          type: "external_crate",
          startLine: i + 1,
          endLine: i + 1,
          scope: "external"
        }))
        
        results.push({
          filePath: cargoPath + ".boundary",
          success: true,
          language: "rust",
          fileHash: "boundary",
          sizeBytes: cargoContent.length,
          lastModified: Date.now(),
          symbols,
          relationships: [],
          imports: [],
          errors: []
        })
      }
    } catch(e) {
       // no Cargo.toml
    }
    
    return results
  }
}
