import type { ValidationResult } from "../types";

export const ALLOWED_EXTENSIONS = ["pptx"];
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export function getExtension(fileName: string) {
  const part = fileName.split(".").pop()?.toLowerCase();
  return part ?? "";
}

export function validateUploadFile(file: File): ValidationResult {
  if (!file.name.trim()) {
    return { valid: false, message: "ファイル名が空です。" };
  }

  const extension = getExtension(file.name);
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return { valid: false, message: "アップロードできるファイルはPPTXのみです。" };
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return { valid: false, message: "ファイルサイズは200MB以下にしてください。" };
  }

  return { valid: true };
}

export function inferSlideCount(fileName: string, extension: string) {
  const lowerName = fileName.toLowerCase();
  const known: Record<string, number> = {
    "表紙": 1,
    "導入": 1,
    "現状": 2,
    "原因": 2,
    "影響": 2,
    "解決": 2,
    "まとめ": 1,
    "参考": 1,
  };

  const hit = Object.entries(known).find(([keyword]) => lowerName.includes(keyword));
  if (hit) return hit[1];
  if (extension === "pdf") return 4;
  if (extension === "pptx" || extension === "ppt") return 3;
  return 1;
}

export function inferSlideTitle(fileName: string, index: number) {
  const baseName = fileName.replace(/\.[^.]+$/, "");
  if (index === 1) return baseName;
  return `${baseName} ${index}`;
}

export function inferSection(index: number, total: number) {
  if (index === 1) return "導入";
  if (index === total) return "まとめ";
  return "本論";
}
