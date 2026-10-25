const OPENING_PRAISE = /^\s*(?:\*\*|__)?(?:great job|good job|nice work|nice job|well done|spot on|great|excellent|perfect|nice|awesome|fantastic|wonderful|brilliant|amazing|exactly|correct|bravo|super|מצוין|מצויין|מעולה|כל הכבוד|יפה מאוד|יופי|נהדר|נכון מאוד|בדיוק|מושלם|très bien|parfait|exactement|génial|excellente)(?:\*\*|__)?(?:\s+(?:job|work|thinking|try|effort|start|answer|question|point|idea))?(?:\*\*|__)?\s*[!.,:;—–-]+\s*/iu;
const DECIDED = /\p{L}[^]*?[!.,:;?\n—–]/u;
const DECIDE_AFTER = 60;

export const praiseAllowed = ({ move, assessment }) => {
  if (!assessment) return true;
  if (move === 'probe') return false;
  return assessment.verdict === 'correct';
};

export const stripOpeningPraise = (text) => {
  const match = text.match(OPENING_PRAISE);
  if (!match) return text;
  const rest = text.slice(match[0].length);
  return rest.charAt(0).toUpperCase() + rest.slice(1);
};

export const openingPraiseFilter = (active, send) => {
  let buffer = '';
  let decided = !active;
  const decide = () => {
    decided = true;
    const clean = stripOpeningPraise(buffer);
    buffer = '';
    if (clean) send(clean);
  };
  return {
    push(text) {
      if (decided) {
        send(text);
        return;
      }
      buffer += text;
      if (buffer.length >= DECIDE_AFTER || DECIDED.test(buffer)) decide();
    },
    flush() {
      if (!decided) decide();
    },
  };
};
