/**
 * ZATCA simplified-invoice QR code encoder.
 *
 * Source: docs/compliance/ZATCA_SOURCES.md §2 — "Electronic Invoice Security
 * Features Implementation Standards", version 1.2, dated 2023-05-19,
 * section 4 ("QR code specifications"), content verified by direct fetch of
 * the official PDF on 2026-09-09. Do not add, remove, or reorder tags
 * without updating that source entry first (spec bands 53-56, 149).
 *
 * Tag-Length-Value encoding, per the official spec:
 *   - Tag: 1 byte
 *   - Length: 1 byte (UTF-8 byte length of the value; for tag 6 the hash
 *     is always 32 bytes)
 *   - Value: UTF-8 encoded bytes
 * The full TLV byte sequence is then Base64-encoded.
 *
 * Tags 1-5 are Phase 1 (mandatory since 2021-12-04). Tags 6-9 are Phase 2
 * additions (mandatory since 2023-01-01) and are only included here when
 * the caller supplies them — this module does not decide which phase a
 * given organization is on; see zatca_compliance_profiles (spec band 57),
 * not yet modeled in this Phase 0 schema.
 */

export interface Phase1QRFields {
  sellerName: string;
  vatRegistrationNumber: string;
  /** ISO 8601, e.g. 2022-02-21T12:13:57Z — must match the invoice's issue timestamp */
  invoiceTimestamp: string;
  /** Invoice total including VAT, as a decimal string, e.g. "115.00" */
  invoiceTotalWithVat: string;
  /** Total VAT amount (BT-110), as a decimal string, e.g. "15.00" */
  vatTotal: string;
}

export interface Phase2QRFields extends Phase1QRFields {
  /** SHA-256 hash of the invoice XML, raw 32 bytes */
  invoiceXmlHash: Buffer;
  /** ECDSA signature of the invoice hash, raw bytes */
  ecdsaSignature: Buffer;
  /** ECDSA public key extracted from the signing private key, raw bytes */
  ecdsaPublicKey: Buffer;
  /** ECDSA signature of ZATCA's cryptographic stamp — simplified invoices only */
  zatcaStampSignature?: Buffer;
}

type TagId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

function tlv(tag: TagId, value: Buffer): Buffer {
  if (value.length > 255) {
    throw new Error(
      `QR field for tag ${tag} is ${value.length} bytes, but the TLV length ` +
        `byte can only encode up to 255 (spec band: Security Features Implementation Standards §4.1).`,
    );
  }
  return Buffer.concat([Buffer.from([tag]), Buffer.from([value.length]), value]);
}

function tlvString(tag: TagId, value: string): Buffer {
  return tlv(tag, Buffer.from(value, "utf8"));
}

/** Builds the Phase 1 QR payload (tags 1-5 only) and returns it Base64-encoded. */
export function buildPhase1QR(fields: Phase1QRFields): string {
  const buf = Buffer.concat([
    tlvString(1, fields.sellerName),
    tlvString(2, fields.vatRegistrationNumber),
    tlvString(3, fields.invoiceTimestamp),
    tlvString(4, fields.invoiceTotalWithVat),
    tlvString(5, fields.vatTotal),
  ]);
  return buf.toString("base64");
}

/** Builds the full Phase 2 QR payload (tags 1-9, with 9 optional) and returns it Base64-encoded. */
export function buildPhase2QR(fields: Phase2QRFields): string {
  if (fields.invoiceXmlHash.length !== 32) {
    throw new Error(
      `Invoice hash must be exactly 32 bytes (SHA-256); got ${fields.invoiceXmlHash.length}.`,
    );
  }

  const parts = [
    tlvString(1, fields.sellerName),
    tlvString(2, fields.vatRegistrationNumber),
    tlvString(3, fields.invoiceTimestamp),
    tlvString(4, fields.invoiceTotalWithVat),
    tlvString(5, fields.vatTotal),
    tlv(6, fields.invoiceXmlHash),
    tlv(7, fields.ecdsaSignature),
    tlv(8, fields.ecdsaPublicKey),
  ];

  if (fields.zatcaStampSignature) {
    parts.push(tlv(9, fields.zatcaStampSignature));
  }

  return Buffer.concat(parts).toString("base64");
}

/**
 * Decodes a Base64 QR payload back into its tagged fields, for the
 * "QR Inspector" developer tool required by spec band 87. Never surface the
 * raw signature/public-key bytes as anything other than opaque hex in a UI —
 * this function itself does not redact, callers must (spec band 87: "does
 * not show secrets", interpreted here as "does not decode a private key",
 * which is never present in a QR payload — only the public key and a
 * signature, which are not secret, but callers building the Inspector UI
 * should still label them clearly rather than implying they're sensitive).
 */
export function decodeQR(base64Payload: string): Array<{ tag: number; length: number; value: Buffer }> {
  const buf = Buffer.from(base64Payload, "base64");
  const result: Array<{ tag: number; length: number; value: Buffer }> = [];
  let offset = 0;

  while (offset < buf.length) {
    const tag = buf[offset];
    const length = buf[offset + 1];
    const value = buf.subarray(offset + 2, offset + 2 + length);
    result.push({ tag, length, value });
    offset += 2 + length;
  }

  return result;
}
