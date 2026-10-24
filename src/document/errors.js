export class ExtractionError extends Error {
  constructor(code, message, params = {}) {
    super(message);
    this.code = code;
    this.params = params;
  }
}

export const UNREADABLE_CHAR = /[\uE000-\uF8FF\uFFFD]/gu;

export const unreadableRatio = (text) => {
  if (!text) return 0;
  return (text.match(UNREADABLE_CHAR)?.length ?? 0) / text.length;
};
