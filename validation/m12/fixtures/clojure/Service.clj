(ns com.example.clojure.service
  (:require [clojure.string :as str]
            [clojure.set :as set]
            [io.other :refer [foo bar]])
  (:import (java.util Date)))

(defprotocol Formatter
  (format-value [this value]))

(defrecord ClojureService [prefix]
  Formatter
  (format-value [_ value] (str prefix ":" value)))

(defn create-service [prefix]
  (->ClojureService prefix))

(defmulti area :shape)
(defmethod area :circle [r] (* 3.14 r r))
(defmethod area :square [s] (* s s))

(defmacro unless [test body]
  (list 'if test nil body))

(def constant-value 42)
(defonce singleton (atom nil))

(defn multi-arity
  ([a] a)
  ([a b] (+ a b)))

(defn uses-lib [x]
  (str/join "," x)
  (set/union #{1} #{2})
  (Date.))
