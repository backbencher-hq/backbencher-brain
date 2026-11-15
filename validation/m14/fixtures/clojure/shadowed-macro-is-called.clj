(ns clj.fixture.shadowed-macro)

;; CLJ-D43 — A MACRO THE FILE REDEFINES IS THE FILE'S OWN MACRO, AND CALLING IT
;; IS A CALL.
;;
;; The truth's name-based lists ("this is a macro", "this is a binding form",
;; "this is a def head") were consulted BEFORE the shadow table. That is right for
;; a macro the language provides and wrong for one the file defines, and
;; clojure/core.clj is the worst file for the mistake: it IS clojure.core, so it
;; defines `when-let`, `if-let`, `doseq`, `lazy-seq` and `loop` and then calls them
;; 29, 9, 12, 41 and 29 times. None of those calls was published.

;; Redefining a core macro, exactly as core.clj does. Every call to it below is a
;; call to THIS macro.
(defmacro when-not
  [bindings & body]
  `(if ~bindings nil (do ~@body)))

(defn use-it [x] (when-not (neg? x) :positive))

;; NOT shadowed by the redefinition, so this one is the language's macro and the
;; name-based list still applies.
(defn core-macro-still-macro [] (lazy-seq [1 2 3]))

;; Three groups are not calls whatever supplies the name:
;;   · a THREADING MACRO is transparent expansion — the arrow is punctuation;
;;   · a DEF HEAD is a definition (CLJ-D30 gives those their own class);
;;   · a LIBSPEC is a directive — `(require …)` invokes nothing.
(defn threaded [x] (-> x inc dec))
(defn defined-here [] (definline twice [n] (* 2 n)))
(twice 21)
(require '[clojure.set :as st])
