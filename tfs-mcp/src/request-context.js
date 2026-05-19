import { AsyncLocalStorage } from "async_hooks";

const storage = new AsyncLocalStorage();

export function runWithRequestContext(context, fn) {
  return storage.run(
    {
      authAlias: typeof context?.authAlias === "string" ? context.authAlias.trim() : "",
      repo: typeof context?.repo === "string" ? context.repo.trim() : "",
    },
    fn
  );
}

export function getRequestContext() {
  return storage.getStore() ?? {};
}
