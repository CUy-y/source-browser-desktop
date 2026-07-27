package cn.ldxp.sourcebrowser.android.publicdata;

import cn.ldxp.sourcebrowser.android.model.ProductRecord;
import cn.ldxp.sourcebrowser.android.model.PublicShopSnapshot;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import static org.junit.Assert.assertEquals;

public final class PublicCatalogStoreTest {
    @Rule public final TemporaryFolder temporaryFolder = new TemporaryFolder();

    @Test public void reloadReadsChangesWrittenByAnotherActivityStore() throws Exception {
        File file = temporaryFolder.newFile("public-catalog-v1.json");
        Files.write(file.toPath(), new JSONObject().put("version", 1).put("shops", new JSONArray()).toString().getBytes(StandardCharsets.UTF_8));
        PublicCatalogStore mainActivityStore = new PublicCatalogStore(file);
        assertEquals(0, mainActivityStore.getShops().size());

        PublicShopSnapshot shop = new PublicShopSnapshot();
        shop.token = "shop-token";
        shop.name = "测试店铺";
        shop.url = "https://www.ldxp.cn/shop/shop-token";
        shop.createdAt = 1L;
        shop.updatedAt = 2L;
        ProductRecord product = new ProductRecord();
        product.productKey = "product-key";
        product.name = "测试商品";
        product.dataSource = "public-shop";
        shop.products.add(product);

        JSONObject root = new JSONObject();
        root.put("version", 1);
        root.put("shops", new JSONArray().put(shop.toJson()));
        Files.write(file.toPath(), root.toString().getBytes(StandardCharsets.UTF_8));

        mainActivityStore.reload();

        assertEquals(1, mainActivityStore.getShops().size());
        assertEquals("测试店铺", mainActivityStore.getShops().get(0).name);
        assertEquals(1, mainActivityStore.getShops().get(0).products.size());
        assertEquals("product-key", mainActivityStore.getShops().get(0).products.get(0).productKey);
    }
}
