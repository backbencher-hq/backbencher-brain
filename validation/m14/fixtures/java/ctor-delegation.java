public class CtorDelegation extends Base {
    CtorDelegation() {
        super();
    }

    CtorDelegation(int x) {
        this();
    }

    CtorDelegation(String s) {
        helper.super();
    }

    static class Inner {
        Inner() {
            super();
        }
    }
}

class Base {
}
