import { SQSClient, ReceiveMessageCommand, SendMessageCommand, DeleteMessageCommand, GetQueueAttributesCommand } from "@aws-sdk/client-sqs";

const sqs = new SQSClient({});

// env maps
const MAPPING = {
    ingest: { main: process.env.INGEST_Q_URL!, dlq: process.env.INGEST_DLQ_URL! },
    normalized: { main: process.env.NORMALIZED_Q_URL!, dlq: process.env.NORMALIZED_DLQ_URL! },
    persisted: { main: process.env.PERSISTED_Q_URL!, dlq: process.env.PERSISTED_DLQ_URL! },
};

type Body = { queue: keyof typeof MAPPING; max?: number };

function getClaims(event: any) {
    const claims = event?.requestContext?.authorizer?.claims ?? {};
    const groupsRaw = claims["cognito:groups"];
    const groups = Array.isArray(groupsRaw) ? groupsRaw
        : typeof groupsRaw === "string" ? claims["cognito:groups"].split(",").map((s: string) => s.trim()) : [];
    return { groups };
}

export const handler = async (event: any) => {
    try {
        const claims = getClaims(event);
        const isAdmin = claims.groups.includes("admin");
        if (!isAdmin) return { statusCode: 403, body: JSON.stringify({ ok: false, error: "Forbidden" }) };

        const body: Body = typeof event.body === "string" ? JSON.parse(event.body) : (event.body ?? {});
        const key = body.queue;
        const max = Math.max(1, Math.min(Number(body.max ?? 10), 100));

        if (!key || !(key in MAPPING)) {
            return { statusCode: 400, body: JSON.stringify({ ok: false, error: "queue must be one of: ingest|normalized|persisted" }) };
        }

        const { main, dlq } = MAPPING[key];
        // confirm there are messages
        const attrs = await sqs.send(new GetQueueAttributesCommand({
            QueueUrl: dlq,
            AttributeNames: ["ApproximateNumberOfMessages"],
        }));
        const approx = Number(attrs.Attributes?.ApproximateNumberOfMessages ?? 0);

        let moved = 0;
        while (moved < max) {
            const recv = await sqs.send(new ReceiveMessageCommand({
                QueueUrl: dlq,
                MaxNumberOfMessages: Math.min(10, max - moved),
                MessageAttributeNames: ["All"],
                AttributeNames: ["All"],
                VisibilityTimeout: 30,
                WaitTimeSeconds: 0,
            }));
            const messages = recv.Messages ?? [];
            if (messages.length === 0) break;

            for (const m of messages) {
                // Preserve body and message attributes
                await sqs.send(new SendMessageCommand({
                    QueueUrl: main,
                    MessageBody: m.Body ?? "",
                    MessageAttributes: m.MessageAttributes,
                }));
                // Delete from DLQ
                await sqs.send(new DeleteMessageCommand({
                    QueueUrl: dlq,
                    ReceiptHandle: m.ReceiptHandle!,
                }));
                moved++;
                if (moved >= max) break;
            }
        }

        return { statusCode: 200, body: JSON.stringify({ ok: true, queue: key, approxBefore: approx, moved }) };
    } catch (err: any) {
        return { statusCode: 500, body: JSON.stringify({ ok: false, error: err?.message ?? "Internal Error" }) };
    }
};
