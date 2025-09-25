import Ajv2020, { ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";

// Schemas
import ingestRaw from "../schemas/ingest.raw.v1.json";
import normalized from "../schemas/etl.normalized.v1.json";
import persisted from "../schemas/etl.persisted.v1.json";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

// Compile validators once (cold start cost only)
const validators: Record<string, ValidateFunction> = {
  "ingest.raw.v1": ajv.compile(ingestRaw as any),
  "etl.normalized.v1": ajv.compile(normalized as any),
  "etl.persisted.v1": ajv.compile(persisted as any),
};

export function validate<T>(schemaName: keyof typeof validators, data: unknown): asserts data is T {
  const v = validators[schemaName];
  if (!v(data)) {
    const messages = (v.errors || []).map(e => `${e.instancePath || '/'} ${e.message}`).join("; ");
    const err = new Error(`Schema validation failed for ${schemaName}: ${messages}`);
    (err as any).details = v.errors;
    throw err;
  }
}
