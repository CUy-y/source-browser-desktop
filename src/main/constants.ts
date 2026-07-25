export const PLATFORM_BASE_URL = "https://pay.ldxp.cn";
export const MERCHANT_LOGIN_URL = `${PLATFORM_BASE_URL}/merchant/login`;
export const MERCHANT_ORIGIN = new URL(PLATFORM_BASE_URL).origin;
export const AUTH_PARTITION = "persist:ldxp-source-browser-auth";
export const SEARCH_RETRY_COUNT = 3;
export const SEARCH_JOB_TTL_MS = 30 * 60 * 1000;
