const FIELD_REFERENCE_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/;

const DEFAULT_PROFILE = Object.freeze({
  businessField: "System.Description",
  technicalField: "Microsoft.VSTS.Common.AcceptanceCriteria",
  defaults: Object.freeze({}),
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function interpolateValue(value, variables) {
  if (typeof value === "string") {
    return value.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (match, name) =>
      Object.hasOwn(variables, name) ? String(variables[name]) : match
    );
  }
  if (Array.isArray(value)) return value.map((item) => interpolateValue(item, variables));
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, interpolateValue(item, variables)])
    );
  }
  return value;
}

export function validateFieldReferenceName(value, context = "field") {
  const field = String(value ?? "").trim();
  if (!FIELD_REFERENCE_PATTERN.test(field)) {
    throw new Error(
      `${context} deve usar o reference name do campo (ex.: Custom.BusinessValue).`
    );
  }
  return field;
}

export function validateCustomFields(fields, context = "custom_fields") {
  if (fields === undefined || fields === null) return {};
  if (!isPlainObject(fields)) throw new Error(`${context} deve ser um objeto JSON.`);

  return Object.fromEntries(
    Object.entries(fields).map(([field, value]) => {
      const referenceName = validateFieldReferenceName(field, `${context}.${field}`);
      if (value === undefined) {
        throw new Error(`${context}.${referenceName} não pode ter valor undefined.`);
      }
      return [referenceName, value];
    })
  );
}

export function parseWorkItemProfiles(rawProfiles, { variables = {} } = {}) {
  if (rawProfiles === undefined || rawProfiles === null || rawProfiles === "") {
    return Object.freeze({});
  }

  let parsed = rawProfiles;
  if (typeof rawProfiles === "string") {
    try {
      parsed = JSON.parse(rawProfiles);
    } catch (error) {
      throw new Error(`TFS_WORK_ITEM_PROFILES_JSON contém JSON inválido: ${error.message}`);
    }
  }

  if (!isPlainObject(parsed)) {
    throw new Error("TFS_WORK_ITEM_PROFILES_JSON deve ser um objeto indexado pelo tipo do work item.");
  }

  const normalized = {};
  const normalizedNames = new Set();

  for (const [rawType, rawProfile] of Object.entries(parsed)) {
    const workItemType = String(rawType ?? "").trim();
    if (!workItemType) throw new Error("O nome do tipo de work item não pode ser vazio.");
    const lookupName = workItemType.toLocaleLowerCase("en-US");
    if (normalizedNames.has(lookupName)) {
      throw new Error(`Tipo de work item duplicado no perfil: ${workItemType}.`);
    }
    normalizedNames.add(lookupName);

    if (!isPlainObject(rawProfile)) {
      throw new Error(`O perfil '${workItemType}' deve ser um objeto JSON.`);
    }

    const businessField = rawProfile.businessField
      ? validateFieldReferenceName(
          rawProfile.businessField,
          `TFS_WORK_ITEM_PROFILES_JSON.${workItemType}.businessField`
        )
      : DEFAULT_PROFILE.businessField;
    const technicalField = rawProfile.technicalField
      ? validateFieldReferenceName(
          rawProfile.technicalField,
          `TFS_WORK_ITEM_PROFILES_JSON.${workItemType}.technicalField`
        )
      : DEFAULT_PROFILE.technicalField;
    const defaults = validateCustomFields(
      rawProfile.defaults,
      `TFS_WORK_ITEM_PROFILES_JSON.${workItemType}.defaults`
    );

    normalized[workItemType] = Object.freeze({
      businessField,
      technicalField,
      defaults: Object.freeze(interpolateValue(defaults, variables)),
    });
  }

  return Object.freeze(normalized);
}

export function getWorkItemProfile(profiles, workItemType) {
  const lookupName = String(workItemType ?? "").trim().toLocaleLowerCase("en-US");
  if (!lookupName) return DEFAULT_PROFILE;

  const entry = Object.entries(profiles ?? {}).find(
    ([type]) => type.toLocaleLowerCase("en-US") === lookupName
  );
  return entry?.[1] ?? DEFAULT_PROFILE;
}

export function getProfileFieldNames(profiles) {
  const fields = new Set();
  for (const profile of Object.values(profiles ?? {})) {
    if (profile.businessField) fields.add(profile.businessField);
    if (profile.technicalField) fields.add(profile.technicalField);
    for (const field of Object.keys(profile.defaults ?? {})) fields.add(field);
  }
  return [...fields];
}
