// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
import * as Log from "../tool/brain-log.js"
import { APIContractValidator } from "./api-contract-validator.js"

const log = Log.create({ service: "cross-language-code-generator" })

export namespace CrossLanguageCodeGenerator {
  
  export interface GeneratedCode {
    targetLanguage: string
    clientCode: string
    typesCode: string
    authCode?: string
    testCode?: string
    instructions: string
  }

  export interface GeneratorOptions {
    includeAuth: boolean
    includeTests: boolean
    authType?: "bearer" | "basic" | "api_key"
  }

  /**
   * God-Mode Polyglot Code Generator
   * Dynamically generates type-safe cross-language glue code, bridging API boundaries automatically.
   */
  export async function generateAPIClient(
    endpoint: APIContractValidator.UnifiedContract,
    targetLanguage: string,
    options: GeneratorOptions = { includeAuth: true, includeTests: true, authType: "bearer" }
  ): Promise<GeneratedCode> {
    log.info(`🤖 Generating ${targetLanguage} API Client for endpoint: ${endpoint.method} ${endpoint.path}`)

    const normalizedLang = targetLanguage.toLowerCase()
    
    // We determine the name based on the path
    const resourceName = parseResourceName(endpoint.path)
    const className = `${resourceName}Client`

    let typesCode = ""
    let clientCode = ""
    let authCode = ""
    let testCode = ""

    switch (normalizedLang) {
      case "typescript":
      case "ts":
        typesCode = generateTypeScriptTypes(endpoint, resourceName)
        clientCode = generateTypeScriptClient(endpoint, className, resourceName, options)
        if (options.includeAuth) authCode = generateTypeScriptAuth(options.authType)
        if (options.includeTests) testCode = generateTypeScriptTests(endpoint, className, resourceName)
        break
      case "python":
      case "py":
        typesCode = generatePythonTypes(endpoint, resourceName)
        clientCode = generatePythonClient(endpoint, className, resourceName, options)
        if (options.includeAuth) authCode = generatePythonAuth(options.authType)
        if (options.includeTests) testCode = generatePythonTests(endpoint, className, resourceName)
        break
      case "go":
        typesCode = generateGoTypes(endpoint, resourceName)
        clientCode = generateGoClient(endpoint, className, resourceName, options)
        if (options.includeAuth) authCode = generateGoAuth(options.authType)
        if (options.includeTests) testCode = generateGoTests(endpoint, className, resourceName)
        break
      default:
        log.warn(`⚠️ Language ${targetLanguage} not natively supported for God-Mode generation yet. Falling back to generic cURL generation.`)
        clientCode = generateCurlClient(endpoint, options)
        typesCode = `// Types not supported for ${targetLanguage}`
        break
    }

    log.info(`✅ Successfully generated ${targetLanguage} client for ${resourceName}`)

    return {
      targetLanguage,
      clientCode,
      typesCode,
      authCode: options.includeAuth ? authCode : undefined,
      testCode: options.includeTests ? testCode : undefined,
      instructions: `Generated type-safe client for ${endpoint.method} ${endpoint.path}. Integrate the Types and Client classes into your ${targetLanguage} codebase.`
    }
  }

  // --- INTERNAL GENERATORS: TYPESCRIPT ---

  function generateTypeScriptTypes(endpoint: APIContractValidator.UnifiedContract, resourceName: string): string {
    let out = `export interface ${resourceName}Request {\n`
    endpoint.inputSchema.forEach(f => {
      out += `  ${f.name}${f.required ? "" : "?"}: ${mapToTSType(f.type)};\n`
    })
    out += `}\n\n`

    out += `export interface ${resourceName}Response {\n`
    if (endpoint.outputSchema.length === 0) {
      out += `  [key: string]: any;\n`
    } else {
      endpoint.outputSchema.forEach(f => {
        out += `  ${f.name}${f.required ? "" : "?"}: ${mapToTSType(f.type)};\n`
      })
    }
    out += `}\n`
    return out
  }

  function generateTypeScriptClient(endpoint: APIContractValidator.UnifiedContract, className: string, resourceName: string, options: GeneratorOptions): string {
    const hasInput = endpoint.inputSchema.length > 0
    
    let out = `export class ${className} {\n`
    out += `  constructor(private baseUrl: string${options.includeAuth ? ', private token?: string' : ''}) {}\n\n`
    
    out += `  async execute(`
    if (hasInput) out += `payload: ${resourceName}Request`
    out += `): Promise<${resourceName}Response> {\n`
    
    out += `    const headers: Record<string, string> = { 'Content-Type': 'application/json' };\n`
    if (options.includeAuth) {
      out += `    if (this.token) {\n`
      out += `      headers['Authorization'] = \`${options.authType === 'bearer' ? 'Bearer' : 'Basic'} \${this.token}\`;\n`
      out += `    }\n`
    }
    
    out += `\n    const response = await fetch(\`\${this.baseUrl}${endpoint.path}\`, {\n`
    out += `      method: '${endpoint.method.toUpperCase()}',\n`
    out += `      headers,\n`
    if (endpoint.method.toUpperCase() !== 'GET' && hasInput) {
      out += `      body: JSON.stringify(payload),\n`
    }
    out += `    });\n\n`
    
    out += `    if (!response.ok) {\n`
    out += `      throw new Error(\`${className} failed: \${response.statusText}\`);\n`
    out += `    }\n`
    out += `    return response.json();\n`
    out += `  }\n`
    out += `}\n`
    
    return out
  }

  function generateTypeScriptAuth(authType?: string): string {
    return `// Inject this token provider into your DI container or store\nexport const getToken = () => localStorage.getItem('access_token');\n`
  }

  function generateTypeScriptTests(endpoint: APIContractValidator.UnifiedContract, className: string, resourceName: string): string {
    return `import { ${className} } from './client';\n\n` +
           `describe('${className}', () => {\n` +
           `  it('should call ${endpoint.path} successfully', async () => {\n` +
           `    const client = new ${className}('http://localhost:3000', 'mock-token');\n` +
           `    // TODO: Mock global.fetch here\n` +
           `    // const res = await client.execute({...});\n` +
           `    // expect(res).toBeDefined();\n` +
           `  });\n` +
           `});\n`
  }

  // --- INTERNAL GENERATORS: PYTHON ---
  
  function generatePythonTypes(endpoint: APIContractValidator.UnifiedContract, resourceName: string): string {
    let out = `from typing import TypedDict, Any, Optional\n\n`
    
    out += `class ${resourceName}Request(TypedDict, total=False):\n`
    if (endpoint.inputSchema.length === 0) out += `    pass\n`
    endpoint.inputSchema.forEach(f => {
      out += `    ${f.name}: ${mapToPythonType(f.type)}\n`
    })
    out += `\n`

    out += `class ${resourceName}Response(TypedDict, total=False):\n`
    if (endpoint.outputSchema.length === 0) {
      out += `    pass\n`
    } else {
      endpoint.outputSchema.forEach(f => {
        out += `    ${f.name}: ${mapToPythonType(f.type)}\n`
      })
    }
    return out
  }

  function generatePythonClient(endpoint: APIContractValidator.UnifiedContract, className: string, resourceName: string, options: GeneratorOptions): string {
    const hasInput = endpoint.inputSchema.length > 0
    let out = `import requests\n\n`
    out += `class ${className}:\n`
    out += `    def __init__(self, base_url: str${options.includeAuth ? ', token: Optional[str] = None' : ''}):\n`
    out += `        self.base_url = base_url\n`
    if (options.includeAuth) out += `        self.token = token\n`
    out += `\n`
    
    out += `    def execute(self${hasInput ? `, payload: ${resourceName}Request` : ''}) -> ${resourceName}Response:\n`
    out += `        headers = {'Content-Type': 'application/json'}\n`
    if (options.includeAuth) {
      out += `        if self.token:\n`
      out += `            headers['Authorization'] = f'${options.authType === 'bearer' ? 'Bearer' : 'Basic'} {self.token}'\n`
    }
    
    out += `        url = f"{self.base_url}${endpoint.path}"\n`
    if (endpoint.method.toUpperCase() === 'GET') {
      out += `        response = requests.get(url, headers=headers${hasInput ? ', params=payload' : ''})\n`
    } else {
      out += `        response = requests.${endpoint.method.toLowerCase()}(url, headers=headers${hasInput ? ', json=payload' : ''})\n`
    }
    out += `        response.raise_for_status()\n`
    out += `        return response.json()\n`
    return out
  }

  function generatePythonAuth(authType?: string): string {
    return `# Setup auth dependencies\ndef get_token() -> str:\n    import os\n    return os.environ.get('API_TOKEN', '')\n`
  }

  function generatePythonTests(endpoint: APIContractValidator.UnifiedContract, className: string, resourceName: string): string {
    return `import unittest\nfrom unittest.mock import patch\n\n` +
           `class Test${className}(unittest.TestCase):\n` +
           `    @patch('requests.${endpoint.method.toLowerCase()}' if '${endpoint.method.toLowerCase()}' != 'get' else 'requests.get')\n` +
           `    def test_execute(self, mock_req):\n` +
           `        mock_req.return_value.status_code = 200\n` +
           `        mock_req.return_value.json.return_value = {}\n` +
           `        # client = ${className}('http://test')\n` +
           `        # client.execute(...)\n`
  }

  // --- INTERNAL GENERATORS: GO ---
  
  function generateGoTypes(endpoint: APIContractValidator.UnifiedContract, resourceName: string): string {
    let out = `package client\n\n`
    out += `type ${resourceName}Request struct {\n`
    endpoint.inputSchema.forEach(f => {
      out += `\t${capitalize(f.name)} ${mapToGoType(f.type)} \`json:"${f.name}${f.required ? "" : ",omitempty"}"\`\n`
    })
    out += `}\n\n`

    out += `type ${resourceName}Response struct {\n`
    if (endpoint.outputSchema.length === 0) {
      // empty
    } else {
      endpoint.outputSchema.forEach(f => {
        out += `\t${capitalize(f.name)} ${mapToGoType(f.type)} \`json:"${f.name}${f.required ? "" : ",omitempty"}"\`\n`
      })
    }
    out += `}\n`
    return out
  }

  function generateGoClient(endpoint: APIContractValidator.UnifiedContract, className: string, resourceName: string, options: GeneratorOptions): string {
    const hasInput = endpoint.inputSchema.length > 0
    let out = `import (\n\t"bytes"\n\t"encoding/json"\n\t"net/http"\n\t"fmt"\n)\n\n`
    
    out += `type ${className} struct {\n`
    out += `\tBaseURL string\n`
    if (options.includeAuth) out += `\tToken   string\n`
    out += `}\n\n`
    
    out += `func (c *${className}) Execute(`
    if (hasInput) out += `payload *${resourceName}Request`
    out += `) (*${resourceName}Response, error) {\n`
    
    if (endpoint.method.toUpperCase() !== 'GET' && hasInput) {
      out += `\tbody, err := json.Marshal(payload)\n`
      out += `\tif err != nil { return nil, err }\n`
      out += `\treq, err := http.NewRequest("${endpoint.method.toUpperCase()}", c.BaseURL+"${endpoint.path}", bytes.NewBuffer(body))\n`
    } else {
      out += `\treq, err := http.NewRequest("${endpoint.method.toUpperCase()}", c.BaseURL+"${endpoint.path}", nil)\n`
    }
    
    out += `\tif err != nil { return nil, err }\n`
    out += `\treq.Header.Set("Content-Type", "application/json")\n`
    if (options.includeAuth) {
      out += `\tif c.Token != "" {\n`
      out += `\t\treq.Header.Set("Authorization", "${options.authType === 'bearer' ? 'Bearer' : 'Basic'} "+c.Token)\n`
      out += `\t}\n`
    }
    
    out += `\n\tclient := &http.Client{}\n`
    out += `\tresp, err := client.Do(req)\n`
    out += `\tif err != nil { return nil, err }\n`
    out += `\tdefer resp.Body.Close()\n\n`
    
    out += `\tif resp.StatusCode < 200 || resp.StatusCode >= 300 {\n`
    out += `\t\treturn nil, fmt.Errorf("API failed with status %d", resp.StatusCode)\n`
    out += `\t}\n\n`
    
    out += `\tvar res ${resourceName}Response\n`
    out += `\tif err := json.NewDecoder(resp.Body).Decode(&res); err != nil {\n`
    out += `\t\treturn nil, err\n`
    out += `\t}\n`
    out += `\treturn &res, nil\n`
    out += `}\n`
    
    return out
  }

  function generateGoAuth(authType?: string): string {
    return `// Auth injected directly into struct\n`
  }

  function generateGoTests(endpoint: APIContractValidator.UnifiedContract, className: string, resourceName: string): string {
    return `package client\n\nimport "testing"\n\n` +
           `func Test${className}(t *testing.T) {\n` +
           `\t// c := &${className}{BaseURL: "http://localhost"}\n` +
           `\t// _, err := c.Execute(...)\n` +
           `}\n`
  }

  // --- FALLBACK ---
  function generateCurlClient(endpoint: APIContractValidator.UnifiedContract, options: GeneratorOptions): string {
    let out = `curl -X ${endpoint.method.toUpperCase()} "${endpoint.path}" \\\n`
    out += `  -H "Content-Type: application/json" \\\n`
    if (options.includeAuth) {
      out += `  -H "Authorization: ${options.authType === 'bearer' ? 'Bearer' : 'Basic'} <TOKEN>" \\\n`
    }
    if (endpoint.inputSchema.length > 0 && endpoint.method.toUpperCase() !== 'GET') {
      out += `  -d '{"example": "payload"}'`
    }
    return out
  }

  // --- UTILS ---

  function parseResourceName(path: string): string {
    const parts = path.split('/').filter(p => p.length > 0 && !p.startsWith(':') && !p.startsWith('{'))
    if (parts.length === 0) return "Root"
    const last = parts[parts.length - 1]
    return capitalize(last.replace(/[^a-zA-Z0-9]/g, ''))
  }

  function capitalize(s: string): string {
    if (!s) return ""
    return s.charAt(0).toUpperCase() + s.slice(1)
  }

  function mapToTSType(astType: string): string {
    const t = astType.toLowerCase()
    if (t.includes("int") || t.includes("float") || t.includes("num")) return "number"
    if (t.includes("bool")) return "boolean"
    if (t.includes("array") || t.includes("list")) return "any[]"
    if (t.includes("dict") || t.includes("map") || t.includes("obj")) return "Record<string, any>"
    return "string"
  }

  function mapToPythonType(astType: string): string {
    const t = astType.toLowerCase()
    if (t.includes("int")) return "int"
    if (t.includes("float") || t.includes("num")) return "float"
    if (t.includes("bool")) return "bool"
    if (t.includes("array") || t.includes("list")) return "list"
    if (t.includes("dict") || t.includes("map") || t.includes("obj")) return "dict"
    return "str"
  }

  function mapToGoType(astType: string): string {
    const t = astType.toLowerCase()
    if (t.includes("int")) return "int"
    if (t.includes("float") || t.includes("num")) return "float64"
    if (t.includes("bool")) return "bool"
    if (t.includes("array") || t.includes("list")) return "[]interface{}"
    if (t.includes("dict") || t.includes("map") || t.includes("obj")) return "map[string]interface{}"
    return "string"
  }
}
