import { Stack, StackProps, RemovalPolicy, CfnOutput, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as kms from "aws-cdk-lib/aws-kms";
import * as tags from "aws-cdk-lib";

export class StorageStack extends Stack {
  public readonly rawLanding: s3.Bucket;
  public readonly schemaRegistry: s3.Bucket;
  public readonly storageKey: kms.Key;
  public readonly auditBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Separate CMK for S3 (you could reuse DataStack key; split for clarity)
    this.storageKey = new kms.Key(this, "StorageKey", {
      alias: "alias/etl-storage-key",
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.DESTROY
    });

    // Raw landing bucket (for incoming files)
    this.rawLanding = new s3.Bucket(this, "RawLandingBucket", {
      bucketName: undefined, // let AWS name it; set if you want a fixed name
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.storageKey,
      enforceSSL: true,
      intelligentTieringConfigurations: [],
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      removalPolicy: RemovalPolicy.DESTROY, // dev
      autoDeleteObjects: true // dev convenience
    });

    // Schema registry bucket (stores JSON Schemas)
    this.schemaRegistry = new s3.Bucket(this, "SchemaRegistryBucket", {
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.storageKey,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    // Audit bucket
    this.auditBucket = new s3.Bucket(this, 'AuditBucket', {
      bucketName: `${Stack.of(this).stackName.toLowerCase()}-audit-${this.account}-${this.region}`.slice(0, 63),
      encryptionKey: this.storageKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true
    })

    // Lifecycle (optional): expire incomplete uploads
    this.rawLanding.addLifecycleRule({
      abortIncompleteMultipartUploadAfter: Duration.days(7)
    });

    // Outputs
    new CfnOutput(this, "RawLandingBucketName", { value: this.rawLanding.bucketName });
    new CfnOutput(this, 'AuditBucketName', { value: this.auditBucket.bucketName });
    new CfnOutput(this, "SchemaRegistryBucketName", { value: this.schemaRegistry.bucketName });
    new CfnOutput(this, "StorageKeyArn", { value: this.storageKey.keyArn });

    tags.Tags.of(this).add("project", "etl-healthcare");
    tags.Tags.of(this).add("stack", "storage");
    tags.Tags.of(this).add("env", this.node.tryGetContext("env") ?? "dev");
  }
}