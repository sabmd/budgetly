// Budgetly CRM: users, testers, support tickets and a contact pipeline, for Budgetly admins only.
// Data comes from Supabase with the admin's own sign-in; row-level security and the crm_admins list
// decide what can be read. Everything shown from the database is escaped before it reaches the page.

const { url, key } = window.BUDGETLY_CRM;
const sb = window.supabase.createClient(url, key, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' } });

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const DAY = 86400000;
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const ago = (d) => {
  if (!d) return 'never';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(d);
};
const daysSince = (d) => (d ? Math.floor((Date.now() - new Date(`${d}T00:00:00`).getTime()) / DAY) : null);
const addDays = (d, n) => new Date(new Date(`${d}T00:00:00`).getTime() + n * DAY).toISOString().slice(0, 10);

const TESTER_STAGES = ['invited', 'opted_in', 'active', 'dropped'];
const PIPELINE_STAGES = ['new', 'contacted', 'replied', 'negotiating', 'won', 'lost'];
const KINDS = ['lead', 'partner', 'influencer', 'press', 'user', 'tester', 'other'];
const STAGE_LABEL = { new: 'New', contacted: 'Contacted', replied: 'Replied', negotiating: 'Negotiating', won: 'Won', lost: 'Lost',
  invited: 'Invited', opted_in: 'Opted in', active: 'Active', dropped: 'Dropped' };
const STAGE_TONE = { won: 'good', active: 'good', opted_in: 'brand', lost: 'bad', dropped: 'bad', replied: 'brand', negotiating: 'gold', contacted: 'warn', invited: 'warn' };
const TICKET_TONE = { open: 'bad', waiting: 'warn', resolved: 'good' };
const CATEGORIES = { support: 'Support', bug: 'Bug', feedback: 'Feedback', account_deletion: 'Account deletion', billing: 'Billing', other: 'Other' };
const ACT_TYPES = { note: 'Note', email: 'Email', call: 'Call', meeting: 'Meeting', feedback: 'Feedback', task: 'To-do' };
const PLAY_TESTERS_NEEDED = 12;
const INVITE = `Hi! I'm testing my new app Budgetly before it goes on the Play Store. Could you help?
1. On your Android phone, open this link and tap "Become a tester": https://play.google.com/apps/testing/sa.budgetly.app
2. Then install Budgetly from the Play Store: https://play.google.com/store/apps/details?id=sa.budgetly.app
3. Please keep it installed for at least 14 days, and send any feedback to sv7n.sa@gmail.com.
Use the same Google account I invited (your Gmail address). Thanks!`;

const pill = (text, tone) => `<span class="pill ${tone || ''}">${esc(text)}</span>`;
const stagePill = (s) => pill(STAGE_LABEL[s] || s, STAGE_TONE[s]);
const tags = (list) => (list || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
const options = (list, value, labels = {}) => list.map((v) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(labels[v] || v)}</option>`).join('');

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const cache = { stats: null, users: null, contacts: null, tickets: null };

async function call(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}
const load = {
  stats: async () => (cache.stats = await call(sb.rpc('crm_stats'))),
  users: async () => (cache.users = await call(sb.rpc('crm_users'))),
  contacts: async () => (cache.contacts = await call(sb.from('crm_contacts').select('*').order('created_at', { ascending: false }))),
  tickets: async () => (cache.tickets = await call(sb.from('crm_tickets').select('*').order('created_at', { ascending: false }))),
  activities: (contactId) => call(sb.from('crm_activities').select('*').eq('contact_id', contactId).order('created_at', { ascending: false })),
};

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2600);
}
const fail = (e) => toast(e?.message || String(e));

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

function openDrawer(title, html) {
  $('#drawer-title').textContent = title;
  $('#drawer-body').innerHTML = html;
  $('#drawer').hidden = false;
  $('#drawer-backdrop').hidden = false;
  $('#drawer-close').focus();
  return $('#drawer-body');
}
function closeDrawer() {
  $('#drawer').hidden = true;
  $('#drawer-backdrop').hidden = true;
}
$('#drawer-close').addEventListener('click', closeDrawer);
$('#drawer-backdrop').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#drawer').hidden) closeDrawer(); });

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

const views = { overview, users, testers, support, pipeline };

async function route() {
  const name = (location.hash.slice(1) || 'overview').split('/')[0];
  const view = views[name] ? name : 'overview';
  $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.view === view));
  const main = $('#main');
  main.innerHTML = '<p class="muted">Loading…</p>';
  try {
    await views[view](main);
  } catch (e) {
    main.innerHTML = `<p class="error">${esc(e.message || e)}</p>`;
  }
  updateBadge();
}
window.addEventListener('hashchange', route);

function updateBadge() {
  const open = (cache.tickets || []).filter((t) => t.status !== 'resolved').length;
  const b = $('#nav-tickets');
  b.textContent = open;
  b.hidden = !open;
}

// Overview -------------------------------------------------------------------

async function overview(main) {
  const [s, contacts, tickets] = await Promise.all([load.stats(), load.contacts(), load.tickets()]);
  const due = contacts.filter((c) => c.next_follow_up && c.next_follow_up <= today()).sort((a, b) => a.next_follow_up.localeCompare(b.next_follow_up));
  const open = tickets.filter((t) => t.status !== 'resolved').slice(0, 6);
  main.innerHTML = `
    <div class="head"><h1>Overview</h1><button class="btn btn-light btn-small" id="refresh" type="button">Refresh</button></div>
    <div class="stats">
      ${stat('Users', s.users, `${s.profiles} with a username`)}
      ${stat('New this week', s.new_7d, `${s.new_30d} in 30 days`)}
      ${stat('Active this week', s.active_7d, `${s.active_30d} in 30 days`)}
      ${stat('Entries, 30 days', s.entries_30d, `${s.friendships} friendships · ${s.circles} circles`)}
      ${stat('Open tickets', s.open_tickets, 'Support requests')}
      ${stat('Testers opted in', `${s.testers_opted_in}/${PLAY_TESTERS_NEEDED}`, `${s.testers} on the list`)}
    </div>
    <div class="grid2">
      <div class="card"><h3>Last 30 days</h3>${chart(s.daily)}
        <div class="legend"><span><i class="dot" style="background:var(--brand)"></i>Sign-ups</span><span><i class="dot" style="background:var(--gold)"></i>Active users</span></div>
      </div>
      <div class="card"><h3>Follow-ups due (${due.length})</h3>
        <div class="list">${due.length ? due.map((c) => `
          <div class="item" data-contact="${esc(c.id)}"><div class="grow who"><b>${esc(c.name || c.email)}</b><span>${esc(c.kind)} · due ${fmtDate(c.next_follow_up)}</span></div>${stagePill(c.stage)}</div>`).join('') : '<p class="muted small">Nothing due. Set a follow-up date on any contact.</p>'}
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:12px"><h3>Open support requests</h3>
      <div class="list">${open.length ? open.map(ticketItem).join('') : '<p class="muted small">No open requests.</p>'}</div>
    </div>`;
  $('#refresh').onclick = route;
  $$('[data-contact]', main).forEach((el) => (el.onclick = () => contactDrawer(contacts.find((c) => c.id === el.dataset.contact))));
  $$('[data-ticket]', main).forEach((el) => (el.onclick = () => ticketDrawer(tickets.find((t) => t.id === el.dataset.ticket))));
}

const stat = (label, num, sub) => `<div class="card stat"><div class="lbl">${esc(label)}</div><div class="num">${esc(num)}</div><div class="sub">${esc(sub)}</div></div>`;

/** Sign-up bars with an active-users line, as inline SVG. */
function chart(daily) {
  const w = 600, h = 170, pad = 22;
  const max = Math.max(1, ...daily.map((d) => Math.max(d.signups, d.active)));
  const bw = (w - pad) / daily.length;
  const y = (v) => h - 18 - (v / max) * (h - 34);
  const bars = daily.map((d, i) => `<rect x="${pad + i * bw + 2}" y="${y(d.signups)}" width="${Math.max(2, bw - 4)}" height="${h - 18 - y(d.signups)}" rx="2" fill="var(--brand)"><title>${esc(d.day)}: ${d.signups} sign-ups, ${d.active} active</title></rect>`).join('');
  const line = daily.map((d, i) => `${pad + i * bw + bw / 2},${y(d.active)}`).join(' ');
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Sign-ups and active users per day for the last 30 days">
    <line x1="${pad}" x2="${w}" y1="${h - 18}" y2="${h - 18}" stroke="var(--line)"/>
    <text x="0" y="${y(max) + 4}" font-size="10" fill="var(--faint)">${max}</text><text x="0" y="${h - 14}" font-size="10" fill="var(--faint)">0</text>
    ${bars}<polyline points="${line}" fill="none" stroke="var(--gold)" stroke-width="2"/>
    <text x="${pad}" y="${h - 2}" font-size="10" fill="var(--faint)">${esc(fmtDate(daily[0]?.day))}</text>
    <text x="${w}" y="${h - 2}" font-size="10" fill="var(--faint)" text-anchor="end">Today</text></svg>`;
}

// Users ----------------------------------------------------------------------

const USER_FILTERS = {
  all: () => true,
  active: (u) => u.entries_30d > 0,
  inactive: (u) => !u.entries_30d,
  noprofile: (u) => !u.has_profile,
  testers: (u) => u.contact_kind === 'tester',
};
let userFilter = 'all';
let userQuery = '';

async function users(main) {
  await Promise.all([load.users(), cache.contacts ? null : load.contacts()]);
  main.innerHTML = `
    <div class="head"><h1>Users <span class="muted" id="user-count"></span></h1></div>
    <div class="toolbar">
      <input type="search" id="user-q" placeholder="Search name, username or email" value="${esc(userQuery)}" aria-label="Search users">
      <div class="chips">${[['all', 'All'], ['active', 'Active (30 days)'], ['inactive', 'Inactive'], ['noprofile', 'No username yet'], ['testers', 'Testers']]
        .map(([k, l]) => `<button class="chip${k === userFilter ? ' on' : ''}" data-f="${k}" type="button">${l}</button>`).join('')}</div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>User</th><th>Signed up</th><th>Last sign-in</th><th class="num">Entries (30d)</th><th class="num">Friends</th><th class="num">Circles</th><th>Sign-in</th><th>CRM</th></tr></thead>
      <tbody id="user-rows"></tbody></table></div>`;
  const draw = () => {
    const q = userQuery.trim().toLowerCase();
    const rows = cache.users.filter(USER_FILTERS[userFilter]).filter((u) => !q || [u.email, u.username, u.display_name].some((v) => (v || '').toLowerCase().includes(q)));
    $('#user-count').textContent = `(${rows.length})`;
    $('#user-rows').innerHTML = rows.length ? rows.map((u) => `
      <tr data-user="${esc(u.id)}">
        <td class="who"><b>${esc(u.display_name || u.email)}</b><span>${u.username ? '@' + esc(u.username) + ' · ' : ''}${esc(u.email)}</span></td>
        <td>${fmtDate(u.signed_up_at)}</td><td>${esc(ago(u.last_sign_in_at))}</td>
        <td class="num">${u.entries} <span class="muted">(${u.entries_30d})</span></td><td class="num">${u.friends}</td><td class="num">${u.circles}</td>
        <td>${pill(u.provider)}</td><td>${u.contact_kind ? pill(u.contact_kind, 'brand') : ''}${tags(u.tags)}</td>
      </tr>`).join('') : '<tr><td colspan="8" class="empty">No users match.</td></tr>';
    $$('[data-user]').forEach((tr) => (tr.onclick = () => userDrawer(cache.users.find((u) => u.id === tr.dataset.user))));
  };
  $('#user-q').oninput = (e) => { userQuery = e.target.value; draw(); };
  $$('[data-f]', main).forEach((b) => (b.onclick = () => { userFilter = b.dataset.f; $$('[data-f]', main).forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
  draw();
}

function userDrawer(u) {
  const contact = (cache.contacts || []).find((c) => c.id === u.contact_id);
  const body = openDrawer(u.display_name || u.email, `
    <div class="muted">${u.username ? '@' + esc(u.username) + ' · ' : ''}<a href="mailto:${esc(u.email)}">${esc(u.email)}</a></div>
    <div class="facts">
      ${fact('Signed up', fmtDate(u.signed_up_at))}${fact('Last sign-in', ago(u.last_sign_in_at))}
      ${fact('Entries', `${u.entries} (${u.entries_30d} in 30 days)`)}${fact('Last entry', ago(u.last_entry_at))}
      ${fact('Friends', u.friends)}${fact('Circles', u.circles)}
      ${fact('Shared bills started', u.shared_bills)}${fact('Synced friends, splits, IOUs', u.records)}
      ${fact('Signs in with', u.provider)}${fact('Currency', u.currency || '—')}
    </div>
    <p class="muted small">Amounts and entry details stay private: the CRM only shows counts and dates.</p>
    <div id="user-crm"></div>`);
  if (contact) contactPanel($('#user-crm', body), contact);
  else {
    $('#user-crm', body).innerHTML = '<button class="btn" id="add-user-contact" type="button">Add to CRM for notes and follow-ups</button>';
    $('#add-user-contact', body).onclick = async () => {
      try {
        const c = await call(sb.from('crm_contacts').insert({ kind: 'user', name: u.display_name || '', email: u.email, user_id: u.id, stage: 'new', source: 'Budgetly sign-up' }).select().single());
        cache.contacts = [c, ...(cache.contacts || [])];
        u.contact_id = c.id;
        u.contact_kind = c.kind;
        contactPanel($('#user-crm', body), c);
      } catch (e) { fail(e); }
    };
  }
}
const fact = (k, v) => `<div class="fact"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`;

// Contacts (shared by users, testers and the pipeline) ----------------------

function contactDrawer(c) {
  const body = openDrawer(c.id ? (c.name || c.email || 'Contact') : 'New contact', '<div id="contact-panel"></div>');
  contactPanel($('#contact-panel', body), c);
}

/** Edit form plus activity log for one contact. `c` without an id creates a new contact. */
function contactPanel(el, c) {
  const isTester = c.kind === 'tester';
  const stages = isTester ? TESTER_STAGES : PIPELINE_STAGES;
  el.innerHTML = `
    <form class="form" id="contact-form">
      <div class="two"><label>Name<input name="name" value="${esc(c.name)}" maxlength="80"></label>
        <label>Email<input name="email" type="email" value="${esc(c.email)}" maxlength="120"></label></div>
      <div class="two"><label>Type<select name="kind">${options(KINDS, c.kind)}</select></label>
        <label>Stage<select name="stage">${options(stages, c.stage, STAGE_LABEL)}</select></label></div>
      <div class="two"><label>Company<input name="company" value="${esc(c.company)}" maxlength="80"></label>
        <label>Phone<input name="phone" value="${esc(c.phone)}" maxlength="30"></label></div>
      <div class="two"><label>Source<input name="source" value="${esc(c.source)}" maxlength="60" placeholder="e.g. Instagram, referral"></label>
        <label>Follow up on<input name="next_follow_up" type="date" value="${esc(c.next_follow_up)}"></label></div>
      ${isTester ? `<label>Opted in to the Play test on<input name="opted_in_on" type="date" value="${esc(c.opted_in_on)}"></label>` : ''}
      <label>Tags (comma separated)<input name="tags" value="${esc((c.tags || []).join(', '))}"></label>
      <label>Notes<textarea name="notes" maxlength="4000">${esc(c.notes)}</textarea></label>
      <div class="row"><button class="btn" type="submit">${c.id ? 'Save' : 'Add contact'}</button>
        ${c.id ? '<button class="btn btn-light" type="button" id="contact-delete">Delete</button>' : ''}</div>
    </form>
    ${c.id ? `<h3>Activity</h3>
    <form class="form" id="act-form">
      <div class="two"><label>Type<select name="type">${options(Object.keys(ACT_TYPES), isTester ? 'feedback' : 'note', ACT_TYPES)}</select></label>
        <label>Due (for to-dos)<input name="due_on" type="date"></label></div>
      <label>What happened?<textarea name="body" required maxlength="4000" placeholder="e.g. Sent the invite on WhatsApp"></textarea></label>
      <div><button class="btn btn-small" type="submit">Add to timeline</button></div>
    </form>
    <div class="timeline" id="timeline"><p class="muted small">Loading…</p></div>` : ''}`;

  // Changing the type swaps the stage list (testers have their own).
  $('[name=kind]', el).onchange = (e) => {
    const list = e.target.value === 'tester' ? TESTER_STAGES : PIPELINE_STAGES;
    $('[name=stage]', el).innerHTML = options(list, list[0], STAGE_LABEL);
  };

  $('#contact-form', el).onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const row = {
      name: f.name.trim(), email: f.email.trim() || null, kind: f.kind, stage: f.stage, company: f.company.trim() || null,
      phone: f.phone.trim() || null, source: f.source.trim() || null, next_follow_up: f.next_follow_up || null,
      tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), notes: f.notes,
    };
    if ('opted_in_on' in f) row.opted_in_on = f.opted_in_on || null;
    if (row.kind === 'tester' && ['opted_in', 'active'].includes(row.stage) && !row.opted_in_on && !c.opted_in_on) row.opted_in_on = today();
    try {
      const saved = c.id
        ? await call(sb.from('crm_contacts').update(row).eq('id', c.id).select().single())
        : await call(sb.from('crm_contacts').insert({ ...row, user_id: c.user_id || null }).select().single());
      cache.contacts = [saved, ...(cache.contacts || []).filter((x) => x.id !== saved.id)];
      toast(c.id ? 'Saved' : 'Contact added');
      if (!c.id) contactDrawer(saved);
      route();
    } catch (err) { fail(err); }
  };

  if (!c.id) return;
  $('#contact-delete', el).onclick = async () => {
    if (!confirm(`Delete ${c.name || c.email || 'this contact'} and their activity?`)) return;
    try {
      await call(sb.from('crm_contacts').delete().eq('id', c.id));
      cache.contacts = cache.contacts.filter((x) => x.id !== c.id);
      closeDrawer();
      toast('Deleted');
      route();
    } catch (err) { fail(err); }
  };
  $('#act-form', el).onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      await call(sb.from('crm_activities').insert({ contact_id: c.id, type: f.type, body: f.body.trim(), due_on: f.due_on || null }));
      e.target.reset();
      drawTimeline(el, c);
    } catch (err) { fail(err); }
  };
  drawTimeline(el, c);
}

async function drawTimeline(el, c) {
  const box = $('#timeline', el);
  try {
    const acts = await load.activities(c.id);
    box.innerHTML = acts.length ? acts.map((a) => `
      <div class="act${a.done ? ' done' : ''}">
        <div class="meta"><span>${pill(ACT_TYPES[a.type] || a.type, a.type === 'feedback' ? 'brand' : '')} ${a.due_on ? 'due ' + fmtDate(a.due_on) : ''}</span>
          <span>${esc(ago(a.created_at))} ${a.type === 'task' ? `<button class="link" data-done="${esc(a.id)}" type="button">${a.done ? 'Reopen' : 'Done'}</button>` : ''}
          <button class="link" data-del="${esc(a.id)}" type="button" aria-label="Delete">✕</button></span></div>
        <p>${esc(a.body)}</p>
      </div>`).join('') : '<p class="muted small">Nothing logged yet.</p>';
    $$('[data-done]', box).forEach((b) => (b.onclick = async () => {
      const a = acts.find((x) => x.id === b.dataset.done);
      try { await call(sb.from('crm_activities').update({ done: !a.done }).eq('id', a.id)); drawTimeline(el, c); } catch (e) { fail(e); }
    }));
    $$('[data-del]', box).forEach((b) => (b.onclick = async () => {
      try { await call(sb.from('crm_activities').delete().eq('id', b.dataset.del)); drawTimeline(el, c); } catch (e) { fail(e); }
    }));
  } catch (e) {
    box.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

// Testers --------------------------------------------------------------------

async function testers(main) {
  await load.contacts();
  const list = cache.contacts.filter((c) => c.kind === 'tester').sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''));
  const joined = list.filter((c) => ['opted_in', 'active'].includes(c.stage) && c.opted_in_on).sort((a, b) => a.opted_in_on.localeCompare(b.opted_in_on));
  const ready = joined.length >= PLAY_TESTERS_NEEDED ? addDays(joined[PLAY_TESTERS_NEEDED - 1].opted_in_on, 14) : null;
  main.innerHTML = `
    <div class="head"><h1>Testers <span class="muted">(${list.length})</span></h1>
      <div class="row"><button class="btn btn-light btn-small" id="copy-invite" type="button">Copy invite message</button>
        <button class="btn btn-small" id="add-tester" type="button">Add tester</button></div></div>
    <div class="stats">
      ${stat('Opted in', `${joined.length}/${PLAY_TESTERS_NEEDED}`, 'Google needs 12 for 14 days in a row')}
      ${stat('Earliest production request', ready ? fmtDate(ready) : '—', ready ? (ready <= today() ? 'You can apply now' : `${daysSince(today()) - daysSince(ready)} days to go`) : `${Math.max(0, PLAY_TESTERS_NEEDED - joined.length)} more need to opt in`)}
      ${stat('Dropped', list.filter((c) => c.stage === 'dropped').length, 'Leaving resets their 14 days')}
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Tester</th><th>Stage</th><th>Opted in</th><th>14 days</th><th>Follow up</th><th>Tags</th></tr></thead>
      <tbody>${list.length ? list.map((c) => {
        const d = Math.min(14, daysSince(c.opted_in_on) ?? 0);
        const on = ['opted_in', 'active'].includes(c.stage) && c.opted_in_on;
        return `<tr data-contact="${esc(c.id)}">
          <td class="who"><b>${esc(c.name || c.email)}</b><span>${esc(c.name ? c.email : '')}</span></td>
          <td><select data-stage="${esc(c.id)}" aria-label="Stage">${options(TESTER_STAGES, c.stage, STAGE_LABEL)}</select></td>
          <td>${fmtDate(c.opted_in_on)}</td>
          <td>${on ? `<div class="row"><div class="bar grow"><i style="width:${(d / 14) * 100}%"></i></div><span class="small">${d}/14</span></div>` : '<span class="muted small">not started</span>'}</td>
          <td>${c.next_follow_up ? fmtDate(c.next_follow_up) : ''}</td><td>${tags(c.tags)}</td></tr>`;
      }).join('') : '<tr><td colspan="6" class="empty">No testers yet. Add the people you invited to the closed test.</td></tr>'}</tbody></table></div>
    <p class="muted small">Play Console doesn't share who has opted in, so mark each tester as "Opted in" when they confirm. The 14 days count from that date.</p>`;
  $('#copy-invite').onclick = async () => { try { await navigator.clipboard.writeText(INVITE); toast('Invite message copied'); } catch { prompt('Copy the invite:', INVITE); } };
  $('#add-tester').onclick = () => contactDrawer({ kind: 'tester', stage: 'invited', tags: [] });
  $$('tr[data-contact]', main).forEach((tr) => (tr.onclick = (e) => { if (e.target.closest('select')) return; contactDrawer(list.find((c) => c.id === tr.dataset.contact)); }));
  $$('[data-stage]', main).forEach((s) => (s.onchange = async () => {
    const c = list.find((x) => x.id === s.dataset.stage);
    const patch = { stage: s.value };
    if (['opted_in', 'active'].includes(s.value) && !c.opted_in_on) patch.opted_in_on = today();
    try { await call(sb.from('crm_contacts').update(patch).eq('id', c.id)); toast('Updated'); route(); } catch (e) { fail(e); }
  }));
}

// Support --------------------------------------------------------------------

let ticketFilter = 'open';

function ticketItem(t) {
  return `<div class="item" data-ticket="${esc(t.id)}">
    <div class="grow who"><b>${esc(t.subject)}</b><span>${esc(t.email || 'no email')} · ${esc(ago(t.created_at))}</span></div>
    ${pill(CATEGORIES[t.category] || t.category, t.category === 'account_deletion' ? 'gold' : '')} ${pill(t.status, TICKET_TONE[t.status])}
    ${t.priority === 'high' ? pill('High', 'bad') : ''}</div>`;
}

async function support(main) {
  await load.tickets();
  main.innerHTML = `
    <div class="head"><h1>Support</h1><button class="btn btn-small" id="new-ticket" type="button">New request</button></div>
    <div class="toolbar"><div class="chips">${[['open', 'Open'], ['waiting', 'Waiting on user'], ['resolved', 'Resolved'], ['all', 'All']]
      .map(([k, l]) => `<button class="chip${k === ticketFilter ? ' on' : ''}" data-tf="${k}" type="button">${l}</button>`).join('')}</div></div>
    <div class="list" id="tickets"></div>`;
  const draw = () => {
    const rows = cache.tickets.filter((t) => ticketFilter === 'all' || t.status === ticketFilter);
    $('#tickets').innerHTML = rows.length ? rows.map(ticketItem).join('') : '<p class="empty">Nothing here.</p>';
    $$('[data-ticket]', main).forEach((el) => (el.onclick = () => ticketDrawer(cache.tickets.find((t) => t.id === el.dataset.ticket))));
  };
  $$('[data-tf]', main).forEach((b) => (b.onclick = () => { ticketFilter = b.dataset.tf; $$('[data-tf]', main).forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
  $('#new-ticket').onclick = () => ticketDrawer({ status: 'open', priority: 'normal', category: 'support' });
  draw();
}

function ticketDrawer(t) {
  const isNew = !t.id;
  const body = openDrawer(isNew ? 'New support request' : t.subject, `
    ${isNew ? '' : `<div class="muted small">From ${t.email ? `<a href="mailto:${esc(t.email)}?subject=${encodeURIComponent('Re: ' + t.subject)}">${esc(t.email)}</a>` : 'unknown'} · ${esc(fmtDate(t.created_at))}${t.resolved_at ? ' · resolved ' + esc(fmtDate(t.resolved_at)) : ''}</div>
      <div class="quote">${esc(t.body || '(no message)')}</div>`}
    ${t.category === 'account_deletion' ? `<p class="small muted">To delete the account: Supabase → Authentication → Users → find ${esc(t.email || 'the email')} → Delete user. Everything linked to it is removed. Then reply to confirm and mark this resolved.</p>` : ''}
    <form class="form" id="ticket-form">
      ${isNew ? `<label>Email<input name="email" type="email" required maxlength="120"></label>
        <label>Subject<input name="subject" required maxlength="120"></label>
        <label>Message<textarea name="body" maxlength="4000"></textarea></label>` : ''}
      <div class="two"><label>Category<select name="category">${options(Object.keys(CATEGORIES), t.category, CATEGORIES)}</select></label>
        <label>Priority<select name="priority">${options(['low', 'normal', 'high'], t.priority)}</select></label></div>
      <label>Status<select name="status">${options(['open', 'waiting', 'resolved'], t.status, { open: 'Open', waiting: 'Waiting on user', resolved: 'Resolved' })}</select></label>
      <label>Reply to the user<textarea name="reply" maxlength="4000">${esc(t.reply)}</textarea>
        <span class="small muted" style="font-weight:400">${t.user_id ? 'Shown to them in the Budgetly app under Help &amp; feedback once you save. Don’t put internal notes here.' : 'Not linked to an app account, so send it with Email reply.'}</span></label>
      <div class="row"><button class="btn" type="submit">${isNew ? 'Add request' : 'Save'}</button>
        ${!isNew && t.email ? `<a class="btn btn-light" id="mail-reply" href="#">Email reply</a>` : ''}
        ${!isNew ? '<button class="btn btn-light" type="button" id="ticket-delete">Delete</button>' : ''}</div>
    </form>`);
  $('#ticket-form', body).onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const row = { category: f.category, priority: f.priority, status: f.status, reply: f.reply };
    try {
      if (isNew) await call(sb.from('crm_tickets').insert({ ...row, email: f.email.trim(), subject: f.subject.trim(), body: f.body }));
      else await call(sb.from('crm_tickets').update(row).eq('id', t.id));
      toast('Saved');
      closeDrawer();
      route();
    } catch (err) { fail(err); }
  };
  if (isNew) return;
  const mail = $('#mail-reply', body);
  if (mail) mail.onclick = (e) => {
    e.preventDefault();
    const reply = $('[name=reply]', body).value;
    location.href = `mailto:${encodeURIComponent(t.email)}?subject=${encodeURIComponent('Re: ' + t.subject)}&body=${encodeURIComponent(reply)}`;
  };
  $('#ticket-delete', body).onclick = async () => {
    if (!confirm('Delete this request?')) return;
    try { await call(sb.from('crm_tickets').delete().eq('id', t.id)); closeDrawer(); toast('Deleted'); route(); } catch (err) { fail(err); }
  };
}

// Pipeline -------------------------------------------------------------------

let pipelineKind = 'all';

async function pipeline(main) {
  await load.contacts();
  const kinds = ['lead', 'partner', 'influencer', 'press', 'other'];
  const list = cache.contacts.filter((c) => kinds.includes(c.kind) && (pipelineKind === 'all' || c.kind === pipelineKind));
  main.innerHTML = `
    <div class="head"><h1>Pipeline</h1><button class="btn btn-small" id="add-contact" type="button">Add contact</button></div>
    <div class="toolbar"><div class="chips">${[['all', 'All'], ...kinds.map((k) => [k, k[0].toUpperCase() + k.slice(1) + 's'])]
      .map(([k, l]) => `<button class="chip${k === pipelineKind ? ' on' : ''}" data-k="${k}" type="button">${l}</button>`).join('')}</div>
      <span class="muted small">Drag cards between columns, or open one to change its stage.</span></div>
    <div class="board">${PIPELINE_STAGES.map((s) => {
      const cards = list.filter((c) => c.stage === s);
      return `<div class="col" data-col="${s}"><h3><span>${STAGE_LABEL[s]}</span><span>${cards.length}</span></h3>
        ${cards.map((c) => `<div class="kcard" draggable="true" data-card="${esc(c.id)}"><b>${esc(c.name || c.email)}</b>
          <span class="small">${esc([c.company, c.kind].filter(Boolean).join(' · '))}</span>
          ${c.next_follow_up ? `<span class="small">${c.next_follow_up <= today() ? pill('Follow up ' + fmtDate(c.next_follow_up), 'bad') : 'Follow up ' + esc(fmtDate(c.next_follow_up))}</span>` : ''}
          <div>${tags(c.tags)}</div></div>`).join('')}</div>`;
    }).join('')}</div>`;
  $('#add-contact').onclick = () => contactDrawer({ kind: pipelineKind === 'all' ? 'lead' : pipelineKind, stage: 'new', tags: [] });
  $$('[data-k]', main).forEach((b) => (b.onclick = () => { pipelineKind = b.dataset.k; route(); }));
  $$('[data-card]', main).forEach((card) => {
    card.onclick = () => contactDrawer(list.find((c) => c.id === card.dataset.card));
    card.ondragstart = (e) => e.dataTransfer.setData('text/plain', card.dataset.card);
  });
  $$('[data-col]', main).forEach((col) => {
    col.ondragover = (e) => { e.preventDefault(); col.classList.add('drop'); };
    col.ondragleave = () => col.classList.remove('drop');
    col.ondrop = async (e) => {
      e.preventDefault();
      col.classList.remove('drop');
      const id = e.dataTransfer.getData('text/plain');
      try { await call(sb.from('crm_contacts').update({ stage: col.dataset.col }).eq('id', id)); route(); } catch (err) { fail(err); }
    };
  });
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

function show(id) {
  ['login', 'denied', 'app'].forEach((s) => ($(`#${s}`).hidden = s !== id));
}

async function start(session) {
  if (!session) return show('login');
  try {
    const admin = await call(sb.rpc('is_crm_admin'));
    if (!admin) {
      $('#denied-email').textContent = session.user.email;
      return show('denied');
    }
  } catch (e) {
    $('#login-error').textContent = e.message;
    return show('login');
  }
  $('#me').textContent = session.user.email;
  show('app');
  route();
}

$('#login-form').onsubmit = async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-password').value });
  if (error) $('#login-error').textContent = error.message;
};
$('#google').onclick = async () => {
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
  if (error) $('#login-error').textContent = error.message;
};
$$('[data-signout]').forEach((b) => (b.onclick = async () => { await sb.auth.signOut(); cache.users = cache.contacts = cache.tickets = null; show('login'); }));

let started; // undefined until the first auth event, so a signed-out first visit still shows sign-in
sb.auth.onAuthStateChange((event, session) => {
  // Start once per signed-in user; token refreshes don't redraw the page.
  const uid = session?.user.id ?? null;
  if (uid === started && event !== 'SIGNED_OUT') return;
  started = uid;
  start(session);
});
