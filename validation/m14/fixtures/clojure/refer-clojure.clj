(ns clj.fixture.rc
  (:refer-clojure :exclude [replace reverse])
  (:require [clojure.string :as str]))

(defn rewrite [s] (str/replace s "a" "b"))

(defn legacy [s] (replace s "a" "b"))
