package com.acme.dep

import java.util.List
import java.util.concurrent.TimeUnit
import java.util.concurrent.*
import static java.util.Collections.sort
import static java.util.Collections.emptyList as nothing
import static java.util.Collections.*

class Importer {
  List<String> items

  def run() {
    sort(items)
    return new HashMap()
  }
}