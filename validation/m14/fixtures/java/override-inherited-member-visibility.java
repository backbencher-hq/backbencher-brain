// A global same-leaf fallback must not defeat an on-demand platform import.
import java.util.*;

class Decoy {
    static class ArrayList {
        void marker() {}
    }
}

class Child extends ArrayList<String> {
    void marker() {}
}

// Unlike the decoy, this nested type really is inherited through two hops.
class Ancestor {
    static class Inner {
        void ping() {}
    }
}

class Middle extends Ancestor {}

class Descendant extends Middle {
    class Nested extends Inner {
        @Override void ping() {}
    }
}
