export namespace GitTemporalHelper {
  export async function getPatterns(_projectId: string): Promise<any[]> { return [] }
  export async function detect(_projectId: string): Promise<any[]> { return [] }
  export async function getPredictiveWarning(_projectId: string, _filePath: string): Promise<string | undefined> { return undefined }
}
