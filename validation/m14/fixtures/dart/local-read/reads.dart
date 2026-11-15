// The READING file: a function that declares its OWN `counter` and reads it. It imports
// nothing, references no other declaration, and depends on nothing outside itself.
//
// The analyzer publishes the read with the BARE local name as the target and `isLocalRead`
// as the marker. `parallel-indexer.resolveRelationships` Strategy 2 then matches a bare
// target against `_res_name` where `cnt = 1` — and this file's own local is not a symbol, so
// the only `counter` in the key space is Telemetry's FIELD in declares.dart, in another
// file, in another class, meaning something else entirely.
//
// That is the whole defect: an edge that asserts a dependency which does not exist, between
// two files that never met, produced by a rule that is working exactly as designed.

void run() {
  var counter = 1;
  print(counter);
}
