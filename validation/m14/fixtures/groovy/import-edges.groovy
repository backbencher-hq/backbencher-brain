package com.acme.core

import java.util.List
import java.util.Map.*
import static java.util.Collections.sort

class Importer {
  List<String> items

  def run() {
    sort(items)
    def m = new HashMap()
    return m
  }
}
