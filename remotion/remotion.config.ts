import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(92);
Config.setOverwriteOutput(true);
Config.setEntryPoint("src/index.ts");
// El primer arranque de Chrome sin interfaz en macOS puede tardar más de 28 s mientras el sistema lo verifica.
Config.setDelayRenderTimeoutInMilliseconds(120_000);
