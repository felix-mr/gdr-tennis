export const GUEST_IDS = Array.from({ length: 8 }, (_, i) => `guest${String(i + 1).padStart(3, '0')}`);
export const GUEST_STRENGTH = 0.65;
export const normalizeGuestName = value => String(value).normalize('NFC').trim().replace(/\s+/g, ' ');

export function validateGuests(guests = {}) {
  if (!guests || typeof guests !== 'object' || Array.isArray(guests)) throw new Error('게스트 이름을 확인해 주세요.');
  const entries = Object.entries(guests);
  for (const [id, profile] of entries) {
    if (!GUEST_IDS.includes(id) || !profile || typeof profile !== 'object' || Array.isArray(profile) || Object.keys(profile).length !== 1 || typeof profile.name !== 'string' || !profile.name.length || profile.name.length > 12 || normalizeGuestName(profile.name) !== profile.name || /[\u0000-\u001f\u007f]/.test(profile.name)) throw new Error('게스트 이름은 1~12자로 입력해 주세요.');
  }
  if (new Set(entries.map(([, profile]) => profile.name)).size !== entries.length) throw new Error('같은 게스트 이름이 이미 있습니다.');
  return guests;
}

export function sessionNames(session, memberNames) {
  return { ...memberNames, ...Object.fromEntries(Object.entries(session.guests || {}).map(([id, profile]) => [id, profile.name])) };
}
