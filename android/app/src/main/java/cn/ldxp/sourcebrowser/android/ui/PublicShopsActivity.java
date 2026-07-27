package cn.ldxp.sourcebrowser.android.ui;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ListView;
import android.widget.ProgressBar;
import android.widget.TextView;

import cn.ldxp.sourcebrowser.android.R;
import cn.ldxp.sourcebrowser.android.model.PublicShopSnapshot;
import cn.ldxp.sourcebrowser.android.network.ApiClient;
import cn.ldxp.sourcebrowser.android.publicdata.PublicCatalogRepository;
import cn.ldxp.sourcebrowser.android.publicdata.PublicCatalogStore;

import java.util.List;

public final class PublicShopsActivity extends Activity implements PublicCatalogRepository.Listener, PublicShopAdapter.Actions {
    private PublicCatalogRepository repository;
    private PublicShopAdapter adapter;
    private EditText sourceInput;
    private Button addButton, refreshAllButton;
    private ProgressBar progress;
    private TextView message, title;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_public_shops);
        UiUtils.applySystemInsets(this, findViewById(android.R.id.content));
        ApiClient api = new ApiClient(this);
        if (api.tokenStore().load() == null) { finish(); return; }
        repository = new PublicCatalogRepository(api, new PublicCatalogStore(this));
        sourceInput = findViewById(R.id.public_source_input);
        addButton = findViewById(R.id.public_add);
        refreshAllButton = findViewById(R.id.public_refresh_all);
        progress = findViewById(R.id.public_progress);
        message = findViewById(R.id.public_message);
        title = findViewById(R.id.public_title);
        adapter = new PublicShopAdapter(this, this);
        ((ListView) findViewById(R.id.public_shop_list)).setAdapter(adapter);
        findViewById(R.id.public_back).setOnClickListener(view -> finish());
        addButton.setOnClickListener(view -> addSource());
        refreshAllButton.setOnClickListener(view -> {
            if (repository.getShops().isEmpty()) { message.setText("公开店铺库为空"); return; }
            setBusy(true);
            repository.refreshAll(this);
        });
        render(repository.getShops());
    }

    private void addSource() {
        String url = sourceInput.getText().toString().trim();
        if (url.isEmpty()) { message.setText("请粘贴链动小铺商品或店铺链接"); return; }
        setBusy(true);
        repository.addSource(url, this);
    }

    private void setBusy(boolean busy) {
        addButton.setEnabled(!busy);
        refreshAllButton.setEnabled(!busy);
        sourceInput.setEnabled(!busy);
        progress.setVisibility(busy ? View.VISIBLE : View.GONE);
        adapter.setBusy(busy);
    }

    private void render(List<PublicShopSnapshot> shops) {
        adapter.setShops(shops);
        title.setText("公开店铺库 · " + shops.size());
    }

    @Override public void onSuccess(String result, List<PublicShopSnapshot> shops) {
        setBusy(false);
        sourceInput.setText("");
        message.setText(result);
        render(shops);
    }

    @Override public void onError(String error, List<PublicShopSnapshot> shops) {
        setBusy(false);
        message.setText(error);
        render(shops);
    }

    @Override public void refresh(PublicShopSnapshot shop) {
        setBusy(true);
        repository.refreshShop(shop.token, this);
    }

    @Override public void open(PublicShopSnapshot shop) {
        if (!UiUtils.openOfficialUrl(this, shop.url)) message.setText("店铺链接不可用");
    }

    @Override public void remove(PublicShopSnapshot shop) {
        new AlertDialog.Builder(this)
            .setTitle("移除公开店铺")
            .setMessage("确定从本机移除“" + shop.name + "”？不会修改链动小铺数据。")
            .setNegativeButton("取消", null)
            .setPositiveButton("移除", (dialog, which) -> {
                setBusy(true);
                repository.remove(shop.token, this);
            })
            .show();
    }

    @Override protected void onDestroy() {
        if (repository != null) repository.shutdown();
        super.onDestroy();
    }
}
