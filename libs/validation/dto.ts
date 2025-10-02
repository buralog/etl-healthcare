import { z } from "zod";

export const NormalizedObservationSchema = z.object({
    schemaVersion: z.literal(1),
    patientId: z.string().min(1),
    code: z.string().min(1),            // e.g., LOINC "718-7"
    value: z.number(),
    unit: z.string().min(1),
    effectiveDateTime: z.string().datetime(), // ISO 8601
    sourceSystem: z.string().min(1),
    ingestHash: z.string().min(10),     // sha256:...
});

export type NormalizedObservation = z.infer<typeof NormalizedObservationSchema>;
