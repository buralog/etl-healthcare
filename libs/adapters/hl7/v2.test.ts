import { parseHl7v2 } from "./v2";

test("parse HL7 v2 PID+OBX into DTOs", () => {
    const msg = [
        "MSH|^~\\&|LAB|HOSP|ETL|PIPE|20250930101500||ORU^R01|MSGID1234|P|2.5",
        "PID|1||12345^^^HOSP^MR||DOE^JOHN",
        "OBR|1|||GLUCOSE^Glucose^LN||20250930100000",
        "OBX|1|NM|718-7^Glucose^LN||5.6|mmol/L|3.5-7.8|N|||F|||20250930100000",
    ].join("\r");

    const out = parseHl7v2(Buffer.from(msg, "utf8"), { tenantId: "demo" });
    expect(out.length).toBe(1);
    expect(out[0].patientId).toBe("12345");
    expect(out[0].code).toBe("718-7");
    expect(out[0].value).toBe(5.6);
    expect(out[0].unit).toBe("mmol/L");
    expect(out[0].effectiveDateTime).toBe("2025-09-30T10:00:00Z");
});
