package com.acme.dep

import java.util.List
import java.util.Map.*
import static java.util.Collections.sort
import groovy.transform.CompileStatic

@CompileStatic
class Dep {
  List<String> items

  def run() {
    sort(items)
    return new HashMap()
  }
}
