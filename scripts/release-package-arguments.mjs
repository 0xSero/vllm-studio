export const releasePackageArguments = ({ app, version, commit }) => [
  "--prepackaged",
  app,
  "--config",
  "desktop/electron-builder.yml",
  "--config.mac.identity=null",
  "--config.mac.notarize=false",
  "--config.dmg.sign=false",
  `--config.extraMetadata.version=${version}`,
  `--config.extraMetadata.localStudioCommit=${commit}`,
  "--publish",
  "never",
];
