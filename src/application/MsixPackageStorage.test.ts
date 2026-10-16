import { describe, expect, it } from "vitest";

import {
  packageReadTargetVerdict,
  type MsixPackageView,
} from "./MsixPackageStorage.js";

const view: MsixPackageView = {
  packageFamilyName: "Claude_pzs8sxrjxfjjc",
  privateConfigPath: "/packages/Claude/LocalCache/Roaming/Claude/config.json",
  appDataConfigPath: "/profile/AppData/Roaming/Claude/config.json",
  virtualizedRoots: ["/profile/AppData/Roaming", "/profile/AppData/Local"],
  processView: "direct",
};

const failure = (code: string): Error =>
  Object.assign(new Error(`${code}: injected`), { code });

describe("MSIX private read target recheck", () => {
  it("reports the target unchanged while the private copy is absent", async () => {
    for (const code of ["ENOENT", "ENOTDIR"])
      await expect(
        packageReadTargetVerdict(view, view.appDataConfigPath, () => {
          throw failure(code);
        }),
      ).resolves.toEqual({ kind: "unchanged" });
  });

  it("reports the target changed once the private copy exists", async () => {
    const probed: string[] = [];
    await expect(
      packageReadTargetVerdict(view, view.appDataConfigPath, (path) => {
        probed.push(path);
        return Promise.resolve({});
      }),
    ).resolves.toEqual({ kind: "changed" });
    expect(probed).toEqual([view.privateConfigPath]);
  });

  it("reports an uninspectable private copy instead of a changed target", async () => {
    const cause = failure("EPERM");
    const verdict = await packageReadTargetVerdict(
      view,
      view.appDataConfigPath,
      () => {
        throw cause;
      },
    );
    expect(verdict).toEqual({ kind: "uninspectable", cause });
  });

  it("does not probe when the plan selected another file", async () => {
    let probed = false;
    await expect(
      packageReadTargetVerdict(view, view.privateConfigPath, () => {
        probed = true;
        return Promise.resolve({});
      }),
    ).resolves.toEqual({ kind: "unchanged" });
    expect(probed).toBe(false);
  });
});
