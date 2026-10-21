import { AppError } from './errors.js';

const WINDOW_MS = 60000;

export const rateLimit = ({ perMinute }) => {
  const hits = new Map();

  return (req, res, next) => {
    const now = Date.now();
    for (const [ip, entry] of hits) {
      if (now - entry.start > WINDOW_MS) hits.delete(ip);
    }
    const entry = hits.get(req.ip) ?? { start: now, count: 0 };
    entry.count += 1;
    hits.set(req.ip, entry);
    if (entry.count > perMinute) {
      res.set('Retry-After', String(Math.ceil((entry.start + WINDOW_MS - now) / 1000)));
      next(new AppError('too_many_requests'));
      return;
    }
    next();
  };
};
