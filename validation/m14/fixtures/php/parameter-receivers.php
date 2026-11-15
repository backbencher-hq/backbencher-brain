<?php
namespace Parameters;
class Service { function run() {} }
class Other { function run() {} }
function stable(Service $value) { $value->run(); }
function optional(?Service $value) { $value?->run(); }
function reassigned(Service $value) { $value = new Other(); $value->run(); }
function unionType(Service|Other $value) { $value->run(); }
function escaping(Service $value) { unknown($value); $value->run(); }
function byReference(Service &$value) { $value->run(); }
