import { useAppStore } from "../stores/useAppStore";
import { analyzePptxBlob } from "./pptxAnalysisService";
import { canAttemptRealPptxMerge, exportRealMergedPptx } from "./realPptxMergeService";
import { exportRealPdfFromPptx } from "./pdfExportService";
import { getBlob } from "./storageService";
import type {
  ExportSettings,
  FileAnalysis,
  MergePreviewData,
  Room,
  SlideItem,
  SubmittedFile,
} from "../types";

export interface MergeEngine {
  analyzeFile(file: SubmittedFile): Promise<FileAnalysis>;
  buildPreview(roomId: string): Promise<MergePreviewData>;
  exportPptx(roomId: string, settings: ExportSettings): Promise<Blob>;
  exportPptxWithResult(roomId: string, settings: ExportSettings): Promise<PptxExportResult>;
  exportPdf(roomId: string, settings: ExportSettings): Promise<Blob>;
}

export interface PptxExportResult {
  blob: Blob;
  mode: "real" | "fallback";
  fallbackReason?: string;
}

const ENABLE_REAL_PPTX_MERGE = true;

function orderedRoomSlides(roomId: string) {
  return useAppStore
    .getState()
    .slides.filter((slide) => slide.roomId === roomId && slide.isPlaced)
    .sort((a, b) => a.order - b.order);
}

function roomFiles(roomId: string) {
  return useAppStore
    .getState()
    .files.filter((file) => file.roomId === roomId && file.status !== "excluded");
}

function findRoom(roomId: string): Room {
  const room = useAppStore.getState().rooms.find((candidate) => candidate.id === roomId);
  if (!room) throw new Error("ルームが見つかりません。");
  return room;
}

function findSourceFile(slide: SlideItem) {
  return useAppStore.getState().files.find((file) => file.id === slide.fileId);
}

function asBlob(value: unknown): Blob {
  if (value instanceof Blob) return value;
  if (value instanceof ArrayBuffer) {
    return new Blob([value], {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
  }
  if (typeof value === "string") {
    return new Blob([value], {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
  }
  throw new Error("PPTX出力に失敗しました。");
}

class PptxGenMergeEngine implements MergeEngine {
  async analyzeFile(file: SubmittedFile): Promise<FileAnalysis> {
    if (file.extension === "pptx") {
      if (!file.storageKey) {
        return {
          fileId: file.id,
          slideCount: file.slideCount,
          canMerge: false,
          warnings: ["保存済みPPTX Blobがないため実解析できません。"],
          sourceType: "fallback",
        };
      }

      const blob = await getBlob(file.storageKey);
      if (!blob) {
        return {
          fileId: file.id,
          slideCount: file.slideCount,
          canMerge: false,
          warnings: ["IndexedDBからPPTX Blobを取得できませんでした。"],
          sourceType: "fallback",
        };
      }

      try {
        const analysis = await analyzePptxBlob(blob);
        return {
          fileId: file.id,
          slideCount: analysis.slideCount,
          canMerge: file.status !== "excluded",
          warnings: [
            ...analysis.warnings,
            ...(file.status === "revision_requested" ? ["修正依頼中のファイルです。"] : []),
          ],
          sourceType: "pptx",
          slidePaths: analysis.slidePaths,
          mediaCount: analysis.mediaCount,
          layoutCount: analysis.layoutCount,
          masterCount: analysis.masterCount,
        };
      } catch (error) {
        return {
          fileId: file.id,
          slideCount: file.slideCount,
          canMerge: false,
          warnings: [error instanceof Error ? error.message : "PPTX解析に失敗しました。"],
          sourceType: "fallback",
        };
      }
    }

    return {
      fileId: file.id,
      slideCount: file.slideCount,
      canMerge: ["pptx", "ppt", "pdf"].includes(file.extension) && file.status !== "excluded",
      warnings: file.status === "revision_requested" ? ["修正依頼中のファイルです。"] : [],
      sourceType: file.extension === "pdf" ? "pdf" : "fallback",
    };
  }

  async buildPreview(roomId: string): Promise<MergePreviewData> {
    const room = findRoom(roomId);
    const slides = orderedRoomSlides(roomId);
    const files = roomFiles(roomId);
    const orderCounts = slides.reduce<Record<number, number>>((acc, slide) => {
      acc[slide.order] = (acc[slide.order] ?? 0) + 1;
      return acc;
    }, {});

    return {
      room,
      slides,
      files,
      totalSlides: slides.length,
      unplacedSlides: useAppStore.getState().slides.filter((slide) => slide.roomId === roomId && !slide.isPlaced).length,
      duplicateOrderCount: Object.values(orderCounts).filter((count) => count > 1).length,
      includedFilesCount: new Set(slides.map((slide) => slide.fileId)).size,
    };
  }

  async exportPptx(roomId: string, settings: ExportSettings): Promise<Blob> {
    const result = await this.exportPptxWithResult(roomId, settings);
    return result.blob;
  }

  async exportPptxWithResult(roomId: string, settings: ExportSettings): Promise<PptxExportResult> {
    const preview = await this.buildPreview(roomId);
    let fallbackReason: string | undefined;

    if (ENABLE_REAL_PPTX_MERGE && canAttemptRealPptxMerge(preview)) {
      try {
        return {
          blob: await exportRealMergedPptx(preview, settings),
          mode: "real",
        };
      } catch (error) {
        fallbackReason = error instanceof Error ? error.message : "実PPTX結合に失敗しました。";
        console.warn("実PPTX結合に失敗したため、簡易PPTX出力へfallbackします。", error);
      }
    } else {
      fallbackReason = "結合対象にアップロード済みPPTX以外のスライドが含まれています。";
    }

    return {
      blob: await this.exportFallbackPptx(preview, settings),
      mode: "fallback",
      fallbackReason,
    };
  }

  private async exportFallbackPptx(preview: MergePreviewData, settings: ExportSettings): Promise<Blob> {
    const { default: pptxgen } = await import("pptxgenjs");
    const pptx = new pptxgen();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "SlideRoom";
    pptx.subject = preview.room.title;
    pptx.title = settings.fileName;
    pptx.company = "SlideRoom";
    pptx.theme = {
      headFontFace: "Aptos Display",
      bodyFontFace: "Aptos",
    };

    if (settings.includeCover) {
      const cover = pptx.addSlide();
      cover.background = { color: "F6F8FB" };
      cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: "F6F8FB" }, line: { color: "F6F8FB" } });
      cover.addShape(pptx.ShapeType.rect, { x: 0.7, y: 0.7, w: 11.9, h: 5.9, fill: { color: "FFFFFF" }, line: { color: "D9E2EF" } });
      cover.addText(preview.room.title, {
        x: 1.2,
        y: 1.4,
        w: 6.4,
        h: 1.1,
        fontFace: "Aptos Display",
        fontSize: 34,
        bold: true,
        color: "102033",
        fit: "shrink",
      });
      cover.addText(preview.room.className, {
        x: 1.2,
        y: 2.6,
        w: 5.6,
        h: 0.4,
        fontSize: 16,
        color: "2563EB",
      });
      cover.addText("SlideRoom MVP Export", {
        x: 1.2,
        y: 5.8,
        w: 4.4,
        h: 0.4,
        fontSize: 13,
        color: "64748B",
      });
      cover.addShape(pptx.ShapeType.arc, { x: 7.4, y: 1.3, w: 3.2, h: 3.2, line: { color: "16A34A", width: 2 } });
      cover.addShape(pptx.ShapeType.arc, { x: 8.2, y: 2.1, w: 3.2, h: 3.2, line: { color: "0057D9", width: 2 } });
      cover.addShape(pptx.ShapeType.ellipse, { x: 9.45, y: 1.1, w: 0.5, h: 0.5, fill: { color: "F59E0B" }, line: { color: "F59E0B" } });
    }

    preview.slides.forEach((slide, index) => {
      const sourceFile = findSourceFile(slide);
      const page = pptx.addSlide();
      page.background = { color: "FFFFFF" };
      page.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.32, fill: { color: "0057D9" }, line: { color: "0057D9" } });
      page.addText(`${index + 1}`, {
        x: 0.7,
        y: 0.86,
        w: 0.64,
        h: 0.64,
        fontSize: 20,
        bold: true,
        align: "center",
        valign: "middle",
        color: "FFFFFF",
        fill: { color: "0057D9" },
        margin: 0,
      });
      page.addText(slide.title, {
        x: 1.55,
        y: 0.82,
        w: 9.9,
        h: 0.65,
        fontSize: 28,
        bold: true,
        color: "102033",
        fit: "shrink",
      });
      page.addText(settings.includeSectionDivider ? slide.section : "", {
        x: 1.55,
        y: 1.55,
        w: 3.0,
        h: 0.32,
        fontSize: 12,
        bold: true,
        color: "0057D9",
      });
      page.addShape(pptx.ShapeType.roundRect, {
        x: 0.9,
        y: 2.15,
        w: 11.55,
        h: 3.6,
        fill: { color: "F6F8FB" },
        line: { color: "D9E2EF" },
      });
      page.addText("MVP簡易スライド", {
        x: 1.35,
        y: 2.55,
        w: 4.2,
        h: 0.4,
        fontSize: 17,
        bold: true,
        color: "102033",
      });
      page.addText(
        [
          settings.includeMemberName ? `担当者: ${slide.ownerName}` : undefined,
          `元ファイル: ${sourceFile?.name ?? "未設定"}`,
          `元ページ: ${slide.sourcePage}`,
        ]
          .filter(Boolean)
          .join("\n"),
        {
          x: 1.35,
          y: 3.08,
          w: 5.6,
          h: 1.25,
          fontSize: 14,
          color: "334155",
          breakLine: false,
        },
      );
      page.addShape(pptx.ShapeType.rect, { x: 8.1, y: 2.65, w: 3.25, h: 1.85, fill: { color: "EAF2FF" }, line: { color: "BFD7FF" } });
      page.addText(sourceFile?.extension.toUpperCase() ?? "FILE", {
        x: 8.1,
        y: 3.25,
        w: 3.25,
        h: 0.5,
        align: "center",
        fontSize: 18,
        bold: true,
        color: "0057D9",
      });
      if (settings.includePageNumber) {
        page.addText(`${index + 1} / ${preview.slides.length}`, {
          x: 11.0,
          y: 6.9,
          w: 1.6,
          h: 0.25,
          fontSize: 10,
          align: "right",
          color: "64748B",
        });
      }
    });

    const end = pptx.addSlide();
    end.background = { color: "F6F8FB" };
    end.addText("SlideRoomで出力", {
      x: 2.2,
      y: 2.6,
      w: 8.9,
      h: 0.8,
      fontSize: 32,
      bold: true,
      align: "center",
      color: "102033",
    });
    end.addText("これは既存PPTXの完全結合ではなく、MVP確認用の簡易PPTXです。", {
      x: 2.0,
      y: 3.55,
      w: 9.3,
      h: 0.45,
      fontSize: 14,
      align: "center",
      color: "64748B",
      fit: "shrink",
    });

    const output = await pptx.write({ outputType: "blob" as never });
    return asBlob(output);
  }

  async exportPdf(roomId: string, settings: ExportSettings): Promise<Blob> {
    const preview = await this.buildPreview(roomId);
    return exportRealPdfFromPptx(preview, settings);
  }
}

export const mergeService: MergeEngine = new PptxGenMergeEngine();
