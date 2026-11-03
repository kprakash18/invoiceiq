import fs from "node:fs/promises";

export async function validatePdfSignature(req, res, next) {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "Invoice PDF is required.",
    });
  }

  let isPdf = false;

  try {
    const fileHandle = await fs.open(req.file.path, "r");

    try {
      const header = Buffer.alloc(5);

      const { bytesRead } = await fileHandle.read(
        header,0,5,0
      );

      isPdf =
        bytesRead === 5 &&
        header.toString("ascii") === "%PDF-";
    } finally {
      await fileHandle.close();
    }

    if (!isPdf) {
      await fs.unlink(req.file.path).catch(() => {});

      return res.status(400).json({
        success: false,
        message: "The uploaded file does not have a valid PDF signature.",
      });
    }

    next();
  } catch (error) {
    await fs.unlink(req.file.path).catch(() => {});
    next(error);
  }
}