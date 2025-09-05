type Counter = { name: string; help?: string; value: number };
type Gauge = Counter;

class Metrics {
  readonly counters: Record<string, Counter> = {};
  readonly gauges: Record<string, Gauge> = {};

  inc(name: string, by = 1, help?: string): void {
    const c = (this.counters[name] ??= { name, help, value: 0 });
    c.value += by;
  }

  set(name: string, value: number, help?: string): void {
    const g = (this.gauges[name] ??= { name, help, value });
    g.value = value;
  }

  render(): string {
    const lines: string[] = [];
    for (const c of Object.values(this.counters)) {
      if (c.help) lines.push(`# HELP ${c.name} ${c.help}`);
      lines.push(`# TYPE ${c.name} counter`);
      lines.push(`${c.name} ${c.value}`);
    }
    for (const g of Object.values(this.gauges)) {
      if (g.help) lines.push(`# HELP ${g.name} ${g.help}`);
      lines.push(`# TYPE ${g.name} gauge`);
      lines.push(`${g.name} ${g.value}`);
    }
    return lines.join("\n") + "\n";
  }
}

export const metrics = new Metrics();

