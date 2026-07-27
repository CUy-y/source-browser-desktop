package cn.ldxp.sourcebrowser.android.util;

import java.net.URI;
import java.util.regex.Pattern;

public final class UrlPolicy {
    private static final Pattern SOURCE_PATH = Pattern.compile("^/(item|shop)/[A-Za-z0-9_-]+/?$");

    private UrlPolicy() {}

    public static boolean isOfficialHttps(String rawUrl) {
        try {
            URI uri = URI.create(rawUrl == null ? "" : rawUrl);
            String host = uri.getHost();
            return "https".equalsIgnoreCase(uri.getScheme()) && host != null && (host.equals("pay.ldxp.cn") || host.endsWith(".ldxp.cn"));
        } catch (Exception ignored) { return false; }
    }

    public static boolean isMerchantWebViewUrl(String rawUrl) {
        try {
            URI uri = URI.create(rawUrl == null ? "" : rawUrl);
            return "https".equalsIgnoreCase(uri.getScheme()) && "pay.ldxp.cn".equalsIgnoreCase(uri.getHost()) && uri.getPath() != null && uri.getPath().startsWith("/merchant");
        } catch (Exception ignored) { return false; }
    }

    public static String[] parsePublicSource(String rawUrl) {
        try {
            URI uri = URI.create(rawUrl == null ? "" : rawUrl.trim());
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null || (!host.equals("pay.ldxp.cn") && !host.equals("www.ldxp.cn"))) {
                throw new IllegalArgumentException("只支持链动小铺 HTTPS 商品或店铺链接");
            }
            String path = uri.getPath() == null ? "" : uri.getPath();
            if (!SOURCE_PATH.matcher(path).matches()) throw new IllegalArgumentException("链接必须是 /item/商品键 或 /shop/店铺标识");
            String[] segments = path.substring(1).split("/");
            return new String[]{segments[0], segments[1]};
        } catch (IllegalArgumentException error) {
            if (error.getMessage() != null && error.getMessage().startsWith("链接必须")) throw error;
            throw new IllegalArgumentException("只支持链动小铺 HTTPS 商品或店铺链接");
        }
    }
}
