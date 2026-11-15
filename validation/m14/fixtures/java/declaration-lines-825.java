// fixture: java/declaration-lines-825
// M59 (#825): the line a java relationship carries is the line its NAME is
// written on — not the line of the enclosing construct, and not the line of a
// modifier. Measured on a 300-file real java sample: 25 symbols had their line
// on an annotation (@SuppressWarnings/@Override) instead of the declaration, so
// a tool navigating to a java symbol landed on the annotation. Also pinned here:
// a long heritage list names each parent on its OWN line, a containment edge
// points at the member's declaration, and an override points at the overriding
// declaration rather than its @Override.
package lines;

import java.io.Serializable;

class Base {
  public String label() { return "b"; }
}

interface Marker {}

@SuppressWarnings("unused")
class Annotated extends Base
    implements Marker, Serializable {
  @Deprecated
  int legacy = 1;

  @Override
  public String label() { return "a"; }
}
