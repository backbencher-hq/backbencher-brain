module com.acme.platform {
  requires java.logging;
  requires transitive com.google.common;
  requires java.sql;

  exports com.acme.platform.api;
  exports com.acme.platform.spi;
}
