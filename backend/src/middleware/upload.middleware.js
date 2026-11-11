import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import {
  FILE_CONTENT_TYPES,
  FILE_EXTENSIONS_BY_MIME_TYPE,
} from "../utils/file-metadata.js";

// Temporary upload directory
const uploadDirectory = path.resolve(
  process.cwd(),
  "storage",
  "tmp"
);

// Create directory if it does not exist
fs.mkdirSync(uploadDirectory, { recursive: true });

// Configure disk storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDirectory);
  },

  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const storedExtension =
      extension === ".jpeg"
        ? ".jpg"
        : FILE_EXTENSIONS_BY_MIME_TYPE[file.mimetype];
    const uniqueFilename = `${randomUUID()}${storedExtension}`;
    cb(null, uniqueFilename);
  },
});

// Validate file type
const fileFilter = (req, file, cb) => {
  const extension = path.extname(file.originalname).toLowerCase();

  const expectedMimeType = FILE_CONTENT_TYPES[extension];
  const isSupportedFile =
    expectedMimeType && expectedMimeType === file.mimetype;

  if (isSupportedFile) {
    return cb(null, true);
  }

  const error = new Error("Only PDF, JPG, JPEG, and PNG files are allowed.");
  error.status = 400;

  cb(error);
};

// Configure Multer
const upload = multer({
  storage,
  fileFilter,

  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
    files: 1,
  },
});

// Export single invoice upload middleware
export const uploadInvoice = upload.single("invoice");
