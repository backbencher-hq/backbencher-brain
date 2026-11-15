package com.acme.throwsref;

import java.io.IOException;

public class ThrowsReferences extends Base {
  ThrowsReferences() throws IOException {
  }

  ThrowsReferences(int x) throws Exception {
  }

  void method() throws IOException, IllegalArgumentException {
  }

  void fq() throws java.sql.SQLException {
  }

  <E extends Exception> void generic() throws E {
  }

  interface Callback {
    void call() throws java.util.concurrent.TimeoutException;
  }

  @interface Ann {
    Class<?> value();
  }
}

class Base {
}
