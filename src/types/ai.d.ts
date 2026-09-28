declare module "ai" {
  export async function embed(text: string): Promise<number[]>
  export async function embedMany(texts: string[]): Promise<{ embeddings: number[][] }>
}
