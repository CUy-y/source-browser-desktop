package cn.ldxp.sourcebrowser.android.model;

import java.util.List;

public final class CatalogResult {
    public final List<ProductRecord> products;
    public final int loadedPages;
    public final int remoteTotalPages;

    public CatalogResult(List<ProductRecord> products, int loadedPages, int remoteTotalPages) {
        this.products = products;
        this.loadedPages = loadedPages;
        this.remoteTotalPages = remoteTotalPages;
    }
}
