# ETL Healthcare Pipeline (Serverless, AWS, TypeScript)

This project is a **serverless ETL pipeline** built on AWS and TypeScript.  
It demonstrates how to ingest healthcare data (HL7, FHIR, CSV, JSON), normalize it into a clean model, persist it to DynamoDB, and expose query APIs — all while following **microservice-ready boundaries**.


## 🌐 Overview

This repo serves as a **reference implementation** of a cloud-native, event-driven healthcare data pipeline.  
It is designed to highlight both *practical data processing* and *modern architectural principles*:

- **Event-driven, serverless architecture** → decoupled stages using SQS, Lambda, and DynamoDB.  
- **Separation of concerns via contracts and events** → schemas define exactly what each service consumes/produces.  
- **Scalable ingestion** → flexible entry points (HL7, FHIR, CSV, JSON) that all normalize into a consistent model.  
- **Cloud-native best practices** → least-privilege IAM, dead-letter queues, alarms, strong observability.  
- **Monorepo-ready structure** → services are colocated now, but can be split into separate packages or repos later.  
- **Independent deployability** → each stack (ingest, normalize, persist, query, etc.) can be deployed and evolved in isolation.  
- **Developer-friendly DX** → built with AWS CDK in TypeScript for type safety, better tooling, and consistency.

The goal: show how to build a **modular, production-ready ETL pipeline for healthcare data**, balancing **real-world data handling** with **clean architecture**.

## Table of content

<details>
<summary>Expand contents</summary>

- [Architecture Overview](#-architecture-overview)
- [Repository Layout](#-repository-layout)
- [Contracts](#-contracts)
  - [Why we use contracts](#why-we-use-contracts)
  - [Folder layout](#folder-layout)
  - [Current contracts](#current-contracts)
  - [Why this layout matters](#why-this-layout-matters)
- [Quickstart](#-quickstart)
- [Validate the Pipeline](#-validate-the-pipeline)
  - [1. Set context (region, profile)](#1-set-context-region-profile)
  - [2. Discover resource endpoints/ARNs](#2-discover-resource-endpointsarns)
  - [3. Tail the persist Lambda logs (CloudWatch)](#3-tail-the-persist-lambda-logs-cloudwatch)
  - [4. Smoke test: ingest via HTTP](#4-smoke-test-ingest-via-http)
  - [5. Did the normalized message land? (SQS peek)](#5-did-the-normalized-message-land-sqs-peek)
  - [6. DynamoDB write checks](#6-dynamodb-write-checks)
  - [7. Observe etl.persisted.v1 events](#7-observe-etlpersistedv1-events)
  - [8. Read-and-remove a message (SQS hygiene)](#8-read-and-remove-a-message-sqs-hygiene)
  - [9. Idempotency demo (no double-writes)](#9-idempotency-demo-no-double-writes)
  - [10. Query Layer: AppSync + Cognito (GraphQL)](#10-query-layer-appsync--cognito-graphql)
    - [10.0 Stack deployment](#100-stack-deployment)
    - [10.1 Create a test Cognito user](#101-create-a-test-cognito-user)
    - [10.2 Authenticate and get a JWT token](#102-authenticate-and-get-a-jwt-token)
    - [10.3 Send GraphQL queries](#103-send-graphql-queries)
    - [10.4 Quick GraphQL smoke tests with Bruno API Client](#104-quick-graphql-smoke-tests-with-bruno-api-client)
  - [11. Extra: sanity checks you’ll actually use](#11-extra-sanity-checks-youll-actually-use)
  - [12. Clean up (local queues while testing)](#12-clean-up-local-queues-while-testing)
</details>

## 🚀 Architecture Overview

```
┌─────────┐     ┌──────────────┐     ┌─────────────┐     ┌─────────────┐
│  Ingest │ --> │ Normalization│ --> │ Persistence │ --> │  Query API  │
└─────────┘     └──────────────┘     └─────────────┘     └─────────────┘
     │                 │                    │                  │
     ▼                 ▼                    ▼                  ▼
 Raw S3 + SQS     Normalized SQS       DynamoDB Table     GraphQL / AppSync
```

**Service boundaries:**

- **Ingest**  
  Accepts raw payloads (HL7, FHIR, CSV, JSON) over HTTP.  
  Stores a copy in S3 for audit/replay, and emits `ingest.raw.v1` events to the ingest queue.  

- **Normalize**  
  Consumes raw events, validates against JSON Schemas, and maps into clean DTOs.  
  Emits `etl.normalized.v1` messages that downstreams can rely on without parsing raw input.  

- **Persist**  
  Idempotently writes normalized data to the DynamoDB single-table design.  
  Emits `etl.persisted.v1` confirmations to guarantee safe retries and downstream notifications.  

- **Query API**  
  GraphQL API (AppSync + Cognito auth) that exposes persisted data.  
  Uses dedicated GSIs to serve patient timelines, lookups, and latest observations.  

- **Audit / Search**  
  Every persisted event can also be appended to an S3 log bucket or indexed into OpenSearch.  
  This creates a **composable event log** for compliance, analytics, or ML enrichment.

**Why this separation matters:**  
- Each stage is independently testable and replaceable.  
- Failures are isolated (e.g., normalization bugs don’t break ingestion).  
- Reprocessing is possible (e.g., replay from S3 if mappings change).  
- Contracts (JSON Schemas) ensure services evolve safely without breaking each other.

## 📂 Repository Layout
<details>
     <summary>View the repo layout</summary>

```
etl-healthcare/
├── libs/                         # Shared libraries
│   ├── adapters/                 # External service adapters
│   ├── contracts/                # Event & DTO schemas
│   │   └── src/
│   │       ├── dto/              # Data transfer objects
│   │       │   ├── normalized.observation.v1.json
│   │       │   └── normalized.patient.v1.json
│   │       └── events/           # Event schemas
│   │           ├── etl.normalized.v1.json
│   │           ├── etl.persisted.v1.json
│   │           └── ingest.raw.v1.json
│   ├── obs/                      # Observability helpers
│   ├── ports/                    # Interface definitions
│   ├── storage-ddb/              # DynamoDB utilities
│   └── validation/               # Schema validation
├── schema/                       # API schemas & examples
│   ├── examples/                 # Sample payloads (HL7, FHIR, etc.)
│   └── graphql/                  # GraphQL schema definitions
├── services/                     # Lambda business logic
│   ├── api-query/                # GraphQL resolvers
│   ├── audit/                    # Audit logging
│   ├── ingest/                   # Raw data ingestion
│   ├── normalize/                # Data validation & transformation
│   ├── persist/                  # DynamoDB operations
│   └── search/                   # Search functionality
├── src/                          # CDK infrastructure code
│   ├── bin/
│   │   └── app.ts                # CDK app entry point
│   └── stacks/                   # Infrastructure stacks
│       ├── alarms-stack.ts       # CloudWatch alarms, dashboards
│       ├── appsync-stack.ts      # GraphQL API, resolvers
│       ├── auth-stack.ts         # Cognito, IAM roles
│       ├── data-stack.ts         # DynamoDB tables, GSIs
│       ├── audit-stack.ts        # Lambda functions, Step Functions
│       ├── messaging-stack.ts    # SQS queues, SNS topics
│       └── storage-stack.ts      # S3 buckets, KMS keys
├── cdk.json                      # CDK configuration
├── package.json                  # Root package.json
├── pnpm-workspace.yaml          # pnpm workspace configuration
├── README.md                    # This file
├── tsconfig.base.json           # Shared TypeScript config
└── tsconfig.json                # TypeScript configuration

# Generated/ignored files:
# ├── cdk.context.json           # CDK context cache (gitignored)
# ├── cdk.out/                   # CDK synthesis output (gitignored)
# ├── dist/                      # Compiled TypeScript (gitignored)  
# └── node_modules/              # Dependencies (gitignored)
```     
</details>


## 📜 Contracts

In this project, **contracts** are **formal JSON Schemas** that define the structure of messages exchanged between pipeline stages.  
Instead of sending ad-hoc JSON, we enforce strict contracts so every service knows exactly what to expect.

#### Why we use contracts

- **Consistency** – the same event type always has the same shape.  
- **Validation** – payloads can be checked against a schema before being processed.  
- **Versioning** – breaking changes go into a new schema (`.v2.json`), so old services continue working.  
- **Type safety** – schemas are compiled into `.d.ts` definitions for TypeScript services.  
- **Compliance** – in healthcare, strict schemas reduce risk of malformed or incomplete records.


#### Folder layout

```
libs/contracts
├── schemas/              # Raw JSON Schemas (registry-ready)
│   ├── etl.normalized.v1.json
│   ├── etl.persisted.v1.json
│   └── ingest.raw.v1.json
└── src/
    ├── dto/              # DTO-level schemas for sub-entities
    │   ├── normalized.observation.v1.json
    │   └── normalized.patient.v1.json
    ├── events/           # Event-level schemas (mirrors /schemas)
    │   ├── etl.normalized.v1.json
    │   ├── etl.persisted.v1.json
    │   └── ingest.raw.v1.json
    ├── types.ts          # Generated TypeScript types
    │   ├── etl.normalized.v1.d.ts
    │   ├── etl.persisted.v1.d.ts
    │   └── ingest.raw.v1.d.ts
    └── validate.ts       # Shared validation helpers
```

- **`schemas/`** → canonical JSON Schemas (synced to the Schema Registry S3 bucket).  
- **`src/events/`** → same schemas colocated with code for runtime use.  
- **`src/dto/`** → smaller sub-schemas (patients, observations) that plug into larger contracts.  
- **`src/types.ts`** → TypeScript bindings auto-generated from schemas for type-safe coding.  
- **`src/validate.ts`** → utility functions to validate payloads against the right schema.

#### Current Contracts

- **`ingest.raw.v1.json`**  
  Shape of raw payloads ingested via the HTTP API. Contains standard metadata (tenant, source, idempotency key) + raw payload.

- **`etl.normalized.v1.json`**  
  Canonical normalized shape emitted by the Normalizer. Guarantees all downstream services see a unified event format.

- **`etl.persisted.v1.json`**  
  Emitted after a successful DynamoDB write. Serves as a commit log for auditing or fanning out to other services.

- **`normalized.observation.v1.json`**  
  Defines the structure of normalized **Observation** entities (labs, vitals, etc).

- **`normalized.patient.v1.json`**  
  Defines the structure of normalized **Patient** entities (IDs, demographics).


#### Why this layout matters

This split ensures we get the best of both worlds:

- **Registry & sharing** → top-level `/schemas` is easy to sync to S3 or publish.  
- **Runtime & dev tooling** → `/src` gives validators and TypeScript types directly to services.  
- **Fine-grained reuse** → DTO schemas (patients, observations) can be embedded across multiple event schemas.

The result: every stage in the ETL pipeline has **clear, enforceable contracts** for what it consumes and produces.  
That makes the system modular, testable, and safer to evolve over time.


## ⚡ Quickstart

1. **Clone & install**
   ```bash
   git clone https://github.com/buralog/etl-healthcare.git
   cd etl-healthcare
   pnpm install
   ```

2. **Bootstrap AWS CDK**
   ```bash
   pnpm run bootstrap
   ```

3. **Deploy core stacks**
   ```bash
   pnpm run build
   pnpm run deploy:dev
   ```

4. **Check resources**
   ```bash
   aws s3 ls
   aws dynamodb list-tables
   ```

## ⚡ Validate the Pipeline
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


### 11. Extra: sanity checks you’ll actually use
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

### 12. Clean up (local queues while testing)
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

## ✅ Roadmap

- [x] Bootstrap repo with CDK & pnpm
- [x] Deploy Storage + Data + Messaging stacks
- [x] Implement Ingest Lambda (API Gateway → S3 + SQS)
- [x] Add Normalization Lambda (validate → DTOs → SQS)
- [x] Add Persistence Lambda (idempotent DDB writes → event emit)
- [x] AppSync GraphQL API for queries
- [ ] Alarms & Observability (CloudWatch)
- [ ] Optional Search integration (OpenSearch)
