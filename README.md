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
.
├── bruno
│   └── etl-healthcare-tests.json
├── jest.config.js
├── libs
│   ├── adapters
│   │   ├── csv
│   │   │   ├── labx.test.ts
│   │   │   └── labx.ts
│   │   ├── hl7
│   │   │   ├── v2.test.ts
│   │   │   └── v2.ts
│   │   └── index.ts
│   ├── contracts
│   │   ├── schemas
│   │   │   ├── etl.normalized.v1.json
│   │   │   ├── etl.persisted.v1.json
│   │   │   ├── fhir
│   │   │   │   └── Observation.r4.min.json
│   │   │   └── ingest.raw.v1.json
│   │   └── src
│   │       ├── dto
│   │       │   ├── normalized.observation.v1.json
│   │       │   └── normalized.patient.v1.json
│   │       ├── events
│   │       │   ├── etl.normalized.v1.json
│   │       │   ├── etl.persisted.v1.json
│   │       │   └── ingest.raw.v1.json
│   │       ├── types.ts
│   │       │   ├── etl.normalized.v1.d.ts
│   │       │   ├── etl.persisted.v1.d.ts
│   │       │   └── ingest.raw.v1.d.ts
│   │       └── validate.ts
│   ├── mappers
│   │   ├── observation.test.ts
│   │   └── observation.ts
│   ├── obs
│   │   ├── audit.ts
│   │   └── metrics.ts
│   ├── ports
│   ├── storage-ddb
│   └── validation
│       ├── dto.ts
│       └── fhir-ajv.ts
├── package.json
├── schema
│   ├── examples
│   │   ├── csv
│   │   │   └── labx.csv
│   │   └── hl7
│   │       └── minimal.hl7
│   └── graphql
├── scripts
│   └── publish-schemas.sh
├── services
│   ├── api-query
│   │   ├── package.json
│   │   ├── src/handler.ts
│   │   └── tsconfig.json
│   ├── audit
│   │   ├── package.json
│   │   └── src/handler.ts
│   ├── audit-list-api
│   │   ├── package.json
│   │   └── src/handler.ts
│   ├── dlq-retry-api
│   │   ├── package.json
│   │   └── src/handler.ts
│   ├── health-api
│   │   ├── package.json
│   │   └── src/handler.ts
│   ├── ingest
│   │   └── handler.ts
│   ├── ingest-url-api
│   │   ├── package.json
│   │   └── src/handler.ts
│   ├── normalize
│   │   └── handler.ts
│   ├── persist
│   │   └── handler.ts
│   ├── reprocess-api
│   │   ├── package.json
│   │   └── src/handler.ts
│   └── reprocess-prep
│       ├── package.json
│       └── src/handler.ts
│
├── src
│   ├── appsync
│   │   └── schema.graphql
│   ├── bin
│   │   └── app.ts
│   └── stacks
│       ├── alarms-stack.ts
│       ├── appsync-stack.ts
│       ├── audit-stack.ts
│       ├── auth-stack.ts
│       ├── data-stack.ts
│       ├── ingest-stack.ts
│       ├── messaging-stack.ts
│       ├── normalize-stack.ts
│       ├── persist-stack.ts
│       ├── reprocess-api-stack.ts
│       ├── reprocess-stack.ts
│       └── storage-stack.ts
├── tsconfig.base.json
└── tsconfig.json
```

### Directory Descriptions

| Path               | Description                                   |
|--------------------|-----------------------------------------------|
| `bruno/`           | Bruno API collections for automated testing.  |
| `libs/adapters/`   | Data adapters (CSV, HL7, etc.).               |
| `libs/contracts/`  | DTOs and event schemas (JSON, FHIR).          |
| `libs/mappers/`    | Data transformation mappers.                  |
| `libs/obs/`        | Observability helpers (audit, metrics).       |
| `libs/ports/`      | Interfaces/ports for dependency inversion.    |
| `libs/storage-ddb/`| DynamoDB utility functions.                   |
| `libs/validation/` | DTO and FHIR schema validation (AJV, etc.).   |
| `schema/`          | Example payloads (CSV, HL7) and GraphQL schemas. |
| `services/`        | Lambda business logic, one folder per service. |
| `src/appsync/`     | GraphQL schema for AppSync.                   |
| `src/bin/`         | CDK app entrypoint.                           |
| `src/stacks/`      | CDK stacks (AppSync, DynamoDB, SQS, etc.).    |
| `scripts/`         | Utility scripts (e.g., publish schemas).      |
| Config files       | `cdk.json`, `tsconfig.*`, `pnpm-workspace.yaml`, etc. |

---

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
   2. **Register your AWS Account for CDK (Bootstrap)**

      Before deploying, CDK must set up your AWS account/region with a **CDK Toolkit stack**  
      (this creates the S3 bucket + IAM roles used internally by CDK).

      #### Option 1: Non-interactive (explicit account/region)
      If you already know your account ID and region, run:

      ```bash
          pnpm run bootstrap -- aws://<ACCOUNT_ID>/<REGION>
          # Example
          pnpm run bootstrap -- aws://123456789012/eu-central-1
      ```
      #### Option 2: Interactive

       If you prefer to be prompted for values:
        > pnpm run bootstrap

      This will ask:
        - Which account ID to use
        - Which region to use
        - Whether to create the bootstrap stack
     
      After confirmation, CDK provisions the bootstrap resources in your account.

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

## ✅ Validate the Pipeline

To keep this README concise, the detailed validation steps live in a separate document:  
[📖 Validation Guide](docs/VALIDATION.md)
