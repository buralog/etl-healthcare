import Ajv from "ajv";
import addFormats from "ajv-formats";
import * as schema from "../contracts/schemas/fhir/Observation.r4.min.json";

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const validateObs = ajv.compile(schema as any);

export function validateObservation(resource: unknown): { ok: true } | { ok: false; errors: string[] } {
    const valid = validateObs(resource);
    if (valid) return { ok: true };
    const errors = (validateObs.errors ?? []).map(e => `${e.instancePath} ${e.message}`);
    return { ok: false, errors };
}
