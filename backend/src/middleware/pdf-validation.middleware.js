import fs from "node:fs/promises";
import path from "node:path";

const fileSignatures = {
  ".pdf": {
    bytes: Buffer.from("%PDF-", "ascii"),
    message: "The uploaded file does not have a valid PDF signature.",
  },
  ".jpg": {
    bytes: Buffer.from([0xff, 0xd8, 0xff]),
    message: "The uploaded file does not have a valid JPEG signature.",
  },
  ".jpeg": {
    bytes: Buffer.from([0xff, 0xd8, 0xff]),
    message: "The uploaded file does not have a valid JPEG signature.",
  },
  ".png": {
    bytes: Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]),
    message: "The uploaded file does not have a valid PNG signature.",
  },
};

export async function validateUploadedFileSignature(req, res, next) {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "Invoice file is required.",
    });
  }

  const extension = path.extname(req.file.originalname).toLowerCase();
  const signature = fileSignatures[extension];

  if (!signature) {
    await fs.unlink(req.file.path).catch(() => {});

    return res.status(400).json({
      success: false,
      message: "Only PDF, JPG, JPEG, and PNG files are allowed.",
    });
  }

  let isValidFile = false;

  try {
    const fileHandle = await fs.open(req.file.path, "r");

    try {
      const header = Buffer.alloc(signature.bytes.length);

      const { bytesRead } = await fileHandle.read(
        header, 0, signature.bytes.length, 0
      );

      isValidFile =
        bytesRead === signature.bytes.length &&
        header.equals(signature.bytes);
    } finally {
      await fileHandle.close();
    }

    if (!isValidFile) {
      await fs.unlink(req.file.path).catch(() => {});

      return res.status(400).json({
        success: false,
        message: signature.message,
      });
    }

    next();
  } catch (error) {
    await fs.unlink(req.file.path).catch(() => {});
    next(error);
  }
}
