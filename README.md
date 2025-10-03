# ETL Healthcare Pipeline

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
- [Architecture Overview](#-architecture-overview)
- [Repository Layout](#-repository-layout)
- [Contracts](#-contracts)
  - [Why we use contracts](#why-we-use-contracts)
  - [Folder layout (contracts + validation)](#folder-layout-contracts--validation))
  - [Current contracts](#current-contracts)
  - [How validation layers fit together](#how-validation-layers-fit-together)
  - [Why this split matters](#why-this-split-matters)
- [Quickstart](#-quickstart)
- [Validate the Pipeline](#-validate-the-pipeline)

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


```pgsql
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
Instead of ad-hoc JSON, we enforce strict contracts so every service knows exactly what to expect.

#### Why we use contracts

- **Consistency** – the same event type always has the same shape.
- **Validation** – payloads are checked against a schema before processing.
- **Versioning** – breaking changes go to a new schema (`.v2.json`) so older services keep working.
- **Type safety** – schemas compile to `.d.ts` definitions for TypeScript services.
- **Compliance** – in healthcare, strict schemas reduce the risk of malformed or incomplete records.


#### Folder layout (contracts + validation)

```pgsql
libs/
├── contracts/
│   ├── schemas/                     # Canonical, registry-ready JSON Schemas
│   │   ├── etl.normalized.v1.json
│   │   ├── etl.persisted.v1.json
│   │   ├── ingest.raw.v1.json
│   │   └── fhir/
│   │       └── Observation.r4.min.json   # Minimal FHIR R4 Observation schema (AJV)
│   └── src/
│       ├── dto/                     # DTO-level sub-schemas (embedded by events)
│       │   ├── normalized.observation.v1.json
│       │   └── normalized.patient.v1.json
│       ├── events/                  # Event-level schemas (mirrors /schemas)
│       │   ├── etl.normalized.v1.json
│       │   ├── etl.persisted.v1.json
│       │   └── ingest.raw.v1.json
│       ├── types.ts                 # Barrel; generated .d.ts live alongside
│       │   ├── etl.normalized.v1.d.ts
│       │   ├── etl.persisted.v1.d.ts
│       │   └── ingest.raw.v1.d.ts
│       └── validate.ts              # Schema lookup + shared AJV helpers
└── validation/
    ├── dto.ts                       # Zod validators for internal DTOs
    └── fhir-ajv.ts                  # AJV validator compiled from FHIR schema
```

- **`schemas/`** → canonical JSON Schemas (synced to the Schema Registry S3 bucket).  
- **`src/events/`** → same schemas colocated with code for runtime use.  
- **`src/dto/`** → smaller sub-schemas (patients, observations) that plug into larger contracts.  
- **`src/types.ts`** → TypeScript bindings auto-generated from schemas for type-safe coding.  
- **`src/validate.ts`** → utility functions to validate payloads against the right schema.
- **`contracts/schemas/`** → canonical JSON Schemas (easy to sync to a registry/S3). Includes a **minimal FHIR R4 Observation schema** used to validate mapped FHIR output.
- **`contracts/src/events/`** → runtime copies of the event schemas for services.
- **`contracts/src/dto/`** → reusable sub-schemas (patients, observations) embedded by events.
- **`contracts/src/types.ts`** → barrel + generated typings (`.d.ts`) for type-safe code.
- **`contracts/src/validate.ts`** → shared helpers to load/validate against the correct event schema.
- **`validation/dto.ts`** → Zod validation for internal DTOs (pre-mapping).
- **`validation/fhir-ajv.ts`** → AJV validator built from `schemas/fhir/Observation.r4.min.json`.

#### Current Contracts

- `ingest.raw.v1.json` — shape of raw payloads ingested via HTTP/API (tenant, source, idempotency key + raw blob).
- `etl.normalized.v1.json` — canonical normalized event emitted by the Normalizer; unifies all sources.
- `etl.persisted.v1.json` — commit-log event after a successful DynamoDB write (for audit/fan-out).
- `normalized.observation.v1.json` — normalized **Observation** DTO structure (labs, vitals, etc.).
- `normalized.patient.v1.json` — normalized **Patient** DTO structure (IDs, demographics).
- `fhir/Observation.r4.min.json` — **FHIR R4 Observation** (pruned/minimal) used to validate the mapped FHIR resource.

#### How validation layers fit together

1. **DTO layer (Zod)** — `validation/dto.ts` ensures normalized DTOs are well-formed.
2. **Event layer (AJV)** — `contracts/src/validate.ts` checks messages against `ingest.raw.v1`, `etl.normalized.v1`, `etl.persisted.v1`.
3. **FHIR layer (AJV)** — `validation/fhir-ajv.ts` validates the produced **FHIR Observation** against the minimal R4 schema.

#### Why this split matters
- **Registry & sharing** → `contracts/schemas` is clean to publish or sync.
- **Runtime & tooling** → `contracts/src` gives validators + types directly to services.
- **Separation of concerns** → DTO validation (Zod) vs. Event validation (JSON Schema/AJV) vs. FHIR conformance (AJV) stay independent, making evolution safer.


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
