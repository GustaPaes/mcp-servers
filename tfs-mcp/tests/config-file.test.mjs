import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("loads reusable non-secret settings from a versioned local config", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tfs-config-"));
  const file = path.join(directory, "tfs.json");
  await fs.writeFile(file, JSON.stringify({
    schemaVersion: 1,
    connection: {
      url: "https://tfs.example.test",
      collection: "Collection",
      project: "Project",
      repositories: ["repo-a", "repo-b"],
    },
    workItemProfiles: {
      "User Story": {
        businessField: "System.Description",
        technicalField: "Microsoft.VSTS.Common.AcceptanceCriteria",
      },
    },
    savedQueries: {
      my_day: "SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me",
    },
  }), "utf8");

  try {
    const output = execFileSync(process.execPath, [
      "--input-type=module",
      "-e",
      "import('./src/config.js').then((m) => console.log(JSON.stringify(m.getConfigurationSummary())))",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        TFS_MCP_CONFIG_FILE: file,
        TFS_URL: "",
        TFS_COLLECTION: "",
        TFS_PROJECT: "",
        TFS_REPOS: "",
        TFS_REPO: "",
        TFS_REPOSITORY: "",
        TFS_WORK_ITEM_PROFILES_JSON: "",
      },
    });
    const summary = JSON.parse(output.trim());
    assert.equal(summary.configFileLoaded, true);
    assert.deepEqual(summary.repositories, ["repo-a", "repo-b"]);
    assert.deepEqual(summary.savedQueries, ["my_day"]);
    assert.deepEqual(summary.workItemProfiles, ["User Story"]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
