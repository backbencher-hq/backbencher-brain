import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

/**
 * 4 LAWS COMPLIANT REAL HCL / TERRAFORM ANALYZER
 * 1. Flawless Database Extraction (UniversalSymbol, UniversalRelationship)
 * 2. Absolute Zero WASM-Bridge Arrays (O(D) Space using namedChild)
 * 3. Big-O Time Complexity Ceiling (O(N) Iterative DFS)
 * 4. 100% Stateless Thread Safety (No class-level mutable properties)
 */
export class RealHclAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    // O(N) Iterative DFS Stack
    const walkStack: { node: Node; scopePath: string[] }[] = [{ node: rootNode, scopePath: [] }]

    while (walkStack.length > 0) {
      const { node, scopePath } = walkStack.pop()!
      const type = node.type

      let currentScope = [...scopePath]

      // Terraform Blocks (e.g. resource, data, module, variable, output, provider)
      if (type === "block") {
        let blockType = ""
        const labels: string[] = []

        // HCL blocks have identifiers (block type) and strings or identifiers (labels)
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (!child) continue
          if (child.type === "identifier" && !blockType) {
            blockType = child.text
          } else if (child.type === "string_lit" || child.type === "identifier") {
            // Usually the string_lit contains the label inside quotes, strip them if it's a string_lit
            let labelText = child.text
            if (child.type === "string_lit") {
              labelText = labelText.replace(/^"|"$/g, "")
            }
            if (labelText) labels.push(labelText)
          }
        }

        if (blockType) {
          // Name blocks by their semantic identity rather than blockType prefix:
          //   variable "region"      -> region
          //   output "vpc_id"        -> vpc_id
          //   provider "aws"         -> aws
          //   module "database"      -> database
          //   resource "aws_vpc" "main" -> aws_vpc_main  (type_instance)
          //   data "aws_ami" "ubuntu"   -> aws_ami_ubuntu
          //   terraform / locals / nested blocks -> blockType itself
          const blockName = labels.length > 0 ? labels.join("_") : blockType

          let kind = ASTEngine.SymbolKind.Class
          if (
            blockType === "module" ||
            blockType === "provider" ||
            blockType === "terraform" ||
            blockType === "locals"
          )
            kind = ASTEngine.SymbolKind.Module
          else if (blockType === "variable" || blockType === "output") kind = ASTEngine.SymbolKind.Variable
          // data sources behave like resources (they produce values), so data
          // blocks get the same Class treatment as resource blocks.

          const blockSymbol: ASTEngine.UniversalSymbol = {
            name: blockName,
            kind: kind,
            range: {
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              startColumn: node.startPosition.column,
              endColumn: node.endPosition.column,
              startIndex: node.startIndex,
              endIndex: node.endIndex,
            },
            scope: currentScope.join("."),
            metadata: {
              hclBlockType: blockType,
              hclLabels: labels,
            },
          }
          symbols.push(blockSymbol)
          currentScope.push(blockName)

          // Modules are essentially import statements — add DependsOn
          if (blockType === "module") {
            imports.push({
              module: labels[0] || "unknown",
              range: blockSymbol.range,
            })
            relationships.push({
              source: "terraform",
              target: labels[0] || "unknown",
              type: ASTEngine.RelationshipType.References,
              confidence: 0.9,
              metadata: { isModuleDep: true },
            })
          }
          // Providers are also dependencies
          if (blockType === "provider") {
            relationships.push({
              source: "terraform",
              target: labels[0] || "unknown",
              type: ASTEngine.RelationshipType.References,
              confidence: 0.9,
              metadata: { isProviderDep: true },
            })
          }
        }
      }

      // Terraform Attributes
      if (type === "template_expr" || type === "template_interpolation" || type === "string_lit") {
        const val = node.text;
        const refs = val.match(/\$\{([^}]+)\}/g);
        if (refs && currentScope.length > 0) {
          for (let i = 0; i < refs.length; i++) {
            const refName = refs[i].replace(/\$\{|\}/g, "").split(".")[0]
            if (refName) {
              relationships.push({
                source: currentScope[currentScope.length - 1],
                target: refName,
                type: ASTEngine.RelationshipType.Uses,
                metadata: { isVariableRef: true },
              })
            }
          }
        }
      } else if (type === "attribute") {
        const keyNode = this.findChild(node, (n) => n.type === "identifier")
        if (keyNode) {
          const attrSymbol: ASTEngine.UniversalSymbol = {
            name: keyNode.text,
            kind: ASTEngine.SymbolKind.Property,
            range: {
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              startColumn: node.startPosition.column,
              endColumn: node.endPosition.column,
              startIndex: node.startIndex,
              endIndex: node.endIndex,
            },
            scope: currentScope.join("."),
            metadata: {},
          }
          symbols.push(attrSymbol)

          if (currentScope.length > 0) {
            relationships.push({
              source: currentScope[currentScope.length - 1],
              target: keyNode.text,
              type: ASTEngine.RelationshipType.Contains,
              metadata: {},
            })
          }
        }
      }

      // Catch parsing errors
      const isErr = node.hasError
      if (type === "ERROR" || isErr) {
        errors.push({
          message: `HCL/Terraform Syntax Error at ${node.startPosition.row + 1}:${node.startPosition.column}`,
          range: {
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startColumn: node.startPosition.column,
            endColumn: node.endPosition.column,
          },
          severity: "error",
        })
      }

      // O(D) arrays. Absolute zero WASM arrays (.children). Pushing in reverse for normal DFS.
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
          walkStack.push({ node: child, scopePath: currentScope })
        }
      }
    }

    for (let i = 0; i < symbols.length; i++) {
      exports.push({ name: symbols[i].name, kind: symbols[i].kind, range: symbols[i].range, visibility: "public" })
    }
    return {
      language: "hcl",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: symbols.length,
        linesOfCode: content.split("\n").length,
        patterns: [],
        framework: "HCL/Terraform",
        hasFrameworkIntelligence: true,
        hasTypeInference: false,
      },
    }
  }

  // Pure function cursor helper
  private findChild(node: Node, predicate: (n: Node) => boolean): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && predicate(child)) {
        return child
      }
    }
    return null
  }
}
