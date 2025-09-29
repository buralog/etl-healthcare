import { Duration, Stack, StackProps, CfnOutput, Tags } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as kms from "aws-cdk-lib/aws-kms";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as path from "path";

interface IngestStackProps extends StackProps {
  rawBucket: s3.IBucket;
  ingestQueue: sqs.IQueue;
  kmsKey?: kms.IKey;
  auditFn?: lambda.IFunction;
}

export class IngestStack extends Stack {
  public readonly fn: NodejsFunction;
  constructor(scope: Construct, id: string, props: IngestStackProps) {
    super(scope, id, props);

    const entry = path.resolve(__dirname, "../../services/ingest/handler.ts");

    this.fn = new NodejsFunction(this, "IngestFn", {
      entry,
      handler: "main",
      runtime: lambda.Runtime.NODEJS_20_X,  // <-- explicit Node 20
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        RAW_BUCKET: props.rawBucket.bucketName,
        INGEST_QUEUE_URL: props.ingestQueue.queueUrl,
        ...(props.auditFn ? { AUDIT_FN_ARN: props.auditFn.functionArn } : {}),
      },
      bundling: {
        externalModules: ["aws-sdk"], // leave v2 external; we use v3 clients which get bundled
        target: "node20",
        sourceMap: true,
        keepNames: true,
      },
    });

    this.fn.addEnvironment("METRICS_NS", "etl.health");
    this.fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ["cloudwatch:PutMetricData"],
      resources: ["*"],
      conditions: { "StringEquals": { "cloudwatch:namespace": "etl.health" } },
    }));

    // Permissions
    props.rawBucket.grantPut(this.fn);
    props.ingestQueue.grantSendMessages(this.fn);
    props.kmsKey?.grantEncrypt(this.fn); // if your bucket is KMS-encrypted

    // Permit invoke if provided
    if (props.auditFn) {
      props.auditFn.grantInvoke(this.fn);
    }

    const api = new apigwv2.HttpApi(this, "IngestApi", { apiName: "etl-ingest-api" });
    api.addRoutes({
      path: "/ingest",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2Integrations.HttpLambdaIntegration("IngestIntegration", this.fn),
    });

    new CfnOutput(this, "IngestApiUrl", { value: api.apiEndpoint });
  }
}
