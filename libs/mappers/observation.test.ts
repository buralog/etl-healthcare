import { dtoToFhirObservation } from "./observation";
import { validateObservation } from "../validation/fhir-ajv";

test("DTO -> FHIR Observation validates", () => {
    const dto = {
        schemaVersion: 1,
        patientId: "p1",
        code: "718-7",
        value: 5.6,
        unit: "mmol/L",
        effectiveDateTime: "2025-09-30T10:00:00Z",
        sourceSystem: "csv:labx",
        ingestHash: "sha256:abc",
    };
    const fhir = dtoToFhirObservation(dto as any);
    const v = validateObservation(fhir);
    expect(v).toEqual({ ok: true });
});
