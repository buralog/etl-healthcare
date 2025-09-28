import { randomUUID, createHash } from "crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { auditFireAndForget } from "../../libs/obs/audit";

const s3 = new S3Client({});
const sqs = new SQSClient({});

const RAW_BUCKET = process.env.RAW_BUCKET!;
const INGEST_QUEUE_URL = process.env.INGEST_QUEUE_URL!;

export async function main(event: any) {
  try {
    const body = JSON.parse(event.body ?? "{}");

    // Compute IDs
    const id = randomUUID();
    const tenantId = body?.metadata?.tenantId ?? "unknown";
    const today = new Date().toISOString().slice(0, 10);
    const key = `raw/${tenantId}/${today}/${id}.json`;

    const content = JSON.stringify(body);
    const contentHash = createHash("sha256").update(content).digest("hex");

    // Save to S3
    await s3.send(new PutObjectCommand({
      Bucket: RAW_BUCKET,
      Key: key,
      Body: content,
      ContentType: "application/json",
      Metadata: { contentHash },
    }));

    // Build envelope for pipeline
    const message = {
      schema: "ingest.raw.v1",
      metadata: {
        tenantId,
        source: body?.metadata?.source ?? "unknown",
        ingestedAt: new Date().toISOString(),
        idempotencyKey: body?.metadata?.idempotencyKey ?? id,
        contentHash,
      },
      payload: body.payload ?? body,
    };

    // Publish to SQS
    await sqs.send(new SendMessageCommand({
      QueueUrl: INGEST_QUEUE_URL,
      MessageBody: JSON.stringify(message),
    }));

    await auditFireAndForget({
      type: "ingest.raw.v1",
      tenantId,
      ingestId: id,
      s3: { bucket: RAW_BUCKET, key },
      traceId: id,
      payload: message.payload,
    });

    return { statusCode: 202, body: JSON.stringify({ ok: true, key, message }) };
  } catch (err) {
    console.error("Ingest error", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Internal Error" }) };
  }
}

