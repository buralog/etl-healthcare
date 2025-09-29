import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { randomUUID } from "crypto";

const sfn = new SFNClient({});
const SFN_ARN = process.env.SFN_ARN!;

type Body = { tenantId: string; bucket: string; key: string };

function parseBody(event: any): Body {
    const raw = event?.body;
    const json = typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
    const { tenantId, bucket, key } = json || {};
    if (!tenantId || !bucket || !key) throw new Error("Missing tenantId/bucket/key");
    return { tenantId, bucket, key };
}

function getClaims(event: any) {
    // REST API + Cognito User Pools authorizer → claims appear here:
    const claims = event?.requestContext?.authorizer?.claims ?? {};
    // Some gateways put groups as CSV; normalize to array
    const groupsRaw = claims["cognito:groups"];
    const groups = Array.isArray(groupsRaw)
        ? groupsRaw
        : typeof groupsRaw === "string"
            ? groupsRaw.split(",").map((s) => s.trim())
            : [];
    return {
        sub: claims["sub"],
        email: claims["email"],
        tenantId: claims["custom:tenantId"],
        groups,
    };
}

export const handler = async (event: any) => {
    try {
        const { tenantId, bucket, key } = parseBody(event);
        const claims = getClaims(event);

        // AuthZ: allow admins for any tenant; otherwise require tenant match
        const isAdmin = claims.groups.includes("admin");
        if (!isAdmin && (!claims.tenantId || claims.tenantId !== tenantId)) {
            return { statusCode: 403, body: JSON.stringify({ error: "Forbidden" }) };
        }

        const name = `reproc-${tenantId}-${randomUUID()}`;
        const input = JSON.stringify({ tenantId, bucket, key });

        const out = await sfn.send(
            new StartExecutionCommand({
                stateMachineArn: SFN_ARN,
                name,
                input,
            })
        );

        return {
            statusCode: 202,
            body: JSON.stringify({ ok: true, executionArn: out.executionArn, startedAt: out.startDate }),
        };
    } catch (err: any) {
        const msg = err?.message ?? "Unknown error";
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: msg }) };
    }
};
