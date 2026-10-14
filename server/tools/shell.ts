export interface ToolNavigation { id: string; name: string; blurb: string }

const escape = (value: string): string => value.replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const style = `
:root{color-scheme:dark;--ink:#e7ecf5;--dim:#96a3b9;--line:#2a3446;--edge:#2a3446;--bg:#111722;--deep:#111722;--panel:#182130;--lit:#8ed6b0;--tools-accent:#8ed6b0}
*{box-sizing:border-box}body.tools-app{margin:0;max-width:none;padding:0;display:block;height:auto;min-height:100dvh;overflow:auto;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,sans-serif}
.tools-app a{color:inherit}.tools-app input,.tools-app select,.tools-app textarea,.tools-app button{font:inherit;color:var(--ink);background:#111a27;border:1px solid var(--line);border-radius:7px;padding:8px 10px;max-width:100%}
.tools-app button{cursor:pointer}.tools-app button:hover,.tools-app a:hover{border-color:var(--tools-accent)}.tools-app :focus-visible{outline:2px solid var(--tools-accent);outline-offset:3px}
.tools-app button:disabled{opacity:.5;cursor:not-allowed}.tools-skip{position:absolute;left:16px;top:-80px;z-index:20}.tools-skip:focus{top:12px;background:var(--panel);padding:8px}
.tools-topbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:16px;min-height:64px;padding:12px 24px;background:#151e2c;border-bottom:1px solid var(--line);font:14px/1.5 system-ui,sans-serif}
.tools-brand{font-size:17px;font-weight:700;text-decoration:none;white-space:nowrap}.tools-brand span{font-size:12px;font-weight:500;color:var(--dim);margin-left:8px}.tools-topbar .tools-actions{display:flex;gap:12px;align-items:center;margin-left:auto}.tools-topbar form{margin:0}.tools-topbar button{margin:0;padding:6px 12px}
.tools-frame{display:grid;grid-template-columns:210px minmax(0,1fr);min-height:calc(100dvh - 64px)}.tools-sidebar{padding:24px 14px;background:#141c29;border-right:1px solid var(--line)}.tools-nav-title{margin:0 12px 12px;color:var(--dim);font-size:11px;letter-spacing:.12em;text-transform:uppercase}
.tools-nav{display:flex;flex-direction:column;gap:6px}.tools-nav a{padding:10px 12px;border:1px solid transparent;border-radius:8px;text-decoration:none}.tools-nav a[aria-current=page]{background:#233344;border-color:#3b6556;color:#b9f0d1}.tools-nav .tools-pair{margin-top:18px;border-top:1px solid var(--line);border-radius:0;padding-top:18px}
.tools-main{padding:0;min-width:0;width:auto;max-width:none}.tools-page-heading{padding:24px 28px 18px;border-bottom:1px solid var(--line);background:var(--bg)}.tools-page-heading h1{font:600 24px/1.2 system-ui,sans-serif;letter-spacing:-.02em;margin:0}.tools-page-heading p{margin:8px 0 0;color:var(--dim);max-width:72ch}
.tools-world-context{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:18px}.tools-world-context label{margin:0;font-size:12px;color:var(--dim)}.tools-world-context select{min-width:240px;max-width:100%;width:auto}.tools-world-context small{color:var(--dim)}
.tools-workspace{padding:24px 28px;min-width:0}.tools-workspace .tool-header,.tools-workspace #tool-header{display:none}.tools-workspace>header{position:static;top:auto;padding:0 0 16px;background:none;border:0;display:flex;gap:10px;flex-wrap:wrap;align-items:center}.tools-workspace>main{padding:0;width:auto;max-width:none}.tools-workspace pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:14px;background:#111a27;border:1px solid var(--line);border-radius:8px}
.tools-workspace .card{display:block;padding:18px;margin:0;border:1px solid var(--line);border-radius:10px;background:var(--panel);text-decoration:none}.tools-workspace .card:hover{border-color:var(--tools-accent)}.tools-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:14px}.tools-workspace .blurb{color:var(--dim);font-size:13px;margin-top:8px}.tools-workspace .why{color:#ffb4a2}.tools-workspace label{margin:8px 8px 8px 0}.tools-workspace .tools-form{max-width:440px}.tools-form label{display:block}.tools-form input{width:100%}.tools-form button{margin-top:14px}
.tools-workspace--registry .parish{overflow:auto}.tools-workspace--registry table{font:12px/1.5 ui-monospace,monospace}.tools-workspace--world-editor canvas{max-width:100%}
.tools-workspace--character-builder{padding:0;display:grid;grid-template-columns:190px minmax(0,1fr) 340px;grid-template-rows:minmax(520px,calc(100dvh - 156px));height:calc(100dvh - 156px);min-height:520px;overflow:hidden}.tools-workspace--character-builder #list{grid-column:1;grid-row:1}.tools-workspace--character-builder #view{grid-column:2;grid-row:1;min-width:0;min-height:0}.tools-workspace--character-builder #ask{grid-column:3;grid-row:1;min-height:0}
.tools-app--signed-out .tools-frame{display:block}.tools-app--signed-out .tools-main{max-width:560px;margin:8vh auto}.tools-app--signed-out .tools-page-heading{border:0}
@media(max-width:1100px){.tools-workspace--character-builder{grid-template-columns:150px minmax(0,1fr);grid-template-rows:minmax(360px,1fr) 260px;height:calc(100dvh - 156px)}.tools-workspace--character-builder #list{grid-column:1;grid-row:1/3}.tools-workspace--character-builder #view{grid-column:2;grid-row:1}.tools-workspace--character-builder #ask{grid-column:2;grid-row:2}}
@media(max-width:760px){.tools-topbar{padding:12px 16px;gap:8px}.tools-brand span{display:none}.tools-frame{display:block}.tools-sidebar{padding:10px 12px;border-right:0;border-bottom:1px solid var(--line)}.tools-nav-title{display:none}.tools-nav{flex-direction:row;overflow:auto}.tools-nav a{white-space:nowrap;padding:7px 10px}.tools-nav .tools-pair{margin:0;padding:7px 10px;border:1px solid transparent;border-radius:8px}.tools-page-heading{padding:20px 16px 16px}.tools-workspace{padding:20px 16px}.tools-world-context select{min-width:0;width:100%}.tools-world-context{align-items:stretch}.tools-workspace--character-builder{padding:0;grid-template-columns:140px minmax(0,1fr);height:720px}.tools-topbar .tools-game-link{display:none}}
`;

/** The same surrounding application for every authenticated tool and its error/connection pages. */
export function toolsShell(options: {
  title: string; body: string; navigation: readonly ToolNavigation[];
  active?: string; signedIn?: boolean; head?: string; description?: string;
}): string {
  const { title, body, navigation, active = '', signedIn = true, head = '', description = '' } = options;
  const nav = [{ id: '', name: 'Overview' }, ...navigation, { id: 'build/pair', name: 'Connect builder' }];
  const links = nav.map(tool => `<a href="/tools/${tool.id}"${tool.id === active ? ' aria-current="page"' : ''}`
    + `${tool.id === 'build/pair' ? ' class="tools-pair"' : ''}>${escape(tool.name)}</a>`).join('');
  const workspace = active === 'character-builder' ? 'character-builder' : active === 'registry' ? 'registry'
    : active === 'world-editor' ? 'world-editor' : 'page';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${escape(title)} — ai.world tools</title>${head}<style data-tools-shell>${style}</style>`
    + `${signedIn ? '<script>window.toolsWorldsReady=new Promise((resolve,reject)=>{window.__toolsWorldsResolve=resolve;window.__toolsWorldsReject=reject;});window.toolsWorldsReady.catch(()=>{});</script>' : ''}</head>`
    + `<body class="tools-app${signedIn ? '' : ' tools-app--signed-out'}" data-tools-tool="${escape(active)}">`
    + `<a class="tools-skip" href="#tools-main">Skip to content</a><header class="tools-topbar">`
    + `<a class="tools-brand" href="/tools/">ai.world <span>Tools</span></a><div class="tools-actions">`
    + `<a class="tools-game-link" href="/">Open game</a>${signedIn ? '<form method="post" action="/tools/logout"><button type="submit">Sign out</button></form>' : ''}</div></header>`
    + `<div class="tools-frame">${signedIn ? `<aside class="tools-sidebar"><p class="tools-nav-title">Workspace</p><nav class="tools-nav" aria-label="Tools">${links}</nav></aside>` : ''}`
    + `<main class="tools-main" id="tools-main"><div class="tools-page-heading"><h1>${escape(title)}</h1>`
    + `${description ? `<p>${escape(description)}</p>` : ''}${signedIn ? '<div class="tools-world-context"><label for="tools-world">World</label><select id="tools-world" aria-label="Current world"><option value="">Loading worlds…</option></select><small id="tools-world-status" role="status"></small></div>' : ''}</div>`
    + `<section class="tools-workspace tools-workspace--${workspace}">${body}</section></main></div>`
    + `${signedIn ? '<script type="module" src="/tools/runtime.js" onerror="document.getElementById(\'tools-world-status\').textContent=\'The world catalogue could not load. Reload or sign in again.\';window.__toolsWorldsReject(new Error(\'The tools runtime could not load.\'));"></script>' : ''}</body></html>`;
}

/** Keep a tool's actual scripts and workspace, adding the shared application around it. */
export function toolDocument(document: string, title: string, active: string, navigation: readonly ToolNavigation[]): string {
  const head = (document.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '')
    .replace(/<title[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta[^>]*(?:charset|name=["']viewport["'])[^>]*>/gi, '');
  let body = document.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1]
    ?? document.replace(/<!doctype[^>]*>|<\/?html[^>]*>|<head[^>]*>[\s\S]*?<\/head>/gi, '');
  if (active === 'registry') body = body.replace(/<main>/, '<div class="tools-registry-results">').replace(/<\/main>/, '</div>');
  return toolsShell({ title, active, body, head, navigation });
}
