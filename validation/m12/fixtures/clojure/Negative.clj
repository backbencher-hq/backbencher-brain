(ns com.example.clojure.negative
  (:require [clojure.string :as str]))

;; Builtin calls produce NO calls edges (map/filter/str/inc are core)
(defn builtin-only [coll]
  (map inc (filter pos? coll))
  (str "prefix" "suffix"))

;; Quoted symbols are DATA, not references — no references edges for 'foo
(defn quoted-data []
  (list 'foo 'bar 42))

;; Member/field access is Uses (interop), never Calls
(defn interop-access [obj]
  (.toString obj)
  (.-length obj))

;; Anonymous fn literal -> local lambda symbol, no global symbol
(defn higher-order []
  (map #(* % %) [1 2 3]))
