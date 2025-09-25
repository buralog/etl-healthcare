import { Duration, Stack, StackProps, Tags } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "path";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";

interface NormalizeStackProps extends StackProps {
  ingestQueue: sqs.IQueue;
  normalizedQueue: sqs.IQueue;
}

export class NormalizeStack extends Stack {
  constructor(scope: Construct, id: string, props: NormalizeStackProps) {
    super(scope, id, props);

    Tags.of(this).add("app", "etl-healthcare");
    Tags.of(this).add("stack", "normalize");

    const entry = path.resolve(__dirname, "../../services/normalize/handler.ts");

    const fn = new NodejsFunction(this, "NormalizeFn", {
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
      },
    });

    // Trigger from IngestQueue (with partial batch failure support)
    fn.addEventSource(new SqsEventSource(props.ingestQueue, {
      batchSize: 10,
      maxBatchingWindow: Duration.seconds(5),
      reportBatchItemFailures: true,
    }));

    // Permissions to publish normalized events
    props.normalizedQueue.grantSendMessages(fn);
  }
}
