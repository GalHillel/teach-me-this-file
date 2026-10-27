# Pilot with 3 to 5 learners

A short session protocol for watching real people learn with the app. It has not been run yet; there are no results in this repository. Five people cannot show that the app improves learning. The pilot can show where people get confused, which help works, whether they trust the grades, and whether the tutor seems to read what they wrote.

## What it should answer

1. Where do learners get stuck, and does the tutor notice?
2. Which kinds of help (nudge, focused hint, counter-example, sub-question, worked example) lead to a right answer on the next try?
3. How often does a learner answer right without any help?
4. Do learners trust the grade? Do they feel the tutor responded to their answer and not to a script?
5. Is the pace right: too many questions, too few, replies too long?

## Participants

- 3 to 5 adults (18 or older), so no parental consent is needed. University students or colleagues who have not studied the topic recently.
- Each gets a code (P1 to P5). No names, emails, ages, schools or recordings are written down. If someone wants a recording, ask first and keep only the screen, not the face or voice.
- Tell each person: this tests the app, not them; they can stop at any time; their notes will be summarised without their name.

## Material

- English: [sound.md](sound.md) (how sound travels). Hebrew: [friction.md](friction.md) (חיכוך). Each person uses one, in the language they are most comfortable with.
- Teacher prompt: "Teach how sound travels to an adult beginner. Short explanations, one question at a time." / "למד מבוגר מתחיל על חיכוך. הסברים קצרים, שאלה אחת בכל פעם."
- The live app with the site key, or the participant's own key. If the model is unavailable, stop the session; the offline demo (`npm run demo`) is not a substitute, because its replies are scripted.

## Questions written before the sessions

Asked on paper (or a plain form) before and after the lesson, without the app and without the document. The before and after versions differ, so a better score is not just memory of the question.

**Sound (English)**

| | Before | After |
| --- | --- | --- |
| Comprehension | What has to happen for an object to make a sound? | Why does a bell stop ringing when you hold it in your hand? |
| Comprehension | Why can't sound travel through space? | Why could astronauts on the Moon not hear each other without radios? |
| Transfer | Does sound travel faster in water or in air? Why? | You knock on a long metal fence and a friend listens at the far end, once with an ear on the fence and once in the air. Which does the friend hear first, and why? |
| Transfer | A ringing phone is put in a jar and the air is pumped out. What happens to the sound, and why? | Why is it quiet on a spacewalk even near a running machine? |

**חיכוך (Hebrew)**

| | לפני | אחרי |
| --- | --- | --- |
| הבנה | מה זה חיכוך, ולאיזה כיוון הוא פועל? | למה מכונית צעצוע שדוחפים על השטיח נעצרת? |
| הבנה | למה קל יותר להחליק על קרח מאשר על מדרכה? | למה מניחים שטיחון מחוספס ליד המקלחת? |
| העברה | למה הבלמים של אופניים מתחממים אחרי ירידה ארוכה? | למה גפרור נדלק כשמשפשפים אותו על הקופסה? |
| העברה | למה מוסיפים שמן למנוע של מכונית? | למה מורחים שעווה על מגלשיים? |

Score each answer 0 (wrong or empty), 1 (part of the idea) or 2 (the idea and the reason). Two people should score the answers separately before comparing; if that is not possible, say so in the results.

## Session (about 25 minutes)

1. Consent and explanation (2 minutes).
2. Before-questions on paper (4 minutes).
3. The lesson with the app (12 to 15 minutes). Ask the person to think aloud: say what they are thinking, what is confusing, and what they expect the tutor to do. Do not help them. If they ask you a question, answer "What would you try?".
4. After-questions on paper (4 minutes).
5. Short questionnaire and two open questions (3 minutes).

## What the observer writes during the lesson

One row per tutor turn:

| Time | Step | What the learner wrote (short) | Tutor move and help shown | Learner said aloud | Confused? (y/n, about what) | Next answer right? |
| --- | --- | --- | --- | --- | --- | --- |

Also note: any grade the learner disagreed with ("but I said that"), any reply that ignored what they wrote, any moment they reread the document, and whether they used Hint, Explain differently, or a question of their own.

## Questionnaire (1 = disagree, 5 = agree)

1. The tutor understood what I wrote.
2. When the tutor said my answer was right or wrong, I agreed.
3. The hints helped me find the answer myself.
4. The explanations were clear.
5. The pace was right (not too slow, not too fast).
6. I would use this to learn from a document.

Open questions: "When did the tutor seem to not listen to you?" and "What would you change first?"

## Summary to write afterwards

- A table per participant: before and after scores, number of turns, help shown, right answers without help, final-check results from the app's summary.
- Counts across participants: confusions by step, grades the learner disagreed with, replies that ignored the answer, help that was followed by a right answer.
- Three to five concrete examples, quoted from the notes, with the participant code only.
- What the pilot cannot show: with five people and no comparison group, a rise from before to after says nothing about whether the app teaches better than reading the document.
