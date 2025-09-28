import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID, createHash } from "crypto";

const s3 = new S3Client({});

type Input = {
    tenantId: string;
    bucket: string;
    key: string;
    source?: string; // optional override
};

export const handler = async (input: Input) => {
    const { tenantId, bucket, key } = input;
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await obj.Body!.transformToString(); // Node 18+

    const id = randomUUID();
    const contentHash = createHash("sha256").update(body).digest("hex");
    const parsed = JSON.parse(body);

    // construct what your Normalize expects as "ingest.raw.v1"
    const message = {
        schema: "ingest.raw.v1",
        metadata: {
            tenantId,
            source: input.source ?? "reprocess",
            ingestedAt: new Date().toISOString(),
            idempotencyKey: id,
            contentHash,
        },
        payload: parsed.payload ?? parsed, // handle raw payload or wrapped
    };

    // Step Functions SQS task will use this string directly
    return { messageBody: JSON.stringify(message) };
};
