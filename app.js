/* ═══════════════════════════════════════════════════════════════════════════
   ConciergeX — app.js
   Pure vanilla JS, no dependencies, no build step.
   Calls OpenAI Chat Completions API directly from the browser.
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

// ── State ────────────────────────────────────────────────────────────────────

let currentPlan        = null;   // Holds the last generated EventPlan object
let activeCommKey      = 'saveTheDate';
let actionChecked      = {};
let checklistChecked   = {};

// ── API Key Management ───────────────────────────────────────────────────────

function getApiKey() {
  return sessionStorage.getItem('cx_api_key') || '';
}

function saveApiKey() {
  const input = document.getElementById('api-key-input');
  const key   = input.value.trim();
  if (!key.startsWith('sk-') && !key.startsWith('sk-proj-')) {
    alert('That doesn\'t look like a valid OpenAI key. It should start with "sk-".');
    return;
  }
  sessionStorage.setItem('cx_api_key', key);
  document.getElementById('api-key-banner').classList.add('hidden');
  input.value = '';
}

// On page load — if key already saved, hide the banner
(function initApiKey() {
  if (getApiKey()) {
    document.getElementById('api-key-banner').classList.add('hidden');
  }
})();

// ── View Switching ───────────────────────────────────────────────────────────

function showView(id) {
  ['view-form', 'view-loading', 'view-error', 'view-results'].forEach(v => {
    document.getElementById(v).classList.add('hidden');
  });
  document.getElementById(id).classList.remove('hidden');
}

function showForm() {
  showView('view-form');
  document.getElementById('btn-new-event').classList.add('hidden');
}

function resetApp() {
  currentPlan      = null;
  actionChecked    = {};
  checklistChecked = {};
  showForm();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Form Submit ──────────────────────────────────────────────────────────────

async function handleSubmit(e) {
  e.preventDefault();

  const apiKey = getApiKey();
  if (!apiKey) {
    document.getElementById('api-key-banner').classList.remove('hidden');
    document.getElementById('api-key-input').focus();
    document.getElementById('api-key-banner').scrollIntoView({ behavior: 'smooth' });
    return;
  }

  const brief = {
    eventName:          val('eventName'),
    eventType:          val('eventType'),
    objective:          val('objective'),
    date:               val('eventDate'),
    location:           val('location'),
    expectedAttendees:  val('attendees'),
    budget:             val('budget'),
    targetAudience:     val('audience'),
    speakers:           val('speakers'),
    additionalNotes:    val('notes'),
  };

  showView('view-loading');
  document.getElementById('btn-new-event').classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  try {
    const plan = await generatePlan(apiKey, brief);
    currentPlan = plan;
    renderPlan(plan);
    showView('view-results');
    document.getElementById('btn-new-event').classList.remove('hidden');
    setTimeout(() => {
      document.getElementById('view-results').scrollIntoView({ behavior: 'smooth' });
    }, 80);
  } catch (err) {
    document.getElementById('error-message').textContent = err.message || 'Unexpected error.';
    showView('view-error');
  }
}

function val(id) {
  return (document.getElementById(id)?.value || '').trim();
}

// ── OpenAI API Call ──────────────────────────────────────────────────────────

async function generatePlan(apiKey, brief) {
  const systemPrompt = buildSystemPrompt();
  const userPrompt   = buildUserPrompt(brief);

  // Call our Vercel serverless proxy (/api/generate) instead of OpenAI directly.
  // This avoids browser CORS restrictions on api.openai.com.
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const msg = data?.error || `Server error (${response.status})`;
    if (response.status === 401) throw new Error('Invalid API key. Please check your key and try again.');
    if (response.status === 429) throw new Error('Rate limit reached. Please wait a moment and try again.');
    throw new Error(msg);
  }

  const content = data.choices?.[0]?.message?.content;

  if (!content) throw new Error('OpenAI returned an empty response. Please try again.');

  let plan;
  try {
    plan = JSON.parse(content);
  } catch {
    throw new Error('Could not parse the AI response. Please try again.');
  }

  return plan;
}

// ── Prompt Builders ──────────────────────────────────────────────────────────

function buildSystemPrompt() {
  return `You are ConciergeX, an expert event planning assistant with 20+ years of experience planning corporate, social, and government events worldwide. You generate comprehensive, professional-grade event plans from a simple brief.

You MUST respond with valid JSON only — no markdown fences, no prose outside the JSON object. The JSON must match this exact schema:

{
  "summary": "string — 2–3 paragraph executive summary of the event plan",
  "agenda": [
    { "time": "string (e.g. 09:00 – 09:30)", "activity": "string", "owner": "string", "notes": "string" }
  ],
  "checklist": [
    { "category": "string (e.g. Venue, AV, Catering, Marketing)", "task": "string", "dueDate": "string (relative, e.g. '6 weeks before event')", "owner": "string (role, not person)" }
  ],
  "budget": [
    { "category": "string", "estimatedCost": "string (e.g. '$2,000 – $3,500')", "notes": "string" }
  ],
  "communications": {
    "saveTheDate": "string — full email body",
    "invitation": "string — full formal invitation email body",
    "reminder": "string — full reminder email body (1 week before)",
    "speakerBriefing": "string — full speaker briefing note",
    "vendorBriefing": "string — full vendor briefing note",
    "postEventFollowUp": "string — full post-event thank-you / follow-up email"
  },
  "eventDayActionPlan": [ "string — each item is a numbered action step for the event day" ]
}

Rules:
- Generate a realistic, detailed agenda with at least 6–10 time blocks.
- Generate at least 15 checklist items spread across meaningful categories.
- Generate a budget with at least 8 line items that realistically reflect the event type and scale; use the provided budget figure as a guide.
- Each communication must be a complete, ready-to-send email or briefing note with subject line (prefix with "Subject: "), greeting, body, and sign-off.
- The event day action plan should have at least 10 clear, actionable steps.
- Be professional, specific, and tailor everything to the event details provided.`;
}

function buildUserPrompt(brief) {
  return `Please generate a complete event plan for the following brief:

Event Name: ${brief.eventName}
Event Type: ${brief.eventType}
Objective: ${brief.objective}
Date: ${brief.date}
Location: ${brief.location}
Expected Attendees: ${brief.expectedAttendees}
Budget: ${brief.budget}
Target Audience: ${brief.targetAudience}
Speakers / Key Stakeholders: ${brief.speakers || 'Not specified'}
Additional Notes: ${brief.additionalNotes || 'None'}

Generate the full event plan now as a JSON object.`;
}

// ── Render Plan ──────────────────────────────────────────────────────────────

function renderPlan(plan) {
  renderSummary(plan.summary);
  renderAgenda(plan.agenda || []);
  renderChecklist(plan.checklist || []);
  renderBudget(plan.budget || []);
  renderCommunications(plan.communications || {});
  renderActionPlan(plan.eventDayActionPlan || []);

  // Reset to first tab
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  document.querySelector('[data-tab="summary"]').classList.add('active');
  document.getElementById('tab-summary').classList.remove('hidden');
}

// ── Summary ──────────────────────────────────────────────────────────────────

function renderSummary(text) {
  const el = document.getElementById('summary-text');
  el.innerHTML = '';
  text.split('\n').forEach(para => {
    if (para.trim()) {
      const p = document.createElement('p');
      p.textContent = para;
      el.appendChild(p);
    }
  });
}

// ── Agenda ───────────────────────────────────────────────────────────────────

function renderAgenda(items) {
  const tbody = document.getElementById('agenda-body');
  tbody.innerHTML = '';
  let plain = '';

  items.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(item.time)}</td>
      <td>${esc(item.activity)}</td>
      <td>${esc(item.owner)}</td>
      <td style="color:var(--text-muted);font-size:.8rem">${esc(item.notes)}</td>
    `;
    tbody.appendChild(tr);
    plain += `${item.time}\t${item.activity}\t${item.owner}\t${item.notes}\n`;
  });

  document.getElementById('agenda-table-text').value = plain;
}

// ── Checklist ────────────────────────────────────────────────────────────────

const CAT_COLORS = {
  'Venue':           'background:#f5f3ff;color:#5b21b6;border-color:#ddd6fe',
  'Catering':        'background:#fff7ed;color:#c2410c;border-color:#fed7aa',
  'AV & Technology': 'background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe',
  'Marketing':       'background:#fdf2f8;color:#9d174d;border-color:#fbcfe8',
  'Logistics':       'background:#f0fdfa;color:#0f766e;border-color:#99f6e4',
  'Speakers':        'background:#fefce8;color:#854d0e;border-color:#fef08a',
  'Vendors':         'background:#f0fdf4;color:#166534;border-color:#bbf7d0',
  'Budget':          'background:#fef2f2;color:#991b1b;border-color:#fecaca',
};

function catStyle(cat) {
  return CAT_COLORS[cat] || 'background:#f8fafc;color:#334155;border-color:#e2e8f0';
}

function renderChecklist(items) {
  const container = document.getElementById('checklist-body');
  container.innerHTML = '';

  // Group by category
  const groups = {};
  items.forEach(item => {
    const key = item.category || 'General';
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });

  let globalIdx = 0;
  let plain = '';

  Object.entries(groups).forEach(([cat, catItems]) => {
    const group = document.createElement('div');
    group.className = 'checklist-group';

    const header = document.createElement('div');
    header.className = 'checklist-group-header';
    header.innerHTML = `
      <span class="cat-badge" style="${catStyle(cat)}">${esc(cat)}</span>
      <span style="font-size:.75rem;color:var(--text-faint)">${catItems.length} task${catItems.length !== 1 ? 's' : ''}</span>
    `;
    group.appendChild(header);

    catItems.forEach(item => {
      const idx = globalIdx++;
      plain += `[ ] [${item.category}] ${item.task} — Due: ${item.dueDate} | Owner: ${item.owner}\n`;

      const row = document.createElement('div');
      row.className = 'checklist-item';
      row.id = `ci-row-${idx}`;

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id   = `ci-${idx}`;
      cb.addEventListener('change', () => toggleChecklist(idx));

      const lbl = document.createElement('label');
      lbl.className = 'checklist-label';
      lbl.htmlFor   = `ci-${idx}`;
      lbl.innerHTML = `
        <span class="task-name">${esc(item.task)}</span>
        <span class="task-meta">Due: ${esc(item.dueDate)} &nbsp;·&nbsp; Owner: ${esc(item.owner)}</span>
      `;

      row.appendChild(cb);
      row.appendChild(lbl);
      group.appendChild(row);
    });

    container.appendChild(group);
  });

  document.getElementById('checklist-text').value = plain;
}

function toggleChecklist(idx) {
  checklistChecked[idx] = !checklistChecked[idx];
  const row = document.getElementById(`ci-row-${idx}`);
  if (row) row.classList.toggle('done', !!checklistChecked[idx]);
}

// ── Budget ───────────────────────────────────────────────────────────────────

function renderBudget(items) {
  const tbody = document.getElementById('budget-body');
  tbody.innerHTML = '';
  let plain = '';

  items.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(item.category)}</td>
      <td>${esc(item.estimatedCost)}</td>
      <td style="color:var(--text-muted);font-size:.8rem">${esc(item.notes)}</td>
    `;
    tbody.appendChild(tr);
    plain += `${item.category}: ${item.estimatedCost} — ${item.notes}\n`;
  });

  document.getElementById('budget-table-text').value = plain;
}

// ── Communications ───────────────────────────────────────────────────────────

let _commsData = {};

function renderCommunications(comms) {
  _commsData = comms;
  activeCommKey = 'saveTheDate';
  showComm('saveTheDate');
}

function switchComm(btn) {
  document.querySelectorAll('.comm-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  activeCommKey = btn.dataset.comm;
  showComm(activeCommKey);
}

function showComm(key) {
  document.getElementById('comm-content').textContent = _commsData[key] || '';
}

function copyActiveComm() {
  copyText(_commsData[activeCommKey] || '', document.querySelector('.comm-content-wrap .btn-copy'));
}

// ── Action Plan ──────────────────────────────────────────────────────────────

function renderActionPlan(steps) {
  const list = document.getElementById('action-body');
  list.innerHTML = '';
  actionChecked  = {};

  steps.forEach((step, i) => {
    const cleanStep = step.replace(/^\d+[\.\)]\s*/, '');
    const li = document.createElement('li');
    li.className = 'action-item';
    li.id = `ap-row-${i}`;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id   = `ap-${i}`;
    cb.addEventListener('change', () => toggleAction(i, steps.length));

    const num = document.createElement('span');
    num.className   = 'action-num';
    num.textContent = `${i + 1}.`;

    const lbl = document.createElement('label');
    lbl.className   = 'action-label';
    lbl.htmlFor     = `ap-${i}`;
    lbl.textContent = cleanStep;

    li.appendChild(cb);
    li.appendChild(num);
    li.appendChild(lbl);
    list.appendChild(li);
  });

  document.getElementById('action-text').value = steps.join('\n');
  updateActionProgress(0, steps.length);
}

function toggleAction(idx, total) {
  actionChecked[idx] = !actionChecked[idx];
  const row = document.getElementById(`ap-row-${idx}`);
  if (row) row.classList.toggle('done', !!actionChecked[idx]);
  const done = Object.values(actionChecked).filter(Boolean).length;
  updateActionProgress(done, total);
}

function updateActionProgress(done, total) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  document.getElementById('action-progress-fill').style.width = pct + '%';
  document.getElementById('action-progress-fill').style.animation = 'none'; // stop placeholder anim
  document.getElementById('action-progress-label').textContent = `${done} of ${total} steps complete`;
}

// ── Tab Switching ─────────────────────────────────────────────────────────────

function switchTab(btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  btn.classList.add('active');
  const panelId = 'tab-' + btn.dataset.tab;
  document.getElementById(panelId).classList.remove('hidden');
}

// ── Copy Helpers ──────────────────────────────────────────────────────────────

function copySection(textareaId) {
  const el  = document.getElementById(textareaId);
  const btn = el?.closest('.tab-panel')?.querySelector('.btn-copy')
           || document.querySelector(`[onclick="copySection('${textareaId}')"]`);
  copyText(el?.value || '', btn);
}

function copyText(text, btn) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    if (btn) flashCopied(btn);
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity  = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    if (btn) flashCopied(btn);
  });
}

function flashCopied(btn) {
  const original = btn.innerHTML;
  btn.innerHTML  = '✓ Copied!';
  btn.classList.add('copied');
  setTimeout(() => {
    btn.innerHTML = original;
    btn.classList.remove('copied');
  }, 2000);
}

// ── Escape HTML ───────────────────────────────────────────────────────────────

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
