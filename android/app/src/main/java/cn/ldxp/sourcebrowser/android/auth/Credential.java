package cn.ldxp.sourcebrowser.android.auth;

public final class Credential {
    public final String token;
    public final String username;
    public final String displayName;
    public final long expiresAt;

    public Credential(String token, String username, String displayName, long expiresAt) {
        this.token = token;
        this.username = username;
        this.displayName = displayName;
        this.expiresAt = expiresAt;
    }

    public boolean isExpired() {
        return expiresAt > 0 && expiresAt <= System.currentTimeMillis();
    }
}
