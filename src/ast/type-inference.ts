// Advanced Type Inference and Flow Analysis Engine
// Sophisticated type tracking across assignments, method calls, generics, and control flow

import { ASTEngine } from "./engine"
import type { Node } from "web-tree-sitter"

export namespace TypeInference {

  // Universal type system that works across all programming languages
  export interface TypeInfo {
    name: string
    kind: TypeKind
    genericArgs?: TypeInfo[]
    nullable?: boolean
    unionTypes?: TypeInfo[]
    properties?: Map<string, TypeInfo>
    methods?: Map<string, MethodSignature>
    superTypes?: TypeInfo[]
    moduleOrigin?: string
    confidence: number // 0.0 to 1.0
    inferredAt: InferenceLocation[]
  }

  export enum TypeKind {
    Primitive = "primitive",
    Class = "class",
    Interface = "interface",
    Enum = "enum",
    Function = "function",
    Array = "array",
    Object = "object",
    Generic = "generic",
    Union = "union",
    Intersection = "intersection",
    Tuple = "tuple",
    Literal = "literal",
    Unknown = "unknown",
    Any = "any",
    Void = "void"
  }

  export interface MethodSignature {
    parameters: TypeInfo[]
    returnType: TypeInfo
    isStatic?: boolean
    isAsync?: boolean
    genericParams?: string[]
  }

  export interface InferenceLocation {
    filePath: string
    range: ASTEngine.UniversalSymbol["range"]
    reason: InferenceReason
  }

  export enum InferenceReason {
    Declaration = "declaration",
    Assignment = "assignment",
    FunctionCall = "function_call",
    MethodCall = "method_call",
    ControlFlow = "control_flow",
    GenericInstantiation = "generic_instantiation",
    TypeAssertion = "type_assertion",
    Destructuring = "destructuring",
    Import = "import"
  }

  // Type inference context that tracks variables and their types through program flow
  export class InferenceContext {
    private variableTypes = new Map<string, TypeInfo>()
    private functionTypes = new Map<string, MethodSignature>()
    private classTypes = new Map<string, TypeInfo>()
    private scopeStack: string[] = []
    private language: string
    private filePath: string

    constructor(language: string, filePath: string) {
      this.language = language
      this.filePath = filePath
      this.initializeBuiltinTypes()
    }

    private initializeBuiltinTypes() {
      // Initialize language-specific builtin types
      switch (this.language) {
        case "typescript":
        case "javascript":
          this.initializeJavaScriptTypes()
          break
        case "python":
          this.initializePythonTypes()
          break
        case "java":
          this.initializeJavaTypes()
          break
        case "rust":
          this.initializeRustTypes()
          break
        case "cpp":
          this.initializeCppTypes()
          break
        case "csharp":
          this.initializeCSharpTypes()
          break
        default:
          this.initializeGenericTypes()
      }
    }

    private initializeJavaScriptTypes() {
      const jsTypes = ["string", "number", "boolean", "object", "undefined", "null", "symbol", "bigint"]
      jsTypes.forEach(type => {
        this.classTypes.set(type, {
          name: type,
          kind: TypeKind.Primitive,
          confidence: 1.0,
          inferredAt: []
        })
      })

      // Built-in objects
      this.classTypes.set("Array", {
        name: "Array",
        kind: TypeKind.Class,
        genericArgs: [this.getUnknownType()],
        confidence: 1.0,
        inferredAt: []
      })

      this.classTypes.set("Promise", {
        name: "Promise",
        kind: TypeKind.Class,
        genericArgs: [this.getUnknownType()],
        confidence: 1.0,
        inferredAt: []
      })
    }

    private initializePythonTypes() {
      const pythonTypes = ["int", "float", "str", "bool", "list", "dict", "tuple", "set", "None"]
      pythonTypes.forEach(type => {
        this.classTypes.set(type, {
          name: type,
          kind: type === "None" ? TypeKind.Literal : TypeKind.Primitive,
          confidence: 1.0,
          inferredAt: []
        })
      })
    }

    private initializeJavaTypes() {
      const javaTypes = ["int", "long", "double", "float", "boolean", "char", "byte", "short", "String", "Object"]
      javaTypes.forEach(type => {
        this.classTypes.set(type, {
          name: type,
          kind: ["String", "Object"].includes(type) ? TypeKind.Class : TypeKind.Primitive,
          confidence: 1.0,
          inferredAt: []
        })
      })
    }

    private initializeRustTypes() {
      const rustTypes = ["i32", "i64", "f32", "f64", "bool", "char", "str", "String", "Vec", "Option", "Result"]
      rustTypes.forEach(type => {
        this.classTypes.set(type, {
          name: type,
          kind: ["Vec", "Option", "Result"].includes(type) ? TypeKind.Generic :
                ["String"].includes(type) ? TypeKind.Class : TypeKind.Primitive,
          confidence: 1.0,
          inferredAt: []
        })
      })
    }

    private initializeCppTypes() {
      const cppTypes = ["int", "long", "double", "float", "bool", "char", "void", "std::string", "std::vector"]
      cppTypes.forEach(type => {
        this.classTypes.set(type, {
          name: type,
          kind: type.startsWith("std::") ? TypeKind.Class : TypeKind.Primitive,
          confidence: 1.0,
          inferredAt: []
        })
      })
    }

    private initializeCSharpTypes() {
      const csharpTypes = ["int", "long", "double", "float", "bool", "char", "string", "object", "decimal"]
      csharpTypes.forEach(type => {
        this.classTypes.set(type, {
          name: type,
          kind: ["string", "object"].includes(type) ? TypeKind.Class : TypeKind.Primitive,
          confidence: 1.0,
          inferredAt: []
        })
      })
    }

    private initializeGenericTypes() {
      // Fallback generic types
      ["int", "string", "bool", "object"].forEach(type => {
        this.classTypes.set(type, {
          name: type,
          kind: TypeKind.Primitive,
          confidence: 0.8,
          inferredAt: []
        })
      })
    }

    // Type inference methods
    public inferVariableType(varName: string, assignmentNode: Node, reason: InferenceReason): TypeInfo {
      const scopedName = this.getScopedName(varName)
      const inferredType = this.analyzeExpression(assignmentNode)

      inferredType.inferredAt.push({
        filePath: this.filePath,
        range: this.nodeToRange(assignmentNode),
        reason: reason
      })

      this.variableTypes.set(scopedName, inferredType)
      return inferredType
    }

    public inferFunctionReturnType(funcName: string, bodyNode: Node): TypeInfo {
      const returnStatements = this.findReturnStatements(bodyNode)
      if (returnStatements.length === 0) {
        return this.getVoidType()
      }

      if (returnStatements.length === 1) {
        return this.analyzeExpression(returnStatements[0])
      }

      // Multiple return statements - create union type
      const returnTypes = returnStatements.map(stmt => this.analyzeExpression(stmt))
      return this.createUnionType(returnTypes)
    }

    public inferMethodCallType(objectExpr: Node, methodName: string): TypeInfo {
      const objectType = this.analyzeExpression(objectExpr)

      if (objectType.methods?.has(methodName)) {
        return objectType.methods.get(methodName)!.returnType
      }

      // Try to infer from known patterns
      return this.inferMethodFromPatterns(objectType, methodName)
    }

    public inferGenericInstantiation(genericType: TypeInfo, typeArgs: TypeInfo[]): TypeInfo {
      return {
        ...genericType,
        genericArgs: typeArgs,
        confidence: Math.min(genericType.confidence, ...typeArgs.map(t => t.confidence)),
        inferredAt: [...genericType.inferredAt]
      }
    }

    // Expression analysis
    private analyzeExpression(node: Node): TypeInfo {
      switch (node.type) {
        case "number":
        case "integer_literal":
        case "float_literal":
          return this.getNumberType()

        case "string":
        case "string_literal":
        case "template_literal":
          return this.getStringType()

        case "boolean":
        case "true":
        case "false":
          return this.getBooleanType()

        case "null":
        case "nil":
        case "None":
          return this.getNullType()

        case "identifier":
        case "variable":
          return this.lookupVariableType(node.text)

        case "call_expression":
        case "function_call":
          return this.analyzeFunctionCall(node)

        case "member_expression":
        case "field_expression":
          return this.analyzeMemberAccess(node)

        case "array_expression":
        case "list_expression":
          return this.analyzeArrayExpression(node)

        case "object_expression":
        case "dict_expression":
          return this.analyzeObjectExpression(node)

        case "binary_expression":
          return this.analyzeBinaryExpression(node)

        case "conditional_expression":
        case "ternary_expression":
          return this.analyzeConditionalExpression(node)

        default:
          return this.getUnknownType()
      }
    }

    private analyzeFunctionCall(node: Node): TypeInfo {
      const functionNode = node.childForFieldName("function") || node.childForFieldName("name")
      if (!functionNode) return this.getUnknownType()

      const functionName = functionNode.text

      // Check if it's a method call
      if (functionNode.type === "member_expression") {
        const objectNode = functionNode.childForFieldName("object")
        const propertyNode = functionNode.childForFieldName("property")
        if (objectNode && propertyNode) {
          return this.inferMethodCallType(objectNode, propertyNode.text)
        }
      }

      // Regular function call
      const signature = this.functionTypes.get(functionName)
      if (signature) {
        return signature.returnType
      }

      // Constructor calls
      if (this.isConstructorCall(functionName)) {
        const className = this.extractClassName(functionName)
        return this.classTypes.get(className) || this.getUnknownType()
      }

      return this.getUnknownType()
    }

    private analyzeMemberAccess(node: Node): TypeInfo {
      const objectNode = node.childForFieldName("object") || node.childForFieldName("expression")
      const propertyNode = node.childForFieldName("property") || node.childForFieldName("field")

      if (!objectNode || !propertyNode) return this.getUnknownType()

      const objectType = this.analyzeExpression(objectNode)
      const propertyName = propertyNode.text

      // Check object properties
      if (objectType.properties?.has(propertyName)) {
        return objectType.properties.get(propertyName)!
      }

      // Check object methods
      if (objectType.methods?.has(propertyName)) {
        return {
          name: `${objectType.name}.${propertyName}`,
          kind: TypeKind.Function,
          confidence: objectType.confidence * 0.8,
          inferredAt: []
        }
      }

      return this.getUnknownType()
    }

    private analyzeArrayExpression(node: Node): TypeInfo {
      const elements = this.getArrayElements(node)
      if (elements.length === 0) {
        return {
          name: "Array",
          kind: TypeKind.Array,
          genericArgs: [this.getUnknownType()],
          confidence: 0.9,
          inferredAt: []
        }
      }

      const elementTypes = elements.map(elem => this.analyzeExpression(elem))
      const elementType = this.mergeTypes(elementTypes)

      return {
        name: "Array",
        kind: TypeKind.Array,
        genericArgs: [elementType],
        confidence: elementType.confidence * 0.9,
        inferredAt: []
      }
    }

    private analyzeObjectExpression(node: Node): TypeInfo {
      const properties = new Map<string, TypeInfo>()

      const children = node.namedChildren; for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (child && (child.type === "pair" || child.type === "property")) {
          const key = this.getObjectKey(child)
          const value = this.getObjectValue(child)
          if (key && value) {
            properties.set(key, this.analyzeExpression(value))
          }
        }
      }

      return {
        name: "Object",
        kind: TypeKind.Object,
        properties: properties,
        confidence: 0.9,
        inferredAt: []
      }
    }

    private analyzeBinaryExpression(node: Node): TypeInfo {
      const operator = this.getBinaryOperator(node)
      const leftNode = node.childForFieldName("left")
      const rightNode = node.childForFieldName("right")

      if (!leftNode || !rightNode) return this.getUnknownType()

      const leftType = this.analyzeExpression(leftNode)
      const rightType = this.analyzeExpression(rightNode)

      // Arithmetic operators
      if (["+", "-", "*", "/", "%", "**"].includes(operator)) {
        if (leftType.name === "string" || rightType.name === "string") {
          return operator === "+" ? this.getStringType() : this.getUnknownType()
        }
        return this.getNumberType()
      }

      // Comparison operators
      if (["<", ">", "<=", ">=", "==", "!=", "===", "!=="].includes(operator)) {
        return this.getBooleanType()
      }

      // Logical operators
      if (["&&", "||"].includes(operator)) {
        return this.mergeTypes([leftType, rightType])
      }

      return this.getUnknownType()
    }

    private analyzeConditionalExpression(node: Node): TypeInfo {
      const consequentNode = node.childForFieldName("consequence") || node.childForFieldName("then")
      const alternateNode = node.childForFieldName("alternative") || node.childForFieldName("else")

      if (!consequentNode || !alternateNode) return this.getUnknownType()

      const consequentType = this.analyzeExpression(consequentNode)
      const alternateType = this.analyzeExpression(alternateNode)

      return this.mergeTypes([consequentType, alternateType])
    }

    // Flow-sensitive analysis
    public analyzeControlFlow(node: Node): Map<string, TypeInfo> {
      const flowTypes = new Map<string, TypeInfo>()

      switch (node.type) {
        case "if_statement":
          return this.analyzeIfStatement(node)
        case "while_statement":
        case "for_statement":
          return this.analyzeLoopStatement(node)
        case "try_statement":
          return this.analyzeTryStatement(node)
        case "match_expression": // Rust
        case "switch_statement":
          return this.analyzeMatchStatement(node)
      }

      return flowTypes
    }

    private analyzeIfStatement(node: Node): Map<string, TypeInfo> {
      const conditionNode = node.childForFieldName("condition")
      const thenNode = node.childForFieldName("consequence") || node.childForFieldName("then")
      const elseNode = node.childForFieldName("alternative") || node.childForFieldName("else")

      const flowTypes = new Map<string, TypeInfo>()

      // Analyze type guards in condition
      if (conditionNode) {
        const typeGuards = this.extractTypeGuards(conditionNode)
        typeGuards.forEach((type, variable) => {
          flowTypes.set(variable, type)
        })
      }

      return flowTypes
    }

    private extractTypeGuards(conditionNode: Node): Map<string, TypeInfo> {
      const guards = new Map<string, TypeInfo>()

      // typeof checks: typeof x === 'string'
      if (this.isTypeofCheck(conditionNode)) {
        const variable = this.getTypeofVariable(conditionNode)
        const typeString = this.getTypeofType(conditionNode)
        if (variable && typeString) {
          guards.set(variable, this.stringToType(typeString))
        }
      }

      // instanceof checks: x instanceof Array
      if (this.isInstanceofCheck(conditionNode)) {
        const variable = this.getInstanceofVariable(conditionNode)
        const className = this.getInstanceofClass(conditionNode)
        if (variable && className) {
          const classType = this.classTypes.get(className)
          if (classType) {
            guards.set(variable, classType)
          }
        }
      }

      // Null checks: x != null, x !== undefined
      if (this.isNullCheck(conditionNode)) {
        const variable = this.getNullCheckVariable(conditionNode)
        if (variable) {
          const currentType = this.lookupVariableType(variable)
          guards.set(variable, this.makeNonNullable(currentType))
        }
      }

      return guards
    }

    // Helper methods for type system
    private lookupVariableType(varName: string): TypeInfo {
      const scopedName = this.getScopedName(varName)
      return this.variableTypes.get(scopedName) || this.getUnknownType()
    }

    private getScopedName(varName: string): string {
      if (this.scopeStack.length === 0) return varName
      return `${this.scopeStack.join(".")}.${varName}`
    }

    private mergeTypes(types: TypeInfo[]): TypeInfo {
      if (types.length === 0) return this.getUnknownType()
      if (types.length === 1) return types[0]

      // If all types are the same, return that type
      const uniqueTypes = Array.from(new Set(types.map(t => t.name)))
      if (uniqueTypes.length === 1) {
        return {
          ...types[0],
          confidence: Math.max(...types.map(t => t.confidence))
        }
      }

      // Create union type
      return this.createUnionType(types)
    }

    private createUnionType(types: TypeInfo[]): TypeInfo {
      return {
        name: types.map(t => t.name).join(" | "),
        kind: TypeKind.Union,
        unionTypes: types,
        confidence: Math.max(...types.map(t => t.confidence)) * 0.8,
        inferredAt: []
      }
    }

    // Built-in type getters
    private getUnknownType(): TypeInfo {
      return { name: "unknown", kind: TypeKind.Unknown, confidence: 0.0, inferredAt: [] }
    }

    private getVoidType(): TypeInfo {
      return { name: "void", kind: TypeKind.Void, confidence: 1.0, inferredAt: [] }
    }

    private getStringType(): TypeInfo {
      return { name: "string", kind: TypeKind.Primitive, confidence: 1.0, inferredAt: [] }
    }

    private getNumberType(): TypeInfo {
      return { name: "number", kind: TypeKind.Primitive, confidence: 1.0, inferredAt: [] }
    }

    private getBooleanType(): TypeInfo {
      return { name: "boolean", kind: TypeKind.Primitive, confidence: 1.0, inferredAt: [] }
    }

    private getNullType(): TypeInfo {
      return { name: "null", kind: TypeKind.Literal, confidence: 1.0, inferredAt: [] }
    }

    // Utility methods for AST navigation
    private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
      return {
        startLine: node.startPosition.row + 1,
        startColumn: node.startPosition.column + 1,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
    }

    private findReturnStatements(node: Node): Node[] {
      const returns: Node[] = []

      const traverse = (n: Node) => {
        if (n.type === "return_statement") {
          const expression = n.childForFieldName("expression") || n.namedChild(0)
          if (expression) returns.push(expression)
        }

        const children = n.namedChildren; for (let i = 0; i < children.length; i++) {
          traverse(children[i]!)
        }
      }

      traverse(node)
      return returns
    }

    private getArrayElements(node: Node): Node[] {
      const elements: Node[] = []
      const children = node.namedChildren; for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (child) elements.push(child)
      }
      return elements
    }

    private getObjectKey(pairNode: Node): string | null {
      const keyNode = pairNode.childForFieldName("key") || pairNode.childForFieldName("name")
      return keyNode ? keyNode.text : null
    }

    private getObjectValue(pairNode: Node): Node | null {
      return pairNode.childForFieldName("value") || pairNode.childForFieldName("expression")
    }

    private getBinaryOperator(node: Node): string {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child && ["operator", "+", "-", "*", "/", "==", "!=", "<", ">"].includes(child.type)) {
          return child.text
        }
      }
      return ""
    }

    private isConstructorCall(functionName: string): boolean {
      return /^[A-Z]/.test(functionName) || functionName === "new"
    }

    private extractClassName(functionName: string): string {
      return functionName.replace(/^new\s+/, "")
    }

    private isTypeofCheck(node: Node): boolean {
      return node.text.includes("typeof")
    }

    private isInstanceofCheck(node: Node): boolean {
      return node.text.includes("instanceof")
    }

    private isNullCheck(node: Node): boolean {
      return node.text.includes("!= null") || node.text.includes("!== undefined")
    }

    private getTypeofVariable(node: Node): string | null {
      // Extract variable from "typeof x === 'string'"
      const match = node.text.match(/typeof\s+(\w+)/)
      return match ? match[1] : null
    }

    private getTypeofType(node: Node): string | null {
      // Extract type from "typeof x === 'string'"
      const match = node.text.match(/===\s*['"](\w+)['"]/)
      return match ? match[1] : null
    }

    private getInstanceofVariable(node: Node): string | null {
      const match = node.text.match(/(\w+)\s+instanceof/)
      return match ? match[1] : null
    }

    private getInstanceofClass(node: Node): string | null {
      const match = node.text.match(/instanceof\s+(\w+)/)
      return match ? match[1] : null
    }

    private getNullCheckVariable(node: Node): string | null {
      const match = node.text.match(/(\w+)\s*!==?\s*(null|undefined)/)
      return match ? match[1] : null
    }

    private stringToType(typeString: string): TypeInfo {
      return this.classTypes.get(typeString) || {
        name: typeString,
        kind: TypeKind.Primitive,
        confidence: 0.9,
        inferredAt: []
      }
    }

    private makeNonNullable(type: TypeInfo): TypeInfo {
      return {
        ...type,
        nullable: false,
        confidence: type.confidence * 0.95
      }
    }

    private inferMethodFromPatterns(objectType: TypeInfo, methodName: string): TypeInfo {
      // Common method patterns across languages
      const commonPatterns: { [key: string]: TypeInfo } = {
        // Array methods
        "push": this.getNumberType(),
        "pop": this.getUnknownType(),
        "length": this.getNumberType(),
        "size": this.getNumberType(),
        "count": this.getNumberType(),

        // String methods
        "toString": this.getStringType(),
        "toLowerCase": this.getStringType(),
        "toUpperCase": this.getStringType(),
        "substring": this.getStringType(),
        "charAt": this.getStringType(),

        // Boolean methods
        "isEmpty": this.getBooleanType(),
        "isNull": this.getBooleanType(),
        "hasValue": this.getBooleanType(),
      }

      return commonPatterns[methodName] || this.getUnknownType()
    }

    private analyzeLoopStatement(node: Node): Map<string, TypeInfo> {
      // TODO: Implement loop flow analysis
      return new Map()
    }

    private analyzeTryStatement(node: Node): Map<string, TypeInfo> {
      // TODO: Implement try-catch flow analysis
      return new Map()
    }

    private analyzeMatchStatement(node: Node): Map<string, TypeInfo> {
      // TODO: Implement pattern matching flow analysis
      return new Map()
    }

    // Scope management
    public enterScope(scopeName: string) {
      this.scopeStack.push(scopeName)
    }

    public exitScope() {
      this.scopeStack.pop()
    }

    public getCurrentScope(): string {
      return this.scopeStack.join(".")
    }

    // Type registration for classes and functions
    public registerClass(className: string, classInfo: TypeInfo) {
      this.classTypes.set(className, classInfo)
    }

    public registerFunction(functionName: string, signature: MethodSignature) {
      this.functionTypes.set(functionName, signature)
    }

    // Export current state for inter-procedural analysis
    public getTypeSnapshot(): {
      variables: Map<string, TypeInfo>
      functions: Map<string, MethodSignature>
      classes: Map<string, TypeInfo>
    } {
      return {
        variables: new Map(this.variableTypes),
        functions: new Map(this.functionTypes),
        classes: new Map(this.classTypes)
      }
    }
  }

  // Type inference engine that integrates with language analyzers
  export class TypeInferenceEngine {
    private contexts = new Map<string, InferenceContext>()

    public createContext(filePath: string, language: string): InferenceContext {
      const context = new InferenceContext(language, filePath)
      this.contexts.set(filePath, context)
      return context
    }

    public getContext(filePath: string): InferenceContext | null {
      return this.contexts.get(filePath) || null
    }

    public inferTypesForFile(
      rootNode: Node,
      content: string,
      filePath: string,
      language: string
    ): Map<string, TypeInfo> {
      const context = this.createContext(filePath, language)
      const inferredTypes = new Map<string, TypeInfo>()

      this.traverseAndInferTypes(rootNode, context, inferredTypes)

      return inferredTypes
    }

    private traverseAndInferTypes(
      node: Node,
      context: InferenceContext,
      inferredTypes: Map<string, TypeInfo>
    ) {
      // Variable declarations and assignments
      if (this.isVariableDeclaration(node)) {
        const varName = this.getVariableName(node)
        const initExpr = this.getVariableInitializer(node)

        if (varName && initExpr) {
          const inferredType = context.inferVariableType(
            varName,
            initExpr,
            InferenceReason.Declaration
          )
          inferredTypes.set(varName, inferredType)
        }
      }

      // Function declarations
      if (this.isFunctionDeclaration(node)) {
        const funcName = this.getFunctionName(node)
        const bodyNode = this.getFunctionBody(node)

        if (funcName && bodyNode) {
          context.enterScope(funcName)
          const returnType = context.inferFunctionReturnType(funcName, bodyNode)
          context.exitScope()

          inferredTypes.set(`${funcName}:return`, returnType)
        }
      }

      // Control flow analysis
      const flowTypes = context.analyzeControlFlow(node)
      flowTypes.forEach((type, variable) => {
        inferredTypes.set(variable, type)
      })

      // Recursively analyze children
      const children = node.namedChildren; for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (child) {
          this.traverseAndInferTypes(child, context, inferredTypes)
        }
      }
    }

    // Cross-file type resolution
    public resolveTypesAcrossFiles(filePaths: string[]): Map<string, TypeInfo> {
      const globalTypes = new Map<string, TypeInfo>()

      // First pass: collect all type definitions
      filePaths.forEach(filePath => {
        const context = this.getContext(filePath)
        if (context) {
          const snapshot = context.getTypeSnapshot()

          // Merge class definitions
          snapshot.classes.forEach((classInfo, className) => {
            if (!globalTypes.has(className) || classInfo.confidence > globalTypes.get(className)!.confidence) {
              globalTypes.set(className, classInfo)
            }
          })
        }
      })

      // Second pass: resolve cross-file references
      filePaths.forEach(filePath => {
        const context = this.getContext(filePath)
        if (context) {
          // Update context with global type information
          globalTypes.forEach((typeInfo, typeName) => {
            context.registerClass(typeName, typeInfo)
          })
        }
      })

      return globalTypes
    }

    // Language-agnostic AST node detection
    private isVariableDeclaration(node: Node): boolean {
      const varDeclarationTypes = [
        "variable_declaration", "let_declaration", "const_declaration",
        "var_declaration", "local_variable_declaration", "assignment_statement"
      ]
      return varDeclarationTypes.includes(node.type)
    }

    private isFunctionDeclaration(node: Node): boolean {
      const funcDeclarationTypes = [
        "function_declaration", "function_definition", "method_declaration",
        "def", "defn", "fn", "func"
      ]
      return funcDeclarationTypes.includes(node.type)
    }

    private getVariableName(node: Node): string | null {
      // Try common field names for variable names
      const nameNode = node.childForFieldName("name") ||
                      node.childForFieldName("identifier") ||
                      node.childForFieldName("pattern")
      return nameNode ? nameNode.text : null
    }

    private getVariableInitializer(node: Node): Node | null {
      return node.childForFieldName("value") ||
             node.childForFieldName("initializer") ||
             node.childForFieldName("expression")
    }

    private getFunctionName(node: Node): string | null {
      const nameNode = node.childForFieldName("name") ||
                      node.childForFieldName("identifier")
      return nameNode ? nameNode.text : null
    }

    private getFunctionBody(node: Node): Node | null {
      return node.childForFieldName("body") ||
             node.childForFieldName("block") ||
             node.childForFieldName("compound_statement")
    }
  }

  // Integration with existing analyzer system
  export function enhanceAnalyzerWithTypeInference(
    analyzer: ASTEngine.LanguageAnalyzer,
    language: string
  ): ASTEngine.LanguageAnalyzer {
    const engine = new TypeInferenceEngine()

    return {
      analyze(rootNode: Node, content: string, filePath: string, context?: ASTEngine.AnalyzeContext) {
        // Run original analysis
        const result = analyzer.analyze(rootNode, content, filePath, context)

        // Enhance with type inference
        const inferredTypes = engine.inferTypesForFile(rootNode, content, filePath, language)

        // Add type information to symbols
        result.symbols.forEach((symbol: ASTEngine.UniversalSymbol) => {
          const typeInfo = inferredTypes.get(symbol.name)
          if (typeInfo) {
            symbol.metadata = {
              ...symbol.metadata,
              inferredType: typeInfo,
              typeConfidence: typeInfo.confidence,
              typeInferenceReasons: typeInfo.inferredAt.map(loc => loc.reason)
            }
          }
        })

        // Add type-based relationships
        const typeRelationships: ASTEngine.UniversalRelationship[] = []
        inferredTypes.forEach((typeInfo, symbolName) => {
          if (typeInfo.superTypes) {
            typeInfo.superTypes.forEach(superType => {
              typeRelationships.push({
                source: symbolName,
                target: superType.name,
                type: ASTEngine.RelationshipType.Extends,
                confidence: typeInfo.confidence,
                metadata: {
                  inferredFromTypes: true,
                  typeInference: true
                }
              })
            })
          }
        })

        result.relationships.push(...typeRelationships)

        return result
      }
    }
  }
}