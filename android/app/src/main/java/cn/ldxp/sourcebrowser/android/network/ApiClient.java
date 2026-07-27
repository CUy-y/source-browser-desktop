package cn.ldxp.sourcebrowser.android.network;

import android.content.Context;
import android.webkit.CookieManager;

import cn.ldxp.sourcebrowser.android.auth.Credential;
import cn.ldxp.sourcebrowser.android.auth.TokenStore;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

public final class ApiClient {
    public static final String BASE_URL = "https://pay.ldxp.cn";
    private final TokenStore tokenStore;

    public ApiClient(Context context) {
        tokenStore = new TokenStore(context.getApplicationContext());
    }

    public TokenStore tokenStore() {
        return tokenStore;
    }

    public ApiEnvelope postAuthenticated(String endpoint, JSONObject payload, AtomicBoolean cancelled) throws ApiException {
        Credential credential = tokenStore.load();
        if (credential == null) throw new ApiException("请先登录链动小铺商家账号", 401, 401, false);
        return post(endpoint, payload, credential.token, cancelled);
    }

    public ApiEnvelope postWithToken(String endpoint, JSONObject payload, String token, AtomicBoolean cancelled) throws ApiException {
        return post(endpoint, payload, token, cancelled);
    }

    public ApiEnvelope postPublic(String endpoint, JSONObject payload, AtomicBoolean cancelled) throws ApiException {
        return post(endpoint, payload, "", cancelled);
    }

    private ApiEnvelope post(String endpoint, JSONObject payload, String token, AtomicBoolean cancelled) throws ApiException {
        if (cancelled != null && cancelled.get()) throw new ApiException("操作已取消", 0, 0, false);
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(BASE_URL + endpoint).openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(20_000);
            connection.setReadTimeout(20_000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Accept", "application/json, text/plain, */*");
            connection.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9");
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Origin", BASE_URL);
            connection.setRequestProperty("Referer", BASE_URL + "/merchant/my_parent/source_square");
            connection.setRequestProperty("User-Agent", "LdxpSourceBrowserAndroid/1.9");
            String cookie = CookieManager.getInstance().getCookie(BASE_URL);
            if (cookie != null && !cookie.isEmpty()) connection.setRequestProperty("Cookie", cookie);
            if (token != null && !token.isEmpty()) {
                connection.setRequestProperty("Merchant-Token", token);
                connection.setRequestProperty("Authorization", "Bearer " + token);
            }
            byte[] body = (payload == null ? new JSONObject() : payload).toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(body.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body);
                output.flush();
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String raw = readAll(stream);
            return ResponseParser.parse(status, raw);
        } catch (ApiException error) {
            throw error;
        } catch (Exception error) {
            if (cancelled != null && cancelled.get()) throw new ApiException("操作已取消", 0, 0, false);
            throw new ApiException(error.getMessage() == null ? "网络请求失败" : error.getMessage(), 0, 0, true);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String readAll(InputStream stream) throws Exception {
        if (stream == null) return "{}";
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }
}
