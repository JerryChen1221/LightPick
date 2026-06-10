/**
 * Re-export all types from shared-layout.
 */
export * from '@lightpick/shared-layout';

// React-specific config — stays in the frontend.
// The callback uses `any[]` so that callers can pass reactflow `Node[]`
// without explicit casts.
export interface LayoutManagerConfig {
    mesh: Partial<import('@lightpick/shared-layout').MeshConfig>;
    autoScale: boolean;
    autoResolveCollisions: boolean;
    maxChainReactionIterations: number;
    onNodesMutated?: (prevNodes: any[], nextNodes: any[]) => void;
}
