import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";

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
    const uniqueFilename = `${randomUUID()}.pdf`;
    cb(null, uniqueFilename);
  },
});

// Validate file type
const fileFilter = (req, file, cb) => {
  const extension = path.extname(file.originalname).toLowerCase();

  const isPdfExtension = extension === ".pdf";
  const isPdfMimeType = file.mimetype === "application/pdf";

  if (isPdfExtension && isPdfMimeType) {
    return cb(null, true);
  }

  const error = new Error("Only PDF files are allowed.");
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