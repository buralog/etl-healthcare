import { parseLabxCsv } from "./labx";

test("parse labx csv to DTOs", () => {
    const csv = Buffer.from(
        "patientId,code,value,unit,effectiveDateTime\n" +
        "p1,718-7,5.6,mmol/L,2025-09-30T10:00:00Z\n"
    );
    const out = parseLabxCsv(csv, { tenantId: "demo" });
    expect(out.length).toBe(1);
    expect(out[0].patientId).toBe("p1");
    expect(out[0].code).toBe("718-7");
    expect(out[0].value).toBe(5.6);
    expect(out[0].unit).toBe("mmol/L");
});
