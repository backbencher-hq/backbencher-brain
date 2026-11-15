class Formatter {
  format(value: string): string;
  format(value: number): string;
  format(value: unknown): string {
    return String(value);
  }
}
