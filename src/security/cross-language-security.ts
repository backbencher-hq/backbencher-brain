export interface CrossLanguageSecurityFindings {
  findings: any[]
  cross_language_vulnerabilities?: any[]
  summary?: any
}
export namespace CrossLanguageSecurityAnalysis {
  export async function analyze(projectId: string): Promise<CrossLanguageSecurityFindings> {
    return { findings: [], cross_language_vulnerabilities: [] }
  }
  export async function analyzeSecurityAcrossLanguages(projectId: string, _opts?: any): Promise<CrossLanguageSecurityFindings> {
    return { findings: [], cross_language_vulnerabilities: [] }
  }
}
