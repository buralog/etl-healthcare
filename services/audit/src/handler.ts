import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

const s3 = new S3Client({});
const bucket = process.env.AUDIT_BUCKET!;

export const handler = async (event: any) => {
    // event may be any of: ingest.raw.v1, etl.normalized.v1, etl.persisted.v1
    const now = new Date();
    const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const tenantId = event?.tenantId ?? "unknown";
    const hour = String(now.getUTCHours()).padStart(2, "0");
    const key = `tenantId=${tenantId}/date=${date}/hour=${hour}/${randomUUID()}.jsonl`;

    const line = JSON.stringify({
        at: now.toISOString(),
        type: event?.type ?? "unknown",
        tenantId,
        traceId: event?.traceId,
        payload: event,
    }) + "\n";

    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: line }));
    return { ok: true, key };
};
