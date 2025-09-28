import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
const lambda = new LambdaClient({});
const AUDIT_FN_ARN = process.env.AUDIT_FN_ARN;

export async function auditFireAndForget(payload: unknown) {
  if (!AUDIT_FN_ARN) return;
  try {
    await lambda.send(
      new InvokeCommand({
        FunctionName: AUDIT_FN_ARN,
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify(payload)),
      })
    );
  } catch (e) {
    console.warn("audit-invoke-failed", (e as Error).message);
  }
}
