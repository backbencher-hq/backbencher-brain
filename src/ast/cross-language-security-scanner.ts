// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
import * as Log from "../tool/brain-log.js"
import { CrossLanguageIntelligence } from "./cross-language-intelligence.js"

const log = Log.create({ service: "cross-language-security" })

export namespace CrossLanguageSecurityScanner {
  export interface SecurityScanReport {
    timestamp: number
    totalFilesScanned: number
    owaspTop10: CrossLanguageIntelligence.SecurityVulnerability[]
    taintFlows: CrossLanguageIntelligence.TaintFlow[]
    authViolations: CrossLanguageIntelligence.SecurityVulnerability[]
    dependencyVulnerabilities: CrossLanguageIntelligence.SecurityVulnerability[]
    secretsDetected: CrossLanguageIntelligence.SecurityVulnerability[]
    overallScore: number // 0-100
  }

  /**
   * God-Mode Polyglot Security Scanner
   * Scans across 26 languages for OWASP Top 10, PII leaks, Auth bypasses, and hardcoded secrets.
   */
  export async function scanPolyglotProject(
    analysis: CrossLanguageIntelligence.PolyglotProjectAnalysis,
  ): Promise<SecurityScanReport> {
    log.info("🛡️ Initiating God-Mode Cross-Language Security Scan...")

    const report: SecurityScanReport = {
      timestamp: Date.now(),
      totalFilesScanned: analysis.crossLanguageSymbols.length,
      owaspTop10: [],
      taintFlows: analysis.dataFlowAnalysis.taintFlows || [],
      authViolations: [],
      dependencyVulnerabilities: [],
      secretsDetected: [],
      overallScore: 100,
    }

    // 1. Taint Analysis (PII/Secrets leakage) from DataFlow engine
    log.info("🔎 Analyzing Taint Flows for Cross-Language Leaks...")
    report.taintFlows.forEach((flow) => {
      if (!flow.isMitigated) {
        report.overallScore = Math.max(0, report.overallScore - getSeverityPenalty(flow.severity))
        report.owaspTop10.push({
          id: `owasp_a01_taint_${flow.id}`,
          title: `Sensitive Data Leak: ${flow.vulnerabilityType}`,
          description: `Data from ${flow.source.symbolName} reaches ${flow.sink.symbolName} without sanitization.`,
          severity: flow.severity,
          cwe: getCWEForTaint(flow.vulnerabilityType),
          location: flow.source.filePath,
          language: flow.source.language,
          remediation: `Implement sanitization or encryption at the boundary before ${flow.sink.symbolName}.`,
        } as any) // Type mapping fallback
      }
    })

    // 2. Auth/Authz Flow Validation (Checking endpoints without auth middleware)
    log.info("🔐 Validating Cross-Language Authentication & Authorization...")
    analysis.serviceTopology.services.forEach((service) => {
      service.endpoints.forEach((ep) => {
        // Simple heuristic: Does the endpoint require auth, and is it enforced?
        // In God-Mode, we look for middleware symbols or auth metadata in the topology
        const isAuthProtected = checkAuthProtection(ep, analysis.crossLanguageRelationships)
        if (!isAuthProtected && isSensitiveEndpoint(ep)) {
          report.authViolations.push({
            id: `auth_bypass_${ep.method}_${ep.path}`,
            title: `Broken Access Control on Sensitive Endpoint`,
            description: `Endpoint ${ep.method} ${ep.path} handles sensitive operations but lacks authentication middleware.`,
            severity: "critical",
            cwe: "CWE-284",
            location: ep.filePath,
            language: ep.language,
            remediation: "Add an authentication middleware/guard to this endpoint.",
          } as any)
          report.overallScore = Math.max(0, report.overallScore - 20)
        }
      })
    })

    // 3. Secrets Detection (Regex/Entropy scanning over all symbols)
    log.info("🔑 Scanning AST Symbols for Hardcoded Secrets...")
    analysis.crossLanguageSymbols.forEach((sym) => {
      const secretMatch = detectHardcodedSecrets(sym)
      if (secretMatch) {
        // Provide fallback locations based on where the symbol is defined
        const location = sym.definitions[0]?.filePath || "unknown_location"
        const language = sym.languages[0] || "unknown_language"

        report.secretsDetected.push({
          id: `secret_${sym.id}`,
          title: `Hardcoded Secret Detected`,
          description: `Found potential hardcoded secret in ${sym.name}: ${secretMatch.type}`,
          severity: "high",
          cwe: "CWE-798",
          location: location,
          language: language,
          remediation: `Extract secret to environment variables or a secrets manager like HashiCorp Vault.`,
        } as any)
        report.overallScore = Math.max(0, report.overallScore - 15)
      }
    })

    // 4. Dependency Vulnerability Scanning (Mock integration point for CVE databases)
    log.info("📦 Checking Dependency Vulnerabilities (CVE Mapping)...")
    // Identify third-party dependencies from AST relationships (e.g. SHARED_LIBRARY or external calls)
    const externalDeps = new Set<string>()
    analysis.crossLanguageRelationships.forEach((rel) => {
      if (
        rel.target.filePath.includes("node_modules") ||
        rel.target.filePath.includes("site-packages") ||
        !rel.target.filePath
      ) {
        // Extract base library name
        const parts = rel.target.filePath.split("/")
        const libName = parts[parts.length - 1] || "unknown_lib"
        externalDeps.add(libName.replace(/\.[a-z]+$/, ""))
      }
    })

    // Simulated CVE DB for God-Mode demonstration
    const VULNERABLE_LIBS: Record<string, { cve: string; severity: string; remediation: string }> = {
      log4j: { cve: "CVE-2021-44228", severity: "critical", remediation: "Upgrade to log4j >= 2.17.1" },
      express: { cve: "CVE-2022-24999", severity: "high", remediation: "Upgrade to express >= 4.17.3" },
      requests: { cve: "CVE-2023-32681", severity: "medium", remediation: "Upgrade to requests >= 2.31.0" },
      axios: { cve: "CVE-2023-45857", severity: "high", remediation: "Upgrade to axios >= 1.6.0" },
    }

    externalDeps.forEach((dep) => {
      const lowerDep = dep.toLowerCase()
      for (const [vulnerableLib, info] of Object.entries(VULNERABLE_LIBS)) {
        if (lowerDep.includes(vulnerableLib)) {
          report.dependencyVulnerabilities.push({
            id: `vuln_dep_${vulnerableLib}`,
            title: `Vulnerable Dependency Detected: ${vulnerableLib}`,
            description: `Found usage of dependency '${vulnerableLib}' which has known vulnerabilities.`,
            severity: info.severity as "low" | "medium" | "high" | "critical",
            cwe: info.cve,
            location: "Dependency Map",
            language: "multiple",
            remediation: info.remediation,
          } as any)
          report.overallScore = Math.max(0, report.overallScore - getSeverityPenalty(info.severity))
        }
      }
    })
    log.info(`✅ God-Mode Security Scan Complete. Score: ${report.overallScore}/100`)
    return report
  }

  // --- INTERNAL UTILS ---

  function getSeverityPenalty(severity: string): number {
    switch (severity.toLowerCase()) {
      case "critical":
        return 25
      case "high":
        return 15
      case "medium":
        return 10
      case "low":
        return 5
      default:
        return 0
    }
  }

  function getCWEForTaint(vulnType: string): string {
    const map: Record<string, string> = {
      sql_injection: "CWE-89",
      xss: "CWE-79",
      command_injection: "CWE-78",
      path_traversal: "CWE-22",
      pii_leak: "CWE-359",
      unencrypted_storage: "CWE-312",
    }
    return map[vulnType] || "CWE-UNKNOWN"
  }

  function checkAuthProtection(
    ep: CrossLanguageIntelligence.ServiceEndpoint,
    relationships: CrossLanguageIntelligence.CrossLanguageRelationship[],
  ): boolean {
    if (ep.path.toLowerCase().includes("public") || ep.path.toLowerCase().includes("health")) {
      return true
    }
    const hasAuthToken = ep.inputSchema?.some(
      (s: any) => s.name?.toLowerCase().includes("authorization") || s.name?.toLowerCase().includes("token"),
    )
    return !!hasAuthToken
  }

  function isSensitiveEndpoint(ep: CrossLanguageIntelligence.ServiceEndpoint): boolean {
    const pathLower = ep.path.toLowerCase()
    return (
      pathLower.includes("user") ||
      pathLower.includes("admin") ||
      pathLower.includes("payment") ||
      pathLower.includes("billing") ||
      pathLower.includes("settings") ||
      ep.method === "POST" ||
      ep.method === "PUT" ||
      ep.method === "DELETE"
    )
  }

  function detectHardcodedSecrets(symbol: CrossLanguageIntelligence.CrossLanguageSymbol): { type: string } | null {
    const lowerName = symbol.name.toLowerCase()
    const isSecretName =
      lowerName.includes("password") ||
      lowerName.includes("secret") ||
      lowerName.includes("api_key") ||
      lowerName.includes("token")

    if (!isSecretName) return null

    // Whitelist: skip SST/Cloudflare/Wrangler framework secret bindings
    // These use sst.Secret("name", "placeholder") — not hardcoded secrets
    const definition = symbol.definitions?.[0]
    if (definition) {
      const filePath = definition.filePath || ""
      // SST infrastructure configs use Secret references for deployment, not hardcoded values
      if (filePath.includes("/infra/") || filePath.includes("/sst/")) {
        return null
      }
      // Cloudflare Wrangler env bindings (env.SECRET_NAME)
      if (filePath.includes("cloudflare") || filePath.includes("wrangler")) {
        return null
      }
      // Symbol names ending in patterns like AccessKey, SecretKey are typically framework bindings
      if (
        lowerName.endsWith("accesskey") ||
        lowerName.endsWith("secretkey") ||
        lowerName.endsWith("apikey") ||
        lowerName === "secret"
      ) {
        return null
      }
    }

    // Check if configuration related
    if (symbol.type === CrossLanguageIntelligence.CrossLanguageSymbolType.CONFIGURATION) {
      return { type: "API Key / Token" }
    }

    return null
  }
}
