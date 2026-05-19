function average(values) {
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

export function computePdiProgress(pdi, goals) {
  const pdiGoals = goals.filter((goal) => goal.pdiId === pdi.id);
  const allActions = pdi.developmentAreas.flatMap((area) => area.actions);
  const completedActions = allActions.filter((action) => action.status === "completed").length;
  const overdueActions = allActions.filter((action) => action.dueDate && action.status !== "completed" && action.dueDate < new Date().toISOString().slice(0, 10)).length;
  const actionProgress = allActions.length ? Number(((completedActions / allActions.length) * 100).toFixed(2)) : 0;
  const goalsProgress = average(pdiGoals.map((goal) => goal.progress));
  const completedGoals = pdiGoals.filter((goal) => goal.status === "completed").length;
  const overall = Number((((goalsProgress * 0.6) + (actionProgress * 0.4))).toFixed(2));

  return {
    overall,
    goalsProgress,
    actionProgress,
    overdueActions,
    completedGoals,
  };
}

export function projectGoalStatus(goal) {
  if (goal.status === "completed") return "on_track";
  if (goal.status === "blocked") return "blocked";
  if (goal.progress >= 70) return "on_track";
  if (goal.progress >= 30) return "attention";
  return "at_risk";
}
