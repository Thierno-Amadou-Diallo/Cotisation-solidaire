/* ---------- Réglages ---------- */
var DEFAULT_AMOUNT = 700000;
var DEADLINE = new Date(2027, 1, 15); // 15 février 2027
var MAX_FILE = 5 * 1024 * 1024;       // 5 Mo

// Liste des membres du groupe (pour les listes déroulantes « Mon prénom »)
var MEMBERS = [
  'Thierno Amadou',
  'Abdoulaye Souleymane',
  'Thierno Hamidou',
  'Karim',
  'Fadja',
  'Djouldé',
  'Yassar',
  'Oumar',
  'Chérif'
];

// Une couleur par personne (dans l'ordre de la liste ci-dessus)
var PALETTE = [
  { fg: '#1D4ED8', bg: '#E8EEFF' }, // Thierno Amadou : bleu
  { fg: '#047857', bg: '#E1F4EC' }, // Abdoulaye Souleymane : vert
  { fg: '#7E22CE', bg: '#F3E8FF' }, // Thierno Hamidou : violet
  { fg: '#C2410C', bg: '#FFEDDD' }, // Karim : orange
  { fg: '#BE185D', bg: '#FFE6F0' }, // Fadja : rose
  { fg: '#0F766E', bg: '#DDF5F2' }, // Djouldé : turquoise
  { fg: '#0369A1', bg: '#E0F2FE' }, // Yassar : bleu ciel
  { fg: '#B91C1C', bg: '#FEE4E4' }, // Oumar : rouge
  { fg: '#3F6212', bg: '#EDF6D8' }  // Chérif : olive
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

/* ---------- Connexion (choix du prénom, gardé sur cet appareil) ---------- */
// Rien n'est gardé : à chaque ouverture de la page, il faut se reconnecter.
// (on efface aussi l'ancien prénom mémorisé par les versions précédentes)
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

// Recharge toutes les données depuis Supabase
function refresh() {
  return Promise.all([
    sb.from('reglages').select('numero_orange_money').eq('id', 1).maybeSingle(),
    sb.from('paiements').select('prenom,montant,capture_url,created_at').order('created_at', { ascending: true }),
    sb.from('votes').select('prenom,montant').order('created_at', { ascending: true }),
    sb.from('remarques').select('auteur,texte,created_at').order('created_at', { ascending: true })
  ]).then(function (r) {
    r.forEach(function (x) { check(x); });
    state.phone = (r[0].data && r[0].data.numero_orange_money) || '';
    state.payers = r[1].data.map(function (p) {
      var f = fileInfo(p.capture_url);
      return { name: p.prenom, amount: p.montant, url: p.capture_url, kind: f.kind, fileName: f.fileName, date: new Date(p.created_at) };
    });
    state.votes = r[2].data.map(function (v) { return { name: v.prenom, amount: v.montant }; });
    state.remarks = r[3].data.map(function (x) { return { author: x.auteur, text: x.texte, date: new Date(x.created_at) }; });
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
  folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>'
};

/* ---------- Outils ---------- */
function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function nameSelect(id) {
  return '<select id="' + id + '" style="margin-top:6px">' +
    '<option value="">Choisis ton prénom</option>' +
    MEMBERS.map(function (m) { return '<option value="' + esc(m) + '">' + esc(m) + '</option>'; }).join('') +
    '</select>';
}
// Ligne « au nom de » pour les formulaires (le prénom vient de la connexion)
function asUser() {
  var c = colorOf(state.user);
  return '<div class="as-user"><span class="dot" style="background:' + c.fg + '">' + esc(initials(state.user)) + '</span>' +
    '<span>' + esc(state.user) + '</span></div>';
}
function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function digits(s) { return String(s).replace(/\D/g, ''); }

function colorOf(name) {
  var i = MEMBERS.indexOf(name);
  return i >= 0 ? PALETTE[i % PALETTE.length] : { fg: '#475569', bg: '#EEF1F5' };
}
function initials(name) {
  var parts = name.split(' ');
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
// Affiche un numéro par groupes : +224 806 66 55 53
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

  // Tous les membres, ceux qui ont payé d'abord
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

  // Montant en tête (seulement s'il n'y a pas d'égalité)
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
    '<p class="muted" style="margin:0">Indique ton prénom et le montant que tu proposes (tape-le, ou touche un montant déjà proposé), puis vote. Un seul vote par prénom : si tu revotes, ton choix est remplacé.</p></div>' +
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
var FORM_IDS = ['tel', 'payName', 'payAmount', 'voter', 'custom', 'remarkAuthor', 'remark'];
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
// Met à jour le bouton « Voter » et la surbrillance du montant choisi
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

  // Copier le numéro (si la copie est refusée, on sélectionne le numéro)
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

  // Numéro Orange Money
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

  // Paiements (image ou PDF)
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

  // Vote
  if ($('custom')) {
    // Toucher un montant déjà proposé le recopie dans le champ
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

  // Remarques
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

/* ---------- Page de connexion + avatar dans le menu ---------- */
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
      render();
    };
    return;
  }

  if (box) box.parentNode.removeChild(box);
  if (login) return;
  login = document.createElement('div');
  login.id = 'login';
  login.className = 'login';
  login.innerHTML =
    '<div class="login-card">' +
      '<div class="login-logo">' + ICONS.paiements + '</div>' +
      '<div class="eyebrow">Les meilleurs</div>' +
      '<h2>Cotisation Ramadan</h2>' +
      '<p class="muted">Choisis ton prénom pour te connecter. Tes paiements, votes et remarques seront faits en ton nom.</p>' +
      '<label class="label" id="ddLabel">Mon prénom</label>' +
      '<div class="dd" id="dd">' +
        '<button type="button" class="dd-trigger" id="ddBtn" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="ddLabel ddValue">' +
          '<span class="dd-value placeholder" id="ddValue">Choisis ton prénom</span>' + ICONS.chevron +
        '</button>' +
        '<ul class="dd-list" id="ddList" role="listbox" aria-labelledby="ddLabel" hidden>' +
          MEMBERS.map(function (m) {
            var c = colorOf(m);
            return '<li class="dd-item" role="option" tabindex="-1" data-name="' + esc(m) + '" aria-selected="false">' +
              '<span class="dd-av" style="background:' + c.fg + '">' + esc(initials(m)) + '</span>' +
              '<span class="dd-name">' + esc(m) + '</span>' + ICONS.check + '</li>';
          }).join('') +
        '</ul>' +
      '</div>' +
      '<button class="btn full" id="loginBtn" disabled>Se connecter</button>' +
    '</div>';
  document.body.appendChild(login);

  // Liste déroulante personnalisée
  var choice = '';
  var items = Array.prototype.slice.call(login.querySelectorAll('.dd-item'));
  var openList = function () {
    // Ouvre vers le haut s'il n'y a pas assez de place en bas
    var r = $('ddBtn').getBoundingClientRect();
    var below = window.innerHeight - r.bottom - 16, above = r.top - 16;
    var up = below < 260 && above > below;
    $('ddList').className = 'dd-list' + (up ? ' up' : '');
    $('ddList').style.maxHeight = Math.max(160, Math.min(300, up ? above : below)) + 'px';
    $('ddList').hidden = false; $('ddBtn').setAttribute('aria-expanded', 'true');
    var cur = items.filter(function (i) { return i.getAttribute('data-name') === choice; })[0] || items[0];
    cur.focus();
  };
  var closeList = function (back) {
    $('ddList').hidden = true; $('ddBtn').setAttribute('aria-expanded', 'false');
    if (back) $('ddBtn').focus();
  };
  var pick = function (li) {
    choice = li.getAttribute('data-name');
    var c = colorOf(choice);
    $('ddValue').className = 'dd-value';
    $('ddValue').innerHTML = '<span class="dd-av" style="background:' + c.fg + '">' + esc(initials(choice)) + '</span>' + esc(choice);
    items.forEach(function (i) { i.setAttribute('aria-selected', i === li ? 'true' : 'false'); });
    $('loginBtn').disabled = false;
    closeList(true);
  };
  $('ddBtn').onclick = function () { if ($('ddList').hidden) openList(); else closeList(false); };
  $('ddBtn').onkeydown = function (e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openList(); }
  };
  items.forEach(function (li, idx) {
    li.onclick = function () { pick(li); };
    li.onkeydown = function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); (items[idx + 1] || items[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (items[idx - 1] || items[items.length - 1]).focus(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(li); }
      else if (e.key === 'Escape') { e.preventDefault(); closeList(true); }
      else if (e.key === 'Tab') { closeList(false); }
    };
  });
  login.addEventListener('click', function (e) { var dd = $('dd'); if (dd && !dd.contains(e.target)) closeList(false); });

  $('loginBtn').onclick = function () {
    var v = choice;
    if (!v) return;
    state.user = v; saveUser(v); ui.flash = ''; ui.error = '';
    render(); window.scrollTo(0, 0);
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
  applyUser(); // la page de connexion s'affiche tout de suite, sans attendre les données
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