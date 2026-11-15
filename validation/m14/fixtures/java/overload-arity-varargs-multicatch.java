// M49 R3 fixture (review claims 1-3): pins three contracts.
//
// (1) ARGUMENT-COUNT PAYLOAD: every method_invocation calls edge carries
//     metadata.argumentCount (named-argument children of the invocation's
//     argument_list). Overloads still share the bare leaf target (JD20
//     matching contract) but downstream consumers can now distinguish
//     process(String) from process(int) by arity without a resolver.
//
// (2) VARARGS/ARRAY SIGNATURE EQUIVALENCE (JLS 8.4.1): void foo(int...) and
//     void foo(int[]) are the SAME signature for override matching. Both
//     cross combinations must resolve exact-in-file — VarSub.foo (varargs)
//     overrides ArrBase.foo (array) and ArrSub.foo (array) overrides
//     VarBase.foo (varargs). This was true via the spread path's ... -> []
//     normalization but had NO test exercising it (worked "by accident").
//
// (3) MULTI-CATCH UNION TYPES: catch (A | B e) emits declared_type
//     references for EVERY union member, not just the first.
package com.acme.m49;

class ArrBase {
    void foo(int[] xs) { }
}

class VarSub extends ArrBase {
    @Override void foo(int... xs) { }
}

class VarBase {
    void bar(int... xs) { }
}

class ArrSub extends VarBase {
    @Override void bar(int[] xs) { }
}

class OverloadUser {
    void process(String s) { }
    void process(int i) { }

    void run() {
        process("x");
        process(1);
        ArrBase a = new ArrBase();
        a.foo(new int[]{1});
    }

    void risky() {
        try {
            process("y");
        } catch (java.lang.IllegalArgumentException | java.lang.IllegalStateException e) {
            System.out.println(e.getMessage());
        }
    }
}
