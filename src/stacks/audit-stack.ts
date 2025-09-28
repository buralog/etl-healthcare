import { Stack, StackProps, Duration, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as path from 'path';

export interface AuditStackProps extends StackProps {
  auditBucket: s3.IBucket; // provided by StorageStack
}

export class AuditStack extends Stack {
  public readonly auditFn: lambda.Function;

  constructor(scope: Construct, id: string, props: AuditStackProps) {
    super(scope, id, props);

    // Build output code from services/audit/dist
    const codePath = path.join(process.cwd(), 'services', 'audit', 'dist');

    this.auditFn = new lambda.Function(this, 'AuditFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(process.cwd(), 'services', 'audit', 'dist')),
      timeout: Duration.seconds(10),
      environment: {
        AUDIT_BUCKET: props.auditBucket.bucketName,
      },
    });

    // Allow writes to the audit bucket
    props.auditBucket.grantPut(this.auditFn);

    // Optional: output for visibility
    new CfnOutput(this, 'AuditFnArn', { value: this.auditFn.functionArn });
  }
}
