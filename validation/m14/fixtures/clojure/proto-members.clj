;; CLJ-D19 — a protocol/interface method whose NAME is a clojure.core var.
;;
;; `(definterface ArrayManager (array [^int size]) (alength [arr]) (aclone
;; [arr]) (aget [arr ^int i]) (aset [arr ^int i val]))` in gvec.clj declares
;; five members; four of the five names are in the core list, so the interface
;; was emitted with ONE method. `(definterface … (identity [x]))` in the
;; genclass examples was emitted with none. The gate that dropped them was a
;; leftover from C9, whose real fix was the null-prototype alias table —
;; `toString` was never in the list, so the gate never fired for the
;; prototype-pollution class it was written for. With the list now at 723
;; entries it would have dropped `get`, `key` and `count` too.
(ns clj.fixture.protomembers)

(definterface ArrayManager
  (array [^int size])
  (alength [arr])
  (identity [x])
  (key [m k])
  (count [c]))

(defprotocol ^:private Sealed
  (close [this])
  (get [this k] [this k not-found])
  (describe [this]))

(defrecord ^:private Box [inner]
  Sealed
  (close [_] 0)
  (identity [this] this)
  (key [_ k] k)
  (count [_] 1)
  (describe [_] "box"))

;; A method IMPLEMENTATION whose name is a core var is a declaration too — the
;; C9 branch's twin. `toString` is the shape the pollution class was about.
(deftype ^:private Widget [w]
  Object
  (toString [_] "widget"))
