export class ExtractionError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export const UNREADABLE_CHAR = /[\uE000-\uF8FF\uFFFD]/gu;

export const unreadableRatio = (text) => {
  if (!text) return 0;
  return (text.match(UNREADABLE_CHAR)?.length ?? 0) / text.length;
};
