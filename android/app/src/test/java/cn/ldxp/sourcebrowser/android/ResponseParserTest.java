package cn.ldxp.sourcebrowser.android;

import cn.ldxp.sourcebrowser.android.network.ApiEnvelope;
import cn.ldxp.sourcebrowser.android.network.ApiException;
import cn.ldxp.sourcebrowser.android.network.ResponseParser;

import org.json.JSONObject;
import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

public final class ResponseParserTest {
    @Test public void parsesSuccessfulEnvelope() throws Exception {
        ApiEnvelope response = ResponseParser.parse(200, "{\"code\":1,\"msg\":\"success\",\"data\":{\"total\":2}}");
        assertEquals(1, response.code);
        assertEquals(2, ((JSONObject) response.data).optInt("total"));
    }

    @Test public void treatsHttpAndApiAuthFailuresAsNonRetryable() {
        assertAuthFailure(401, "{\"code\":0,\"msg\":\"expired\"}");
        assertAuthFailure(200, "{\"code\":403,\"msg\":\"forbidden\"}");
    }

    @Test public void doesNotBlindlyRetry429() {
        try {
            ResponseParser.parse(429, "{\"code\":0,\"msg\":\"slow down\"}");
            fail("expected 429");
        } catch (ApiException error) {
            assertEquals(429, error.status);
            assertFalse(error.retryable);
        }
    }

    @Test public void retriesServerAndMalformedServerResponsesOnly() {
        try {
            ResponseParser.parse(503, "<html>down</html>");
            fail("expected server failure");
        } catch (ApiException error) {
            assertEquals(503, error.status);
            assertTrue(error.retryable);
        }
        try {
            ResponseParser.parse(200, "<html>verify</html>");
            fail("expected malformed response");
        } catch (ApiException error) {
            assertFalse(error.retryable);
        }
    }

    private static void assertAuthFailure(int status, String body) {
        try {
            ResponseParser.parse(status, body);
            fail("expected authentication failure");
        } catch (ApiException error) {
            assertTrue(error.requiresLogin());
            assertFalse(error.retryable);
        }
    }
}
