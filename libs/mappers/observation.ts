import type { NormalizedObservation } from "../validation/dto";

export function dtoToFhirObservation(dto: NormalizedObservation) {
    return {
        resourceType: "Observation",
        status: "final",
        code: {
            coding: [{ system: "http://loinc.org", code: dto.code }]
        },
        subject: { reference: `Patient/${dto.patientId}` },
        effectiveDateTime: dto.effectiveDateTime,
        valueQuantity: {
            value: dto.value,
            unit: dto.unit,
            system: "http://unitsofmeasure.org",
            code: dto.unit
        }
    };
}
