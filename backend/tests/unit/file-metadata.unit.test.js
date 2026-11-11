import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    FILE_CONTENT_TYPES,
    FILE_EXTENSIONS_BY_MIME_TYPE,
} from "../../src/utils/file-metadata.js";

describe("Invoice file metadata", () => {
    it("preserves all accepted extensions and MIME types", () => {
        assert.deepEqual(FILE_CONTENT_TYPES, {
            ".pdf": "application/pdf",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
        });
    });

    it("preserves canonical stored extensions by MIME type", () => {
        assert.deepEqual(FILE_EXTENSIONS_BY_MIME_TYPE, {
            "application/pdf": ".pdf",
            "image/jpeg": ".jpg",
            "image/png": ".png",
        });
    });
});
