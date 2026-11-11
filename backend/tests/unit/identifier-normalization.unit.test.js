import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeInvoiceNumber } from "../../src/services/duplicate-detection.service.js";
import { normalizePONumber } from "../../src/services/po-matching.service.js";

describe("Identifier normalization", () => {
    for (const normalize of [normalizeInvoiceNumber, normalizePONumber]) {
        it(`${normalize.name} handles empty and formatted values`, () => {
            assert.equal(normalize(null), null);
            assert.equal(normalize("   "), null);
            assert.equal(normalize("INV-001 / test"), "INV001TEST");
            assert.equal(normalize("po 2026_1001"), "PO20261001");
            assert.equal(normalize("Ä-特殊"), null);
        });
    }
});
