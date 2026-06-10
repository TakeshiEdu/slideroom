const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const MAIN_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const IMAGE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const EMU_PER_PX = 9525;

function px(emu: number) {
  return Number((emu / EMU_PER_PX).toFixed(2));
}

type PptxZip = Awaited<ReturnType<typeof loadZip>>;

interface Box {
  x: number;
  y: number;
  cx: number;
  cy: number;
}

interface GroupTransform {
  offX: number;
  offY: number;
  extCx: number;
  extCy: number;
  chOffX: number;
  chOffY: number;
  chExtCx: number;
  chExtCy: number;
  parent: GroupTransform | null;
}

interface TextRun {
  text: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: string;
  lineBreakBefore: boolean;
}

async function loadZip(blob: Blob) {
  const { default: JSZip } = await import("jszip");
  return JSZip.loadAsync(blob);
}

export interface PptxSlidePreviewDiagnostics {
  previews: Map<number, string>;
  errors: Map<number, string>;
  slideCount: number;
}

export async function createPptxSlidePreviewSvgs(blob: Blob, sourcePages: number[]) {
  const result = await createPptxSlidePreviewSvgsWithDiagnostics(blob, sourcePages);
  return result.previews;
}

export async function createPptxSlidePreviewSvgsWithDiagnostics(blob: Blob, sourcePages: number[]): Promise<PptxSlidePreviewDiagnostics> {
  const zip = await loadZip(blob);
  const slidePaths = await getPresentationSlidePaths(zip);
  const uniquePages = [...new Set(sourcePages)].filter((page) => page > 0);
  const previews = new Map<number, string>();
  const errors = new Map<number, string>();

  for (const page of uniquePages) {
    const slidePath = slidePaths[page - 1];
    if (!slidePath) {
      errors.set(page, `指定された元ページ ${page} がPPTX内にありません。実スライド数は ${slidePaths.length} 枚です。`);
      continue;
    }
    try {
      const slideXml = await zip.file(slidePath)?.async("string");
      const fallbackText = slideXml ? extractSlideText(slideXml) : "";
      const svg = await createSlidePreviewSvg(zip, slidePath, fallbackText);
      if (svg) previews.set(page, svg);
      else errors.set(page, `${slidePath} をSVGとして描画できませんでした。スライド内に未対応要素のみが含まれている可能性があります。`);
    } catch (error) {
      const message = getErrorMessage(error);
      console.warn("Preview generation failed for", slidePath, error);
      errors.set(page, `${slidePath} の解析または描画に失敗しました: ${message}`);
    }
  }

  return { previews, errors, slideCount: slidePaths.length };
}

async function getPresentationSlidePaths(zip: PptxZip) {
  const presentationXml = await zip.file("ppt/presentation.xml")?.async("string");
  const relsXml = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
  if (!presentationXml || !relsXml) return getSortedSlidePaths(zip);

  const presentationDoc = parseXml(presentationXml);
  const relsDoc = parseXml(relsXml);
  const relMap = new Map<string, string>();
  Array.from(relsDoc.documentElement.children).forEach((rel) => {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (id && target) relMap.set(id, target);
  });

  const paths = getDescendants(presentationDoc)
    .filter((node) => localNameIs(node, "sldId"))
    .map((node) => node.getAttributeNS(MAIN_REL_NS, "id") ?? node.getAttribute("r:id") ?? "")
    .map((id) => relMap.get(id))
    .filter((target): target is string => Boolean(target))
    .map((target) => normalizePresentationRelationshipTarget(target))
    .filter((path) => Boolean(zip.file(path)));

  return paths.length ? paths : getSortedSlidePaths(zip);
}

async function createSlidePreviewSvg(zip: PptxZip, slidePath: string, fallbackText = "") {
  const slideFile = zip.file(slidePath);
  const relsFile = zip.file(slidePathToRelsPath(slidePath));
  if (!slideFile) return "";

  const slideDoc = parseXml(await slideFile.async("string"));
  const relsDoc = relsFile ? parseXml(await relsFile.async("string")) : null;
  const imageRels = new Map<string, string>();
  if (relsDoc) {
    for (const rel of Array.from(relsDoc.documentElement.children)) {
      if (rel.getAttribute("Type") === IMAGE_REL_TYPE && !rel.getAttribute("TargetMode")) {
        imageRels.set(rel.getAttribute("Id") || "", rel.getAttribute("Target") || "");
      }
    }
  }

  const slideSize = await getSlideSize(zip);
  const renderedParts: string[] = [];
  const spTree = findDescendant(slideDoc.documentElement, (node) => localNameIs(node, "spTree"));
  if (spTree) {
    await renderShapeTree(spTree, zip, imageRels, renderedParts, null);
  }
  if (renderedParts.length === 0 && fallbackText) {
    renderedParts.push(createFallbackTextSvg(fallbackText, slideSize.cx, slideSize.cy));
  }
  if (renderedParts.length === 0) return "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${px(slideSize.cx)} ${px(slideSize.cy)}" width="${px(slideSize.cx)}" height="${px(slideSize.cy)}">`,
    `<rect x="0" y="0" width="${px(slideSize.cx)}" height="${px(slideSize.cy)}" fill="#fff"/>`,
    ...renderedParts,
    `<rect x="0" y="0" width="${px(slideSize.cx)}" height="${px(slideSize.cy)}" fill="none" stroke="#d7e2ef" stroke-width="${Math.max(slideSize.cx, slideSize.cy) / 900 / EMU_PER_PX}"/>`,
    "</svg>",
  ].join("");
}

async function renderShapeTree(
  treeNode: Element,
  zip: PptxZip,
  imageRels: Map<string, string>,
  parts: string[],
  groupXfrm: GroupTransform | null,
) {
  for (const child of Array.from(treeNode.children)) {
    const localName = getLocalName(child);
    if (localName === "sp") {
      renderShape(child, parts, groupXfrm);
    } else if (localName === "pic") {
      await renderPicture(child, zip, imageRels, parts, groupXfrm);
    } else if (localName === "cxnSp") {
      renderConnector(child, parts, groupXfrm);
    } else if (localName === "graphicFrame") {
      renderGraphicFrame(child, parts, groupXfrm);
    } else if (localName === "grpSp") {
      await renderGroupShape(child, zip, imageRels, parts, groupXfrm);
    }
  }
}

async function renderGroupShape(
  grpNode: Element,
  zip: PptxZip,
  imageRels: Map<string, string>,
  parts: string[],
  parentGroupXfrm: GroupTransform | null,
) {
  const grpSpPr = findChild(grpNode, "grpSpPr");
  const xfrm = grpSpPr ? findChild(grpSpPr, "xfrm") : null;
  let grpXfrm: GroupTransform | null = null;
  if (xfrm) {
    const off = findChild(xfrm, "off");
    const ext = findChild(xfrm, "ext");
    const chOff = findChild(xfrm, "chOff");
    const chExt = findChild(xfrm, "chExt");
    if (off && ext && chOff && chExt) {
      grpXfrm = {
        offX: num(off, "x"),
        offY: num(off, "y"),
        extCx: num(ext, "cx"),
        extCy: num(ext, "cy"),
        chOffX: num(chOff, "x"),
        chOffY: num(chOff, "y"),
        chExtCx: num(chExt, "cx"),
        chExtCy: num(chExt, "cy"),
        parent: parentGroupXfrm,
      };
    }
  }
  await renderShapeTree(grpNode, zip, imageRels, parts, grpXfrm || parentGroupXfrm);
}

function applyGroupTransform(box: Box, groupXfrm: GroupTransform | null): Box {
  if (!groupXfrm) return box;
  let { x, y, cx, cy } = box;
  const scaleX = groupXfrm.chExtCx ? groupXfrm.extCx / groupXfrm.chExtCx : 1;
  const scaleY = groupXfrm.chExtCy ? groupXfrm.extCy / groupXfrm.chExtCy : 1;
  x = (x - groupXfrm.chOffX) * scaleX + groupXfrm.offX;
  y = (y - groupXfrm.chOffY) * scaleY + groupXfrm.offY;
  cx *= scaleX;
  cy *= scaleY;
  return groupXfrm.parent ? applyGroupTransform({ x, y, cx, cy }, groupXfrm.parent) : { x, y, cx, cy };
}

function renderShape(spNode: Element, parts: string[], groupXfrm: GroupTransform | null) {
  const spPr = findChild(spNode, "spPr");
  const txBody = findChild(spNode, "txBody");
  const textRuns = txBody ? extractTextRuns(txBody) : [];
  const hasText = textRuns.length > 0;
  let box = getXfrmBox(spPr);
  if (!box) {
    if (!txBody) return;
    box = { x: 609600, y: 342900, cx: 10972800, cy: 1028700 };
  }
  box = applyGroupTransform(box, groupXfrm);

  const geom = getPresetGeometry(spPr);
  const fillColor = extractFillColor(spPr);
  const lineInfo = extractLineInfo(spPr);
  const isTextOnlyOutline = hasText && isTextBoxBackgroundFill(fillColor) && Boolean(lineInfo.color);
  const hasVisualShape = (fillColor && !isTextOnlyOutline) || (lineInfo.color && !isTextOnlyOutline);
  if (hasVisualShape) {
    parts.push(renderGeometry(geom, box, fillColor, isTextOnlyOutline ? { color: null, width: 0, dash: "" } : lineInfo));
  }
  if (hasText) {
    parts.push(renderTextBox(textRuns, box));
  }
}

function isTextBoxBackgroundFill(fillColor: string | null) {
  if (!fillColor) return true;
  const normalized = fillColor.trim().toLowerCase();
  return normalized === "#fff" || normalized === "#ffffff" || normalized === "white" || normalized === "transparent";
}

function renderConnector(cxnNode: Element, parts: string[], groupXfrm: GroupTransform | null) {
  const spPr = findChild(cxnNode, "spPr");
  if (!spPr) return;
  let box = getXfrmBox(spPr);
  if (!box) return;
  box = applyGroupTransform(box, groupXfrm);
  const lineInfo = extractLineInfo(spPr);
  const color = lineInfo.color || "#666666";
  const width = lineInfo.width || 12700;
  const xfrm = findChild(spPr, "xfrm");
  const flipH = xfrm && xfrm.getAttribute("flipH") === "1";
  const flipV = xfrm && xfrm.getAttribute("flipV") === "1";
  let x1 = box.x;
  let y1 = box.y;
  let x2 = box.x + box.cx;
  let y2 = box.y + box.cy;
  if (flipH) [x1, x2] = [x2, x1];
  if (flipV) [y1, y2] = [y2, y1];
  parts.push(`<line x1="${px(x1)}" y1="${px(y1)}" x2="${px(x2)}" y2="${px(y2)}" stroke="${escapeXmlAttribute(color)}" stroke-width="${px(width)}" stroke-linecap="round"/>`);
}

async function renderPicture(
  picNode: Element,
  zip: PptxZip,
  imageRels: Map<string, string>,
  parts: string[],
  groupXfrm: GroupTransform | null,
) {
  const blipFill = findChild(picNode, "blipFill");
  const spPr = findChild(picNode, "spPr");
  if (!blipFill || !spPr) return;
  const blip = findDescendant(blipFill, (node) => localNameIs(node, "blip"));
  if (!blip) return;
  const embedId = blip.getAttribute("r:embed") || blip.getAttribute("embed") || blip.getAttributeNS(MAIN_REL_NS, "embed") || "";
  const target = embedId ? imageRels.get(embedId) : "";
  if (!target) return;
  let box = getXfrmBox(spPr);
  if (!box) return;
  box = applyGroupTransform(box, groupXfrm);

  const imagePath = normalizePptPath("ppt/slides", target);
  const imageFile = zip.file(imagePath);
  if (!imageFile) return;
  const ext = getExtension(imagePath);
  const mimeType = getImageMimeType(ext);
  const base64 = await imageFile.async("base64");
  const href = `data:${mimeType};base64,${base64}`;
  parts.push(`<image href="${escapeXmlAttribute(href)}" x="${px(box.x)}" y="${px(box.y)}" width="${px(box.cx)}" height="${px(box.cy)}" preserveAspectRatio="xMidYMid meet"/>`);
}

function renderGraphicFrame(gfNode: Element, parts: string[], groupXfrm: GroupTransform | null) {
  const xfrmNode = findChild(gfNode, "xfrm");
  let box: Box | null = null;
  if (xfrmNode) {
    const off = findChild(xfrmNode, "off");
    const ext = findChild(xfrmNode, "ext");
    if (off && ext) {
      box = { x: num(off, "x"), y: num(off, "y"), cx: num(ext, "cx") || 1, cy: num(ext, "cy") || 1 };
    }
  }
  if (!box) return;
  box = applyGroupTransform(box, groupXfrm);
  const tbl = findDescendant(gfNode, (node) => localNameIs(node, "tbl"));
  if (tbl) {
    renderTable(tbl, box, parts);
    return;
  }
  parts.push(
    `<rect x="${px(box.x)}" y="${px(box.y)}" width="${px(box.cx)}" height="${px(box.cy)}" fill="#f0f4f8" stroke="#c9d5e2" stroke-width="${px(12700)}" rx="${px(25000)}" ry="${px(25000)}"/>`,
    `<text x="${px(box.x + box.cx / 2)}" y="${px(box.y + box.cy / 2)}" text-anchor="middle" dominant-baseline="central" font-size="${px(Math.min(box.cx, box.cy) * 0.08)}" fill="#98a2b3" font-family="sans-serif">[object]</text>`,
  );
}

function renderTable(tblNode: Element, box: Box, parts: string[]) {
  const tblGrid = findChild(tblNode, "tblGrid");
  const gridCols = tblGrid ? findAllChildren(tblGrid, "gridCol") : [];
  const colWidths = gridCols.map((col) => num(col, "w") || 0);
  const totalColWidth = colWidths.reduce((sum, width) => sum + width, 0) || 1;
  const scaleX = box.cx / totalColWidth;
  const rows = findAllChildren(tblNode, "tr");
  let currentY = box.y;
  for (const row of rows) {
    const rowHeight = num(row, "h") || 370000;
    const cells = findAllChildren(row, "tc");
    let currentX = box.x;
    let cellIndex = 0;
    for (const cell of cells) {
      const gridSpan = parseInt(cell.getAttribute("gridSpan") || "1", 10);
      let cellW = 0;
      for (let index = 0; index < gridSpan && cellIndex + index < colWidths.length; index += 1) {
        cellW += colWidths[cellIndex + index];
      }
      cellW *= scaleX;
      if (cell.getAttribute("vMerge") === "1" || cell.getAttribute("vMerge") === "true") {
        currentX += cellW;
        cellIndex += gridSpan;
        continue;
      }
      const tcPr = findChild(cell, "tcPr");
      let cellFill = "#ffffff";
      const solidFill = tcPr ? findChild(tcPr, "solidFill") : null;
      const srgbClr = solidFill ? findChild(solidFill, "srgbClr") : null;
      const val = srgbClr?.getAttribute("val");
      if (val && /^[0-9a-f]{6}$/i.test(val)) cellFill = `#${val}`;
      parts.push(`<rect x="${px(currentX)}" y="${px(currentY)}" width="${px(cellW)}" height="${px(rowHeight)}" fill="${cellFill}" stroke="#a3b1c6" stroke-width="${px(8000)}"/>`);
      const txBody = findChild(cell, "txBody");
      if (txBody) {
        const textRuns = extractTextRuns(txBody);
        if (textRuns.length > 0) {
          const maxCellFontPx = (rowHeight / EMU_PER_PX) * 0.6;
          const defaultCellFontPx = (rowHeight / EMU_PER_PX) * 0.35;
          const adjustedRuns = textRuns.map((run) => ({
            ...run,
            fontSize: run.fontSize ? Math.min(run.fontSize, maxCellFontPx) : defaultCellFontPx,
          }));
          parts.push(renderTextBox(adjustedRuns, { x: currentX, y: currentY, cx: cellW, cy: rowHeight }, true));
        }
      }
      currentX += cellW;
      cellIndex += gridSpan;
    }
    currentY += rowHeight;
  }
}

function getPresetGeometry(spPr: Element | null) {
  if (!spPr) return "rect";
  const prstGeom = findChild(spPr, "prstGeom");
  return prstGeom ? (prstGeom.getAttribute("prst") || "rect") : "rect";
}

function renderGeometry(
  geom: string,
  box: Box,
  fillColor: string | null,
  lineInfo: { color: string | null; width: number; dash: string },
) {
  const fill = fillColor ? escapeXmlAttribute(fillColor) : "none";
  const stroke = lineInfo.color ? escapeXmlAttribute(lineInfo.color) : "none";
  const strokeWidth = px(lineInfo.width || (lineInfo.color ? 12700 : 0));
  const dashArray = lineInfo.dash ? ` stroke-dasharray="${lineInfo.dash}"` : "";
  const bx = px(box.x);
  const by = px(box.y);
  const bcx = px(box.cx);
  const bcy = px(box.cy);

  if (geom === "ellipse") {
    return `<ellipse cx="${bx + bcx / 2}" cy="${by + bcy / 2}" rx="${bcx / 2}" ry="${bcy / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dashArray}/>`;
  }
  if (geom === "roundRect") {
    const radius = Math.min(bcx, bcy) * 0.08;
    return `<rect x="${bx}" y="${by}" width="${bcx}" height="${bcy}" rx="${radius}" ry="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dashArray}/>`;
  }
  if (geom === "triangle" || geom === "rtTriangle") {
    const points = geom === "rtTriangle"
      ? `${bx},${by + bcy} ${bx + bcx},${by + bcy} ${bx},${by}`
      : `${bx + bcx / 2},${by} ${bx + bcx},${by + bcy} ${bx},${by + bcy}`;
    return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dashArray}/>`;
  }
  if (geom === "diamond") {
    const middleX = bx + bcx / 2;
    const middleY = by + bcy / 2;
    return `<polygon points="${middleX},${by} ${bx + bcx},${middleY} ${middleX},${by + bcy} ${bx},${middleY}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dashArray}/>`;
  }
  if (geom === "line" || geom === "straightConnector1") {
    return `<line x1="${bx}" y1="${by}" x2="${bx + bcx}" y2="${by + bcy}" stroke="${stroke !== "none" ? stroke : "#666"}" stroke-width="${strokeWidth || px(12700)}"${dashArray}/>`;
  }
  const radius = ["rightArrow", "leftArrow", "upArrow", "downArrow", "chevron", "pentagon", "hexagon"].includes(geom)
    ? Math.min(bcx, bcy) * 0.06
    : 0;
  return `<rect x="${bx}" y="${by}" width="${bcx}" height="${bcy}" rx="${radius}" ry="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dashArray}/>`;
}

function extractTextRuns(txBody: Element) {
  const paragraphs = findAllChildren(txBody, "p");
  const result: TextRun[] = [];
  for (const para of paragraphs) {
    const pPr = findChild(para, "pPr");
    const paraAlign = pPr ? (pPr.getAttribute("algn") || "") : "";
    let paraHasContent = false;
    for (const run of findAllChildren(para, "r")) {
      const rPr = findChild(run, "rPr");
      const tNode = findChild(run, "t");
      const text = tNode ? (tNode.textContent || "") : "";
      if (!text) continue;
      result.push({
        text,
        fontSize: resolveRunFontSize(rPr, pPr),
        color: resolveRunColor(rPr),
        bold: Boolean(rPr && (rPr.getAttribute("b") === "1" || rPr.getAttribute("b") === "true")),
        italic: Boolean(rPr && (rPr.getAttribute("i") === "1" || rPr.getAttribute("i") === "true")),
        align: paraAlign,
        lineBreakBefore: !paraHasContent && result.length > 0,
      });
      paraHasContent = true;
    }
    for (const field of findAllChildren(para, "fld")) {
      const tNode = findChild(field, "t");
      const text = tNode ? (tNode.textContent || "") : "";
      if (!text) continue;
      result.push({
        text,
        fontSize: resolveRunFontSize(findChild(field, "rPr"), pPr),
        color: resolveRunColor(findChild(field, "rPr")),
        bold: false,
        italic: false,
        align: paraAlign,
        lineBreakBefore: !paraHasContent && result.length > 0,
      });
      paraHasContent = true;
    }
  }
  return result.filter((run) => run.text || run.lineBreakBefore);
}

function resolveRunFontSize(rPr: Element | null, pPr: Element | null) {
  const rSize = rPr ? getAttrNumber(rPr, "sz") : 0;
  if (rSize > 0) return fontSizeToPx(rSize);
  const defRPr = pPr ? findChild(pPr, "defRPr") : null;
  const defSize = defRPr ? getAttrNumber(defRPr, "sz") : 0;
  if (defSize > 0) return fontSizeToPx(defSize);
  const pSize = pPr ? getAttrNumber(pPr, "sz") : 0;
  return fontSizeToPx(pSize > 0 ? pSize : 1800);
}

function fontSizeToPx(sz: number) {
  return (sz / 100) * (4 / 3);
}

function resolveRunColor(rPr: Element | null) {
  if (!rPr) return "#1f2937";
  const solidFill = findChild(rPr, "solidFill");
  if (solidFill) {
    const color = resolveColorNode(solidFill);
    if (color) return color;
  }
  return "#1f2937";
}

function renderTextBox(textRuns: TextRun[], box: Box, isTableCell = false) {
  if (!textRuns.length) return "";
  const lines: TextRun[][] = [];
  let currentLine: TextRun[] = [];
  for (const run of textRuns) {
    if (run.lineBreakBefore && currentLine.length > 0) {
      lines.push(currentLine);
      currentLine = [];
    }
    if (!run.text) continue;
    currentLine.push(run);
  }
  if (currentLine.length > 0) lines.push(currentLine);
  if (!lines.length) return "";

  const align = textRuns[0].align || "l";
  const textAnchor = align === "ctr" ? "middle" : align === "r" ? "end" : "start";
  const padEmu = isTableCell ? box.cy * 0.08 : Math.min(box.cx, box.cy) * 0.04;
  const padPx = padEmu / EMU_PER_PX;
  const boxPx = {
    x: box.x / EMU_PER_PX,
    y: box.y / EMU_PER_PX,
    cx: box.cx / EMU_PER_PX,
    cy: box.cy / EMU_PER_PX,
  };
  const lineHeights = lines.map((line) => Math.max(...line.map((run) => run.fontSize ? Math.max(run.fontSize, 8) : 24)) * 1.3);
  const totalTextHeight = lineHeights.reduce((sum, height) => sum + height, 0);
  const startX = align === "ctr" ? boxPx.x + boxPx.cx / 2 : align === "r" ? boxPx.x + boxPx.cx - padPx : boxPx.x + padPx;
  let currentY = isTableCell
    ? boxPx.y + Math.max(padPx, (boxPx.cy - totalTextHeight) / 2) + lineHeights[0] * 0.72
    : boxPx.y + padPx + lineHeights[0] * 0.72;

  const clipId = `textclip-${Math.abs(Math.round(box.x + box.y + box.cx + box.cy))}`;
  const fontFamily = "'Yu Gothic','Meiryo','Hiragino Kaku Gothic ProN',Aptos,Calibri,Arial,sans-serif";
  const svgLines = lines.map((line, index) => {
    if (index > 0) currentY += lineHeights[index - 1];
    const tspans = line.map((run) => {
      const fontSize = run.fontSize ? Math.max(run.fontSize, 8) : 24;
      return [
        `<tspan`,
        ` font-size="${fontSize}"`,
        ` fill="${escapeXmlAttribute(run.color || "#1f2937")}"`,
        ` font-weight="${run.bold ? "700" : "400"}"`,
        ` font-style="${run.italic ? "italic" : "normal"}"`,
        `>${escapeHtmlText(run.text)}</tspan>`,
      ].join("");
    }).join("");
    return `<text x="${startX}" y="${currentY}" text-anchor="${textAnchor}" font-family="${fontFamily}">${tspans}</text>`;
  });

  return [
    `<defs><clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><rect x="${boxPx.x}" y="${boxPx.y}" width="${boxPx.cx}" height="${boxPx.cy}"/></clipPath></defs>`,
    `<g clip-path="url(#${clipId})">`,
    ...svgLines,
    "</g>",
  ].join("");
}

function createFallbackTextSvg(text: string, slideW: number, slideH: number) {
  return renderTextBox(
    [{ text, fontSize: fontSizeToPx(2000), color: "#1f2937", bold: true, italic: false, align: "l", lineBreakBefore: false }],
    { x: slideW * 0.08, y: slideH * 0.1, cx: slideW * 0.84, cy: slideH * 0.25 },
  );
}

function getXfrmBox(spPr: Element | null): Box | null {
  if (!spPr) return null;
  const xfrm = findChild(spPr, "xfrm");
  const off = xfrm ? findChild(xfrm, "off") : null;
  const ext = xfrm ? findChild(xfrm, "ext") : null;
  if (!off || !ext) return null;
  const cx = num(ext, "cx");
  const cy = num(ext, "cy");
  if (cx <= 0 && cy <= 0) return null;
  return { x: num(off, "x") || 0, y: num(off, "y") || 0, cx: cx || 1, cy: cy || 1 };
}

function extractFillColor(spPr: Element | null) {
  if (!spPr || findChild(spPr, "noFill")) return null;
  const solidFill = findChild(spPr, "solidFill");
  if (solidFill) return resolveColorNode(solidFill);
  const gradFill = findChild(spPr, "gradFill");
  const gradientStop = gradFill ? findDescendant(gradFill, (node) => localNameIs(node, "gs")) : null;
  return gradientStop ? resolveColorNode(gradientStop) : null;
}

function extractLineInfo(spPr: Element | null) {
  if (!spPr) return { color: null, width: 0, dash: "" };
  const line = findChild(spPr, "ln");
  if (!line || findChild(line, "noFill")) return { color: null, width: 0, dash: "" };
  const width = getAttrNumber(line, "w") || 12700;
  const dashVal = findChild(line, "prstDash")?.getAttribute("val") || "";
  let dash = "";
  if (dashVal === "dash") dash = `${width * 4} ${width * 3}`;
  else if (dashVal === "dot") dash = `${width} ${width * 2}`;
  else if (dashVal === "dashDot") dash = `${width * 4} ${width * 2} ${width} ${width * 2}`;
  return { color: resolveColorNode(line) || "#666666", width, dash };
}

function resolveColorNode(parentNode: Element) {
  const srgb = findChild(parentNode, "srgbClr");
  const val = srgb?.getAttribute("val");
  if (val && /^[0-9a-f]{6}$/i.test(val)) return `#${val}`;
  const schemeVal = findChild(parentNode, "schemeClr")?.getAttribute("val") || "";
  const schemeMap: Record<string, string> = {
    dk1: "#1f2937",
    dk2: "#374151",
    tx1: "#1f2937",
    tx2: "#4b5563",
    lt1: "#ffffff",
    lt2: "#f3f4f6",
    bg1: "#ffffff",
    bg2: "#f3f4f6",
    accent1: "#4472C4",
    accent2: "#ED7D31",
    accent3: "#A5A5A5",
    accent4: "#FFC000",
    accent5: "#5B9BD5",
    accent6: "#70AD47",
  };
  if (schemeVal) return schemeMap[schemeVal] || null;
  const lastClr = findChild(parentNode, "sysClr")?.getAttribute("lastClr");
  return lastClr && /^[0-9a-f]{6}$/i.test(lastClr) ? `#${lastClr}` : null;
}

async function getSlideSize(zip: PptxZip) {
  const fallback = { cx: 12192000, cy: 6858000 };
  const presentationXml = await zip.file("ppt/presentation.xml")?.async("string");
  if (!presentationXml) return fallback;
  const doc = parseXml(presentationXml);
  const sizeNode = getDescendants(doc).find((node) => localNameIs(node, "sldSz"));
  if (!sizeNode) return fallback;
  return {
    cx: Number(sizeNode.getAttribute("cx")) || fallback.cx,
    cy: Number(sizeNode.getAttribute("cy")) || fallback.cy,
  };
}

function getSortedSlidePaths(zip: PptxZip) {
  return Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort((a, b) => getSlideNumber(a) - getSlideNumber(b));
}

function getSlideNumber(path: string) {
  return Number(path.match(/slide(\d+)\.xml$/i)?.[1] ?? 0);
}

function slidePathToRelsPath(slidePath: string) {
  const fileName = slidePath.split("/").pop();
  return `ppt/slides/_rels/${fileName}.rels`;
}

function normalizePresentationRelationshipTarget(target: string) {
  if (target.startsWith("/")) return normalizePath(target.slice(1));
  if (target.startsWith("ppt/")) return normalizePath(target);
  return normalizePath(`ppt/${target.replace(/^\.\//, "")}`);
}

function normalizePptPath(fromDir: string, target: string) {
  if (target.startsWith("/")) return target.replace(/^\//, "");
  return normalizePath(`${fromDir}/${target}`);
}

function normalizePath(path: string) {
  const stack: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function getExtension(path: string) {
  const clean = path.split("?")[0].split("#")[0];
  const index = clean.lastIndexOf(".");
  return index >= 0 ? clean.slice(index + 1).toLowerCase() : "";
}

function parseXml(xml: string) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("pptx内部XMLを解析できませんでした。");
  return doc;
}

function localNameIs(node: Element, name: string) {
  return node.localName === name || node.nodeName.endsWith(`:${name}`);
}

function getLocalName(node: Element) {
  if (node.localName) return node.localName;
  const colonIndex = node.nodeName.lastIndexOf(":");
  return colonIndex >= 0 ? node.nodeName.slice(colonIndex + 1) : node.nodeName;
}

function findChild(parent: Element | null, localName: string) {
  if (!parent) return null;
  return Array.from(parent.children).find((child) => localNameIs(child, localName)) ?? null;
}

function findAllChildren(parent: Element | null, localName: string) {
  if (!parent) return [];
  return Array.from(parent.children).filter((child) => localNameIs(child, localName));
}

function findDescendant(node: Element | null, predicate: (node: Element) => boolean): Element | null {
  if (!node) return null;
  for (const child of Array.from(node.children)) {
    if (predicate(child)) return child;
    const match = findDescendant(child, predicate);
    if (match) return match;
  }
  return null;
}

function getDescendants(node: Document | Element) {
  const results: Element[] = [];
  const root = "documentElement" in node ? node.documentElement : node;
  function visit(current: Element) {
    for (const child of Array.from(current.children)) {
      results.push(child);
      visit(child);
    }
  }
  if (!("documentElement" in node)) results.push(root);
  visit(root);
  return results;
}

function num(node: Element, attr: string) {
  return Number(node.getAttribute(attr)) || 0;
}

function getAttrNumber(node: Element, attr: string) {
  const val = node.getAttribute(attr);
  return val ? Number(val) || 0 : 0;
}

function getImageMimeType(ext: string) {
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/png";
}

function escapeXmlAttribute(value: string | number) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlText(value: string) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function extractSlideText(xml: string) {
  const doc = parseXml(xml);
  const texts = getDescendants(doc)
    .filter((node) => localNameIs(node, "t"))
    .map((node) => (node.textContent || "").trim())
    .filter(Boolean);
  return texts.join(" ").replace(/\s+/g, " ").slice(0, 90);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
