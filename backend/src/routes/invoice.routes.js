import { Router } from "express";
import fs from "node:fs/promises";

import { uploadInvoice } from "../middleware/upload.middleware.js";
import { validatePdfSignature } from "../middleware/pdf-validation.middleware.js";
import { checkDuplicateFile } from "../middleware/duplicate-check.middleware.js";

import { moveToPermanentStorage, deleteStoredFile } from "../utils/file-storage.js";
import { prisma } from "../config/prisma.js";

const router = Router();

router.post( "/",
  uploadInvoice,
  validatePdfSignature,
  checkDuplicateFile,
  async (req, res, next) => {
    let permanentFile = null;

    try {
      // Move the PDF into permanent storage.
      permanentFile = await moveToPermanentStorage(req.file.path);

      // Create the invoice record.
      const invoice = await prisma.invoice.create({
        data: {
          originalFileName: req.file.originalname,
          fileHash: req.fileHash,
          filePath: permanentFile.filePath,
        },
        select: {
          id: true,
          originalFileName: true,
          status: true,
          fileHash: true,
          filePath: true,
          createdAt: true,
        },
      });

      return res.status(201).json({
        success: true,
        message: "Invoice uploaded successfully.",
        data: invoice,
      });
    } catch (error) {
      // Remove the permanent file if database insertion fails.
      if (permanentFile) {
        await deleteStoredFile(permanentFile.absolutePath).catch(
          (cleanupError) => {
            req.log?.error(cleanupError, "Permanent file cleanup failed");
          }
        );
      } else if (req.file?.path) {
        await fs.unlink(req.file.path).catch(() => {});
      }

      // Handle a duplicate upload caused by a simultaneous request.
      if (error.code === "P2002") {
        return res.status(409).json({
          success: false,
          message: "This invoice file has already been uploaded.",
        });
      }

      next(error);
    }
  }
);

export default router;