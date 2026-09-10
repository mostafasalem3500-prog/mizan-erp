import { buildPhase1QR, buildPhase2QR, decodeQR } from "./qr-encoder";

describe("ZATCA QR encoder (spec-verified, see docs/compliance/ZATCA_SOURCES.md)", () => {
  test("Phase 1 QR round-trips through decode with tags 1-5 in order", () => {
    const b64 = buildPhase1QR({
      sellerName: "Mizan Demo Store",
      vatRegistrationNumber: "300000000000003",
      invoiceTimestamp: "2022-02-21T12:13:57Z",
      invoiceTotalWithVat: "115.00",
      vatTotal: "15.00",
    });

    const decoded = decodeQR(b64);
    expect(decoded.map((d) => d.tag)).toEqual([1, 2, 3, 4, 5]);
    expect(decoded[0].value.toString("utf8")).toBe("Mizan Demo Store");
    expect(decoded[1].value.toString("utf8")).toBe("300000000000003");
    expect(decoded[4].value.toString("utf8")).toBe("15.00");
  });

  test("Phase 2 QR includes tags 6-8 and omits 9 when no ZATCA stamp is supplied", () => {
    const hash = Buffer.alloc(32, 1); // dummy 32-byte SHA-256-shaped buffer
    const sig = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const pubKey = Buffer.from([0x04, 0x01, 0x02]);

    const b64 = buildPhase2QR({
      sellerName: "Mizan Demo Store",
      vatRegistrationNumber: "300000000000003",
      invoiceTimestamp: "2023-06-01T09:00:00Z",
      invoiceTotalWithVat: "230.00",
      vatTotal: "30.00",
      invoiceXmlHash: hash,
      ecdsaSignature: sig,
      ecdsaPublicKey: pubKey,
    });

    const decoded = decodeQR(b64);
    expect(decoded.map((d) => d.tag)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(decoded[5].value.equals(hash)).toBe(true);
    expect(decoded[6].value.equals(sig)).toBe(true);
  });

  test("Phase 2 QR includes tag 9 when a ZATCA stamp signature is supplied (simplified invoice)", () => {
    const hash = Buffer.alloc(32, 2);
    const sig = Buffer.from([1, 2, 3]);
    const pubKey = Buffer.from([4, 5, 6]);
    const stamp = Buffer.from([7, 8, 9]);

    const b64 = buildPhase2QR({
      sellerName: "Mizan Demo Store",
      vatRegistrationNumber: "300000000000003",
      invoiceTimestamp: "2023-06-01T09:00:00Z",
      invoiceTotalWithVat: "50.00",
      vatTotal: "6.52",
      invoiceXmlHash: hash,
      ecdsaSignature: sig,
      ecdsaPublicKey: pubKey,
      zatcaStampSignature: stamp,
    });

    const decoded = decodeQR(b64);
    expect(decoded.map((d) => d.tag)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(decoded[8].value.equals(stamp)).toBe(true);
  });

  test("rejects a hash that is not exactly 32 bytes", () => {
    expect(() =>
      buildPhase2QR({
        sellerName: "X",
        vatRegistrationNumber: "300000000000003",
        invoiceTimestamp: "2023-06-01T09:00:00Z",
        invoiceTotalWithVat: "1.00",
        vatTotal: "0.13",
        invoiceXmlHash: Buffer.alloc(10), // wrong length
        ecdsaSignature: Buffer.from([1]),
        ecdsaPublicKey: Buffer.from([1]),
      }),
    ).toThrow(/32 bytes/);
  });

  test("rejects a field value longer than 255 bytes (TLV length byte overflow)", () => {
    expect(() =>
      buildPhase1QR({
        sellerName: "A".repeat(300),
        vatRegistrationNumber: "300000000000003",
        invoiceTimestamp: "2023-06-01T09:00:00Z",
        invoiceTotalWithVat: "1.00",
        vatTotal: "0.13",
      }),
    ).toThrow(/255/);
  });
});
