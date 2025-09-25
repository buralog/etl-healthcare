# ETL Healthcare Pipeline (Serverless, AWS, TypeScript)

This project is a **serverless ETL pipeline** built on AWS and TypeScript.  
It demonstrates how to ingest healthcare data (HL7, FHIR, CSV, JSON), normalize it into a clean model, persist it to DynamoDB, and expose query APIs — all while following **microservice-ready boundaries**.

Designed to showcase:
- Event-driven serverless architecture
- Separation of concerns via contracts and events
- Scalable data ingestion for healthcare use cases
- Cloud-native best practices (least privilege IAM, DLQs, alarms)

---

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
- **Ingest** → Accept raw payloads into S3, emit `ingest.raw.v1` events.  
- **Normalize** → Validate & map to DTOs, emit `etl.normalized.v1`.  
- **Persist** → Idempotently write to DynamoDB, emit `etl.persisted.v1`.  
- **Query API** → GraphQL access to persisted data.  
- **Audit/Search** (future) → S3 append-only logs, OpenSearch for queries.

---

## 🛠️ Tech Stack

- **Language:** TypeScript  
- **Infrastructure as Code:** AWS CDK (v2)  
- **Cloud Services:**  
  - S3 (raw landing, audit, schema registry)  
  - DynamoDB (single-table design with GSIs)  
  - SQS (service-to-service messaging + DLQs)  
  - AppSync (GraphQL API)  
  - Lambda (per service logic)  
- **Tooling:**  
  - pnpm (workspace + package manager)  
  - JSON Schema contracts (event and DTO validation)  
  - GitHub for version control

---

## 📂 Repository Layout

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
│       ├── etl-stack.ts          # Lambda functions, Step Functions
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

---

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

---


---

## ⚡ Verify the Pipeline (end-to-end & step-by-ste)
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
> NOTE: You may need to define PFN (Persist Function Name) variable again in the logging terminal aswell.
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

### 10. Extra: sanity checks you’ll actually use
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

### 11. Clean up (local queues while testing)
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

---

## 📜 Contracts

All service communication uses versioned JSON Schema contracts.
Schemas are stored locally in `libs/contracts/src` and synced to the Schema Registry S3 bucket.

- `ingest.raw.v1.json`
- `etl.normalized.v1.json`
- `etl.persisted.v1.json`
- `normalized.observation.v1.json`
- `normalized.patient.v1.json`

---

## ✅ Roadmap

- [x] Bootstrap repo with CDK & pnpm
- [x] Deploy Storage + Data + Messaging stacks
- [x] Implement Ingest Lambda (API Gateway → S3 + SQS)
- [x] Add Normalization Lambda (validate → DTOs → SQS)
- [x] Add Persistence Lambda (idempotent DDB writes → event emit)
- [ ] AppSync GraphQL API for queries
- [ ] Alarms & Observability (CloudWatch)
- [ ] Optional Search integration (OpenSearch)

---

## 📖 Notes

- This repo is structured to be monorepo-ready. Each service can later be split into its own package or repo if needed.
- Follows serverless microservice principles: clear ownership, event contracts, least privilege, independent deployability.
- Uses AWS CDK for infrastructure as code with TypeScript for type safety and better developer experience.
