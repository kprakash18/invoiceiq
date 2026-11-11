import path from "node:path";

export const storageRoot = path.resolve(
  process.env.STORAGE_DIR || path.join(process.cwd(), "storage")
);
