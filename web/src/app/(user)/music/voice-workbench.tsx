"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Input } from "antd";
import { Download, FolderPlus, Mic } from "lucide-react";

import { AudioSettingsPanel, type AudioSettingKey } from "@/components/audio-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { useSaveGeneratedAsset } from "@/hooks/use-save-generated-asset";
import { canvasThemes } from "@/lib/canvas-theme";
import { isWorkflowProtocol } from "@/lib/model-channel";
import { requestAudioGeneration } from "@/services/api/audio";
import { filterModelsByCapability, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

export default function VoiceWorkbench() {
    const saveGeneratedAsset = useSaveGeneratedAsset();
    const storedConfig = useConfigStore((state) => state.config);
    const modelSettings = useConfigStore((state) => state.publicSettings?.modelChannel);
    const settingsLoading = useConfigStore((state) => state.isPublicSettingsLoading);
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [script, setScript] = useState("");
    const [selection, setSelection] = useState({ model: "", channelId: "" });
    const [audioSettings, setAudioSettings] = useState<Partial<Pick<AiConfig, AudioSettingKey>>>({});
    const [running, setRunning] = useState(false);
    const [error, setError] = useState("");
    const [result, setResult] = useState<{ url: string; filename: string; userId: string; blob: Blob; prompt: string; model: string }>();
    const activeRequest = useRef<AbortController | null>(null);

    const audioChannels = useMemo(() => (modelSettings?.channels || [])
        .filter((channel) => channel.enabled && !isWorkflowProtocol(channel.protocol))
        .map((channel) => ({ ...channel, models: filterModelsByCapability(channel.models, "audio", channel.protocol, channel.modelCapabilities) }))
        .filter((channel) => channel.models.length > 0), [modelSettings]);
    const selectedChannel = audioChannels.find((channel) => channel.id === selection.channelId && channel.models.includes(selection.model));
    const defaultChannel = audioChannels.find((channel) => channel.id === storedConfig.audioChannelId && channel.models.includes(storedConfig.audioModel))
        || audioChannels.find((channel) => channel.models.includes(storedConfig.audioModel));
    const channel = selectedChannel || defaultChannel || audioChannels[0];
    const model = selectedChannel ? selection.model : defaultChannel ? storedConfig.audioModel : channel?.models[0] || "";
    const channelId = channel?.id || "";
    const config: AiConfig = {
        ...storedConfig,
        ...audioSettings,
        channelMode: "remote",
        publicChannels: audioChannels,
        model,
        audioModel: model,
        activeChannelId: channelId,
        audioChannelId: channelId,
    };
    const canUseChannels = Boolean(token && user && (user.role === "admin" || modelSettings?.allowUserRemoteChannel));
    const canGenerate = isReady && canUseChannels && Boolean(model && channelId && script.trim());
    const currentResult = result?.userId === user?.id ? result : undefined;

    useEffect(() => () => activeRequest.current?.abort(), [token]);
    useEffect(() => () => {
        if (result) URL.revokeObjectURL(result.url);
    }, [result]);

    async function generate() {
        if (!canGenerate || !user || activeRequest.current) return;
        const controller = new AbortController();
        activeRequest.current = controller;
        setRunning(true);
        setError("");
        try {
            const audio = await requestAudioGeneration(config, script, undefined, controller.signal);
            if (controller.signal.aborted) return;
            if (!audio.size) throw new Error("渠道未返回音频");
            const subtype = /^audio\/(?:x-)?([a-z0-9]+)/.exec(audio.type)?.[1];
            const extension = subtype === "mpeg" ? "mp3" : subtype === "mp4" ? "m4a" : subtype || "audio";
            setResult({ url: URL.createObjectURL(audio), filename: `配音.${extension}`, userId: user.id, blob: audio, prompt: script, model });
        } catch (cause) {
            if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "配音生成失败，请重试");
        } finally {
            activeRequest.current = null;
            setRunning(false);
        }
    }

    return (
        <main className="h-full overflow-y-auto bg-background text-foreground">
            <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
                <header className="mb-7 border-b border-border pb-6">
                    <h1 className="text-3xl font-semibold tracking-tight">配音工作台</h1>
                    <p className="mt-2 text-sm text-muted-foreground">粘贴口播文案，使用后台配置的语音模型生成配音。</p>
                </header>

                <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
                    <div className="min-w-0 space-y-6">
                        <form className="space-y-4 rounded-xl border border-border p-5" onSubmit={(event) => { event.preventDefault(); void generate(); }}>
                            <label htmlFor="voice-script" className="block text-base font-medium">配音文案</label>
                            <Input.TextArea
                                id="voice-script"
                                value={script}
                                onChange={(event) => setScript(event.target.value)}
                                placeholder="粘贴要朗读的完整文案"
                                autoSize={{ minRows: 8, maxRows: 18 }}
                                showCount
                            />
                            <Button type="primary" htmlType="submit" icon={<Mic size={16} />} loading={running} disabled={!canGenerate}>
                                生成配音
                            </Button>
                            {error && <Alert title={error} type="error" showIcon />}
                        </form>

                        <section className="space-y-4 rounded-xl border border-border p-5" aria-labelledby="voice-result">
                            <h2 id="voice-result" className="text-base font-medium">试听与下载</h2>
                            {currentResult ? (
                                <>
                                    <audio aria-label="生成的配音" className="w-full" src={currentResult.url} controls preload="metadata" />
                                    <div className="flex flex-wrap gap-2">
                                        <Button href={currentResult.url} download={currentResult.filename} icon={<Download size={16} />}>下载音频</Button>
                                        <Button icon={<FolderPlus size={16} />} onClick={() => saveGeneratedAsset({
                                            kind: "audio", title: currentResult.filename, coverUrl: "", tags: [], source: "配音工作台",
                                            data: { url: currentResult.url, mimeType: currentResult.blob.type, bytes: currentResult.blob.size },
                                            metadata: { source: "voice-workbench", prompt: currentResult.prompt, model: currentResult.model },
                                        })}>保存到资产中心</Button>
                                    </div>
                                </>
                            ) : <p className="text-sm text-muted-foreground">生成完成后，音频会显示在这里。</p>}
                        </section>
                    </div>

                    <section className="min-w-0 space-y-4 rounded-xl border border-border p-5" aria-labelledby="voice-settings">
                        <h2 id="voice-settings" className="text-base font-medium">配音设置</h2>
                        {!isReady || settingsLoading ? (
                            <p className="text-sm text-muted-foreground">正在读取渠道配置…</p>
                        ) : !token || !user ? (
                            <>
                                <p className="text-sm text-muted-foreground">登录后可以使用后台配置的配音渠道。</p>
                                <Button href="/login?redirect=%2Fmusic">登录使用</Button>
                            </>
                        ) : !canUseChannels ? (
                            <Alert title="当前账号未开通后台模型渠道" type="info" showIcon />
                        ) : !modelSettings || !channelId ? (
                            <>
                                <Alert title={modelSettings ? "后台暂无可用的音频模型" : "未能读取后台渠道配置"} type="info" showIcon />
                                {user.role === "admin" && <Button href="/admin/settings">前往后台配置</Button>}
                            </>
                        ) : (
                            <>
                                <div className="space-y-2">
                                    <p className="text-sm text-muted-foreground">配音模型</p>
                                    <ModelPicker config={config} value={model} channelId={channelId} capability="audio" fullWidth
                                        onChange={(nextModel, nextChannelId) => setSelection({ model: nextModel, channelId: nextChannelId || "" })} />
                                </div>
                                <AudioSettingsPanel
                                    config={config}
                                    theme={theme}
                                    showTitle={false}
                                    className="space-y-4 border-t border-border pt-4"
                                    onConfigChange={(key, value) => setAudioSettings((settings) => ({ ...settings, [key]: value }))}
                                />
                            </>
                        )}
                    </section>
                </div>
            </div>
        </main>
    );
}
