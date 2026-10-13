import { expect, it } from "vitest";

import {
  expectConfigurationRefusal,
  serveCli as serve,
} from "./cliServeHarness.js";

it.each([
  [
    ["inspect-apktool-client", "--json"],
    "/nonexistent/apktool",
    "The selected apktool launcher was not found: /nonexistent/apktool. Set REA_APKTOOL_COMMAND",
  ],
  [
    ["decode-android-resources", "/targets/app.apk", "--json"],
    "/nonexistent/apktool",
    "The selected apktool launcher was not found: /nonexistent/apktool. Set REA_APKTOOL_COMMAND",
  ],
  [
    ["decode-android-resources", "/targets/app.apk", "--json"],
    "relative/apktool",
    "REA_APKTOOL_COMMAND must be an absolute path to the apktool launcher.",
  ],
])(
  "%j with REA_APKTOOL_COMMAND=%s names the host requirement",
  async (argv, command, reason) => {
    const result = await serve(argv, { REA_APKTOOL_COMMAND: command });
    expectConfigurationRefusal(result, reason);
  },
);

it("validates the locale option before launching apktool", async () => {
  const result = await serve([
    "decode-android-resources",
    "/targets/app.apk",
    "--locale",
    "not a locale",
    "--json",
  ]);
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    code: "VALIDATION_ERROR",
    fieldErrors: [
      {
        code: "invalid_format",
        path: "locale",
      },
    ],
  });
});

it("accepts every locale the shared decode_android_resources contract accepts", async () => {
  for (const locale of ["pt-rBR", "b+zh+Hans+CN"]) {
    const result = await serve(
      [
        "decode-android-resources",
        "/targets/app.apk",
        "--locale",
        locale,
        "--json",
      ],
      { REA_APKTOOL_COMMAND: "/nonexistent/apktool" },
    );
    expectConfigurationRefusal(
      result,
      "The selected apktool launcher was not found: /nonexistent/apktool",
    );
  }
});

it("accepts --no-strings as the negation of the declared strings option", async () => {
  // The option has to be declared positively: the parser resolves a
  // --no-<name> token against the declared option names, so a literal
  // "no-strings" option is unreachable from the command line.
  const result = await serve(
    ["decode-android-resources", "/targets/app.apk", "--no-strings", "--json"],
    { REA_APKTOOL_COMMAND: "/nonexistent/apktool" },
  );
  expectConfigurationRefusal(
    result,
    "The selected apktool launcher was not found: /nonexistent/apktool",
  );
});
