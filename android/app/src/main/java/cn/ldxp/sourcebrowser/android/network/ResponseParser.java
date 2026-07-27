package cn.ldxp.sourcebrowser.android.network;

import org.json.JSONObject;
import org.json.JSONTokener;

public final class ResponseParser {
    private ResponseParser() {}

    public static ApiEnvelope parse(int status, String raw) throws ApiException {
        final JSONObject envelope;
        try {
            Object parsed = new JSONTokener(raw == null ? "" : raw).nextValue();
            if (!(parsed instanceof JSONObject)) throw new IllegalArgumentException("not an object");
            envelope = (JSONObject) parsed;
        } catch (Exception error) {
            throw new ApiException("远端返回了非 JSON 内容（HTTP " + status + "）", status, 0, status >= 500);
        }
        int code = envelope.optInt("code", 0);
        String message = envelope.optString("msg", "");
        if (status == 401 || status == 403 || code == 401 || code == 403) {
            throw new ApiException(message.isEmpty() ? "登录已失效，请重新登录" : message, status, code, false);
        }
        if (status == 429) throw new ApiException(message.isEmpty() ? "请求过于频繁，请稍后重试" : message, 429, code, false);
        if (status < 200 || status >= 300) {
            throw new ApiException(message.isEmpty() ? "远端 HTTP " + status : message, status, code, status >= 500);
        }
        return new ApiEnvelope(code, message, envelope.opt("data"));
    }
}
