# 产凭爬虫 OG 反代

微信 / 微博 / Slack / Discord / Telegram / LinkedIn / WhatsApp 等爬虫不跑 SPA。`{web}/play/:slug` 对它们是空壳，卡片标题会变成站点名。

生产把这些 UA 反代到已有的 `GET /v1/public/games/:slug/share.html`。不要再加第三套 public API。Vite `shareOgPlugin` 只覆盖 `vite` / `vite preview`。仓库可部署片段：[`deploy/Caddyfile`](../../deploy/Caddyfile)、[`deploy/nginx.conf`](../../deploy/nginx.conf)。

邀请 query（`?invite=`）不要写进爬虫卡：未登录预览不应替分享者领见面礼。

## Caddy

```caddy
@playCrawler {
  path_regexp playSlug ^/play/([^/?#]+)
  header_regexp User-Agent (?i)(MicroMessenger|Weibo|Slackbot|facebookexternalhit|Twitterbot|Discordbot|TelegramBot|LinkedInBot|WhatsApp)
}
handle @playCrawler {
  rewrite * /v1/public/games/{re.playSlug.1}/share.html
  reverse_proxy {$PLATFORM_API_ORIGIN}
}
```

## nginx

```nginx
location ~ ^/play/([^/?#]+) {
  if ($http_user_agent ~* (MicroMessenger|Weibo|Slackbot|facebookexternalhit|Twitterbot|Discordbot|TelegramBot|LinkedInBot|WhatsApp)) {
    proxy_pass $PLATFORM_API_ORIGIN/v1/public/games/$1/share.html;
    break;
  }
  try_files $uri /index.html;
}
```

`$PLATFORM_API_ORIGIN` 换成 API 源站（例如 `https://api.example.com`）。
