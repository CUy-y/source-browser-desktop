package cn.ldxp.sourcebrowser.android.network;

public final class ApiException extends Exception {
    public final int status;
    public final int apiCode;
    public final boolean retryable;

    public ApiException(String message, int status, int apiCode, boolean retryable) {
        super(message);
        this.status = status;
        this.apiCode = apiCode;
        this.retryable = retryable;
    }

    public boolean requiresLogin() {
        return status == 401 || status == 403 || apiCode == 401 || apiCode == 403;
    }
}
