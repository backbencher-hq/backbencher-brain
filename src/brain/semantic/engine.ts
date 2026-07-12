export const SemanticEngine = { 
  getEmbeddingModel: async () => null,
  embedMany: async (docs: string[]) => docs.map(() => []),
}
