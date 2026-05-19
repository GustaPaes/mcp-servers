function hasDeadline(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function analyzeSmartGoal(goal) {
  const title = String(goal?.title ?? "").trim();
  const smart = goal?.smart ?? {};
  const measurable = String(smart.measurable ?? "").trim();
  const specific = String(smart.specific ?? "").trim();
  const relevant = String(smart.relevant ?? "").trim();
  const achievable = String(smart.achievable ?? "").trim();
  const timeBound = String(smart.timeBound ?? goal?.dueDate ?? "").trim();

  const strengths = [];
  const gaps = [];
  let score = 0;

  if (title.length >= 12 && specific.length >= 20) {
    strengths.push("Meta especifica o bastante para virar execucao.");
    score += 20;
  } else {
    gaps.push("Deixe a meta menos generica e explicite o que sera entregue.");
  }

  if (/\d|%|adr|pr|workflow|teste|cobertura|build/i.test(`${title} ${measurable}`)) {
    strengths.push("Meta tem criterio observavel de medicao.");
    score += 20;
  } else {
    gaps.push("Inclua medida objetiva: quantidade, porcentagem, entrega ou marco verificavel.");
  }

  if (achievable.length >= 15) {
    strengths.push("Meta contextualiza por que e atingivel.");
    score += 20;
  } else {
    gaps.push("Explique por que a meta e atingivel no contexto atual.");
  }

  if (relevant.length >= 15) {
    strengths.push("Meta esta conectada ao papel alvo e ao negocio.");
    score += 20;
  } else {
    gaps.push("Conecte a meta ao papel alvo, ao time ou ao foco da empresa.");
  }

  if (hasDeadline(timeBound)) {
    strengths.push("Meta possui prazo explicito.");
    score += 20;
  } else {
    gaps.push("Defina um prazo claro para conclusao.");
  }

  return {
    score,
    strengths,
    gaps,
  };
}
