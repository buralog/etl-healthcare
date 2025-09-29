import { S3Client, ListObjectsV2Command, type ListObjectsV2CommandOutput } from "@aws-sdk/client-s3";

const s3 = new S3Client({});
const AUDIT_BUCKET = process.env.AUDIT_BUCKET!;
const MAX_DEFAULT = 100;

function getClaims(event: any) {
    const claims = event?.requestContext?.authorizer?.claims ?? {};
    const groupsRaw = claims["cognito:groups"];
    const groups = Array.isArray(groupsRaw)
        ? groupsRaw
        : typeof groupsRaw === "string"
            ? groupsRaw.split(",").map((s) => s.trim())
            : [];
    return {
        tenantId: claims["custom:tenantId"],
        groups,
        email: claims["email"],
        sub: claims["sub"],
    };
}

export const handler = async (event: any) => {
    try {
        const qs = event?.queryStringParameters ?? {};
        const reqTenant = qs.tenantId || "";
        const date = qs.date || ""; // YYYY-MM-DD (UTC)
        const limit = Math.min(Number(qs.limit ?? MAX_DEFAULT), 500);

        if (!reqTenant || !date) {
            return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Missing tenantId or date (YYYY-MM-DD)" }) };
        }

        const claims = getClaims(event);
        const isAdmin = claims.groups.includes("admin");
        if (!isAdmin && claims.tenantId !== reqTenant) {
            return { statusCode: 403, body: JSON.stringify({ ok: false, error: "Forbidden" }) };
        }

        // audit partitioning: tenantId=<id>/date=<YYYY-MM-DD>/hour=HH/<uuid>.jsonl
        const Prefix = `tenantId=${reqTenant}/date=${date}/`;

        let ContinuationToken: string | undefined = undefined;
        const items: Array<{ key: string; size: number; lastModified?: string }> = [];

        do {
            const out: ListObjectsV2CommandOutput = await s3.send(new ListObjectsV2Command({
                Bucket: AUDIT_BUCKET,
                Prefix,
                ContinuationToken,
                MaxKeys: Math.min(1000, limit - items.length),
            }));
            (out.Contents ?? []).forEach(o => {
                if (!o.Key) return;
                items.push({
                    key: o.Key,
                    size: o.Size ?? 0,
                    lastModified: o.LastModified?.toISOString(),
                });
            });
            ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
        } while (ContinuationToken && items.length < limit);

        return {
            statusCode: 200,
            body: JSON.stringify({ ok: true, bucket: AUDIT_BUCKET, prefix: Prefix, count: items.length, items }),
        };
    } catch (err: any) {
        return { statusCode: 500, body: JSON.stringify({ ok: false, error: err?.message ?? "Internal Error" }) };
    }
};
