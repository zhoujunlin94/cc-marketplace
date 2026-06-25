# cc-marketplace
我的claude code marketplace

## claude中添加这个市场
```
/plugin markketplace add zhoujunlin94/cc-marketplace
```

## 安装db-plugin
```
/plugin install db-plugin@cc-marketplace
/reload-plugins
```

## 安装 weixin-channel（个人微信 channel）
把个人微信消息（腾讯 iLink 协议）双向桥接到 Claude Code 会话。详见 [plugins/weixin-channel/README.md](plugins/weixin-channel/README.md)。

```
/plugin install weixin-channel@cc-marketplace
```
```bash
claude --dangerously-load-development-channels plugin:weixin-channel@cc-marketplace
```

首次启动时若未登录，channel server 会自动跑扫码登录，二维码以字符画形式直接显示在对话里，扫码确认即可开始收发微信消息。
