import { Duration, Stack, StackProps, CfnOutput, Tags } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
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
}

export class IngestStack extends Stack {
  constructor(scope: Construct, id: string, props: IngestStackProps) {
    super(scope, id, props);

    const entry = path.resolve(__dirname, "../../services/ingest/handler.ts");

    const fn = new NodejsFunction(this, "IngestFn", {
      entry,
      handler: "main",
      runtime: lambda.Runtime.NODEJS_20_X,  // <-- explicit Node 20
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        RAW_BUCKET: props.rawBucket.bucketName,
        INGEST_QUEUE_URL: props.ingestQueue.queueUrl,
      },
      bundling: {
        externalModules: ["aws-sdk"], // leave v2 external; we use v3 clients which get bundled
        target: "node20",
        sourceMap: true,
        keepNames: true,
      },
    });

    // Permissions
    props.rawBucket.grantPut(fn);
    props.ingestQueue.grantSendMessages(fn);
    props.kmsKey?.grantEncrypt(fn); // if your bucket is KMS-encrypted (yours is)
    
    const api = new apigwv2.HttpApi(this, "IngestApi", { apiName: "etl-ingest-api" });
    api.addRoutes({
      path: "/ingest",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2Integrations.HttpLambdaIntegration("IngestIntegration", fn),
    });

    new CfnOutput(this, "IngestApiUrl", { value: api.apiEndpoint });
  }
}
