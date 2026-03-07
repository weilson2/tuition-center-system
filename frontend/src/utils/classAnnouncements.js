const STORAGE_KEY = 'classAnnouncementsByClassroom';

function readStoredAnnouncements() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

function writeStoredAnnouncements(data) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  window.dispatchEvent(new CustomEvent('classAnnouncementsUpdated'));
}

export function getClassAnnouncementsByClassroom() {
  return readStoredAnnouncements();
}

export function addClassAnnouncement(announcement) {
  const classroomId = Number(announcement?.classroomId);
  if (!Number.isFinite(classroomId)) {
    return;
  }

  const announcementsByClassroom = readStoredAnnouncements();
  const currentList = announcementsByClassroom[classroomId] || [];
  const nextAnnouncement = {
    id: announcement.id || `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    classroomId,
    classroomName: announcement.classroomName || 'Class',
    message: String(announcement.message || '').trim(),
    createdAt: announcement.createdAt || new Date().toISOString(),
    authorName: announcement.authorName || 'Teacher'
  };

  if (!nextAnnouncement.message) {
    return;
  }

  announcementsByClassroom[classroomId] = [nextAnnouncement, ...currentList].slice(0, 20);
  writeStoredAnnouncements(announcementsByClassroom);
}
