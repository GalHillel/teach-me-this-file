# Pilot with 3 to 5 learners

A protocol for watching real people learn with the app, with a simple comparison. It has not been run yet; there are no results in this repository. Five people cannot show that the app improves learning. The pilot can show where people get confused, which help works, whether they trust what the app says about their understanding, and whether learning with the app looks different from reading the same kind of document alone.

## What it should answer

1. Where do learners get stuck, and does the tutor notice?
2. Which kinds of help lead to a right answer on the next try, and how often does the tutor give the same help twice?
3. Does the tutor move on when the learner has not shown the step (in the observer's judgement)?
4. Does the learner agree with what the app says about each step ("shown on your own", "shown with help", "worth another look")?
5. On new questions right after the session, do learners do better on the topic they learned with the app than on the topic they read alone? With five people this is a direction to look at, not a result.
6. Is the pace right: too many questions, too few, replies too long?

## Design

Each participant learns two short topics in the same language: one with the app, one by reading the document alone for the same time. Which topic goes with which condition, and which comes first, alternates between participants:

| Code | First | Second |
| --- | --- | --- |
| P1 | Topic A with the app | Topic B, reading |
| P2 | Topic A, reading | Topic B with the app |
| P3 | Topic B with the app | Topic A, reading |
| P4 | Topic B, reading | Topic A with the app |
| P5 | as P1 | |

English topics: A is [sound.md](sound.md), B is [heat.md](heat.md). Hebrew topics: A is [friction.md](friction.md), B is [floating.md](floating.md).

If there is time for a third arm, a basic chat (any chat assistant, given the document and the prompt "Teach me this document. Ask me one question at a time.") can replace reading alone for some participants. Write down which tool it was.

## Participants and data

- 3 to 5 adults (18 or older). University students or colleagues who have not studied these topics recently.
- Each gets a code (P1 to P5). No names, emails, ages, schools or recordings are written down. If someone wants a recording, ask first and keep only the screen, not the face or voice.
- Use the app with a lesson started on a fresh browser profile, and clear the tab afterwards. The app keeps the lesson only in that tab's session storage and sends nothing to a database.
- Tell each person: this tests the app, not them; they can stop at any time; their notes will be summarised without their name. Keep the paper sheets with the code only, and destroy them after the summary is written.

## Material

- Teacher prompts: "Teach how sound travels to an adult beginner. Short explanations, one question at a time." / "Teach why metal feels cold to an adult beginner. Short explanations, one question at a time." / "למד מבוגר מתחיל על חיכוך. הסברים קצרים, שאלה אחת בכל פעם." / "למד מבוגר מתחיל למה דברים צפים. הסברים קצרים, שאלה אחת בכל פעם."
- The live app with the site key, or the participant's own key. If the model is unavailable, stop the app session and run it another day; the offline demo (`npm run demo`) is not a substitute, because its replies are scripted.

## Questions written before the sessions

Asked on paper, without the app and without the document. The before and after questions are different, so a better score is not memory of the question. Each topic has two comprehension and two transfer questions per side.

**Sound**

| | Before | After |
| --- | --- | --- |
| Comprehension | What has to happen for an object to make a sound? | Why does a bell stop ringing when you hold it in your hand? |
| Comprehension | Why can't sound travel through space? | Why could astronauts on the Moon not hear each other without radios? |
| Transfer | Does sound travel faster in water or in air? Why? | You knock on a long metal fence and a friend listens at the far end, once with an ear on the fence and once in the air. Which does the friend hear first, and why? |
| Transfer | A ringing phone is put in a jar and the air is pumped out. What happens to the sound, and why? | Why is it quiet on a spacewalk even near a running machine? |

**Why metal feels cold**

| | Before | After |
| --- | --- | --- |
| Comprehension | Which way does heat move between two objects that touch? | Why does your hand feel cold when you hold an ice cube? |
| Comprehension | What is the difference between a conductor and an insulator? | Is wool a conductor or an insulator? How do you know? |
| Transfer | A metal bench and a wooden bench stand in the same park in winter. Which feels colder to sit on, and why? | Why do cooking pots often have plastic or wooden handles? |
| Transfer | Why does a down jacket keep you warm? | Why do double windows, with air between two panes, keep a house warmer? |

**חיכוך**

| | לפני | אחרי |
| --- | --- | --- |
| הבנה | מה זה חיכוך, ולאיזה כיוון הוא פועל? | למה מכונית צעצוע שדוחפים על השטיח נעצרת? |
| הבנה | למה קל יותר להחליק על קרח מאשר על מדרכה? | למה מניחים שטיחון מחוספס ליד המקלחת? |
| העברה | למה הבלמים של אופניים מתחממים אחרי ירידה ארוכה? | למה גפרור נדלק כשמשפשפים אותו על הקופסה? |
| העברה | למה מוסיפים שמן למנוע של מכונית? | למה מורחים שעווה על מגלשיים? |

**למה דברים צפים**

| | לפני | אחרי |
| --- | --- | --- |
| הבנה | מה המים עושים לחפץ שמכניסים לתוכם? | למה כדור ים שלוחצים מתחת למים קופץ למעלה כשעוזבים אותו? |
| הבנה | למה אבן שוקעת וחתיכת עץ צפה? | למה נר שעווה צף במים? |
| העברה | איך ספינה מברזל יכולה לצוף? | למה סירה שנקרעה ומתמלאת מים מתחילה לשקוע? |
| העברה | למה קל יותר לצוף בים מאשר בבריכה? | ביצה שוקעת בכוס מים. מה יקרה אם נמיס בכוס הרבה מלח, ולמה? |

Score each answer 0 (wrong or empty), 1 (part of the idea) or 2 (the idea and the reason). Two people score the answers separately, without knowing which condition the answer came from, before comparing. If that is not possible, say so in the results.

## Session (about 45 minutes)

1. Consent and explanation (3 minutes).
2. Before-questions for both topics on paper (6 minutes).
3. First topic in its condition (12 minutes). With the app, ask the person to think aloud: what they are thinking, what is confusing, what they expect the tutor to do. Do not help them. If they ask you a question, answer "What would you try?". Reading alone: the same 12 minutes with the document, no other help.
4. Second topic in the other condition (12 minutes).
5. After-questions for both topics on paper (6 minutes), right after the second topic.
6. Questionnaire and a short interview about the app (6 minutes).

## What the observer writes during the app session

One row per tutor turn:

| Time | Step | What the learner wrote (short) | Tutor move, help shown and the "why" line | Learner said aloud | Confused? (y/n, about what) | Moved on without the learner showing the step? (y/n) | Next answer right? |
| --- | --- | --- | --- | --- | --- | --- | --- |

Also note:

- Help repeated in the same words, or the same kind of help twice in a row.
- Recovery: after a wrong answer, how many turns until a right one, and what helped.
- Any grade the learner disagreed with ("but I said that"), and any reply that ignored what they wrote.
- Whether the learner looked at the plan or the learning map, and what they said about the step states.
- Any moment they reread the document, and whether they used Hint, Explain differently, or a question of their own.

## Questionnaire (1 = disagree, 5 = agree)

1. The tutor understood what I wrote.
2. When the tutor said my answer was right or wrong, I agreed.
3. The hints helped me find the answer myself.
4. What the app said about each step ("on your own", "with help", "worth another look") matched how well I understood it.
5. The explanations were clear.
6. The pace was right (not too slow, not too fast).
7. For this kind of document, I would rather learn with the app than read it alone.

## Interview (about 4 minutes)

1. "When did the tutor seem to not listen to you?"
2. "Was there a moment the app said you understood something you did not, or the opposite?"
3. "Compare the two topics: which one do you think you understand better now, and why?"
4. "What would you change first?"

## Summary to write afterwards

- A table per participant: condition per topic, before and after scores per topic, number of tutor turns, help shown, right answers without help, final-check results and step states from the app's summary.
- For each participant, the after-minus-before change on the app topic and on the reading topic. Report every participant's numbers; with five people, do not average them into one figure or test for significance.
- Counts across participants: confusions by step, moves on without the learner showing the step, help repeated, grades the learner disagreed with, step states the learner disagreed with.
- Three to five concrete examples, quoted from the notes, with the participant code only.
- What the pilot cannot show: five people, two topics, one short session and no delayed test. Topic difficulty is mixed with condition for each person; alternating the pairings only balances it across people. Any difference is a reason for a larger study, not a result.
