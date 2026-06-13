import { nanoid } from "nanoid";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  currentUser,
  defaultSettings,
  seedExportRecords,
  seedFiles,
  seedMembers,
  seedRooms,
  seedSlides,
} from "../data/seedData";
import { analyzePptxBlob } from "../services/pptxAnalysisService";
import {
  getCurrentAuthUser,
  requestEmailChange as requestAuthEmailChange,
  requestPasswordResetEmail,
  resendEmailVerification,
  signInWithEmail,
  signOut,
  signUpWithEmail,
  subscribeToAuthChanges,
  updateAuthPassword,
  updateProfileName,
  verifyEmailOtp,
} from "../services/authService";
import { deleteBlob, loadSharedState, saveBlob, saveSharedState } from "../services/storageService";
import type {
  AppSettings,
  ExportRecord,
  ExportSettings,
  FileMetaInput,
  FileStatus,
  Room,
  RoomInput,
  RoomMember,
  SlideItem,
  SubmittedFile,
  UserProfile,
} from "../types";
import { getExtension, inferSection, inferSlideCount, inferSlideTitle, validateUploadFile } from "../utils/validation";

export type RoomFilter = "all" | "in_progress" | "waiting" | "ready" | "completed";
export type FileFilter = "all" | "submitted" | "not_submitted" | "revision_requested" | "reviewing";
export type SortMode = "updated" | "deadline" | "title";
type AppSettingsPatch = Partial<Omit<AppSettings, "notifications">> & {
  notifications?: Partial<AppSettings["notifications"]>;
};

interface AppState {
  currentUser: UserProfile;
  isAuthenticated: boolean;
  authReady: boolean;
  isEmailVerified: boolean;
  rooms: Room[];
  members: RoomMember[];
  files: SubmittedFile[];
  slides: SlideItem[];
  exportRecords: ExportRecord[];
  settings: AppSettings;
  selectedRoomId?: string;
  searchQuery: string;
  roomFilter: RoomFilter;
  fileFilter: FileFilter;
  sortMode: SortMode;
  isUploading: boolean;
  isExporting: boolean;
  initializeAuth: () => Promise<void>;
  syncFromServer: () => Promise<void>;
  register: (input: { name: string; email: string; password: string }) => Promise<UserProfile | null>;
  login: (input: { email: string; password: string }) => Promise<void>;
  updateAccountName: (name: string) => Promise<void>;
  requestEmailChange: (newEmail: string) => Promise<void>;
  requestCurrentUserPasswordReset: () => Promise<void>;
  resetPasswordWithSession: (newPassword: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  resendEmailVerification: (email?: string) => Promise<void>;
  verifySignupEmailCode: (input: { email: string; code: string }) => Promise<void>;
  logout: () => Promise<void>;
  createRoom: (input: RoomInput) => Room;
  updateRoom: (roomId: string, patch: Partial<Room>) => void;
  deleteRoom: (roomId: string) => void;
  archiveRoom: (roomId: string) => void;
  joinRoom: (inviteCode: string, displayName: string) => { room?: Room; error?: string };
  setSelectedRoom: (roomId?: string) => void;
  setSearchQuery: (value: string) => void;
  setRoomFilter: (value: RoomFilter) => void;
  setFileFilter: (value: FileFilter) => void;
  setSortMode: (value: SortMode) => void;
  addMember: (roomId: string, member: Omit<RoomMember, "id" | "roomId" | "joinedAt">) => RoomMember;
  updateMember: (memberId: string, patch: Partial<RoomMember>) => void;
  removeMember: (memberId: string) => void;
  addFile: (roomId: string, upload: File, meta?: FileMetaInput) => Promise<SubmittedFile>;
  replaceFile: (fileId: string, upload: File) => Promise<SubmittedFile | undefined>;
  updateFileStatus: (fileId: string, status: FileStatus) => void;
  removeFile: (fileId: string) => Promise<void>;
  createSlidesFromFile: (file: SubmittedFile) => SlideItem[];
  reorderSlides: (roomId: string, orderedSlideIds: string[]) => void;
  updateSlide: (slideId: string, patch: Partial<SlideItem>) => void;
  createExport: (roomId: string, settings: ExportSettings, status?: ExportRecord["status"], errorMessage?: string) => ExportRecord;
  removeExportRecord: (recordId: string) => void;
  updateSettings: (patch: AppSettingsPatch) => void;
  resetSettings: () => void;
  resetDemoData: () => void;
}

interface SharedAppSnapshot {
  rooms: Room[];
  members: RoomMember[];
  files: SubmittedFile[];
  slides: SlideItem[];
  exportRecords: ExportRecord[];
  settings: AppSettings;
}

function createInviteCode() {
  return nanoid(6).replace(/[-_]/g, "").toUpperCase();
}

function createInviteUrl(inviteCode: string) {
  if (typeof window === "undefined") return `https://slideroom.jp/join/${inviteCode}`;
  return `${window.location.origin}/#/join/${inviteCode}`;
}

function now() {
  return new Date().toISOString();
}

const signedOutUser: UserProfile = {
  id: "signed-out-user",
  name: "ゲスト",
};

let authUnsubscribe: (() => void) | undefined;

function applyAuthenticatedUser(
  user: UserProfile,
  previousUserId: string,
  set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
) {
  set((state) => ({
    currentUser: user,
    isAuthenticated: true,
    authReady: true,
    isEmailVerified: Boolean(user.emailVerified),
    rooms: state.rooms.map((room) =>
      room.hostUserId === previousUserId ? { ...room, hostUserId: user.id } : room,
    ),
    members: state.members.map((member) =>
      member.userId === previousUserId
        ? { ...member, userId: user.id, name: user.name, isCurrentUser: true }
        : { ...member, isCurrentUser: member.userId === user.id },
    ),
  }));
}

function updateRoomTimestamp(rooms: Room[], roomId: string) {
  const updatedAt = now();
  return rooms.map((room) => (room.id === roomId ? { ...room, updatedAt } : room));
}

function buildSlidesForFile(file: SubmittedFile, existingSlides: SlideItem[]) {
  const nextOrder =
    existingSlides.filter((slide) => slide.roomId === file.roomId).reduce((max, slide) => Math.max(max, slide.order), 0) + 1;

  return Array.from({ length: file.slideCount }, (_, index) => ({
    id: `slide-${nanoid(10)}`,
    roomId: file.roomId,
    fileId: file.id,
    ownerUserId: file.ownerUserId,
    ownerName: file.ownerName,
    title: inferSlideTitle(file.name, index + 1),
    section: inferSection(index + 1, file.slideCount),
    order: nextOrder + index,
    sourcePage: index + 1,
    isPlaced: true,
  }));
}

function baseState() {
  return {
    currentUser: signedOutUser,
    isAuthenticated: false,
    authReady: false,
    isEmailVerified: false,
    rooms: seedRooms,
    members: seedMembers,
    files: seedFiles,
    slides: seedSlides,
    exportRecords: seedExportRecords,
    settings: defaultSettings,
    selectedRoomId: seedRooms[0]?.id,
    searchQuery: "",
    roomFilter: "all" as RoomFilter,
    fileFilter: "all" as FileFilter,
    sortMode: "updated" as SortMode,
    isUploading: false,
    isExporting: false,
  };
}

function toSharedSnapshot(state: AppState): SharedAppSnapshot {
  return {
    rooms: state.rooms,
    members: state.members.map(({ isCurrentUser, ...member }) => member),
    files: state.files,
    slides: state.slides,
    exportRecords: state.exportRecords,
    settings: state.settings,
  };
}

let sharedStateSaveTimer: ReturnType<typeof setTimeout> | undefined;

function syncSharedState(getState: () => AppState) {
  if (sharedStateSaveTimer) clearTimeout(sharedStateSaveTimer);
  sharedStateSaveTimer = setTimeout(() => {
    void saveSharedState(toSharedSnapshot(getState()));
  }, 120);
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...baseState(),

      async initializeAuth() {
        if (authUnsubscribe) {
          const user = await getCurrentAuthUser();
          set({
            currentUser: user ?? signedOutUser,
            isAuthenticated: Boolean(user),
            authReady: true,
            isEmailVerified: Boolean(user?.emailVerified),
          });
          return;
        }

        const user = await getCurrentAuthUser();
        if (user) {
          applyAuthenticatedUser(user, get().currentUser.id, set);
        } else {
          set({ currentUser: signedOutUser, isAuthenticated: false, authReady: true, isEmailVerified: false });
        }

        authUnsubscribe = subscribeToAuthChanges((nextUser) => {
          if (nextUser) {
            applyAuthenticatedUser(nextUser, get().currentUser.id, set);
            syncSharedState(get);
          } else {
            set({ currentUser: signedOutUser, isAuthenticated: false, authReady: true, isEmailVerified: false });
          }
        });
      },

      async syncFromServer() {
        const snapshot = await loadSharedState<SharedAppSnapshot>();
        if (!snapshot) return;

        set((state) => {
          const selectedRoomStillExists = state.selectedRoomId
            ? snapshot.rooms.some((room) => room.id === state.selectedRoomId)
            : false;

          return {
            rooms: snapshot.rooms,
            members: snapshot.members.map((member) => ({
              ...member,
              isCurrentUser: member.userId === state.currentUser.id,
            })),
            files: snapshot.files,
            slides: snapshot.slides,
            exportRecords: snapshot.exportRecords,
            settings: {
              ...defaultSettings,
              ...snapshot.settings,
              notifications: {
                ...defaultSettings.notifications,
                ...(snapshot.settings?.notifications ?? {}),
              },
            },
            selectedRoomId: selectedRoomStillExists ? state.selectedRoomId : snapshot.rooms[0]?.id,
          };
        });
      },

      async register(input) {
        const user = await signUpWithEmail(input);
        if (user?.emailVerified) {
          applyAuthenticatedUser(user, get().currentUser.id, set);
          syncSharedState(get);
        }
        return user;
      },

      async login(input) {
        const user = await signInWithEmail(input);
        applyAuthenticatedUser(user, get().currentUser.id, set);
        syncSharedState(get);
      },

      async updateAccountName(name) {
        const nextName = name.trim();
        if (!nextName) return;
        const userId = get().currentUser.id;
        const user = await updateProfileName(nextName);
        set((state) => ({
          currentUser: user,
          isEmailVerified: Boolean(user.emailVerified),
          members: state.members.map((member) =>
            member.userId === userId ? { ...member, name: nextName } : member,
          ),
          files: state.files.map((file) =>
            file.ownerUserId === userId ? { ...file, ownerName: nextName } : file,
          ),
          slides: state.slides.map((slide) =>
            slide.ownerUserId === userId ? { ...slide, ownerName: nextName } : slide,
          ),
        }));
        syncSharedState(get);
      },

      async requestEmailChange(newEmail) {
        await requestAuthEmailChange(newEmail);
      },

      async requestCurrentUserPasswordReset() {
        const email = get().currentUser.email;
        if (!email) throw new Error("メールアドレスが登録されていません。");
        await requestPasswordResetEmail(email);
      },

      async resetPasswordWithSession(newPassword) {
        await updateAuthPassword(newPassword);
      },

      async requestPasswordReset(email) {
        await requestPasswordResetEmail(email);
      },

      async resendEmailVerification(emailOverride) {
        const email = emailOverride || get().currentUser.email;
        if (!email) throw new Error("メールアドレスが登録されていません。");
        await resendEmailVerification(email);
      },

      async verifySignupEmailCode(input) {
        const user = await verifyEmailOtp({ email: input.email, token: input.code });
        applyAuthenticatedUser(user, get().currentUser.id, set);
        syncSharedState(get);
      },

      async logout() {
        await signOut();
        set({ currentUser: signedOutUser, isAuthenticated: false, isEmailVerified: false });
      },

      createRoom(input) {
        const createdAt = now();
        const id = `room-${nanoid(8)}`;
        const inviteCode = createInviteCode();
        const room: Room = {
          id,
          title: input.title.trim(),
          className: input.className?.trim() || "未設定の授業",
          teamName: input.teamName?.trim(),
          description: input.description?.trim(),
          status: "draft",
          accessMode: input.accessMode ?? "invite",
          hostUserId: get().currentUser.id,
          inviteCode,
          inviteUrl: createInviteUrl(inviteCode),
          presentationAt: input.presentationAt || undefined,
          deadlineAt: input.deadlineAt || undefined,
          createdAt,
          updatedAt: createdAt,
        };
        const host: RoomMember = {
          id: `member-${nanoid(8)}`,
          roomId: id,
          userId: get().currentUser.id,
          name: get().currentUser.name,
          role: "host",
          joinedAt: createdAt,
          isCurrentUser: true,
        };

        set((state) => ({
          rooms: [room, ...state.rooms],
          members: [host, ...state.members],
          selectedRoomId: room.id,
        }));
        syncSharedState(get);

        return room;
      },

      updateRoom(roomId, patch) {
        set((state) => ({
          rooms: state.rooms.map((room) =>
            room.id === roomId ? { ...room, ...patch, updatedAt: now() } : room,
          ),
        }));
        syncSharedState(get);
      },

      deleteRoom(roomId) {
        set((state) => ({
          rooms: state.rooms.filter((room) => room.id !== roomId),
          members: state.members.filter((member) => member.roomId !== roomId),
          files: state.files.filter((file) => file.roomId !== roomId),
          slides: state.slides.filter((slide) => slide.roomId !== roomId),
          exportRecords: state.exportRecords.filter((record) => record.roomId !== roomId),
          selectedRoomId: state.selectedRoomId === roomId ? state.rooms.find((room) => room.id !== roomId)?.id : state.selectedRoomId,
        }));
        syncSharedState(get);
      },

      archiveRoom(roomId) {
        set((state) => ({
          rooms: state.rooms.map((room) =>
            room.id === roomId ? { ...room, status: "archived", archivedAt: now(), updatedAt: now() } : room,
          ),
        }));
        syncSharedState(get);
      },

      joinRoom(inviteCode, displayName) {
        const normalized = inviteCode.trim().toUpperCase();
        const room = get().rooms.find((candidate) => candidate.inviteCode.toUpperCase() === normalized);
        if (!room) return { error: "招待コードが見つかりません。" };

        if ((room.accessMode ?? "invite") === "authenticated" && !get().isAuthenticated) {
          return { error: "このルームはログインしているユーザーだけ参加できます。ログイン後にもう一度参加してください。" };
        }

        const existing = get().members.find((member) => member.roomId === room.id && member.userId === get().currentUser.id);
        if (existing) {
          set({ selectedRoomId: room.id });
          return { room };
        }

        const member: RoomMember = {
          id: `member-${nanoid(8)}`,
          roomId: room.id,
          userId: get().currentUser.id,
          name: displayName.trim() || get().currentUser.name,
          role: "member",
          joinedAt: now(),
          isCurrentUser: true,
        };

        set((state) => ({
          members: [member, ...state.members],
          rooms: updateRoomTimestamp(state.rooms, room.id),
          selectedRoomId: room.id,
        }));
        syncSharedState(get);
        return { room };
      },

      setSelectedRoom(roomId) {
        set({ selectedRoomId: roomId });
      },

      setSearchQuery(value) {
        set({ searchQuery: value });
      },

      setRoomFilter(value) {
        set({ roomFilter: value });
      },

      setFileFilter(value) {
        set({ fileFilter: value });
      },

      setSortMode(value) {
        set({ sortMode: value });
      },

      addMember(roomId, input) {
        const member: RoomMember = {
          ...input,
          id: `member-${nanoid(8)}`,
          roomId,
          joinedAt: now(),
        };
        set((state) => ({
          members: [member, ...state.members],
          rooms: updateRoomTimestamp(state.rooms, roomId),
        }));
        syncSharedState(get);
        return member;
      },

      updateMember(memberId, patch) {
        set((state) => ({
          members: state.members.map((member) => (member.id === memberId ? { ...member, ...patch } : member)),
        }));
        syncSharedState(get);
      },

      removeMember(memberId) {
        const member = get().members.find((candidate) => candidate.id === memberId);
        set((state) => ({
          members: state.members.filter((candidate) => candidate.id !== memberId),
          rooms: member ? updateRoomTimestamp(state.rooms, member.roomId) : state.rooms,
        }));
        syncSharedState(get);
      },

      async addFile(roomId, upload, meta) {
        await get().syncFromServer();
        const validation = validateUploadFile(upload);
        if (!validation.valid) {
          throw new Error(validation.message);
        }

        set({ isUploading: true });
        try {
          const extension = getExtension(upload.name);
          const createdAt = now();
          const roomMember = get().members.find(
            (member) => member.roomId === roomId && member.userId === get().currentUser.id,
          );
          const ownerUserId = meta?.ownerUserId ?? get().currentUser.id;
          const ownerName = meta?.ownerName ?? roomMember?.name ?? get().currentUser.name;
          const fileId = `file-${nanoid(10)}`;
          const storageKey = `upload-${fileId}`;
          await saveBlob(storageKey, upload);

          let slideCount = inferSlideCount(upload.name, extension);
          let analysisStatus: SubmittedFile["analysisStatus"] = extension === "pptx" ? "fallback" : "not_applicable";
          let analysisWarnings: string[] = [];

          if (extension === "pptx") {
            try {
              const analysis = await analyzePptxBlob(upload);
              slideCount = analysis.slideCount;
              analysisStatus = "parsed";
              analysisWarnings = analysis.warnings;
            } catch (error) {
              analysisStatus = "failed";
              analysisWarnings = [error instanceof Error ? error.message : "PPTX解析に失敗したため仮スライド枚数を使いました。"];
            }
          }

          const submittedFile: SubmittedFile = {
            id: fileId,
            roomId,
            ownerUserId,
            ownerName,
            name: upload.name,
            originalName: upload.name,
            mimeType: upload.type || "application/octet-stream",
            extension,
            size: upload.size,
            status: meta?.status ?? "submitted",
            version: 1,
            assignedRange: meta?.assignedRange,
            slideCount,
            analysisStatus,
            analysisWarnings,
            storageKey,
            createdAt,
            updatedAt: createdAt,
          };
          const newSlides = buildSlidesForFile(submittedFile, get().slides);

          set((state) => ({
            files: [submittedFile, ...state.files],
            slides: [...state.slides, ...newSlides],
            rooms: updateRoomTimestamp(state.rooms, roomId),
            isUploading: false,
          }));
          syncSharedState(get);

          return submittedFile;
        } catch (error) {
          set({ isUploading: false });
          throw error;
        }
      },

      async replaceFile(fileId, upload) {
        const oldFile = get().files.find((file) => file.id === fileId);
        if (!oldFile) return undefined;

        get().updateFileStatus(fileId, "excluded");
        const nextFile = await get().addFile(oldFile.roomId, upload, {
          ownerUserId: oldFile.ownerUserId,
          ownerName: oldFile.ownerName,
          assignedRange: oldFile.assignedRange,
          status: "submitted",
        });

        set((state) => ({
          files: state.files.map((file) =>
            file.id === nextFile.id ? { ...file, version: oldFile.version + 1 } : file,
          ),
        }));
        syncSharedState(get);

        return { ...nextFile, version: oldFile.version + 1 };
      },

      updateFileStatus(fileId, status) {
        const file = get().files.find((candidate) => candidate.id === fileId);
        set((state) => ({
          files: state.files.map((candidate) =>
            candidate.id === fileId ? { ...candidate, status, updatedAt: now() } : candidate,
          ),
          rooms: file ? updateRoomTimestamp(state.rooms, file.roomId) : state.rooms,
        }));
        syncSharedState(get);
      },

      async removeFile(fileId) {
        const file = get().files.find((candidate) => candidate.id === fileId);
        if (file?.storageKey) await deleteBlob(file.storageKey);

        set((state) => ({
          files: state.files.filter((candidate) => candidate.id !== fileId),
          slides: state.slides.filter((slide) => slide.fileId !== fileId),
          rooms: file ? updateRoomTimestamp(state.rooms, file.roomId) : state.rooms,
        }));
        syncSharedState(get);
      },

      createSlidesFromFile(file) {
        const slides = buildSlidesForFile(file, get().slides);
        set((state) => ({
          slides: [...state.slides, ...slides],
          rooms: updateRoomTimestamp(state.rooms, file.roomId),
        }));
        syncSharedState(get);
        return slides;
      },

      reorderSlides(roomId, orderedSlideIds) {
        set((state) => {
          const ordered = new Map(orderedSlideIds.map((id, index) => [id, index + 1]));
          return {
            slides: state.slides.map((slide) =>
              slide.roomId === roomId && ordered.has(slide.id)
                ? { ...slide, order: ordered.get(slide.id)! }
                : slide,
            ),
            rooms: updateRoomTimestamp(state.rooms, roomId),
          };
        });
        syncSharedState(get);
      },

      updateSlide(slideId, patch) {
        const slide = get().slides.find((candidate) => candidate.id === slideId);
        set((state) => ({
          slides: state.slides.map((candidate) => (candidate.id === slideId ? { ...candidate, ...patch } : candidate)),
          rooms: slide ? updateRoomTimestamp(state.rooms, slide.roomId) : state.rooms,
        }));
        syncSharedState(get);
      },

      createExport(roomId, settings, status = "success", errorMessage) {
        const extension = settings.format === "zip" ? "zip" : settings.format;
        const fileName = settings.fileName.endsWith(`.${extension}`)
          ? settings.fileName
          : `${settings.fileName}.${extension}`;
        const record: ExportRecord = {
          id: `export-${nanoid(10)}`,
          roomId,
          fileName,
          format: settings.format,
          status,
          createdAt: now(),
          errorMessage,
        };

        set((state) => ({
          exportRecords: [record, ...state.exportRecords],
          rooms: updateRoomTimestamp(state.rooms, roomId),
        }));
        syncSharedState(get);

        return record;
      },

      removeExportRecord(recordId) {
        set((state) => ({
          exportRecords: state.exportRecords.filter((record) => record.id !== recordId),
        }));
        syncSharedState(get);
      },

      updateSettings(patch) {
        set((state) => ({
          settings: {
            ...state.settings,
            ...patch,
            notifications: {
              ...state.settings.notifications,
              ...(patch.notifications ?? {}),
            },
          },
        }));
        syncSharedState(get);
      },

      resetSettings() {
        set({ settings: defaultSettings });
        syncSharedState(get);
      },

      resetDemoData() {
        set(baseState());
        syncSharedState(get);
      },
    }),
    {
      name: "slideroom-state-v1",
      merge: (persisted, current) => {
        const persistedState = persisted as Partial<AppState> | undefined;
        return {
          ...current,
          ...persistedState,
          currentUser: signedOutUser,
          isAuthenticated: false,
          authReady: false,
          isEmailVerified: false,
          settings: {
            ...defaultSettings,
            ...(persistedState?.settings ?? {}),
            notifications: {
              ...defaultSettings.notifications,
              ...(persistedState?.settings?.notifications ?? {}),
            },
          },
        };
      },
      partialize: (state) => ({
        rooms: state.rooms,
        members: state.members,
        files: state.files,
        slides: state.slides,
        exportRecords: state.exportRecords,
        settings: state.settings,
        selectedRoomId: state.selectedRoomId,
      }),
    },
  ),
);
