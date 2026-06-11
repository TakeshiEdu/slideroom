export type RoomStatus = "draft" | "in_progress" | "waiting" | "ready" | "completed" | "archived";
export type FileStatus = "submitted" | "not_submitted" | "revision_requested" | "reviewing" | "approved" | "excluded";
export type MemberRole = "host" | "admin" | "member" | "viewer";
export type ExportFormat = "pptx" | "pdf" | "zip";
export type PptxAnalysisStatus = "not_applicable" | "parsed" | "fallback" | "failed";

export interface UserProfile {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  emailVerified?: boolean;
}

export interface Room {
  id: string;
  title: string;
  className: string;
  teamName?: string;
  description?: string;
  status: RoomStatus;
  hostUserId: string;
  inviteCode: string;
  inviteUrl: string;
  presentationAt?: string;
  deadlineAt?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface RoomMember {
  id: string;
  roomId: string;
  userId: string;
  name: string;
  role: MemberRole;
  assignedRange?: string;
  joinedAt: string;
  isCurrentUser?: boolean;
}

export interface SubmittedFile {
  id: string;
  roomId: string;
  ownerUserId: string;
  ownerName: string;
  name: string;
  originalName: string;
  mimeType: string;
  extension: string;
  size: number;
  status: FileStatus;
  version: number;
  assignedRange?: string;
  slideCount: number;
  analysisStatus?: PptxAnalysisStatus;
  analysisWarnings?: string[];
  storageKey?: string;
  objectUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SlideItem {
  id: string;
  roomId: string;
  fileId: string;
  ownerUserId: string;
  ownerName: string;
  title: string;
  section: string;
  order: number;
  sourcePage: number;
  thumbnailUrl?: string;
  isPlaced: boolean;
  isDuplicate?: boolean;
}

export interface RoomProgress {
  roomId: string;
  totalMembers: number;
  submittedMembers: number;
  notSubmittedMembers: number;
  totalFiles: number;
  totalSlides: number;
  progressRate: number;
}

export interface ExportSettings {
  format: ExportFormat;
  fileName: string;
  includeCover: boolean;
  includePageNumber: boolean;
  includeSectionDivider: boolean;
  includeMemberName: boolean;
}

export interface ExportRecord {
  id: string;
  roomId: string;
  fileName: string;
  format: ExportFormat;
  status: "success" | "failed";
  createdAt: string;
  downloadUrl?: string;
  errorMessage?: string;
}

export interface AppSettings {
  theme: "light" | "dark";
  fontSize: "small" | "medium" | "large";
  compactMode: boolean;
  defaultExportFormat: ExportFormat;
  fileNameTemplate: string;
  includePageNumberDefault: boolean;
  includeCoverDefault: boolean;
  notifications: {
    submit: boolean;
    comment: boolean;
    mergeComplete: boolean;
    deadlineReminder: boolean;
  };
}

export interface RoomInput {
  title: string;
  className?: string;
  teamName?: string;
  description?: string;
  presentationAt?: string;
  deadlineAt?: string;
}

export interface FileMetaInput {
  ownerUserId?: string;
  ownerName?: string;
  assignedRange?: string;
  status?: FileStatus;
}

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

export interface FileAnalysis {
  fileId: string;
  slideCount: number;
  canMerge: boolean;
  warnings: string[];
  sourceType?: "pptx" | "pdf" | "fallback";
  slidePaths?: string[];
  mediaCount?: number;
  layoutCount?: number;
  masterCount?: number;
}

export interface MergePreviewData {
  room: Room;
  slides: SlideItem[];
  files: SubmittedFile[];
  totalSlides: number;
  unplacedSlides: number;
  duplicateOrderCount: number;
  includedFilesCount: number;
}
