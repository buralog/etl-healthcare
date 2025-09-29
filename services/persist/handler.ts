import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { SQSEvent, SQSRecord } from "aws-lambda";

import { validate } from "../../libs/contracts/src/validate";
import { auditFireAndForget } from "../../libs/obs/audit";
import type { EtlNormalizedV1 } from "../../libs/contracts/src/types.ts/etl.normalized.v1";
import type { EtlPersistedV1 } from "../../libs/contracts/src/types.ts/etl.persisted.v1";
import { metricCount, metricMs } from "../../libs/obs/metrics";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});
const sqs = new SQSClient({});

const TABLE_NAME = process.env.TABLE_NAME!;
const PERSISTED_QUEUE_URL = process.env.PERSISTED_QUEUE_URL!;

function keys(n: EtlNormalizedV1) {
    const PK = `TENANT#${n.metadata.tenantId}`;
    const SK = `ENTITY#${n.data.entityType}#${n.data.entityId}`;
    const GSI1PK = `ENTITY#${n.data.entityType}#${n.data.entityId}`;
    const GSI1SK = `TENANT#${n.metadata.tenantId}`;
    return { PK, SK, GSI1PK, GSI1SK };
}

export async function main(event: SQSEvent) {
    const failures: Array<{ itemIdentifier: string }> = [];

    await Promise.all(event.Records.map(async (rec: SQSRecord) => {
        const t0 = Date.now();
        try {
            const body = JSON.parse(rec.body);
            validate<EtlNormalizedV1>("etl.normalized.v1", body);
            const { PK, SK, GSI1PK, GSI1SK } = keys(body);

            const now = new Date().toISOString();
            const update = new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { PK, SK },
                UpdateExpression: [
                    "SET #et = :et",
                    "#eid = :eid",
                    "#attrs = :attrs",
                    "#tenantId = :tenantId",
                    "#updatedAt = :now",
                    "#idk = :idk",
                    "#g1pk = :g1pk",
                    "#g1sk = :g1sk",
                    "#ver = if_not_exists(#ver, :zero) + :one"
                ].join(", "),
                ConditionExpression: "attribute_not_exists(#idk) OR #idk <> :idk",
                ExpressionAttributeNames: {
                    "#et": "entityType",
                    "#eid": "entityId",
                    "#attrs": "attributes",
                    "#tenantId": "tenantId",
                    "#updatedAt": "updatedAt",
                    "#idk": "idempotencyKey",
                    "#g1pk": "GSI1PK",
                    "#g1sk": "GSI1SK",
                    "#ver": "version",
                },
                ExpressionAttributeValues: {
                    ":et": body.data.entityType,
                    ":eid": String(body.data.entityId),
                    ":attrs": body.data.attributes ?? {},
                    ":tenantId": body.metadata.tenantId,
                    ":now": now,
                    ":idk": body.metadata.idempotencyKey,
                    ":g1pk": GSI1PK,
                    ":g1sk": GSI1SK,
                    ":zero": 0,
                    ":one": 1,
                },
                ReturnValues: "ALL_NEW",
            });

            const result = await ddb.send(update);
            const version = (result as any)?.Attributes?.version ?? undefined;

            const persisted: EtlPersistedV1 = {
                schema: "etl.persisted.v1",
                metadata: {
                    tenantId: body.metadata.tenantId,
                    persistedAt: now,
                    traceId: body.metadata.idempotencyKey,
                },
                record: {
                    pk: PK,
                    sk: SK,
                    gsi1pk: GSI1PK,
                    gsi1sk: GSI1SK,
                    entityType: body.data.entityType,
                    entityId: String(body.data.entityId),
                    attributes: body.data.attributes ?? {},
                    version, // optional
                },
            };

            // Publish persisted event
            await sqs.send(new SendMessageCommand({
                QueueUrl: PERSISTED_QUEUE_URL,
                MessageBody: JSON.stringify(persisted),
                MessageAttributes: {
                    schema: { DataType: "String", StringValue: "etl.persisted.v1" },
                    tenantId: { DataType: "String", StringValue: body.metadata.tenantId },
                },
            }));

            // 🔹 Fire-and-forget AuditFn (lean payload)
            await auditFireAndForget({
                type: "etl.persisted.v1",
                tenantId: body.metadata.tenantId,
                traceId: body.metadata.idempotencyKey,
                ddb: { pk: PK, sk: SK, version },
            });

            await metricCount("persist_success_count", 1, { service: "persist" });
            await metricMs("persist_time_ms", Date.now() - t0, { service: "persist" });

        } catch (err) {
            await metricCount("persist_error_count", 1, { service: "persist" });
            console.error("Persist error for messageId", rec.messageId, err);
            failures.push({ itemIdentifier: rec.messageId });
        }
    }));

    return { batchItemFailures: failures };
}
