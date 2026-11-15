<?php
namespace Library {
    function Task() {}
    function count() {}
    class Thing {}
}
namespace App {
    use function Library\Task as Imported;
    use function Library\{Task as Grouped, count as CustomCount};
    use Library\{function Task as Mixed, Thing};
    use Library as Space;
    function localTask() {}
    function importedCall() { Imported(); }
    function groupedCall() { Grouped(); }
    function mixedCall() { Mixed(); }
    function prefixCall() { Space\Task(); }
    function relativeCall() { namespace\localTask(); }
    function globalFallback() { externalFunction(); }
    function qualifiedCount() { \Library\count(); }
    function aliasCount() { CustomCount(); }
    function possibleShadow() { count([]); }
    function actualBuiltin() { \CoUnT([]); }
    function tearOff() { return Imported(...); }
}
