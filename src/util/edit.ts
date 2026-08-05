export function applyEdit(_content: string, _edit: any): string { return _content }
export function createPatch(_original: string, _modified: string): string { return "" }
export function applyDiff(_content: string, _diff: string): string { return _content }
export function trimDiff(_diff: string): string { return _diff }
export function replace(_original: string, _search: string, _replace: string): string { return _original.replace(_search, _replace) }
