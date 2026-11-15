function LegacyWidget(id) {
  this.id = id;
}
LegacyWidget.prototype.render = function(input) {
  return input;
};
LegacyWidget.prototype.transform = function(x) {
  return this.render(x);
};
