import { createPortal } from 'react-dom';
import { Plus, Trash2, X } from 'lucide-react';
import { useUiStore } from '../../lib/ui-store';
import { generateId } from '../../utils';
import { useT } from '../../i18n';

// Situation-specific system prompts for study answers. The default rides on
// every NEW question (addQuestion in store/slices/llm.ts); an explicit node
// role still wins. Existing nodes are never rewritten.
export default function StudyPromptsModal() {
  const open = useUiStore((s) => s.studyPromptsOpen);
  const setOpen = useUiStore((s) => s.setStudyPromptsOpen);
  const prompts = useUiStore((s) => s.studyPrompts);
  const setPrompts = useUiStore((s) => s.setStudyPrompts);
  const defaultId = useUiStore((s) => s.studyDefaultPromptId);
  const setDefault = useUiStore((s) => s.setStudyDefaultPromptId);
  const t = useT();
  if (!open) return null;

  const update = (id: string, patch: Partial<{ name: string; prompt: string }>) =>
    setPrompts(prompts.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const remove = (id: string) => {
    setPrompts(prompts.filter((p) => p.id !== id));
    if (defaultId === id) setDefault(null);
  };
  const add = () => setPrompts([...prompts, { id: generateId(), name: '', prompt: '' }]);

  return createPortal((
    <div className="fixed inset-0 z-[88] bg-ink/30 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setOpen(false)}>
      <div className="bg-card rounded-2xl shadow-2xl border border-line w-[680px] max-h-[84vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-2 px-5 py-3.5 border-b border-line shrink-0">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-ink">{t('study.title')}</div>
            <div className="text-2xs text-ink-faint mt-0.5">{t('study.hint')}</div>
          </div>
          <button onClick={() => setOpen(false)} className="text-ink-faint hover:text-ink w-7 h-7 rounded-lg hover:bg-wash flex items-center justify-center transition-colors shrink-0">
            <X size={15} strokeWidth={1.75} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3 space-y-2.5">
          {prompts.map((p) => {
            const isDefault = defaultId === p.id;
            return (
              <div key={p.id} className={`border rounded-xl px-3 py-3 space-y-2 ${isDefault ? 'border-accent/50 bg-accent/[0.03]' : 'border-line bg-surface'}`}>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setDefault(isDefault ? null : p.id)}
                    title={t('study.default')}
                    className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                      isDefault ? 'border-accent bg-accent' : 'border-line-strong hover:border-accent'
                    }`}
                  >
                    {isDefault && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </button>
                  <input
                    value={p.name}
                    onChange={(e) => update(p.id, { name: e.target.value })}
                    placeholder={t('study.namePlaceholder')}
                    className="flex-1 text-sm font-medium text-ink bg-transparent focus:outline-none placeholder-ink-faint"
                  />
                  {isDefault && <span className="text-2xs text-accent bg-accent/10 px-1.5 py-0.5 rounded-full shrink-0">{t('study.default')}</span>}
                  <button onClick={() => remove(p.id)} title={t('common.delete')} className="text-ink-faint hover:text-red-500 w-6 h-6 rounded-full flex items-center justify-center transition-colors shrink-0">
                    <Trash2 size={13} strokeWidth={1.75} />
                  </button>
                </div>
                <textarea
                  value={p.prompt}
                  onChange={(e) => update(p.id, { prompt: e.target.value })}
                  placeholder={t('study.promptPlaceholder')}
                  rows={3}
                  className="w-full text-xs text-ink-muted bg-transparent focus:outline-none resize-y leading-relaxed placeholder-ink-faint"
                />
              </div>
            );
          })}
          {prompts.length === 0 && <p className="text-xs text-ink-faint italic py-2">{t('study.empty')}</p>}
        </div>
        <div className="flex items-center gap-2 px-5 py-3 border-t border-line shrink-0">
          <button onClick={add} className="flex items-center gap-1.5 text-xs text-accent hover:bg-accent/10 px-3 py-1.5 rounded-lg transition-colors">
            <Plus size={14} strokeWidth={1.75} /> {t('study.add')}
          </button>
          <div className="flex-1" />
          <button onClick={() => setDefault(null)} className="text-2xs text-ink-faint hover:text-ink-muted underline decoration-dotted transition-colors">
            {t('study.clearDefault')}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
