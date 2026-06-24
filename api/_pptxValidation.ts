import { HttpError, MAX_UPLOAD_BYTES, safeStorageKey } from "./_shared.js";

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "",
  "application/octet-stream",
  PPTX_MIME,
]);

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP64_SIZE_MARKER = 0xffffffff;
const MAX_ZIP_ENTRIES = Number(process.env.SLIDEROOM_MAX_PPTX_ZIP_ENTRIES ?? "8000");
const MAX_UNCOMPRESSED_BYTES = Number(process.env.SLIDEROOM_MAX_PPTX_UNCOMPRESSED_BYTES ?? 2 * 1024 * 1024 * 1024);
const MAX_XML_PART_BYTES = Number(process.env.SLIDEROOM_MAX_PPTX_XML_PART_BYTES ?? 80 * 1024 * 1024);
const MAX_SINGLE_ENTRY_BYTES = Number(process.env.SLIDEROOM_MAX_PPTX_ENTRY_BYTES ?? 500 * 1024 * 1024);

export interface PptxValidationSummary {
  entries: number;
  compressedBytes: number;
  uncompressedBytes: number;
  hasContentTypes: boolean;
  hasPresentation: boolean;
}

interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  flags: number;
}

function normalizedContentType(raw: string | string[] | undefined) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (value || "").split(";")[0].trim().toLowerCase();
}

function fail(message: string): never {
  throw new HttpError(400, message);
}

function findEndOfCentralDirectory(buffer: Buffer) {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

function parseCentralDirectory(buffer: Buffer): ZipEntry[] {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== LOCAL_FILE_SIGNATURE) {
    fail("Invalid PPTX ZIP container");
  }

  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) fail("Invalid PPTX ZIP directory");

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const directorySize = buffer.readUInt32LE(eocdOffset + 12);
  const directoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (entryCount === 0 || entryCount > MAX_ZIP_ENTRIES) fail("PPTX has too many ZIP entries");
  if (directoryOffset === ZIP64_SIZE_MARKER || directorySize === ZIP64_SIZE_MARKER) {
    fail("ZIP64 PPTX files are not supported");
  }
  if (directoryOffset < 0 || directorySize < 0 || directoryOffset + directorySize > buffer.length) {
    fail("Invalid PPTX ZIP directory bounds");
  }

  const entries: ZipEntry[] = [];
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      fail("Invalid PPTX ZIP entry");
    }

    const flags = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.length) fail("Invalid PPTX ZIP entry name");

    const name = buffer.toString("utf8", nameStart, nameEnd);
    entries.push({ name, compressedSize, uncompressedSize, flags });
    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
}

function validateEntry(entry: ZipEntry) {
  if (!entry.name || entry.name.length > 512) fail("Invalid PPTX part name");
  if (entry.name.startsWith("/") || entry.name.includes("\\") || entry.name.includes("..")) {
    fail("Unsafe PPTX ZIP path");
  }
  if (entry.name.endsWith("/")) return;
  if (entry.flags & 0x1) fail("Encrypted PPTX files are not supported");
  if (entry.compressedSize === ZIP64_SIZE_MARKER || entry.uncompressedSize === ZIP64_SIZE_MARKER) {
    fail("ZIP64 PPTX entries are not supported");
  }
  if (entry.compressedSize > MAX_SINGLE_ENTRY_BYTES || entry.uncompressedSize > MAX_SINGLE_ENTRY_BYTES) {
    fail("PPTX contains an oversized part");
  }
  if (entry.name.toLowerCase().endsWith(".xml") && entry.uncompressedSize > MAX_XML_PART_BYTES) {
    fail("PPTX contains an oversized XML part");
  }
  if (entry.name.toLowerCase().endsWith("vbaproject.bin")) {
    fail("Macro-enabled PPTX files are not supported");
  }
}

export function validatePptxUpload(
  buffer: Buffer,
  options: {
    storageKey: string;
    contentType?: string | string[];
    maxBytes?: number;
  },
): PptxValidationSummary {
  const storageKey = safeStorageKey(options.storageKey);
  if (!storageKey || !storageKey.endsWith(".pptx")) fail("Only PPTX uploads are allowed");
  if (buffer.length === 0) fail("PPTX file is empty");
  if (buffer.length > (options.maxBytes ?? MAX_UPLOAD_BYTES)) fail("PPTX file is too large");

  const contentType = normalizedContentType(options.contentType);
  if (!ALLOWED_UPLOAD_MIME_TYPES.has(contentType)) fail("Invalid PPTX content type");

  const entries = parseCentralDirectory(buffer);
  let uncompressedBytes = 0;
  let compressedBytes = 0;
  let hasContentTypes = false;
  let hasPresentation = false;

  for (const entry of entries) {
    validateEntry(entry);
    uncompressedBytes += entry.uncompressedSize;
    compressedBytes += entry.compressedSize;
    if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) fail("PPTX expands to too much data");
    if (entry.name === "[Content_Types].xml") hasContentTypes = true;
    if (entry.name === "ppt/presentation.xml") hasPresentation = true;
  }

  if (!hasContentTypes || !hasPresentation) fail("Invalid PPTX OpenXML structure");

  return {
    entries: entries.length,
    compressedBytes,
    uncompressedBytes,
    hasContentTypes,
    hasPresentation,
  };
}
