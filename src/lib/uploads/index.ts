import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FILE_SPECS, type FileType } from "@/lib/seed/columns";
import type { LoadReport } from "@/lib/seed/loader";

/** Uploaded CSVs wait in the temp dir between the upload and the mapping step (works on Vercel's /tmp too). */
const DIR = path.join(os.tmpdir(), "freshroots-uploads");

export interface UploadMeta {
  token: string;
  type: FileType;
  fileName: string;
  uploadedBy: string;
  uploadedAt: string;
}

const TOKEN = /^[a-f0-9]{24}$/;
const p = (token: string, ext: string) => {
  if (!TOKEN.test(token)) throw new Error("Unknown upload.");
  return path.join(DIR, `${token}.${ext}`);
};

export const isFileType = (t: string): t is FileType => t in FILE_SPECS;

export async function saveUpload(type: FileType, fileName: string, body: Buffer, uploadedBy: string): Promise<UploadMeta> {
  await fs.mkdir(DIR, { recursive: true });
  const meta: UploadMeta = { token: crypto.randomBytes(12).toString("hex"), type, fileName, uploadedBy, uploadedAt: new Date().toISOString() };
  await fs.writeFile(p(meta.token, "csv"), body);
  await fs.writeFile(p(meta.token, "json"), JSON.stringify(meta));
  return meta;
}

export async function getUpload(token: string): Promise<{ meta: UploadMeta; csvPath: string } | null> {
  try {
    const meta = JSON.parse(await fs.readFile(p(token, "json"), "utf8")) as UploadMeta;
    return { meta, csvPath: p(token, "csv") };
  } catch {
    return null;
  }
}

export async function saveReport(token: string, report: LoadReport) {
  await fs.writeFile(p(token, "report.json"), JSON.stringify(report));
}

export async function getReport(token: string): Promise<LoadReport | null> {
  try {
    return JSON.parse(await fs.readFile(p(token, "report.json"), "utf8"));
  } catch {
    return null;
  }
}
