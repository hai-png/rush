const ET_PHONE_RE = /^\+251(9|7)\d{8}$/;

export const EthiopianPhone = {
  isValid(input: string): boolean {
    return ET_PHONE_RE.test(input);
  },
  normalize(input: string): string {
    let s = input.trim();
    s = s.replace(/[\s\-()]/g, '');
    // 09XXXXXXXX -> +2519XXXXXXXX
    if (/^0?(9|7)\d{8}$/.test(s)) {
      return `+251${s.replace(/^0/, '')}`;
    }
    // 2519XXXXXXXX -> +2519XXXXXXXX
    if (/^251(9|7)\d{8}$/.test(s)) {
      return `+${s}`;
    }
    if (ET_PHONE_RE.test(s)) return s;
    throw new Error(`Invalid Ethiopian phone: ${input}`);
  },
};

export function isValidPhone(input: string): boolean {
  try { EthiopianPhone.normalize(input); return true; } catch { return false; }
}
