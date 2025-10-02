import { createHash } from "crypto";
import { NormalizedObservationSchema, type NormalizedObservation } from "../../validation/dto";

/**
 * Minimal HL7 v2 parser (PID + OBX only).
 * - Splits by CR or LF
 * - Finds patientId from PID-3 (first repetition, first component)
 * - For each OBX:
 *   * code from OBX-3 (CE: id)
 *   * value from OBX-5 (text/num)
 *   * unit from OBX-6 (CE: text or id)
 *   * effectiveDateTime from OBX-14 (YYYYMMDDHHMMSS[.S] -> ISO) or now()
 */
export function parseHl7v2(buf: Buffer, opts: { tenantId: string; sourceSystem?: string }): NormalizedObservation[] {
    const text = buf.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const segments = text.split("\n").filter(Boolean);

    let patientId = "";
    const out: NormalizedObservation[] = [];

    // Helpers
    const comp = (v: string) => v.split("^"); // HL7 component splitter
    const toIso = (ts?: string): string => {
        if (!ts) return new Date().toISOString();
        // HL7 TS: YYYYMMDDHHMMSS(.S)?(+/-ZZZZ)?
        const m = ts.match(/^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
        if (!m) return new Date().toISOString();
        const [_, y, mo = "01", d = "01", h = "00", mi = "00", s = "00"] = m;
        const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
        return iso;
    };

    // Pass 1: capture PID
    for (const line of segments) {
        const fields = line.split("|");
        const tag = fields[0];
        if (tag === "PID") {
            // PID-3 = Patient Identifier List (may repeat)
            // pick first repetition, first component before ^
            const pid3 = fields[3] || "";
            const rep1 = pid3.split("~")[0] || "";
            const c = comp(rep1);
            patientId = c[0] || c[1] || ""; // sometimes id sits in comp 1 or 2 depending on feed
            break;
        }
    }

    // Pass 2: each OBX -> DTO
    for (const line of segments) {
        const fields = line.split("|");
        if (fields[0] !== "OBX") continue;

        // OBX-3: CE (id^text^system^...)
        const obx3 = fields[3] || "";
        const c3 = comp(obx3);
        const code = (c3[0] || c3[1] || "").trim();

        // OBX-5: observation value (may be text/numeric)
        const valueRaw = (fields[5] || "").trim();
        const valueNum = Number(valueRaw);
        const value = Number.isFinite(valueNum) ? valueNum : NaN;

        // OBX-6: units CE (id^text^system...)
        const obx6 = fields[6] || "";
        const c6 = comp(obx6);
        const unit = (c6[1] || c6[0] || "").trim() || "1";

        // OBX-14: date/time of observation
        const effectiveDateTime = toIso((fields[14] || "").trim());

        // Build DTO candidate
        const candidate = {
            schemaVersion: 1 as const,
            patientId: String(patientId || "unknown"),
            code: String(code || "unknown"),
            value: value,
            unit,
            effectiveDateTime,
            sourceSystem: opts.sourceSystem ?? "hl7v2:file",
            ingestHash: "sha256:" + createHash("sha256").update(line).digest("hex"),
        };

        // Validate & skip invalid numeric values
        try {
            const dto = NormalizedObservationSchema.parse(candidate);
            out.push(dto);
        } catch {
            // If value is not numeric, you could map to valueString instead in a future extension.
            // For now, skip non-numeric observations to keep pipeline simple.
            continue;
        }
    }

    return out;
}
