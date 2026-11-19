import { CircleCheck, CircleAlert, LoaderCircle, Wrench } from 'lucide-react';
import { useLang } from '../lang';
import { t } from '../i18n';
import type { ToolState } from '../opencode/sessionStore';
import { toolOutputPreview, toolTitle } from '../opencode/sessionStore';

export function ToolTimeline({ tools }: { tools: ToolState[] }) {
  const lang = useLang().lang;
  if (!tools.length) return null;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {tools.map((tool) => {
        const statusCls = tool.status === 'success' ? 'ready' : tool.status === 'failed' ? 'failed' : tool.status === 'pending' ? 'queued' : 'running';
        return (
          <div className="panel tool-card" key={tool.id}>
            <div className="panel-head">
              <div className="panel-ico"><Wrench aria-hidden size={15} /></div>
              <div style={{ minWidth: 0 }}>
                <div className="panel-title" title={tool.name}>{toolTitle(tool)}</div>
                <div className="panel-meta">{t(lang, 'toolChrome')} · {tool.id.slice(0, 18)}</div>
              </div>
              <span className={`chip ${statusCls}`}>
                <span className="cdot" />
                <span>{tool.status === 'success' ? t(lang, 'toolSuccess') : tool.status === 'failed' ? t(lang, 'toolFailed') : tool.status === 'pending' ? t(lang, 'toolPending') : t(lang, 'toolRunning')}</span>
              </span>
            </div>
            <div className="panel-body">
              <ul className="steps">
                <li className={tool.status === 'called' ? 'active' : tool.status === 'pending' ? 'pending' : ''}>
                  {tool.status === 'called' || tool.status === 'running' ? <span className="step-dot" /> : tool.status === 'success' ? <CircleCheck size={13} /> : tool.status === 'failed' ? <CircleAlert size={13} /> : <LoaderCircle size={13} />}
                  <span>{tool.status === 'success' ? t(lang, 'toolSuccess') : tool.status === 'failed' ? t(lang, 'toolFailed') : tool.status === 'called' ? 'called' : t(lang, 'toolRunning')}</span>
                </li>
              </ul>
              {tool.error && <div className="tool-output" style={{ color: 'var(--danger)' }}>{tool.error}</div>}
              {tool.output != null && tool.status === 'success' && (
                <pre className="tool-output">{toolOutputPreview(tool.output).slice(0, 900)}</pre>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
