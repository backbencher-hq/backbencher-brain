interface Config {
  enabled: boolean;
}

const cfg: Config = { enabled: true };
const ok = cfg satisfies Config;
