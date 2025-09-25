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
