import { parse } from "csv-parse/sync";
import { createHash } from "crypto";
import { NormalizedObservationSchema, type NormalizedObservation } from "../../validation/dto";

export function parseLabxCsv(buf: Buffer, opts: { tenantId: string; sourceSystem?: string }): NormalizedObservation[] {
    const rows: any[] = parse(buf, { columns: true, skip_empty_lines: true, trim: true });
    const out: NormalizedObservation[] = [];

    for (const row of rows) {
        const raw = {
            schemaVersion: 1 as const,
            patientId: String(row.patientId),
            code: String(row.code),
            value: Number(row.value),
            unit: String(row.unit),
            effectiveDateTime: String(row.effectiveDateTime), // must be ISO
            sourceSystem: opts.sourceSystem ?? "csv:labx",
            ingestHash: "sha256:" + createHash("sha256").update(JSON.stringify(row)).digest("hex"),
        };
        const dto = NormalizedObservationSchema.parse(raw);
        out.push(dto);
    }
    return out;
}
