import { Duration, Stack, StackProps, Tags } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "path";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import * as iam from "aws-cdk-lib/aws-iam";

interface NormalizeStackProps extends StackProps {
  ingestQueue: sqs.IQueue;
  normalizedQueue: sqs.IQueue;
  auditFn?: lambda.IFunction;
  rawBucket: s3.IBucket;  
}

export class NormalizeStack extends Stack {
  public readonly fn: NodejsFunction;
  constructor(scope: Construct, id: string, props: NormalizeStackProps) {
    super(scope, id, props);

    Tags.of(this).add("app", "etl-healthcare");
    Tags.of(this).add("stack", "normalize");

    const entry = path.resolve(__dirname, "../../services/normalize/handler.ts");

    this.fn = new NodejsFunction(this, "NormalizeFn", {
      entry,
      handler: "main",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      memorySize: 256,
      bundling: {
        externalModules: ["aws-sdk"], // leave v2 external
        target: "node20",
        sourceMap: true,
        keepNames: true,
      },
      environment: {
        NORMALIZED_QUEUE_URL: props.normalizedQueue.queueUrl,
        ...(props.auditFn ? { AUDIT_FN_ARN: props.auditFn.functionArn } : {}),
      },
    });

    this.fn.addEnvironment("METRICS_NS", "etl.health");
    this.fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ["cloudwatch:PutMetricData"],
      resources: ["*"],
      conditions: { "StringEquals": { "cloudwatch:namespace": "etl.health" } },
    }));

    // Trigger from IngestQueue (with partial batch failure support)
    this.fn.addEventSource(new SqsEventSource(props.ingestQueue, {
      batchSize: 10,
      maxBatchingWindow: Duration.seconds(5),
      reportBatchItemFailures: true,
    }));

    // Permissions to publish normalized events
    props.normalizedQueue.grantSendMessages(this.fn);
    props.rawBucket.grantRead(this.fn);
    this.fn.addEnvironment("RAW_BUCKET_NAME", props.rawBucket.bucketName);

    // Permit invoke if provided
    if (props.auditFn) {
      props.auditFn.grantInvoke(this.fn);
    }
  }
}
