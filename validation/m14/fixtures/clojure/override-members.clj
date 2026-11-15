;; CLJ-D53 — `overrides`: a protocol method IMPLEMENTATION overrides the method
;; the same file DECLARES on that protocol.
;;
;; The analyzer doc ruled this type inapplicable because `defmethod` shares the
;; multimethod's var identity. That is true of `defmethod` and it was
;; generalised to the language, which is the shape of ruling the
;; ontology-coverage gate exists to catch: the construct was measured (239
;; derivable sites over 633 corpus files) and the ruling was wrong.
;;
;; The two endpoints are DISTINCT var identities here — `Sealed.close` is the
;; declaration, `Box.close` is the implementation — so this is not the
;; self-loop the old ruling was about. It is the same shape the Haskell lane
;; publishes for `instance C T where m`, and the same shape Java publishes for a
;; class implementing an interface method.
(ns clj.fixture.override-members)

(defprotocol Sealed
  (close [this])
  (describe [this]))

;; 1. defrecord — the classic same-namespace protocol + record pair.
(defrecord Box [inner]
  Sealed
  (close [_] 0)
  (describe [_] "box"))

;; 2. deftype — the same shape, and the source type is a type this file declares.
(deftype Widget [w]
  Sealed
  (close [_] 1)
  (describe [_] "widget"))

;; 3. extend-type of a host type — the shape 233 of the 239 corpus sites use.
(extend-type String
  Sealed
  (close [_] 2)
  (describe [_] "string"))

;; 4. extend-protocol — the mirror ordering (protocol first, then the types).
(extend-protocol Sealed
  Long
  (close [_] 3)
  (describe [_] "long"))

;; 5. A method the protocol does NOT declare is NOT an override. `Object` is
;;    named as a protocol here and `hashCode` is not one of `Sealed`'s methods;
;;    publishing `X.hashCode overrides Sealed.hashCode` would be a fabrication of
;;    a method that does not exist, so the join gate must refuse it.
(defprotocol OnlyClose
  (close [this]))

(defrecord Mismatch []
  OnlyClose
  (close [_] 4)
  (toString [_] "mismatch"))

;; 6. `reify` has NO NAMED TYPE, so there is no source identity to publish. The
;;    implementation is real and the `implements` edge is real; the `overrides`
;;    edge would have to invent one, so it is withheld and counted in the probe
;;    as UNRESOLVED rather than dropped silently.
(defrecord Holder []
  Sealed
  (close [this] (let [f (reify Sealed (close [_] 5) (describe [_] "anon"))] 5))
  (describe [_] "holder"))