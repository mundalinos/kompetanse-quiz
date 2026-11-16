const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/**
 * Pick `perGoal` random questions for every goal that has questions in the bank,
 * so one quiz round covers every learning goal.
 */
export function buildQuiz(curriculum, bank, perGoal) {
  const byGoal = new Map();
  for (const q of bank) {
    if (!byGoal.has(q.goalId)) byGoal.set(q.goalId, []);
    byGoal.get(q.goalId).push(q);
  }

  const goals = curriculum.goals.map((g) => ({ id: g.id, text: g.text }));
  const questions = shuffle(
    curriculum.goals.flatMap((goal) => shuffle(byGoal.get(goal.id) ?? []).slice(0, perGoal)),
  ).map((q, i) => {
    const options = shuffle([q.correct, ...q.wrong]);
    return {
      id: i + 1,
      goalId: q.goalId,
      prompt: q.question,
      options,
      answerIndex: options.indexOf(q.correct),
      explanation: q.explanation,
    };
  });

  const untestedGoals = goals.filter((g) => !byGoal.has(g.id));
  return { goals, questions, untestedGoals };
}
