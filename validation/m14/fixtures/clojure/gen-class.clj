;; CLJ-D58 — `gen-class` / `gen-interface` are the COMPILE-TIME supertype spellings,
;; and they were not read. `proxy` is the runtime one and the lane's `extends`
;; verdict rested on the belief that it was the only one; the parse-tree probe found
;; 3 `:extends` sites and 2 `:implements` sites in clojure's own genclass tests, 0
;; anywhere else. Every option shape is here, because the options may appear in any
;; order and `:name` is optional:
;;   - `:extends` a bare symbol on gen-class, a VECTOR on gen-interface
;;   - `:implements` always a vector
(ns clj.fixture.genclass)

(gen-class :name clj.fixture.genclass.Gen1
           :extends java.util.ArrayList
           :implements [clj.fixture.genclass.Base1 clj.fixture.genclass.Base2])

;; `:name` first, `:extends` last, no `:implements` at all.
(gen-class :extends java.util.HashSet
           :name clj.fixture.genclass.Gen2)

;; No `:name`: the generated class is named after the namespace, so the edge's source
;; is the namespace and still resolves.
(gen-class :extends java.io.File)

(gen-interface :name clj.fixture.genclass.Iface1
               :extends [clj.fixture.genclass.Parent1 clj.fixture.genclass.Parent2])

;; NOT a gen-class: `proxy` is the runtime spelling and is unchanged. Both of its
;; supertypes are named, and the first is EXTENDED while the rest are IMPLEMENTED.
(defn runtime-proxy []
  (proxy [java.util.ArrayList clj.fixture.genclass.Base1]
    (size [] 0)))