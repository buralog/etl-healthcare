import { Stack, StackProps, Duration, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as path from "path";
import * as sqs from "aws-cdk-lib/aws-sqs";

export interface ReprocessApiStackProps extends StackProps {
    userPool: cognito.IUserPool;
    reprocessStateMachine: sfn.IStateMachine;
    rawBucket: s3.IBucket;
    auditBucket: s3.IBucket;

    // Queues and DLQs
    ingestQueue: sqs.IQueue;
    ingestDlq: sqs.IQueue;
    normalizedQueue: sqs.IQueue;
    normalizedDlq: sqs.IQueue;
    persistedQueue: sqs.IQueue;
    persistedDlq: sqs.IQueue;
}

export class ReprocessApiStack extends Stack {
    public readonly url: string;

    constructor(scope: Construct, id: string, props: ReprocessApiStackProps) {
        super(scope, id, props);

        const fn = new lambda.Function(this, "ReprocessApiFn", {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: "handler.handler",
            code: lambda.Code.fromAsset(path.join(process.cwd(), "services", "reprocess-api", "dist")),
            timeout: Duration.seconds(10),
            environment: {
                SFN_ARN: props.reprocessStateMachine.stateMachineArn,
            },
        });

        // Allow Lambda to start executions on the specific state machine
        props.reprocessStateMachine.grantStartExecution(fn);

        // API Gateway (REST) + Cognito User Pool Authorizer
        const api = new apigw.RestApi(this, "ReprocessAdminApi", {
            restApiName: "etl-admin",
            deployOptions: { stageName: "prod", throttlingBurstLimit: 20, throttlingRateLimit: 10 },
        });

        const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, "CognitoAuthorizer", {
            cognitoUserPools: [props.userPool],
            identitySource: "method.request.header.Authorization",
        });

        // Ingest URL (presign) Lambda
        const ingestUrlFn = new lambda.Function(this, "IngestUrlFn", {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: "handler.handler",
            code: lambda.Code.fromAsset(path.join(process.cwd(), "services", "ingest-url-api", "dist")),
            timeout: Duration.seconds(10),
            environment: {
                RAW_BUCKET: props.rawBucket.bucketName,
                EXPIRES_SECONDS: "900",
            },
        });

        // Audit List Lambda
        const auditListFn = new lambda.Function(this, "AuditListFn", {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: "handler.handler",
            code: lambda.Code.fromAsset(path.join(process.cwd(), "services", "audit-list-api", "dist")),
            timeout: Duration.seconds(10),
            environment: {
                AUDIT_BUCKET: props.auditBucket.bucketName,
            },
        });

        props.rawBucket.grantPut(ingestUrlFn);
        props.auditBucket.grantRead(auditListFn);

        // Route: POST /ingest/url
        const ingestRes = api.root.addResource("ingest");
        const auditRes = api.root.addResource("audit");
        const auditListRes = auditRes.addResource("list");

        auditListRes.addMethod("GET", new apigw.LambdaIntegration(auditListFn), {
            authorizer,
            authorizationType: apigw.AuthorizationType.COGNITO,
        });

        const ingestUrlRes = ingestRes.addResource("url");
        ingestUrlRes.addMethod("POST", new apigw.LambdaIntegration(ingestUrlFn), {
            authorizer,
            authorizationType: apigw.AuthorizationType.COGNITO,
        });

        const reproc = api.root.addResource("reprocess");
        reproc.addMethod("POST", new apigw.LambdaIntegration(fn), {
            authorizer,
            authorizationType: apigw.AuthorizationType.COGNITO,
        });

        const dlqRetryFn = new lambda.Function(this, "DlqRetryFn", {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: "handler.handler",
            code: lambda.Code.fromAsset(path.join(process.cwd(), "services", "dlq-retry-api", "dist")),
            timeout: Duration.seconds(15),
            environment: {
                INGEST_Q_URL: props.ingestQueue.queueUrl,
                INGEST_DLQ_URL: props.ingestDlq.queueUrl,
                NORMALIZED_Q_URL: props.normalizedQueue.queueUrl,
                NORMALIZED_DLQ_URL: props.normalizedDlq.queueUrl,
                PERSISTED_Q_URL: props.persistedQueue.queueUrl,
                PERSISTED_DLQ_URL: props.persistedDlq.queueUrl,
            },
        });

        // permissions: send to main queues, consume from DLQs
        props.ingestQueue.grantSendMessages(dlqRetryFn);
        props.normalizedQueue.grantSendMessages(dlqRetryFn);
        props.persistedQueue.grantSendMessages(dlqRetryFn);

        props.ingestDlq.grantConsumeMessages(dlqRetryFn);
        props.normalizedDlq.grantConsumeMessages(dlqRetryFn);
        props.persistedDlq.grantConsumeMessages(dlqRetryFn);

        // Route: POST /dlq/retry
        const dlqRes = api.root.addResource("dlq");
        const dlqRetryRes = dlqRes.addResource("retry");
        dlqRetryRes.addMethod("POST", new apigw.LambdaIntegration(dlqRetryFn), {
            authorizer,
            authorizationType: apigw.AuthorizationType.COGNITO,
        });


        // Health Lambda
        const healthFn = new lambda.Function(this, "HealthFn", {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: "handler.handler",
            code: lambda.Code.fromAsset(path.join(process.cwd(), "services", "health-api", "dist")),
            timeout: Duration.seconds(15),
            environment: {
                METRICS_NS: "etl.health",
                AUDIT_BUCKET: props.auditBucket.bucketName,
                INGEST_Q_URL: props.ingestQueue.queueUrl,
                INGEST_DLQ_URL: props.ingestDlq.queueUrl,
                NORMALIZED_Q_URL: props.normalizedQueue.queueUrl,
                NORMALIZED_DLQ_URL: props.normalizedDlq.queueUrl,
                PERSISTED_Q_URL: props.persistedQueue.queueUrl,
                PERSISTED_DLQ_URL: props.persistedDlq.queueUrl,
            },
        });

        // Permissions
        props.auditBucket.grantRead(healthFn);
        props.ingestQueue.grant(healthFn, "sqs:GetQueueAttributes");
        props.ingestDlq.grant(healthFn, "sqs:GetQueueAttributes");
        props.normalizedQueue.grant(healthFn, "sqs:GetQueueAttributes");
        props.normalizedDlq.grant(healthFn, "sqs:GetQueueAttributes");
        props.persistedQueue.grant(healthFn, "sqs:GetQueueAttributes");
        props.persistedDlq.grant(healthFn, "sqs:GetQueueAttributes");

        // CloudWatch read for metrics
        healthFn.addToRolePolicy(new iam.PolicyStatement({
            actions: ["cloudwatch:GetMetricData", "cloudwatch:ListMetrics"],
            resources: ["*"],
        }));

        // --- Route: GET /health?tenantId=demo&windowMin=15
        const healthRes = api.root.addResource("health");
        healthRes.addMethod("GET", new apigw.LambdaIntegration(healthFn), {
            authorizer,
            authorizationType: apigw.AuthorizationType.COGNITO,
        });

        this.url = api.url;
        new CfnOutput(this, "ReprocessApiUrl", { value: this.url });
    }
}
