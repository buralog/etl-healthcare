import { Stack, StackProps, RemovalPolicy, Duration, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as kms from "aws-cdk-lib/aws-kms";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as tags from "aws-cdk-lib";

export class DataStack extends Stack {
  public readonly dataKey: kms.Key;
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Customer-managed KMS key for DDB (rotates yearly)
    this.dataKey = new kms.Key(this, "DataKey", {
      alias: "alias/etl-data-key",
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.DESTROY // dev; change to RETAIN for prod
    });

    // DynamoDB single-table (on-demand)
    this.table = new dynamodb.Table(this, "EtlTable", {
      tableName: "etl-healthcare",
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.DESTROY, // dev only
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.dataKey
    });

    this.table.addGlobalSecondaryIndex({
      indexName: "GSI1V2",
      partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: "GSI2V2",
      partitionKey: { name: "GSI2PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI2SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });


    // Useful outputs for wiring other stacks later
    new CfnOutput(this, "TableName", { value: this.table.tableName });
    new CfnOutput(this, "TableArn", { value: this.table.tableArn });
    new CfnOutput(this, "DataKeyArn", { value: this.dataKey.keyArn });

    // Tags (helpful for cost/allocation)
    tags.Tags.of(this).add("project", "etl-healthcare");
    tags.Tags.of(this).add("stack", "data");
    tags.Tags.of(this).add("env", this.node.tryGetContext("env") ?? "dev");
  }
}