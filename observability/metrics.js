function buildKey(name, labels) {
    const sorted = Object.entries(labels || {}).sort(([left], [right]) => left.localeCompare(right));
    return `${name}|${JSON.stringify(sorted)}`;
}

function formatLabels(labels) {
    const entries = Object.entries(labels || {});
    if (entries.length === 0) {
        return '';
    }

    const rendered = entries
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
        .join(',');
    return `{${rendered}}`;
}

function escapeLabelValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

class MetricsRegistry {
    constructor() {
        this.counters = new Map();
        this.gauges = new Map();
        this.summaries = new Map();
        this.metricMeta = new Map();
    }

    defineMetric(name, type, help) {
        if (!this.metricMeta.has(name)) {
            this.metricMeta.set(name, { type, help });
        }
    }

    incCounter(name, labels = {}, value = 1, help = name) {
        this.defineMetric(name, 'counter', help);
        const key = buildKey(name, labels);
        const current = this.counters.get(key) || { name, labels, value: 0 };
        current.value += value;
        this.counters.set(key, current);
    }

    setGauge(name, labels = {}, value = 0, help = name) {
        this.defineMetric(name, 'gauge', help);
        this.gauges.set(buildKey(name, labels), { name, labels, value });
    }

    observeSummary(name, labels = {}, value = 0, help = name) {
        this.defineMetric(name, 'summary', help);
        const key = buildKey(name, labels);
        const current = this.summaries.get(key) || { name, labels, count: 0, sum: 0 };
        current.count += 1;
        current.sum += value;
        this.summaries.set(key, current);
    }

    renderPrometheus() {
        const lines = [];
        const emitted = new Set();

        for (const [name, meta] of this.metricMeta.entries()) {
            if (!emitted.has(name)) {
                lines.push(`# HELP ${name} ${meta.help}`);
                lines.push(`# TYPE ${name} ${meta.type}`);
                emitted.add(name);
            }

            if (meta.type === 'counter') {
                for (const entry of this.counters.values()) {
                    if (entry.name === name) {
                        lines.push(`${name}${formatLabels(entry.labels)} ${entry.value}`);
                    }
                }
                continue;
            }

            if (meta.type === 'gauge') {
                for (const entry of this.gauges.values()) {
                    if (entry.name === name) {
                        lines.push(`${name}${formatLabels(entry.labels)} ${entry.value}`);
                    }
                }
                continue;
            }

            if (meta.type === 'summary') {
                for (const entry of this.summaries.values()) {
                    if (entry.name === name) {
                        lines.push(`${name}_count${formatLabels(entry.labels)} ${entry.count}`);
                        lines.push(`${name}_sum${formatLabels(entry.labels)} ${entry.sum}`);
                    }
                }
            }
        }

        return `${lines.join('\n')}\n`;
    }
}

const metrics = new MetricsRegistry();

module.exports = {
    metrics
};
