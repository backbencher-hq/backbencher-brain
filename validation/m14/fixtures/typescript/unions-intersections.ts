type Result = Success | Failure;
type Combined = Serializable & Loggable;

class Success {
  value = 1;
}
class Failure {
  error = "x";
}
