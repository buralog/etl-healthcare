import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import type { SQSEvent, SQSRecord } from "aws-lambda";

import { validate } from "../../libs/contracts/src/validate";
import type { IngestRawV1 } from "../../libs/contracts/src/types.ts/ingest.raw.v1";
import type { EtlNormalizedV1 } from "../../libs/contracts/src/types.ts/etl.normalized.v1";

import { auditFireAndForget } from "../../libs/obs/audit";
import { metricCount, metricMs } from "../../libs/obs/metrics";

// Adapters + validation/mapping
import { parseLabxCsv } from "../../libs/adapters";
import { parseHl7v2 } from "../../libs/adapters";

import { validateObservation } from "../../libs/validation/fhir-ajv";
import { NormalizedObservationSchema, type NormalizedObservation } from "../../libs/validation/dto";
import { dtoToFhirObservation } from "../../libs/mappers/observation";


const sqs = new SQSClient({});
const s3 = new S3Client({});
const NORMALIZED_QUEUE_URL = process.env.NORMALIZED_QUEUE_URL!;

function cryptoRandom() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

async function getS3Body(bucket: string, key: string): Promise<Buffer> {
  const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks: Uint8Array[] = [];
  // @ts-expect-error: Node stream in Lambda
  for await (const chunk of out.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function buildNormalizedEventFromDto(dto: NormalizedObservation, meta: IngestRawV1["metadata"]): EtlNormalizedV1 {
  return {
    schema: "etl.normalized.v1",
    metadata: {
      tenantId: meta.tenantId,
      source: meta.source,
      normalizedAt: new Date().toISOString(),
      idempotencyKey: meta.idempotencyKey,
      traceId: cryptoRandom(),
    },
    data: {
      entityType: "observation",
      entityId: `${dto.patientId}:${dto.code}:${dto.effectiveDateTime}`,
      patientId: dto.patientId,
      modality: undefined,
      attributes: {
        dto,
        fhir: dtoToFhirObservation(dto),
      },
    },
  };
}

function isCsvIngest(msg: IngestRawV1): boolean {
  const ct = (msg as any)?.metadata?.contentType || (msg as any)?.payload?.contentType;
  const key = (msg as any)?.payload?.s3?.key || (msg as any)?.metadata?.s3?.key;
  return (typeof ct === "string" && ct.includes("text/csv")) || (typeof key === "string" && key.endsWith(".csv"));
}

function isHl7Ingest(msg: IngestRawV1): boolean {
  const ct = (msg as any)?.metadata?.contentType || (msg as any)?.payload?.contentType;
  const key = (msg as any)?.payload?.s3?.key || (msg as any)?.metadata?.s3?.key;
  return (typeof key === "string" && key.toLowerCase().endsWith(".hl7"))
    || (typeof ct === "string" && (ct.includes("x-hl7") || ct.includes("hl7") || ct.includes("text/plain")));
}


export async function main(event: SQSEvent) {
  const t0Batch = Date.now();
  const failures: Array<{ itemIdentifier: string }> = [];

  await Promise.all(event.Records.map(async (rec: SQSRecord) => {
    const t0 = Date.now();
    try {
      const body = JSON.parse(rec.body);
      validate<IngestRawV1>("ingest.raw.v1", body);

      // Branch: CSV vs generic JSON
      if (isCsvIngest(body)) {
        const bucket =
          (body.payload as any)?.s3?.bucket ??
          (body as any)?.metadata?.s3?.bucket;
        const key =
          (body.payload as any)?.s3?.key ??
          (body as any)?.metadata?.s3?.key;

        if (!bucket || !key) {
          throw new Error("CSV ingest missing s3 bucket/key");
        }

        // Fetch & parse CSV → DTOs
        const buf = await getS3Body(bucket, key);
        const dtos = parseLabxCsv(buf, { tenantId: body.metadata.tenantId, sourceSystem: "csv:labx" });

        for (const dto of dtos) {
          try {
            // Zod already ran in adapter; defensively re-assert
            NormalizedObservationSchema.parse(dto);

            // Map DTO → FHIR and AJV-validate minimal Observation
            const fhir = dtoToFhirObservation(dto);
            const v = validateObservation(fhir);
            if (!v.ok) {
              await metricCount("fhir_invalid_count", 1, { service: "normalize" });
              console.warn("FHIR invalid", v.errors);
              continue; // skip this row
            }

            const normalized = buildNormalizedEventFromDto(dto, body.metadata);

            await sqs.send(new SendMessageCommand({
              QueueUrl: NORMALIZED_QUEUE_URL,
              MessageBody: JSON.stringify(normalized),
              MessageAttributes: {
                schema: { DataType: "String", StringValue: "etl.normalized.v1" },
                tenantId: { DataType: "String", StringValue: body.metadata.tenantId },
              },
            }));

            await auditFireAndForget({
              type: "etl.normalized.v1",
              tenantId: normalized.metadata.tenantId,
              traceId: normalized.metadata.traceId,
              object: {
                entityType: normalized.data.entityType,
                entityId: normalized.data.entityId,
              },
            });

            await metricCount("normalize_count", 1, { service: "normalize" });
          } catch (rowErr) {
            await metricCount("dto_invalid_count", 1, { service: "normalize" });
            console.error("Normalize CSV row error", (rowErr as Error).message);
          }
        }

        await metricMs("transform_time_ms", Date.now() - t0, { service: "normalize" });
      } else if (isHl7Ingest(body)) {
        const bucket =
          (body.payload as any)?.s3?.bucket ??
          (body as any)?.metadata?.s3?.bucket;
        const key =
          (body.payload as any)?.s3?.key ??
          (body as any)?.metadata?.s3?.key;

        if (!bucket || !key) throw new Error("HL7 ingest missing s3 bucket/key");

        const buf = await getS3Body(bucket, key);
        const dtos = parseHl7v2(buf, { tenantId: body.metadata.tenantId, sourceSystem: "hl7v2:file" });

        for (const dto of dtos) {
          try {
            // DTO is already Zod-validated in adapter; defensively re-assert:
            NormalizedObservationSchema.parse(dto);

            const fhir = dtoToFhirObservation(dto);
            const v = validateObservation(fhir);
            if (!v.ok) {
              await metricCount("fhir_invalid_count", 1, { service: "normalize" });
              console.warn("FHIR invalid", v.errors);
              continue;
            }

            const normalized = buildNormalizedEventFromDto(dto, body.metadata);

            await sqs.send(new SendMessageCommand({
              QueueUrl: NORMALIZED_QUEUE_URL,
              MessageBody: JSON.stringify(normalized),
              MessageAttributes: {
                schema: { DataType: "String", StringValue: "etl.normalized.v1" },
                tenantId: { DataType: "String", StringValue: body.metadata.tenantId },
              },
            }));

            await auditFireAndForget({
              type: "etl.normalized.v1",
              tenantId: normalized.metadata.tenantId,
              traceId: normalized.metadata.traceId,
              object: {
                entityType: normalized.data.entityType,
                entityId: normalized.data.entityId,
              },
            });

            await metricCount("normalize_count", 1, { service: "normalize" });
          } catch (rowErr) {
            await metricCount("dto_invalid_count", 1, { service: "normalize" });
            console.error("Normalize HL7 row error", (rowErr as Error).message);
          }
        }

        await metricMs("transform_time_ms", Date.now() - t0, { service: "normalize" });
      } else {
        // Generic JSON path (existing behavior)
        const entityType: "observation" | "study" | "patient" =
          (body.payload as any)?.studyInstanceUID ? "study" : "observation";
        const entityId = (body.payload as any)?.studyInstanceUID ?? body.metadata.idempotencyKey;

        const normalized: EtlNormalizedV1 = {
          schema: "etl.normalized.v1",
          metadata: {
            tenantId: body.metadata.tenantId,
            source: body.metadata.source,
            normalizedAt: new Date().toISOString(),
            idempotencyKey: body.metadata.idempotencyKey,
            traceId: cryptoRandom(),
          },
          data: {
            entityType,
            entityId: String(entityId),
            patientId: (body.payload as any)?.patientId,
            modality: (body.payload as any)?.modality,
            attributes: { ...body.payload },
          },
        };

        // Validate envelope shape (optional; you already validate after build)
        validate<EtlNormalizedV1>("etl.normalized.v1", normalized);

        await sqs.send(new SendMessageCommand({
          QueueUrl: NORMALIZED_QUEUE_URL,
          MessageBody: JSON.stringify(normalized),
          MessageAttributes: {
            schema: { DataType: "String", StringValue: "etl.normalized.v1" },
            tenantId: { DataType: "String", StringValue: body.metadata.tenantId },
          },
        }));

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
      }
    } catch (err) {
      await metricCount("dto_invalid_count", 1, { service: "normalize" });
      console.error("Normalize error for messageId", rec.messageId, err);
      failures.push({ itemIdentifier: rec.messageId });
    }
  }));

  await metricMs("normalize_batch_time_ms", Date.now() - t0Batch, { service: "normalize" });
  return { batchItemFailures: failures };
}
