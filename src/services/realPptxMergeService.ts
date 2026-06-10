import type { ExportSettings, MergePreviewData, SlideItem, SubmittedFile } from "../types";
import { analyzePptxBlob, type PptxAnalysisResult } from "./pptxAnalysisService";
import { getBlob } from "./storageService";

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const MAIN_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PRESENTATION_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";
const CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const SLIDE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
const IMAGE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const LAYOUT_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout";
const NOTES_SLIDE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";
const NOTES_MASTER_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster";
const CUSTOM_XML_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml";
const SLIDE_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";

interface LoadedPptx {
  file: SubmittedFile;
  fileIndex: number;
  blob: Blob;
  zip: PptxZip;
  analysis: PptxAnalysisResult;
  contentTypes: Document;
}

interface SelectedSlide {
  slide: SlideItem;
  source: LoadedPptx;
  sourceSlidePath: string;
}

interface SlideEntry {
  number: number;
  relId: string;
  slideId: number;
}

interface ExtraContentType {
  partName: string;
  contentType: string;
}

type PptxZip = Awaited<ReturnType<typeof loadZip>>;

export function canAttemptRealPptxMerge(preview: MergePreviewData) {
  if (preview.slides.length === 0) return false;

  return preview.slides.every((slide) => {
    const file = preview.files.find((candidate) => candidate.id === slide.fileId);
    return file?.extension === "pptx" && Boolean(file.storageKey);
  });
}

export async function exportRealMergedPptx(preview: MergePreviewData, _settings: ExportSettings): Promise<Blob> {
  if (!canAttemptRealPptxMerge(preview)) {
    throw new Error("実PPTX結合には、結合対象スライドの元ファイルがすべてアップロード済みPPTXである必要があります。");
  }

  const loadedSources = await loadSourcePptxFiles(preview);
  const selectedSlides = resolveSelectedSlides(preview, loadedSources);
  if (selectedSlides.length === 0) {
    throw new Error("結合対象のスライドがありません。");
  }

  const passThroughBlob = resolveSingleSourcePassThrough(selectedSlides);
  if (passThroughBlob) {
    return passThroughBlob;
  }

  const mergedZip = await buildMergedPptx(Array.from(loadedSources.values()), selectedSlides);
  const output = await mergedZip.generateAsync({
    type: "blob",
    mimeType: PPTX_MIME,
    compression: "DEFLATE",
  });

  return output instanceof Blob ? output : new Blob([output], { type: PPTX_MIME });
}

async function loadZip(blob: Blob) {
  const { default: JSZip } = await import("jszip");
  return JSZip.loadAsync(blob);
}

async function loadSourcePptxFiles(preview: MergePreviewData) {
  const fileIds = [...new Set(preview.slides.map((slide) => slide.fileId))];
  const loaded = new Map<string, LoadedPptx>();

  for (const [index, fileId] of fileIds.entries()) {
    const file = preview.files.find((candidate) => candidate.id === fileId);
    if (!file?.storageKey) {
      throw new Error(`${file?.name ?? fileId} の保存済みBlobが見つかりません。`);
    }

    const blob = await getBlob(file.storageKey);
    if (!blob) {
      throw new Error(`${file.name} をIndexedDBから読み込めませんでした。`);
    }

    const zip = await loadZip(blob);
    ensurePptxStructure(zip);
    const analysis = await analyzePptxBlob(blob);
    const contentTypesXml = await zip.file("[Content_Types].xml")!.async("string");
    loaded.set(file.id, {
      file,
      fileIndex: index + 1,
      blob,
      zip,
      analysis,
      contentTypes: parseXml(contentTypesXml),
    });
  }

  return loaded;
}

function resolveSelectedSlides(preview: MergePreviewData, loadedSources: Map<string, LoadedPptx>) {
  return preview.slides.map((slide) => {
    const source = loadedSources.get(slide.fileId);
    const sourceFile = preview.files.find((file) => file.id === slide.fileId);
    if (!source || !sourceFile) {
      throw new Error(`${slide.title} の元PPTXを特定できません。`);
    }

    const sourceSlidePath = source.analysis.slidePaths[slide.sourcePage - 1];
    if (!sourceSlidePath) {
      throw new Error(`${sourceFile.name} の${slide.sourcePage}枚目を特定できません。`);
    }

    return { slide, source, sourceSlidePath };
  });
}

function resolveSingleSourcePassThrough(selectedSlides: SelectedSlide[]) {
  const firstSource = selectedSlides[0]?.source;
  if (!firstSource) return undefined;
  if (selectedSlides.length !== firstSource.analysis.slidePaths.length) return undefined;
  if (!selectedSlides.every((selected) => selected.source === firstSource)) return undefined;
  if (!selectedSlides.every((selected, index) => selected.slide.sourcePage === index + 1)) return undefined;
  return firstSource.blob;
}

async function buildMergedPptx(sources: LoadedPptx[], slidePlan: SelectedSlide[]) {
  const base = sources[0];
  const mergedZip = await loadZip(new Blob([await base.zip.generateAsync({ type: "arraybuffer" })], { type: PPTX_MIME }));
  const baseLayoutTarget = await getFirstBaseLayoutTarget(base.zip);
  const slideEntries: SlideEntry[] = [];
  const copyCounter = { value: 1 };
  const extraContentTypes: ExtraContentType[] = [];

  removeExistingSlides(mergedZip);

  for (let index = 0; index < slidePlan.length; index += 1) {
    const slideNumber = index + 1;
    const { source, sourceSlidePath } = slidePlan[index];
    const destSlidePath = `ppt/slides/slide${slideNumber}.xml`;
    const destRelsPath = `ppt/slides/_rels/slide${slideNumber}.xml.rels`;
    const partMap = new Map<string, string>([[sourceSlidePath, destSlidePath]]);
    const sourceSlideFile = source.zip.file(sourceSlidePath);
    if (!sourceSlideFile) {
      throw new Error(`${source.file.name} のスライドXMLを取得できませんでした。`);
    }

    mergedZip.file(destSlidePath, await sourceSlideFile.async("string"));

    const sourceRelsPath = slidePathToRelsPath(sourceSlidePath);
    const sourceRelsFile = source.zip.file(sourceRelsPath);
    if (sourceRelsFile) {
      const relsDoc = parseXml(await sourceRelsFile.async("string"));
      await rewriteRelationships({
        source,
        mergedZip,
        relsDoc,
        sourcePartPath: sourceSlidePath,
        destPartPath: destSlidePath,
        slideNumber,
        partMap,
        copyCounter,
        extraContentTypes,
        baseLayoutTarget,
        isSlideRels: true,
      });
      mergedZip.file(destRelsPath, serializeXml(relsDoc));
    } else {
      mergedZip.file(destRelsPath, emptyRelationshipsXml());
    }

    slideEntries.push({
      number: slideNumber,
      relId: "",
      slideId: 255 + slideNumber,
    });
  }

  await rebuildPresentationRels(mergedZip, slideEntries);
  await rebuildPresentation(mergedZip, slideEntries);
  await sanitizePowerPointOutput(mergedZip);
  await rebuildContentTypes(mergedZip, base.contentTypes, sources, slideEntries, extraContentTypes);
  return mergedZip;
}

async function sanitizePowerPointOutput(zip: PptxZip) {
  removePackageParts(zip, [
    /^ppt\/notesSlides\//i,
    /^ppt\/notesMasters\//i,
    /^customXml\//i,
  ]);
  await removeRelationshipsByType(zip, "ppt/_rels/presentation.xml.rels", [NOTES_MASTER_REL_TYPE, CUSTOM_XML_REL_TYPE]);
  await removePresentationChildren(zip, ["notesMasterIdLst"]);

  const slideRelPaths = Object.keys(zip.files)
    .filter((path) => !zip.files[path].dir && /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/i.test(path));
  for (const relPath of slideRelPaths) {
    await removeRelationshipsByType(zip, relPath, [NOTES_SLIDE_REL_TYPE]);
  }
}

async function rewriteRelationships(options: {
  source: LoadedPptx;
  mergedZip: PptxZip;
  relsDoc: Document;
  sourcePartPath: string;
  destPartPath: string;
  slideNumber: number;
  partMap: Map<string, string>;
  copyCounter: { value: number };
  extraContentTypes: ExtraContentType[];
  baseLayoutTarget: string | null;
  isSlideRels: boolean;
}) {
  const {
    source,
    mergedZip,
    relsDoc,
    sourcePartPath,
    destPartPath,
    slideNumber,
    partMap,
    copyCounter,
    extraContentTypes,
    baseLayoutTarget,
    isSlideRels,
  } = options;
  const sourceDir = getDirectoryName(sourcePartPath);
  const destDir = getDirectoryName(destPartPath);

  for (const relationship of Array.from(relsDoc.documentElement.children)) {
    const type = relationship.getAttribute("Type");
    const target = relationship.getAttribute("Target") || "";

    if (relationship.getAttribute("TargetMode")) {
      continue;
    }

    if (isSlideRels && type === LAYOUT_REL_TYPE && baseLayoutTarget) {
      relationship.setAttribute("Target", baseLayoutTarget);
      continue;
    }

    const sourceTargetPath = normalizePptPath(sourceDir, target);
    if (!source.zip.file(sourceTargetPath)) {
      relationship.remove();
      continue;
    }

    const destTargetPath = type === IMAGE_REL_TYPE
      ? await copyImagePart(source, mergedZip, sourceTargetPath, copyCounter)
      : await copyRelatedPart({
        source,
        mergedZip,
        sourcePartPath: sourceTargetPath,
        slideNumber,
        partMap,
        copyCounter,
        extraContentTypes,
        baseLayoutTarget,
      });

    relationship.setAttribute("Target", toRelativePath(destDir, destTargetPath));
  }
}

async function copyImagePart(
  source: LoadedPptx,
  mergedZip: PptxZip,
  sourcePartPath: string,
  copyCounter: { value: number },
) {
  const sourceFile = source.zip.file(sourcePartPath);
  if (!sourceFile) {
    throw new Error("画像パーツを取得できませんでした。");
  }

  const ext = getExtension(sourcePartPath) || "bin";
  const destPath = `ppt/media/image_${source.fileIndex}_${copyCounter.value++}.${ext}`;
  mergedZip.file(destPath, await sourceFile.async("arraybuffer"));
  return destPath;
}

async function copyRelatedPart(options: {
  source: LoadedPptx;
  mergedZip: PptxZip;
  sourcePartPath: string;
  slideNumber: number;
  partMap: Map<string, string>;
  copyCounter: { value: number };
  extraContentTypes: ExtraContentType[];
  baseLayoutTarget: string | null;
}) {
  const {
    source,
    mergedZip,
    sourcePartPath,
    slideNumber,
    partMap,
    copyCounter,
    extraContentTypes,
    baseLayoutTarget,
  } = options;

  if (partMap.has(sourcePartPath)) {
    return partMap.get(sourcePartPath)!;
  }

  const sourceFile = source.zip.file(sourcePartPath);
  if (!sourceFile) {
    throw new Error("スライドの関連ファイルを取得できませんでした。");
  }

  const destPartPath = makeCopiedPartPath(sourcePartPath, source.fileIndex, slideNumber, copyCounter.value++);
  partMap.set(sourcePartPath, destPartPath);
  mergedZip.file(destPartPath, await sourceFile.async("arraybuffer"));
  addCopiedContentType(source, sourcePartPath, destPartPath, extraContentTypes);

  const sourceRelsPath = partPathToRelsPath(sourcePartPath);
  const sourceRelsFile = source.zip.file(sourceRelsPath);
  if (sourceRelsFile) {
    const relsDoc = parseXml(await sourceRelsFile.async("string"));
    await rewriteRelationships({
      source,
      mergedZip,
      relsDoc,
      sourcePartPath,
      destPartPath,
      slideNumber,
      partMap,
      copyCounter,
      extraContentTypes,
      baseLayoutTarget,
      isSlideRels: false,
    });
    mergedZip.file(partPathToRelsPath(destPartPath), serializeXml(relsDoc));
  }

  return destPartPath;
}

function removeExistingSlides(zip: PptxZip) {
  Object.keys(zip.files).forEach((path) => {
    if (
      /^ppt\/slides\/slide\d+\.xml$/i.test(path) ||
      /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/i.test(path) ||
      /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(path) ||
      /^ppt\/notesSlides\/_rels\/notesSlide\d+\.xml\.rels$/i.test(path) ||
      /^ppt\/comments\/comment\d+\.xml$/i.test(path) ||
      /^ppt\/comments\/_rels\/comment\d+\.xml\.rels$/i.test(path)
    ) {
      zip.remove(path);
    }
  });
}

function removePackageParts(zip: PptxZip, patterns: RegExp[]) {
  Object.keys(zip.files).forEach((path) => {
    if (patterns.some((pattern) => pattern.test(path))) {
      zip.remove(path);
    }
  });
}

async function removeRelationshipsByType(zip: PptxZip, relsPath: string, types: string[]) {
  const relsFile = zip.file(relsPath);
  if (!relsFile) return;

  const doc = parseXml(await relsFile.async("string"));
  const typeSet = new Set(types);
  Array.from(doc.documentElement.children).forEach((relationship) => {
    if (typeSet.has(relationship.getAttribute("Type") || "")) {
      relationship.remove();
    }
  });
  zip.file(relsPath, serializeXml(doc));
}

async function removePresentationChildren(zip: PptxZip, localNames: string[]) {
  const presentationFile = zip.file("ppt/presentation.xml");
  if (!presentationFile) return;

  const doc = parseXml(await presentationFile.async("string"));
  const localNameSet = new Set(localNames);
  Array.from(doc.documentElement.children).forEach((child) => {
    if (localNameSet.has(child.localName) || localNameSet.has(child.nodeName.replace(/^.*:/, ""))) {
      child.remove();
    }
  });
  zip.file("ppt/presentation.xml", serializeXml(doc));
}

async function rebuildPresentation(zip: PptxZip, slideEntries: SlideEntry[]) {
  const doc = parseXml(await zip.file("ppt/presentation.xml")!.async("string"));
  const sldIdLst = getOrCreateChild(doc, doc.documentElement, PRESENTATION_NS, "p:sldIdLst");
  removeChildren(sldIdLst);
  removePowerPointSectionLists(doc);

  slideEntries.forEach((entry) => {
    const sldId = doc.createElementNS(PRESENTATION_NS, "p:sldId");
    sldId.setAttribute("id", String(entry.slideId));
    sldId.setAttributeNS(MAIN_REL_NS, "r:id", entry.relId);
    sldIdLst.appendChild(sldId);
  });

  zip.file("ppt/presentation.xml", serializeXml(doc));
}

async function rebuildPresentationRels(zip: PptxZip, slideEntries: SlideEntry[]) {
  const path = "ppt/_rels/presentation.xml.rels";
  const doc = parseXml(await zip.file(path)!.async("string"));
  const existingIds = new Set<string>();

  Array.from(doc.documentElement.children).forEach((relationship) => {
    if (relationship.getAttribute("Type") === SLIDE_REL_TYPE) {
      relationship.remove();
    } else {
      const id = relationship.getAttribute("Id");
      if (id) existingIds.add(id);
    }
  });

  slideEntries.forEach((entry) => {
    entry.relId = nextRelationshipId(existingIds);
    const relationship = doc.createElementNS(REL_NS, "Relationship");
    relationship.setAttribute("Id", entry.relId);
    relationship.setAttribute("Type", SLIDE_REL_TYPE);
    relationship.setAttribute("Target", `slides/slide${entry.number}.xml`);
    doc.documentElement.appendChild(relationship);
  });

  zip.file(path, serializeXml(doc));
}

function nextRelationshipId(existingIds: Set<string>) {
  let index = 1;
  while (existingIds.has(`rId${index}`)) index += 1;
  const id = `rId${index}`;
  existingIds.add(id);
  return id;
}

async function rebuildContentTypes(
  zip: PptxZip,
  baseDoc: Document,
  sources: LoadedPptx[],
  slideEntries: SlideEntry[],
  extraContentTypes: ExtraContentType[] = [],
) {
  const doc = baseDoc.cloneNode(true) as Document;
  const root = doc.documentElement;

  Array.from(root.children).forEach((child) => {
    const partName = child.getAttribute("PartName") || "";
    if (child.localName === "Override" && /^\/ppt\/slides\/slide\d+\.xml$/i.test(partName)) {
      child.remove();
    }
  });

  const defaults = new Set(
    Array.from(root.children)
      .filter((child) => child.localName === "Default")
      .map((child) => child.getAttribute("Extension")),
  );
  const overrides = new Set(
    Array.from(root.children)
      .filter((child) => child.localName === "Override")
      .map((child) => child.getAttribute("PartName")),
  );

  sources.forEach((source) => {
    Array.from(source.contentTypes.documentElement.children).forEach((child) => {
      if (child.localName !== "Default") return;
      const extension = child.getAttribute("Extension");
      if (extension && !defaults.has(extension)) {
        root.appendChild(doc.importNode(child, true));
        defaults.add(extension);
      }
    });
  });

  slideEntries.forEach((entry) => {
    const partName = `/ppt/slides/slide${entry.number}.xml`;
    if (overrides.has(partName)) return;
    const override = doc.createElementNS(CONTENT_TYPES_NS, "Override");
    override.setAttribute("PartName", partName);
    override.setAttribute("ContentType", SLIDE_CONTENT_TYPE);
    root.appendChild(override);
    overrides.add(partName);
  });

  extraContentTypes.forEach((entry) => {
    if (overrides.has(entry.partName)) return;
    const override = doc.createElementNS(CONTENT_TYPES_NS, "Override");
    override.setAttribute("PartName", entry.partName);
    override.setAttribute("ContentType", entry.contentType);
    root.appendChild(override);
    overrides.add(entry.partName);
  });

  removeMissingPartOverrides(zip, root);
  zip.file("[Content_Types].xml", serializeXml(doc));
}

function removeMissingPartOverrides(zip: PptxZip, contentTypesRoot: Element) {
  const existingFiles = new Set(Object.keys(zip.files).filter((path) => !zip.files[path].dir));

  Array.from(contentTypesRoot.children).forEach((child) => {
    if (child.localName !== "Override") return;
    const partName = child.getAttribute("PartName") || "";
    const zipPath = partName.replace(/^\//, "");
    if (zipPath && !existingFiles.has(zipPath)) {
      child.remove();
    }
  });
}

async function getFirstBaseLayoutTarget(zip: PptxZip) {
  const firstSlide = getSortedSlidePaths(zip)[0];
  if (!firstSlide) return null;

  const relsPath = slidePathToRelsPath(firstSlide);
  const relsFile = zip.file(relsPath);
  if (!relsFile) return null;

  const doc = parseXml(await relsFile.async("string"));
  const relationship = Array.from(doc.documentElement.children)
    .find((rel) => rel.getAttribute("Type") === LAYOUT_REL_TYPE);
  return relationship ? relationship.getAttribute("Target") : null;
}

function getSortedSlidePaths(zip: PptxZip) {
  return Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort((a, b) => getSlideNumber(a) - getSlideNumber(b));
}

function getSlideNumber(path: string) {
  const match = path.match(/slide(\d+)\.xml$/i);
  return match ? Number(match[1]) : 0;
}

function slidePathToRelsPath(slidePath: string) {
  const fileName = slidePath.split("/").pop();
  return `ppt/slides/_rels/${fileName}.rels`;
}

function partPathToRelsPath(partPath: string) {
  const directory = getDirectoryName(partPath);
  const fileName = partPath.split("/").pop();
  return `${directory}/_rels/${fileName}.rels`;
}

function getDirectoryName(path: string) {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(0, index) : "";
}

function getFileBaseName(path: string) {
  const fileName = path.split("/").pop() || "part";
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName;
}

function normalizePptPath(fromDir: string, target: string) {
  if (target.startsWith("/")) return target.replace(/^\//, "");

  const parts = `${fromDir}/${target}`.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.join("/");
}

function toRelativePath(fromDir: string, targetPath: string) {
  const fromParts = fromDir ? fromDir.split("/").filter(Boolean) : [];
  const targetParts = targetPath.split("/").filter(Boolean);

  while (fromParts.length && targetParts.length && fromParts[0] === targetParts[0]) {
    fromParts.shift();
    targetParts.shift();
  }

  return [...fromParts.map(() => ".."), ...targetParts].join("/") || ".";
}

function makeCopiedPartPath(sourcePartPath: string, sourceFileIndex: number, slideNumber: number, copyIndex: number) {
  const directory = getDirectoryName(sourcePartPath);
  const baseName = getFileBaseName(sourcePartPath).replace(/[^A-Za-z0-9_-]/g, "_") || "part";
  const ext = getExtension(sourcePartPath);
  const suffix = `m${sourceFileIndex}_s${slideNumber}_${copyIndex}`;
  return `${directory}/${baseName}_${suffix}${ext ? `.${ext}` : ""}`;
}

function addCopiedContentType(
  source: LoadedPptx,
  sourcePartPath: string,
  destPartPath: string,
  extraContentTypes: ExtraContentType[],
) {
  const partName = `/${sourcePartPath}`;
  const override = Array.from(source.contentTypes.documentElement.children).find((child) => (
    child.localName === "Override" && child.getAttribute("PartName") === partName
  ));
  if (!override) return;

  const contentType = override.getAttribute("ContentType");
  if (!contentType) return;
  extraContentTypes.push({
    partName: `/${destPartPath}`,
    contentType,
  });
}

function getExtension(path: string) {
  const clean = path.split("?")[0].split("#")[0];
  const index = clean.lastIndexOf(".");
  return index >= 0 ? clean.slice(index + 1).toLowerCase() : "";
}

function parseXml(xml: string) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error("pptx内部XMLを解析できませんでした。");
  }
  return doc;
}

function serializeXml(doc: Document) {
  return new XMLSerializer().serializeToString(doc);
}

function emptyRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}"/>`;
}

function getOrCreateChild(doc: Document, parent: Element, namespace: string, qualifiedName: string) {
  const localName = qualifiedName.includes(":") ? qualifiedName.split(":")[1] : qualifiedName;
  const matchesName = (node: Element) => (
    node.localName === localName ||
    node.nodeName === qualifiedName ||
    node.nodeName.endsWith(`:${localName}`)
  );
  const matches = Array.from(parent.children).filter(matchesName);
  let child = matches[0];
  matches.slice(1).forEach((duplicate) => duplicate.remove());
  if (!child) {
    child = doc.createElementNS(namespace, qualifiedName);
    parent.appendChild(child);
  }
  return child;
}

function removeChildren(element: Element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function removePowerPointSectionLists(doc: Document) {
  getDescendants(doc).forEach((node) => {
    if (localNameIs(node, "sectionLst")) {
      node.remove();
    }
  });
}

function ensurePptxStructure(zip: PptxZip) {
  const required = ["[Content_Types].xml", "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels"];
  const missing = required.find((path) => !zip.file(path));
  if (missing) {
    throw new Error("スライド情報を取得できませんでした。");
  }
}

function localNameIs(node: Element, name: string) {
  return node.localName === name || node.nodeName.endsWith(`:${name}`);
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

  if (!("documentElement" in node)) {
    results.push(root);
  }
  visit(root);
  return results;
}
