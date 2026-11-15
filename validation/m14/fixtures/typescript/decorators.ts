@Component({ selector: "app-root" })
class AppComponent {
  @Input() title: string = "";
  @Output() change = new EventEmitter();
}
