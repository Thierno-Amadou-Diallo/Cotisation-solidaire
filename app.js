/* ---------- Réglages ---------- */
var DEFAULT_AMOUNT = 700000;
var DEADLINE = new Date(2027, 1, 15); // 15 février 2027
var MAX_FILE = 5 * 1024 * 1024;       // 5 Mo

// Noms et prénoms proposés uniquement à l'inscription (dédoublonnés)
var REGISTER_NOMS = ['Diallo', 'Baldé', 'Sow', 'Bah'];
var REGISTER_PRENOMS = [
  'Thierno Amadou',
  'Aboubacar Yassar',
  'Thierno Hamidou',
  'Mamadou Fadja',
  'Abdoul Karim',
  'Abdoulaye Souleymane',
  'Elhadj Oumar',
  'Djouldé'
];

// Liste des inscrits (remplie uniquement depuis la table Supabase "membres")
var MEMBERS = [];

// 16 couleurs bien contrastées et distinctes (aucun doublon)
var PALETTE = [
  { fg: '#1D4ED8', bg: '#E8EEFF' }, // 1. Bleu roi
  { fg: '#047857', bg: '#E1F4EC' }, // 2. Vert émeraude
  { fg: '#7E22CE', bg: '#F3E8FF' }, // 3. Violet
  { fg: '#C2410C', bg: '#FFEDDD' }, // 4. Orange brûlé
  { fg: '#BE185D', bg: '#FFE6F0' }, // 5. Framboise
  { fg: '#0369A1', bg: '#E0F2FE' }, // 6. Bleu océan
  { fg: '#B91C1C', bg: '#FEE4E4' }, // 7. Rouge carmin
  { fg: '#4D7C0F', bg: '#ECFCCB' }, // 8. Vert lime foncé
  { fg: '#B45309', bg: '#FEF3C7' }, // 9. Ambre / Ocre
  { fg: '#4338CA', bg: '#E0E7FF' }, // 10. Indigo
  { fg: '#0E7490', bg: '#CFFAFE' }, // 11. Cyan profond
  { fg: '#A21CAF', bg: '#FAE8FF' }, // 12. Magenta
  { fg: '#374151', bg: '#F3F4F6' }, // 13. Gris anthracite
  { fg: '#9A3412', bg: '#FFEDD5' }, // 14. Terracotta
  { fg: '#1E3A8A', bg: '#DBEAFE' }, // 15. Bleu marine
  { fg: '#065F46', bg: '#D1FAE5' }  // 16. Sapin
];
/* ---------- Données (elles viennent de Supabase) ---------- */
var sb = null; // client Supabase

var state = {
  tab: 'infos',
  phone: '',
  payers: [],   // { name, amount, url, kind, fileName }
  votes: [],    // { name, amount }
  remarks: []   // { author, text, date }
};
var ui = { flash: '', error: '', busy: false };
var authMode = 'login'; // 'login' ou 'register'
var authMsg = { error: '', ok: '' };
var preselectedMember = '';

/* ---------- Connexion (uniquement les inscrits + mot de passe) ---------- */
try { localStorage.removeItem('cotisation_user'); } catch (e) {}
function saveUser() {}
state.user = '';

function configured() {
  return typeof SUPABASE_URL === 'string' && SUPABASE_URL.indexOf('https://') === 0 &&
    typeof SUPABASE_KEY === 'string' && SUPABASE_KEY.length > 20 && SUPABASE_KEY.indexOf('COLLE_ICI') === -1;
}

function check(res) {
  if (res && res.error) throw res.error;
  return res;
}

// Déduit le type et le nom du fichier depuis son adresse de stockage
function fileInfo(url) {
  var clean = String(url || '').split('?')[0];
  var last = clean.split('/').pop() || '';
  try { last = decodeURIComponent(last); } catch (e) {}
  var name = last.replace(/^\d+-/, '') || 'fichier';
  return { kind: /\.pdf$/i.test(name) ? 'pdf' : 'image', fileName: name };
}

function extractMembers(dbRows) {
  var seen = {};
  var list = [];
  (dbRows || []).forEach(function (m) {
    var clean = ((m.prenom || '') + ' ' + (m.nom || '')).trim().replace(/\s+/g, ' ');
    if (!clean) return;
    var key = clean.toLowerCase();
    if (!seen[key]) {
      seen[key] = true;
      list.push(clean);
    }
  });
  return list;
}

// Recharge toutes les données depuis Supabase
function refresh() {
  return Promise.all([
    sb.from('reglages').select('numero_orange_money').eq('id', 1).maybeSingle(),
    sb.from('paiements').select('prenom,montant,capture_url,created_at').order('created_at', { ascending: true }),
    sb.from('votes').select('prenom,montant').order('created_at', { ascending: true }),
    sb.from('remarques').select('auteur,texte,created_at').order('created_at', { ascending: true }),
    sb.from('membres').select('prenom,nom').order('created_at', { ascending: true })
  ]).then(function (r) {
    r.forEach(function (x) { check(x); });
    state.phone = (r[0].data && r[0].data.numero_orange_money) || '';
    state.payers = r[1].data.map(function (p) {
      var f = fileInfo(p.capture_url);
      return { name: p.prenom, amount: p.montant, url: p.capture_url, kind: f.kind, fileName: f.fileName, date: new Date(p.created_at) };
    });
    state.votes = r[2].data.map(function (v) { return { name: v.prenom, amount: v.montant }; });
    state.remarks = r[3].data.map(function (x) { return { author: x.auteur, text: x.texte, date: new Date(x.created_at) }; });
    MEMBERS = extractMembers(r[4].data);
  });
}

// Met la page à jour quand quelqu'un d'autre vote, paie ou écrit
function listen() {
  var timer = null;
  sb.channel('changements')
    .on('postgres_changes', { event: '*', schema: 'public' }, function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (ui.busy) return;
        refresh().then(function () { render(true); }).catch(function () {});
      }, 300);
    })
    .subscribe();
}

// Lance une action (envoi vers Supabase) avec un bouton qui montre l'attente
function run(btn, work, flash) {
  if (ui.busy) return;
  ui.busy = true;
  btn.disabled = true;
  btn.textContent = 'Envoi en cours…';
  var ok = false;
  work()
    .then(function () { return refresh(); })
    .then(function () { ok = true; ui.flash = flash; ui.error = ''; })
    .catch(function (e) { ui.flash = ''; ui.error = (e && e.message) ? e.message : 'Une erreur est survenue.'; })
    .then(function () { ui.busy = false; render(!ok); if (ok && flash === '') window.scrollTo(0, document.body.scrollHeight); });
}

var PAGES = {
  infos: { title: 'Infos', sub: 'Action du Ramadan pour aider des familles dans le besoin.' },
  paiements: { title: 'Paiements', sub: 'Signale ton envoi et suis ce qui a été reçu.' },
  vote: { title: 'Vote', sub: 'Choisis ensemble le montant de la cotisation.' },
  remarques: { title: 'Remarques', sub: 'Une conversation pour compléter ou corriger le compte rendu.' }
};

/* ---------- Icônes (SVG) ---------- */
var ICONS = {
  infos: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="9" rx="2"/><rect x="13.5" y="3.5" width="7" height="5" rx="2"/><rect x="13.5" y="11.5" width="7" height="9" rx="2"/><rect x="3.5" y="15.5" width="7" height="5" rx="2"/></svg>',
  paiements: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 8.5V7a2 2 0 0 0-2-2H6a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2H5.5"/><circle cx="16" cy="14.5" r="1.1"/></svg>',
  vote: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="4.5" width="15" height="17" rx="2.5"/><rect x="8.5" y="2.5" width="7" height="4" rx="1.5"/><path d="M9 13.5l2.2 2.2L15.5 11"/></svg>',
  remarques: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 12a8.5 8.5 0 0 1-12.4 7.5L3.5 20.5l1.1-4.3A8.5 8.5 0 1 1 20.5 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/></svg>',
  pdf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 14h6M10 17h4"/></svg>',
  image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5-5 4 4 3-3 4 4"/></svg>',
  send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-3-7z"/></svg>',
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>',
  logout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M16 8l4 4-4 4M20 12H9"/></svg>',
  chevron: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  check: '<svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-6.4 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c6.4 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/></svg>'
  ,ramadan: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.5 3.5a8.5 8.5 0 1 0 8 11.3 7 7 0 0 1-8-11.3z"/><path d="M18.5 4.5v3M17 6h3"/></svg>'
};

/* ---------- Outils ---------- */
function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function hashPassword(pwd) {
  var enc = new TextEncoder().encode(pwd);
  return crypto.subtle.digest('SHA-256', enc).then(function (buf) {
    return Array.from(new Uint8Array(buf)).map(function (b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
  });
}
function asUser() {
  var c = colorOf(state.user);
  return '<div class="as-user"><span class="dot" style="background:' + c.fg + '">' + esc(initials(state.user)) + '</span>' +
    '<span>' + esc(state.user) + '</span></div>';
}
function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function digits(s) { return String(s).replace(/\D/g, ''); }

function colorOf(name) {
  var i = MEMBERS.indexOf(name);
  if (i >= 0) return PALETTE[i % PALETTE.length];
  var h = 0;
  for (var k = 0; k < name.length; k++) h = (h * 31 + name.charCodeAt(k)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}
function initials(name) {
  var parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? parts[0].charAt(0) + parts[1].charAt(0) : name.slice(0, 2)).toUpperCase();
}
function when(d) {
  var hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return 'Aujourd’hui, ' + hm;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ', ' + hm;
}

// Les montants proposés se déduisent des votes
function options() {
  var map = {};
  state.votes.forEach(function (v) {
    if (!map[v.amount]) map[v.amount] = [];
    map[v.amount].push(v.name);
  });
  return Object.keys(map).map(function (k) {
    return { amount: Number(k), names: map[k] };
  }).sort(function (a, b) { return a.amount - b.amount; });
}
function winner() {
  var total = state.votes.length;
  var list = options();
  for (var i = 0; i < list.length; i++) {
    if (list[i].names.length * 2 > total) return list[i];
  }
  return null;
}
function currentAmount() { var w = winner(); return w ? w.amount : DEFAULT_AMOUNT; }
function totalPaid() {
  return state.payers.reduce(function (sum, p) { return sum + (p.amount || 0); }, 0);
}
function formatPhone(s) {
  var d = digits(s);
  var group = function (n) { return n.slice(0, 3) + ' ' + n.slice(3, 5) + ' ' + n.slice(5, 7) + ' ' + n.slice(7); };
  if (d.length === 12 && d.indexOf('224') === 0) return '+224 ' + group(d.slice(3));
  if (d.length === 9) return group(d);
  return s;
}

function daysLeft() {
  var d = Math.ceil((DEADLINE - new Date()) / 86400000);
  if (d > 1) return 'Dans ' + d + ' jours';
  if (d === 1) return 'Demain';
  if (d === 0) return 'Aujourd’hui';
  return 'Date passée';
}

/* ---------- Menu de gauche ---------- */
var TABS = [
  { id: 'infos', label: 'Infos' },
  { id: 'paiements', label: 'Paiements' },
  { id: 'vote', label: 'Vote' },
  { id: 'remarques', label: 'Remarques' }
];

function renderNav() {
  $('nav').innerHTML = TABS.map(function (t) {
    var on = state.tab === t.id;
    return '<button class="nav-btn' + (on ? ' on' : '') + '" data-tab="' + t.id + '"' +
      (on ? ' aria-current="page"' : '') + '>' + ICONS[t.id] + '<span>' + t.label + '</span></button>';
  }).join('');
}

/* ---------- Pages ---------- */
function viewInfos() {
  var w = winner();
  var note = (w && w.amount !== DEFAULT_AMOUNT)
    ? 'Mis à jour par le vote du groupe, à la majorité.'
    : '';
  var hasPhone = !!state.phone;
  var numberBlock = hasPhone
    ? '<div class="pay-number" id="payNumber">' + esc(formatPhone(state.phone)) + '</div>' +
      '<button class="pay-copy" id="copyBtn" type="button">' + ICONS.copy + '<span id="copyText">Copier le numéro</span></button>'
    : '<div class="pay-empty">Le numéro n’a pas encore été renseigné. Ajoute-le en bas de cette carte.</div>';

  return '' +
    '<div class="card hero">' +
      '<div style="font-size:13px;font-weight:500">Cotisation par personne l’année dernière</div>' +
      '<div class="big">' + fmt(currentAmount()) + ' FG</div>' +
      (note ? '<p>' + note + '</p>' : '') +
      '<p>À voter si la somme est différente cette année.</p>' +
      '<button class="btn ghost" data-go="vote">Aller au vote</button>' +
    '</div>' +

    '<div class="card"><div class="row between">' +
      '<div><div class="muted" style="font-size:13px">Date limite d’envoi</div>' +
      '<div style="font-size:18px;font-weight:700">15 février 2027</div></div>' +
      '<span class="pill amber">' + daysLeft() + '</span>' +
    '</div></div>' +

    '<div class="card pay">' +
      '<div class="pay-head">' +
        '<div class="pay-top"><span class="pay-icon">' + ICONS.phone + '</span>' +
        '<div><div class="pay-kicker">Où envoyer l’argent</div><div class="pay-title">Par Orange Money</div></div></div>' +
        numberBlock +
      '</div>' +
      '<div class="pay-body">' +
        (ui.flash === 'phone' ? '<div class="ok">Le numéro est enregistré.</div>' : '') +
        '<details class="change"' + (hasPhone ? '' : ' open') + '>' +
          '<summary>' + (hasPhone ? 'Changer le numéro' : 'Renseigner le numéro') + '</summary>' +
          '<div class="change-form">' +
            '<label class="label" for="tel">Nouveau numéro</label>' +
            '<input id="tel" type="tel" inputmode="tel" placeholder="+224 ...">' +
            '<button class="btn full" id="phoneBtn" disabled>Valider le numéro</button>' +
          '</div>' +
        '</details>' +
      '</div>' +
    '</div>' +

    '<div class="card">' +
      '<div class="label">Après le 15 février, à prévoir si nécessaire</div>' +
      '<div class="steps">' +
        '<div class="step"><div class="num">1</div><span>Devis estimatif des achats de denrées alimentaires.</span></div>' +
        '<div class="step"><div class="num">2</div><span>Vote d’une somme à donner à l’une des familles du groupe. La famille de Karim a été choisie à l’unanimité l’année dernière.</span></div>' +
      '</div>' +
    '</div>' +

    '<div class="muted center">© 2027 Les meilleurs · Cotisation Ramadan. Tous droits réservés.</div>';
}

function attachmentHtml(p) {
  var icon = p.kind === 'pdf' ? ICONS.pdf : ICONS.image;
  if (p.url) {
    return '<a class="attach" href="' + esc(p.url) + '" target="_blank" rel="noopener">' + icon +
      '<span class="att-text"><span class="att-label">Voir le fichier</span>' +
      '<small class="att-name" title="' + esc(p.fileName) + '">' + esc(p.fileName) + '</small></span></a>';
  }
  return '<span class="attach static">' + icon + '<span>' + esc(p.fileName) + '</span></span>';
}

function viewPaiements() {
  var paid = {};
  state.payers.forEach(function (p) { paid[p.name] = p; });
  var total = MEMBERS.length;
  var done = MEMBERS.filter(function (m) { return paid[m]; }).length;
  var pct = total ? Math.round(done / total * 100) : 0;

  var names = MEMBERS.slice().sort(function (x, y) { return (paid[y] ? 1 : 0) - (paid[x] ? 1 : 0); });
  var list = names.map(function (m) {
    var p = paid[m];
    var c = colorOf(m);
    if (!p) {
      return '<div class="member pending">' +
        '<div class="m-avatar">' + esc(initials(m)) + '</div>' +
        '<div class="m-info"><b>' + esc(m) + '</b><div class="muted" style="font-size:13px">Pas encore signalé</div></div>' +
        '<span class="pill wait">En attente</span></div>';
    }
    return '<div class="member paid" style="--c:' + c.fg + ';--cb:' + c.bg + '">' +
      '<div class="m-avatar" style="background:' + c.fg + '">' + esc(initials(m)) + '</div>' +
      '<div class="m-info"><b>' + esc(m) + '</b>' +
      '<div class="m-amount">' + fmt(p.amount) + ' FG</div>' +
      '<div class="m-date">' + esc(when(p.date)) + '</div>' +
      '<div>' + attachmentHtml(p) + '</div></div>' +
      '<span class="pill">✓ Payé</span></div>';
  }).join('');

  return '' +
    '<div class="card hero">' +
      '<div style="font-size:13px;font-weight:500">État des cotisations</div>' +
      '<div class="big">' + (done === 0 ? 'Personne n’a payé' : (done === 1 ? '1 / ' + total + ' a payé' : done + ' / ' + total + ' personnes ont payé')) + '</div>' +
      '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + done + '"><div style="width:' + pct + '%"></div></div>' +
      '<p>Total déclaré : ' + fmt(totalPaid()) + ' FG</p>' +
    '</div>' +

    '<div class="card">' +
      '<div class="label">J’ai envoyé ma cotisation</div>' +
      asUser() +
      '<div><label class="muted" for="payAmount" style="font-size:13px">Montant envoyé (FG)</label>' +
      '<input id="payAmount" type="text" inputmode="numeric" placeholder="Ex. 700000" style="margin-top:6px"></div>' +
      '<div><div class="muted" style="font-size:13px">Capture d’écran ou PDF du transfert</div>' +
      '<input id="payFile" class="file-input" type="file" accept="image/*,application/pdf,.pdf">' +
      '<label for="payFile" class="file-btn">' + ICONS.folder + '<span id="fileBtnText">Importer un fichier</span></label>' +
      '<div class="muted" id="fileLabel" style="font-size:13px;margin-top:8px">Aucun fichier joint (image ou PDF, 5 Mo maximum).</div></div>' +
      '<button class="btn full" id="payBtn" disabled>Prévenir le groupe</button>' +
      (ui.flash === 'pay' ? '<div class="ok">Merci, ton envoi est noté dans la liste.</div>' : '') +
    '</div>' +

    '<div class="label" style="margin-top:4px">Liste des membres</div>' +
    '<div class="members-scroll">' + list + '</div>';
}

function viewVote() {
  var total = state.votes.length;
  var w = winner();
  var list = options();

  var leadAmount = null;
  if (total > 0) {
    var max = Math.max.apply(null, list.map(function (o) { return o.names.length; }));
    var leaders = list.filter(function (o) { return o.names.length === max; });
    if (leaders.length === 1) leadAmount = leaders[0].amount;
  }

  var opts = list.map(function (o) {
    var c = o.names.length;
    var pct = total ? Math.round(c / total * 100) : 0;
    var isLead = o.amount === leadAmount;
    var badge = isLead
      ? '<span class="badge lead-badge">' + (w && w.amount === o.amount ? '★ Majorité' : '★ En tête') + '</span>'
      : '';
    return '<button class="option' + (isLead ? ' lead' : (leadAmount !== null ? ' dim' : '')) + '" data-amount="' + o.amount +
      '" data-lead="' + (isLead ? '1' : (leadAmount !== null ? 'dim' : '')) + '" data-voters="' + esc(o.names.join('|')) + '">' +
      '<div class="top"><span class="amt">' + fmt(o.amount) + ' FG</span><span class="cnt">' + c + (c > 1 ? ' votes' : ' vote') + ' · ' + pct + ' %</span></div>' +
      '<div class="badges">' + badge + '<span class="badge mine" hidden>✓ Ton vote</span></div>' +
      '<div class="who">Votants : ' + esc(o.names.join(', ')) + '</div>' +
      '<div class="bar"><div style="width:' + pct + '%"></div></div>' +
    '</button>';
  }).join('');

  var status = w
    ? 'Majorité atteinte : le montant a été mis à jour.'
    : (total > 0 ? 'Pas encore de majorité : le montant reste ' + fmt(DEFAULT_AMOUNT) + ' FG.' : 'Aucun vote pour l’instant : le montant reste ' + fmt(DEFAULT_AMOUNT) + ' FG.');

  return '' +
    '<div class="card hero">' +
      '<div style="font-size:13px;font-weight:500">Montant en vigueur pour 2027</div>' +
      '<div class="big">' + fmt(currentAmount()) + ' FG</div>' +
      '<p>' + total + (total > 1 ? ' votes enregistrés' : ' vote enregistré') + ' sur ' + MEMBERS.length + ' membres</p>' +
      '<p>' + status + '</p>' +
    '</div>' +

    '<div><div class="eyebrow">Vote</div><h2 style="margin:4px 0 6px">Quelle cotisation par personne pour 2027 ?</h2>' +
    '<p class="muted" style="margin:0">Indique le montant que tu proposes (tape-le, ou touche un montant déjà proposé), puis vote. Un seul vote par personne : si tu revotes, ton choix est remplacé.</p></div>' +
    (opts
      ? '<div style="display:flex;flex-direction:column;gap:10px">' + opts + '</div>'
      : '<div class="empty">Aucun vote pour l’instant. Le premier vote créera le premier montant.</div>') +

    '<div class="card">' +
      asUser() +
      '<div><label class="label" for="custom">Montant que je propose (FG)</label>' +
      '<input id="custom" type="text" inputmode="numeric" placeholder="Ex. 700000" style="margin-top:6px"></div>' +
      '<button class="btn full" id="voteBtn" disabled>Voter</button>' +
      (ui.flash === 'vote' ? '<div class="ok">Merci, ton vote est enregistré.</div>' : '') +
    '</div>';
}

function viewRemarques() {
  var thread = state.remarks.length
    ? '<div class="thread">' + state.remarks.map(function (r) {
        var c = colorOf(r.author);
        return '<div class="msg">' +
          '<div class="avatar" style="background:' + c.fg + '" aria-hidden="true">' + esc(initials(r.author)) + '</div>' +
          '<div class="bubble" style="background:' + c.bg + '">' +
            '<div class="head"><span class="who" style="color:' + c.fg + '">' + esc(r.author) + '</span>' +
            '<span class="when">' + esc(when(r.date)) + '</span></div>' +
            '<div class="text">' + esc(r.text) + '</div>' +
          '</div></div>';
      }).join('') + '</div>'
    : '<div class="empty">Aucune remarque pour l’instant. Écris la première en bas de la page.</div>';

  return '' +
    '<p class="muted" style="margin:0">Un point oublié dans le compte rendu ? Une correction ? Écris-le ici, tout le groupe le voit avec ton nom et ta couleur.</p>' +
    thread +
    '<div class="composer">' +
      asUser() +
      '<label class="label" for="remark" style="margin-top:2px">Mon message</label>' +
      '<textarea id="remark" placeholder="Ex. Il faudrait aussi préciser..."></textarea>' +
      '<button class="btn full" id="remarkBtn" disabled>' + ICONS.send + 'Envoyer</button>' +
    '</div>';
}

/* ---------- Affichage (en gardant ce que la personne est en train de saisir) ---------- */
var FORM_IDS = ['tel', 'payAmount', 'custom', 'remark'];
function snapshot() {
  var s = { values: {}, file: $('payFile'), focus: null };
  FORM_IDS.forEach(function (id) { if ($(id)) s.values[id] = $(id).value; });
  var a = document.activeElement;
  if (a && a.id) {
    s.focus = a.id;
    try { s.start = a.selectionStart; s.end = a.selectionEnd; } catch (e) {}
  }
  return s;
}
function restore(s) {
  FORM_IDS.forEach(function (id) { if ($(id) && s.values[id] !== undefined) $(id).value = s.values[id]; });
  if (s.file && $('payFile')) {
    $('payFile').parentNode.replaceChild(s.file, $('payFile'));
    var f = s.file.files[0];
    if (f) {
      $('fileLabel').textContent = 'Fichier joint : ' + f.name;
      $('fileBtnText').textContent = 'Changer de fichier';
    }
  }
  if (s.focus && $(s.focus)) {
    $(s.focus).focus();
    try { $(s.focus).setSelectionRange(s.start, s.end); } catch (e) {}
  }
}

function viewSetup() {
  return '<div class="card"><div class="label">Supabase n’est pas encore branché</div>' +
    '<div class="muted">Ouvre le fichier <b>config.js</b> et colle l’URL du projet et la clé « anon public », puis recharge la page.</div></div>';
}

function render(keep) {
  var snap = keep && sb ? snapshot() : null;
  var views = { infos: viewInfos, paiements: viewPaiements, vote: viewVote, remarques: viewRemarques };
  var meta = PAGES[state.tab];
  $('pageTitle').textContent = meta.title;
  $('pageSub').textContent = meta.sub;
  var banner = ui.error ? '<div class="error">' + esc(ui.error) + '</div>' : '';
  $('main').innerHTML = banner + (sb ? views[state.tab]() : viewSetup());
  if (snap) restore(snap);
  renderNav();
  applyUser();
  if (sb) bind();
}

/* ---------- Interactions ---------- */
function syncVote() {
  var amt = parseInt(digits($('custom').value), 10) || 0;
  var who = state.user;
  $('voteBtn').disabled = !(who && amt > 0);
  var cards = document.querySelectorAll('[data-amount]');
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    var same = parseInt(c.getAttribute('data-amount'), 10) === amt;
    var lead = c.getAttribute('data-lead');
    c.className = 'option' + (lead === '1' ? ' lead' : (lead === 'dim' ? ' dim' : '')) + (same ? ' on' : '');
    var mine = !!who && c.getAttribute('data-voters').split('|').indexOf(who) >= 0;
    var m = c.querySelector('.mine');
    if (m) m.hidden = !mine;
  }
}

function bind() {
  var go = document.querySelector('[data-go]');
  if (go) go.onclick = function () { setTab('vote'); };

  if ($('copyBtn')) {
    $('copyBtn').onclick = function () {
      var txt = state.phone.replace(/\s/g, '');
      var done = function () {
        $('copyText').textContent = 'Numéro copié ✓';
        setTimeout(function () { if ($('copyText')) $('copyText').textContent = 'Copier le numéro'; }, 2000);
      };
      var fallback = function () {
        var r = document.createRange();
        r.selectNodeContents($('payNumber'));
        var s = window.getSelection();
        s.removeAllRanges(); s.addRange(r);
        $('copyText').textContent = 'Numéro sélectionné, copie-le';
      };
      try { navigator.clipboard.writeText(txt).then(done, fallback); } catch (e) { fallback(); }
    };
  }

  if ($('tel')) {
    var checkPhone = function () { $('phoneBtn').disabled = digits($('tel').value).length < 8; };
    $('tel').oninput = checkPhone;
    checkPhone();
    $('phoneBtn').onclick = function () {
      var v = $('tel').value.trim();
      if (digits(v).length < 8) return;
      run(this, function () {
        return sb.from('reglages').upsert({ id: 1, numero_orange_money: v }).then(check);
      }, 'phone');
    };
  }

  if ($('payAmount')) {
    var checkPay = function () {
      var amt = parseInt(digits($('payAmount').value), 10) || 0;
      $('payBtn').disabled = !(state.user && amt > 0 && $('payFile').files.length);
    };
    $('payAmount').oninput = checkPay;
    $('payFile').onchange = function () {
      var f = $('payFile').files[0];
      $('fileLabel').textContent = f ? 'Fichier joint : ' + f.name : 'Aucun fichier joint (image ou PDF, 5 Mo maximum).';
      $('fileBtnText').textContent = f ? 'Changer de fichier' : 'Importer un fichier';
      checkPay();
    };
    checkPay();
    $('payBtn').onclick = function () {
      var nm = state.user;
      var f = $('payFile').files[0];
      var amt = parseInt(digits($('payAmount').value), 10) || 0;
      if (!nm || !f || amt <= 0) return;

      var isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      var isImage = /^image\//.test(f.type);
      if (!isPdf && !isImage) {
        ui.error = 'Format non accepté : choisis une image ou un PDF.';
        ui.flash = ''; render(true); return;
      }
      if (f.size > MAX_FILE) {
        ui.error = 'Le fichier est trop lourd (5 Mo maximum).';
        ui.flash = ''; render(true); return;
      }

      run(this, function () {
        var path = Date.now() + '-' + f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        return sb.storage.from('captures').upload(path, f, { contentType: isPdf ? 'application/pdf' : f.type }).then(check).then(function () {
          var url = sb.storage.from('captures').getPublicUrl(path).data.publicUrl;
          return sb.from('paiements').upsert({ prenom: nm, montant: amt, capture_url: url, created_at: new Date().toISOString() }, { onConflict: 'prenom' }).then(check);
        });
      }, 'pay');
    };
  }

  if ($('custom')) {
    var cards = document.querySelectorAll('[data-amount]');
    for (var i = 0; i < cards.length; i++) {
      cards[i].onclick = function () {
        $('custom').value = this.getAttribute('data-amount');
        ui.flash = '';
        syncVote();
      };
    }
    $('custom').oninput = syncVote;
    syncVote();
    $('voteBtn').onclick = function () {
      var nm = state.user;
      var amt = parseInt(digits($('custom').value), 10) || 0;
      if (!nm || amt <= 0) return;
      run(this, function () {
        return sb.from('votes').upsert({ prenom: nm, montant: amt }, { onConflict: 'prenom' }).then(check);
      }, 'vote');
    };
  }

  if ($('remark')) {
    var checkRemark = function () {
      $('remarkBtn').disabled = !($('remark').value.trim() && state.user);
    };
    $('remark').oninput = checkRemark;
    checkRemark();
    $('remarkBtn').onclick = function () {
      var t = $('remark').value.trim();
      var who = state.user;
      if (!t || !who) return;
      run(this, function () {
        return sb.from('remarques').insert({ auteur: who, texte: t }).then(check);
      }, '');
    };
  }
}

/* ---------- Composant Liste Déroulante Moderne réutilisable ---------- */
function setupDropdown(container, prefix, optionsList, placeholder, emptyMsg, initialVal, onChange) {
  var value = initialVal || '';
  var dd = $(prefix + 'Dd');
  var btn = $(prefix + 'Btn');
  var valEl = $(prefix + 'Value');
  var listEl = $(prefix + 'List');

  var itemsHtml = optionsList.length
    ? optionsList.map(function (opt) {
        var c = colorOf(opt);
        return '<li class="dd-item" role="option" tabindex="-1" data-name="' + esc(opt) + '" aria-selected="false">' +
          '<span class="dd-av" style="background:' + c.fg + '">' + esc(initials(opt)) + '</span>' +
          '<span class="dd-name">' + esc(opt) + '</span>' + ICONS.check + '</li>';
      }).join('')
    : '<li class="dd-empty" role="presentation">' + emptyMsg + '</li>';

  listEl.innerHTML = itemsHtml;
  var items = Array.prototype.slice.call(listEl.querySelectorAll('.dd-item'));

  var openList = function () {
    // Fermer les autres listes déroulantes ouvertes
    var allLists = container.querySelectorAll('.dd-list');
    var allBtns = container.querySelectorAll('.dd-trigger');
    for (var k = 0; k < allLists.length; k++) {
      if (allLists[k] !== listEl) {
        allLists[k].hidden = true;
        allBtns[k].setAttribute('aria-expanded', 'false');
      }
    }
    var r = btn.getBoundingClientRect();
    var below = window.innerHeight - r.bottom - 16, above = r.top - 16;
    var up = below < 240 && above > below;
    listEl.className = 'dd-list' + (up ? ' up' : '');
    listEl.style.maxHeight = Math.max(150, Math.min(280, up ? above : below)) + 'px';
    listEl.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    if (items.length) {
      var cur = items.filter(function (i) { return i.getAttribute('data-name') === value; })[0] || items[0];
      cur.focus();
    }
  };

  var closeList = function (back) {
    listEl.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (back) btn.focus();
  };

  var applyPick = function (name, silent) {
    value = name;
    var c = colorOf(value);
    valEl.className = 'dd-value';
    valEl.innerHTML = '<span class="dd-av" style="background:' + c.fg + '">' + esc(initials(value)) + '</span>' + esc(value);
    items.forEach(function (i) { i.setAttribute('aria-selected', i.getAttribute('data-name') === value ? 'true' : 'false'); });
    if (!silent && onChange) onChange(value);
  };

  if (value && optionsList.indexOf(value) >= 0) {
    applyPick(value, true);
  } else {
    value = '';
    valEl.className = 'dd-value placeholder';
    valEl.textContent = optionsList.length ? placeholder : 'Aucun inscrit pour l’instant';
  }

  btn.onclick = function () { if (listEl.hidden) openList(); else closeList(false); };
  btn.onkeydown = function (e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openList(); }
  };

  items.forEach(function (li, idx) {
    li.onclick = function () {
      applyPick(li.getAttribute('data-name'), false);
      closeList(false);
    };
    li.onkeydown = function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); (items[idx + 1] || items[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (items[idx - 1] || items[items.length - 1]).focus(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); applyPick(li.getAttribute('data-name'), false); closeList(false); }
      else if (e.key === 'Escape') { e.preventDefault(); closeList(true); }
      else if (e.key === 'Tab') { closeList(false); }
    };
  });

  container.addEventListener('click', function (e) {
    if (dd && !dd.contains(e.target)) closeList(false);
  });

  return { getValue: function () { return value; } };
}

function dropdownHtml(prefix, labelText) {
  return '<div class="auth-field">' +
    '<label class="label" id="' + prefix + 'Label">' + esc(labelText) + '</label>' +
    '<div class="dd" id="' + prefix + 'Dd">' +
      '<button type="button" class="dd-trigger" id="' + prefix + 'Btn" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="' + prefix + 'Label ' + prefix + 'Value">' +
        '<span class="dd-value placeholder" id="' + prefix + 'Value"></span>' + ICONS.chevron +
      '</button>' +
      '<ul class="dd-list" id="' + prefix + 'List" role="listbox" aria-labelledby="' + prefix + 'Label" hidden></ul>' +
    '</div>' +
  '</div>';
}

/* ---------- Page de connexion (uniquement les inscrits) & inscription ---------- */
function applyUser() {
  var side = document.querySelector('.sidebar');
  var box = $('userBox');
  var login = $('login');

  if (state.user) {
    if (login) login.parentNode.removeChild(login);
    var c = colorOf(state.user);
    if (!box) { box = document.createElement('div'); box.id = 'userBox'; box.className = 'user-box'; side.appendChild(box); }
    box.innerHTML =
      '<div class="user-me"><div class="user-avatar" style="background:' + c.fg + '">' + esc(initials(state.user)) + '</div>' +
      '<div class="user-name">' + esc(state.user) + '</div></div>' +
      '<button class="logout" id="logoutBtn" type="button" title="Se déconnecter">' + ICONS.logout + '<span>Se déconnecter</span></button>';
    $('logoutBtn').onclick = function () {
      state.user = ''; saveUser(''); state.tab = 'infos'; ui.flash = ''; ui.error = '';
      authMode = 'login'; authMsg = { error: '', ok: '' };
      render();
    };
    return;
  }

  if (box) box.parentNode.removeChild(box);
  if (!login) {
    login = document.createElement('div');
    login.id = 'login';
    login.className = 'login';
    document.body.appendChild(login);
  }

  var isRegister = authMode === 'register';
  var banner = authMsg.error
    ? '<div class="error">' + esc(authMsg.error) + '</div>'
    : (authMsg.ok ? '<div class="ok">' + esc(authMsg.ok) + '</div>' : '');

  var pwdBlock =
    '<div class="auth-field">' +
      '<label class="label" for="authPass">Mot de passe</label>' +
      '<div class="input-box">' +
        '<span class="input-ico">' + ICONS.lock + '</span>' +
        '<input id="authPass" type="password" placeholder="' + (isRegister ? 'Choisis un mot de passe (4 car. min.)' : 'Entre ton mot de passe') + '" autocomplete="' + (isRegister ? 'new-password' : 'current-password') + '">' +
        '<button type="button" class="pwd-toggle" id="togglePwd" aria-label="Afficher le mot de passe">' + ICONS.eye + '</button>' +
      '</div>' +
    '</div>';

  var formBody = isRegister
    ? '<div class="auth-stack">' +
        dropdownHtml('regNom', 'Mon nom') +
        dropdownHtml('regPrenom', 'Mon prénom') +
        pwdBlock +
      '</div>'
    : '<div class="auth-stack">' +
        dropdownHtml('loginMember', 'Mon nom et prénom') +
        pwdBlock +
      '</div>';

  login.innerHTML =
    '<div class="login-card">' +
'<div class="login-logo">' + ICONS.ramadan + '</div>' +
      '<div class="eyebrow">Les meilleurs</div>' +
      '<h2>' + (isRegister ? 'Créer un compte' : 'Cotisation Ramadan') + '</h2>' +
      '<p class="muted">' + (isRegister
        ? 'Choisis ton nom, ton prénom et définis ton mot de passe.'
        : 'Sélectionne ton compte inscrit puis saisis ton mot de passe.') + '</p>' +
      banner +
      formBody +
      '<button class="btn full" id="authSubmit" disabled>' + (isRegister ? 'Créer mon compte' : 'Se connecter') + '</button>' +
      '<div class="auth-switch">' +
        (isRegister
          ? 'Déjà inscrit ? <button type="button" class="link-btn" id="switchAuth">Se connecter</button>'
          : 'Pas encore de compte ? <button type="button" class="link-btn" id="switchAuth">Créer un compte</button>') +
      '</div>' +
    '</div>';

  var passEl = $('authPass');
  var submitBtn = $('authSubmit');
  var toggleBtn = $('togglePwd');

  toggleBtn.onclick = function () {
    var hidden = passEl.type === 'password';
    passEl.type = hidden ? 'text' : 'password';
    toggleBtn.innerHTML = hidden ? ICONS.eyeOff : ICONS.eye;
    toggleBtn.setAttribute('aria-label', hidden ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
  };

  var nomDd = null, prenomDd = null, memberDd = null;

  var validate = function () {
    if (isRegister) {
      submitBtn.disabled = !(nomDd && nomDd.getValue() && prenomDd && prenomDd.getValue() && passEl.value.length >= 4);
    } else {
      submitBtn.disabled = !(memberDd && memberDd.getValue() && passEl.value.length >= 4);
    }
  };

  passEl.oninput = validate;
  passEl.onkeydown = function (e) { if (e.key === 'Enter' && !submitBtn.disabled) submitBtn.click(); };

  if (isRegister) {
    nomDd = setupDropdown(login, 'regNom', REGISTER_NOMS, 'Choisis ton nom', '', '', function () {
      validate();
    });
    prenomDd = setupDropdown(login, 'regPrenom', REGISTER_PRENOMS, 'Choisis ton prénom', '', '', function () {
      validate();
      passEl.focus();
    });
  } else {
    var initChoice = (preselectedMember && MEMBERS.indexOf(preselectedMember) >= 0) ? preselectedMember : '';
    preselectedMember = '';
    memberDd = setupDropdown(
      login,
      'loginMember',
      MEMBERS,
      'Choisis ton nom et prénom',
      'Aucun compte inscrit pour l’instant.<br>Clique sur <b>Créer un compte</b> ci-dessous.',
      initChoice,
      function () {
        validate();
        passEl.focus();
      }
    );
  }
  validate();

  $('switchAuth').onclick = function () {
    authMode = isRegister ? 'login' : 'register';
    authMsg = { error: '', ok: '' };
    applyUser();
  };

  submitBtn.onclick = function () {
    var pass = passEl.value;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Vérification…';
    authMsg = { error: '', ok: '' };

    hashPassword(pass).then(function (hash) {
      if (isRegister) {
        var nom = nomDd.getValue();
        var prenom = prenomDd.getValue();
        var fullLabel = (prenom + ' ' + nom).trim();

        return sb.from('membres').select('id').ilike('prenom', prenom).ilike('nom', nom).maybeSingle()
          .then(check)
          .then(function (res) {
            if (res.data) throw new Error('Ce compte existe déjà. Passe directement à la connexion.');
            return sb.from('membres').insert({
              prenom: prenom,
              nom: nom,
              password_hash: hash
            }).then(check);
          })
          .then(function () {
            return refresh();
          })
          .then(function () {
            preselectedMember = fullLabel;
            authMode = 'login';
            authMsg = { error: '', ok: 'Compte créé ! Saisis maintenant ton mot de passe pour te connecter.' };
            applyUser();
            if ($('authPass')) $('authPass').focus();
          });
      } else {
        var selected = memberDd.getValue();
        return sb.from('membres').select('prenom,nom,password_hash').then(check).then(function (res) {
          var rows = res.data || [];
          var match = null;
          for (var i = 0; i < rows.length; i++) {
            var comb = ((rows[i].prenom || '') + ' ' + (rows[i].nom || '')).trim().toLowerCase();
            if (comb === selected.toLowerCase()) {
              match = rows[i];
              break;
            }
          }
          if (!match) {
            throw new Error('Aucun compte trouvé pour ' + selected + '. Crée ton compte d’abord.');
          }
          if (match.password_hash !== hash) {
            throw new Error('Mot de passe incorrect.');
          }
          state.user = ((match.prenom || '') + ' ' + (match.nom || '')).trim() || selected;
          saveUser(state.user);
          ui.flash = ''; ui.error = '';
          return refresh().then(function () {
            render();
            window.scrollTo(0, 0);
          });
        });
      }
    }).catch(function (e) {
      authMsg.error = (e && e.message) ? e.message : 'Une erreur est survenue.';
      applyUser();
    });
  };
}

function setTab(t) { state.tab = t; ui.flash = ''; ui.error = ''; render(); window.scrollTo(0, 0); }

$('nav').addEventListener('click', function (e) {
  var btn = e.target.closest('[data-tab]');
  if (btn) setTab(btn.getAttribute('data-tab'));
});

/* ---------- Démarrage ---------- */
if (configured() && window.supabase) {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  $('main').innerHTML = '<div class="muted">Chargement…</div>';
  renderNav();
  applyUser();
  refresh()
    .then(function () { render(); listen(); })
    .catch(function (e) {
      ui.error = 'Connexion impossible : ' + ((e && e.message) || 'vérifie config.js et le script SQL.');
      render();
    });
} else {
  if (configured()) ui.error = 'La librairie Supabase n’a pas pu se charger. Vérifie ta connexion internet.';
  render();
}