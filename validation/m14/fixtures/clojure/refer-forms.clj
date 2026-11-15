(ns clj.fixture.referforms
  (:require [clj.fixture.util :refer [rewrite-text join-all]]
            [clj.fixture.more :refer [combine-sets]]
            [clj.fixture.edge :refer [parse-edn]]))

(defn rewrite [s] (rewrite-text s "a" "b"))
(defn combine [a b] (combine-sets a b))
(defn thread-join [xs] (-> xs (join-all ",")))
(defn anon-shorthand [xs] (map #(rewrite-text % "a" "b") xs))
(defn parse [s] (parse-edn s))
(defn parse-edn [s] s)
(defn local-wins [s] (parse-edn s))
