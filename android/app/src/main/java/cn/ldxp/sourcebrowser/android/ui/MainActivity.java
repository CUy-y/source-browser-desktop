package cn.ldxp.sourcebrowser.android.ui;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.WebStorage;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import cn.ldxp.sourcebrowser.android.R;
import cn.ldxp.sourcebrowser.android.auth.Credential;
import cn.ldxp.sourcebrowser.android.data.SettingsStore;
import cn.ldxp.sourcebrowser.android.model.CatalogResult;
import cn.ldxp.sourcebrowser.android.model.LocalFilters;
import cn.ldxp.sourcebrowser.android.model.ProductRecord;
import cn.ldxp.sourcebrowser.android.model.SearchProgress;
import cn.ldxp.sourcebrowser.android.model.SearchRequest;
import cn.ldxp.sourcebrowser.android.network.ApiClient;
import cn.ldxp.sourcebrowser.android.network.CatalogRepository;
import cn.ldxp.sourcebrowser.android.publicdata.PublicCatalogRepository;
import cn.ldxp.sourcebrowser.android.publicdata.PublicCatalogStore;
import cn.ldxp.sourcebrowser.android.util.ProductUtils;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public final class MainActivity extends Activity implements CatalogRepository.Listener {
    private static final String[] SCOPE_LABELS = {"货源广场", "公开店铺", "全部数据"};
    private static final String[] SCOPE_VALUES = {"source", "public", "all"};
    private static final String[] TYPE_LABELS = {"全部类型", "卡密", "文章", "资源", "权益"};
    private static final String[] TYPE_VALUES = {"", "card", "article", "resource", "equity"};
    private static final Integer[] REMOTE_SIZES = {20, 50, 100};
    private static final String[] SPEED_LABELS = {"快速", "标准", "稳定"};
    private static final String[] SPEED_VALUES = {"fast", "standard", "stable"};
    private static final Integer[] LOCAL_SIZES = {10, 20, 50, 100};

    private ApiClient api;
    private CatalogRepository catalog;
    private PublicCatalogRepository publicCatalog;
    private SettingsStore settings;
    private Spinner scopeSpinner, typeSpinner, remoteSizeSpinner, speedSpinner, localSizeSpinner;
    private EditText keywordInput, pagesInput;
    private LinearLayout remoteOptions;
    private Button searchButton, filterButton, publicShopsButton, previousPage, nextPage;
    private TextView messageText, summaryText, pageText;
    private ProgressBar progressBar;
    private ProductAdapter adapter;
    private LocalFilters filters;
    private final List<ProductRecord> products = new ArrayList<>();
    private List<ProductRecord> filtered = new ArrayList<>();
    private List<ProductRecord> pendingPublic = new ArrayList<>();
    private String pendingScope = "source";
    private int currentPage = 1;
    private int localPageSize = 10;
    private boolean running;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        api = new ApiClient(this);
        Credential credential = api.tokenStore().load();
        if (credential == null) {
            openLogin();
            return;
        }
        setContentView(R.layout.activity_main);
        UiUtils.applySystemInsets(this, findViewById(android.R.id.content));
        catalog = new CatalogRepository(api);
        publicCatalog = new PublicCatalogRepository(api, new PublicCatalogStore(this));
        settings = new SettingsStore(this);
        filters = settings.loadFilters();
        bindViews(credential);
        restoreSettings();
        bindActions();
        String warning = getIntent().getStringExtra("connection_warning");
        if (warning != null && !warning.isEmpty()) showMessage(warning);
        render();
    }

    private void bindViews(Credential credential) {
        ((TextView) findViewById(R.id.account_name)).setText(credential.displayName);
        scopeSpinner = findViewById(R.id.scope_spinner);
        typeSpinner = findViewById(R.id.type_spinner);
        remoteSizeSpinner = findViewById(R.id.remote_size_spinner);
        speedSpinner = findViewById(R.id.speed_spinner);
        localSizeSpinner = findViewById(R.id.local_size_spinner);
        keywordInput = findViewById(R.id.keyword_input);
        pagesInput = findViewById(R.id.pages_input);
        remoteOptions = findViewById(R.id.remote_options);
        searchButton = findViewById(R.id.search_button);
        filterButton = findViewById(R.id.filter_button);
        publicShopsButton = findViewById(R.id.public_shops_button);
        previousPage = findViewById(R.id.previous_page);
        nextPage = findViewById(R.id.next_page);
        messageText = findViewById(R.id.message_text);
        summaryText = findViewById(R.id.summary_text);
        pageText = findViewById(R.id.page_text);
        progressBar = findViewById(R.id.search_progress);
        setSpinner(scopeSpinner, SCOPE_LABELS);
        setSpinner(typeSpinner, TYPE_LABELS);
        setSpinner(remoteSizeSpinner, REMOTE_SIZES);
        setSpinner(speedSpinner, SPEED_LABELS);
        setSpinner(localSizeSpinner, LOCAL_SIZES);
        adapter = new ProductAdapter(this, this::openDetail);
        ((ListView) findViewById(R.id.product_list)).setAdapter(adapter);
    }

    private void restoreSettings() {
        scopeSpinner.setSelection(bound(settings.getInt("scopeIndex", 0), SCOPE_VALUES.length));
        typeSpinner.setSelection(bound(settings.getInt("typeIndex", 0), TYPE_VALUES.length));
        remoteSizeSpinner.setSelection(bound(settings.getInt("remoteSizeIndex", 1), REMOTE_SIZES.length));
        speedSpinner.setSelection(bound(settings.getInt("speedIndex", 0), SPEED_VALUES.length));
        localSizeSpinner.setSelection(bound(settings.getInt("localSizeIndex", 0), LOCAL_SIZES.length));
        pagesInput.setText(String.valueOf(Math.max(1, Math.min(100, settings.getInt("pages", 50)))));
        localPageSize = LOCAL_SIZES[localSizeSpinner.getSelectedItemPosition()];
        updateScopeUi();
    }

    private void bindActions() {
        findViewById(R.id.logout_button).setOnClickListener(view -> logout());
        searchButton.setOnClickListener(view -> { if (running) cancelSearch(); else startSearch(); });
        filterButton.setOnClickListener(view -> showFilters());
        publicShopsButton.setOnClickListener(view -> startActivity(new Intent(this, PublicShopsActivity.class)));
        previousPage.setOnClickListener(view -> { if (currentPage > 1) { currentPage--; renderPage(); } });
        nextPage.setOnClickListener(view -> { int total = totalPages(); if (currentPage < total) { currentPage++; renderPage(); } });
        scopeSpinner.setOnItemSelectedListener(new SimpleSelectionListener(this::updateScopeUi));
        localSizeSpinner.setOnItemSelectedListener(new SimpleSelectionListener(() -> {
            localPageSize = LOCAL_SIZES[localSizeSpinner.getSelectedItemPosition()];
            settings.putInt("localSizeIndex", localSizeSpinner.getSelectedItemPosition());
            currentPage = 1;
            renderPage();
        }));
        keywordInput.setOnEditorActionListener((view, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_SEARCH) { startSearch(); return true; }
            return false;
        });
    }

    private void startSearch() {
        try {
            String keyword = keywordInput.getText().toString().trim();
            String scope = SCOPE_VALUES[scopeSpinner.getSelectedItemPosition()];
            int pages = scope.equals("public") ? 1 : parsePages(pagesInput.getText().toString());
            SearchRequest request = new SearchRequest(
                keyword,
                TYPE_VALUES[typeSpinner.getSelectedItemPosition()],
                pages,
                REMOTE_SIZES[remoteSizeSpinner.getSelectedItemPosition()],
                SPEED_VALUES[speedSpinner.getSelectedItemPosition()],
                scope
            );
            request.validate();
            filters.validate();
            saveQuerySettings(pages);
            hideMessage();
            currentPage = 1;
            pendingScope = scope;
            pendingPublic = scope.equals("source") ? new ArrayList<>() : publicCatalog.search(request.keywords, request.goodsType);
            if (scope.equals("public")) {
                if (!filters.relationState.equals("all")) {
                    filters.relationState = "all";
                    settings.saveFilters(filters);
                }
                products.clear();
                products.addAll(pendingPublic);
                render();
                showMessage(products.isEmpty() ? "公开店铺库中没有匹配商品，请先收录或刷新店铺" : "已从本地公开店铺库找到 " + products.size() + " 个商品");
                return;
            }
            setRunning(true);
            progressBar.setIndeterminate(true);
            progressBar.setVisibility(View.VISIBLE);
            catalog.start(request, this);
        } catch (Exception error) {
            showMessage(error.getMessage() == null ? "查询条件不正确" : error.getMessage());
        }
    }

    private void cancelSearch() {
        catalog.cancel();
        searchButton.setEnabled(false);
    }

    @Override public void onProgress(SearchProgress progress) {
        progressBar.setIndeterminate(false);
        int percent = progress.totalPages <= 0 ? 0 : Math.min(100, (int) Math.round(progress.loadedPages * 100.0 / progress.totalPages));
        progressBar.setProgress(percent);
        summaryText.setText("正在拉取 " + progress.loadedPages + " / " + progress.totalPages + " 页 · " + progress.loaded + " / " + progress.total + " 条 · " + progress.concurrency + " 并发 · " + progress.throttleMs + "ms");
    }

    @Override public void onSuccess(CatalogResult result) {
        setRunning(false);
        products.clear();
        products.addAll(pendingScope.equals("all") ? ProductUtils.mergeSourceFirst(result.products, pendingPublic) : result.products);
        render();
        String coverage = result.loadedPages < result.remoteTotalPages ? "本次拉取 " + result.loadedPages + " / " + result.remoteTotalPages + " 页" : "完整拉取成功";
        showMessage(coverage + (pendingScope.equals("all") ? "，已合并本地公开商品" : ""));
    }

    @Override public void onError(String message) {
        setRunning(false);
        showMessage(message);
        renderPage();
    }

    @Override public void onAuthenticationRequired(String message) {
        setRunning(false);
        api.tokenStore().clear();
        Intent intent = new Intent(this, LoginActivity.class);
        intent.putExtra("message", message);
        startActivity(intent);
        finish();
    }

    private void setRunning(boolean value) {
        running = value;
        searchButton.setEnabled(true);
        searchButton.setText(value ? "停止查询" : "开始查询");
        scopeSpinner.setEnabled(!value);
        typeSpinner.setEnabled(!value);
        pagesInput.setEnabled(!value);
        remoteSizeSpinner.setEnabled(!value);
        speedSpinner.setEnabled(!value);
        filterButton.setEnabled(!value);
        publicShopsButton.setEnabled(!value);
        if (!value) progressBar.setVisibility(View.GONE);
    }

    private void render() {
        try { filtered = ProductUtils.applyFilters(products, filters); }
        catch (Exception ignored) { filtered = new ArrayList<>(products); }
        currentPage = 1;
        renderPage();
    }

    private void renderPage() {
        int totalPages = totalPages();
        currentPage = Math.max(1, Math.min(currentPage, totalPages));
        adapter.setProducts(ProductUtils.page(filtered, currentPage, localPageSize));
        int source = 0;
        for (ProductRecord product : products) if (!product.dataSource.equals("public-shop")) source++;
        int publicCount = products.size() - source;
        summaryText.setText("已查询 " + products.size() + " 条，筛选后 " + filtered.size() + " 条" + (publicCount > 0 ? " · 货源 " + source + " / 公开 " + publicCount : ""));
        pageText.setText(currentPage + " / " + totalPages);
        previousPage.setEnabled(currentPage > 1);
        nextPage.setEnabled(currentPage < totalPages);
    }

    private int totalPages() { return Math.max(1, (int) Math.ceil(filtered.size() / (double) localPageSize)); }

    private void showFilters() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        int padding = dp(18);
        body.setPadding(padding, dp(6), padding, dp(6));
        scroll.addView(body);
        EditText min = field(body, "售价下限", number(filters.minSalePrice), InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        EditText max = field(body, "售价上限", number(filters.maxSalePrice), InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        Spinner stock = spinnerField(body, "库存", new String[]{"全部", "仅有库存", "仅缺货"}, index(filters.stockState, new String[]{"all", "in-stock", "out-of-stock"}));
        Spinner status = spinnerField(body, "状态", new String[]{"全部", "正常", "异常"}, index(filters.status, new String[]{"all", "normal", "abnormal"}));
        Spinner relation = spinnerField(body, "关联状态（只读）", new String[]{"全部", "已关联", "未关联"}, index(filters.relationState, new String[]{"all", "connected", "unconnected"}));
        relation.setEnabled(!SCOPE_VALUES[scopeSpinner.getSelectedItemPosition()].equals("public"));
        EditText category = field(body, "分类关键词", filters.categoryKeyword, InputType.TYPE_CLASS_TEXT);
        EditText merchant = field(body, "商家名称", filters.merchantName, InputType.TYPE_CLASS_TEXT);
        EditText blocked = field(body, "屏蔽词（逗号或换行分隔）", filters.blockedKeywords, InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        blocked.setMinLines(2);
        Spinner sort = spinnerField(body, "排序", new String[]{"默认顺序", "售价从低到高", "售价从高到低"}, index(filters.sortMode, new String[]{"default", "sale-asc", "sale-desc"}));
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("本地筛选")
            .setView(scroll)
            .setNegativeButton("取消", null)
            .setNeutralButton("重置", null)
            .setPositiveButton("应用", null)
            .create();
        dialog.setOnShowListener(ignored -> {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
                try {
                    LocalFilters next = new LocalFilters();
                    next.minSalePrice = nullable(min.getText().toString());
                    next.maxSalePrice = nullable(max.getText().toString());
                    next.stockState = new String[]{"all", "in-stock", "out-of-stock"}[stock.getSelectedItemPosition()];
                    next.status = new String[]{"all", "normal", "abnormal"}[status.getSelectedItemPosition()];
                    next.relationState = relation.isEnabled() ? new String[]{"all", "connected", "unconnected"}[relation.getSelectedItemPosition()] : "all";
                    next.categoryKeyword = category.getText().toString().trim();
                    next.merchantName = merchant.getText().toString().trim();
                    next.blockedKeywords = blocked.getText().toString();
                    next.sortMode = new String[]{"default", "sale-asc", "sale-desc"}[sort.getSelectedItemPosition()];
                    next.validate();
                    filters = next;
                    settings.saveFilters(filters);
                    render();
                    dialog.dismiss();
                } catch (Exception error) { showMessage(error.getMessage()); }
            });
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(view -> {
                filters = new LocalFilters();
                settings.saveFilters(filters);
                render();
                dialog.dismiss();
            });
        });
        dialog.show();
    }

    private EditText field(LinearLayout body, String label, String value, int inputType) {
        TextView caption = new TextView(this);
        caption.setText(label);
        caption.setTextColor(getColor(R.color.text_secondary));
        caption.setPadding(0, dp(9), 0, 0);
        body.addView(caption);
        EditText input = new EditText(this);
        input.setText(value);
        input.setInputType(inputType);
        body.addView(input, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        return input;
    }

    private Spinner spinnerField(LinearLayout body, String label, String[] values, int selected) {
        TextView caption = new TextView(this);
        caption.setText(label);
        caption.setTextColor(getColor(R.color.text_secondary));
        caption.setPadding(0, dp(9), 0, 0);
        body.addView(caption);
        Spinner spinner = new Spinner(this);
        setSpinner(spinner, values);
        spinner.setSelection(selected);
        body.addView(spinner, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(48)));
        return spinner;
    }

    private void updateScopeUi() {
        if (scopeSpinner == null) return;
        boolean publicOnly = SCOPE_VALUES[scopeSpinner.getSelectedItemPosition()].equals("public");
        remoteOptions.setVisibility(publicOnly ? View.GONE : View.VISIBLE);
    }

    private void saveQuerySettings(int pages) {
        settings.putInt("scopeIndex", scopeSpinner.getSelectedItemPosition());
        settings.putInt("typeIndex", typeSpinner.getSelectedItemPosition());
        settings.putInt("remoteSizeIndex", remoteSizeSpinner.getSelectedItemPosition());
        settings.putInt("speedIndex", speedSpinner.getSelectedItemPosition());
        settings.putInt("pages", pages);
    }

    private void openDetail(ProductRecord product) {
        if (!UiUtils.openOfficialUrl(this, product.detailUrl)) showMessage("商品详情链接不可用");
    }

    private void logout() {
        if (catalog != null) catalog.cancel();
        api.tokenStore().clear();
        CookieManager.getInstance().removeAllCookies(null);
        CookieManager.getInstance().flush();
        WebStorage.getInstance().deleteAllData();
        openLogin();
    }

    private void openLogin() {
        Intent intent = new Intent(this, LoginActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(intent);
        finish();
    }

    private void showMessage(String message) {
        messageText.setText(message == null ? "操作失败" : message);
        messageText.setVisibility(View.VISIBLE);
    }
    private void hideMessage() { messageText.setVisibility(View.GONE); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private static int parsePages(String value) {
        if (value == null || value.trim().isEmpty()) throw new IllegalArgumentException("拉取页数不能为空");
        try {
            int pages = Integer.parseInt(value.trim());
            if (pages < 1 || pages > 100) throw new IllegalArgumentException("拉取页数必须是 1–100 的整数");
            return pages;
        } catch (NumberFormatException error) { throw new IllegalArgumentException("拉取页数必须是 1–100 的整数"); }
    }
    private static Double nullable(String value) {
        if (value == null || value.trim().isEmpty()) return null;
        try { return Double.parseDouble(value.trim()); } catch (NumberFormatException error) { throw new IllegalArgumentException("价格必须是有效数字"); }
    }
    private static String number(Double value) { return value == null ? "" : String.valueOf(value); }
    private static int index(String value, String[] values) { for (int i = 0; i < values.length; i++) if (values[i].equals(value)) return i; return 0; }
    private static int bound(int value, int size) { return Math.max(0, Math.min(size - 1, value)); }
    private <T> void setSpinner(Spinner spinner, T[] values) {
        ArrayAdapter<T> array = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, values);
        array.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spinner.setAdapter(array);
    }

    @Override protected void onResume() {
        super.onResume();
        if (publicCatalog != null && publicShopsButton != null) {
            publicCatalog.reload();
            publicShopsButton.setText("公开店铺 " + publicCatalog.getShops().size());
        }
    }

    @Override protected void onDestroy() {
        if (catalog != null) catalog.shutdown();
        if (publicCatalog != null) publicCatalog.shutdown();
        super.onDestroy();
    }

    private static final class SimpleSelectionListener implements android.widget.AdapterView.OnItemSelectedListener {
        private final Runnable action;
        SimpleSelectionListener(Runnable action) { this.action = action; }
        @Override public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) { action.run(); }
        @Override public void onNothingSelected(android.widget.AdapterView<?> parent) { }
    }
}
