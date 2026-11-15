class Vis {
  public pub = 1;
  private priv = 2;
  protected prot = 3;
  plain = 4;

  public getPub(): number {
    return this.pub;
  }
  private setPriv(v: number): void {
    this.priv = v;
  }
  protected getProt(): number {
    return this.prot;
  }
}
