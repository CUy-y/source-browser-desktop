# Release Guide

## 发布前检查

```powershell
npm ci
npm audit --omit=dev
npm run check
npm run dist
```

随后验证：

- 安装版与便携版均可启动。
- 登录窗口只打开官方商家域名。
- 查询、取消、失败保留旧结果。
- 收藏、方案和历史在重启后仍存在。
- 部分页数查询不生成监控变化。
- CSV 可用 Excel 正确打开中文。
- 自动测试和冒烟测试没有执行真实关联或取消关联。

## 版本与标签

1. 更新 `package.json`、`package-lock.json` 和 `CHANGELOG.md`。
2. 提交代码并创建 `vX.Y.Z` 标签。
3. 推送标签：`git push origin vX.Y.Z`。
4. GitHub Actions 会在 Windows 构建安装版和便携版并创建 Release。

## 签名

仓库默认不包含签名证书。对外正式分发前应通过 GitHub Secrets 或可信构建环境配置 Windows 代码签名；切勿把证书、私钥或密码提交到仓库。
