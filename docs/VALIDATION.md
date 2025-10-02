# ⚡ Validate the Pipeline
Assumes you’ve already done Quickstart (install, bootstrap, deploy).
> **NOTE:** Shell examples use `fish` shell.
> 
**For bash users**:
* Replace `set VAR value` with `VAR=value` (no `set`).
* Command substitution: `(...)` → `$(...)`.
* Loops use standard for syntax.
### 1. Set context (region, profile)
   ```bash
     # Adjust to your AWS account/region
     set -x AWS_REGION eu-central-1
     # optional: set a profile if you use one
     set -x AWS_PROFILE myprofile
   ```

### 2. Discover resource endpoints/ARNs
We resolve stack outputs once and reuse them in commands.
   ```fish
   # Table
set TBL etl-healthcare

# Queues (from the "Messaging" / "Persist" stacks)
set IQURL (aws cloudformation describe-stacks \
  --stack-name EtL-Messaging \
  --query "Stacks[0].Outputs[?OutputKey=='IngestQueueUrl'].OutputValue" \
  --output text)

set NQURL (aws cloudformation describe-stacks \
  --stack-name EtL-Messaging \
  --query "Stacks[0].Outputs[?OutputKey=='NormalizedQueueUrl'].OutputValue" \
  --output text)

set PQURL (aws cloudformation describe-stacks \
  --stack-name EtL-Persist \
  --query "Stacks[0].Outputs[?OutputKey=='PersistedQueueUrl'].OutputValue" \
  --output text)

# Persist Lambda name (for logs)
set PFN (aws cloudformation describe-stacks \
  --stack-name EtL-Persist \
  --query "Stacks[0].Outputs[?OutputKey=='PersistFunctionName'].OutputValue" \
  --output text)
   ```
  Bash equivalent (example):
``` bash
IQURL=$(aws cloudformation describe-stacks --stack-name EtL-Messaging \
  --query "Stacks[0].Outputs[?OutputKey=='IngestQueueUrl'].OutputValue" --output text)
```
### 3. Tail the persist Lambda logs (CloudWatch)
Keep this running in another terminal window so you can see logs and errors live.
What you want to see: either clean “END/REPORT” with no errors or informative validation/idempotency messages.
   ```fish
aws logs tail "/aws/lambda/$PFN" --since 15m --follow
   ```
> NOTE: You may need to define PFN (Persist Function Name) variable again in the logging terminal as well.
### 4. Smoke test: ingest via HTTP
> Sends a tiny JSON payload to the ingest endpoint, which should deposit raw into S3 and emit a normalized event.
>
> It confirms the HTTP path is alive, raw object is written, and a message gets queued for the transformer/normalizer.
   ```fish
# Ingest API base URL (from your stack output)
set API (aws cloudformation describe-stacks \
  --stack-name EtL-Ingest \
  --query "Stacks[0].Outputs[?OutputKey=='IngestApiUrl'].OutputValue" \
  --output text)

# Send a sample
set IDEMP check-001
curl -sS -X POST "$API/ingest" \
  -H "Content-Type: application/json" \
  -d (jq -n --arg idk $IDEMP '{
    metadata: { tenantId: "t1", source: "test", idempotencyKey: $idk },
    payload: { studyInstanceUID: "1.2.3", patientId: "P001", modality: "MR" }
  }') | jq
   ```
### 5. Did the normalized message land? (SQS peek)
Expect to see `etl.normalized.v1` bodies. It verifies the Transform/Normalize stage produced the expected event shape.
   ```fish
# Ingest API base URL (from your stack output)
set API (aws cloudformation describe-stacks \
  --stack-name EtL-Ingest \
  --query "Stacks[0].Outputs[?OutputKey=='IngestApiUrl'].OutputValue" \
  --output text)

# Send a sample
set IDEMP check-001
curl -sS -X POST "$API/ingest" \
  -H "Content-Type: application/json" \
  -d (jq -n --arg idk $IDEMP '{
    metadata: { tenantId: "t1", source: "test", idempotencyKey: $idk },
    payload: { studyInstanceUID: "1.2.3", patientId: "P001", modality: "MR" }
  }') | jq
   ```
### 6. DynamoDB write checks
We use the known keys from our conventions:
`PK = TENANT#<tenantId>` and `SK = ENTITY#<type>#<id>`.
 It confirms persistence is working, the single-table keys are correct, and version/idempotency attributes are being updated.
   ```fish
  # Build keys for our test entity
set PK TENANT#t1
set SK ENTITY#study#1.2.3

# Read the row
aws dynamodb get-item \
  --table-name $TBL \
  --key (printf '{"PK":{"S":"%s"},"SK":{"S":"%s"}}' $PK $SK) \
  --output json | jq

# Query by PK to see all items for tenant t1
aws dynamodb query \
  --table-name $TBL \
  --key-condition-expression "PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"TENANT#t1"}}' \
  --output json | jq '.Items | length'
   ```
### 7. Observe `etl.persisted.v1` events
The persist service emits a “write confirmation” event for downstreams (audit, indexing, etc.).
This is the contract you’d fan out to an audit or search microservice.
  ``` fish
     # How many persisted messages are waiting?
aws sqs get-queue-attributes --queue-url $PQURL \
  --attribute-names ApproximateNumberOfMessages | jq

# Peek at a few messages (don’t delete yet)
aws sqs receive-message --queue-url $PQURL \
  --max-number-of-messages 5 --wait-time-seconds 10 --visibility-timeout 0 \
  --message-attribute-names All | jq -r '.Messages[].Body' | jq
  ```
### 8. Read-and-remove a message (SQS hygiene)
Useful when you want to drain a queue during testing.
> ⚠️ If you don’t delete, messages become visible again after the visibility timeout.
  ``` fish
# Peek one; hide it 30s so we can delete by handle
set MSG (aws sqs receive-message --queue-url $PQURL \
  --max-number-of-messages 1 --wait-time-seconds 10 --visibility-timeout 30)

# Show the body
echo $MSG | jq -r '.Messages[0].Body' | jq

# Delete it (only if you intend to consume it)
set RH (echo $MSG | jq -r '.Messages[0].ReceiptHandle')
test -n "$RH"; and aws sqs delete-message --queue-url $PQURL --receipt-handle "$RH"
  ```
### 9. Idempotency demo (no double-writes)
Re-send the exact same `idempotencyKey`. The item’s version should **not** increment and the write path should be skipped or conditionally updated.
It shows retries are safe and the pipeline won’t duplicate records.
  ``` fish
    # Send the exact same ingest payload again
curl -sS -X POST "$API/ingest" \
  -H "Content-Type: application/json" \
  -d (jq -n --arg idk $IDEMP '{
    metadata: { tenantId: "t1", source: "test", idempotencyKey: $idk },
    payload: { studyInstanceUID: "1.2.3", patientId: "P001", modality: "MR" }
  }') | jq

# Re-read the item and check "version" hasn’t bumped unexpectedly
aws dynamodb get-item \
  --table-name $TBL \
  --key (printf '{"PK":{"S":"%s"},"SK":{"S":"%s"}}' $PK $SK) \
  --output json | jq '.Item.version // .Item.Version // empty'
  ```

### 10. Query Layer: AppSync + Cognito (GraphQL)
At this stage we expose the pipeline via a secure GraphQL API.  
- **AppSync + Cognito** provides a tenant-aware query layer on top of DynamoDB, ensuring only authenticated users with the right tenant claim can read their data.
- Proves the pipeline is not only ingesting → normalizing → persisting, but also **securely queryable** by consumers.

#### 10.0 Stack deployment
Deploy the AppSync stack:

```bash
cdk deploy EtL-AppSync --require-approval never
```

Retrieve stack outputs (GraphQL endpoint + Cognito info):

```bash
aws cloudformation describe-stacks \
  --stack-name EtL-AppSync \
  --query "Stacks[0].Outputs" \
  --output table
```

You should see:
- `GraphQLEndpoint` → the URL for GraphQL queries
- `UserPoolId` → Cognito user pool ID
- `UserPoolClientId` → Cognito client app ID

Optionally store the endpoint in an env var:

```fish
set -x GRAPHQL_ENDPOINT (aws cloudformation describe-stacks \
  --stack-name EtL-AppSync \
  --query "Stacks[0].Outputs[?OutputKey=='GraphQLEndpoint'].OutputValue" \
  --output text)
```

#### 10.1 Create a test Cognito user
Because we disabled public signup, create users via CLI and attach a tenant claim.

```fish
# Variables
set -x USER_POOL_ID "<your UserPoolId>"
set -x USER_POOL_CLIENT_ID "<your UserPoolClientId>"
set -x REGION "eu-central-1"
set -x TEST_EMAIL "tester@example.com"
set -x TEST_PASS "TestPassw0rd!123"
set -x TENANT_ID "t_demo"

# 1) Create user
aws cognito-idp admin-create-user \
  --region $REGION \
  --user-pool-id $USER_POOL_ID \
  --username $TEST_EMAIL \
  --user-attributes Name=email,Value=$TEST_EMAIL Name=email_verified,Value=true

# 2) Set permanent password
aws cognito-idp admin-set-user-password \
  --region $REGION \
  --user-pool-id $USER_POOL_ID \
  --username $TEST_EMAIL \
  --password $TEST_PASS \
  --permanent

# 3) Add tenant claim
aws cognito-idp admin-update-user-attributes \
  --region $REGION \
  --user-pool-id $USER_POOL_ID \
  --username $TEST_EMAIL \
  --user-attributes Name=custom:tenantId,Value=$TENANT_ID
```

Now you have a Cognito user with:
- email login
- permanent password
- `custom:tenantId = t_demo`


#### 10.2 Authenticate and get a JWT token
Authenticate to obtain a **JWT IdToken** for calling AppSync.

```bash
aws cognito-idp initiate-auth \
  --region $REGION \
  --client-id $USER_POOL_CLIENT_ID \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=$TEST_EMAIL,PASSWORD=$TEST_PASS \
  --query 'AuthenticationResult.IdToken' \
  --output text
```

Save the returned token as an env var (optional):

```fish
set -x JWT (aws cognito-idp initiate-auth \
  --region $REGION \
  --client-id $USER_POOL_CLIENT_ID \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=$TEST_EMAIL,PASSWORD=$TEST_PASS \
  --query 'AuthenticationResult.IdToken' \
  --output text)
```

#### 10.3 Send GraphQL queries
Use any API client (curl, Bruno, Postman).  
**Authorization** must be set to `Bearer <IdToken>`.

##### **Get patient metadata**
```bash
curl -s "$GRAPHQL_ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d '{"query":"query { getPatient(id: \"p-123\") { id tenantId name birthDate lastUpdated } }"}' | jq
```

##### **Observations by patient (JSON body)**
```json
{
  "query": "query { observationsByPatient(patientId: \"p-123\", limit: 5) { items { id code value unit effective } nextToken } }"
}
```

##### **Latest observation (JSON body)**
```json
{
  "query": "query { latestObservation(patientId: \"p-123\", code: \"heart-rate\") { id code value unit effective } }"
}
```

If seeded data exists, `getPatient` may return:
```json
{
  "data": {
    "getPatient": {
      "id": "p-123",
      "tenantId": "t_demo",
      "name": "Alice Smith",
      "birthDate": "1985-06-15",
      "lastUpdated": "2025-09-26T15:00:00Z"
    }
  }
}
```

> Tip: You can also use **variables** to avoid escaping:
> ```json
> {
>   "query": "query Obs($pid: ID!, $limit: Int) { observationsByPatient(patientId: $pid, limit: $limit) { items { id code value unit effective } nextToken } }",
>   "variables": { "pid": "p-123", "limit": 5 }
> }
> ```

#### 10.4 Quick GraphQL smoke tests with Bruno API Client
Instead of raw `curl`, use [Bruno](https://www.usebruno.com/) (or Postman) to run ready-made GraphQL queries.

1. **Import the collection**  
   Add `./bruno/etl-healthcare-tests.json` (included in the repo).  
   It contains requests for:
   - `getPatient`
   - `observationsByPatient`
   - `latestObservation`

2. **Set environment values**
   - `graphql_endpoint` → from CDK outputs:
     ```bash
     aws cloudformation describe-stacks \
       --stack-name EtL-AppSync \
       --query "Stacks[0].Outputs[?OutputKey=='GraphQLEndpoint'].OutputValue" \
       --output text
     ```
   - `jwt_token` → the IdToken you obtained in **12.2**.

3. **Run the queries**  
   - ✅ `getPatient(id: "p-123")` → patient metadata  
   - ✅ `observationsByPatient(patientId: "p-123", limit: 5)` → list with pagination support  
   - ✅ `latestObservation(patientId: "p-123", code: "heart-rate")` → the newest observation for the code

### 11. Audit Trail + Reprocess Flow

At this stage we connected **AuditFn** to all pipeline stages (Ingest → Normalize → Persist).  
- Every event (`ingest.raw.v1`, `etl.normalized.v1`, `etl.persisted.v1`) is now **mirrored to S3** as immutable JSONL.  
- Operators can later reprocess historical data using **Step Functions**, without replaying from the source system.  
- DynamoDB writes are idempotent: the same entity can be reprocessed multiple times, and only the version counter is incremented.

#### 11.0 Verify audit events

Each Lambda writes to the AuditFn asynchronously. To verify, invoke the Ingest function:

```fish
set INGEST_FN (aws lambda list-functions \
  --query "Functions[?contains(FunctionName,'Ingest')].FunctionName" \
  --output text)

aws lambda invoke \
  --function-name "$INGEST_FN" \
  --payload '{
    "body": "{\"metadata\":{\"tenantId\":\"demo\",\"source\":\"cli\"},\"payload\":{\"patientId\":\"pat-123\",\"modality\":\"CR\",\"studyInstanceUID\":\"1.2.3.4\"}}"
  }' \
  /tmp/ingest-out.json \
  --cli-binary-format raw-in-base64-out

cat /tmp/ingest-out.json
```

Then list the audit bucket:

```fish
set AUDIT_BUCKET (aws cloudformation describe-stacks \
  --stack-name EtL-Storage \
  --query "Stacks[0].Outputs[?OutputKey=='AuditBucketName'].OutputValue" \
  --output text)

set DATE_UTC (date -u +%F)

aws s3 ls "s3://$AUDIT_BUCKET/tenantId=demo/date=$DATE_UTC/" --recursive
```

You should see hourly partitions (`hour=HH/...jsonl`). Each JSONL file contains appended events for that window.

Inspect one file:

```fish
set SAMPLE (aws s3 ls "s3://$AUDIT_BUCKET/tenantId=demo/date=$DATE_UTC/" \
  --recursive | head -n1 | awk '{print $4}')

aws s3 cp "s3://$AUDIT_BUCKET/$SAMPLE" /tmp/audit.jsonl
sed -n '1,5p' /tmp/audit.jsonl
```

#### 11.1 Verify DynamoDB versioning

Reprocessed entities increment `version` without duplicating rows.

```fish
set TABLE_NAME (aws cloudformation describe-stacks \
  --stack-name EtL-Data \
  --query "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue" \
  --output text)

aws dynamodb query \
  --table-name $TABLE_NAME \
  --key-condition-expression "PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"TENANT#demo"}}' \
  --output json | jq '.Items[] | {PK:.PK.S, SK:.SK.S, version:(.version?.N // "n/a")}'
```

If you see the same entity with `version: 2`, `3`, etc., idempotency is confirmed.

#### 11.2 Reprocess via Step Functions

To replay a raw file through normalize → persist:

```fish
set SFN_ARN (aws stepfunctions list-state-machines \
  --query "stateMachines[?contains(name,'EtlReprocess')].stateMachineArn" \
  --output text)

set RAW_BUCKET (aws cloudformation describe-stacks \
  --stack-name EtL-Storage \
  --query "Stacks[0].Outputs[?OutputKey=='RawBucketName'].OutputValue" \
  --output text)

set DATE_UTC (date -u +%F)
set KEY "raw/demo/$DATE_UTC/<your-object-key>.json"

aws stepfunctions start-execution \
  --state-machine-arn "$SFN_ARN" \
  --input (printf '{"tenantId":"demo","bucket":"%s","key":"%s"}' $RAW_BUCKET $KEY)
```

Check status:

```fish
aws stepfunctions list-executions \
  --state-machine-arn "$SFN_ARN" \
  --query "executions[0].{name:name,status:status,start:startDate,stop:stopDate}"
```

A `SUCCEEDED` status means the reprocess path worked and events flowed through normalize → persist → audit again.

### 12. Observability: Alarms & Dashboard

At this stage we add **CloudWatch alarms** and a simple **dashboard** to make the pipeline production-ready.  
- Each Lambda already uses Powertools for structured logs and metrics.  
- We now expose **DLQ alarms**, **error rates**, and **p99 latency** for quick visibility.  
- A CloudWatch dashboard aggregates the key metrics.

#### 12.0 Deploy alarms stack

Deploy the alarms stack (this wires alarms to existing queues, DynamoDB, and AppSync):

```bash
cdk deploy EtL-Alarms --require-approval never
```

#### 12.1 Check created alarms

List alarms:

```bash
aws cloudwatch describe-alarms \
  --query "MetricAlarms[].{Name:AlarmName,State:StateValue}" \
  --output table
```

You should see alarms like:
- `IngestQueue-DLQ-Alarm`
- `NormalizeQueue-DLQ-Alarm`
- `PersistQueue-DLQ-Alarm`
- `AppSyncLatencyP99-Alarm`

By default they are in `OK` state.

#### 12.2 Trigger a test DLQ alarm

To simulate a failure, push an invalid event into the ingest queue:

```bash
set INGEST_QUEUE (aws cloudformation describe-stacks \
  --stack-name EtL-Messaging \
  --query "Stacks[0].Outputs[?OutputKey=='IngestQueueUrl'].OutputValue" \
  --output text)

aws sqs send-message \
  --queue-url $INGEST_QUEUE \
  --message-body '{"bad":"message"}'
```

Within a few retries the message will fail validation and land in the DLQ.

Check DLQ messages:

```bash
set DLQ (aws cloudformation describe-stacks \
  --stack-name EtL-Messaging \
  --query "Stacks[0].Outputs[?OutputKey=='IngestDLQUrl'].OutputValue" \
  --output text)

aws sqs receive-message --queue-url $DLQ
```

The `IngestQueue-DLQ-Alarm` should move to `ALARM` state.

#### 12.3 View dashboard

Navigate to the CloudWatch console → Dashboards → `EtL-Dashboard`.  
It shows:
- SQS message counts (Ingest, Normalized, Persisted)
- Error metrics (validation failures, idempotency skips)
- Lambda duration & errors
- AppSync latency p99

#### 12.4 Reset after test

Purge the DLQ to clear the alarm:

```bash
aws sqs purge-queue --queue-url $DLQ
```

Wait a few minutes for the alarm to return to `OK`.

✅ With this step, the pipeline now has:
- **Automated alarms** for DLQs, error rates, and latency.  
- **A unified dashboard** for quick status checks.  
- End-to-end observability: logs, metrics, traces, and alarms.

This completes the **Observability stage** of the ETL pipeline.


### 13. Adapters: HL7v2 + CSV → Normalize → Persist  
At this stage we connected **real-world healthcare formats** (HL7v2 messages and LabX-style CSVs) into the ETL pipeline.  

- Ingested files are replayed via the **Reprocess API** → pushed to the **Normalize service**.  
- **Adapters** (`parseHl7v2`, `parseLabxCsv`) convert raw files into structured DTOs.  
- DTOs are validated (Zod + AJV) and mapped into **FHIR Observations**.  
- Normalized events flow to the **Persist service**, which writes them into DynamoDB with tenant-aware single-table design.  

This proves the pipeline handles both **streaming JSON payloads** and **batch file uploads**, producing a consistent event (`etl.normalized.v1`) and storing **FHIR-aligned Observation resources** in DynamoDB.

#### 13.1 HL7v2 → Normalize → Persist (via Reprocess)
Replays an `.hl7` file from S3 through **Reprocess → Normalize → Persist** and verifies `ENTITY#observation#...` rows in DynamoDB.

```fish
# Vars
set RAW_BUCKET (aws cloudformation describe-stacks \
  --stack-name EtL-Storage \
  --query "Stacks[0].Outputs[?OutputKey=='RawLandingBucketName'].OutputValue" \
  --output text)
set DATE (date -u +%F)

# 1) Upload a sample HL7 file (ensure .hl7 suffix)
aws s3 cp schema/examples/hl7/minimal.hl7 s3://$RAW_BUCKET/raw/demo/$DATE/minimal.hl7

# 2) Kick reprocess via the Admin API
set API_URL (aws cloudformation describe-stacks \
  --stack-name EtL-ReprocessApi \
  --query "Stacks[0].Outputs[?OutputKey=='ReprocessApiUrl'].OutputValue" \
  --output text)
curl -s (string replace -r '/?$' '' $API_URL)"/reprocess" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"tenantId":"demo","bucket":"'$RAW_BUCKET'","key":"raw/demo/'$DATE'/minimal.hl7"}' | jq

```

Expect: `{ "ok": true, "executionArn": "...", "startedAt": "..." }`

```fish
# 3) Verify observations were persisted
set TABLE (aws cloudformation describe-stacks \
  --stack-name EtL-Data \
  --query "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue" \
  --output text)

aws dynamodb query \
  --table-name $TABLE \
  --key-condition-expression "PK = :pk AND begins_with(SK, :sk)" \
  --expression-attribute-values '{":pk":{"S":"TENANT#demo"},":sk":{"S":"ENTITY#observation#"}}' \
  --projection-expression "PK, SK, entityType, entityId, attributes, updatedAt, version" \
  --output json | jq
```

#### 13.2 CSV adapter path (LabX sample)
Parses a CSV from S3, validates DTO with zod, maps to FHIR Observation (AJV minimal check), then persists.

```fish
# 1) Upload sample CSV
aws s3 cp schema/examples/csv/labx.csv s3://$RAW_BUCKET/raw/demo/$DATE/labx.csv

# 2) Reprocess that CSV
curl -s (string replace -r '/?$' '' $API_URL)"/reprocess" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"tenantId":"demo","bucket":"'$RAW_BUCKET'","key":"raw/demo/'$DATE'/labx.csv"}' | jq

# 3) Check observations again
aws dynamodb query \
  --table-name $TABLE \
  --key-condition-expression "PK = :pk AND begins_with(SK, :sk)" \
  --expression-attribute-values '{":pk":{"S":"TENANT#demo"},":sk":{"S":"ENTITY#observation#"}}' \
  --projection-expression "PK, SK, entityType, entityId, attributes, updatedAt, version" \
  --output json | jq
```

#### 13.3 Health snapshot (queues + recent audit + error counters)
Quick system view backed by CloudWatch + last audit JSONL object.

```fish
# Requires $API_URL and $JWT
curl -s (string replace -r '/?$' '' $API_URL)"/health?tenantId=demo" \
  -H "Authorization: Bearer $JWT" | jq
```


Fields:

- `queues.*.{visible,inFlight,delayed}` for ingest/normalized/persisted (+ their DLQs)
- `metrics` → recent error counters (ingest/normalize/persist)
- `audit.key` and `audit.lastModified` → last JSONL written

#### 13.4 DLQ retry endpoint (admin-only)
Moves up to N messages from a chosen DLQ back to its main queue.
Requires your Cognito user to be in group admin.

```fish
# One-time (admin) setup — add yourself to the admin group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id $USER_POOL_ID \
  --username $TEST_EMAIL \
  --group-name admin

# Refresh JWT afterwards
set -x JWT (aws cognito-idp initiate-auth \
  --region $REGION --client-id $USER_POOL_CLIENT_ID \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=$TEST_EMAIL,PASSWORD=$TEST_PASS \
  --query 'AuthenticationResult.IdToken' --output text)

# Retry up to 5 messages from the ingest DLQ
set DLQ_URL (string replace -r '/?$' '' $API_URL)"/dlq/retry"
curl -s "$DLQ_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d '{"queue":"ingest","max":5}' | jq
```

#### 13.5 Audit JSONL quick-inspect helpers
JSONL files are partitioned like: `tenantId=<id>/date=YYYY-MM-DD/hour=HH/<uuid>.jsonl`.

```fish
set AUDIT_BUCKET (aws cloudformation describe-stacks \
  --stack-name EtL-Storage \
  --query "Stacks[0].Outputs[?OutputKey=='AuditBucketName'].OutputValue" \
  --output text)
set DATE_UTC (date -u +%F)

# List partition
aws s3 ls "s3://$AUDIT_BUCKET/tenantId=demo/date=$DATE_UTC/" --recursive

# Tail the newest JSONL (first few lines)
set SAMPLE (aws s3 ls "s3://$AUDIT_BUCKET/tenantId=demo/date=$DATE_UTC/" --recursive | sort -k1,1 -k2,2 | tail -n1 | awk '{print $4}')
aws s3 cp "s3://$AUDIT_BUCKET/$SAMPLE" /tmp/audit.jsonl
sed -n '1,10p' /tmp/audit.jsonl
```

#### 13.6 Metrics namespace (etl.health) smoke check
Confirms custom business metrics are flowing (Powertools for Lambda).
```fish
aws cloudwatch list-metrics --namespace etl.health \
  --query "Metrics[].MetricName" --output text
```
>If empty, generate traffic (ingest/reprocess) and re-run. You should see names like `normalize_count`, `dto_invalid_count`, `fhir_invalid_count`, `persist_error_count`, etc.

#### 13.7 End-to-end demo recipe (HL7v2)
```fish
# 0) Vars
set DATE (date -u +%F)
set RAW_BUCKET (aws cloudformation describe-stacks --stack-name EtL-Storage --query "Stacks[0].Outputs[?OutputKey=='RawLandingBucketName'].OutputValue" --output text)
set API_URL (aws cloudformation describe-stacks --stack-name EtL-ReprocessApi --query "Stacks[0].Outputs[?OutputKey=='ReprocessApiUrl'].OutputValue" --output text)
set TABLE (aws cloudformation describe-stacks --stack-name EtL-Data --query "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue" --output text)

# 1) Upload HL7
aws s3 cp schema/examples/hl7/minimal.hl7 s3://$RAW_BUCKET/raw/demo/$DATE/minimal.hl7

# 2) Reprocess
curl -s (string replace -r '/?$' '' $API_URL)"/reprocess" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"tenantId":"demo","bucket":"'$RAW_BUCKET'","key":"raw/demo/'$DATE'/minimal.hl7"}' | jq

# 3) Verify observations
aws dynamodb query \
  --table-name $TABLE \
  --key-condition-expression "PK = :pk AND begins_with(SK, :sk)" \
  --expression-attribute-values '{":pk":{"S":"TENANT#demo"},":sk":{"S":"ENTITY#observation#"}}' \
  --projection-expression "PK, SK, entityType, entityId, attributes, updatedAt, version" \
  --output json | jq

# 4) Health snapshot
curl -s (string replace -r '/?$' '' $API_URL)"/health?tenantId=demo" \
  -H "Authorization: Bearer $JWT" | jq
```

#### 13.8 Appendix — ingest.raw.v1 envelope notes (Normalize accepts)
Your Normalize step now accepts three shapes and branches accordingly:
```json
// A) Generic JSON (HTTP ingest)
{
  "schema": "ingest.raw.v1",
  "metadata": { "tenantId": "demo", "source": "api", "idempotencyKey": "..." },
  "payload": { "studyInstanceUID": "1.2.3.4", "patientId": "P001", "modality": "CR" }
}
```
```json
// B) CSV file reference (Reprocess)
{
  "schema": "ingest.raw.v1",
  "metadata": {
    "tenantId": "demo",
    "source": "reprocess",
    "idempotencyKey": "reproc:raw/demo/YYYY-MM-DD/labx.csv"
  },
  "payload": {
    "s3": { "bucket": "<raw-bucket>", "key": "raw/demo/YYYY-MM-DD/labx.csv" },
    "contentType": "text/csv"
  }
}
```
```json
// C) HL7v2 file reference (Reprocess)
{
  "schema": "ingest.raw.v1",
  "metadata": {
    "tenantId": "demo",
    "source": "reprocess",
    "idempotencyKey": "reproc:raw/demo/YYYY-MM-DD/minimal.hl7"
  },
  "payload": {
    "s3": { "bucket": "<raw-bucket>", "key": "raw/demo/YYYY-MM-DD/minimal.hl7" },
    "contentType": "application/hl7-v2"
  }
}
```


### 14. Extra: sanity checks you’ll actually use
  ``` fish
# Which Lambda consumes the normalized queue?
aws lambda list-event-source-mappings \
  --function-name $PFN \
  --query "EventSourceMappings[].{State:State,SourceArn:EventSourceArn,BatchSize:BatchSize}" \
  --output table

# Quick queue counts
for Q in $IQURL $NQURL $PQURL
    echo "Queue: $Q"
    aws sqs get-queue-attributes --queue-url $Q \
      --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
      --output json | jq
end

# Show last 20 persist Lambda errors (if any)
aws logs filter-log-events \
  --log-group-name "/aws/lambda/$PFN" \
  --filter-pattern "ERROR" \
  --limit 20 | jq -r '.events[].message'
  ```

### 15. Clean up (local queues while testing)
If you’ve spammed test messages and want a clean slate:
  ``` fish
# Drain NQURL (normalized) safely — repeat an appropriate number of times or script it
for i in (seq 1 10)
    set BATCH (aws sqs receive-message --queue-url $NQURL \
      --max-number-of-messages 10 --wait-time-seconds 2 --visibility-timeout 0)
    for H in (echo $BATCH | jq -r '.Messages[]?.ReceiptHandle')
        aws sqs delete-message --queue-url $NQURL --receipt-handle "$H"
    end
end

  ```