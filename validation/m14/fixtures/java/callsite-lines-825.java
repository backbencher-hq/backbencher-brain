// fixture: java/callsite-lines-825
// M59 (#825): a call's line_number is the line the CALL is written on. A
// method_invocation node starts at its RECEIVER, so every call in a
// newline-continued chain inherited the line the chain opened on — the same
// defect class measured in scala, in java's own node shape. The instantiation
// half is the mirror of it: the line belongs to the type node that NAMES the
// constructed type.
package lines;

public class Chains {
  private String base = "x";

  public String chained() {
    return base
        .trim()
        .toUpperCase();
  }

  public Chains delegate() {
    return new Chains();
  }

  public StringBuilder built(int n) {
    return new StringBuilder()
        .append(n)
        .append('!');
  }
}
