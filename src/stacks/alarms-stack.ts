import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cw from "aws-cdk-lib/aws-cloudwatch";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as appsync from "aws-cdk-lib/aws-appsync";

export interface AlarmsStackProps extends StackProps {
  ingestQueue: sqs.IQueue;
  ingestDlq?: sqs.IQueue;
  normalizedQueue: sqs.IQueue;
  normalizedDlq?: sqs.IQueue;
  persistedQueue: sqs.IQueue;
  persistedDlq?: sqs.IQueue;

  ingestFn: lambda.IFunction;
  normalizeFn: lambda.IFunction;
  persistFn: lambda.IFunction;

  api?: appsync.GraphqlApi;
  metricsNamespace?: string; // default "etl.health"
}

export class AlarmsStack extends Stack {
  constructor(scope: Construct, id: string, props: AlarmsStackProps) {
    super(scope, id, props);

    const NS = props.metricsNamespace ?? "etl.health";

    // ---- DLQ alarms
    const mkDlqAlarm = (title: string, q?: sqs.IQueue) => {
      if (!q) return;
      new cw.Alarm(this, `${title}-Alarm`, {
        metric: q.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(1), statistic: "Sum" }),
        threshold: 0,
        evaluationPeriods: 5,
        comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cw.TreatMissingData.NOT_BREACHING,
        alarmDescription: `${title} has messages in DLQ`,
      });
    };
    mkDlqAlarm("IngestQueue-DLQ", props.ingestDlq);
    mkDlqAlarm("NormalizeQueue-DLQ", props.normalizedDlq);
    mkDlqAlarm("PersistQueue-DLQ", props.persistedDlq);

    // ---- Lambda error alarms
    const errAlarm = (fn: lambda.IFunction, name: string) => new cw.Alarm(this, `${name}-Errors-Alarm`, {
      metric: fn.metricErrors({ period: Duration.minutes(1), statistic: "Sum" }),
      threshold: 0,
      evaluationPeriods: 3,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
      alarmDescription: `${name} has errors`,
    });
    errAlarm(props.ingestFn, "IngestFn");
    errAlarm(props.normalizeFn, "NormalizeFn");
    errAlarm(props.persistFn, "PersistFn");

    // ---- Normalize invalid ratio > 5%
    const invalid = new cw.Metric({ namespace: NS, metricName: "dto_invalid_count", period: Duration.minutes(1), statistic: "Sum" });
    const valid = new cw.Metric({ namespace: NS, metricName: "dto_valid_count", period: Duration.minutes(1), statistic: "Sum" });
    const invalidPct = new cw.MathExpression({
      expression: "IF((m1+m2)>0,(m1/(m1+m2))*100,0)",
      usingMetrics: { m1: invalid, m2: valid },
      period: Duration.minutes(1),
    });
    new cw.Alarm(this, "NormalizeInvalidPct-Alarm", {
      metric: invalidPct,
      threshold: 5,
      evaluationPeriods: 5,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
      alarmDescription: "Normalize invalid > 5%",
    });

    // ---- AppSync p99 latency > 300ms (optional if api provided)
    if (props.api) {
      new cw.Alarm(this, "AppSyncP99Latency-Alarm", {
        metric: new cw.Metric({
          namespace: "AWS/AppSync",
          metricName: "Latency",
          dimensionsMap: { GraphQLAPIId: props.api.apiId },
          statistic: "p99",
          period: Duration.minutes(1),
        }),
        threshold: 300,
        evaluationPeriods: 5,
        comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: "AppSync p99 latency > 300ms",
      });
    }

    // ---- Dashboard
    const dash = new cw.Dashboard(this, "Dashboard", { dashboardName: "EtL-Dashboard" });

    // Row: SQS metrics
    dash.addWidgets(
      new cw.GraphWidget({
        title: "SQS Ingest Queue",
        left: [props.ingestQueue.metricApproximateNumberOfMessagesVisible(), props.ingestQueue.metricNumberOfMessagesSent()],
        width: 8,
      }),
      new cw.GraphWidget({
        title: "SQS Normalized Queue",
        left: [props.normalizedQueue.metricApproximateNumberOfMessagesVisible(), props.normalizedQueue.metricNumberOfMessagesSent()],
        width: 8,
      }),
      new cw.GraphWidget({
        title: "SQS Persisted Queue",
        left: [props.persistedQueue.metricApproximateNumberOfMessagesVisible(), props.persistedQueue.metricNumberOfMessagesSent()],
        width: 8,
      }),
    );

    // Row: Lambda errors/durations
    dash.addWidgets(
      new cw.GraphWidget({
        title: "Lambda Errors", left: [
          props.ingestFn.metricErrors(),
          props.normalizeFn.metricErrors(),
          props.persistFn.metricErrors(),
        ], width: 12
      }),
      new cw.GraphWidget({
        title: "Lambda Duration (p95)", left: [
          props.ingestFn.metricDuration({ statistic: "p95" }),
          props.normalizeFn.metricDuration({ statistic: "p95" }),
          props.persistFn.metricDuration({ statistic: "p95" }),
        ], width: 12
      }),
    );

    // Row: Custom business metrics
    dash.addWidgets(
      new cw.GraphWidget({ title: "Normalize Invalid %", left: [invalidPct], width: 12 }),
      new cw.GraphWidget({
        title: "Persist Success / Idempotent Skips", left: [
          new cw.Metric({ namespace: NS, metricName: "persist_success_count", period: Duration.minutes(1), statistic: "Sum" }),
          new cw.Metric({ namespace: NS, metricName: "idempotent_skip_count", period: Duration.minutes(1), statistic: "Sum" }),
        ], width: 12
      }),
    );

    // Row: AppSync latency
    if (props.api) {
      dash.addWidgets(new cw.GraphWidget({
        title: "AppSync Latency",
        left: [new cw.Metric({
          namespace: "AWS/AppSync",
          metricName: "Latency",
          dimensionsMap: { GraphQLAPIId: props.api.apiId },
          statistic: "p99",
          period: Duration.minutes(1),
        })],
        width: 24,
      }));
    }
  }
}
