"use client";

import { useEffect, useState } from "react";
import { Megaphone, X } from "lucide-react";

const DISMISSED_KEY = "infinite-canvas:announcement-dismissed";

export function AnnouncementBanner() {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        try {
            setVisible(localStorage.getItem(DISMISSED_KEY) !== "1");
        } catch {
            setVisible(true);
        }
    }, []);

    if (!visible) return null;

    return (
        <section aria-label="站点公告" className="relative w-full shrink-0 bg-sky-100 text-foreground dark:bg-neutral-700">
            <div className="flex min-h-12 items-center justify-center px-12 py-2 text-center text-sm sm:text-base">
                <span className="min-w-0 break-words font-medium leading-[1.6]">
                    <Megaphone className="mr-2 inline-block size-[18px] -translate-y-[2.5px] align-middle" />
                    微信交流群现已开放 <a href="https://qr.tdeh.uk/ai" target="_blank" rel="noopener" className="whitespace-nowrap underline!">扫码加入</a>
                </span>
            </div>
            <button
                type="button"
                aria-label="关闭公告"
                className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-md p-1.5 hover:bg-foreground/10 sm:right-4"
                onClick={() => {
                    setVisible(false);
                    try {
                        localStorage.setItem(DISMISSED_KEY, "1");
                    } catch {}
                }}
            >
                <X className="size-4" />
            </button>
        </section>
    );
}
