const RTL_LETTER = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\uFB1D-\uFDFF\uFE70-\uFEFF]/gu;
const LETTER = /\p{L}/gu;
const RTL_LANGUAGES = new Set(['he', 'iw', 'ar', 'fa', 'ur', 'yi', 'ps', 'dv', 'ckb', 'syr']);
const HEBREW_WORD = /^[א-ת]+$/u;
const HEBREW_PREFIXES = new Set(['ו', 'ה', 'ב', 'ל', 'מ', 'ש', 'כ']);

export const detectDirection = (text) => {
  const letters = text.match(LETTER)?.length ?? 0;
  if (letters === 0) return 'ltr';
  const rtlLetters = text.match(RTL_LETTER)?.length ?? 0;
  return rtlLetters / letters > 0.3 ? 'rtl' : 'ltr';
};

export const directionForLanguage = (languageCode) => {
  const base = String(languageCode || '').toLowerCase().split(/[-_]/)[0];
  return RTL_LANGUAGES.has(base) ? 'rtl' : 'ltr';
};

const normalize = (text) =>
  String(text || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

export const tokenize = (text) =>
  (normalize(text).match(/[\p{L}\p{N}]+(?:[.,]\p{N}+)*/gu) ?? [])
    .map((token) => token.replace(/,/g, '.'))
    .filter((token) => /\p{N}/u.test(token) || token.length >= 3);

const STOPWORD_TEXT = `
a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing done down during each few for from further had has have having he her here hers him his how i if in into is it its itself just let lets like me more most my no nor not now of off on once only or other our ours out over own same she should so some such than that the their theirs them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself
yes okay ok right correct exactly great good nice well done wow really sure maybe think thinking thought idea ideas try tried answer answers question questions remember step steps next first last move let's together already know tell words word own ready moment again look see make makes made get gets got go goes going come take takes use uses used one two new much many way thing things something anything everything someone people time keep still even ever back give gives part parts say says said mean means kind lot bit quite almost close nearly perfect spot fantastic awesome amazing super totally definitely absolutely brilliant excellent job work working
le la les un une des de du et ou mais donc car est sont etre avoir as ont il elle ils elles on nous vous tu je me te se ce cet cette ces que qui quoi quel quelle quels quelles pourquoi comment quand dans sur sous avec sans pour par au aux ne pas plus moins tres bien bravo exactement oui non ton ta tes mon ma mes son sa ses leur leurs alors comme aussi tout tous toute toutes encore deja fait faire peux peut pense penses idee reponse question etape suivante continue prends temps dis retenu ici presque bonne bon juste
el los las una unos unas del y o pero porque es son ser estar tiene tienen lo le les se que como cuando donde por para con sin muy bien si no mas menos tu yo
של את על עם זה זו זאת עושה עושות עושים עשה עשתה עשו לעשות הוא היא הם הן אני אתה אתן אתם אנחנו מה למה איך איפה מתי כי אם גם רק כל יש אין לא כן אבל או עוד כבר מאוד היום נכון יופי הכבוד בוא נחשוב ביחד שאלה מצוינת לדעתך חושב חושבת יודע יודעת תשובה קצת מי הזה הזאת אלה האלה היה היו יהיה להיות שלך שלי שלנו עכשיו אחרי לפני כמעט בדיוק ספר תגיד דבר הדבר עד מעניין למדת נעצור רגע התמדה ההתמדה במילים עכשיו
`;

const STOPWORDS = new Set(tokenize(STOPWORD_TEXT));

const hebrewVariants = (token) => {
  const variants = [];
  let current = token;
  for (let i = 0; i < 2 && current.length > 3 && HEBREW_PREFIXES.has(current[0]); i += 1) {
    current = current.slice(1);
    if (!STOPWORDS.has(current)) variants.push(current);
  }
  return variants;
};

const LATIN_WORD = /^[a-z]+$/;

const latinVariants = (token) => {
  if (token.length < 4 || !LATIN_WORD.test(token)) return [];
  const variants = [];
  if (token.endsWith('ies') && token.length > 4) variants.push(`${token.slice(0, -3)}y`);
  else if ((token.endsWith('s') || token.endsWith('x')) && !token.endsWith('ss')) variants.push(token.slice(0, -1));
  if (token.endsWith('ing') && token.length > 5) variants.push(token.slice(0, -3));
  if (token.endsWith('ed') && token.length > 4) variants.push(token.slice(0, -2), token.slice(0, -1));
  return variants.filter((variant) => variant.length >= 3 && !STOPWORDS.has(variant));
};

export const TERM_OPTIONS = { hebrew: true, latin: false, sectionWeight: 0 };

export const termGroups = (text, options = TERM_OPTIONS) =>
  tokenize(text)
    .filter((token) => !STOPWORDS.has(token))
    .map((token) => {
      if (HEBREW_WORD.test(token)) return options.hebrew ? [token, ...hebrewVariants(token)] : [token];
      return options.latin ? [token, ...latinVariants(token)] : [token];
    });

const K1 = 1.2;
const B = 0.75;

export const buildIndex = (chunks, options = TERM_OPTIONS) => {
  const docs = chunks.map((chunk) => {
    const tf = new Map();
    let length = 0;
    const add = (groups, weight) => {
      for (const group of groups) {
        length += weight;
        for (const form of new Set(group)) tf.set(form, (tf.get(form) ?? 0) + weight);
      }
    };
    add(termGroups(chunk.text, options), 1);
    if (chunk.section && options.sectionWeight > 0) add(termGroups(chunk.section, options), options.sectionWeight);
    return { chunk, tf, length };
  });
  const df = new Map();
  for (const doc of docs) {
    for (const form of doc.tf.keys()) df.set(form, (df.get(form) ?? 0) + 1);
  }
  const averageLength = docs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(docs.length, 1) || 1;
  return { docs, df, averageLength, size: docs.length, options };
};

const idf = (index, form) => {
  const frequency = index.df.get(form) ?? 0;
  return frequency ? Math.log(1 + (index.size - frequency + 0.5) / (frequency + 0.5)) : 0;
};

const uniqueGroups = (groups) => {
  const seen = new Set();
  return groups.filter((group) => {
    if (seen.has(group[0])) return false;
    seen.add(group[0]);
    return true;
  });
};

export const scoreChunks = (query, index) => {
  const groups = uniqueGroups(termGroups(query, index.options));
  const known = groups.filter((group) => group.some((form) => index.df.has(form)));
  const groupWeight = (group) => Math.max(...group.map((form) => idf(index, form)));
  const totalWeight = known.reduce((sum, group) => sum + groupWeight(group), 0);
  const unknownWeight = (groups.length - known.length) * Math.log(1 + (index.size + 0.5) / 0.5);
  const queryWeight = totalWeight + unknownWeight;

  return index.docs.map((doc) => {
    let score = 0;
    let matchedWeight = 0;
    let shared = 0;
    for (const group of known) {
      const hits = group.filter((form) => doc.tf.has(form));
      if (hits.length === 0) continue;
      shared += 1;
      const best = Math.max(...hits.map((form) => idf(index, form)));
      const tf = Math.max(...hits.map((form) => doc.tf.get(form)));
      score += best * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.length) / index.averageLength)));
      matchedWeight += best;
    }
    return {
      chunk: doc.chunk,
      score,
      shared,
      coverage: totalWeight ? matchedWeight / totalWeight : 0,
      queryCoverage: queryWeight ? matchedWeight / queryWeight : 0,
    };
  });
};

export const rankChunks = (query, chunks, { limit = 2, minScore = 0.15, minShared = 3 } = {}) =>
  scoreChunks(query, buildIndex(chunks))
    .filter((match) => match.shared >= minShared && match.coverage >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ chunk, coverage, shared, score }) => ({ chunk, score: coverage, shared, rank: score }));

export const contentWordCount = (text) => termGroups(text).length;

export const isStopword = (token) => STOPWORDS.has(token);
