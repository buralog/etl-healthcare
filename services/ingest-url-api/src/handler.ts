import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

const s3 = new S3Client({});
const RAW_BUCKET = process.env.RAW_BUCKET!;
const EXPIRES = Number(process.env.EXPIRES_SECONDS ?? 900); // 15 min default

type Body = {
    tenantId?: string;
    contentType?: string; // e.g. "application/json"
    // optional: filename?: string; // if you want to suggest a name
};

function parseBody(event: any): Body {
    const raw = event?.body;
    return typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
}

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
        const body = parseBody(event);
        const claims = getClaims(event);

        const requestedTenant = body.tenantId ?? claims.tenantId;
        if (!requestedTenant) {
            return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Missing tenantId" }) };
        }

        const isAdmin = claims.groups.includes("admin");
        if (!isAdmin && claims.tenantId !== requestedTenant) {
            return { statusCode: 403, body: JSON.stringify({ ok: false, error: "Forbidden" }) };
        }

        const contentType = body.contentType ?? "application/json";
        const date = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
        const id = randomUUID();
        const key = `raw/${requestedTenant}/${date}/${id}.json`;

        const cmd = new PutObjectCommand({
            Bucket: RAW_BUCKET,
            Key: key,
            ContentType: contentType,
            // Optional: server-side encryption by bucket policy/KMS is fine; no need to set here.
            // You can also pass Metadata if you want to pre-tag the object.
        });

        const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: EXPIRES });

        return {
            statusCode: 200,
            body: JSON.stringify({
                ok: true,
                key,
                uploadUrl,
                expiresInSeconds: EXPIRES,
                requiredHeaders: { "Content-Type": contentType },
                note: "After uploading, call POST /reprocess with { tenantId, bucket, key } to run the pipeline.",
            }),
        };
    } catch (err: any) {
        return { statusCode: 500, body: JSON.stringify({ ok: false, error: err?.message ?? "Internal Error" }) };
    }
};
