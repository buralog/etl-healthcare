import { SQSClient, GetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { CloudWatchClient, GetMetricDataCommand, MetricDataQuery } from "@aws-sdk/client-cloudwatch";

const sqs = new SQSClient({});
const s3 = new S3Client({});
const cw = new CloudWatchClient({});

const NS = process.env.METRICS_NS ?? "etl.health";
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "eu-central-1";

// queues (main + dlq)
const Q = {
    ingest: { url: process.env.INGEST_Q_URL!, dlq: process.env.INGEST_DLQ_URL! },
    normalized: { url: process.env.NORMALIZED_Q_URL!, dlq: process.env.NORMALIZED_DLQ_URL! },
    persisted: { url: process.env.PERSISTED_Q_URL!, dlq: process.env.PERSISTED_DLQ_URL! },
};

const AUDIT_BUCKET = process.env.AUDIT_BUCKET!;

function claims(event: any) {
    const c = event?.requestContext?.authorizer?.claims ?? {};
    const groupsRaw = c["cognito:groups"];
    const groups = Array.isArray(groupsRaw) ? groupsRaw
        : typeof groupsRaw === "string" ? groupsRaw.split(",").map((s: string) => s.trim()) : [];
    return { tenantId: c["custom:tenantId"], groups };
}

async function qDepth(url: string) {
    const out = await sqs.send(new GetQueueAttributesCommand({
        QueueUrl: url,
        AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible", "ApproximateNumberOfMessagesDelayed"],
    }));
    const a = out.Attributes ?? {};
    return {
        visible: Number(a.ApproximateNumberOfMessages ?? 0),
        inFlight: Number(a.ApproximateNumberOfMessagesNotVisible ?? 0),
        delayed: Number(a.ApproximateNumberOfMessagesDelayed ?? 0),
    };
}

async function lastAuditWrite(tenantId: string) {
    // List most recent object for today's UTC partition; if none, fall back to previous day (simple best effort)
    const today = new Date().toISOString().slice(0, 10);
    const prefixes = [`tenantId=${tenantId}/date=${today}/`, `tenantId=${tenantId}/`]; // second one scans more broadly
    for (const Prefix of prefixes) {
        const out = await s3.send(new ListObjectsV2Command({
            Bucket: AUDIT_BUCKET, Prefix, MaxKeys: 1, StartAfter: undefined,
        }));
        const item = (out.Contents ?? []).sort((a, b) => (b.LastModified?.getTime() || 0) - (a.LastModified?.getTime() || 0))[0];
        if (item?.Key) {
            return { key: item.Key, lastModified: item.LastModified?.toISOString() };
        }
    }
    return null;
}

async function metricSumLast(minutes: number, metricName: string) {
    const end = new Date();
    const start = new Date(end.getTime() - minutes * 60 * 1000);
    const id = metricName.replace(/[^A-Za-z0-9]/g, "") + "Q";

    const queries: MetricDataQuery[] = [{
        Id: id.toLowerCase(),
        MetricStat: {
            Metric: { Namespace: NS, MetricName: metricName },
            Stat: "Sum",
            Period: 60,
        },
        ReturnData: true,
    }];

    const out = await cw.send(new GetMetricDataCommand({
        StartTime: start, EndTime: end, MetricDataQueries: queries, ScanBy: "TimestampDescending",
    }));

    const points = out.MetricDataResults?.[0]?.Values ?? [];
    const sum = points.reduce((acc, v) => acc + (v ?? 0), 0);
    return sum;
}

export const handler = async (event: any) => {
    try {
        const qs = event?.queryStringParameters ?? {};
        const windowMin = Math.max(5, Math.min(Number(qs.windowMin ?? 15), 1440));
        const reqTenant = qs.tenantId as string | undefined;

        const c = claims(event);
        const isAdmin = c.groups.includes("admin");

        const tenantId = reqTenant ?? c.tenantId ?? "";
        if (!isAdmin && (!tenantId || tenantId !== c.tenantId)) {
            return { statusCode: 403, body: JSON.stringify({ ok: false, error: "Forbidden" }) };
        }

        // Queue depths
        const [ingQ, ingDLQ, normQ, normDLQ, persQ, persDLQ] = await Promise.all([
            qDepth(Q.ingest.url), qDepth(Q.ingest.dlq),
            qDepth(Q.normalized.url), qDepth(Q.normalized.dlq),
            qDepth(Q.persisted.url), qDepth(Q.persisted.dlq),
        ]);

        // Metrics last N minutes (namespace etl.health)
        const [ingErr, dtoInvalid, perErr] = await Promise.all([
            metricSumLast(windowMin, "ingest_error_count"),
            metricSumLast(windowMin, "dto_invalid_count"),
            metricSumLast(windowMin, "persist_error_count"),
        ]);

        // Last audit write (tenant-scoped if we have tenantId)
        const lastAudit = tenantId ? await lastAuditWrite(tenantId) : null;

        return {
            statusCode: 200,
            body: JSON.stringify({
                ok: true,
                windowMin,
                queues: {
                    ingest: { main: ingQ, dlq: ingDLQ },
                    normalized: { main: normQ, dlq: normDLQ },
                    persisted: { main: persQ, dlq: persDLQ },
                },
                metrics: {
                    ingest_error_count: ingErr,
                    dto_invalid_count: dtoInvalid,
                    persist_error_count: perErr,
                },
                audit: lastAudit,
            }),
        };
    } catch (err: any) {
        return { statusCode: 500, body: JSON.stringify({ ok: false, error: err?.message ?? "Internal Error" }) };
    }
};
