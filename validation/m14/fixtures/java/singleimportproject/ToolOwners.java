package singleimportproject;

/**
 * THE PROJECT'S OWN DECLARATIONS — the two facts that make the lane's rules bite.
 *
 * `Tool` is declared TWICE (two nested classes), so the project's key space gives the simple name
 * MORE THAN ONE answer: the name-keyed resolver TIES on `Tool`, and that tie is the wall the
 * external single-type-import binding claim exists to close. Inside the importing file the import
 * decides it (JLS 6.4.1), which is what the claim states.
 *
 * `Unique` is declared ONCE: the key space answers it uniquely, the name model RESOLVES it, and a
 * claim there would trade a resolution for a claim — so there must be none.
 *
 * `Own` is declared TWICE as well (so the tie holds), but the import that names it is a PROJECT
 * import: the project owns the type, so it must resolve through the owner/name model and carry no
 * external-import evidence and no claim.
 */
public class ToolOwners {
  public static class Tool {}

  public static class Other {
    public static class Tool {}
  }

  public static class Unique {}

  public static class Own {}
}

class Own2 {
  static class Own {}
}
