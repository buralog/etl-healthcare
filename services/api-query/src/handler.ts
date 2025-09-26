import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { AppSyncResolverEvent } from 'aws-lambda';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;
const TENANT_CLAIM = process.env.TENANT_CLAIM || 'custom:tenantId';
const GSI1_NAME = process.env.GSI1_NAME || 'GSI1V2';
const GSI2_NAME = process.env.GSI2_NAME || 'GSI2V2';

type Ctx = AppSyncResolverEvent<any> & { identity?: any };

function requireTenant(ctx: Ctx): string {
    const t = ctx.identity?.claims?.[TENANT_CLAIM];
    if (!t) throw new Error('Unauthorized: missing tenant claim');
    return String(t);
}

export const main = async (event: Ctx) => {
    try {
        const tenantId = requireTenant(event);

        switch (event.info.fieldName) {
            case 'getPatient':
                return getPatient(tenantId, event.arguments.id);
            case 'observationsByPatient':
                return observationsByPatient(tenantId, event.arguments);
            case 'latestObservation':
                return latestObservation(tenantId, event.arguments.patientId, event.arguments.code);
            default:
                throw new Error(`Unknown field ${event.info.fieldName}`);
        }
    } catch (err: any) {
        throw new Error(`Query error: ${err.message}`);
    }
};

async function getPatient(tenantId: string, patientId: string) {
    const PK = `TENANT#${tenantId}#PATIENT#${patientId}`;
    const SK = `META#${patientId}`;
    const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK, SK } }));
    if (!res.Item) return null;

    return {
        id: patientId,
        tenantId,
        name: res.Item.name,
        birthDate: res.Item.birthDate,
        lastUpdated: res.Item.lastUpdated,
    };
}

type ObsArgs = {
    patientId: string;
    code?: string | null;
    from?: string | null; // ISO
    to?: string | null;   // ISO
    limit?: number | null;
    nextToken?: string | null;
};

async function observationsByPatient(tenantId: string, args: ObsArgs) {
    const { patientId, code, from, to, limit = 25, nextToken } = args;
    // GSI2: TENANT#<t>#PATIENT#<patientId> → <effective>#OBS#<code>#<obsId>
    const GSI2PK = `TENANT#${tenantId}#PATIENT#${patientId}`;

    let keyCond = 'GSI2PK = :pk AND begins_with(GSI2SK, :prefix)';
    const prefix = from ? `${from}` : ''; // from-inclusive lower bound baked into starts-with window

    // If a specific code is passed, prefix uses <from or empty>#OBS#<code>
    const obsPrefix = `OBS#${code ?? ''}`; // if code is empty, we’ll filter after
    const startPrefix = prefix ? `${prefix}#${obsPrefix}` : obsPrefix;

    const params: any = {
        TableName: TABLE_NAME,
        IndexName: GSI2_NAME,
        KeyConditionExpression: keyCond,
        ExpressionAttributeValues: {
            ':pk': GSI2PK,
            ':prefix': startPrefix,
        },
        Limit: Math.min(100, Math.max(1, Number(limit || 25))),
        ExclusiveStartKey: nextToken ? JSON.parse(Buffer.from(nextToken, 'base64').toString()) : undefined,
        ScanIndexForward: true, // ascending by effective time
    };

    const res = await ddb.send(new QueryCommand(params));
    let items = (res.Items ?? []).map((it) => ({
        id: it.observationId,
        tenantId,
        patientId,
        code: it.code,
        value: it.value,
        unit: it.unit,
        effective: it.effectiveDateTime,
    }));

    // Optional server-side filter by code/to (to is an upper bound)
    if (code) items = items.filter((x) => x.code === code);
    if (to) items = items.filter((x) => x.effective <= to);

    return {
        items,
        nextToken: res.LastEvaluatedKey ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString('base64') : null,
    };
}

async function latestObservation(tenantId: string, patientId: string, code: string) {
    // GSI1: TENANT#<t>#CODE#<code>#<yyyymm> → <effective>#<patientId>#<obsId>
    // For simplicity, query GSI2 descending and stop at first match.
    const GSI2PK = `TENANT#${tenantId}#PATIENT#${patientId}`;

    const res = await ddb.send(new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: GSI2_NAME,
        KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :prefix)',
        ExpressionAttributeValues: {
            ':pk': GSI2PK,
            ':prefix': 'OBS#', // all observations
        },
        Limit: 50,
        ScanIndexForward: false, // latest first
    }));

    const match = (res.Items ?? []).find((it) => it.code === code);
    if (!match) return null;

    return {
        id: match.observationId,
        tenantId,
        patientId,
        code: match.code,
        value: match.value,
        unit: match.unit,
        effective: match.effectiveDateTime, // <- use the same attribute
    };
}
