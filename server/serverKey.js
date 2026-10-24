export const isSameOrigin = (req) => {
  const site = req.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = req.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === req.get('host');
  } catch {
    return false;
  }
};

export const createServerKeyBudget = (dailyLimit, now = () => new Date()) => {
  let day = '';
  let used = 0;
  return {
    take() {
      const today = now().toISOString().slice(0, 10);
      if (today !== day) {
        day = today;
        used = 0;
      }
      if (used >= dailyLimit) return false;
      used += 1;
      return true;
    },
  };
};
