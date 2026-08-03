import assert from "node:assert/strict";
import test from "node:test";
import { checkSafeEval } from "../src/safety/safe-eval.js";

test("strict evaluation blocks browser credential stores", () => {
  for (const source of [
    "() => document.cookie",
    "() => localStorage.getItem('token')",
    "() => sessionStorage.clear()",
    "() => indexedDB.databases()",
    "() => document['cookie']",
    "() => window[`localStorage`].getItem('token')",
  ]) {
    assert.equal(checkSafeEval(source).ok, false);
  }
});

test("safe page evaluation remains available", () => {
  assert.equal(checkSafeEval("(arg) => ({ title: document.title, arg })").ok, true);
});
