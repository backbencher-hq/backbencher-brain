declare module "web-tree-sitter" {
  export interface SyntaxNode {
    type: string
    isNamed: boolean
    text: string
    startPosition: { row: number; column: number }
    endPosition: { row: number; column: number }
    /**
     * Start of this node, as a UTF-16 CODE-UNIT offset into the source string.
     *
     * This is NOT a byte offset, which is the single most load-bearing fact in this file
     * and was previously unstated. Upstream tree-sitter reports BYTES, so code ported from
     * the C or Node API silently computes the wrong span on any source containing a
     * non-ASCII character. Measured on this build: for a file mixing 2-, 3- and 4-byte
     * characters, a node at byte 29 was reported as 28, at byte 57 as 54, at byte 87 as 82.
     *
     * The same applies to `startPosition.column` / `endPosition.column`.
     */
    startIndex: number
    /** End of this node, in UTF-16 code units. See `startIndex`. */
    endIndex: number
    childCount: number
    namedChildCount: number
    hasError: boolean
    isMissing: boolean
    hasChanges: boolean
    id: number
    grammarId: number
    parent: SyntaxNode | null
    children: SyntaxNode[]
    namedChildren: SyntaxNode[]
    nextSibling: SyntaxNode | null
    previousSibling: SyntaxNode | null
    nextNamedSibling: SyntaxNode | null
    previousNamedSibling: SyntaxNode | null
    firstChild: SyntaxNode | null
    lastChild: SyntaxNode | null
    firstNamedChild: SyntaxNode | null
    lastNamedChild: SyntaxNode | null
    descendantForIndex(start: number, end?: number): SyntaxNode
    descendantForPosition(start: any, end?: any): SyntaxNode
    namedDescendantForIndex(start: number, end?: number): SyntaxNode
    namedDescendantForPosition(start: any, end?: any): SyntaxNode
    childForFieldName(fieldName: string): SyntaxNode | null
    child(index: number): SyntaxNode | null
    namedChild(index: number): SyntaxNode | null
    fieldIdForName(name: string): number | null
    fieldNameForChild(index: number): string | null
    childByFieldName(name: string): SyntaxNode | null
    toString(): string
    walk(): TreeCursor
    toJSON(): any
    edit(options: any): void
  }

  export interface Tree {
    rootNode: SyntaxNode
    rootTextNode: string
    walk(): TreeCursor
    edit(delta: any): Tree
    getChangedRanges(other: Tree): any[]
    getIncludedRanges(): any[]
  }

  export interface TreeCursor {
    currentNode: SyntaxNode
    currentFieldName: string | null
    currentFieldId: number | null
    currentDepth: number
    gotoFirstChild(): boolean
    gotoNextSibling(): boolean
    gotoParent(): boolean
    gotoLastChild(): boolean
    gotoFirstChildForIndex(index: number): number
    gotoFirstChildForPosition(position: any): number
    reset(node: SyntaxNode): void
    resetToRange(startIndex: number, endIndex: number): void
    close(): void
  }

  export interface Language {
    query(source: string): Query
    nodeId: number
  }

  export interface Query {
    matches(node: SyntaxNode): any[]
    captures(node: SyntaxNode): any[]
    predicates: any[]
    setProperties(match: any): void
    disableCapture(name: string): void
    isCaptureEnabled(name: string): boolean
  }

  export interface Parser {
    setLanguage(language: Language): Promise<void>
    parse(input: any, oldTree?: Tree | null, options?: any): Tree
    getLanguage(): Language | null
    resetEnabledCaptures(): void
    delete(): void
  }

  export interface QueryMatch {
    patternIndex: number
    captures: QueryCapture[]
    setProperties: any
  }

  export interface QueryCapture {
    name: string
    node: SyntaxNode
  }

  export const Language: {
    load(url: string | URL): Promise<Language>
    fromBytes(bytes: Uint8Array, name?: string): Promise<Language>
  }

  export const Parser: {
    new (): Parser
  }

  export function Query(language: Language, source: string): Query

  // Backward compatibility: alias Node to SyntaxNode
  export type Node = SyntaxNode

  export function init(): Promise<void>
  export function configure(options: any): void
}

declare module "web-tree-sitter/tree-sitter.wasm" {
  const content: string
  export default content
}

// For other .wasm imports
declare module "*.wasm" {
  const content: string | Uint8Array
  export default content
}
