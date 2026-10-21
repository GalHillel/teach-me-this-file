const PATHS = {
  upload: 'M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5',
  close: 'M6 6l12 12M18 6 6 18',
  key: 'M15 7a3 3 0 1 1 0 .01M13.2 9.8 4 19v2h3v-2h2v-2h2l2.2-2.2A5 5 0 1 0 13.2 9.8Z',
  send: 'M5 12h13m0 0-5-5m5 5-5 5',
  stop: 'M7 7h10v10H7z',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  back: 'M19 12H6m0 0 5-5m-5 5 5 5',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  alert: 'M12 8v5m0 3.5h.01M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  retry: 'M4 12a8 8 0 0 1 14-5.3M20 4v4h-4M20 12a8 8 0 0 1-14 5.3M4 20v-4h4',
  quote: 'M7 7h4v4c0 3-1.5 5-4 6M14 7h4v4c0 3-1.5 5-4 6',
  eye: 'M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Zm9.5 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  eyeOff: 'M3 3l18 18M10.6 5.1A9 9 0 0 1 12 5c6 0 9.5 7 9.5 7a15 15 0 0 1-2.7 3.4M6.6 6.6C3.9 8.3 2.5 12 2.5 12S6 19 12 19a9 9 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2',
};

export default function Icon({ name, className = 'size-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
