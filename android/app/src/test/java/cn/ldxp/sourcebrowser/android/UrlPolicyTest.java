package cn.ldxp.sourcebrowser.android;

import cn.ldxp.sourcebrowser.android.util.UrlPolicy;

import org.junit.Test;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

public final class UrlPolicyTest {
    @Test public void acceptsOnlyOfficialHttpsLinks() {
        assertTrue(UrlPolicy.isOfficialHttps("https://pay.ldxp.cn/item/abc"));
        assertTrue(UrlPolicy.isOfficialHttps("https://www.ldxp.cn/item/abc"));
        assertFalse(UrlPolicy.isOfficialHttps("http://pay.ldxp.cn/item/abc"));
        assertFalse(UrlPolicy.isOfficialHttps("https://pay.ldxp.cn.evil.example/item/abc"));
    }

    @Test public void parsesPublicItemAndShopSources() {
        assertArrayEquals(new String[]{"item", "hw4xxb"}, UrlPolicy.parsePublicSource("https://www.ldxp.cn/item/hw4xxb"));
        assertArrayEquals(new String[]{"shop", "saki"}, UrlPolicy.parsePublicSource("https://pay.ldxp.cn/shop/saki/"));
    }

    @Test public void rejectsUnsupportedPaths() {
        try {
            UrlPolicy.parsePublicSource("https://pay.ldxp.cn/order/abc");
            fail("expected rejection");
        } catch (IllegalArgumentException expected) {
            assertTrue(expected.getMessage().contains("/item/商品键"));
        }
    }

    @Test public void isolatesLoginWebViewToMerchantPath() {
        assertTrue(UrlPolicy.isMerchantWebViewUrl("https://pay.ldxp.cn/merchant/login"));
        assertFalse(UrlPolicy.isMerchantWebViewUrl("https://pay.ldxp.cn/item/abc"));
        assertFalse(UrlPolicy.isMerchantWebViewUrl("https://www.ldxp.cn/merchant/login"));
    }
}
