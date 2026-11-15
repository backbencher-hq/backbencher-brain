(ns clj.fixture.exports
  (:require [clojure.string :as str]))

;; CLJ-D62 — the `exports` RELATIONSHIP. The construct exists, the analyzer
;; already computed every name in it (6,972 rows over 695 corpus files), and no
;; EDGE said so. Clojure has no `export` keyword and that is not the absence of a
;; construct: a namespace's public vars ARE its exports, `(require '[lib])` is
;; what makes them reachable, and `^:private` is the only thing that withdraws
;; one. A grammar inventory finds no node expressing "export" and is right to —
;; the construct is the ABSENCE of private.

;; PUBLIC, and therefore exported.
(defn public-fn [x] (str/upper-case x))
(def public-var 1)
(defrecord PublicRec [a b])
(defprotocol PublicProto (pm [_]))
(defmulti public-mm identity)
(s/def ::tagged :string)
(s/def lone-spec :int?)          ;; a spec with no definition — still a public entity

;; PRIVATE. `defn-` and `^:private` withdraw the name, and neither may appear in
;; the export list or the edge. The edge is the thing being pinned here, so a
;; private var reaching it is the defect, not a detail.
(defn- private-suffix [x] x)
(defn ^:private private-meta [x] x)
(def ^:private private-var 2)

;; CLJ-D23: `(declare …)` interns a public var but does not DEFINE it, so it is
;; not an export of this file. CLJ-D60: the namespace does not export ITSELF, so
;; `clj.fixture.exports -> clj.fixture.exports` is never published.
(declare forward-declared)

(defn forward-declared [] 42)

;; A name that is both a spec annotation and a real definition is ONE public
;; entity (CLJ-D38). One export edge, not two.
(s/def both-a-spec-and-a-fn :string?)
(defn both-a-spec-and-a-fn [] "x")

;; Overloads share a name and export ONCE.
(defn overloaded ([] :zero) ([x] x) ([x y] [x y]))

;; A member is not namespace-level: its export rides `contains`, not `exports`.
(defrecord WithMembers [field]
  Object
  (toString [this] (str this)))