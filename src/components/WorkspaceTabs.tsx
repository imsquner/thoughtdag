import { FileText, Map, X } from 'lucide-react';
import { useUiStore } from '../lib/ui-store';
import { useI18n } from '../i18n';
import { useStore } from '../store';

// The workspace switcher: the canvas is the permanent first tab; every
// material opened for reading becomes a closable tab beside it. The strip
// floats at the top centre, over both faces, so switching never means
// closing the reader and hunting for the node again.
export default function WorkspaceTabs() {
  const tabs = useUiStore((s) => s.materialTabs);
  const active = useUiStore((s) => s.activeWorkspaceTab);
  const setActive = useUiStore((s) => s.setActiveWorkspaceTab);
  const closeTab = useUiStore((s) => s.closeMaterialTab);
  const lang = useI18n((s) => s.lang);
  const nodes = useStore((s) => s.nodes);
  const canvasLabel = lang === 'zh' ? '画布' : 'Canvas';

  return (
    <div
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[55] max-w-[min(760px,70vw)] flex items-center gap-1 rounded-full border border-line bg-card/95 backdrop-blur px-1.5 py-1 shadow-sm"
      data-workspace-tabs
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => setActive('canvas')}
        className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full transition-colors shrink-0 ${
          active === 'canvas' ? 'bg-accent/10 text-accent font-medium' : 'text-ink-muted hover:bg-wash'
        }`}
        title={canvasLabel}
        data-workspace-tab="canvas"
      >
        <Map size={13} strokeWidth={1.75} />
        {canvasLabel}
      </button>
      {tabs.length > 0 && <div className="w-px h-4 bg-line shrink-0" />}
      <div className="flex items-center gap-1 overflow-x-auto min-w-0">
        {tabs.map((tab) => {
          const on = active === tab.nodeId;
          const node = nodes.find((n) => n.id === tab.nodeId);
          const title = node?.data.attachments?.[0]?.name || node?.data.linkTitle || tab.title || node?.data.question?.slice(0, 48) || (lang === 'zh' ? '材料' : 'Material');
          return (
            <div
              key={tab.nodeId}
              className={`group flex items-center gap-1 rounded-full pl-2.5 pr-1 py-1 shrink-0 max-w-[220px] transition-colors ${
                on ? 'bg-accent/10 text-accent' : 'text-ink-muted hover:bg-wash'
              }`}
              data-workspace-tab={tab.nodeId}
            >
              <button
                onClick={() => setActive(tab.nodeId)}
                className="flex items-center gap-1.5 text-xs min-w-0"
                title={title}
              >
                <FileText size={13} strokeWidth={1.75} className="shrink-0" />
                <span className="truncate">{title}</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab.nodeId); }}
                className="w-5 h-5 rounded-full flex items-center justify-center text-ink-faint hover:text-ink hover:bg-line/60 shrink-0"
                title={lang === 'zh' ? '关闭标签' : 'Close tab'}
              >
                <X size={11} strokeWidth={2} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
