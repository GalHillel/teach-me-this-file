const photosynthesis = `# Photosynthesis

Plants make their own food. This process is called photosynthesis. It happens mostly in the leaves.

## What goes in

Leaves take in carbon dioxide from the air through tiny openings called stomata. Roots take in water from the soil, and the water travels up the stem to the leaves.

## Chlorophyll and light

Inside the leaf cells are chloroplasts. They contain chlorophyll, a green pigment that absorbs light. Chlorophyll absorbs mostly red and blue light and reflects green light, which is why leaves look green.

## What comes out

Using the energy of light, the plant turns carbon dioxide and water into glucose, a kind of sugar, and oxygen. The plant uses glucose for energy and to grow. Oxygen leaves the leaf through the stomata.

The word equation is: carbon dioxide + water → glucose + oxygen.

## Why it matters

Almost all the oxygen in the air comes from photosynthesis, and the food chains on land start with plants. Without photosynthesis, animals would have nothing to eat and no air to breathe.
`;

const waterCycle = `# מחזור המים

מחזור המים הוא התנועה המתמדת של המים בין הים, האוויר והיבשה. המים לא נעלמים: הם רק משנים מקום ומצב צבירה.

## אידוי

השמש מחממת את המים בים, באגמים ובנהרות. המים מתאדים והופכים לאדי מים, גז שעולה לאוויר. גם צמחים משחררים אדי מים דרך העלים.

## עיבוי ועננים

כשאדי המים עולים גבוה, האוויר קר יותר. האדים מתקררים ומתעבים לטיפות זעירות, ומהטיפות האלה נוצרים עננים. תהליך זה נקרא עיבוי.

## משקעים

כשהטיפות בענן מתחברות ונעשות כבדות, הן נופלות לארץ כמשקעים: גשם, שלג או ברד.

## חזרה לים

חלק מהמים זורמים בנחלים ובנהרות חזרה לים. חלק מחלחלים לאדמה והופכים למי תהום. בסוף המים חוזרים לים, והמחזור מתחיל מחדש.
`;

export const SAMPLES = [
  { id: 'photosynthesis', language: 'en', title: 'Photosynthesis', fileName: 'photosynthesis.md', text: photosynthesis },
  { id: 'water-cycle', language: 'he', title: 'מחזור המים', fileName: 'water-cycle.md', text: waterCycle },
];

export const sampleFile = (sample) => new File([sample.text], sample.fileName, { type: 'text/markdown' });
