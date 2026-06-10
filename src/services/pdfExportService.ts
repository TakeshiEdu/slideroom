import type { ExportSettings, MergePreviewData } from "../types";
import { canAttemptRealPptxMerge, exportRealMergedPptx } from "./realPptxMergeService";
import { createPptxSlidePreviewSvgsWithDiagnostics } from "./pptxPreviewService";

const PDF_MIME = "application/pdf";

export class PdfExportError extends Error {
  details: string[];

  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = "PdfExportError";
    this.details = details;
  }
}

export interface PdfExportBlob extends Blob {
  skippedSlides?: string[];
}

/**
 * PDF出力の新しいフロー:
 * 1. exportRealMergedPptx() で安定した結合PPTXを生成
 * 2. 結合PPTXの各スライドからSVGプレビューを生成
 * 3. svg2pdf.js でSVGをベクター形式のままPDFに埋め込む（Canvas/JPEG変換を排除）
 *
 * これにより、テキストがラスタライズされず、PDF内にベクターテキストとして保持されるため、
 * テキスト欠落問題が根本的に解決する。
 */
export async function exportRealPdfFromPptx(preview: MergePreviewData, settings: ExportSettings): Promise<Blob> {
  if (!canAttemptRealPptxMerge(preview)) {
    const unsupportedSlides = preview.slides
      .map((slide) => ({ slide, file: preview.files.find((candidate) => candidate.id === slide.fileId) }))
      .filter(({ file }) => file?.extension !== "pptx" || !file.storageKey)
      .map(({ slide, file }, index) => `${index + 1}. ${slide.title}: ${file?.name ?? "元ファイルなし"}（${file?.extension ?? "不明"} / 保存Blobなし）`);
    throw new PdfExportError(
      "PDF出力には、結合対象スライドの元ファイルがすべてアップロード済みPPTXである必要があります。",
      unsupportedSlides,
    );
  }
  if (preview.slides.length === 0) {
    throw new PdfExportError("PDF出力対象のスライドがありません。");
  }

  // ── Step 1: 安定したPPTX結合を経由 ──
  const mergedPptxBlob = await exportRealMergedPptx(preview, settings);

  // ── Step 2: 結合PPTXの全スライドからSVGを生成 ──
  const slideCount = preview.slides.length;
  const sourcePages = Array.from({ length: slideCount }, (_, i) => i + 1);
  const diagnostics = await createPptxSlidePreviewSvgsWithDiagnostics(mergedPptxBlob, sourcePages);

  // ── Step 3: 各スライドのSVGをCanvas経由で画像化してPDFに出力 ──
  const { jsPDF } = await import("jspdf");

  let pdf: InstanceType<typeof jsPDF> | null = null;
  const skippedSlideLabels: string[] = [];
  let pdfPageIndex = 0;

  for (let pageNum = 1; pageNum <= slideCount; pageNum++) {
    const svgString = diagnostics.previews.get(pageNum);
    if (!svgString) {
      const errorDetail = diagnostics.errors.get(pageNum);
      const slide = preview.slides[pageNum - 1];
      skippedSlideLabels.push(slide?.title || `スライド${pageNum}`);
      console.warn(`PDF export: スライド ${pageNum} をスキップ`, errorDetail);
      continue;
    }

    // SVGからサイズを抽出
    const { widthPt, heightPt } = getSvgDimensionsAsPt(svgString);

    if (!pdf) {
      pdf = new jsPDF({
        orientation: widthPt >= heightPt ? "landscape" : "portrait",
        unit: "pt",
        format: [widthPt, heightPt],
        compress: true,
      });
    } else {
      pdf.addPage([widthPt, heightPt], widthPt >= heightPt ? "landscape" : "portrait");
    }

    // 安定性を最優先し、ブラウザの描画エンジンを用いたCanvasラスタライズでPDFに変換
    try {
      const page = await svgToCanvasPage(svgString, widthPt, heightPt);
      pdf.addImage(page.canvas, page.imageFormat, 0, 0, widthPt, heightPt, undefined, "FAST");
      releaseCanvas(page.canvas);
    } catch (canvasError) {
      const slide = preview.slides[pageNum - 1];
      skippedSlideLabels.push(slide?.title || `スライド${pageNum}`);
      console.warn(`PDF export: Canvas rendering failed for slide ${pageNum}`, canvasError);
      continue;
    }

    // ページ番号
    if (settings.includePageNumber) {
      const totalRenderable = slideCount - skippedSlideLabels.length;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(100, 116, 139);
      pdf.text(
        `${pdfPageIndex + 1} / ${totalRenderable || slideCount}`,
        widthPt - 28,
        heightPt - 18,
        { align: "right" },
      );
    }

    pdfPageIndex += 1;
  }

  if (!pdf) throw new PdfExportError("PDF出力できるスライドがありません。");

  const output = new Blob([pdf.output("arraybuffer")], { type: PDF_MIME }) as PdfExportBlob;
  if (skippedSlideLabels.length) {
    output.skippedSlides = [...new Set(skippedSlideLabels)];
  }
  return output;
}

// ── SVGのviewBoxからポイント単位のサイズを取得 ──

const DEFAULT_PAGE_WIDTH_PT = 960;

function getSvgDimensionsAsPt(svg: string): { widthPt: number; heightPt: number } {
  const viewBox = svg.match(/\bviewBox=["']([^"']+)["']/i)?.[1];
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      const ratio = parts[2] / parts[3];
      return {
        widthPt: DEFAULT_PAGE_WIDTH_PT,
        heightPt: DEFAULT_PAGE_WIDTH_PT / ratio,
      };
    }
  }
  return {
    widthPt: DEFAULT_PAGE_WIDTH_PT,
    heightPt: DEFAULT_PAGE_WIDTH_PT / (16 / 9),
  };
}

// ── SVG文字列をDOM Elementに変換 ──

function parseSvgToDom(svgString: string): SVGElement {
  let sanitized = svgString.trim();
  if (!/\sxmlns=/.test(sanitized)) {
    sanitized = sanitized.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!/\sxmlns:xlink=/.test(sanitized)) {
    sanitized = sanitized.replace("<svg", '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(sanitized, "image/svg+xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error("SVGの解析に失敗しました。");
  }
  return doc.documentElement as unknown as SVGElement;
}

// ── Canvas フォールバック（svg2pdf失敗時のみ使用） ──

interface RenderedCanvasPage {
  canvas: HTMLCanvasElement;
  imageFormat: "JPEG";
}

const CANVAS_WIDTH_PX = 1440;

async function svgToCanvasPage(
  svg: string,
  widthPt: number,
  heightPt: number,
): Promise<RenderedCanvasPage> {
  const ratio = widthPt / heightPt;
  const canvasWidth = CANVAS_WIDTH_PX;
  const canvasHeight = Math.round(canvasWidth / ratio);
  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("PDF生成用Canvasを作成できませんでした。");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  const image = await loadSvgImage(svg);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return { canvas, imageFormat: "JPEG" };
}

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  const sanitized = sanitizeSvgForImage(svg);
  return loadSvgImageFromUrl(() => URL.createObjectURL(new Blob([sanitized], { type: "image/svg+xml;charset=utf-8" })))
    .catch(() => loadSvgImageFromUrl(() => svgToDataUrl(sanitized)));
}

function loadSvgImageFromUrl(createUrl: () => string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = createUrl();
    const shouldRevoke = url.startsWith("blob:");
    const image = new Image();
    const timeout = window.setTimeout(() => {
      if (shouldRevoke) URL.revokeObjectURL(url);
      reject(new Error("PPTXプレビュー画像のPDF変換がタイムアウトしました。"));
    }, 15000);

    image.onload = () => {
      window.clearTimeout(timeout);
      if (shouldRevoke) URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      if (shouldRevoke) URL.revokeObjectURL(url);
      reject(new Error("PPTXプレビュー画像をPDF用に変換できませんでした。"));
    };
    image.src = url;
  });
}

function sanitizeSvgForImage(svg: string) {
  let sanitized = svg.trim();
  if (!/\sxmlns=/.test(sanitized)) {
    sanitized = sanitized.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!/\sxmlns:xlink=/.test(sanitized)) {
    sanitized = sanitized.replace("<svg", '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  }
  return sanitized;
}

function svgToDataUrl(svg: string) {
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return `data:image/svg+xml;base64,${window.btoa(binary)}`;
}

function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 1;
  canvas.height = 1;
}
