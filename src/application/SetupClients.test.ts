import { describe, expect, it } from "vitest";

import { failedConfigurationMessage } from "./SetupClients.js";

describe("setup configuration failure messages", () => {
  it("explains an uninspectable private MSIX configuration with its diagnosis", () => {
    const message = failedConfigurationMessage({
      status: "failed",
      reason: "private_storage_uninspectable",
      detail: "/packages/Claude/LocalCache/Roaming/Claude/config.json: EPERM",
    });
    expect(message).toContain(
      "/packages/Claude/LocalCache/Roaming/Claude/config.json",
    );
    expect(message).toContain("EPERM");
    expect(message).toContain("Repair access");
    expect(message).not.toContain("different configuration file");
  });

  it("still reports a genuine changed target", () => {
    expect(
      failedConfigurationMessage({
        status: "failed",
        reason: "target_changed",
      }),
    ).toContain("began reading a different configuration file");
  });
});
