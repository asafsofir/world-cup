(() => {
  const app = document.getElementById('app');
  const runtimeConfig = window.RUNTIME_CONFIG || {};
  const storage = {
    get(key, fallback = null) {
      try {
        const value = window.localStorage.getItem(key);
        return value == null ? fallback : value;
      } catch (error) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch (error) {
        // Ignore storage errors in preview/sandbox contexts.
      }
    },
    remove(key) {
      try {
        window.localStorage.removeItem(key);
      } catch (error) {
        // Ignore storage errors in preview/sandbox contexts.
      }
    },
  };
  const assetBaseUrl = runtimeConfig.assetBaseUrl || '.';
  function assetUrl(relativePath) {
    const clean = String(relativePath || '').replace(/^\//, '');
    if (!clean) return assetBaseUrl;
    if (/^(https?:)?\/\//.test(clean)) return clean;
    const base = assetBaseUrl.endsWith('/') ? assetBaseUrl : `${assetBaseUrl}/`;
    return `${base}${clean}`;
  }
  function apiUrl(path) {
    const clean = String(path || '').replace(/^\//, '');
    if (!runtimeConfig.apiBaseUrl) return `/${clean}`;
    const base = runtimeConfig.apiBaseUrl.endsWith('/') ? runtimeConfig.apiBaseUrl : `${runtimeConfig.apiBaseUrl}/`;
    return new URL(clean, base).toString();
  }
  const state = {
    bootstrap: null,
    selectedCompetition: storage.get('selectedCompetition', 'worldcup2026'),
    currentTab: storage.get('currentTab', null),
    loading: false,
    message: null,
    reminderTimer: null,
    backendStatus: 'unknown',
    backendError: '',
  };

  async function api(path, options = {}) {
    let response;
    try {
      response = await fetch(apiUrl(path), {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options,
      });
    } catch (error) {
      state.backendStatus = 'offline';
      state.backendError = 'חזית המערכת נטענה, אבל השרת לא זמין בכתובת הזו. צריך לפתוח את האפליקציה דרך השרת הציבורי או להריץ את השרת המקומי.';
      throw new Error(state.backendError);
    }
    if (response.status === 401) {
      state.backendStatus = 'online';
      state.bootstrap = null;
      renderLogin();
      throw new Error('Unauthorized');
    }
    if (response.status === 404 && String(path).startsWith('/api/')) {
      state.backendStatus = 'offline';
      state.backendError = 'ה-frontend עלה, אבל מסלולי ה-API לא זמינים בכתובת הזו.';
      throw new Error(state.backendError);
    }
    state.backendStatus = 'online';
    state.backendError = '';
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || 'Request failed');
    }
    return payload;
  }

  function setMessage(type, text) {
    state.message = { type, text };
    render();
    clearTimeout(setMessage._timer);
    setMessage._timer = setTimeout(() => {
      state.message = null;
      render();
    }, 4000);
  }

  function stageLabel(tab, meRole) {
    const labels = {
      predictions: 'הניחושים שלי',
      matches: 'מרכז המשחק',
      insights: 'תובנות',
      highlights: 'תקצירים וקישורים',
      admin: 'דאשבורד אדמין',
    };
    return labels[tab] || (meRole === 'admin' ? 'דאשבורד אדמין' : 'הניחושים שלי');
  }

  function formatDate(value) {
    try {
      return new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
    } catch (error) {
      return value;
    }
  }

  function escapeHtml(input) {
    return String(input || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function teamDisplayName(team) {
    return team?.displayName || team?.name || '';
  }

  function optionDisplayLabel(option) {
    return option?.displayLabel || option?.label || '';
  }

  function optionTeamDisplayName(option) {
    return option?.teamDisplayName || option?.teamName || '';
  }

  function getTabs() {
    if (!state.bootstrap) return [];
    const me = state.bootstrap.me;
    if (me.role === 'admin') {
      return ['admin', 'matches', 'insights', 'highlights'];
    }
    return ['predictions', 'matches', 'insights', 'highlights'];
  }

  async function ensureAuth() {
    try {
      await api('/api/me');
      await loadBootstrap(state.selectedCompetition);
    } catch (error) {
      if (String(error.message || '').includes('Unauthorized')) {
        renderLogin();
      } else {
        renderLogin('', error.message || 'לא ניתן להתחבר לשרת');
      }
    }
  }

  async function loadBootstrap(competitionId = state.selectedCompetition, preserveTab = true) {
    state.loading = true;
    render();
    try {
      const payload = await api(`/api/bootstrap?competition=${encodeURIComponent(competitionId)}`);
      state.bootstrap = payload;
      state.selectedCompetition = payload.selectedCompetition;
      storage.set('selectedCompetition', state.selectedCompetition);
      if (!preserveTab || !state.currentTab || !getTabs().includes(state.currentTab)) {
        state.currentTab = payload.me.role === 'admin' ? 'admin' : 'predictions';
      }
      storage.set('currentTab', state.currentTab);
      scheduleReminderLoop();
    } finally {
      state.loading = false;
      render();
    }
  }

  function renderLogin(errorText = '', extraInfo = state.backendStatus === 'offline' ? state.backendError : '') {
    app.innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <span class="badge">גרסת development v4.3</span>
          <h1>ליגת הניחושים</h1>
          <p class="muted">כניסה פרטית לפי שם משתמש וסיסמה. המסך של שחקן והמסך של אדמין מופרדים, ואין חשיפה של שמות משתמש וסיסמאות של אחרים.</p>
          ${extraInfo ? `<div class="notice warning" style="margin:12px 0;">${escapeHtml(extraInfo)}</div>` : ''}
          ${errorText ? `<div class="notice warning" style="margin:12px 0;">${escapeHtml(errorText)}</div>` : ''}
          <form id="login-form" class="grid">
            <label>
              <div class="muted" style="margin-bottom:6px;">שם משתמש</div>
              <input name="username" autocomplete="username" required />
            </label>
            <label>
              <div class="muted" style="margin-bottom:6px;">סיסמה</div>
              <input name="password" type="password" autocomplete="current-password" required />
            </label>
            <div class="login-actions">
              <button type="submit">כניסה</button>
            </div>
          </form>
          <p class="muted" style="margin-top:14px;">בגרסה משותפת אמיתית שולחים לכל חבר את פרטי הכניסה שלו בפרטי בלבד.</p>
        </div>
      </div>
    `;
    const form = document.getElementById('login-form');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      try {
        await api('/api/login', {
          method: 'POST',
          body: JSON.stringify({
            username: formData.get('username'),
            password: formData.get('password'),
          }),
        });
        await loadBootstrap(state.selectedCompetition, false);
      } catch (error) {
        renderLogin(error.message || 'כניסה נכשלה');
      }
    });
  }

  async function logout() {
    await api('/api/logout', { method: 'POST' });
    state.bootstrap = null;
    renderLogin();
  }

  async function savePrediction(matchId, home, away) {
    try {
      await api('/api/predictions', {
        method: 'PUT',
        body: JSON.stringify({ competitionId: state.selectedCompetition, matchId, home, away }),
      });
      setMessage('success', 'הניחוש נשמר');
      await loadBootstrap(state.selectedCompetition, true);
    } catch (error) {
      setMessage('warning', error.message);
    }
  }

  async function saveBonuses(formData) {
    try {
      await api('/api/bonuses', {
        method: 'PUT',
        body: JSON.stringify({
          competitionId: state.selectedCompetition,
          winnerTeamId: formData.get('winnerTeamId') || null,
          topScorerChoiceId: formData.get('topScorerChoiceId') || null,
        }),
      });
      setMessage('success', 'הבונוסים נשמרו');
      await loadBootstrap(state.selectedCompetition, true);
    } catch (error) {
      setMessage('warning', error.message);
    }
  }

  async function toggleReminders(enabled) {
    try {
      if (enabled && Notification.permission !== 'granted') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          throw new Error('לא אושרו התראות דפדפן');
        }
      }
      await api('/api/prefs', {
        method: 'PUT',
        body: JSON.stringify({ remindersEnabled: enabled }),
      });
      setMessage('success', enabled ? 'התזכורות הופעלו' : 'התזכורות כובו');
      await loadBootstrap(state.selectedCompetition, true);
    } catch (error) {
      setMessage('warning', error.message);
    }
  }

  async function triggerLiveSync() {
    try {
      const result = await api('/api/live-sync', { method: 'POST' });
      setMessage('success', `בוצע סנכרון לייב (${result.updated || 0} עדכונים)`);
      await loadBootstrap(state.selectedCompetition, true);
    } catch (error) {
      setMessage('warning', error.message);
    }
  }

  async function createUser(form) {
    const formData = new FormData(form);
    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          username: formData.get('username'),
          displayName: formData.get('displayName'),
          password: formData.get('password'),
          role: formData.get('role'),
        }),
      });
      form.reset();
      setMessage('success', 'המשתמש נוצר');
      await loadBootstrap(state.selectedCompetition, true);
    } catch (error) {
      setMessage('warning', error.message);
    }
  }

  async function resetPassword(userId, newPassword) {
    try {
      await api('/api/admin/reset-password', {
        method: 'POST',
        body: JSON.stringify({ userId, newPassword }),
      });
      setMessage('success', 'הסיסמה אופסה');
      await loadBootstrap(state.selectedCompetition, true);
    } catch (error) {
      setMessage('warning', error.message);
    }
  }

  async function saveActualBonus(form) {
    const formData = new FormData(form);
    try {
      await api('/api/admin/actual-bonus', {
        method: 'POST',
        body: JSON.stringify({
          competitionId: state.selectedCompetition,
          winnerTeamId: formData.get('winnerTeamId') || null,
          topScorerChoiceId: formData.get('topScorerChoiceId') || null,
          topScorerName: formData.get('topScorerName') || null,
        }),
      });
      setMessage('success', 'בונוסים בפועל נשמרו');
      await loadBootstrap(state.selectedCompetition, true);
    } catch (error) {
      setMessage('warning', error.message);
    }
  }

  async function saveManualResult(form) {
    const formData = new FormData(form);
    const body = {
      matchId: formData.get('matchId'),
      status: formData.get('status') || 'FT',
      statusLabel: formData.get('statusLabel') || 'עדכון ידני',
      home90: Number(formData.get('home90')),
      away90: Number(formData.get('away90')),
      finalHome: Number(formData.get('finalHome')),
      finalAway: Number(formData.get('finalAway')),
    };
    try {
      await api('/api/admin/result-override', { method: 'POST', body: JSON.stringify(body) });
      setMessage('success', 'התוצאה נשמרה');
      await loadBootstrap(state.selectedCompetition, true);
    } catch (error) {
      setMessage('warning', error.message);
    }
  }

  function renderMessage() {
    if (!state.message) return '';
    return `<div class="notice ${state.message.type === 'warning' ? 'warning' : state.message.type === 'success' ? 'success' : ''}" style="margin-bottom:16px;">${escapeHtml(state.message.text)}</div>`;
  }

  function renderSidebar() {
    const tabs = getTabs();
    return `
      <aside class="sidebar">
        <h3>${escapeHtml(state.bootstrap.me.displayName)}</h3>
        <div class="muted" style="margin-bottom:12px;">${state.bootstrap.me.role === 'admin' ? 'אדמין' : 'שחקן'}</div>
        <div class="nav-list">
          ${tabs.map((tab) => `<button class="nav-btn ${state.currentTab === tab ? 'active' : ''}" data-tab="${tab}">${stageLabel(tab, state.bootstrap.me.role)}</button>`).join('')}
        </div>
      </aside>
    `;
  }

  function renderScoringCard() {
    const scoring = state.bootstrap.competition.scoring;
    return `
      <div class="card">
        <h3>מבנה הניקוד</h3>
        <div class="kv">
          <div>כיוון נכון</div><strong>${scoring.direction}</strong>
          <div>תוצאה מדויקת - רגיל / בתים / שמינית / 32 האחרונות</div><strong>${scoring.exactDefault}</strong>
          <div>תוצאה מדויקת - רבע</div><strong>${scoring.exactQuarter}</strong>
          <div>תוצאה מדויקת - חצי</div><strong>${scoring.exactSemi}</strong>
          <div>תוצאה מדויקת - גמר</div><strong>${scoring.exactFinal}</strong>
          <div>מקום 1/2 מדויק בכל בית</div><strong>${scoring.groupTopTwoBonusEach}</strong>
          <div>זוכה בטורניר</div><strong>${scoring.winnerBonus}</strong>
          <div>מלך שערים מרשימה</div><strong>${scoring.topScorerBonus}</strong>
          <div>מלך שערים - אחר</div><strong>${scoring.topScorerOtherBonus}</strong>
        </div>
      </div>
    `;
  }

  function renderPredictionCard(match) {
    const my = match.myPrediction || {};
    const scoreState = match.matchState;
    const liveBadge = scoreState.status === 'NS'
      ? (match.isLocked ? '<span class="badge locked">נעול</span>' : '<span class="badge">פתוח לניחוש</span>')
      : (scoreState.finalLocked ? '<span class="badge done">סופי</span>' : '<span class="badge live">לייב</span>');
    return `
      <div class="card">
        <div class="match-header">
          <div>
            <h3 style="margin-bottom:6px;">${escapeHtml(teamDisplayName(match.homeTeam))} - ${escapeHtml(teamDisplayName(match.awayTeam))}</h3>
            <div class="muted">${escapeHtml(match.stageLabel)}${match.groupId ? ` | בית ${escapeHtml(match.groupId)}` : ''} | ${escapeHtml(match.roundLabel)}</div>
          </div>
          <div>${liveBadge}</div>
        </div>
        <div class="match-meta">
          <span class="badge">${escapeHtml(formatDate(match.kickoffAt))}</span>
          <span class="badge">${escapeHtml(match.venue || 'ללא מיקום')}</span>
          <span class="badge">מקס׳ מדויק: ${match.exactTotalPoints}</span>
        </div>
        ${scoreState.status !== 'NS' ? `<div class="notice" style="margin-top:12px;">סטטוס: ${escapeHtml(scoreState.statusLabel)}${scoreState.currentHome != null ? ` | תוצאה נוכחית ${scoreState.currentHome}:${scoreState.currentAway}` : ''}</div>` : ''}
        <form class="prediction-form grid" data-match-id="${match.id}" style="margin-top:14px;">
          <div class="score-inputs">
            <div>${escapeHtml(teamDisplayName(match.homeTeam))}</div>
            <input name="home" type="number" min="0" max="20" value="${my.home ?? ''}" ${match.isLocked ? 'disabled' : ''} />
            <input name="away" type="number" min="0" max="20" value="${my.away ?? ''}" ${match.isLocked ? 'disabled' : ''} />
            <div>${escapeHtml(teamDisplayName(match.awayTeam))}</div>
          </div>
          <div class="actions-row">
            <button type="submit" ${match.isLocked ? 'disabled' : ''}>שמור ניחוש</button>
            <small>${my.updatedAt ? `נשמר לאחרונה: ${escapeHtml(formatDate(my.updatedAt))}` : 'עדיין לא נשמר ניחוש'}</small>
          </div>
        </form>
      </div>
    `;
  }

  function renderPredictionsView() {
    const competition = state.bootstrap.competition;
    const matches = competition.matches.slice().sort((a, b) => new Date(a.kickoffAt) - new Date(b.kickoffAt));
    const upcoming = matches.filter((match) => !match.matchState.finalLocked);
    const groups = {};
    upcoming.forEach((match) => {
      const key = `${match.stageLabel}::${match.groupId || ''}`;
      groups[key] = groups[key] || { title: match.stageLabel + (match.groupId ? ` - בית ${match.groupId}` : ''), items: [] };
      groups[key].items.push(match);
    });

    const bonus = competition.myBonus || {};
    return `
      <div class="grid">
        ${renderScoringCard()}
        ${competition.mode === 'tournament' ? `
          <div class="card">
            <h3>בונוסים אישיים</h3>
            <p class="muted">בחירות אלו ננעלות עם פתיחת הטורניר, 2 דקות לפני שריקת הפתיחה.</p>
            <form id="bonus-form" class="grid">
              <div class="form-row">
                <label>
                  <div class="muted" style="margin-bottom:6px;">זוכה בטורניר</div>
                  <select name="winnerTeamId">
                    <option value="">בחר נבחרת</option>
                    ${competition.winnerOptions.map((option) => `<option value="${escapeHtml(option.id)}" ${bonus.winnerTeamId === option.id ? 'selected' : ''}>${escapeHtml(optionDisplayLabel(option))}</option>`).join('')}
                  </select>
                </label>
                <label>
                  <div class="muted" style="margin-bottom:6px;">מלך שערים</div>
                  <select name="topScorerChoiceId">
                    <option value="">בחר שחקן</option>
                    ${competition.topScorerOptions.map((option) => `<option value="${escapeHtml(option.id)}" ${bonus.topScorerChoiceId === option.id ? 'selected' : ''}>${escapeHtml(optionDisplayLabel(option))}${optionTeamDisplayName(option) && optionTeamDisplayName(option) !== 'כללי' ? ` · ${escapeHtml(optionTeamDisplayName(option))}` : ''}</option>`).join('')}
                  </select>
                </label>
              </div>
              <div class="actions-row">
                <button type="submit">שמור בונוסים</button>
              </div>
            </form>
          </div>
        ` : ''}
        ${Object.values(groups).map((group) => `
          <section class="grid">
            <div class="card"><h2 style="margin-bottom:0;">${escapeHtml(group.title)}</h2></div>
            ${group.items.map(renderPredictionCard).join('')}
          </section>
        `).join('')}
      </div>
    `;
  }

  function renderStandingsTable() {
    const standings = state.bootstrap.standings;
    if (!standings.length) return '<div class="empty">עדיין אין שחקנים בטבלה.</div>';
    return `
      <table class="standings-table">
        <thead>
          <tr>
            <th>#</th>
            <th>משתתף</th>
            <th>סה״כ</th>
            <th>משחקים</th>
            <th>בונוס בתים</th>
            <th>מלך שערים</th>
            <th>זוכה</th>
          </tr>
        </thead>
        <tbody>
          ${standings.map((row) => `
            <tr>
              <td>${row.rank}</td>
              <td>${escapeHtml(row.displayName)}</td>
              <td><strong>${row.total}</strong></td>
              <td>${row.matchPoints}</td>
              <td>${row.groupBonus}</td>
              <td>${row.topScorerBonus}</td>
              <td>${row.winnerBonus}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function renderMatchCenter() {
    const competition = state.bootstrap.competition;
    const matches = competition.matches.slice().sort((a, b) => new Date(a.kickoffAt) - new Date(b.kickoffAt));
    return `
      <div class="grid">
        <div class="card">
          <h2>טבלת הניקוד</h2>
          ${renderStandingsTable()}
        </div>
        ${matches.map((match) => {
          const scoreState = match.matchState;
          const scoreLine = scoreState.currentHome != null ? `${scoreState.currentHome}:${scoreState.currentAway}` : 'טרם נקבעה תוצאה';
          return `
            <div class="card">
              <div class="match-header">
                <div>
                  <h3 style="margin-bottom:6px;">${escapeHtml(teamDisplayName(match.homeTeam))} - ${escapeHtml(teamDisplayName(match.awayTeam))}</h3>
                  <div class="muted">${escapeHtml(match.stageLabel)}${match.groupId ? ` | בית ${escapeHtml(match.groupId)}` : ''} | ${escapeHtml(formatDate(match.kickoffAt))}</div>
                </div>
                <div>
                  ${scoreState.finalLocked ? '<span class="badge done">סופי</span>' : scoreState.status !== 'NS' ? '<span class="badge live">לייב</span>' : match.isLocked ? '<span class="badge locked">נעול</span>' : '<span class="badge">ממתין</span>'}
                </div>
              </div>
              <div class="match-meta">
                <span class="badge">${escapeHtml(scoreState.statusLabel)}</span>
                <span class="badge">תוצאה: ${escapeHtml(scoreLine)}</span>
                ${scoreState.elapsed != null ? `<span class="badge">דקה ${scoreState.elapsed}</span>` : ''}
                <span class="badge">ניחושים שנשלחו: ${match.submissionCount}</span>
              </div>
              ${match.isRevealed ? `
                <div style="margin-top:14px;">
                  <table class="predictions-table">
                    <thead>
                      <tr><th>משתתף</th><th>ניחוש</th><th>נקודות למשחק</th></tr>
                    </thead>
                    <tbody>
                      ${match.revealedPredictions.length ? match.revealedPredictions.map((row) => `
                        <tr>
                          <td>${escapeHtml(row.displayName)}</td>
                          <td>${row.home}:${row.away}</td>
                          <td>${row.points}</td>
                        </tr>
                      `).join('') : '<tr><td colspan="3">עדיין אין ניחושים חשופים למשחק הזה.</td></tr>'}
                    </tbody>
                  </table>
                </div>
              ` : `<div class="notice warning" style="margin-top:14px;">הניחושים של כולם ייחשפו עם שריקת הפתיחה. כרגע מוצג רק מספר ההגשות.</div>`}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderInsights() {
    const cards = state.bootstrap.insights || [];
    return `
      <div class="grid two">
        ${cards.map((item) => `
          <div class="card">
            <h3>${escapeHtml(item.title)}</h3>
            <p>${escapeHtml(item.text)}</p>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderHighlights() {
    const links = state.bootstrap.competition.highlights || [];
    return `
      <div class="grid">
        <div class="card">
          <h2>קישורים מהירים</h2>
          <p class="muted">כאן מרוכזים התקצירים, הלו״זים ומקורות המידע המרכזיים.</p>
          <div class="link-list">
            ${links.map((item) => `
              <a class="link-card" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">
                <div>
                  <strong>${escapeHtml(item.label)}</strong>
                  <div class="muted">${escapeHtml(item.url)}</div>
                </div>
                <span class="badge">פתח</span>
              </a>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function renderAdmin() {
    const bootstrap = state.bootstrap;
    const competition = bootstrap.competition;
    const admin = bootstrap.admin;
    const currentActual = competition.actualBonus || {};
    return `
      <div class="grid">
        <div class="grid three">
          <div class="card">
            <h3>מצב סנכרון</h3>
            <p><strong>${escapeHtml(admin.live.provider)}</strong></p>
            <p class="muted">סנכרון אחרון: ${admin.live.lastLiveSyncAt ? escapeHtml(formatDate(admin.live.lastLiveSyncAt)) : 'עדיין לא'}</p>
            <div class="actions-row"><button id="sync-now">סנכרן עכשיו</button></div>
          </div>
          <div class="card">
            <h3>שיתוף עם חברים</h3>
            <p class="muted">כתובת בסיס: ${escapeHtml(bootstrap.config.publicBaseUrl)}</p>
            <p class="muted">שחקנים רואים רק שם תצוגה. שמות משתמש וסיסמאות לא מוצגים במסך הכניסה.</p>
          </div>
          <div class="card">
            <h3>מצב הניקוד</h3>
            <p class="muted">בונוס הבתים מאוזן ל-1 נק׳ רק על מקום 1 ו-2. בשלבי הסיום: רבע 4, חצי 5, גמר 6.</p>
          </div>
        </div>
        <section class="card admin-section">
          <h2>יצירת משתמש חדש</h2>
          <form id="create-user-form" class="grid">
            <div class="form-row">
              <label><div class="muted" style="margin-bottom:6px;">שם תצוגה</div><input name="displayName" required /></label>
              <label><div class="muted" style="margin-bottom:6px;">שם משתמש</div><input name="username" required /></label>
            </div>
            <div class="form-row">
              <label><div class="muted" style="margin-bottom:6px;">סיסמה זמנית</div><input name="password" required minlength="8" /></label>
              <label>
                <div class="muted" style="margin-bottom:6px;">תפקיד</div>
                <select name="role"><option value="player">שחקן</option><option value="admin">אדמין</option></select>
              </label>
            </div>
            <div class="actions-row"><button type="submit">צור משתמש</button></div>
          </form>
        </section>
        <section class="card admin-section">
          <h2>משתמשים קיימים</h2>
          <table class="standings-table">
            <thead><tr><th>שם תצוגה</th><th>שם משתמש</th><th>תפקיד</th><th>כניסה אחרונה</th><th>איפוס סיסמה</th></tr></thead>
            <tbody>
              ${admin.users.map((user) => `
                <tr>
                  <td>${escapeHtml(user.displayName)}</td>
                  <td>${escapeHtml(user.username)}</td>
                  <td>${escapeHtml(user.role)}</td>
                  <td>${user.lastLoginAt ? escapeHtml(formatDate(user.lastLoginAt)) : 'עדיין לא'}</td>
                  <td>
                    <form class="reset-password-form" data-user-id="${user.id}">
                      <div class="actions-row">
                        <input name="newPassword" placeholder="סיסמה חדשה" minlength="8" required />
                        <button type="submit" class="secondary">אפס</button>
                      </div>
                    </form>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </section>
        <section class="card admin-section">
          <h2>בונוסים בפועל</h2>
          <form id="actual-bonus-form" class="grid">
            <div class="form-row">
              <label>
                <div class="muted" style="margin-bottom:6px;">זוכה בפועל</div>
                <select name="winnerTeamId">
                  <option value="">בחר נבחרת</option>
                  ${competition.winnerOptions.map((item) => `<option value="${escapeHtml(item.id)}" ${currentActual.winnerTeamId === item.id ? 'selected' : ''}>${escapeHtml(optionDisplayLabel(item))}</option>`).join('')}
                </select>
              </label>
              <label>
                <div class="muted" style="margin-bottom:6px;">מלך שערים - בחירה</div>
                <select name="topScorerChoiceId">
                  <option value="">בחר שחקן</option>
                  ${competition.topScorerOptions.map((item) => `<option value="${escapeHtml(item.id)}" ${currentActual.topScorerChoiceId === item.id ? 'selected' : ''}>${escapeHtml(optionDisplayLabel(item))}</option>`).join('')}
                </select>
              </label>
            </div>
            <label>
              <div class="muted" style="margin-bottom:6px;">שם מלך השערים בפועל (לוגי / override)</div>
              <input name="topScorerName" value="${escapeHtml(currentActual.topScorerName || '')}" />
            </label>
            <div class="actions-row"><button type="submit">שמור</button></div>
          </form>
        </section>
        <section class="card admin-section">
          <h2>עדכון ידני חריג</h2>
          <form id="manual-result-form" class="grid">
            <label>
              <div class="muted" style="margin-bottom:6px;">משחק</div>
              <select name="matchId">${competition.matches.map((match) => `<option value="${match.id}">${escapeHtml(teamDisplayName(match.homeTeam))} - ${escapeHtml(teamDisplayName(match.awayTeam))} | ${escapeHtml(match.roundLabel)}</option>`).join('')}</select>
            </label>
            <div class="form-row">
              <label><div class="muted" style="margin-bottom:6px;">תוצאת 90 - בית</div><input name="home90" type="number" min="0" required /></label>
              <label><div class="muted" style="margin-bottom:6px;">תוצאת 90 - חוץ</div><input name="away90" type="number" min="0" required /></label>
            </div>
            <div class="form-row">
              <label><div class="muted" style="margin-bottom:6px;">תוצאה סופית - בית</div><input name="finalHome" type="number" min="0" required /></label>
              <label><div class="muted" style="margin-bottom:6px;">תוצאה סופית - חוץ</div><input name="finalAway" type="number" min="0" required /></label>
            </div>
            <div class="form-row">
              <label><div class="muted" style="margin-bottom:6px;">סטטוס</div><input name="status" value="FT" /></label>
              <label><div class="muted" style="margin-bottom:6px;">תיאור סטטוס</div><input name="statusLabel" value="עדכון ידני" /></label>
            </div>
            <div class="actions-row"><button type="submit" class="secondary">שמור תוצאה</button></div>
          </form>
        </section>
      </div>
    `;
  }

  function renderMain() {
    const title = stageLabel(state.currentTab, state.bootstrap.me.role);
    let inner = '';
    if (state.currentTab === 'predictions') inner = renderPredictionsView();
    else if (state.currentTab === 'matches') inner = renderMatchCenter();
    else if (state.currentTab === 'insights') inner = renderInsights();
    else if (state.currentTab === 'highlights') inner = renderHighlights();
    else inner = renderAdmin();

    return `
      <div class="app-shell">
        <div class="topbar">
          <div class="brand">
            <span class="badge">${escapeHtml(state.bootstrap.competition.name)}</span>
            <h1>${escapeHtml(title)}</h1>
            <p>${escapeHtml(state.bootstrap.competition.subtitle)}</p>
          </div>
          <div class="topbar-actions">
            <select id="competition-switcher">
              ${state.bootstrap.config.competitions.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === state.selectedCompetition ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}
            </select>
            <button class="secondary" id="refresh-btn">רענן</button>
            <button class="ghost" id="reminder-btn">${state.bootstrap.prefs.remindersEnabled ? 'כבה תזכורות' : 'הפעל תזכורות שעה לפני'}</button>
            <button class="danger" id="logout-btn">התנתק</button>
          </div>
        </div>
        ${renderMessage()}
        ${state.loading ? '<div class="notice">טוען נתונים...</div>' : ''}
        <div class="layout-grid">
          ${renderSidebar()}
          <main class="panel">${inner}</main>
        </div>
      </div>
    `;
  }

  function bindCommonHandlers() {
    document.querySelectorAll('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        state.currentTab = button.dataset.tab;
        storage.set('currentTab', state.currentTab);
        render();
      });
    });
    document.getElementById('competition-switcher')?.addEventListener('change', async (event) => {
      state.selectedCompetition = event.target.value;
      await loadBootstrap(state.selectedCompetition, false);
    });
    document.getElementById('refresh-btn')?.addEventListener('click', async () => loadBootstrap(state.selectedCompetition, true));
    document.getElementById('logout-btn')?.addEventListener('click', logout);
    document.getElementById('reminder-btn')?.addEventListener('click', async () => toggleReminders(!state.bootstrap.prefs.remindersEnabled));
  }

  function bindPredictionHandlers() {
    document.querySelectorAll('.prediction-form').forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const matchId = form.dataset.matchId;
        const home = Number(formData.get('home'));
        const away = Number(formData.get('away'));
        await savePrediction(matchId, home, away);
      });
    });
    document.getElementById('bonus-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      await saveBonuses(new FormData(event.currentTarget));
    });
  }

  function bindAdminHandlers() {
    document.getElementById('sync-now')?.addEventListener('click', triggerLiveSync);
    document.getElementById('create-user-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      await createUser(event.currentTarget);
    });
    document.querySelectorAll('.reset-password-form').forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        await resetPassword(form.dataset.userId, String(formData.get('newPassword') || ''));
        form.reset();
      });
    });
    document.getElementById('actual-bonus-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      await saveActualBonus(event.currentTarget);
    });
    document.getElementById('manual-result-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      await saveManualResult(event.currentTarget);
    });
  }

  function renderFatal(error) {
    console.error(error);
    app.innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <span class="badge">שגיאת טעינה</span>
          <h1>המערכת לא הצליחה להיטען</h1>
          <div class="notice warning" style="margin:12px 0;">${escapeHtml(error?.message || error || 'Unknown error')}</div>
          <p class="muted">ב-v4 הוספתי מסך שגיאה מפורט כדי למנוע מצב של מסך לבן ריק.</p>
        </div>
      </div>
    `;
  }

  function render() {
    try {
      if (!state.bootstrap) return renderLogin();
      app.innerHTML = renderMain();
      bindCommonHandlers();
      if (state.currentTab === 'predictions') bindPredictionHandlers();
      if (state.currentTab === 'admin') bindAdminHandlers();
    } catch (error) {
      renderFatal(error);
    }
  }

  async function showReminder(match) {
    if (!('Notification' in window)) return;
    const key = `notified:${state.bootstrap.me.id}:${match.id}`;
    if (storage.get(key)) return;
    const title = `${teamDisplayName(match.homeTeam)} - ${teamDisplayName(match.awayTeam)}`;
    const body = `עוד פחות משעה למשחק. אפשר עדיין לנחש עד שתי דקות לפני הפתיחה.`;
    try {
      if (navigator.serviceWorker?.getRegistration) {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
          await registration.showNotification(title, { body, tag: match.id, icon: assetUrl('icon.svg') });
        } else {
          new Notification(title, { body });
        }
      } else {
        new Notification(title, { body });
      }
      storage.set(key, String(Date.now()));
    } catch (error) {
      console.warn('Notification failed', error);
    }
  }

  function scheduleReminderLoop() {
    clearInterval(state.reminderTimer);
    if (!state.bootstrap?.prefs?.remindersEnabled) return;
    const tick = async () => {
      if (!state.bootstrap) return;
      const now = Date.now();
      const windowStart = runtimeConfig.reminderMinutesBeforeMatch * 60 * 1000;
      for (const match of state.bootstrap.competition.matches) {
        if (match.isLocked) continue;
        const kickoff = new Date(match.kickoffAt).getTime();
        const diff = kickoff - now;
        if (diff > 0 && diff <= windowStart) {
          await showReminder(match);
        }
      }
    };
    tick();
    state.reminderTimer = setInterval(tick, 60 * 1000);
  }

  async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        if (window.location.protocol === 'file:') return;
        await navigator.serviceWorker.register(assetUrl('sw.js'));
      } catch (error) {
        console.warn('SW registration failed', error);
      }
    }
  }

  window.addEventListener('error', (event) => {
    if (event?.error) renderFatal(event.error);
  });
  window.addEventListener('unhandledrejection', (event) => {
    renderFatal(event?.reason || new Error('Unhandled promise rejection'));
  });

  registerServiceWorker();
  ensureAuth();
})();
