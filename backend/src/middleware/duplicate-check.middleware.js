import { prisma } from "../config/prisma.js";
import { calculateFileHash } from "../utils/file-hash.js";
import fs from "node:fs/promises";

export async function checkDuplicateFile(req, res, next) {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "Invoice PDF is required.",
    });
  }

  try {
    const fileHash = await calculateFileHash(req.file.path);

    const existingInvoice = await prisma.invoice.findUnique({
      where: {
        fileHash,
      },
      select: {
        id: true,
        originalFileName: true,
        status: true,
      },
    });

    if (existingInvoice) {
      await fs.unlink(req.file.path).catch(() => {});

      return res.status(409).json({
        success: false,
        message: "This exact invoice file has already been uploaded.",
        duplicate: existingInvoice,
      });
    }

    req.fileHash = fileHash;

    next();
  } catch (error) {
    next(error);
  }
}