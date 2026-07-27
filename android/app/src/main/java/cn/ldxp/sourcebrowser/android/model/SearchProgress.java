package cn.ldxp.sourcebrowser.android.model;

public final class SearchProgress {
    public int currentPage;
    public int loadedPages;
    public int totalPages;
    public int remoteTotalPages;
    public int loaded;
    public int total;
    public int throttleMs;
    public int concurrency;
    public boolean totalPagesResolved;
}
