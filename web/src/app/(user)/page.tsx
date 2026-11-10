import type { Metadata } from "next";

import { JsonLd, siteId, siteName, siteUrl } from "@/components/layout/site-structured-data";
import HomePage from "./home-page";

const description = "无限画布是一个在浏览器中使用的创作工作台，提供画布编排、生图、视频和配音。";

export const metadata: Metadata = {
    title: siteName,
    description,
    alternates: siteUrl ? { canonical: siteUrl.href } : undefined,
};

export default function Page() {
    return (
        <>
            {siteUrl && <JsonLd data={{
                "@type": "WebSite",
                "@id": siteId,
                url: siteUrl.href,
                name: siteName,
                alternateName: "Infinite Canvas",
                description,
                inLanguage: "zh-CN",
            }} />}
            <HomePage />
        </>
    );
}
