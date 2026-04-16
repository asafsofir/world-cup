
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const publicRoot = path.join(projectRoot, 'public');
const dataRoot = process.env.DATA_ROOT || path.join(__dirname, 'data');
const usersPath = path.join(dataRoot, 'users.json');
const statePath = path.join(dataRoot, 'state.json');
const port = Number(process.env.PORT || 8080);
const sessionSecret = process.env.SESSION_SECRET || 'dev-secret-change-me';
const defaultPublicBaseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${port}`;
const bootstrapAdminUsername = slug(process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin') || 'admin';
const bootstrapAdminDisplayName = process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME || 'מנהל';
const bootstrapAdminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
const seedSampleUsers = process.env.SEED_SAMPLE_USERS === 'true';
const sessions = new Map();

const envConfig = {
  lockMinutes: Number(process.env.LOCK_MINUTES || 2),
  reminderMinutes: Number(process.env.REMINDER_MINUTES || 60),
  liveProvider: process.env.LIVE_PROVIDER || (process.env.API_FOOTBALL_KEY ? 'api-football' : 'none'),
  genericLiveUrl: process.env.GENERIC_LIVE_URL || '',
  apiFootballKey: process.env.API_FOOTBALL_KEY || '',
  apiFootballBase: process.env.API_FOOTBALL_BASE || 'https://v3.football.api-sports.io',
  worldCupLeagueId: process.env.WORLDCUP_LEAGUE_ID || '',
  worldCupSeason: process.env.WORLDCUP_SEASON || '2026',
  uclLeagueId: process.env.UCL_LEAGUE_ID || '2',
  uclSeason: process.env.UCL_SEASON || '2025',
};

const STAGE_LABELS = {
  group: 'שלב הבתים',
  round32: '32 האחרונות',
  round16: 'שמינית הגמר',
  quarter: 'רבע הגמר',
  semi: 'חצי הגמר',
  thirdPlace: 'משחק על המקום השלישי',
  final: 'הגמר',
};

const EXACT_TOTAL_POINTS = {
  default: 3,
  quarter: 4,
  semi: 5,
  final: 6,
};

const LIVE_FINAL_CODES = new Set(['FT', 'AET', 'PEN']);
const LIVE_STARTED_CODES = new Set(['1H', 'HT', '2H', 'ET', 'P', 'BT', 'LIVE', 'INT']);

function teamId(label) {
  return label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function slug(input) {
  return String(input)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeTeamName(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '')
    .replace(/munchen/g, 'munich')
    .replace(/saintgermain/g, 'psg')
    .replace(/sportingcp/g, 'sporting')
    .replace(/iriran/g, 'iran')
    .replace(/korearepublic/g, 'korearepublic')
    .trim();
}

function nowIso() {
  return new Date().toISOString();
}

function randomId(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function createBootstrapPassword() {
  return `Wc-${crypto.randomBytes(9).toString('base64url')}`;
}

function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  return { salt, passwordHash };
}

function verifyPassword(password, record) {
  const calculated = hashPassword(password, record.salt);
  return crypto.timingSafeEqual(Buffer.from(calculated), Buffer.from(record.passwordHash));
}

function sign(value) {
  return crypto.createHmac('sha256', sessionSecret).update(value).digest('hex');
}

function createCookieSession(userId) {
  const token = randomId(18);
  const signature = sign(`${userId}.${token}`);
  const sessionId = `${userId}.${token}.${signature}`;
  sessions.set(sessionId, { userId, createdAt: Date.now() });
  return sessionId;
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const result = {};
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    result[k] = decodeURIComponent(rest.join('='));
  }
  return result;
}

function getSessionUser(req, users) {
  const cookies = parseCookies(req);
  const sessionId = cookies.session;
  if (!sessionId || !sessions.has(sessionId)) return null;
  const [userId, token, signature] = sessionId.split('.');
  if (!userId || !token || !signature) return null;
  if (sign(`${userId}.${token}`) !== signature) return null;
  const user = users.find((item) => item.id === userId);
  return user || null;
}

function isSecureRequest(req) {
  if (req.headers['x-forwarded-proto']) {
    return String(req.headers['x-forwarded-proto']).split(',')[0].trim() === 'https';
  }
  return defaultPublicBaseUrl.startsWith('https://');
}

function sessionCookieHeader(req, sessionId, maxAge = null) {
  const parts = [
    `session=${encodeURIComponent(sessionId)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
  ];
  if (maxAge != null) parts.push(`Max-Age=${maxAge}`);
  if (isSecureRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

function baseHeaders(extra = {}) {
  return {
    'Cache-Control': 'no-store',
    ...extra,
  };
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, baseHeaders({ 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders }));
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, statusCode, payload, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
  res.writeHead(statusCode, baseHeaders({ 'Content-Type': contentType, ...extraHeaders }));
  res.end(payload);
}

function unauthorized(res) {
  return sendJson(res, 401, { error: 'Unauthorized' });
}

function forbidden(res) {
  return sendJson(res, 403, { error: 'Forbidden' });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function readJsonFile(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

async function writeJsonFile(filePath, payload) {
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function getContentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.webmanifest')) return 'application/manifest+json; charset=utf-8';
  return 'application/octet-stream';
}

function makeUser(username, displayName, role, password) {
  const record = createPasswordRecord(password);
  return {
    id: slug(username),
    username,
    displayName,
    role,
    ...record,
    createdAt: nowIso(),
    lastLoginAt: null,
  };
}

function seedUsers() {
  const users = [];
  const adminPassword = bootstrapAdminPassword || createBootstrapPassword();
  users.push(makeUser(bootstrapAdminUsername, bootstrapAdminDisplayName, 'admin', adminPassword));
  if (seedSampleUsers) {
    users.push(makeUser('asaf', 'אסף', 'player', 'Wc2026!01'));
    for (let i = 2; i <= 20; i += 1) {
      const index = String(i).padStart(2, '0');
      users.push(makeUser(`player${index}`, `חבר ${index}`, 'player', `Wc2026!${index}`));
    }
  }
  const seededMessage = seedSampleUsers
    ? `[bootstrap] Seeded admin (${bootstrapAdminUsername}) and ${users.length - 1} sample players.`
    : `[bootstrap] Seeded admin only (${bootstrapAdminUsername}). Create players from the admin dashboard.`;
  console.log(seededMessage);
  if (!bootstrapAdminPassword) {
    console.warn(`[bootstrap] Generated one-time admin password for ${bootstrapAdminUsername}: ${adminPassword}`);
    console.warn('[bootstrap] Save this password now or set BOOTSTRAP_ADMIN_PASSWORD in the environment.');
  }
  return users;
}

function buildWorldCupGroups() {
  return [
    ['A', ['Mexico', 'South Africa', 'Korea Republic', 'Czechia/Denmark/North Macedonia/Republic of Ireland']],
    ['B', ['Canada', 'Bosnia and Herzegovina/Italy/Northern Ireland/Wales', 'Qatar', 'Switzerland']],
    ['C', ['Brazil', 'Morocco', 'Haiti', 'Scotland']],
    ['D', ['USA', 'Paraguay', 'Australia', 'Kosovo/Romania/Slovakia/Türkiye']],
    ['E', ['Germany', 'Curaçao', 'Côte d\'Ivoire', 'Ecuador']],
    ['F', ['Netherlands', 'Japan', 'Albania/Poland/Sweden/Ukraine', 'Tunisia']],
    ['G', ['Belgium', 'Egypt', 'IR Iran', 'New Zealand']],
    ['H', ['Spain', 'Cabo Verde', 'Saudi Arabia', 'Uruguay']],
    ['I', ['France', 'Senegal', 'Bolivia/Iraq/Suriname', 'Norway']],
    ['J', ['Argentina', 'Algeria', 'Austria', 'Jordan']],
    ['K', ['Portugal', 'Congo DR/Jamaica/New Caledonia', 'Uzbekistan', 'Colombia']],
    ['L', ['England', 'Croatia', 'Ghana', 'Panama']],
  ].map(([id, teams]) => ({ id, teams: teams.map((name) => ({ id: teamId(name), name })) }));
}

const scorerSeedMap = {
  'Mexico': ['Raúl Jiménez', 'Santiago Giménez', 'Hirving Lozano', 'Uriel Antuna', 'César Huerta'],
  'South Africa': ['Lyle Foster', 'Evidence Makgopa', 'Percy Tau', 'Mihlali Mayambela', 'Zakhele Lepasa'],
  'Korea Republic': ['Son Heung-min', 'Hwang Hee-chan', 'Cho Gue-sung', 'Lee Kang-in', 'Oh Hyeon-gyu'],
  'Canada': ['Jonathan David', 'Cyle Larin', 'Alphonso Davies', 'Tajon Buchanan', 'Promise David'],
  'Qatar': ['Almoez Ali', 'Akram Afif', 'Ahmed Alaaeldin', 'Yusuf Abdurisag', 'Ahmed Fathy'],
  'Switzerland': ['Breel Embolo', 'Zeki Amdouni', 'Dan Ndoye', 'Noah Okafor', 'Xherdan Shaqiri'],
  'Brazil': ['Vinícius Júnior', 'Rodrygo', 'Endrick', 'Raphinha', 'Richarlison'],
  'Morocco': ['Youssef En-Nesyri', 'Ayoub El Kaabi', 'Hakim Ziyech', 'Sofiane Rahimi', 'Abde Ezzalzouli'],
  'Haiti': ['Duckens Nazon', 'Mondy Prunier', 'Frantzdy Pierrot', 'Derrick Etienne', 'Louicius Don Deedson'],
  'Scotland': ['Scott McTominay', 'Che Adams', 'Lyndon Dykes', 'Ryan Christie', 'Tommy Conway'],
  'USA': ['Christian Pulisic', 'Folarin Balogun', 'Ricardo Pepi', 'Josh Sargent', 'Tim Weah'],
  'Paraguay': ['Miguel Almirón', 'Antonio Sanabria', 'Julio Enciso', 'Ramon Sosa', 'Gabriel Ávalos'],
  'Australia': ['Mitchell Duke', 'Kusini Yengi', 'Martin Boyle', 'Craig Goodwin', 'Awer Mabil'],
  'Germany': ['Kai Havertz', 'Jamal Musiala', 'Florian Wirtz', 'Niclas Füllkrug', 'Deniz Undav'],
  'Curaçao': ['Rangelo Janga', 'Juninho Bacuna', 'Leandro Bacuna', 'Gervane Kastaneer', 'Anthony van den Hurk'],
  'Côte d\'Ivoire': ['Sébastien Haller', 'Simon Adingra', 'Nicolas Pépé', 'Oumar Diakité', 'Amad Diallo'],
  'Ecuador': ['Enner Valencia', 'Kevin Rodríguez', 'Jeremy Sarmiento', 'Kendry Páez', 'Gonzalo Plata'],
  'Netherlands': ['Memphis Depay', 'Cody Gakpo', 'Joshua Zirkzee', 'Donyell Malen', 'Brian Brobbey'],
  'Japan': ['Ayase Ueda', 'Kaoru Mitoma', 'Ritsu Dōan', 'Takumi Minamino', 'Kyogo Furuhashi'],
  'Tunisia': ['Youssef Msakni', 'Seifeddine Jaziri', 'Montassar Talbi', 'Elias Achouri', 'Taha Yassine Khenissi'],
  'Belgium': ['Romelu Lukaku', 'Loïs Openda', 'Jérémy Doku', 'Charles De Ketelaere', 'Leandro Trossard'],
  'Egypt': ['Mohamed Salah', 'Mostafa Mohamed', 'Omar Marmoush', 'Trézéguet', 'Ibrahim Adel'],
  'IR Iran': ['Mehdi Taremi', 'Sardar Azmoun', 'Alireza Jahanbakhsh', 'Mehdi Ghayedi', 'Mohammad Mohebi'],
  'New Zealand': ['Chris Wood', 'Ben Waine', 'Kosta Barbarouses', 'Matthew Garbett', 'Sarpreet Singh'],
  'Spain': ['Álvaro Morata', 'Lamine Yamal', 'Nico Williams', 'Dani Olmo', 'Ferran Torres'],
  'Cabo Verde': ['Bebé', 'Ryan Mendes', 'Willy Semedo', 'Benchimol', 'Dailon Rocha Livramento'],
  'Saudi Arabia': ['Firas Al-Buraikan', 'Saleh Al-Shehri', 'Salem Al-Dawsari', 'Abdullah Radif', 'Ayman Yahya'],
  'Uruguay': ['Darwin Núñez', 'Facundo Pellistri', 'Maximiliano Araújo', 'Federico Viñas', 'Luis Suárez'],
  'France': ['Kylian Mbappé', 'Ousmane Dembélé', 'Marcus Thuram', 'Randal Kolo Muani', 'Bradley Barcola'],
  'Senegal': ['Sadio Mané', 'Nicolas Jackson', 'Boulaye Dia', 'Habib Diallo', 'Ismaïla Sarr'],
  'Norway': ['Erling Haaland', 'Alexander Sørloth', 'Jørgen Strand Larsen', 'Antonio Nusa', 'Oscar Bobb'],
  'Argentina': ['Lautaro Martínez', 'Julián Álvarez', 'Lionel Messi', 'Alejandro Garnacho', 'Nicolás González'],
  'Algeria': ['Riyad Mahrez', 'Baghdad Bounedjah', 'Amine Gouiri', 'Saïd Benrahma', 'Mohamed Amoura'],
  'Austria': ['Michael Gregoritsch', 'Marko Arnautović', 'Christoph Baumgartner', 'Marcel Sabitzer', 'Konrad Laimer'],
  'Jordan': ['Mousa Al-Tamari', 'Yazan Al-Naimat', 'Ali Olwan', 'Mahmoud Al-Mardi', 'Yousef Abu Jalboush'],
  'Portugal': ['Cristiano Ronaldo', 'Rafael Leão', 'Gonçalo Ramos', 'Diogo Jota', 'João Félix'],
  'Uzbekistan': ['Eldor Shomurodov', 'Abbosbek Fayzullaev', 'Oston Urunov', 'Jaloliddin Masharipov', 'Bobur Abdixolikov'],
  'Colombia': ['Luis Díaz', 'Jhon Durán', 'Rafael Santos Borré', 'Luis Sinisterra', 'James Rodríguez'],
  'England': ['Harry Kane', 'Bukayo Saka', 'Jude Bellingham', 'Ollie Watkins', 'Cole Palmer'],
  'Croatia': ['Andrej Kramarić', 'Bruno Petković', 'Ante Budimir', 'Lovro Majer', 'Ivan Perišić'],
  'Ghana': ['Mohammed Kudus', 'Jordan Ayew', 'Inaki Williams', 'Ernest Nuamah', 'Antoine Semenyo'],
  'Panama': ['José Fajardo', 'Ismael Díaz', 'Édgar Bárcenas', 'Cecilio Waterman', 'Yoel Bárcenas'],
  'Bosnia and Herzegovina/Italy/Northern Ireland/Wales': ['Mateo Retegui', 'Federico Chiesa', 'Edin Džeko', 'Brennan Johnson', 'Dion Charles'],
  'Czechia/Denmark/North Macedonia/Republic of Ireland': ['Rasmus Højlund', 'Patrik Schick', 'Bojan Miovski', 'Evan Ferguson', 'Jonas Wind'],
  'Kosovo/Romania/Slovakia/Türkiye': ['Vedat Muriqi', 'Denis Drăguș', 'Robert Boženík', 'Kenan Yıldız', 'Kerem Aktürkoğlu'],
  'Albania/Poland/Sweden/Ukraine': ['Robert Lewandowski', 'Viktor Gyökeres', 'Artem Dovbyk', 'Armando Broja', 'Dejan Kulusevski'],
  'Bolivia/Iraq/Suriname': ['Miguel Terceros', 'Aymen Hussein', 'Sheraldo Becker', 'Yomar Rocha', 'Ali Jasim'],
  'Congo DR/Jamaica/New Caledonia': ['Yoane Wissa', 'Michy Batshuayi', 'Leon Bailey', 'Shamar Nicholson', 'Georges Gope-Fenepej'],
};

function buildTopScorerOptions(groups) {
  const teams = groups.flatMap((group) => group.teams.map((team) => team.name));
  const options = [];
  for (const name of teams) {
    const list = scorerSeedMap[name] || [
      `חלוץ מוביל - ${name}`,
      `ווינגר מוביל - ${name}`,
      `9 קלאסי - ${name}`,
      `סופר סאב - ${name}`,
      `בועט חופשי - ${name}`,
    ];
    for (const playerName of list.slice(0, 5)) {
      options.push({ id: `${teamId(name)}::${slug(playerName)}`, label: playerName, teamName: name });
    }
  }
  options.push({ id: 'other', label: 'אחר (20 נק׳ אם מלך השערים לא ברשימה)', teamName: 'כללי' });
  return options;
}

function stageExactTotal(stage) {
  if (stage === 'quarter') return EXACT_TOTAL_POINTS.quarter;
  if (stage === 'semi') return EXACT_TOTAL_POINTS.semi;
  if (stage === 'final') return EXACT_TOTAL_POINTS.final;
  return EXACT_TOTAL_POINTS.default;
}

function buildWorldCupCompetition() {
  const groups = buildWorldCupGroups();
  const firstKickoff = '2026-06-11T18:00:00Z';
  const matches = [];
  let sequence = 1;
  const groupOffsets = [0, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6];
  const roundRobin = [
    [[0, 1], [2, 3]],
    [[0, 2], [3, 1]],
    [[0, 3], [1, 2]],
  ];
  const kickoffHours = [18, 21];
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    for (let roundIndex = 0; roundIndex < roundRobin.length; roundIndex += 1) {
      const dayOffset = groupOffsets[groupIndex] + roundIndex * 8;
      const fixtures = roundRobin[roundIndex];
      fixtures.forEach(([homeIndex, awayIndex], fixtureIndex) => {
        const kickoff = new Date(firstKickoff);
        kickoff.setUTCDate(kickoff.getUTCDate() + dayOffset);
        kickoff.setUTCHours(kickoffHours[fixtureIndex], 0, 0, 0);
        const homeTeam = group.teams[homeIndex];
        const awayTeam = group.teams[awayIndex];
        matches.push({
          id: `wc-match-${String(sequence).padStart(3, '0')}`,
          sequence,
          competitionId: 'worldcup2026',
          stage: 'group',
          stageLabel: STAGE_LABELS.group,
          stageOrder: 1,
          groupId: group.id,
          roundLabel: `מחזור ${roundIndex + 1}`,
          homeTeam,
          awayTeam,
          kickoffAt: kickoff.toISOString(),
          venue: `אצטדיון ${group.id}-${roundIndex + 1}`,
        });
        sequence += 1;
      });
    }
  }

  const round32Pairs = [
    ['1A', '3/4I'], ['1B', '3/4G'], ['1C', '3/4E'], ['1D', '3/4C'],
    ['1E', '3/4A'], ['1F', '3/4L'], ['1G', '3/4J'], ['1H', '3/4B'],
    ['1I', '3/4K'], ['1J', '3/4F'], ['1K', '3/4D'], ['1L', '3/4H'],
    ['2A', '2H'], ['2B', '2I'], ['2C', '2J'], ['2D', '2K'],
  ];
  const knockoutTemplates = [
    { stage: 'round32', count: 16, start: '2026-06-28T16:00:00Z', gapDays: 1, pairLabels: round32Pairs },
    { stage: 'round16', count: 8, start: '2026-07-04T16:00:00Z', gapDays: 1 },
    { stage: 'quarter', count: 4, start: '2026-07-09T18:00:00Z', gapDays: 1 },
    { stage: 'semi', count: 2, start: '2026-07-14T18:00:00Z', gapDays: 1 },
  ];

  let previousStageMatchIds = [];
  knockoutTemplates.forEach((template, templateIndex) => {
    const currentStageMatchIds = [];
    for (let i = 0; i < template.count; i += 1) {
      const kickoff = new Date(template.start);
      kickoff.setUTCDate(kickoff.getUTCDate() + Math.floor(i / 2) * template.gapDays);
      kickoff.setUTCHours(i % 2 === 0 ? 18 : 21, 0, 0, 0);
      let homeLabel;
      let awayLabel;
      if (template.stage === 'round32') {
        [homeLabel, awayLabel] = template.pairLabels[i];
      } else {
        const first = previousStageMatchIds[i * 2];
        const second = previousStageMatchIds[i * 2 + 1];
        homeLabel = `Winner ${first}`;
        awayLabel = `Winner ${second}`;
      }
      const matchId = `wc-match-${String(sequence).padStart(3, '0')}`;
      matches.push({
        id: matchId,
        sequence,
        competitionId: 'worldcup2026',
        stage: template.stage,
        stageLabel: STAGE_LABELS[template.stage],
        stageOrder: 10 + templateIndex,
        roundLabel: template.stage === 'round32' ? `32 האחרונות - משחק ${i + 1}` : `${STAGE_LABELS[template.stage]} - משחק ${i + 1}`,
        homeTeam: { id: teamId(homeLabel), name: homeLabel, placeholder: true },
        awayTeam: { id: teamId(awayLabel), name: awayLabel, placeholder: true },
        kickoffAt: kickoff.toISOString(),
        venue: `Knockout Stadium ${i + 1}`,
      });
      currentStageMatchIds.push(matchId);
      sequence += 1;
    }
    previousStageMatchIds = currentStageMatchIds;
  });

  const thirdPlaceKickoff = '2026-07-18T18:00:00Z';
  matches.push({
    id: `wc-match-${String(sequence).padStart(3, '0')}`,
    sequence,
    competitionId: 'worldcup2026',
    stage: 'thirdPlace',
    stageLabel: STAGE_LABELS.thirdPlace,
    stageOrder: 14,
    roundLabel: STAGE_LABELS.thirdPlace,
    homeTeam: { id: 'loser-semi-1', name: 'Loser wc-match-101', placeholder: true },
    awayTeam: { id: 'loser-semi-2', name: 'Loser wc-match-102', placeholder: true },
    kickoffAt: thirdPlaceKickoff,
    venue: 'Bronze Match Stadium',
  });
  sequence += 1;
  matches.push({
    id: `wc-match-${String(sequence).padStart(3, '0')}`,
    sequence,
    competitionId: 'worldcup2026',
    stage: 'final',
    stageLabel: STAGE_LABELS.final,
    stageOrder: 15,
    roundLabel: STAGE_LABELS.final,
    homeTeam: { id: 'winner-semi-1', name: 'Winner wc-match-101', placeholder: true },
    awayTeam: { id: 'winner-semi-2', name: 'Winner wc-match-102', placeholder: true },
    kickoffAt: '2026-07-19T18:00:00Z',
    venue: 'New York New Jersey Stadium',
  });

  const topScorerOptions = buildTopScorerOptions(groups);
  const winnerOptions = groups.flatMap((group) => group.teams).map((team) => ({ id: team.id, label: team.name }));

  return {
    id: 'worldcup2026',
    name: 'מונדיאל 2026',
    subtitle: '48 נבחרות, 12 בתים, 104 משחקים',
    mode: 'tournament',
    groups,
    matches,
    firstKickoffAt: firstKickoff,
    topScorerOptions,
    winnerOptions,
    highlights: [
      { id: 'golazo', label: 'Golazo תקצירים', url: 'https://t.me/s/golazo_o' },
      { id: 'fifa', label: 'FIFA - לוח המשחקים', url: 'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/match-schedule-fixtures-results-teams-stadiums' },
      { id: 'fifa-groups', label: 'FIFA - הבתים וההגרלה', url: 'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/final-draw-results' },
      { id: '365', label: '365Scores - מונדיאל 2026', url: 'https://www.365scores.com/football/league/fifa-world-cup-5930' },
    ],
  };
}

function buildTrialCompetition() {
  const matches = [
    {
      id: 'ucl-today-001',
      sequence: 1,
      competitionId: 'trialToday',
      stage: 'quarter',
      stageLabel: 'צ׳מפיונס - רבע גמר',
      stageOrder: 1,
      roundLabel: 'רבע גמר - משחק 1',
      homeTeam: { id: teamId('Arsenal'), name: 'Arsenal' },
      awayTeam: { id: teamId('Sporting CP'), name: 'Sporting CP' },
      kickoffAt: '2026-04-15T19:00:00Z',
      venue: 'Arsenal Stadium, London',
    },
    {
      id: 'ucl-today-002',
      sequence: 2,
      competitionId: 'trialToday',
      stage: 'quarter',
      stageLabel: 'צ׳מפיונס - רבע גמר',
      stageOrder: 1,
      roundLabel: 'רבע גמר - משחק 2',
      homeTeam: { id: teamId('Bayern München'), name: 'Bayern München' },
      awayTeam: { id: teamId('Real Madrid'), name: 'Real Madrid' },
      kickoffAt: '2026-04-15T19:00:00Z',
      venue: 'Football Arena Munich',
    },
  ];
  return {
    id: 'trialToday',
    name: 'משחקי היום - צ׳מפיונס',
    subtitle: 'בדיקת לייב על רבע גמר ליגת האלופות',
    mode: 'daily',
    groups: [],
    matches,
    firstKickoffAt: matches[0].kickoffAt,
    topScorerOptions: [],
    winnerOptions: [],
    highlights: [
      { id: 'uefa-fixtures', label: 'UEFA - כל המשחקים', url: 'https://www.uefa.com/uefachampionsleague/news/02a3-202d9ac10d17-a37e1f50256a-1000--champions-league-quarter-final-ties-confirmed/' },
      { id: 'arsenal-preview', label: 'UEFA - ארסנל נגד ספורטינג', url: 'https://www.uefa.com/uefachampionsleague/news/02a4-205b6d4eb14a-e8ee7afd569f-1000--arsenal-vs-sporting-cp-champions-league-preview-where-to-w/' },
      { id: 'quarter-stats', label: 'UEFA - נתונים לקראת הגומלין', url: 'https://www.uefa.com/uefachampionsleague/news/02a4-205f25ee8b2f-a897e762ffe8-1000--champions-league-quarter-finals-key-stats-and-what-to-look-o/' },
      { id: 'golazo', label: 'Golazo תקצירים', url: 'https://t.me/s/golazo_o' },
    ],
  };
}

function buildCompetitions() {
  const worldCup = buildWorldCupCompetition();
  const trial = buildTrialCompetition();
  return {
    worldcup2026: worldCup,
    trialToday: trial,
  };
}

const competitions = buildCompetitions();
const allMatches = Object.values(competitions).flatMap((competition) => competition.matches);

function defaultMatchState(match) {
  return {
    matchId: match.id,
    competitionId: match.competitionId,
    status: 'NS',
    statusLabel: 'טרם החל',
    currentHome: null,
    currentAway: null,
    elapsed: null,
    home90: null,
    away90: null,
    finalHome: null,
    finalAway: null,
    penaltyHome: null,
    penaltyAway: null,
    startedAt: null,
    finishedAt: null,
    finalLocked: false,
    source: 'seed',
    lateGoalSwing: 0,
    providerFixtureId: null,
    lastSyncAt: null,
  };
}

function defaultState() {
  const matchState = {};
  allMatches.forEach((match) => {
    matchState[match.id] = defaultMatchState(match);
  });
  return {
    version: 3,
    matchState,
    predictions: {},
    bonuses: {},
    userPrefs: {},
    actualBonuses: {
      worldcup2026: {
        winnerTeamId: null,
        topScorerChoiceId: null,
        topScorerName: null,
      },
      trialToday: {
        winnerTeamId: null,
        topScorerChoiceId: null,
        topScorerName: null,
      },
    },
    lastLiveSyncAt: null,
    lastScheduleSyncAt: null,
  };
}

function ensureStateShape(state) {
  const next = state && typeof state === 'object' ? state : defaultState();
  next.matchState = next.matchState || {};
  for (const match of allMatches) {
    if (!next.matchState[match.id]) next.matchState[match.id] = defaultMatchState(match);
  }
  next.predictions = next.predictions || {};
  next.bonuses = next.bonuses || {};
  next.userPrefs = next.userPrefs || {};
  next.actualBonuses = next.actualBonuses || defaultState().actualBonuses;
  next.lastLiveSyncAt = next.lastLiveSyncAt || null;
  next.lastScheduleSyncAt = next.lastScheduleSyncAt || null;
  return next;
}

async function ensureData() {
  await fs.mkdir(dataRoot, { recursive: true });
  let users = await readJsonFile(usersPath, null);
  if (!users) {
    users = seedUsers();
    await writeJsonFile(usersPath, users);
  }
  let state = await readJsonFile(statePath, null);
  if (!state) {
    state = defaultState();
    await writeJsonFile(statePath, state);
  }
  return { users, state: ensureStateShape(state) };
}

let users = [];
let state = defaultState();

async function persistUsers() {
  await writeJsonFile(usersPath, users);
}

async function persistState() {
  await writeJsonFile(statePath, state);
}

function getCompetition(competitionId) {
  return competitions[competitionId] || competitions.worldcup2026;
}

function getUserPredictions(userId, competitionId) {
  const collection = state.predictions[userId] || {};
  return collection[competitionId] || {};
}

function getUserBonuses(userId, competitionId) {
  const collection = state.bonuses[userId] || {};
  return collection[competitionId] || { winnerTeamId: null, topScorerChoiceId: null };
}

function getUserPrefs(userId) {
  return state.userPrefs[userId] || { remindersEnabled: false };
}

function isLocked(match) {
  const deadline = new Date(match.kickoffAt).getTime() - envConfig.lockMinutes * 60 * 1000;
  return Date.now() >= deadline;
}

function isRevealed(match, matchState) {
  if (matchState && matchState.startedAt) return true;
  return Date.now() >= new Date(match.kickoffAt).getTime();
}

function outcome(home, away) {
  if (home == null || away == null) return null;
  if (home > away) return 'H';
  if (home < away) return 'A';
  return 'D';
}

function scorePrediction(match, prediction, matchState) {
  if (!prediction || !matchState || !matchState.finalLocked || matchState.home90 == null || matchState.away90 == null) {
    return 0;
  }
  const predictedOutcome = outcome(prediction.home, prediction.away);
  const actualOutcome = outcome(matchState.home90, matchState.away90);
  if (prediction.home === matchState.home90 && prediction.away === matchState.away90) {
    return stageExactTotal(match.stage);
  }
  if (predictedOutcome && predictedOutcome === actualOutcome) {
    return 1;
  }
  return 0;
}

function initializeTable(group) {
  const rows = {};
  group.teams.forEach((team) => {
    rows[team.id] = {
      teamId: team.id,
      teamName: team.name,
      points: 0,
      gf: 0,
      ga: 0,
      gd: 0,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
    };
  });
  return rows;
}

function applyScore(rowHome, rowAway, homeGoals, awayGoals) {
  rowHome.played += 1;
  rowAway.played += 1;
  rowHome.gf += homeGoals;
  rowHome.ga += awayGoals;
  rowAway.gf += awayGoals;
  rowAway.ga += homeGoals;
  rowHome.gd = rowHome.gf - rowHome.ga;
  rowAway.gd = rowAway.gf - rowAway.ga;
  if (homeGoals > awayGoals) {
    rowHome.points += 3;
    rowHome.wins += 1;
    rowAway.losses += 1;
  } else if (homeGoals < awayGoals) {
    rowAway.points += 3;
    rowAway.wins += 1;
    rowHome.losses += 1;
  } else {
    rowHome.points += 1;
    rowAway.points += 1;
    rowHome.draws += 1;
    rowAway.draws += 1;
  }
}

function sortTableRows(rows) {
  return Object.values(rows).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.gd !== a.gd) return b.gd - a.gd;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return a.teamName.localeCompare(b.teamName, 'en');
  });
}

function computeGroupTablesForActual(competition) {
  const tables = {};
  for (const group of competition.groups) {
    const rows = initializeTable(group);
    const groupMatches = competition.matches.filter((match) => match.groupId === group.id);
    let complete = true;
    for (const match of groupMatches) {
      const matchState = state.matchState[match.id];
      if (!matchState || !matchState.finalLocked || matchState.home90 == null || matchState.away90 == null) {
        complete = false;
        continue;
      }
      applyScore(rows[match.homeTeam.id], rows[match.awayTeam.id], matchState.home90, matchState.away90);
    }
    tables[group.id] = {
      complete,
      rows: sortTableRows(rows),
    };
  }
  return tables;
}

function computeGroupTablesForPrediction(userId, competition) {
  const predictions = getUserPredictions(userId, competition.id);
  const result = {};
  for (const group of competition.groups) {
    const rows = initializeTable(group);
    const groupMatches = competition.matches.filter((match) => match.groupId === group.id);
    let complete = true;
    for (const match of groupMatches) {
      const prediction = predictions[match.id];
      if (!prediction || prediction.home == null || prediction.away == null) {
        complete = false;
        break;
      }
      applyScore(rows[match.homeTeam.id], rows[match.awayTeam.id], prediction.home, prediction.away);
    }
    result[group.id] = {
      complete,
      rows: sortTableRows(rows),
    };
  }
  return result;
}

function computeStandings(competition) {
  const actualTables = competition.mode === 'tournament' ? computeGroupTablesForActual(competition) : {};
  const rows = users
    .filter((user) => user.role === 'player')
    .map((user) => {
      const predictions = getUserPredictions(user.id, competition.id);
      const bonuses = getUserBonuses(user.id, competition.id);
      let matchPoints = 0;
      let exactHits = 0;
      let directionHits = 0;
      let knockoutPoints = 0;
      let lateSwingHits = 0;
      let finishedPredictions = 0;
      for (const match of competition.matches) {
        const matchState = state.matchState[match.id];
        const prediction = predictions[match.id];
        const points = scorePrediction(match, prediction, matchState);
        if (points > 0) {
          if (match.stage !== 'group') knockoutPoints += points;
          if (matchState && matchState.lateGoalSwing && points > 0) lateSwingHits += matchState.lateGoalSwing;
        }
        matchPoints += points;
        if (matchState && matchState.finalLocked) {
          finishedPredictions += 1;
          if (prediction && prediction.home === matchState.home90 && prediction.away === matchState.away90) exactHits += 1;
          else if (prediction && outcome(prediction.home, prediction.away) === outcome(matchState.home90, matchState.away90)) directionHits += 1;
        }
      }

      let groupBonus = 0;
      if (competition.mode === 'tournament') {
        const predictedTables = computeGroupTablesForPrediction(user.id, competition);
        for (const group of competition.groups) {
          const actual = actualTables[group.id];
          const predicted = predictedTables[group.id];
          if (!actual || !actual.complete || !predicted || !predicted.complete) continue;
          if (predicted.rows[0]?.teamId === actual.rows[0]?.teamId) groupBonus += 1;
          if (predicted.rows[1]?.teamId === actual.rows[1]?.teamId) groupBonus += 1;
        }
      }

      let winnerBonus = 0;
      let topScorerBonus = 0;
      const actualBonus = state.actualBonuses[competition.id] || {};
      if (competition.mode === 'tournament') {
        if (bonuses.winnerTeamId && actualBonus.winnerTeamId && bonuses.winnerTeamId === actualBonus.winnerTeamId) winnerBonus = 20;
        if (bonuses.topScorerChoiceId && actualBonus.topScorerChoiceId) {
          if (bonuses.topScorerChoiceId === actualBonus.topScorerChoiceId) {
            topScorerBonus = bonuses.topScorerChoiceId === 'other' ? 20 : 15;
          } else if (bonuses.topScorerChoiceId === 'other' && actualBonus.topScorerChoiceId !== 'other') {
            const actualChoiceInList = competition.topScorerOptions.some((option) => option.id === actualBonus.topScorerChoiceId && option.id !== 'other');
            if (!actualChoiceInList) topScorerBonus = 20;
          }
        }
      }

      return {
        userId: user.id,
        displayName: user.displayName,
        total: matchPoints + groupBonus + winnerBonus + topScorerBonus,
        matchPoints,
        groupBonus,
        winnerBonus,
        topScorerBonus,
        exactHits,
        directionHits,
        finishedPredictions,
        knockoutPoints,
        lateSwingHits,
      };
    })
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (b.knockoutPoints !== a.knockoutPoints) return b.knockoutPoints - a.knockoutPoints;
      if (b.exactHits !== a.exactHits) return b.exactHits - a.exactHits;
      return a.displayName.localeCompare(b.displayName, 'he');
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));
  return rows;
}

function computeInsights(competition, standings) {
  const insights = [];
  if (!standings.length) return insights;
  const exactMaster = [...standings].sort((a, b) => b.exactHits - a.exactHits)[0];
  const knockoutKing = [...standings].sort((a, b) => b.knockoutPoints - a.knockoutPoints)[0];
  const clutch = [...standings].sort((a, b) => b.lateSwingHits - a.lateSwingHits)[0];
  const accuracyLeader = [...standings]
    .map((row) => ({ ...row, accuracy: row.finishedPredictions ? Math.round((row.exactHits / row.finishedPredictions) * 100) : 0 }))
    .sort((a, b) => b.accuracy - a.accuracy)[0];

  insights.push({ title: 'אמן התוצאות המדויקות', text: `${exactMaster.displayName} מוביל עם ${exactMaster.exactHits} פגיעות מדויקות.` });
  insights.push({ title: 'מלך הנוקאאוט', text: `${knockoutKing.displayName} צבר ${knockoutKing.knockoutPoints} נק׳ בשלבי ההכרעה.` });
  insights.push({ title: 'דיוק יחסי', text: `${accuracyLeader.displayName} מדייק ב-${accuracyLeader.accuracy}% מהמשחקים שהוכרעו.` });
  if (clutch && clutch.lateSwingHits > 0) {
    insights.push({ title: 'הכי הרבה מזל', text: `${clutch.displayName} נהנה מ-${clutch.lateSwingHits} שערי קלאץ׳ ששינו לו תפיסות.` });
  } else {
    insights.push({ title: 'הכי הרבה מזל', text: 'עדיין אין מספיק שערי קלאץ׳ כדי להכתיר מישהו. זה יגיע מהר.' });
  }
  const average = standings.length ? Math.round(standings.reduce((sum, row) => sum + row.total, 0) / standings.length) : 0;
  insights.push({ title: 'ממוצע הליגה', text: `ממוצע הנקודות הנוכחי בליגה הוא ${average}.` });
  return insights;
}

function buildRevealedPredictions(match, competitionId) {
  const revealed = isRevealed(match, state.matchState[match.id]);
  const rows = [];
  let submissionCount = 0;
  for (const user of users.filter((item) => item.role === 'player')) {
    const prediction = getUserPredictions(user.id, competitionId)[match.id];
    if (prediction) submissionCount += 1;
    if (!revealed || !prediction) continue;
    const points = scorePrediction(match, prediction, state.matchState[match.id]);
    rows.push({ displayName: user.displayName, home: prediction.home, away: prediction.away, updatedAt: prediction.updatedAt, points });
  }
  return { revealed, submissionCount, rows };
}

function buildMatchesView(userId, competition) {
  const predictions = getUserPredictions(userId, competition.id);
  return competition.matches.map((match) => {
    const matchState = state.matchState[match.id];
    const revealed = buildRevealedPredictions(match, competition.id);
    const prediction = predictions[match.id] || null;
    return {
      id: match.id,
      stage: match.stage,
      stageLabel: match.stageLabel,
      roundLabel: match.roundLabel,
      groupId: match.groupId || null,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoffAt: match.kickoffAt,
      venue: match.venue,
      isLocked: isLocked(match),
      isRevealed: revealed.revealed,
      submissionCount: revealed.submissionCount,
      revealedPredictions: revealed.rows,
      myPrediction: prediction,
      matchState,
      exactTotalPoints: stageExactTotal(match.stage),
    };
  });
}

function buildBootstrap(user, competitionId) {
  const competition = getCompetition(competitionId);
  const standings = computeStandings(competition);
  const matches = buildMatchesView(user.id, competition);
  const bonus = getUserBonuses(user.id, competition.id);
  const prefs = getUserPrefs(user.id);
  return {
    me: {
      id: user.id,
      displayName: user.displayName,
      role: user.role,
    },
    config: {
      publicBaseUrl: defaultPublicBaseUrl,
      lockMinutes: envConfig.lockMinutes,
      reminderMinutes: envConfig.reminderMinutes,
      liveProvider: envConfig.liveProvider,
      competitions: Object.values(competitions).map((item) => ({ id: item.id, name: item.name, subtitle: item.subtitle })),
    },
    selectedCompetition: competition.id,
    competition: {
      id: competition.id,
      name: competition.name,
      subtitle: competition.subtitle,
      mode: competition.mode,
      firstKickoffAt: competition.firstKickoffAt,
      highlights: competition.highlights,
      groups: competition.groups,
      matches,
      scoring: {
        direction: 1,
        exactDefault: 3,
        exactQuarter: 4,
        exactSemi: 5,
        exactFinal: 6,
        groupTopTwoBonusEach: 1,
        winnerBonus: 20,
        topScorerBonus: 15,
        topScorerOtherBonus: 20,
      },
      winnerOptions: competition.winnerOptions,
      topScorerOptions: competition.topScorerOptions,
      myBonus: bonus,
      actualBonus: state.actualBonuses[competition.id] || null,
    },
    standings,
    insights: computeInsights(competition, standings),
    prefs,
    admin: user.role === 'admin'
      ? {
          users: users.map((item) => ({ id: item.id, username: item.username, displayName: item.displayName, role: item.role, lastLoginAt: item.lastLoginAt })),
          live: {
            provider: envConfig.liveProvider,
            lastLiveSyncAt: state.lastLiveSyncAt,
            lastScheduleSyncAt: state.lastScheduleSyncAt,
          },
        }
      : null,
  };
}

async function upsertPrediction(userId, competitionId, matchId, home, away) {
  const competition = getCompetition(competitionId);
  const match = competition.matches.find((item) => item.id === matchId);
  if (!match) throw new Error('Match not found');
  if (isLocked(match)) throw new Error('ניחוש נעול - פחות משתי דקות לפתיחה');
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0 || home > 20 || away > 20) {
    throw new Error('תוצאה לא תקינה');
  }
  state.predictions[userId] = state.predictions[userId] || {};
  state.predictions[userId][competitionId] = state.predictions[userId][competitionId] || {};
  state.predictions[userId][competitionId][matchId] = { home, away, updatedAt: nowIso() };
  await persistState();
}

async function upsertBonuses(userId, competitionId, payload) {
  const competition = getCompetition(competitionId);
  if (competition.mode !== 'tournament') return;
  const lockAt = new Date(competition.firstKickoffAt).getTime() - envConfig.lockMinutes * 60 * 1000;
  if (Date.now() >= lockAt) throw new Error('בונוסים ננעלו');
  const winnerTeamId = payload.winnerTeamId || null;
  const topScorerChoiceId = payload.topScorerChoiceId || null;
  state.bonuses[userId] = state.bonuses[userId] || {};
  state.bonuses[userId][competitionId] = { winnerTeamId, topScorerChoiceId, updatedAt: nowIso() };
  await persistState();
}

async function updateUserPrefs(userId, payload) {
  state.userPrefs[userId] = {
    ...getUserPrefs(userId),
    remindersEnabled: Boolean(payload.remindersEnabled),
    updatedAt: nowIso(),
  };
  await persistState();
}

function providerEnabled() {
  return envConfig.liveProvider !== 'none';
}

async function apiFootballRequest(endpoint, params = {}) {
  const url = new URL(endpoint, `${envConfig.apiFootballBase}/`);
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === '') return;
    url.searchParams.set(key, String(value));
  });
  const response = await fetch(url, {
    headers: {
      'x-apisports-key': envConfig.apiFootballKey,
    },
  });
  if (!response.ok) {
    throw new Error(`API-Football request failed (${response.status})`);
  }
  return response.json();
}

function updateActualWinnerFromFinal(competitionId) {
  const competition = getCompetition(competitionId);
  if (competition.id !== 'worldcup2026') return;
  const finalMatch = competition.matches.find((item) => item.stage === 'final');
  if (!finalMatch) return;
  const matchState = state.matchState[finalMatch.id];
  if (!matchState || !matchState.finalLocked) return;
  let winner = null;
  if ((matchState.finalHome ?? -1) > (matchState.finalAway ?? -1)) winner = finalMatch.homeTeam.id;
  else if ((matchState.finalAway ?? -1) > (matchState.finalHome ?? -1)) winner = finalMatch.awayTeam.id;
  else if ((matchState.penaltyHome ?? -1) > (matchState.penaltyAway ?? -1)) winner = finalMatch.homeTeam.id;
  else if ((matchState.penaltyAway ?? -1) > (matchState.penaltyHome ?? -1)) winner = finalMatch.awayTeam.id;
  state.actualBonuses[competition.id].winnerTeamId = winner;
}

function matchCompetitionByTeams(homeName, awayName, dateHint) {
  const home = normalizeTeamName(homeName);
  const away = normalizeTeamName(awayName);
  const all = allMatches.filter((match) => {
    const matchDay = new Date(match.kickoffAt).toISOString().slice(0, 10);
    const dayOk = !dateHint || matchDay === dateHint;
    return dayOk;
  });
  return all.find((match) => {
    const h = normalizeTeamName(match.homeTeam.name);
    const a = normalizeTeamName(match.awayTeam.name);
    return h === home && a === away;
  });
}

function applyProviderFixtureToMatch(match, fixture) {
  const matchState = state.matchState[match.id] || defaultMatchState(match);
  const statusShort = fixture?.fixture?.status?.short || fixture?.fixture?.statusShort || 'NS';
  const statusLong = fixture?.fixture?.status?.long || statusShort;
  const goalsHome = fixture?.goals?.home ?? fixture?.score?.fulltime?.home ?? null;
  const goalsAway = fixture?.goals?.away ?? fixture?.score?.fulltime?.away ?? null;
  const fullHome = fixture?.score?.fulltime?.home ?? goalsHome;
  const fullAway = fixture?.score?.fulltime?.away ?? goalsAway;
  const finalHome = fixture?.score?.extratime?.home ?? fixture?.score?.penalty?.home ?? goalsHome;
  const finalAway = fixture?.score?.extratime?.away ?? fixture?.score?.penalty?.away ?? goalsAway;
  const penaltyHome = fixture?.score?.penalty?.home ?? null;
  const penaltyAway = fixture?.score?.penalty?.away ?? null;
  const elapsed = fixture?.fixture?.status?.elapsed ?? null;
  const started = LIVE_STARTED_CODES.has(statusShort) || LIVE_FINAL_CODES.has(statusShort);

  matchState.status = statusShort;
  matchState.statusLabel = statusLong;
  matchState.currentHome = goalsHome;
  matchState.currentAway = goalsAway;
  matchState.elapsed = elapsed;
  matchState.providerFixtureId = fixture?.fixture?.id || null;
  matchState.lastSyncAt = nowIso();
  matchState.source = 'live-provider';
  if (started && !matchState.startedAt) matchState.startedAt = nowIso();
  if (LIVE_FINAL_CODES.has(statusShort)) {
    matchState.home90 = fullHome;
    matchState.away90 = fullAway;
    matchState.finalHome = finalHome;
    matchState.finalAway = finalAway;
    matchState.penaltyHome = penaltyHome;
    matchState.penaltyAway = penaltyAway;
    matchState.finalLocked = true;
    matchState.finishedAt = nowIso();
  }
  state.matchState[match.id] = matchState;
}

async function syncGenericProvider() {
  if (!envConfig.genericLiveUrl) return { updated: 0, provider: 'generic' };
  const response = await fetch(envConfig.genericLiveUrl);
  if (!response.ok) throw new Error(`Generic provider failed (${response.status})`);
  const payload = await response.json();
  let updated = 0;
  for (const fixture of payload.matches || []) {
    const dateHint = fixture.kickoffAt ? String(fixture.kickoffAt).slice(0, 10) : null;
    const match = matchCompetitionByTeams(fixture.homeTeam, fixture.awayTeam, dateHint);
    if (!match) continue;
    applyProviderFixtureToMatch(match, {
      fixture: {
        id: fixture.id,
        status: { short: fixture.status, long: fixture.statusLabel || fixture.status, elapsed: fixture.elapsed || null },
      },
      goals: { home: fixture.currentHome, away: fixture.currentAway },
      score: {
        fulltime: { home: fixture.home90, away: fixture.away90 },
        extratime: { home: fixture.finalHome, away: fixture.finalAway },
        penalty: { home: fixture.penaltyHome, away: fixture.penaltyAway },
      },
    });
    updated += 1;
  }
  state.lastLiveSyncAt = nowIso();
  updateActualWinnerFromFinal('worldcup2026');
  await persistState();
  return { updated, provider: 'generic' };
}

async function syncApiFootballProvider() {
  if (!envConfig.apiFootballKey) return { updated: 0, provider: 'api-football', note: 'No API key configured' };
  const updates = [];
  const today = new Date().toISOString().slice(0, 10);
  const calls = [
    apiFootballRequest('fixtures', { live: 'all' }).catch(() => ({ response: [] })),
    apiFootballRequest('fixtures', { league: envConfig.uclLeagueId, season: envConfig.uclSeason, date: today }).catch(() => ({ response: [] })),
  ];
  if (envConfig.worldCupLeagueId) {
    calls.push(apiFootballRequest('fixtures', { league: envConfig.worldCupLeagueId, season: envConfig.worldCupSeason, from: '2026-06-11', to: '2026-07-19' }).catch(() => ({ response: [] })));
    calls.push(apiFootballRequest('players/topscorers', { league: envConfig.worldCupLeagueId, season: envConfig.worldCupSeason }).catch(() => ({ response: [] })));
  }
  const results = await Promise.all(calls);
  const fixtureResponses = results.flatMap((payload, index) => (index === results.length - 1 && envConfig.worldCupLeagueId ? [] : (payload.response || [])));
  let updated = 0;
  for (const fixture of fixtureResponses) {
    const homeName = fixture?.teams?.home?.name;
    const awayName = fixture?.teams?.away?.name;
    const dateHint = fixture?.fixture?.date ? String(fixture.fixture.date).slice(0, 10) : null;
    const match = matchCompetitionByTeams(homeName, awayName, dateHint);
    if (!match) continue;
    applyProviderFixtureToMatch(match, fixture);
    updated += 1;
    updates.push(match.id);
  }
  if (envConfig.worldCupLeagueId) {
    const topScorerPayload = results[results.length - 1];
    const topEntry = topScorerPayload?.response?.[0];
    if (topEntry?.player?.name) {
      const option = competitions.worldcup2026.topScorerOptions.find((item) => item.label === topEntry.player.name);
      state.actualBonuses.worldcup2026.topScorerChoiceId = option ? option.id : 'other';
      state.actualBonuses.worldcup2026.topScorerName = topEntry.player.name;
    }
  }
  state.lastLiveSyncAt = nowIso();
  updateActualWinnerFromFinal('worldcup2026');
  await persistState();
  return { updated, provider: 'api-football', updates };
}

async function syncLiveProvider() {
  if (!providerEnabled()) return { updated: 0, provider: 'none' };
  if (envConfig.liveProvider === 'generic') return syncGenericProvider();
  if (envConfig.liveProvider === 'api-football') return syncApiFootballProvider();
  return { updated: 0, provider: envConfig.liveProvider };
}

function routeStatic(reqUrl) {
  if (reqUrl.pathname.startsWith('/api/')) return null;
  let requestedPath = reqUrl.pathname === '/' ? '/index.html' : reqUrl.pathname;
  const safePath = path.normalize(requestedPath).replace(/^\.+/, '');
  const fullPath = path.join(publicRoot, safePath);
  if (!fullPath.startsWith(publicRoot)) return 'FORBIDDEN';
  return fullPath;
}

(async () => {
  const initial = await ensureData();
  users = initial.users;
  state = initial.state;

  setInterval(() => {
    syncLiveProvider().catch((error) => console.error('[live-sync]', error.message));
  }, 60 * 1000);

  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url || '/', `http://${req.headers.host}`);
      const method = req.method || 'GET';
      const user = getSessionUser(req, users);

      if (reqUrl.pathname === '/healthz' && method === 'GET') {
        return sendJson(res, 200, { ok: true, status: 'healthy', time: nowIso() });
      }

      if (reqUrl.pathname === '/api/login' && method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}');
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        const found = users.find((item) => item.username === username);
        if (!found || !verifyPassword(password, found)) {
          return sendJson(res, 401, { error: 'שם משתמש או סיסמה שגויים' });
        }
        found.lastLoginAt = nowIso();
        await persistUsers();
        const sessionId = createCookieSession(found.id);
        return sendJson(
          res,
          200,
          { ok: true, role: found.role },
          {
            'Set-Cookie': sessionCookieHeader(req, sessionId),
          },
        );
      }

      if (reqUrl.pathname === '/api/logout' && method === 'POST') {
        const cookies = parseCookies(req);
        if (cookies.session) sessions.delete(cookies.session);
        return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookieHeader(req, '', 0) });
      }

      if (reqUrl.pathname === '/api/me' && method === 'GET') {
        if (!user) return unauthorized(res);
        return sendJson(res, 200, { id: user.id, displayName: user.displayName, role: user.role });
      }

      if (reqUrl.pathname === '/api/bootstrap' && method === 'GET') {
        if (!user) return unauthorized(res);
        const competitionId = reqUrl.searchParams.get('competition') || 'worldcup2026';
        return sendJson(res, 200, buildBootstrap(user, competitionId));
      }

      if (reqUrl.pathname === '/api/predictions' && method === 'PUT') {
        if (!user) return unauthorized(res);
        const body = JSON.parse((await readBody(req)) || '{}');
        await upsertPrediction(user.id, body.competitionId, body.matchId, body.home, body.away);
        return sendJson(res, 200, { ok: true });
      }

      if (reqUrl.pathname === '/api/bonuses' && method === 'PUT') {
        if (!user) return unauthorized(res);
        const body = JSON.parse((await readBody(req)) || '{}');
        await upsertBonuses(user.id, body.competitionId, body);
        return sendJson(res, 200, { ok: true });
      }

      if (reqUrl.pathname === '/api/prefs' && method === 'PUT') {
        if (!user) return unauthorized(res);
        const body = JSON.parse((await readBody(req)) || '{}');
        await updateUserPrefs(user.id, body);
        return sendJson(res, 200, { ok: true });
      }

      if (reqUrl.pathname === '/api/live-sync' && method === 'POST') {
        if (!user) return unauthorized(res);
        if (user.role !== 'admin') return forbidden(res);
        const payload = await syncLiveProvider();
        return sendJson(res, 200, payload);
      }

      if (reqUrl.pathname === '/api/admin/users' && method === 'GET') {
        if (!user) return unauthorized(res);
        if (user.role !== 'admin') return forbidden(res);
        return sendJson(res, 200, users.map((item) => ({ id: item.id, username: item.username, displayName: item.displayName, role: item.role, lastLoginAt: item.lastLoginAt })));
      }

      if (reqUrl.pathname === '/api/admin/users' && method === 'POST') {
        if (!user) return unauthorized(res);
        if (user.role !== 'admin') return forbidden(res);
        const body = JSON.parse((await readBody(req)) || '{}');
        const username = String(body.username || '').trim();
        const displayName = String(body.displayName || '').trim();
        const password = String(body.password || '');
        const role = body.role === 'admin' ? 'admin' : 'player';
        if (!username || !displayName || password.length < 8) {
          return sendJson(res, 400, { error: 'פרטי משתמש חסרים או סיסמה קצרה מדי' });
        }
        if (users.some((item) => item.username === username)) {
          return sendJson(res, 409, { error: 'שם המשתמש כבר קיים' });
        }
        const newUser = makeUser(username, displayName, role, password);
        users.push(newUser);
        await persistUsers();
        return sendJson(res, 200, { ok: true, user: { id: newUser.id, username: newUser.username, displayName: newUser.displayName, role: newUser.role } });
      }

      if (reqUrl.pathname === '/api/admin/reset-password' && method === 'POST') {
        if (!user) return unauthorized(res);
        if (user.role !== 'admin') return forbidden(res);
        const body = JSON.parse((await readBody(req)) || '{}');
        const target = users.find((item) => item.id === body.userId);
        const newPassword = String(body.newPassword || '');
        if (!target || newPassword.length < 8) {
          return sendJson(res, 400, { error: 'לא נמצא משתמש או שהסיסמה קצרה מדי' });
        }
        const record = createPasswordRecord(newPassword);
        target.salt = record.salt;
        target.passwordHash = record.passwordHash;
        await persistUsers();
        return sendJson(res, 200, { ok: true });
      }

      if (reqUrl.pathname === '/api/admin/result-override' && method === 'POST') {
        if (!user) return unauthorized(res);
        if (user.role !== 'admin') return forbidden(res);
        const body = JSON.parse((await readBody(req)) || '{}');
        const match = allMatches.find((item) => item.id === body.matchId);
        if (!match) return sendJson(res, 404, { error: 'Match not found' });
        const matchState = state.matchState[match.id] || defaultMatchState(match);
        matchState.status = body.status || 'FT';
        matchState.statusLabel = body.statusLabel || 'ידני';
        matchState.home90 = Number(body.home90);
        matchState.away90 = Number(body.away90);
        matchState.finalHome = Number(body.finalHome ?? body.home90);
        matchState.finalAway = Number(body.finalAway ?? body.away90);
        matchState.finalLocked = true;
        matchState.source = 'admin';
        matchState.startedAt = matchState.startedAt || nowIso();
        matchState.finishedAt = nowIso();
        state.matchState[match.id] = matchState;
        updateActualWinnerFromFinal(match.competitionId);
        await persistState();
        return sendJson(res, 200, { ok: true });
      }

      if (reqUrl.pathname === '/api/admin/actual-bonus' && method === 'POST') {
        if (!user) return unauthorized(res);
        if (user.role !== 'admin') return forbidden(res);
        const body = JSON.parse((await readBody(req)) || '{}');
        const competitionId = body.competitionId || 'worldcup2026';
        state.actualBonuses[competitionId] = {
          ...(state.actualBonuses[competitionId] || {}),
          winnerTeamId: body.winnerTeamId ?? state.actualBonuses[competitionId]?.winnerTeamId ?? null,
          topScorerChoiceId: body.topScorerChoiceId ?? state.actualBonuses[competitionId]?.topScorerChoiceId ?? null,
          topScorerName: body.topScorerName ?? state.actualBonuses[competitionId]?.topScorerName ?? null,
        };
        await persistState();
        return sendJson(res, 200, { ok: true });
      }

      const staticPath = routeStatic(reqUrl);
      if (staticPath === 'FORBIDDEN') return sendText(res, 403, 'Forbidden');
      if (staticPath) {
        const file = await fs.readFile(staticPath);
        res.writeHead(200, baseHeaders({ 'Content-Type': getContentType(staticPath) }));
        return res.end(file);
      }

      return sendText(res, 404, 'Not found');
    } catch (error) {
      console.error(error);
      return sendJson(res, 500, { error: error.message || 'Internal server error' });
    }
  });

  server.listen(port, () => {
    console.log(`World Cup Predictor v4 listening on ${defaultPublicBaseUrl}`);
  });
})();
