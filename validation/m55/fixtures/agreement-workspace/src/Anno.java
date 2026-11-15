public class Anno {
  public int value() { return 1; }

  @Marker(target())
  public int annotated() { return target(); }
}
