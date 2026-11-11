"use client";

import { App, Input } from "antd";
import { nanoid } from "nanoid";

import { useAssetStore, type AssetInput } from "@/stores/use-asset-store";

export function useSaveGeneratedAsset() {
    const { modal, message } = App.useApp();

    return (input: AssetInput) => {
        const id = nanoid();
        let title = input.title;
        let sku = "";
        let folder = "";
        modal.confirm({
            title: "保存到资产中心",
            icon: null,
            content: <div className="space-y-2">
                <Input aria-label="资产名称" defaultValue={title} maxLength={255} onChange={(event) => { title = event.target.value; }} />
                <Input aria-label="生成资产款号" placeholder="完整款号" maxLength={100} onChange={(event) => { sku = event.target.value; }} />
                <Input aria-label="生成资产文件夹" placeholder="文件夹" maxLength={160} onChange={(event) => { folder = event.target.value; }} />
            </div>,
            okText: "保存",
            cancelText: "取消",
            onOk: async () => {
                try {
                    if (!title.trim()) throw new Error("请输入资产名称");
                    await useAssetStore.getState().addAsset({ ...input, title: title.trim(), sku: sku.trim(), folder: folder.trim(), stage: "candidate" }, id, true);
                    message.success("已保存到资产中心");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "保存资产失败");
                    throw error;
                }
            },
        });
    };
}
