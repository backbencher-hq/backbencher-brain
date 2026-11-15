abstract class Base {
  abstract run(): void;
  helper(): number {
    return 1;
  }
}

class Impl extends Base {
  override run(): void {}
  override helper(): number {
    return 2;
  }
  extra(): string {
    return "x";
  }
}
