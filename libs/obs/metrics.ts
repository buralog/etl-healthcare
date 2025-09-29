import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";

const cw = new CloudWatchClient({});
const NAMESPACE = process.env.METRICS_NS ?? "etl.health";

function dims(d: Record<string, string> | undefined) {
    return Object.entries(d ?? {}).map(([Name, Value]) => ({ Name, Value }));
}

export async function metricCount(name: string, value = 1, d?: Record<string, string>) {
    try {
        await cw.send(new PutMetricDataCommand({
            Namespace: NAMESPACE,
            MetricData: [{ MetricName: name, Value: value, Unit: "Count", Dimensions: dims(d) }],
        }));
    } catch (e) { console.warn("metric-failed", name, (e as Error).message); }
}

export async function metricMs(name: string, ms: number, d?: Record<string, string>) {
    try {
        await cw.send(new PutMetricDataCommand({
            Namespace: NAMESPACE,
            MetricData: [{ MetricName: name, Value: ms, Unit: "Milliseconds", Dimensions: dims(d) }],
        }));
    } catch (e) { console.warn("metric-failed", name, (e as Error).message); }
}
