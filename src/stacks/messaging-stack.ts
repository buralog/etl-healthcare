import { Stack, StackProps, Duration, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as sqs from "aws-cdk-lib/aws-sqs";

export class MessagingStack extends Stack {
  public readonly ingestQueue: sqs.Queue;
  public readonly normalizedQueue: sqs.Queue;
  public readonly persistedQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // DLQs
    const ingestDLQ = new sqs.Queue(this, "IngestDLQ", {
      retentionPeriod: Duration.days(14)
    });
    const normalizedDLQ = new sqs.Queue(this, "NormalizedDLQ", {
      retentionPeriod: Duration.days(14)
    });
    const persistedDLQ = new sqs.Queue(this, "PersistedDLQ", {
      retentionPeriod: Duration.days(14)
    });

    // Main queues
    this.ingestQueue = new sqs.Queue(this, "IngestQueue", {
      visibilityTimeout: Duration.seconds(60),
      retentionPeriod: Duration.days(4),
      deliveryDelay: Duration.seconds(0),
      deadLetterQueue: { queue: ingestDLQ, maxReceiveCount: 5 }
    });

    this.normalizedQueue = new sqs.Queue(this, "NormalizedQueue", {
      visibilityTimeout: Duration.seconds(60),
      retentionPeriod: Duration.days(4),
      deadLetterQueue: { queue: normalizedDLQ, maxReceiveCount: 5 }
    });

    this.persistedQueue = new sqs.Queue(this, "PersistedQueue", {
      visibilityTimeout: Duration.seconds(60),
      retentionPeriod: Duration.days(4),
      deadLetterQueue: { queue: persistedDLQ, maxReceiveCount: 5 }
    });

    new CfnOutput(this, "IngestQueueUrl", { value: this.ingestQueue.queueUrl });
    new CfnOutput(this, "NormalizedQueueUrl", { value: this.normalizedQueue.queueUrl });
    new CfnOutput(this, "PersistedQueueUrl", { value: this.persistedQueue.queueUrl });
  }
}
