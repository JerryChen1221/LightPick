import { Image as ImageIcon, VideoCamera, FilmSlate, SpeakerHigh, TextT, PencilSimple, FilmStrip } from '@phosphor-icons/react';
import {
    capability,
    MODEL_CARDS,
    pickDefaultModel,
    type Modality,
} from '@lightpick/shared-types';

export interface PipelineMenuOption {
    id: string;
    label: string;
    icon: typeof ImageIcon;
    nodeType: string;
    /**
     * Spawn payload for the new node. Source-aware so the chosen default
     * model can actually consume the upstream node's modality (e.g. video
     * source → seedance-ref instead of sora-2). For modality-agnostic
     * options (video-editor, plain text), `sourceKind` is ignored.
     */
    getNodeData: (sourceKind?: Modality) => Record<string, unknown>;
    /**
     * Whether the option is sensible for a given source modality. Derived
     * from the model registry — an option is shown only if some model of
     * the right output kind can consume `sourceKind`. Modality-agnostic
     * options (video-editor) accept anything.
     */
    isCompatibleWithSource: (sourceKind?: Modality) => boolean;
}

/** Build the spawn payload for a generation action-badge. */
function buildGenNodeData(
    actionType: 'image-gen' | 'video-gen' | 'audio-gen' | 'text-gen',
    outputKind: 'image' | 'video' | 'audio' | 'text',
    sourceKind?: Modality,
): Record<string, unknown> {
    // Text generation is prompt-first in local/JoyBuilder deployments. Picking
    // a video-capable Gemini default from a video source makes the node look
    // valid but fail when Vertex credentials are not configured.
    const card = actionType === 'text-gen'
        ? pickDefaultModel({ outputKind })
        : pickDefaultModel({ outputKind, sourceKind });
    const modelId = card?.id ?? '';
    const labelByAction = {
        'image-gen': 'Image Prompt',
        'video-gen': 'Video Prompt',
        'audio-gen': 'Audio Prompt',
        'text-gen': 'Text Prompt',
    } as const;
    return {
        label: labelByAction[actionType],
        actionType,
        modelId,
        model: modelId,
        modelParams: { ...(card?.defaultParams ?? {}) },
        content: '# Prompt\nEnter your prompt here...',
    };
}

function buildKlingOmniNodeData(kind: 'edit' | 'camera-ref'): Record<string, unknown> {
    const card = MODEL_CARDS.find((item) => item.id === 'joybuilder-kling-v3-omni');
    const modelId = card?.id ?? 'joybuilder-kling-v3-omni';
    const baseParams = { ...(card?.defaultParams ?? {}) };
    if (kind === 'edit') {
        return {
            label: 'Edit Video',
            actionType: 'video-gen',
            modelId,
            model: modelId,
            modelParams: {
                ...baseParams,
                video_role: 'input_video',
                keep_original_sound: true,
                sound: false,
            },
            content: '给视频中的主体做一个清晰可见的编辑，例如添加道具、替换背景或调整风格。',
        };
    }
    return {
        label: 'Camera Reference',
        actionType: 'video-gen',
        modelId,
        model: modelId,
        modelParams: {
            ...baseParams,
            video_role: 'reference_video',
            keep_original_sound: true,
            sound: false,
        },
        content: '描述要生成的新主体、场景和动作；系统会自动参考上游视频的运镜、节奏和风格。',
    };
}

/**
 * Downstream-action options shared by SourceHandleMenu (on data nodes) and
 * ActionBadgePipelineMenu (on action-badge output handle).
 */
export const PIPELINE_MENU_OPTIONS: PipelineMenuOption[] = [
    {
        id: 'image-gen',
        label: 'Image Gen',
        icon: ImageIcon,
        nodeType: 'action-badge',
        getNodeData: (sourceKind) => buildGenNodeData('image-gen', 'image', sourceKind),
        // Visible only when some image-output model can consume the source.
        // Without a source (manual placement), always visible.
        isCompatibleWithSource: (sourceKind) => {
            if (!sourceKind) return true;
            const card = pickDefaultModel({ outputKind: 'image', sourceKind });
            return !!card && capability(card).ref[sourceKind].accepts;
        },
    },
    {
        id: 'video-gen',
        label: 'Video Gen',
        icon: VideoCamera,
        nodeType: 'action-badge',
        getNodeData: (sourceKind) => buildGenNodeData('video-gen', 'video', sourceKind),
        isCompatibleWithSource: (sourceKind) => {
            if (!sourceKind) return true;
            const card = pickDefaultModel({ outputKind: 'video', sourceKind });
            return !!card && capability(card).ref[sourceKind].accepts;
        },
    },
    {
        id: 'video-edit',
        label: 'Edit Video',
        icon: FilmSlate,
        nodeType: 'action-badge',
        getNodeData: () => buildKlingOmniNodeData('edit'),
        isCompatibleWithSource: (sourceKind) => sourceKind === 'video',
    },
    {
        id: 'camera-ref',
        label: 'Use as Camera Reference',
        icon: VideoCamera,
        nodeType: 'action-badge',
        getNodeData: () => buildKlingOmniNodeData('camera-ref'),
        isCompatibleWithSource: (sourceKind) => sourceKind === 'video',
    },
    {
        id: 'audio-gen',
        label: 'Audio Gen',
        icon: SpeakerHigh,
        nodeType: 'action-badge',
        getNodeData: (sourceKind) => buildGenNodeData('audio-gen', 'audio', sourceKind),
        // TTS is prompt-first today; keep this available as a downstream
        // lineage step even when the upstream media is not consumed as a ref.
        isCompatibleWithSource: () => true,
    },
    {
        id: 'text-gen',
        label: 'Text Gen',
        icon: TextT,
        nodeType: 'action-badge',
        getNodeData: (sourceKind) => buildGenNodeData('text-gen', 'text', sourceKind),
        isCompatibleWithSource: () => true,
    },
    {
        id: 'video-editor',
        label: 'Video Editor',
        icon: FilmSlate,
        nodeType: 'video-editor',
        getNodeData: () => ({ label: 'Video Editor', inputs: [] }),
        isCompatibleWithSource: () => true,
    },
    {
        id: 'image-editor',
        label: 'Image Editor',
        icon: PencilSimple,
        nodeType: 'image-editor',
        // Copy-on-write image editor (crop / rotate). Editor reads upstream
        // image's signed URL, renders via canvas, uploads as a new asset.
        getNodeData: () => ({ label: 'Image Editor' }),
        // Only meaningful with an image upstream — generation/audio/video/text
        // sources can't be CoW'd by the image editor.
        isCompatibleWithSource: (sourceKind) => sourceKind === 'image',
    },
    {
        id: 'video-clipper',
        label: 'Video Clipper',
        icon: FilmStrip,
        nodeType: 'video-clipper',
        getNodeData: () => ({ label: 'Video Clipper' }),
        isCompatibleWithSource: (sourceKind) => sourceKind === 'video',
    },
];
