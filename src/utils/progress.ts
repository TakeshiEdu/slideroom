import type { Room, RoomMember, RoomProgress, SlideItem, SubmittedFile } from "../types";

const submittedStatuses = new Set(["submitted", "approved", "revision_requested", "reviewing"]);

export function calculateRoomProgress(
  room: Room,
  members: RoomMember[],
  files: SubmittedFile[],
  slides: SlideItem[],
): RoomProgress {
  const roomMembers = members.filter((member) => member.roomId === room.id);
  const roomFiles = files.filter((file) => file.roomId === room.id && file.status !== "excluded");
  const roomSlides = slides.filter((slide) => slide.roomId === room.id && slide.isPlaced);

  const submittedMemberIds = new Set(
    roomFiles.filter((file) => submittedStatuses.has(file.status)).map((file) => file.ownerUserId),
  );
  const submittedMembers = roomMembers.filter((member) => submittedMemberIds.has(member.userId)).length;
  const totalMembers = roomMembers.length;

  return {
    roomId: room.id,
    totalMembers,
    submittedMembers,
    notSubmittedMembers: Math.max(totalMembers - submittedMembers, 0),
    totalFiles: roomFiles.length,
    totalSlides: roomSlides.length,
    progressRate: totalMembers === 0 ? 0 : Math.round((submittedMembers / totalMembers) * 100),
  };
}

export function getRoomProgressLabel(progress: RoomProgress) {
  return `${progress.submittedMembers}/${progress.totalMembers} 提出済み`;
}
