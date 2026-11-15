;; CLJ-D53 — `exports`: an `ns` form's PUBLIC interned vars ARE the namespace's
;; export surface, and Clojure states that with no keyword at all.
;;
;; This is why the construct is invisible to a grammar inventory: `require`
;; is written, "what this file publishes" is not a thing the grammar spells. The
;; `ExportInfo[]` the analyzer already derived was correct, and NOTHING indexes
;; it — `ParseResult.exports` is passed through `engine.ts` and read by no
;; consumer, while `bb_graph` / `graph_usages.ts` read the `exports`
;; RELATIONSHIP rows out of `brain_relationship`.
(ns clj.fixture.exports
  (:require [clojure.string :as str]))

(defn public-fn [x] (str/upper-case x))

(defn- private-fn [x] x)

(defn ^:private annotated-private [x] x)

(def public-var 42)

(def ^:private private-var 43)

(defprotocol Public-Proto
  (proto-method [this]))

(defrecord Public-Record [f]
  Public-Proto
  (proto-method [this] f))

(deftype Public-Type [f]
  Public-Proto
  (proto-method [this] f))

(defmulti public-multi identity)

(defmethod public-multi :a [_] :a)

(def public-once 1)

;; A forward declaration is public in its namespace but is NOT a definition, so
;; it is not an export of this file (CLJ-D23).
(declare declared-only)