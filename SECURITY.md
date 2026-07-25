# Security Policy

## Supported Version

当前仅维护最新发布版本。

## Reporting a Vulnerability

请优先使用 GitHub 的 **Private vulnerability reporting**，不要在公开 Issue 中提交 Token、Cookie、手机号、密码、订单信息或完整网络日志。

报告建议包含：受影响版本、复现条件、影响范围、最小复现和已做脱敏的截图。维护者确认问题前，请勿公开可直接利用的细节。

## Security Model

- Electron 渲染进程禁用 Node 集成并启用上下文隔离。
- 所有 IPC 参数使用 Zod 校验。
- Token 仅在主进程使用并由 Windows 加密保存。
- 外部链接限制为链动小铺官方 HTTPS 域名。
- 自动化测试禁止真实商户写操作。
