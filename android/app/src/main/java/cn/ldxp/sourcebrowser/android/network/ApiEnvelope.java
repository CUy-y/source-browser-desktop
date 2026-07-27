package cn.ldxp.sourcebrowser.android.network;

public final class ApiEnvelope {
    public final int code;
    public final String message;
    public final Object data;

    public ApiEnvelope(int code, String message, Object data) {
        this.code = code;
        this.message = message;
        this.data = data;
    }
}
