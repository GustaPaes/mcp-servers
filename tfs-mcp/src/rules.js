/**
 * rules.js — Regras genéricas e extensíveis de code review.
 * Funções puras. Recebem conteúdo de arquivo como string, retornam findings.
 */

// ─── Helpers ───────────────────────────────────────────────────────────────

function isTestFile(filePath) {
  return /(test|spec)\./i.test(filePath) || /Tests?\//i.test(filePath);
}

function stripComments(text) {
  return String(text ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .trim();
}

// ─── Rule definitions ──────────────────────────────────────────────────────

/** @type {Array<{ id: string, label: string, severity: "blocking"|"high"|"medium", check: (content: string, filePath: string) => string[] }>} */
export const CODE_REVIEW_RULES = [
  {
    id: "tls-validation-bypass",
    label: "TLS validation bypass",
    severity: "blocking",
    check(content, filePath) {
      if (!filePath.endsWith(".cs")) return [];
      if (
        /ServerCertificateValidationCallback\s*=\s*(?:delegate|\([^)]*\)\s*=>)\s*\{?\s*return\s+true;?\s*\}?/s.test(
          content
        )
      ) {
        return [
          "Validação de certificado foi desabilitada globalmente — abre brecha para MITM e invalida a segurança TLS",
        ];
      }
      return [];
    },
  },
  {
    id: "result-pattern",
    label: "Result Pattern",
    severity: "blocking",
    check(content, filePath) {
      if (!filePath.endsWith(".cs")) return [];
      const issues = [];
      const methodRx =
        /public\s+(?:async\s+)?Task<(?!Result<)([A-Za-z][A-Za-z0-9<>[\]?]*)>\s+(\w+Async)\s*\(/g;
      let m;
      while ((m = methodRx.exec(content)) !== null) {
        const returnType = m[1];
        const methodName = m[2];
        if (["void", "bool", "string"].includes(returnType)) continue;
        if (/Service|Consumer|Handler/i.test(filePath))
          issues.push(
            `${methodName}() retorna Task<${returnType}> — deveria retornar Task<Result<ResultException, ${returnType}>>`
          );
      }
      if (/Service|Consumer/i.test(filePath)) {
        const throwRx = /throw\s+new\s+(?!NotImplementedException)(\w+Exception)/g;
        while ((m = throwRx.exec(content)) !== null)
          issues.push(`throw new ${m[1]} detectado — preferir retornar Failure no Result Pattern`);
      }
      return issues;
    },
  },
  {
    id: "basic-nack",
    label: "RabbitMQ BasicNack",
    severity: "blocking",
    check(content, filePath) {
      if (!filePath.endsWith(".cs")) return [];
      if (!content.includes("BasicAck") && !content.includes("BackgroundService")) return [];
      const hasCatch = /catch\s*\(/.test(content);
      const hasNack = /BasicNack/.test(content);
      if (hasCatch && !hasNack)
        return ["Consumer tem catch sem BasicNack — mensagens serão perdidas silenciosamente"];
      return [];
    },
  },
  {
    id: "silent-catch",
    label: "Catch sem log",
    severity: "high",
    check(content, filePath) {
      if (!filePath.endsWith(".cs")) return [];
      const issues = [];
      const catchRx = /catch\s*(?:\([^)]*\))?\s*\{([^}]{0,300})\}/g;
      let m;
      while ((m = catchRx.exec(content)) !== null) {
        const body = m[1];
        const bodyWithoutComments = stripComments(body);
        if (!bodyWithoutComments) continue;
        if (!body.match(/[Ll]og|_logger|LogExtension/)) {
          const snippet = body.trim().slice(0, 60).replace(/\s+/g, " ");
          issues.push(`catch sem log: { ${snippet}… }`);
        }
      }
      return issues.slice(0, 3);
    },
  },
  {
    id: "redis-ttl",
    label: "Redis sem TTL",
    severity: "high",
    check(content, filePath) {
      if (!filePath.endsWith(".cs")) return [];
      const issues = [];
      const addRx = /\b\w*(?:redis|cache)\w*\.Add\(([^)]*)\)/gi;
      let m;
      while ((m = addRx.exec(content)) !== null) {
        if (!/TimeSpan|ttl|expire|expiration/i.test(m[1]))
          issues.push(`${m[0].trim()} — cache/redis sem TTL explicito, risco de chave permanente`);
      }
      if (
        /SetStringAsync\([^)]+\)/.test(content) &&
        !/SetStringAsync\([^)]+TimeSpan/.test(content)
      )
        issues.push("SetStringAsync sem TimeSpan TTL — chave nunca expira");
      return issues;
    },
  },
  {
    id: "n-plus-one",
    label: "N+1 Query",
    severity: "blocking",
    check(content, filePath) {
      if (!filePath.endsWith(".cs")) return [];
      const issues = [];
      const loopRx = /(?:foreach|for)\s*\([^{]+\)\s*\{([^}]{0,800})\}/g;
      let m;
      while ((m = loopRx.exec(content)) !== null) {
        if (/await\s+_\w*(Repository|Service|Dao|Client)\./.test(m[1]))
          issues.push("await em Repository/Service dentro de loop — padrão N+1 detectado");
      }
      return issues.slice(0, 2);
    },
  },
  {
    id: "async-void",
    label: "Async void",
    severity: "high",
    check(content, filePath) {
      if (!filePath.endsWith(".cs")) return [];
      const issues = [];
      const rx = /async\s+void\s+([A-Z]\w*)\s*\(/g;
      let m;
      while ((m = rx.exec(content)) !== null) {
        issues.push(`${m[1]}() usa async void — exceções podem escapar do fluxo e o caller não consegue aguardar`);
      }
      return issues.slice(0, 3);
    },
  },
  {
    id: "sync-over-async",
    label: "Sync over async",
    severity: "high",
    check(content, filePath) {
      if (!filePath.endsWith(".cs")) return [];
      const issues = [];
      const patterns = [
        { rx: /\.Result\b/g, label: ".Result" },
        { rx: /\.Wait\(/g, label: ".Wait()" },
        { rx: /GetAwaiter\(\)\.GetResult\(/g, label: "GetAwaiter().GetResult()" },
      ];
      for (const { rx, label } of patterns) {
        let m;
        while ((m = rx.exec(content)) !== null) {
          issues.push(`${label} detectado — sync-over-async pode bloquear thread pool e gerar deadlocks`);
        }
      }
      return issues.slice(0, 4);
    },
  },
  {
    id: "wait-confirms",
    label: "WaitForConfirmsOrDie por mensagem",
    severity: "blocking",
    check(content, filePath) {
      if (!filePath.endsWith(".cs")) return [];
      if (content.includes("WaitForConfirmsOrDie") || content.includes("WaitForConfirms")) {
        if (/(?:foreach|for|while)\s*\([^{]+\)\s*\{[^}]*WaitForConfirms/.test(content))
          return [
            "WaitForConfirmsOrDie dentro de loop — bloqueia publish e degrada throughput drasticamente",
          ];
      }
      return [];
    },
  },
  {
    id: "http-timeout",
    label: "HttpClient timeout",
    severity: "high",
    check(content, filePath) {
      if (!filePath.endsWith(".cs")) return [];
      const issues = [];
      let m;
      const minsRx = /Timeout\s*=\s*TimeSpan\.FromMinutes\(\s*(\d+)\s*\)/g;
      while ((m = minsRx.exec(content)) !== null)
        issues.push(`Timeout = ${m[1]} minuto(s) — risco de thread starvation, máximo: 30s`);
      const secsRx = /Timeout\s*=\s*TimeSpan\.FromSeconds\(\s*(\d+)\s*\)/g;
      while ((m = secsRx.exec(content)) !== null) {
        if (parseInt(m[1], 10) > 30)
          issues.push(`Timeout = ${m[1]}s — acima do máximo recomendado (30s)`);
      }
      return issues;
    },
  },
  {
    id: "async-naming",
    label: "Nomenclatura Async",
    severity: "medium",
    check(content, filePath) {
      if (!filePath.endsWith(".cs") || isTestFile(filePath)) return [];
      const issues = [];
      const rx = /public\s+(?:async\s+)?Task(?:<[^>]+>)?\s+([A-Z]\w+)\s*\(/g;
      let m;
      while ((m = rx.exec(content)) !== null) {
        if (!m[1].endsWith("Async") && !/^(Main|ExecuteAsync|StartAsync|StopAsync)$/.test(m[1]))
          issues.push(`${m[1]}() retorna Task mas não tem sufixo Async`);
      }
      return issues.slice(0, 4);
    },
  },
  {
    id: "state-mutation-in-catch",
    label: "Mutação persistente em catch",
    severity: "high",
    check(content, filePath) {
      if (!filePath.endsWith(".cs")) return [];
      const issues = [];
      const catchRx = /catch\s*(?:\([^)]*\))?\s*\{([\s\S]{0,700}?)\}/g;
      let m;
      while ((m = catchRx.exec(content)) !== null) {
        const body = m[1];
        if (/SaveChangesAsync|SaveChanges|Update\(|Remove\(|ChangeTracker\.Clear/i.test(body)) {
          issues.push("catch com mutação persistente detectado — fallback pode mascarar erro original e gravar estado inconsistente");
        }
      }
      return issues.slice(0, 2);
    },
  },
  {
    id: "bitwise-bool",
    label: "Operador bitwise em condição booleana",
    severity: "medium",
    check(content, filePath) {
      if (!filePath.endsWith(".cs")) return [];
      const issues = [];
      const rx = /if\s*\([^)\n]*\s[&|]\s[^)\n]*\)/g;
      let m;
      while ((m = rx.exec(content)) !== null) {
        if (!m[0].includes("&&") && !m[0].includes("||")) {
          issues.push(`${m[0].trim()} — usar &&/|| em vez de &/| para preservar short-circuit e legibilidade`);
        }
      }
      return issues.slice(0, 2);
    },
  },
  {
    id: "result-null-check",
    label: "Result sem null check",
    severity: "high",
    check(content, filePath) {
      if (!filePath.endsWith(".cs")) return [];
      const issues = [];
      const accessRx = /(\w+)\.(Success|Value)\b/g;
      let m;
      while ((m = accessRx.exec(content)) !== null) {
        const varName = m[1];
        if (/(Options|Configuration)$/i.test(varName)) continue;
        const around = content.slice(Math.max(0, m.index - 400), m.index);
        if (!new RegExp(`${varName}\\s*(?:==\\s*null|!=\\s*null|IsFailure|IsSuccess|\\?\\.)`).test(around))
          issues.push(`${varName}.${m[2]} acessado sem verificação prévia de null/IsFailure`);
      }
      return issues.slice(0, 3);
    },
  },
  {
    id: "hardcoded-secrets-config",
    label: "Segredo hardcoded em configuração",
    severity: "blocking",
    check(content, filePath) {
      if (!/\.(json|ya?ml|config)$/i.test(filePath) && !/appsettings/i.test(filePath)) return [];
      const issues = [];
      const rx =
        /"(Secret[^"]*|Password[^"]*|ClientSecret|Secret|Token|ConnectionString|CertificateSerialNumber)"\s*:\s*"([^"]+)"/gi;
      let m;
      while ((m = rx.exec(content)) !== null) {
        const key = m[1];
        const value = m[2].trim();
        if (!value) continue;
        if (/SERIAL_NUMBER|CHANGE_ME|YOUR_|EXAMPLE|PLACEHOLDER/i.test(value)) continue;
        issues.push(`${key} possui valor hardcoded em arquivo de configuração versionado`);
      }
      return [...new Set(issues)].slice(0, 5);
    },
  },
];

// ─── Runner ────────────────────────────────────────────────────────────────

export function runPatternChecks(content, filePath) {
  const findings = [];
  for (const rule of CODE_REVIEW_RULES) {
    try {
      for (const issue of rule.check(content, filePath))
        findings.push({ rule: rule.id, label: rule.label, severity: rule.severity, issue });
    } catch {
      /* uma regra nunca deve travar o review completo */
    }
  }
  return findings;
}

export function scoreReview(allFindings, _totalFiles) {
  let score = 10;
  for (const f of allFindings) {
    if (f.severity === "blocking") score -= 1.5;
    else if (f.severity === "high") score -= 0.7;
    else if (f.severity === "medium") score -= 0.3;
  }
  score = Math.max(0, Math.round(score * 10) / 10);
  const verdict =
    score < 5
      ? "Refatoração obrigatória"
      : score < 7
      ? "Aprovado com ressalvas"
      : score < 9
      ? "Aprovado"
      : "Excelente";
  return { score, verdict };
}
