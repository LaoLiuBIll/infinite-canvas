import type { Metadata } from "next";

import { JsonLd, siteId, siteName, siteUrl } from "@/components/layout/site-structured-data";
import VoiceWorkbench from "./voice-workbench";

const name = "配音工作台";
const description = "登录后可使用后台配置的语音模型，将口播文案生成配音并试听、下载。";
const url = siteUrl ? new URL("/music", siteUrl).href : undefined;

export const metadata: Metadata = {
    title: `${name} | ${siteName}`,
    description,
    alternates: url ? { canonical: url } : undefined,
};

export default function Page() {
    return (
        <>
            {url && <JsonLd data={{
                "@type": "WebPage",
                "@id": `${url}#webpage`,
                url,
                name,
                description,
                inLanguage: "zh-CN",
                isPartOf: { "@id": siteId },
            }} />}
            <VoiceWorkbench />
        </>
    );
}
