package com.acme.jvm;

import java.util.Comparator;

// M37.21 #610 master-review fixture: pins JD18 (anonymous class body scope)
// and JD19 (multi-hop nested-class override resolution). Authored before the
// analyzer run; the expectation file is the contract.

class Service {
    Comparator<String> byLen = new Comparator<String>() {
        public int compare(String a, String b) {
            return helper(a, b);
        }
    };

    Runnable task = new Runnable() {
        public void run() {
            Service.staticHelper();
        }
    };

    static int helper(String a, String b) { return a.length() - b.length(); }
    static void staticHelper() {}

    // JD19: deep nested hierarchy — BlackVal extends Black extends Node.
    // Black declares NO val, so BlackVal.val must resolve through the
    // non-declaring ancestor Black to Node.val.
    static abstract class Node {
        abstract Object val();
        Object left() { return null; }
    }
    static class Black extends Node {
        // Black deliberately declares NO val(): the JD19 contract is that
        // BlackVal.val resolves THROUGH the non-declaring ancestor Black
        // to Node.val (clojure PersistentTreeMap shape).
        void redden() {}
    }
    static class BlackVal extends Black {
        @Override Object val() { return null; }
        @Override void redden() {}
    }
    static class BlackBranch extends Black {
        @Override Object left() { return null; }
        void rebalance() {}
    }
    static class BlackBranchVal extends BlackBranch {
        @Override Object val() { return null; }
        @Override void redden() {}
    }

    // M37.21 C30: in-file supertype + anonymous body — the anon type's
    // supertype IS registered in classHierarchy, so @Override handle
    // resolves exact-in-file (anonymous_Handler.handle -> Handler.handle).
    // The Comparator/Runnable bodies above stay edge-free: their supertypes
    // are IMPORTS, not in-file declarations (override truth is in-file).
    interface Handler { int handle(String k); }

    Handler mapper = new Handler() {
        @Override public int handle(String k) { return k.length(); }
    };
}
