const configuredSiteUrl = process.env.INFINITE_CANVAS_SITE_URL?.trim();

export const siteName = "无限画布";
export const siteUrl = configuredSiteUrl ? new URL(new URL(configuredSiteUrl).origin) : undefined;
export const siteId = siteUrl ? new URL("#website", siteUrl).href : undefined;

if (siteUrl && !["http:", "https:"].includes(siteUrl.protocol)) {
    throw new Error("INFINITE_CANVAS_SITE_URL 必须是 HTTP 或 HTTPS 地址");
}

export function JsonLd({ data }: { data: Record<string, unknown> }) {
    const json = JSON.stringify({ "@context": "https://schema.org", ...data }).replace(/</g, "\\u003c");
    return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
