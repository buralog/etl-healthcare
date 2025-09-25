import { Stack, StackProps, Duration, CfnOutput, Tags } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as iam from "aws-cdk-lib/aws-iam";

export class MessagingStack extends Stack {
  public readonly ingestQueue: sqs.Queue;
  public readonly normalizedQueue: sqs.Queue;
  public readonly persistedQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    Tags.of(this).add("app", "etl-healthcare");
    Tags.of(this).add("stack", "messaging");

    // DLQs (14d retention)
    const ingestDLQ = new sqs.Queue(this, "IngestDLQ", {
      queueName: "etl-ingest-queue-dlq",
      retentionPeriod: Duration.days(14),
      visibilityTimeout: Duration.seconds(180),
      receiveMessageWaitTime: Duration.seconds(20),
    });
    const normalizedDLQ = new sqs.Queue(this, "NormalizedDLQ", {
      queueName: "etl-normalized-queue-dlq",
      retentionPeriod: Duration.days(14),
      visibilityTimeout: Duration.seconds(180),
      receiveMessageWaitTime: Duration.seconds(20),
    });
    const persistedDLQ = new sqs.Queue(this, "PersistedDLQ", {
      queueName: "etl-persisted-queue-dlq",
      retentionPeriod: Duration.days(14),
      visibilityTimeout: Duration.seconds(180),
      receiveMessageWaitTime: Duration.seconds(20),
    });

    // Main queues (7d retention, long polling, DLQ wiring)
    this.ingestQueue = new sqs.Queue(this, "IngestQueue", {
      queueName: "etl-ingest-queue",
      visibilityTimeout: Duration.seconds(180),
      retentionPeriod: Duration.days(7),
      receiveMessageWaitTime: Duration.seconds(20),
      deliveryDelay: Duration.seconds(0),
      deadLetterQueue: { queue: ingestDLQ, maxReceiveCount: 5 },
    });

    this.normalizedQueue = new sqs.Queue(this, "NormalizedQueue", {
      queueName: "etl-normalized-queue",
      visibilityTimeout: Duration.seconds(180),
      retentionPeriod: Duration.days(7),
      receiveMessageWaitTime: Duration.seconds(20),
      deadLetterQueue: { queue: normalizedDLQ, maxReceiveCount: 5 },
    });

    this.persistedQueue = new sqs.Queue(this, "PersistedQueue", {
      queueName: "etl-persisted-queue",
      visibilityTimeout: Duration.seconds(180),
      retentionPeriod: Duration.days(7),
      receiveMessageWaitTime: Duration.seconds(20),
      deadLetterQueue: { queue: persistedDLQ, maxReceiveCount: 5 },
    });

    // (Optional) Enforce TLS for all SQS actions
    [this.ingestQueue, this.normalizedQueue, this.persistedQueue,
     ingestDLQ, normalizedDLQ, persistedDLQ].forEach((q) => {
      q.addToResourcePolicy(new iam.PolicyStatement({
        sid: "DenyInsecureTransport",
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ["sqs:*"],
        resources: [q.queueArn],
        conditions: { Bool: { "aws:SecureTransport": "false" } },
      }));
    });

    // Outputs (URLs + ARNs + DLQ URLs)
    new CfnOutput(this, "IngestQueueUrl", { value: this.ingestQueue.queueUrl });
    new CfnOutput(this, "IngestQueueArn", { value: this.ingestQueue.queueArn });
    new CfnOutput(this, "IngestDLQUrl", { value: ingestDLQ.queueUrl });

    new CfnOutput(this, "NormalizedQueueUrl", { value: this.normalizedQueue.queueUrl });
    new CfnOutput(this, "NormalizedQueueArn", { value: this.normalizedQueue.queueArn });
    new CfnOutput(this, "NormalizedDLQUrl", { value: normalizedDLQ.queueUrl });

    new CfnOutput(this, "PersistedQueueUrl", { value: this.persistedQueue.queueUrl });
    new CfnOutput(this, "PersistedQueueArn", { value: this.persistedQueue.queueArn });
    new CfnOutput(this, "PersistedDLQUrl", { value: persistedDLQ.queueUrl });
  }
}
