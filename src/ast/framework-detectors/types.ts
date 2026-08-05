import { ASTEngine } from "../engine"

export interface FrameworkInfo {
  name: string
  confidence: number
  patterns: string[]
}

export type FrameworkDetector = (content: string, symbols: ASTEngine.UniversalSymbol[]) => FrameworkInfo | undefined
