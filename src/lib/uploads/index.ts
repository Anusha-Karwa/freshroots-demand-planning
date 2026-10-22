import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { FILE_SPECS, type FileType } from "@/lib/seed/columns";
import type { LoadReport } from "@/lib/seed/loader";

/**
 * Uploaded CSVs wait in the database between the upload and the mapping step, so each step can run on a
 * different serverless instance. The loader reads from a temp file written just before loading.
 */

export interface UploadMeta {
  token: string;
  type: FileType;
  fileName: string;
  uploadedBy: string;
  uploadedAt: string;
}

const TOKEN = /^[a-f0-9]{24}$/;
const KEEP_DAYS = 7;

export const isFileType = (t: string): t is FileType => t in FILE_SPECS;

export async function saveUpload(type: FileType, fileName: string, body: Buffer, uploadedBy: string): Promise<UploadMeta> {
  const db = await getDb();
  await db.delete(schema.uploads).where(lt(schema.uploads.uploadedAt, new Date(Date.now() - KEEP_DAYS * 86_400_000)));
  const token = crypto.randomBytes(12).toString("hex");
  const [row] = await db
    .insert(schema.uploads)
    .values({ token, fileType: type, fileName, content: body.toString("utf8"), uploadedBy })
    .returning();
  return { token, type, fileName, uploadedBy, uploadedAt: row.uploadedAt.toISOString() };
}

/** The upload's metadata and a local file path with its contents (written to the temp dir on demand). */
export async function getUpload(token: string): Promise<{ meta: UploadMeta; csvPath: string } | null> {
  if (!TOKEN.test(token)) return null;
  const db = await getDb();
  const [row] = await db.select().from(schema.uploads).where(eq(schema.uploads.token, token));
  if (!row || !isFileType(row.fileType)) return null;
  const dir = path.join(os.tmpdir(), "freshroots-uploads");
  await fs.mkdir(dir, { recursive: true });
  const csvPath = path.join(dir, `${token}.csv`);
  await fs.writeFile(csvPath, row.content);
  return {
    meta: { token, type: row.fileType, fileName: row.fileName, uploadedBy: row.uploadedBy, uploadedAt: row.uploadedAt.toISOString() },
    csvPath,
  };
}

export async function saveReport(token: string, report: LoadReport) {
  const db = await getDb();
  await db.update(schema.uploads).set({ report }).where(eq(schema.uploads.token, token));
}

export async function getReport(token: string): Promise<LoadReport | null> {
  if (!TOKEN.test(token)) return null;
  const db = await getDb();
  const [row] = await db.select({ report: schema.uploads.report }).from(schema.uploads).where(eq(schema.uploads.token, token));
  return (row?.report as LoadReport) ?? null;
}
