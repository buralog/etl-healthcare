import { Stack, StackProps, RemovalPolicy, Duration, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as kms from "aws-cdk-lib/aws-kms";
import * as ddb from "aws-cdk-lib/aws-dynamodb";
import * as tags from "aws-cdk-lib";

export class DataStack extends Stack {
  public readonly dataKey: kms.Key;
  public readonly table: ddb.Table;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Customer-managed KMS key for DDB (rotates yearly)
    this.dataKey = new kms.Key(this, "DataKey", {
      alias: "alias/etl-data-key",
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.DESTROY // dev; change to RETAIN for prod
    });

    // DynamoDB single-table (on-demand)
    this.table = new ddb.Table(this, "EtlTable", {
      tableName: "etl-healthcare",
      partitionKey: { name: "PK", type: ddb.AttributeType.STRING },
      sortKey: { name: "SK", type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.DESTROY, // dev only
      encryption: ddb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.dataKey
    });

    // GSI1: by code + yyyymm bucket
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "GSI1PK", type: ddb.AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: ddb.AttributeType.STRING },
      projectionType: ddb.ProjectionType.INCLUDE,
      nonKeyAttributes: ["patientId", "effectiveDateTime", "code"]
    });

    // GSI2: observations by patient time range
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI2",
      partitionKey: { name: "GSI2PK", type: ddb.AttributeType.STRING },
      sortKey: { name: "GSI2SK", type: ddb.AttributeType.STRING },
      projectionType: ddb.ProjectionType.INCLUDE,
      nonKeyAttributes: ["code", "effectiveDateTime"]
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