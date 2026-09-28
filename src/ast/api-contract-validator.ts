import { CrossLanguageIntelligence } from "./cross-language-intelligence"
import * as Log from "../tool/brain-log"

const log = Log.create({ service: "api-contract-validator" })

export namespace APIContractValidator {
  
  export interface SchemaField {
    name: string
    type: string
    required: boolean
    nested?: SchemaField[]
  }

  export interface UnifiedContract {
    id: string
    serviceId: string
    path: string
    method: string
    source: "endpoint" | "caller"
    language: string
    filePath: string
    inputSchema: SchemaField[]
    outputSchema: SchemaField[]
  }

  export interface BreakingChange {
    id: string
    severity: "high" | "critical"
    type: "missing_required_field" | "type_mismatch" | "endpoint_removed" | "response_format_changed"
    description: string
    callerInfo: { file: string, language: string }
    endpointInfo: { file: string, language: string }
    remediation: string
  }

  export interface ContractDrift {
    id: string
    severity: "low" | "medium"
    type: "unknown_field_sent" | "unhandled_response_field" | "deprecated_field_used"
    description: string
    callerInfo: { file: string, language: string }
    endpointInfo: { file: string, language: string }
  }

  export interface ValidationReport {
    totalChecked: number
    validContracts: number
    breakingChanges: BreakingChange[]
    drifts: ContractDrift[]
    migrationGuides: Record<string, string> // caller file -> migration guide markdown
  }

  /**
   * Extracts unified contracts from both providers (endpoints) and consumers (callers)
   * This bridges the gap across 26 languages!
   */
  export function extractContracts(
    topology: CrossLanguageIntelligence.ServiceTopology,
    relationships: CrossLanguageIntelligence.CrossLanguageRelationship[],
    symbols: CrossLanguageIntelligence.CrossLanguageSymbol[]
  ): { endpoints: UnifiedContract[], callers: UnifiedContract[] } {
    
    log.info("🔍 Extracting God-Mode API Contracts from polyglot AST...")
    const endpoints: UnifiedContract[] = []
    const callers: UnifiedContract[] = []

    // 1. Extract from Topology Services (The Providers)
    for (const service of topology.services) {
      for (const ep of service.endpoints) {
        endpoints.push({
          id: `ep_${service.id}_${ep.method}_${ep.path}`,
          serviceId: service.id,
          path: ep.path,
          method: ep.method,
          source: "endpoint",
          language: ep.language,
          filePath: ep.filePath,
          inputSchema: normalizeSchema(ep.inputSchema),
          outputSchema: normalizeSchema(ep.outputSchema)
        })
      }
    }

    // 2. Extract from Cross-Language Relationships (The Callers)
    const apiCalls = relationships.filter(r => r.type === CrossLanguageIntelligence.CrossLanguageRelationType.APICall)
    
    for (const call of apiCalls) {
      // Find matching endpoint
      const meta = call.metadata as any
      const method = meta?.method || "GET"
      const path = meta?.path || call.target.context.accessPattern || "unknown"
      
      callers.push({
        id: `caller_${call.id}`,
        serviceId: "unknown", // Resolves during validation
        path: path,
        method: method,
        source: "caller",
        language: call.source.language,
        filePath: call.source.filePath,
        inputSchema: inferCallerInputSchema(call),
        outputSchema: inferCallerOutputSchema(call)
      })
    }

    log.info("✅ Extracted Unified Contracts", { endpointCount: endpoints.length, callerCount: callers.length })
    return { endpoints, callers }
  }

  /**
   * Compares caller constraints against endpoint schemas to find drift and breaking changes
   */
  export function validateContracts(
    endpoints: UnifiedContract[],
    callers: UnifiedContract[]
  ): ValidationReport {
    
    log.info("⚖️ Validating Cross-Language Contracts (Caller vs Endpoint)...")
    
    const report: ValidationReport = {
      totalChecked: callers.length,
      validContracts: 0,
      breakingChanges: [],
      drifts: [],
      migrationGuides: {}
    }

    let validCount = 0

    for (const caller of callers) {
      // Find matching endpoint (fuzzy match on path and method)
      const matchedEndpoint = endpoints.find(e => 
        e.method.toUpperCase() === caller.method.toUpperCase() && 
        isPathMatch(e.path, caller.path)
      )

      if (!matchedEndpoint) {
        // Only consider it a breaking change if it's an internal call we expected to resolve
        if (!caller.path.startsWith("http")) {
          report.drifts.push({
            id: `drift_unresolved_${caller.id}`,
            severity: "medium",
            type: "deprecated_field_used", // reusing as generic unresolved
            description: `API Call to ${caller.method} ${caller.path} cannot be resolved to any known internal endpoint.`,
            callerInfo: { file: caller.filePath, language: caller.language },
            endpointInfo: { file: "unknown", language: "unknown" }
          })
        }
        continue
      }

      let isClean = true
      
      // Check for missing required input fields (Breaking Change)
      for (const reqField of matchedEndpoint.inputSchema.filter(f => f.required)) {
        const callerProvides = caller.inputSchema.find(cf => cf.name === reqField.name)
        if (!callerProvides) {
          isClean = false
          report.breakingChanges.push({
            id: `break_req_field_${caller.id}_${reqField.name}`,
            severity: "high",
            type: "missing_required_field",
            description: `Endpoint requires field '${reqField.name}' (${reqField.type}) but caller does not provide it.`,
            callerInfo: { file: caller.filePath, language: caller.language },
            endpointInfo: { file: matchedEndpoint.filePath, language: matchedEndpoint.language },
            remediation: `Add '${reqField.name}: ${reqField.type}' to the payload in ${caller.filePath}`
          })
        } else if (callerProvides.type !== "unknown" && reqField.type !== "unknown" && callerProvides.type !== reqField.type) {
          isClean = false
          report.breakingChanges.push({
            id: `break_type_${caller.id}_${reqField.name}`,
            severity: "high",
            type: "type_mismatch",
            description: `Type mismatch on '${reqField.name}': Endpoint expects ${reqField.type}, Caller sends ${callerProvides.type}.`,
            callerInfo: { file: caller.filePath, language: caller.language },
            endpointInfo: { file: matchedEndpoint.filePath, language: matchedEndpoint.language },
            remediation: `Cast or convert '${reqField.name}' to ${reqField.type} before sending.`
          })
        }
      }

      // Check for caller sending unknown fields (Drift)
      for (const callerField of caller.inputSchema) {
        const endpointExpects = matchedEndpoint.inputSchema.find(ef => ef.name === callerField.name)
        if (!endpointExpects && callerField.name !== "unknown") {
          isClean = false
          report.drifts.push({
            id: `drift_unknown_${caller.id}_${callerField.name}`,
            severity: "low",
            type: "unknown_field_sent",
            description: `Caller sends field '${callerField.name}' which is not expected by the endpoint.`,
            callerInfo: { file: caller.filePath, language: caller.language },
            endpointInfo: { file: matchedEndpoint.filePath, language: matchedEndpoint.language }
          })
        }
      }

      // Check Output/Response Breaking Changes
      for (const callerExpects of caller.outputSchema) {
        if (callerExpects.name === "data" && caller.outputSchema.length === 1) continue // Skip generic wrapping
        const endpointProvides = matchedEndpoint.outputSchema.find(ef => ef.name === callerExpects.name)
        if (!endpointProvides) {
           isClean = false
           report.breakingChanges.push({
             id: `break_res_field_${caller.id}_${callerExpects.name}`,
             severity: "high",
             type: "response_format_changed",
             description: `Caller expects response field '${callerExpects.name}' but endpoint does not provide it.`,
             callerInfo: { file: caller.filePath, language: caller.language },
             endpointInfo: { file: matchedEndpoint.filePath, language: matchedEndpoint.language },
             remediation: `Endpoint must include '${callerExpects.name}' in its response, or Caller must remove its dependency.`
           })
        }
      }

      if (isClean) {
        validCount++
      } else {
        // Generate migration guide for this broken caller
        report.migrationGuides[caller.filePath] = generateGuideForCaller(caller, matchedEndpoint, report.breakingChanges, report.drifts)
      }
    }

    report.validContracts = validCount
    log.info(`📊 Validation Complete: ${validCount}/${callers.length} contracts are perfectly aligned across languages!`)

    return report
  }

  // --- INTERNAL UTILS ---

  function isPathMatch(epPath: string, callerPath: string): boolean {
    if (epPath === callerPath) return true
    
    // Convert express/fastapi style params (/users/:id or /users/{id}) to regex
    const epRegexStr = epPath
      .replace(/:[^\s/]+/g, '([^/]+)')
      .replace(/\{[^\s/]+\}/g, '([^/]+)')
    
    try {
      const epRegex = new RegExp(`^${epRegexStr}$`)
      return epRegex.test(callerPath) || epRegex.test(new URL(callerPath, 'http://localhost').pathname)
    } catch {
      return false
    }
  }

  function normalizeSchema(rawSchema: any): SchemaField[] {
    if (!rawSchema) return []
    // This handles JSON Schema, OpenAPI formats, or our AST extracted shapes
    const fields: SchemaField[] = []
    
    if (typeof rawSchema === 'object') {
      const props = rawSchema.properties || rawSchema
      for (const [key, value] of Object.entries(props)) {
        if (typeof value === 'object' && value !== null) {
          const v = value as any
          fields.push({
            name: key,
            type: v.type || typeof v,
            required: rawSchema.required?.includes(key) || v.required === true || false
          })
        } else {
          fields.push({
            name: key,
            type: typeof value,
            required: false
          })
        }
      }
    }
    return fields
  }

  function inferCallerInputSchema(call: CrossLanguageIntelligence.CrossLanguageRelationship): SchemaField[] {
    const fields: SchemaField[] = []
    const meta = call.metadata as any
    if (meta?.payload) {
      const props = Object.keys(meta.payload)
      for (const p of props) {
        fields.push({ name: p, type: typeof meta.payload[p] || "unknown", required: true })
      }
    }
    return fields
  }

  function inferCallerOutputSchema(call: CrossLanguageIntelligence.CrossLanguageRelationship): SchemaField[] {
    const fields: SchemaField[] = []
    const meta = call.metadata as any
    // Attempt to read expected response properties mapped in AST caller metadata
    if (meta?.expectedResponse) {
      const props = Object.keys(meta.expectedResponse)
      for (const p of props) {
        // We infer that if the caller expects a field, it's structurally required from their perspective
        fields.push({ name: p, type: typeof meta.expectedResponse[p] || "unknown", required: true })
      }
    } else if (meta?.responseType) {
       // If the AST engine populated a generic string like 'User[]' or 'object'
       fields.push({ name: "data", type: meta.responseType, required: true })
    }
    return fields 
  }

  function generateGuideForCaller(
    caller: UnifiedContract, 
    endpoint: UnifiedContract, 
    breaks: BreakingChange[], 
    drifts: ContractDrift[]
  ): string {
    const callerBreaks = breaks.filter(b => b.callerInfo.file === caller.filePath)
    const callerDrifts = drifts.filter(d => d.callerInfo.file === caller.filePath)
    
    let md = `## 🚨 API Contract Migration Guide: \`${caller.filePath}\`\n\n`
    md += `**Target Endpoint:** \`${endpoint.method} ${endpoint.path}\` (${endpoint.language})\n`
    md += `**Caller Language:** \`${caller.language}\`\n\n`

    if (callerBreaks.length > 0) {
      md += `### 💥 Breaking Changes to Fix\n`
      callerBreaks.forEach(b => {
        md += `- **[${b.type}]**: ${b.description}\n`
        md += `  - *Fix:* ${b.remediation}\n`
      })
      md += `\n`
    }

    if (callerDrifts.length > 0) {
      md += `### ⚠️ Contract Drift (Warnings)\n`
      callerDrifts.forEach(d => {
        md += `- **[${d.type}]**: ${d.description}\n`
      })
      md += `\n`
    }

    md += `### 📋 Endpoint's Expected Input Schema\n`
    md += `\`\`\`json\n{\n`
    endpoint.inputSchema.forEach(f => {
      md += `  "${f.name}": "${f.type}" ${f.required ? '// REQUIRED' : '// optional'}\n`
    })
    md += `}\n\`\`\`\n`

    return md
  }
}
