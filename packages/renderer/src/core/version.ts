import webPackage from "../../package.json";

export const APP_VERSION = webPackage.version;
export const APP_VERSION_LABEL = `v${APP_VERSION.replace(/\.0$/, "")}`;
