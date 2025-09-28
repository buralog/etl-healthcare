import { Duration, Stack, StackProps, Tags } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import * as path from "path";

interface PersistStackProps extends StackProps {
  normalizedQueue: sqs.IQueue;
  persistedQueue: sqs.IQueue;
  table: dynamodb.ITable;
  auditFn?: lambda.IFunction;
}

export class PersistStack extends Stack {
  constructor(scope: Construct, id: string, props: PersistStackProps) {
    super(scope, id, props);

    Tags.of(this).add("app", "etl-healthcare");
    Tags.of(this).add("stack", "persist");

    const entry = path.resolve(__dirname, "../../services/persist/handler.ts");

    const fn = new NodejsFunction(this, "PersistFn", {
      entry,
      handler: "main",
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: {
        externalModules: ["aws-sdk"],
        target: "node20",
        sourceMap: true,
        keepNames: true,
      },
      environment: {
        TABLE_NAME: props.table.tableName,
        PERSISTED_QUEUE_URL: props.persistedQueue.queueUrl,
        ...(props.auditFn ? { AUDIT_FN_ARN: props.auditFn.functionArn } : {}),
      },
    });

    // Event source: consume normalized events
    fn.addEventSource(new SqsEventSource(props.normalizedQueue, {
      batchSize: 10,
      maxBatchingWindow: Duration.seconds(5),
      reportBatchItemFailures: true,
    }));

    // Least-privilege
    props.table.grantReadWriteData(fn);
    props.persistedQueue.grantSendMessages(fn);

    // Permit invoke if provided
    if (props.auditFn) {
      props.auditFn.grantInvoke(fn);
    }
  }
}
