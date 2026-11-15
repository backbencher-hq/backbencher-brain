(ns clj.fixture.shadow-core)

;; CLJ-D39 — A CORE NAME THIS FILE REDEFINES IS THE FILE'S OWN VAR.
;;
;; The suppression gate asks "is this bare head the standard library, or a local
;; definition?". Asking it in the WRONG ORDER dropped every call below a
;; definition of a core-named function, because the "this is core" early return
;; fired before the shadow check was ever asked. 401 edges in clojure/core.clj, a
;; file made almost entirely of them. The other half of the class is the shadow
;; TABLE itself: a name inside a quote or a `#_` discard sits in def-name
;; position but binds nothing, and a pre-pass that descends into either mints a
;; range running to end-of-file.

;; 1. A QUOTED def-form BINDS NOTHING. `last` is in def-name position here.
'(defn last [x] x)
(defn core-last [] (last [1 2]))

;; 2. A DISCARDED def-form BINDS NOTHING, for the same reason and the same walk.
#_(defn first [x] x)
(defn core-first [] (first [1 2]))

;; 3. A REAL definition of a core name does NOT reach BACKWARDS. A def binds when
;;    its form COMPLETES, so the call above is still clojure.core/count and is
;;    not published. Only the order of these two lines is under test.
(defn earlier-count [] (count 1))
(defn count [x] x)

;; 4. ...and every LATER use is the file's own var, and IS published.
(defn local-count [] (count 1))
