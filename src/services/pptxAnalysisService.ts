export interface PptxAnalysisResult {
  slideCount: number;
  slidePaths: string[];
  slideRelationshipIds: string[];
  mediaCount: number;
  layoutCount: number;
  masterCount: number;
  themeCount: number;
  warnings: string[];
}

const PRESENTATION_PATH = "ppt/presentation.xml";
const PRESENTATION_RELS_PATH = "ppt/_rels/presentation.xml.rels";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export async function analyzePptxBlob(blob: Blob): Promise<PptxAnalysisResult> {
  const zip = await loadZip(blob);
  const presentationXml = await readZipText(zip, PRESENTATION_PATH);
  const presentationRelsXml = await readZipText(zip, PRESENTATION_RELS_PATH);
  const warnings: string[] = [];

  if (!presentationXml) {
    throw new Error("PPTX内に ppt/presentation.xml が見つかりません。");
  }

  if (!presentationRelsXml) {
    throw new Error("PPTX内に ppt/_rels/presentation.xml.rels が見つかりません。");
  }

  const presentationDoc = parseXml(presentationXml, PRESENTATION_PATH);
  const relsDoc = parseXml(presentationRelsXml, PRESENTATION_RELS_PATH);
  const relMap = readRelationshipMap(relsDoc);
  const slideRelationshipIds = readSlideRelationshipIds(presentationDoc);
  let slidePaths = slideRelationshipIds
    .map((relationshipId) => relMap.get(relationshipId))
    .filter((target): target is string => Boolean(target))
    .map(normalizePresentationRelationshipTarget);

  if (slideRelationshipIds.length === 0) {
    warnings.push("presentation.xml にスライド一覧がないため、slidesフォルダから枚数を推定しました。");
    slidePaths = listSlideFiles(zip);
  }

  const missingSlidePaths = slidePaths.filter((path) => !zip.file(path));
  if (missingSlidePaths.length > 0) {
    warnings.push(`${missingSlidePaths.length}件のスライドXMLが見つかりません。`);
  }

  const existingSlidePaths = slidePaths.filter((path) => Boolean(zip.file(path)));
  if (existingSlidePaths.length === 0) {
    throw new Error("PPTX内のスライドXMLを特定できません。");
  }

  if (existingSlidePaths.length !== slidePaths.length) {
    slidePaths = existingSlidePaths;
  }

  return {
    slideCount: slidePaths.length,
    slidePaths,
    slideRelationshipIds,
    mediaCount: countFiles(zip, /^ppt\/media\/[^/]+$/),
    layoutCount: countFiles(zip, /^ppt\/slideLayouts\/slideLayout\d+\.xml$/),
    masterCount: countFiles(zip, /^ppt\/slideMasters\/slideMaster\d+\.xml$/),
    themeCount: countFiles(zip, /^ppt\/theme\/theme\d+\.xml$/),
    warnings,
  };
}

async function loadZip(blob: Blob) {
  const { default: JSZip } = await import("jszip");
  return JSZip.loadAsync(blob);
}

type PptxZip = Awaited<ReturnType<typeof loadZip>>;

async function readZipText(zip: PptxZip, path: string) {
  const file = zip.file(path);
  if (!file) return undefined;
  return file.async("string");
}

function parseXml(xml: string, path: string) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error(`${path} のXML解析に失敗しました。`);
  }
  return doc;
}

function readSlideRelationshipIds(presentationDoc: Document) {
  const candidates = [
    ...Array.from(presentationDoc.getElementsByTagName("p:sldId")),
    ...Array.from(presentationDoc.getElementsByTagName("sldId")),
  ];

  return candidates
    .map((node) => node.getAttributeNS(REL_NS, "id") ?? node.getAttribute("r:id") ?? node.getAttribute("id"))
    .filter((relationshipId): relationshipId is string => Boolean(relationshipId));
}

function readRelationshipMap(relsDoc: Document) {
  const map = new Map<string, string>();
  const relationships = [
    ...Array.from(relsDoc.getElementsByTagName("Relationship")),
    ...Array.from(relsDoc.getElementsByTagName("rel:Relationship")),
  ];

  relationships.forEach((relationship) => {
    const id = relationship.getAttribute("Id");
    const target = relationship.getAttribute("Target");
    if (id && target) map.set(id, target);
  });

  return map;
}

function normalizePresentationRelationshipTarget(target: string) {
  if (target.startsWith("/")) return target.slice(1);
  if (target.startsWith("ppt/")) return target;
  return `ppt/${target.replace(/^\.\//, "")}`;
}

function listSlideFiles(zip: PptxZip) {
  return Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => slideFileNumber(a) - slideFileNumber(b));
}

function slideFileNumber(path: string) {
  return Number(path.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
}

function countFiles(zip: PptxZip, pattern: RegExp) {
  return Object.keys(zip.files).filter((path) => pattern.test(path)).length;
}
