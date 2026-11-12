"use client";

import { EyeOutlined, ReloadOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Descriptions, Drawer, Empty, Flex, Input, Select, Space, Spin, Table, Tabs, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import dayjs from "dayjs";
import { useEffect, useState } from "react";

import { formatBytes } from "@/lib/image-utils";
import { fetchAdminContent, fetchAdminContentDetail, fetchAdminContentMedia, type AdminContentDetail, type AdminContentRecord, type ContentRole, type ContentSection } from "@/services/api/admin-user-content";
import { useUserStore } from "@/stores/use-user-store";

const pageSize = 20;
const sections = [{ key: "files", label: "素材" }, { key: "results", label: "成果" }, { key: "assets", label: "资产" }];
const kinds = [
    { value: "image", label: "图片" }, { value: "video", label: "视频" }, { value: "audio", label: "音频" },
    { value: "text", label: "文本" }, { value: "file", label: "其他文件" },
];
const sources: Record<string, string> = {
    file: "已同步素材", asset: "个人资产", "legacy-asset": "旧版同步资产", "image-log": "生图历史", "legacy-image-log": "旧版生图历史", "video-log": "生视频历史",
    "image-task": "生图成果", "video-task": "生视频成果", "audio-task": "画布音频", "voice-asset": "已保存配音",
};
const statuses: Record<string, string> = {
    trash: "回收站", completed: "成功", succeeded: "成功", success: "成功",
    failed: "失败", pending: "待处理", queued: "排队中", processing: "处理中", running: "生成中",
    cancelled: "已取消", stopped: "已停止",
};

const displayRole = (role: ContentRole) => role === "admin" ? "管理员" : "普通用户";
const displayKind = (kind: string) => kinds.find((item) => item.value === kind)?.label || "其他文件";
const errorText = (error: unknown) => error instanceof Error ? error.message : "暂时无法读取内容";
const ownerName = (row: AdminContentRecord) => row.displayName || row.username || row.userId;

export default function AdminUserContentPage() {
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const [section, setSection] = useState<ContentSection>("files");
    const [keyword, setKeyword] = useState("");
    const [searchText, setSearchText] = useState("");
    const [role, setRole] = useState<ContentRole>();
    const [type, setType] = useState<string>();
    const [owner, setOwner] = useState<{ id: string; name: string }>();
    const [page, setPage] = useState(1);
    const [selected, setSelected] = useState<AdminContentRecord>();
    const canRead = Boolean(token && user?.role === "admin");
    const params = { section, keyword, role, type, userId: owner?.id, page, pageSize };

    const list = useQuery({
        queryKey: ["admin-user-content", user?.id, params],
        queryFn: () => fetchAdminContent(token, params),
        enabled: canRead,
        gcTime: 0,
    });
    const detail = useQuery({
        queryKey: ["admin-user-content-detail", user?.id, selected?.source, selected?.userId, selected?.id],
        queryFn: () => fetchAdminContentDetail(token, selected!),
        enabled: canRead && Boolean(selected),
        gcTime: 0,
        refetchOnWindowFocus: false,
    });

    const columns: TableColumnsType<AdminContentRecord> = [
        { title: "内容", key: "title", ellipsis: true, render: (_, row) =>
            <Button type="link" className="max-w-full px-0" icon={<EyeOutlined />} aria-label={`查看 ${row.title}`} onClick={() => setSelected(row)}><span className="truncate">{row.title}</span></Button> },
        { title: "归属账号", key: "user", width: 210, render: (_, row) =>
            <Flex vertical align="start">
                <Button type="link" className="max-w-full px-0" title={`只看 ${ownerName(row)}`} onClick={() => { setOwner({ id: row.userId, name: ownerName(row) }); setRole(undefined); setKeyword(""); setSearchText(""); setPage(1); }}>{ownerName(row)}</Button>
                {row.displayName && row.username !== row.displayName && <Typography.Text type="secondary">{row.username}</Typography.Text>}
            </Flex> },
        { title: "角色", key: "role", width: 105, render: (_, row) => <Tag color={row.role === "admin" ? "gold" : "default"}>{displayRole(row.role)}</Tag> },
        { title: "来源", key: "source", width: 142, render: (_, row) => sources[row.source] || row.source },
        { title: "类型", key: "kind", width: 90, render: (_, row) => displayKind(row.kind) },
        { title: "状态", key: "status", width: 104, render: (_, row) => row.status ? <Tag>{statuses[row.status] || row.status}</Tag> : "—" },
        { title: "记录时间", key: "createdAt", width: 170, render: (_, row) => row.createdAt ? dayjs(row.createdAt).format("YYYY-MM-DD HH:mm:ss") : "—" },
    ];

    return (
        <main className="p-4 sm:p-6">
            <Card variant="borderless">
                <Tabs activeKey={section} items={sections} onChange={(key) => { setSection(key as ContentSection); setType(undefined); setPage(1); }} />
                <Flex wrap align="center" gap={8} className="mb-4">
                    <Input.Search
                        aria-label="搜索用户内容"
                        value={searchText}
                        onChange={(event) => setSearchText(event.target.value)}
                        placeholder="搜索账号、昵称、内容或模型"
                        allowClear
                        className="w-72 max-w-full"
                        onSearch={(value) => { setKeyword(value.trim()); setPage(1); }}
                    />
                    <Select<ContentRole> aria-label="筛选账号角色" allowClear placeholder="全部角色" className="min-w-28"
                        value={role} options={[{ label: "管理员", value: "admin" }, { label: "普通用户", value: "user" }]}
                        onChange={(value) => { setRole(value); setPage(1); }} />
                    <Select<string> aria-label="筛选内容类型" allowClear placeholder="全部类型" className="min-w-28"
                        value={type} options={kinds.filter((item) => section === "results" ? ["image", "video", "audio"].includes(item.value) : section === "files" ? item.value !== "text" : item.value !== "file")}
                        onChange={(value) => { setType(value); setPage(1); }} />
                    {owner && <Tag closable onClose={() => { setOwner(undefined); setPage(1); }}>账号 {owner.name}</Tag>}
                    <Button icon={<ReloadOutlined />} onClick={() => void list.refetch()} aria-label="刷新用户内容" />
                </Flex>
                {list.error && <Alert showIcon type="error" title={errorText(list.error)} className="mb-3" />}
                <Table rowKey={(row) => `${row.source}:${row.userId}:${row.id}`} columns={columns} dataSource={list.data?.items || []}
                    loading={list.isFetching} scroll={{ x: 1000 }} size="middle"
                    pagination={{ current: page, pageSize, total: list.data?.total || 0, showSizeChanger: false, onChange: setPage, showTotal: (total) => `共 ${total} 条` }}
                    locale={{ emptyText: "没有匹配的已同步内容" }} />
            </Card>
            <Drawer title={selected?.title || "内容详情"} open={Boolean(selected)} onClose={() => setSelected(undefined)} size={640} destroyOnHidden>
                {detail.isFetching && !detail.data && <Spin />}
                {detail.error && <Alert showIcon type="error" title={errorText(detail.error)} />}
                {detail.data && <ContentDetails key={`${detail.data.source}:${detail.data.userId}:${detail.data.id}`} item={detail.data} token={token} />}
            </Drawer>
        </main>
    );
}

function ContentDetails({ item, token }: { item: AdminContentDetail; token: string }) {
    const details = [
        { key: "owner", label: "归属账号", children: `${ownerName(item)} · ${displayRole(item.role)}` },
        { key: "source", label: "来源", children: sources[item.source] || item.source },
        { key: "kind", label: "类型", children: displayKind(item.kind) },
        { key: "model", label: "模型", children: item.model },
        { key: "category", label: "分类", children: item.category },
        { key: "folder", label: "文件夹", children: item.folder },
        { key: "sku", label: "完整款号", children: item.sku },
        { key: "tags", label: "标签", children: item.tags?.join("、") },
        { key: "bytes", label: "文件大小", children: item.bytes ? formatBytes(item.bytes) : undefined },
    ].filter((entry) => entry.children);
    return (
        <Flex vertical gap={16}>
            <Descriptions size="small" column={1} items={details} />
            {item.prompt && <section><Typography.Text strong>提示词或文案</Typography.Text><p className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words">{item.prompt}</p></section>}
            {item.kind === "text" ? <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border border-border p-3">{item.text}</pre>
                : item.media?.length ? <ContentMedia urls={item.media} item={item} token={token} />
                    : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有可预览的云端媒体" />}
        </Flex>
    );
}

function ContentMedia({ urls, item, token }: { urls: string[]; item: AdminContentDetail; token: string }) {
    const [index, setIndex] = useState(0);
    const [load, setLoad] = useState(false);
    const [loadedURL, setLoadedURL] = useState("");
    const [error, setError] = useState("");
    const target = urls[index] || urls[0];
    const external = target.startsWith("/api/admin/user-content/media?");
    const mediaURL = external ? loadedURL : target;

    useEffect(() => {
        if (!load || !external) return;
        const controller = new AbortController();
        let objectURL = "";
        fetchAdminContentMedia(token, target, controller.signal).then((blob) => {
            if (controller.signal.aborted) return;
            objectURL = URL.createObjectURL(blob);
            setLoadedURL(objectURL);
        }).catch((reason) => { if (!controller.signal.aborted) setError(errorText(reason)); });
        return () => {
            controller.abort();
            if (objectURL) URL.revokeObjectURL(objectURL);
        };
    }, [external, load, target, token]);

    const select = (next: number) => {
        setIndex(next);
        setLoadedURL("");
        setLoad(false);
        setError("");
    };

    return (
        <Flex vertical gap={12}>
            {urls.length > 1 && <Space wrap>
                {urls.map((_, i) => <Button size="small" key={i} type={i === index ? "primary" : "default"} onClick={() => { if (index !== i) select(i); }}>成果 {i + 1}</Button>)}
            </Space>}
            {error ? <Alert type="warning" showIcon title={error} /> : external && !mediaURL ?
                <div><Button loading={load} onClick={() => setLoad(true)}>加载外链预览</Button></div>
                : item.kind === "image" ? <img src={mediaURL} alt={item.title} className="max-h-[460px] w-full rounded object-contain" onError={() => setError("图片无法预览")} />
                    : item.kind === "video" ? <video src={mediaURL} aria-label={item.title} controls preload="metadata" className="w-full rounded" onError={() => setError("视频无法预览")} />
                        : item.kind === "audio" ? <audio src={mediaURL} aria-label={item.title} controls preload="metadata" className="w-full" onError={() => setError("音频无法试听")} />
                            : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="此文件类型暂无在线预览" />}
        </Flex>
    );
}
