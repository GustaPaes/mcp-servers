export const CAREER_LADDER = {
  junior: {
    role: "Analista Desenvolvedor Junior",
    expectations: [
      "Executa tarefas com orientacao e segue padroes do time.",
      "Expande repertorio tecnico em componentes e fluxos conhecidos.",
      "Aprende a decompor tarefas e comunicar riscos cedo.",
    ],
  },
  pleno: {
    role: "Analista Desenvolvedor Pleno",
    expectations: [
      "Entrega features completas com autonomia operacional.",
      "Contribui em refinamentos e code review com contexto tecnico.",
      "Assume ownership de modulos e melhora qualidade continuamente.",
    ],
  },
  senior: {
    role: "Analista Desenvolvedor Senior",
    expectations: [
      "Lidera decisoes arquiteturais e reduz ambiguidade tecnica.",
      "Cria alavancas de produtividade e qualidade para o time.",
      "Mentora pares, influencia backlog e conecta tecnologia ao negocio.",
    ],
  },
  staff: {
    role: "Staff Engineer",
    expectations: [
      "Resolve problemas sistemicos cross-team.",
      "Define padroes organizacionais e eleva a barra tecnica da engenharia.",
      "Conecta estrategia, arquitetura e desenvolvimento de pessoas.",
    ],
  },
};

export function normalizeRoleKey(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized.includes("staff")) return "staff";
  if (normalized.includes("senior") || normalized.includes("sênior")) return "senior";
  if (normalized.includes("pleno")) return "pleno";
  if (normalized.includes("junior") || normalized.includes("júnior")) return "junior";
  return "pleno";
}

export function getCareerRole(value) {
  return CAREER_LADDER[normalizeRoleKey(value)] ?? CAREER_LADDER.pleno;
}
