function App() {
  return (
    <div className="wrap">
      <Button label="Go" />
      <Other />
      <span>text</span>
      <Panel title="p">
        <Button label="inner" />
      </Panel>
    </div>
  );
}