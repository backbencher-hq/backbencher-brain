module com.acme.platform {
  requires java.base;
  requires transitive java.logging;
  requires static java.sql;
  requires com.acme.core;
  exports com.acme.platform.api;
  exports com.acme.platform.spi;
  opens com.acme.platform.internal;
}