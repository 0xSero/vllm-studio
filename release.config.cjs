/** @type {import("semantic-release").GlobalConfig} */
module.exports = {
  branches: ["main"],
  plugins: [
    [
      "@semantic-release/commit-analyzer",
      {
        preset: "conventionalcommits",
        releaseRules: [
          { breaking: true, release: "major" },
          { type: "refactor", release: "patch" },
          { type: "micro", release: "patch" },
          { type: "release", release: "patch" },
          { type: "build", release: "patch" },
          { type: "ci", release: "patch" },
          { type: "docs", release: "patch" },
          { type: "chore", release: "patch" },
          { type: "style", release: "patch" },
        ],
      },
    ],
    [
      "@semantic-release/release-notes-generator",
      {
        preset: "conventionalcommits",
        presetConfig: {
          types: [
            { type: "feat", section: "Features" },
            { type: "fix", section: "Fixes" },
            { type: "perf", section: "Performance" },
            { type: "refactor", section: "Refactors" },
            { type: "micro", section: "Polish" },
            { type: "release", section: "Release" },
            { type: "docs", section: "Documentation" },
            { type: "build", section: "Build System" },
            { type: "ci", section: "CI" },
            { type: "chore", section: "Chores", hidden: true },
            { type: "style", section: "Styles", hidden: true },
          ],
        },
      },
    ],
    [
      "@semantic-release/github",
      {
        assets: [{ path: "release-staging/*" }],
        successComment: false,
        failComment: false,
      },
    ],
  ],
};
