class ParamSvc {
  apply(amount: number, percent: number): number {
    return amount * (1 - percent / 100);
  }

  join(parts: string[], sep: string = ","): string {
    return parts.join(sep);
  }
}
