import { ASTEngine } from "./engine"
import * as fs from "fs"
import { getExecDir } from "../util/exec-dir"
import * as path from "path"
import { loadWebTreeSitter, resolveWasmAsset } from "../util/wasm"

export interface ASTTargetResult {
  startIndex: number
  endIndex: number
  node?: any
}

export interface TargetingOptions {
  astQuery?: string
  targetNodePath?: string
  oldContent?: string
  occurrenceIndex?: number
}

export class ASTTargetingEngine {
  static async resolveTarget(
    absolutePath: string,
    baseByteStart: number,
    baseByteEnd: number,
    options: TargetingOptions,
  ): Promise<ASTTargetResult> {
    let finalStart = baseByteStart
    let finalEnd = baseByteEnd
    let targetNode: any = null

    if (options.astQuery) {
      const result = await this.resolveAstQuery(absolutePath, baseByteStart, baseByteEnd, options.astQuery)
      finalStart = result.startIndex
      finalEnd = result.endIndex
      targetNode = result.node
    } else if (options.targetNodePath) {
      const result = await this.resolveTargetNodePath(absolutePath, baseByteStart, baseByteEnd, options.targetNodePath)
      finalStart = result.startIndex
      finalEnd = result.endIndex
      targetNode = result.node
    } else if (options.oldContent) {
      const result = this.resolveOldContent(
        absolutePath,
        baseByteStart,
        baseByteEnd,
        options.oldContent,
        options.occurrenceIndex || 1,
      )
      finalStart = result.startIndex
      finalEnd = result.endIndex
    }

    return { startIndex: finalStart, endIndex: finalEnd, node: targetNode }
  }

  private static async resolveAstQuery(
    absolutePath: string,
    baseByteStart: number,
    baseByteEnd: number,
    astQuery: string,
  ): Promise<ASTTargetResult> {
    const lang = ASTEngine.detectLanguage(absolutePath)
    if (!lang) {
      throw new Error("Language not supported for AST traversal")
    }

    const parser = await ASTEngine.getParser(lang)
    const fullContent = fs.readFileSync(absolutePath, "utf8")
    const tree = parser.parse(fullContent)

    if (!tree) {
      throw new Error("Failed to parse file AST")
    }

    const siblingWasm = getExecDir() + "/tree-sitter.wasm"

    // Try sibling files first (bundled with binary), fall back to standard resolution
    let WebTreeSitter: any
    try {
      WebTreeSitter = await loadWebTreeSitter()
    } catch (e) {
      // Fallback: try common paths
      const execDir = getExecDir()
      const possiblePaths = [
        path.join(execDir, "node_modules", "web-tree-sitter", "tree-sitter.js"),
        path.join(execDir, "..", "node_modules", "web-tree-sitter", "tree-sitter.js"),
        path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.js"),
      ]
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          WebTreeSitter = await import(`file://${p}`)
          break
        }
      }
      if (!WebTreeSitter) {
        throw new Error(`web-tree-sitter not found. Tried: ${possiblePaths.join(", ")}`)
      }
    }

    const Language =
      WebTreeSitter.Language ||
      (WebTreeSitter.Parser && WebTreeSitter.Parser.Language) ||
      WebTreeSitter.default?.Language

    const languageGrammar = (parser as any).getLanguage()
    const query = languageGrammar.query(astQuery)
    const matches = query.matches(tree.rootNode)

    for (const match of matches) {
      for (const capture of match.captures) {
        if (capture.name === "target") {
          if (capture.node.startIndex >= baseByteStart && capture.node.endIndex <= baseByteEnd) {
            return {
              startIndex: capture.node.startIndex,
              endIndex: capture.node.endIndex,
              node: capture.node,
            }
          }
        }
      }
    }

    throw new Error(`No match found for astQuery '${astQuery}' with capture @target inside bounds`)
  }

  private static async resolveTargetNodePath(
    absolutePath: string,
    baseByteStart: number,
    baseByteEnd: number,
    targetNodePath: string,
  ): Promise<ASTTargetResult> {
    const lang = ASTEngine.detectLanguage(absolutePath)
    if (!lang) {
      throw new Error("Language not supported for AST traversal")
    }

    const parser = await ASTEngine.getParser(lang)
    const fullContent = fs.readFileSync(absolutePath, "utf8")
    const tree = parser.parse(fullContent)

    if (!tree) {
      throw new Error("Failed to parse file AST")
    }

    const baseNode = tree.rootNode.descendantForIndex(baseByteStart, baseByteEnd - 1)

    if (!baseNode) {
      throw new Error("Target symbol bounds not found in AST")
    }

    const normalizeType = (t: string) => t.replace(/_/g, "").toLowerCase()
    const parts = targetNodePath.split(">").map((s: string) => s.trim())
    let currentNode = baseNode

    for (let i = 0; i < parts.length; i++) {
      if (!currentNode) {
        throw new Error("Traversed into null node")
      }

      const part = parts[i]
      let nodeType = part
      let index = 0

      const match = part.match(/([^\[]+)(?:\[(\d+)\])?/)
      if (match) {
        nodeType = normalizeType(match[1])
        index = match[2] ? parseInt(match[2], 10) : 0
      } else {
        nodeType = normalizeType(nodeType)
      }

      if (i === 0 && normalizeType(currentNode.type) === nodeType && index === 0) {
        continue
      }

      const children: any[] = []
      for (let j = 0; j < currentNode.namedChildCount; j++) {
        const child = currentNode.namedChild(j)
        if (child && normalizeType(child.type) === nodeType) {
          children.push(child)
        }
      }

      if (index >= children.length) {
        throw new Error(`Node ${part} not found inside ${currentNode.type}. Found ${children.length} matches.`)
      }

      currentNode = children[index]
    }

    if (!currentNode) {
      throw new Error("Target node path resolved to null")
    }

    return {
      startIndex: currentNode.startIndex,
      endIndex: currentNode.endIndex,
      node: currentNode,
    }
  }

  private static resolveOldContent(
    absolutePath: string,
    baseByteStart: number,
    baseByteEnd: number,
    oldContent: string,
    occurrenceIndex: number,
  ): ASTTargetResult {
    const fullContent = fs.readFileSync(absolutePath, "utf8")
    const symbolContent = fullContent.substring(baseByteStart, baseByteEnd)

    let subIndex = -1
    let matchLength = oldContent.length
    let currentIndex = -1
    let occurrenceCount = 0

    while ((currentIndex = symbolContent.indexOf(oldContent, currentIndex + 1)) !== -1) {
      occurrenceCount++
      if (occurrenceCount === occurrenceIndex) {
        subIndex = currentIndex
        break
      }
    }

    if (subIndex === -1) {
      const normalize = (s: string) => s.replace(/\s+/g, "")
      const normOld = normalize(oldContent)
      let currentNorm = ""
      let startMatch = -1
      let wsOccurrenceCount = 0

      for (let i = 0; i < symbolContent.length; i++) {
        if (!/\s/.test(symbolContent[i])) {
          if (currentNorm === "") startMatch = i
          currentNorm += symbolContent[i]

          if (currentNorm === normOld) {
            wsOccurrenceCount++
            if (wsOccurrenceCount === occurrenceIndex) {
              subIndex = startMatch
              matchLength = i - startMatch + 1
              break
            }
            i = startMatch
            currentNorm = ""
            startMatch = -1
          } else if (!normOld.startsWith(currentNorm)) {
            i = startMatch
            currentNorm = ""
            startMatch = -1
          }
        }
      }
    }

    if (subIndex === -1) {
      throw new Error("oldContent not found inside symbol bounds")
    }

    return {
      startIndex: baseByteStart + subIndex,
      endIndex: baseByteStart + subIndex + matchLength,
    }
  }

  static async resolveAnchorNode(
    absolutePath: string,
    baseByteStart: number,
    baseByteEnd: number,
    astQuery?: string,
  ): Promise<any> {
    const lang = ASTEngine.detectLanguage(absolutePath)
    if (!lang) {
      throw new Error("Language not supported for AST traversal")
    }

    const parser = await ASTEngine.getParser(lang)
    const fullContent = fs.readFileSync(absolutePath, "utf8")
    const tree = parser.parse(fullContent)

    let anchorNode: any = null

    if (astQuery) {
      let WebTreeSitter: any
      const execDir = getExecDir()
      const siblingJs = `${execDir}/tree-sitter.js`

      if (fs.existsSync(siblingJs)) {
        WebTreeSitter = await import(`file://${siblingJs}`)
      } else {
        WebTreeSitter = await import("web-tree-sitter")
      }

      const Language =
        WebTreeSitter.Language ||
        (WebTreeSitter.Parser && WebTreeSitter.Parser.Language) ||
        WebTreeSitter.default?.Language

      const languageGrammar = (parser as any).getLanguage()
      const query = languageGrammar.query(astQuery)
      const matches = query.matches(tree?.rootNode)

      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === "target") {
            if (capture.node.startIndex >= baseByteStart && capture.node.endIndex <= baseByteEnd) {
              anchorNode = capture.node
              break
            }
          }
        }
        if (anchorNode) break
      }
    } else {
      anchorNode = tree?.rootNode.descendantForIndex(baseByteStart, baseByteEnd - 1)
    }

    return anchorNode
  }

  static findBodyNode(anchorNode: any): any {
    let bodyNode = anchorNode
    for (let i = 0; i < anchorNode.namedChildCount; i++) {
      const child = anchorNode.namedChild(i)
      if (child && (child.type === "statement_block" || child.type === "block" || child.type === "class_body")) {
        bodyNode = child
        break
      }
    }
    return bodyNode
  }
}
