import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { SQSEvent, SQSRecord } from "aws-lambda";

import { validate } from "../../libs/contracts/src/validate";
import { auditFireAndForget } from "../../libs/obs/audit";
import type { IngestRawV1 } from "../../libs/contracts/src/types.ts/ingest.raw.v1";
import type { EtlNormalizedV1 } from "../../libs/contracts/src/types.ts/etl.normalized.v1";
import { metricCount, metricMs } from "../../libs/obs/metrics";

const sqs = new SQSClient({});
const NORMALIZED_QUEUE_URL = process.env.NORMALIZED_QUEUE_URL!;

// Transform helper (customize as you like)
function toNormalized(msg: IngestRawV1): EtlNormalizedV1 {
  const entityType = (msg.payload as any)?.studyInstanceUID ? "study" : "generic";
  const entityId = (msg.payload as any)?.studyInstanceUID ?? msg.metadata.idempotencyKey;

  return {
    schema: "etl.normalized.v1",
    metadata: {
      tenantId: msg.metadata.tenantId,
      source: msg.metadata.source,
      normalizedAt: new Date().toISOString(),
      idempotencyKey: msg.metadata.idempotencyKey,
      traceId: cryptoRandom(), // lightweight trace id
    },
    data: {
      entityType,
      entityId: String(entityId),
      patientId: (msg.payload as any)?.patientId,
      modality: (msg.payload as any)?.modality,
      attributes: { ...msg.payload }, // keep everything for now
    },
  };
}

function cryptoRandom() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export async function main(event: SQSEvent) {
  const t0Batch = Date.now();
  const failures: Array<{ itemIdentifier: string }> = [];

  await Promise.all(event.Records.map(async (rec: SQSRecord) => {
    const t0 = Date.now();
    try {
      const body = JSON.parse(rec.body);
      validate<IngestRawV1>("ingest.raw.v1", body);

      // transform
      const normalized = toNormalized(body);
      validate<EtlNormalizedV1>("etl.normalized.v1", normalized);

      // publish to NormalizedQueue
      await sqs.send(new SendMessageCommand({
        QueueUrl: NORMALIZED_QUEUE_URL,
        MessageBody: JSON.stringify(normalized),
        MessageAttributes: {
          schema: { DataType: "String", StringValue: "etl.normalized.v1" },
          tenantId: { DataType: "String", StringValue: body.metadata.tenantId },
        },
      }));

      // 🔹 Fire-and-forget AuditFn (lean payload)
      await auditFireAndForget({
        type: "etl.normalized.v1",
        tenantId: normalized.metadata.tenantId,
        traceId: normalized.metadata.traceId,
        object: {
          entityType: normalized.data.entityType,
          entityId: normalized.data.entityId,
        },
      });


      await metricCount("dto_valid_count", 1, { service: "normalize" });
      await metricMs("transform_time_ms", Date.now() - t0, { service: "normalize" });

    } catch (err) {
      await metricCount("dto_invalid_count", 1, { service: "normalize" });
      console.error("Normalize error for messageId", rec.messageId, err);
      failures.push({ itemIdentifier: rec.messageId });
    }
  }));

  await metricMs("normalize_batch_time_ms", Date.now() - t0Batch, { service: "normalize" });
  return { batchItemFailures: failures };
}
