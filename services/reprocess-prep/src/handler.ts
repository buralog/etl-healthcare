import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const sqs = new SQSClient({});
const INGEST_QUEUE_URL = process.env.INGEST_QUEUE_URL!;

/**
 * Accepts { tenantId, bucket, key } from Step Functions (or API pass-through).
 * Publishes ingest.raw.v1 with payload.s3, without reading/parsing the file.
 */
// services/reprocess-prep/src/handler.ts
export async function main(event: any) {
    const body = typeof event?.body === "string" ? JSON.parse(event.body) : event;
    const tenantId = body?.tenantId ?? event?.queryStringParameters?.tenantId;
    const bucket = body?.bucket ?? event?.queryStringParameters?.bucket;
    const key = body?.key ?? event?.queryStringParameters?.key;

    if (!tenantId || !bucket || !key) {
        return { messageBody: JSON.stringify({ error: "tenantId, bucket, key are required" }) };
    }

    const ext = (key.toLowerCase().split(".").pop() || "");
    const contentType =
        ext === "csv" ? "text/csv" :
            ext === "hl7" ? "application/hl7-v2" :
                ext === "json" ? "application/json" : "text/plain";

    const msg = {
        schema: "ingest.raw.v1",
        metadata: {
            tenantId,
            source: "reprocess",
            ingestedAt: new Date().toISOString(),
            idempotencyKey: `reproc:${key}`,
            // ⚠️ DO NOT add contentType or s3 here
        },
        payload: {
            s3: { bucket, key },   // ✅ lives in payload
            contentType,           // ✅ lives in payload
        },
    };

    console.log("reprocess-prep message", JSON.stringify(msg)); // <-- helps confirm in logs
    return { messageBody: JSON.stringify(msg) };
}


// import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
// import { randomUUID, createHash } from "crypto";

// const s3 = new S3Client({});

// type Input = {
//     tenantId: string;
//     bucket: string;
//     key: string;
//     source?: string; // optional override
// };

// export const handler = async (input: Input) => {
//     const { tenantId, bucket, key } = input;
//     const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
//     const body = await obj.Body!.transformToString(); // Node 18+

//     const id = randomUUID();
//     const contentHash = createHash("sha256").update(body).digest("hex");
//     const parsed = JSON.parse(body);

//     // construct what your Normalize expects as "ingest.raw.v1"
//     const message = {
//         schema: "ingest.raw.v1",
//         metadata: {
//             tenantId,
//             source: input.source ?? "reprocess",
//             ingestedAt: new Date().toISOString(),
//             idempotencyKey: id,
//             contentHash,
//         },
//         payload: parsed.payload ?? parsed, // handle raw payload or wrapped
//     };

//     // Step Functions SQS task will use this string directly
//     return { messageBody: JSON.stringify(message) };
// };
