import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const storageRoot = path.resolve(process.cwd(), "storage");

export async function moveToPermanentStorage(tempFilePath) {
  const now = new Date();

  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");

  const destinationDirectory = path.join(
    storageRoot,
    "invoices",
    year,
    month
  );

  await fs.mkdir(destinationDirectory, { recursive: true });

  const extension = path.extname(tempFilePath).toLowerCase();
  const storedFileName = `${randomUUID()}${extension}`;

  const destinationPath = path.join(
    destinationDirectory,
    storedFileName
  );

  await fs.rename(tempFilePath, destinationPath);

  return {
    fileName: storedFileName,
    filePath: path.relative(storageRoot, destinationPath),
    absolutePath: destinationPath,
  };
}

export async function deleteStoredFile(filePath) {
  if (!filePath) return;

  await fs.unlink(filePath).catch((error) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
}
