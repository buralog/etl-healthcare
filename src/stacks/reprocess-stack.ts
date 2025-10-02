import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "path";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";

export interface ReprocessStackProps extends StackProps {
    rawBucket: s3.IBucket;
    ingestQueue: sqs.IQueue;
}

export class ReprocessStack extends Stack {
    public readonly stateMachine: sfn.StateMachine;

    constructor(scope: Construct, id: string, props: ReprocessStackProps) {
        super(scope, id, props);

        const prepFn = new NodejsFunction(this, "ReprocessPrepFn", {
            entry: path.join(process.cwd(), "services", "reprocess-prep", "src", "handler.ts"),
            handler: "main",
            runtime: lambda.Runtime.NODEJS_20_X,
            timeout: Duration.seconds(10),
        });

        // Permissions for prep function to read raw S3
        // props.rawBucket.grantRead(prepFn);

        // Task 1: build ingest.raw.v1 message from S3 object
        const prepTask = new tasks.LambdaInvoke(this, "PrepMessageFromS3", {
            lambdaFunction: prepFn,
            payloadResponseOnly: true, // we only keep { messageBody }
        });

        // Task 2: push to the Ingest queue (Normalize will consume)
        const sendToIngest = new tasks.SqsSendMessage(this, "SendToIngestQueue", {
            queue: props.ingestQueue,
            messageBody: sfn.TaskInput.fromJsonPathAt("$.messageBody"),
        });

        const definition = prepTask.next(sendToIngest);

        this.stateMachine = new sfn.StateMachine(this, "EtlReprocessStateMachine", {
            definition,
            timeout: Duration.minutes(2),
        });
    }
}
